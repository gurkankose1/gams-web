import { Flight, MaintenanceBlock } from '../types.ts';
import { CONCOURSE_LAYOUT, WIDE_BODY_AIRCRAFT, PARKING_POSITIONS } from '../constants.ts';
import {
    isContactStand,
    isStandWidebodyCompatible,
    isStandCatFCompatible,
    getAircraftCategory,
    isCargoFlight,
    isPropellerAircraft
} from './ams-rules.ts';
import {
    isFlightBridgeEligible,
    getAllowedBridgeConcourses,
    buildStandTopology,
    canFitOnStand,
    placeOnStand,
    hasMaintenanceConflict,
    calculateBridgeUtilization,
    BridgeUtilizationStats,
    StandSchedule
} from './ai-allocator.ts';
import { getStoredApiKey, getStoredModel } from './gemini-api.ts';

export interface DeepPlanProgress {
    currentWave: number;
    totalWaves: number;
    waveTimeRange: string;
    percent: number;
    allocatedCount: number;
    totalFlightsInScope: number;
    currentBridgeRate: number;
    currentMessage: string;
}

export interface DeepPlanResult {
    updatedFlights: Flight[];
    stats: BridgeUtilizationStats;
    totalAllocated: number;
    totalWaves: number;
    executionTimeMs: number;
    modelUsed: string;
}

const getCallsign = (f: Flight): string => {
    return f.departureFlightNumber || f.arrivalFlightNumber || (f.airline ? `${f.airline} Flight` : 'FLIGHT');
};

