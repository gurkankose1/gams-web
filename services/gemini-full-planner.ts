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
 * Autonomous Full Planning Engine:
 * Plans ALL flights in the selected date range from scratch using Gemini token-based reasoning.
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
            currentMessage: `Dalga ${i + 1}/${waves.length} (${timeRangeLabel}) için Gemini slot planlaması hesaplanıyor...`
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
            // Find contact stands that currently have availability in this wave window
            const availableStandsInfo: Array<{ stand: string; concourse: string; wideFit: boolean }> = [];
            topology.forEach((sched, stand) => {
                if (!isContactStand(stand)) return;
                // Check if stand has any gap >= 45 mins in this wave window
                availableStandsInfo.push({
                    stand,
                    concourse: sched.concourse,
                    wideFit: sched.isWideCompatible
                });
            });

            // Prepare prompt for Gemini
            const flightsPayload = commercialWaveFlights.map(f => ({
                id: f.id,
                callsign: getCallsign(f),
                acType: f.aircraftType,
                isWide: isWide(f),
                isHeavy: isHeavy(f),
                arr: formatHHMM(f.scheduledArrival),
                dep: formatHHMM(f.scheduledDeparture),
                durMins: Math.round(getDurationMins(f)),
                isDomestic: Boolean((f.arrivalIsDomestic ?? f.isDomestic) && (f.departureIsDomestic ?? f.isDomestic))
            }));

            const systemInstruction = `
Sen İstanbul Havalimanı (IST) Baş Apron Dispeçerisin.
Görevin: Bu dalgada (${timeRangeLabel}) inen ticari yolcu uçaklarını SIFIRDAN KÖRÜKLERE (Bridge/Contact Stands) ve AÇIK APRON POZİSYONLARINA ATAMAK.

TEMEL KURALLAR:
1. AMAÇ: Köprü kullanım oranını (% Bridge Rate) maksimize et.
2. Geniş gövdeleri (isWide: true) sadece wideFit: true olan körüklere ata (İskele A, B, D).
3. Code F (Heavy) uçaklar SADECE Stand A2'ye yanaşabilir.
4. İç Hat (isDomestic: true) uçuşları SADECE G İskelesi (Concourse G) körüklerine gidebilir. Dış hatlar A, B, D, F iskelelerine gider.
5. Gündüz 4 saatten uzun yatan (durMins > 240) uçakları köprü yerine açık aprona (Stand 200+, 300+, 400+) yönlendir ki köprüler boş kalıp kısa dönüşlü uçakları alabilsin.
6. Uçaklar arasında en az 15 dakika tampon süre olmalıdır. Aynı stanta çakışan saatlerde iki uçak verme!

Yanıt Formatı: Yalnızca JSON nesnesi ver:
{
  "allocations": [
    { "id": "flightId", "stand": "StandNo (örn: 201, A3, 204C, A2, 212)" }
  ]
}
`;

            const userPrompt = `
UÇUŞ LİSTESİ (${flightsPayload.length} uçuş):
${JSON.stringify(flightsPayload, null, 2)}

MÜSAİT KÖRÜK STANDLARI ÖZETİ:
${JSON.stringify(availableStandsInfo.slice(0, 50), null, 2)}

Lütfen tüm uçuşları kurallara ve kısıtlara uygun olarak sıfırdan stantlara ata.
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
                    // Clean markdown if present
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

            // Place flights: First try Gemini's proposed stand. If invalid/overlap, find best available valid stand
            for (const flight of commercialWaveFlights) {
                const arrMs = flight.scheduledArrival.getTime();
                const depMs = flight.scheduledDeparture.getTime();
                const flightIsWide = isWide(flight);
                const flightIsHeavy = isHeavy(flight);

                let targetStand = geminiMap.get(flight.id);
                let placed = false;

                if (targetStand && topology.has(targetStand)) {
                    const sched = topology.get(targetStand)!;
                    const canFit = canFitOnStand(sched, arrMs, depMs, flightIsWide, topology, flightIsHeavy);
                    const hasMaint = maintenanceBlocks && hasMaintenanceConflict(targetStand, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks);

                    if (canFit && !hasMaint) {
                        placeOnStand(sched, arrMs, depMs, flight.id);
                        assignedStandMap.set(flight.id, targetStand);
                        placed = true;
                    }
                }

                // If Gemini's stand had conflict or was not given, find best compatible bridge or remote stand
                if (!placed) {
                    // Try contact stands first (Bridge priority)
                    for (const [stand, sched] of topology.entries()) {
                        if (!isContactStand(stand)) continue;
                        if (canFitOnStand(sched, arrMs, depMs, flightIsWide, topology, flightIsHeavy)) {
                            if (!maintenanceBlocks || !hasMaintenanceConflict(stand, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks)) {
                                placeOnStand(sched, arrMs, depMs, flight.id);
                                assignedStandMap.set(flight.id, stand);
                                placed = true;
                                break;
                            }
                        }
                    }

                    // If no contact stand fit, assign to compatible remote apron
                    if (!placed) {
                        for (const [stand, sched] of topology.entries()) {
                            if (isContactStand(stand)) continue;
                            if (canFitOnStand(sched, arrMs, depMs, flightIsWide, topology, flightIsHeavy)) {
                                if (!maintenanceBlocks || !hasMaintenanceConflict(stand, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks)) {
                                    placeOnStand(sched, arrMs, depMs, flight.id);
                                    assignedStandMap.set(flight.id, stand);
                                    placed = true;
                                    break;
                                }
                            }
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