const formatHHMM = (d: Date): string => {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const getDurationMins = (f: Flight): number => {
    return Math.max(30, (f.scheduledDeparture.getTime() - f.scheduledArrival.getTime()) / (60 * 1000));
};

const isWide = (f: Flight): boolean => {
    if (f.acCategory === 'E' || f.acCategory === 'D' || f.acCategory === 'F') return true;
    const cat = getAircraftCategory(f.aircraftType);
    if (cat === 'E' || cat === 'D' || cat === 'F') return true;
    const cleanType = (f.aircraftType || '').toUpperCase().trim();
    return WIDE_BODY_AIRCRAFT.has(cleanType);
};

const isHeavy = (f: Flight): boolean => {
    return f.acCategory === 'F' || getAircraftCategory(f.aircraftType) === 'F';
};

/**
 * Daytime long-stay filter:
 * Flights staying > 3.5 hours during daytime (06:00 - 23:00) MUST NOT monopolize contact bridges.
 * Exception: Overnight stays arriving after 22:00 and departing early morning (stay <= 9 hours).
 */
export const isDaytimeLongStay = (flight: Flight): boolean => {
    const durHours = getDurationMins(flight) / 60;
    if (durHours <= 3.5) return false;

    const arr = flight.scheduledArrival;
    const dep = flight.scheduledDeparture;
    const arrHour = arr.getHours();
    const depHour = dep.getHours();

    // Overnight exemption: arrives 22:00 - 02:00, departs 05:00 - 09:00, stay <= 9h
    const isPureNightStay = (arrHour >= 22 || arrHour <= 2) && (depHour >= 5 && depHour <= 9) && durHours <= 9.0;
    if (isPureNightStay) return false;

    return true;
};

/**
 * Strict GAMS Operational Gatekeeper:
 * Validates whether a stand complies with Domestic/International concourse routing,
 * turnaround duration limits, and MARS Center protection.
 */
export function isStandStrictlyAllowedForFlight(
    flight: Flight,
    stand: string,
    sched: StandSchedule
): boolean {
    const isBridge = isContactStand(stand);

    // 1. Daytime long stays (> 3.5 hours) can NEVER take a contact bridge!
    if (isBridge && isDaytimeLongStay(flight)) {
        return false;
    }

    // 2. Concourse Domestic / International Routing
    if (isBridge) {
        const allowedConcourses = getAllowedBridgeConcourses(flight);
        if (!allowedConcourses.includes(sched.concourse)) {
            return false;
        }
    }

    // 3. Strict MARS Center Rule: Narrowbodies (Cat C) cannot monopolize MARS Center stands!
    // They must use L or R sub-stands, leaving Center for Widebodies.
    if (sched.isMarsCenter && !isWide(flight)) {
        return false;
    }

    // 4. Code F (Heavy) can ONLY use Stand A2
    if (isHeavy(flight) && !isStandCatFCompatible(stand)) {
        return false;
    }

    return true;
}

/**
 * Autonomous Full Planning Engine:
 * Plans ALL flights in the selected date range from scratch using Gemini token-based reasoning
 * while strictly enforcing Istanbul Airport domestic/international separation and long-stay rules.
 */
export async function runAutonomousDeepPlanning(
    allFlights: Flight[],
    scopeStartDate: Date,
    scopeEndDate: Date,
    maintenanceBlocks?: MaintenanceBlock[],
    selectedModel?: string,
    onProgress?: (progress: DeepPlanProgress) => void
): Promise<DeepPlanResult> {
    const startTime = performance.now();
    const key = getStoredApiKey();
    if (!key || key.trim() === '') {
        throw new Error('Gemini API anahtarı bulunamadı. Lütfen üst menüdeki "🔑 API Key" butonundan anahtarınızı kaydedin.');
    }

    const preferredModel = selectedModel || getStoredModel();
    const fallbackList = ['gemini-flash-lite-latest', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
    const modelsToTry = [preferredModel, ...fallbackList.filter(m => m !== preferredModel)];

    // 1. Filter flights within scope
    const startMs = scopeStartDate.getTime();
    const endMs = scopeEndDate.getTime();

    const flightsInScope = allFlights.filter(f => {
        const arr = f.scheduledArrival.getTime();
        const dep = f.scheduledDeparture.getTime();
        return (arr >= startMs && arr <= endMs) || (dep >= startMs && dep <= endMs);
    });

    if (flightsInScope.length === 0) {
        throw new Error('Seçilen tarih aralığında planlanacak uçuş bulunamadı.');
    }

    // Sort chronologically by arrival
    flightsInScope.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());

    // 2. Initialize fresh Stand Topology
    const topology = buildStandTopology(maintenanceBlocks);

    // Populate intervals for flights OUTSIDE scope so they remain locked on their stands
    const outOfScopeFlights = allFlights.filter(f => !flightsInScope.some(s => s.id === f.id));
    outOfScopeFlights.forEach(f => {
        if (!f.parkingPosition) return;
        const sched = topology.get(f.parkingPosition);
        if (sched) {
            sched.intervals.push({
                start: f.scheduledArrival.getTime(),
                end: f.scheduledDeparture.getTime(),
                flightId: f.id
            });
        }
    });

    // 3. Partition flightsInScope into operational waves (e.g. 4-hour chunks)
    const waveDurationMs = 4 * 60 * 60 * 1000; // 4 hours
    const totalSpanMs = Math.max(waveDurationMs, endMs - startMs);
    const numWaves = Math.ceil(totalSpanMs / waveDurationMs);

    const waves: Flight[][] = [];
    for (let w = 0; w < numWaves; w++) {
        const wStart = startMs + w * waveDurationMs;
        const wEnd = wStart + waveDurationMs;
        const waveFlights = flightsInScope.filter(f => {
            const arr = f.scheduledArrival.getTime();
            return arr >= wStart && arr < wEnd;
        });
        if (waveFlights.length > 0) {
            waves.push(waveFlights);
        }
    }

    // Map to hold assigned positions: flightId -> stand
    const assignedStandMap = new Map<string, string>();
    let activeModelUsed = preferredModel;
    let allocatedTotal = 0;

    // 4. Process each wave sequentially
    for (let i = 0; i < waves.length; i++) {
        const waveFlights = waves[i];
        const wStart = new Date(Math.min(...waveFlights.map(f => f.scheduledArrival.getTime())));
        const wEnd = new Date(Math.max(...waveFlights.map(f => f.scheduledDeparture.getTime())));
        const timeRangeLabel = `${formatHHMM(wStart)} - ${formatHHMM(wEnd)}`;

        onProgress?.({
            currentWave: i + 1,
            totalWaves: waves.length,
            waveTimeRange: timeRangeLabel,
            percent: Math.round(((i) / waves.length) * 100),
            allocatedCount: allocatedTotal,
            totalFlightsInScope: flightsInScope.length,
            currentBridgeRate: allocatedTotal > 0 ? (Array.from(assignedStandMap.values()).filter(isContactStand).length / allocatedTotal) * 100 : 0,
            currentMessage: `Dalga ${i + 1}/${waves.length} (${timeRangeLabel}) için Gemini akıl yürütmesi ile kurallı planlama yapılıyor...`
        });

        // Separate non-passenger / cargo / props directly
        const commercialWaveFlights: Flight[] = [];
        for (const f of waveFlights) {
            if (isCargoFlight(f)) {
                // Assign to cargo / remote apron
                const cargoStands = ['C1', 'C2', 'C3', 'C4', 'C5', '901', '902', '903', '904', '801'];
                const assigned = cargoStands.find(s => {
                    const sched = topology.get(s);
                    return sched && canFitOnStand(sched, f.scheduledArrival.getTime(), f.scheduledDeparture.getTime(), isWide(f), topology, isHeavy(f));
                }) || 'REMOTE';
                assignedStandMap.set(f.id, assigned);
                const sSched = topology.get(assigned);
                if (sSched) placeOnStand(sSched, f.scheduledArrival.getTime(), f.scheduledDeparture.getTime(), f.id);
                allocatedTotal++;
            } else if (isPropellerAircraft(f.aircraftType)) {
                // Remote prop stands
                const propStands = ['601', '602', '603', '604', '701', '702', '703', '704'];
                const assigned = propStands.find(s => {
                    const sched = topology.get(s);
                    return sched && canFitOnStand(sched, f.scheduledArrival.getTime(), f.scheduledDeparture.getTime(), isWide(f), topology, isHeavy(f));
                }) || 'REMOTE';
                assignedStandMap.set(f.id, assigned);
                const pSched = topology.get(assigned);
                if (pSched) placeOnStand(pSched, f.scheduledArrival.getTime(), f.scheduledDeparture.getTime(), f.id);
                allocatedTotal++;
            } else {
                commercialWaveFlights.push(f);
            }
        }

        if (commercialWaveFlights.length > 0) {
            // Group available stands by domestic and international for Gemini
            const domesticContactStands: string[] = [];
            const intlContactStands: string[] = [];

            topology.forEach((sched, stand) => {
                if (!isContactStand(stand)) return;
                if (sched.concourse === 'Concourse G') {
                    domesticContactStands.push(stand);
                } else {
                    intlContactStands.push(stand);
                }
            });

            // Prepare prompt for Gemini with crystal-clear categorization
            const flightsPayload = commercialWaveFlights.map(f => {
                const isDomArr = f.type === 'turnaround' ? (f.arrivalIsDomestic ?? f.isDomestic) : f.isDomestic;
                const isDomDep = f.type === 'turnaround' ? (f.departureIsDomestic ?? f.isDomestic) : f.isDomestic;
                const flightTypeLabel = (isDomArr && isDomDep)
                    ? 'SAF_IC_HAT (Concourse G Only)'
                    : (!isDomArr && !isDomDep)
                    ? 'SAF_DIS_HAT (Concourse A,B,C,D,E,F Only)'
                    : 'KARMA (A-G Any Pier)';

                const durMins = Math.round(getDurationMins(f));
                const longStay = isDaytimeLongStay(f);

                return {
                    id: f.id,
                    callsign: getCallsign(f),
                    acType: f.aircraftType,
                    isWide: isWide(f),
                    isHeavy: isHeavy(f),
                    arr: formatHHMM(f.scheduledArrival),
                    dep: formatHHMM(f.scheduledDeparture),
                    durMins,
                    flightType: flightTypeLabel,
                    isDaytimeLongStay: longStay,
                    recommendedTarget: longStay ? 'REMOTE_APRON (Uzun Yatan - Körük Yasak)' : 'CONTACT_BRIDGE'
                };
            });

            const systemInstruction = `
Sen İstanbul Havalimanı (IST / LTFM) Baş Apron Dispeçerisin.
Görevin: Bu dalgada (${timeRangeLabel}) inen uçakları KESİN HAVALİMANI KURALLARINA göre sıfırdan stantlara atamak.

KATI KURALLAR (İHLAL EDİLEMEZ):
1. İÇ HAT / DIŞ HAT AYRIMI:
   - SAF_IC_HAT olan uçaklar SADECE Concourse G körüklerine (G stantları) veya açık aprona gidebilir. A, B, C, D, E, F iskelelerine ASLA verilemez!
   - SAF_DIS_HAT olan uçaklar SADECE Concourse A, B, C, D, E, F körüklerine veya açık aprona gidebilir. Concourse G'ye ASLA verilemez!
2. UZUN YATIŞ KURALI (GÜNDÜZ UZUN YATAN GENİŞ VE DAR GÖVDELER):
   - 'isDaytimeLongStay: true' olan (gündüz 3.5 saatten uzun yatan) uçaklar KESİNLİKLE KÖRÜĞE ALINAMAZ!
   - Bu uçaklar açık aprona (Stand 200-226, 300-315, 400+, 500+) gönderilmelidir. Körükler sadece 1 - 3 saatlik dönüş yapan uçaklara aittir!
3. GENİŞ GÖVDE (isWide: true) & MARS:
   - Geniş gövdeler sadece geniş gövde uyumlu körüklere (A, B, D iskeleleri) yanaşabilir.
   - Dar gövde uçaklar MARS Center pozisyonlarına verilemez; L veya R alt pozisyonlarına verilir.
4. CODE F (B748 / A380): SADECE Stand A2'ye yanaşabilir.
5. Uçaklar arasında en az 15 dakika tampon süre olmalıdır.

Yanıt Formatı: Yalnızca JSON nesnesi:
{
  "allocations": [
    { "id": "flightId", "stand": "StandNo" }
  ]
}
`;

            const userPrompt = `
UÇUŞ LİSTESİ (${flightsPayload.length} uçuş):
${JSON.stringify(flightsPayload, null, 2)}

MÜSAİT KÖRÜKLER ÖZETİ:
- İç Hat Körüpleri (Concourse G): ${domesticContactStands.slice(0, 25).join(', ')}
- Dış Hat Körükleri (Concourse A, B, D, F): ${intlContactStands.slice(0, 35).join(', ')}
- Açık Apron Pozisyonları: 201-226, 301-315, 401-412, 501-512, D18-D20

Lütfen kurallara harfiyen uyarak tüm uçuşlara uygun stant ata.
`;

            let waveRawJson = '';
            for (const modelToTry of modelsToTry) {
                try {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToTry}:generateContent?key=${encodeURIComponent(key)}`;
                    const payload = {
                        systemInstruction: { parts: [{ text: systemInstruction }] },
                        contents: [{ parts: [{ text: userPrompt }] }],
                        generationConfig: {
                            responseMimeType: 'application/json',
                            temperature: 0.1
                        }
                    };

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (response.ok) {
                        const data = await response.json();
                        waveRawJson = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                        activeModelUsed = modelToTry;
                        break;
                    }
                } catch {
                    // Try next fallback model
                }
            }

            // Parse Gemini's allocations
            let geminiAllocations: Array<{ id: string; stand: string }> = [];
            if (waveRawJson) {
                try {
                    const parsed = JSON.parse(waveRawJson);
                    geminiAllocations = parsed.allocations || [];
                } catch {
                    try {
                        const clean = waveRawJson.replace(/```json/g, '').replace(/```/g, '').trim();
                        geminiAllocations = JSON.parse(clean).allocations || [];
                    } catch {}
                }
            }

            const geminiMap = new Map<string, string>();
            geminiAllocations.forEach(a => {
                if (a.id && a.stand) geminiMap.set(a.id, String(a.stand).trim());
            });

            // ---------------------------------------------------------------
            // Placement with 100% Watertight Gatekeeper Rules
            // ---------------------------------------------------------------
            for (const flight of commercialWaveFlights) {
                const arrMs = flight.scheduledArrival.getTime();
                const depMs = flight.scheduledDeparture.getTime();
                const flightIsWide = isWide(flight);
                const flightIsHeavy = isHeavy(flight);

                let targetStand = geminiMap.get(flight.id);
                let placed = false;

                // 1. Try Gemini's proposal ONLY IF it passes strict operational rules
                if (targetStand && topology.has(targetStand)) {
                    const sched = topology.get(targetStand)!;
                    const passedRules = isStandStrictlyAllowedForFlight(flight, targetStand, sched);
                    const canFit = passedRules && canFitOnStand(sched, arrMs, depMs, flightIsWide, topology, flightIsHeavy);
                    const hasMaint = maintenanceBlocks && hasMaintenanceConflict(targetStand, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks);

                    if (canFit && !hasMaint) {
                        placeOnStand(sched, arrMs, depMs, flight.id);
                        assignedStandMap.set(flight.id, targetStand);
                        placed = true;
                    }
                }

                // 2. If Gemini's proposal failed rules, find the optimal valid stand automatically:
                if (!placed) {
                    const isLongStay = isDaytimeLongStay(flight);

                    // A) If turnaround and NOT long stay, search matching contact bridges first!
                    if (!isLongStay && isFlightBridgeEligible(flight)) {
                        const allowedConcourses = getAllowedBridgeConcourses(flight);

                        for (const concourse of allowedConcourses) {
                            const stands = CONCOURSE_LAYOUT[concourse] || [];
                            for (const stand of stands) {
                                const sched = topology.get(stand);
                                if (!sched || !isContactStand(stand)) continue;
                                if (!isStandStrictlyAllowedForFlight(flight, stand, sched)) continue;

                                if (canFitOnStand(sched, arrMs, depMs, flightIsWide, topology, flightIsHeavy)) {
                                    if (!maintenanceBlocks || !hasMaintenanceConflict(stand, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks)) {
                                        placeOnStand(sched, arrMs, depMs, flight.id);
                                        assignedStandMap.set(flight.id, stand);
                                        placed = true;
                                        break;
                                    }
                                }
                            }
                            if (placed) break;
                        }
                    }

                    // B) If long stay OR no bridge available, assign to compliant Remote Apron!
                    if (!placed) {
                        const remoteAprons = ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5', 'APRON 6', 'APRON 7'];
                        for (const apron of remoteAprons) {
                            const stands = CONCOURSE_LAYOUT[apron] || [];
                            for (const stand of stands) {
                                const sched = topology.get(stand);
                                if (!sched || isContactStand(stand)) continue;

                                if (canFitOnStand(sched, arrMs, depMs, flightIsWide, topology, flightIsHeavy)) {
                                    if (!maintenanceBlocks || !hasMaintenanceConflict(stand, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks)) {
                                        placeOnStand(sched, arrMs, depMs, flight.id);
                                        assignedStandMap.set(flight.id, stand);
                                        placed = true;
                                        break;
                                    }
                                }
                            }
                            if (placed) break;
                        }
                    }
                }

                allocatedTotal++;
            }
        }
    }

    // 5. Apply new stand assignments to dataset
    const updatedFlights = allFlights.map(f => {
        if (assignedStandMap.has(f.id)) {
            return {
                ...f,
                parkingPosition: assignedStandMap.get(f.id)!
            };
        }
        return f;
    });

    const executionTimeMs = Math.round(performance.now() - startTime);
    const finalStats = calculateBridgeUtilization(updatedFlights, scopeStartDate, scopeEndDate);

    onProgress?.({
        currentWave: waves.length,
        totalWaves: waves.length,
        waveTimeRange: 'Tamamlandı',
        percent: 100,
        allocatedCount: allocatedTotal,
        totalFlightsInScope: flightsInScope.length,
        currentBridgeRate: finalStats.bridgeRate,
        currentMessage: `AI Derin Planlama tamamlandı! Köprü Oranı: %${finalStats.bridgeRate.toFixed(1)}`
    });

    return {
        updatedFlights,
        stats: finalStats,
        totalAllocated: allocatedTotal,
        totalWaves: waves.length,
        executionTimeMs,
        modelUsed: activeModelUsed
    };
}
