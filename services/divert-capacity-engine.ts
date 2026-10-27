import { Flight, MaintenanceBlock } from '../types.ts';
import { CONCOURSE_LAYOUT, PARKING_POSITIONS } from '../constants.ts';
import { 
    isStandWidebodyCompatible, 
    isStandCatFCompatible, 
    getMarsRelatedPositions, 
    isContactStand 
} from './ams-rules.ts';

// ---------------------------------------------------------------------------
// 1. Types & Interfaces
// ---------------------------------------------------------------------------

export type DivertDwellTimeHours = 2 | 4 | 8 | 12;

export interface StandFreeSlot {
    stand: string;
    concourse: string;
    isBridge: boolean;
    maxCategory: 'C' | 'E' | 'F';
    freeStart: Date;
    freeEnd: Date;
    durationHours: number;
    isMarsCenter: boolean;
    isMarsSubStand: boolean;
    marsCenterStand?: string;
    isStandaloneWidebody: boolean;
}

export interface WindowCapacityResult {
    windowHours: number;
    windowLabel: string;
    windowEnd: Date;
    // Pure counts (independent)
    pureCatCCount: number;
    pureCatECount: number;
    catFCount: number;
    // Balanced realistic allocation (protecting Cat C by placing widebodies on standalone first)
    balancedCatEAllocated: number;
    balancedCatCAllocated: number;
    // Breakdown by zone
    bridgeStandCount: number;
    remoteStandCount: number;
    cargoStandCount: number;
    deicingStandCount: number;
    // Stand details
    availableStands: StandFreeSlot[];
}

export interface HourlyCapacityPoint {
    hourOffset: number; // 0, 1, 2, ... 12
    time: Date;
    freeCatC: number;
    freeCatE: number;
    freeCatF: number;
    totalFreeStands: number;
    status: 'OPTIMAL' | 'MODERATE' | 'CRITICAL';
}

export interface WhatIfRequest {
    catCCount: number;
    catECount: number;
    catFCount?: number;
    inboundDelayHours: number; // e.g. 0 = now, 1 = in 1 hour
    dwellTimeHours: number;    // e.g. 4 hours
}

export interface WhatIfSimulationResult {
    feasible: boolean;
    verdict: 'APPROVED' | 'PARTIAL' | 'REJECTED';
    summaryMessage: string;
    requestedCatC: number;
    allocatedCatC: number;
    requestedCatE: number;
    allocatedCatE: number;
    requestedCatF: number;
    allocatedCatF: number;
    proposedAllocations: {
        flightCallsign: string;
        category: 'C' | 'E' | 'F';
        stand: string;
        concourse: string;
        isBridge: boolean;
        startTime: Date;
        endTime: Date;
    }[];
    unaccommodatedFlights: string[];
    bottleneckNotes: string[];
}

export interface DivertAnalysisReport {
    referenceTime: Date;
    dwellTimeHours: number;
    windows: Record<number, WindowCapacityResult>; // 4, 8, 12, 24
    hourlyProfile: HourlyCapacityPoint[];
    allStandsSnapshot: StandFreeSlot[];
    immediateFreeCount: {
        catC: number;
        catE: number;
        catF: number;
    };
    generatedReportText: string;
}

// ---------------------------------------------------------------------------
// 2. Helper Functions
// ---------------------------------------------------------------------------

export function getConcourseForStand(stand: string): string {
    for (const [concourseName, standList] of Object.entries(CONCOURSE_LAYOUT)) {
        if (standList.includes(stand)) {
            return concourseName;
        }
    }
    return 'DİĞER';
}

export function isCargoStand(stand: string): boolean {
    return stand.startsWith('K') || getConcourseForStand(stand).toUpperCase().includes('CARGO');
}

export function isDeicingStand(stand: string): boolean {
    return stand.startsWith('H') || getConcourseForStand(stand).toUpperCase().includes('DEICING');
}

export function getStandMaxCategory(stand: string): 'C' | 'E' | 'F' {
    if (isStandCatFCompatible(stand)) return 'F';
    if (isStandWidebodyCompatible(stand)) return 'E';
    return 'C';
}

// Check if a stand is occupied by a flight or maintenance at a given timestamp
export function isStandOccupiedAt(
    stand: string,
    targetMs: number,
    flights: Flight[],
    maintenanceBlocks: MaintenanceBlock[],
    bufferMs = 15 * 60 * 1000 // 15 mins operational buffer
): boolean {
    // 1. Check direct flight assignments
    for (const f of flights) {
        if (f.parkingPosition === stand) {
            const arr = f.scheduledArrival ? f.scheduledArrival.getTime() - bufferMs : 0;
            const dep = f.scheduledDeparture ? f.scheduledDeparture.getTime() + bufferMs : Infinity;
            if (targetMs >= arr && targetMs <= dep) {
                return true;
            }
        }
    }

    // 2. Check maintenance blocks
    for (const mb of maintenanceBlocks) {
        if (mb.parkingPosition === stand) {
            const start = mb.startTime ? mb.startTime.getTime() : 0;
            const end = mb.endTime ? mb.endTime.getTime() : Infinity;
            if (targetMs >= start && targetMs <= end) {
                return true;
            }
        }
    }

    // 3. Check MARS conflict
    const mars = getMarsRelatedPositions(stand);
    if (mars.isSubStand) {
        // If this is a sub-stand (e.g. A3L), center stand (A3) must not be occupied
        for (const f of flights) {
            if (f.parkingPosition === mars.center) {
                const arr = f.scheduledArrival ? f.scheduledArrival.getTime() - bufferMs : 0;
                const dep = f.scheduledDeparture ? f.scheduledDeparture.getTime() + bufferMs : Infinity;
                if (targetMs >= arr && targetMs <= dep) {
                    return true;
                }
            }
        }
        for (const mb of maintenanceBlocks) {
            if (mb.parkingPosition === mars.center) {
                const start = mb.startTime ? mb.startTime.getTime() : 0;
                const end = mb.endTime ? mb.endTime.getTime() : Infinity;
                if (targetMs >= start && targetMs <= end) {
                    return true;
                }
            }
        }
    } else if (mars.hasSubStands) {
        // If this is a MARS center stand (e.g. A3), neither center nor sub-stands (A3L, A3R) can be occupied
        for (const sub of mars.subStands) {
            for (const f of flights) {
                if (f.parkingPosition === sub) {
                    const arr = f.scheduledArrival ? f.scheduledArrival.getTime() - bufferMs : 0;
                    const dep = f.scheduledDeparture ? f.scheduledDeparture.getTime() + bufferMs : Infinity;
                    if (targetMs >= arr && targetMs <= dep) {
                        return true;
                    }
                }
            }
            for (const mb of maintenanceBlocks) {
                if (mb.parkingPosition === sub) {
                    const start = mb.startTime ? mb.startTime.getTime() : 0;
                    const end = mb.endTime ? mb.endTime.getTime() : Infinity;
                    if (targetMs >= start && targetMs <= end) {
                        return true;
                    }
                }
            }
        }
    }

    return false;
}

// Check if a stand is continuously free across [startMs, endMs]
export function isStandContinuouslyFree(
    stand: string,
    startMs: number,
    endMs: number,
    flights: Flight[],
    maintenanceBlocks: MaintenanceBlock[],
    bufferMs = 15 * 60 * 1000
): boolean {
    // Quick interval overlap check against all flights on this stand or related MARS stands
    const relevantStands = new Set<string>([stand]);
    const mars = getMarsRelatedPositions(stand);
    if (mars.isSubStand) {
        relevantStands.add(mars.center);
    } else if (mars.hasSubStands) {
        mars.subStands.forEach(s => relevantStands.add(s));
    }

    for (const f of flights) {
        if (f.parkingPosition && relevantStands.has(f.parkingPosition)) {
            const arr = f.scheduledArrival ? f.scheduledArrival.getTime() - bufferMs : 0;
            const dep = f.scheduledDeparture ? f.scheduledDeparture.getTime() + bufferMs : Infinity;
            // Overlap condition: max(startMs, arr) < min(endMs, dep)
            if (Math.max(startMs, arr) < Math.min(endMs, dep)) {
                return false;
            }
        }
    }

    for (const mb of maintenanceBlocks) {
        if (mb.parkingPosition && relevantStands.has(mb.parkingPosition)) {
            const mbStart = mb.startTime ? mb.startTime.getTime() : 0;
            const mbEnd = mb.endTime ? mb.endTime.getTime() : Infinity;
            if (Math.max(startMs, mbStart) < Math.min(endMs, mbEnd)) {
                return false;
            }
        }
    }

    return true;
}

// ---------------------------------------------------------------------------
// 3. Main Engine: Dynamic Divert Capacity Calculation
// ---------------------------------------------------------------------------

export function calculateDivertCapacity(
    flights: Flight[],
    maintenanceBlocks: MaintenanceBlock[],
    options?: {
        referenceTime?: Date;
        dwellTimeHours?: DivertDwellTimeHours;
    }
): DivertAnalysisReport {
    // 1. Reference time determination
    let refTime = options?.referenceTime;
    if (!refTime) {
        // If flights are loaded, default to the earliest flight or current day
        if (flights.length > 0) {
            const firstDep = flights.find(f => f.scheduledDeparture && !isNaN(f.scheduledDeparture.getTime()));
            if (firstDep && firstDep.scheduledDeparture) {
                refTime = new Date(firstDep.scheduledDeparture);
                refTime.setMinutes(0, 0, 0);
            } else {
                refTime = new Date();
            }
        } else {
            refTime = new Date();
        }
    }

    const dwellTimeHours = options?.dwellTimeHours || 4;
    const dwellMs = dwellTimeHours * 60 * 60 * 1000;
    const refMs = refTime.getTime();

    // 2. Stand classification cache
    const allStands = PARKING_POSITIONS;
    const standMetadata = new Map<string, {
        concourse: string;
        isBridge: boolean;
        maxCategory: 'C' | 'E' | 'F';
        isMarsCenter: boolean;
        isMarsSubStand: boolean;
        marsCenter?: string;
        isStandaloneWidebody: boolean;
        isCargo: boolean;
        isDeicing: boolean;
    }>();

    allStands.forEach(stand => {
        const concourse = getConcourseForStand(stand);
        const isBridge = isContactStand(stand);
        const maxCategory = getStandMaxCategory(stand);
        const mars = getMarsRelatedPositions(stand);
        const isStandaloneWb = (maxCategory === 'E' || maxCategory === 'F') && !mars.hasSubStands;
        const isCargo = isCargoStand(stand);
        const isDeicing = isDeicingStand(stand);

        standMetadata.set(stand, {
            concourse,
            isBridge,
            maxCategory,
            isMarsCenter: mars.hasSubStands,
            isMarsSubStand: mars.isSubStand,
            marsCenter: mars.isSubStand ? mars.center : undefined,
            isStandaloneWidebody: isStandaloneWb,
            isCargo,
            isDeicing
        });
    });

    // 3. Immediate (T=0) availability
    let immCatC = 0;
    let immCatE = 0;
    let immCatF = 0;

    allStands.forEach(stand => {
        if (isStandContinuouslyFree(stand, refMs, refMs + dwellMs, flights, maintenanceBlocks)) {
            const meta = standMetadata.get(stand)!;
            if (meta.maxCategory === 'F') immCatF++;
            else if (meta.maxCategory === 'E') immCatE++;
            else immCatC++;
        }
    });

    // 4. Windows Calculation: T+4, T+8, T+12, T+24
    const windowsToAnalyze = [4, 8, 12, 24];
    const windowsResult: Record<number, WindowCapacityResult> = {};

    windowsToAnalyze.forEach(wHours => {
        const windowEndMs = refMs + wHours * 60 * 60 * 1000;
        const availableStands: StandFreeSlot[] = [];

        // Check each stand if it has at least one dwellMs free contiguous block within [refMs, windowEndMs]
        allStands.forEach(stand => {
            // Test if free starting at refMs
            const isFreeFromStart = isStandContinuouslyFree(stand, refMs, refMs + dwellMs, flights, maintenanceBlocks);
            
            // Or if free anytime in window
            let foundFree = isFreeFromStart;
            let freeStartMs = refMs;
            let freeEndMs = refMs + dwellMs;

            if (!foundFree) {
                // Scan in 30-min steps
                for (let t = refMs + 30 * 60 * 1000; t + dwellMs <= windowEndMs; t += 30 * 60 * 1000) {
                    if (isStandContinuouslyFree(stand, t, t + dwellMs, flights, maintenanceBlocks)) {
                        foundFree = true;
                        freeStartMs = t;
                        freeEndMs = t + dwellMs;
                        break;
                    }
                }
            }

            if (foundFree) {
                const meta = standMetadata.get(stand)!;
                availableStands.push({
                    stand,
                    concourse: meta.concourse,
                    isBridge: meta.isBridge,
                    maxCategory: meta.maxCategory,
                    freeStart: new Date(freeStartMs),
                    freeEnd: new Date(freeEndMs),
                    durationHours: dwellTimeHours,
                    isMarsCenter: meta.isMarsCenter,
                    isMarsSubStand: meta.isMarsSubStand,
                    marsCenterStand: meta.marsCenter,
                    isStandaloneWidebody: meta.isStandaloneWidebody,
                });
            }
        });

        // Calculate Pure & Balanced Capacity
        // In pure Cat C: Count all Cat C stands + (MARS substands L & R) + standalone
        const catFStands = availableStands.filter(s => s.maxCategory === 'F');
        const catEStands = availableStands.filter(s => s.maxCategory === 'E');
        const catCStands = availableStands.filter(s => s.maxCategory === 'C');

        // Balanced Allocation Simulation:
        // Prioritize Standalone Widebody stands for Cat E so MARS L/R sub-stands are saved for Cat C!
        const standaloneE = catEStands.filter(s => s.isStandaloneWidebody);
        const marsCenterE = catEStands.filter(s => s.isMarsCenter);

        // When a MARS Center stand is used, its L and R cannot be used
        const blockedSubStands = new Set<string>();
        marsCenterE.forEach(m => {
            const mars = getMarsRelatedPositions(m.stand);
            mars.subStands.forEach(sub => blockedSubStands.add(sub));
        });

        const effectiveCatC = catCStands.filter(c => !blockedSubStands.has(c.stand)).length;

        // Zone counts
        let bridgeCount = 0;
        let remoteCount = 0;
        let cargoCount = 0;
        let deicingCount = 0;

        availableStands.forEach(s => {
            if (s.isBridge) bridgeCount++;
            else if (isCargoStand(s.stand)) cargoCount++;
            else if (isDeicingStand(s.stand)) deicingCount++;
            else remoteCount++;
        });

        windowsResult[wHours] = {
            windowHours: wHours,
            windowLabel: `T + ${wHours} Saat`,
            windowEnd: new Date(windowEndMs),
            pureCatCCount: catCStands.length,
            pureCatECount: catEStands.length,
            catFCount: catFStands.length,
            balancedCatEAllocated: catEStands.length,
            balancedCatCAllocated: effectiveCatC,
            bridgeStandCount: bridgeCount,
            remoteStandCount: remoteCount,
            cargoStandCount: cargoCount,
            deicingStandCount: deicingCount,
            availableStands
        };
    });

    // 5. Hourly Profile (12 hours)
    const hourlyProfile: HourlyCapacityPoint[] = [];
    for (let h = 0; h <= 12; h++) {
        const timePointMs = refMs + h * 60 * 60 * 1000;
        let cCount = 0;
        let eCount = 0;
        let fCount = 0;

        allStands.forEach(stand => {
            if (!isStandOccupiedAt(stand, timePointMs, flights, maintenanceBlocks)) {
                const meta = standMetadata.get(stand)!;
                if (meta.maxCategory === 'F') fCount++;
                else if (meta.maxCategory === 'E') eCount++;
                else cCount++;
            }
        });

        const total = cCount + eCount + fCount;
        let status: 'OPTIMAL' | 'MODERATE' | 'CRITICAL' = 'OPTIMAL';
        if (total < 10) status = 'CRITICAL';
        else if (total < 25) status = 'MODERATE';

        hourlyProfile.push({
            hourOffset: h,
            time: new Date(timePointMs),
            freeCatC: cCount,
            freeCatE: eCount,
            freeCatF: fCount,
            totalFreeStands: total,
            status
        });
    }

    // 6. Generate Formal Text Report
    const w4 = windowsResult[4];
    const w8 = windowsResult[8];
    const w12 = windowsResult[12];

    const generatedReportText = `======================================================================
🚨 HAVALİMANI DİNAMİK DİVERT & KRİZ KAPASİTE RAPORU (DAC-REPORT)
Referans Zaman: ${refTime.toLocaleString('tr-TR')}
Öngörülen Divert Yerde Kalış (Dwell Time): ${dwellTimeHours} Saat
======================================================================

1. ANLIK VE DİNAMİK KAPASİTE MATRİSİ:
----------------------------------------------------------------------
• [T + 4 SAAT DİLİMİ] (Kısa Vade):
  - Kategori C (Dar Gövde - A320/B738) : ${w4.pureCatCCount} Boş Stand (MARS Dengelemeli: ${w4.balancedCatCAllocated})
  - Kategori D/E (Geniş Gövde - A330/B777): ${w4.pureCatECount} Boş Stand
  - Kategori F (Heavy / Süper - A380/B748): ${w4.catFCount} Boş Stand
  - Bölge Dağılımı: ${w4.bridgeStandCount} Körük | ${w4.remoteStandCount} Açık Remote | ${w4.cargoStandCount} Kargo | ${w4.deicingStandCount} De-icing

• [T + 8 SAAT DİLİMİ] (Orta Vade / Yatı İhtimali):
  - Kategori C (Dar Gövde) : ${w8.pureCatCCount} Stand (Dengelemeli: ${w8.balancedCatCAllocated})
  - Kategori D/E (Geniş Gövde): ${w8.pureCatECount} Stand
  - Kategori F (Heavy)       : ${w8.catFCount} Stand

• [T + 12 SAAT DİLİMİ] (Uzun Vade / Gece Toparlanması):
  - Kategori C (Dar Gövde) : ${w12.pureCatCCount} Stand (Dengelemeli: ${w12.balancedCatCAllocated})
  - Kategori D/E (Geniş Gövde): ${w12.pureCatECount} Stand
  - Kategori F (Heavy)       : ${w12.catFCount} Stand

2. OPERASYONEL TAVSİYELER & MARS YÖNETİMİ:
----------------------------------------------------------------------
* Geniş gövde divert taleplerinde öncelikle Concourse D (D6-D17) ve Concourse B (B13-B17) 
  standalone stantları kullanılmalıdır; bu sayede MARS ikiz alt stantları dar gövdelere korunur.
* Yolcusu indirilmeyen (sadece yakıt ikmali yapacak) divert uçaklar için Açık Apron 1 ve 2
  önceliklendirilmeli, terminal körükleri tarifeli uçuşlara ayrılmalıdır.
======================================================================`;

    return {
        referenceTime: refTime,
        dwellTimeHours,
        windows: windowsResult,
        hourlyProfile,
        allStandsSnapshot: windowsResult[4].availableStands,
        immediateFreeCount: {
            catC: immCatC,
            catE: immCatE,
            catF: immCatF
        },
        generatedReportText
    };
}

// ---------------------------------------------------------------------------
// 4. What-If Scenario Simulator
// ---------------------------------------------------------------------------

export function runWhatIfSimulation(
    flights: Flight[],
    maintenanceBlocks: MaintenanceBlock[],
    request: WhatIfRequest,
    referenceTime: Date
): WhatIfSimulationResult {
    const simStartMs = referenceTime.getTime() + request.inboundDelayHours * 60 * 60 * 1000;
    const simEndMs = simStartMs + request.dwellTimeHours * 60 * 60 * 1000;

    const proposedAllocations: WhatIfSimulationResult['proposedAllocations'] = [];
    const unaccommodated: string[] = [];
    const bottleneckNotes: string[] = [];

    // Track simulated occupied stands
    const simulatedOccupiedStands = new Set<string>();

    const checkSimulatedAvailable = (stand: string): boolean => {
        if (simulatedOccupiedStands.has(stand)) return false;

        // Check MARS
        const mars = getMarsRelatedPositions(stand);
        if (mars.isSubStand && simulatedOccupiedStands.has(mars.center)) return false;
        if (mars.hasSubStands) {
            for (const sub of mars.subStands) {
                if (simulatedOccupiedStands.has(sub)) return false;
            }
        }

        // Check real base plan
        return isStandContinuouslyFree(stand, simStartMs, simEndMs, flights, maintenanceBlocks);
    };

    const reserveStand = (stand: string) => {
        simulatedOccupiedStands.add(stand);
        const mars = getMarsRelatedPositions(stand);
        if (mars.isSubStand) {
            simulatedOccupiedStands.add(mars.center);
        } else if (mars.hasSubStands) {
            mars.subStands.forEach(sub => simulatedOccupiedStands.add(sub));
        }
    };

    // 1. Allocate Cat F if requested
    const reqF = request.catFCount || 0;
    let allocF = 0;
    for (let i = 1; i <= reqF; i++) {
        const callsign = `DIV-F${i}`;
        // Prioritize Remote/Cargo Cat F, then Contact Cat F
        const candidates = PARKING_POSITIONS.filter(p => isStandCatFCompatible(p));
        // Sort: remote first
        candidates.sort((a, b) => {
            const aBridge = isContactStand(a) ? 1 : 0;
            const bBridge = isContactStand(b) ? 1 : 0;
            return aBridge - bBridge;
        });

        const chosen = candidates.find(p => checkSimulatedAvailable(p));
        if (chosen) {
            reserveStand(chosen);
            allocF++;
            proposedAllocations.push({
                flightCallsign: callsign,
                category: 'F',
                stand: chosen,
                concourse: getConcourseForStand(chosen),
                isBridge: isContactStand(chosen),
                startTime: new Date(simStartMs),
                endTime: new Date(simEndMs)
            });
        } else {
            unaccommodated.push(callsign);
            bottleneckNotes.push(`Kategori F (A380/B748) için uygun boş stand bulunamadı.`);
        }
    }

    // 2. Allocate Cat E (Widebody)
    let allocE = 0;
    for (let i = 1; i <= request.catECount; i++) {
        const callsign = `DIV-E${i}`;
        // Prioritize Standalone Widebody stands first!
        const allEStands = PARKING_POSITIONS.filter(p => isStandWidebodyCompatible(p));
        allEStands.sort((a, b) => {
            const aMars = getMarsRelatedPositions(a).hasSubStands ? 1 : 0;
            const bMars = getMarsRelatedPositions(b).hasSubStands ? 1 : 0;
            if (aMars !== bMars) return aMars - bMars; // Standalone first
            const aBridge = isContactStand(a) ? 1 : 0;
            const bBridge = isContactStand(b) ? 1 : 0;
            return aBridge - bBridge; // Remote first
        });

        const chosen = allEStands.find(p => checkSimulatedAvailable(p));
        if (chosen) {
            reserveStand(chosen);
            allocE++;
            proposedAllocations.push({
                flightCallsign: callsign,
                category: 'E',
                stand: chosen,
                concourse: getConcourseForStand(chosen),
                isBridge: isContactStand(chosen),
                startTime: new Date(simStartMs),
                endTime: new Date(simEndMs)
            });
        } else {
            unaccommodated.push(callsign);
            bottleneckNotes.push(`Kategori D/E (Geniş Gövde) divert için yeterli boş pozisyon yok.`);
        }
    }

    // 3. Allocate Cat C (Narrowbody)
    let allocC = 0;
    for (let i = 1; i <= request.catCCount; i++) {
        const callsign = `DIV-C${i}`;
        // Prioritize Remote stands first, avoid burning standalone widebody stands
        const allCStands = PARKING_POSITIONS.filter(p => !isStandWidebodyCompatible(p) || p.endsWith('L') || p.endsWith('R'));
        allCStands.sort((a, b) => {
            const aBridge = isContactStand(a) ? 1 : 0;
            const bBridge = isContactStand(b) ? 1 : 0;
            return aBridge - bBridge;
        });

        let chosen = allCStands.find(p => checkSimulatedAvailable(p));
        // Fallback to any available stand
        if (!chosen) {
            chosen = PARKING_POSITIONS.find(p => checkSimulatedAvailable(p));
        }

        if (chosen) {
            reserveStand(chosen);
            allocC++;
            proposedAllocations.push({
                flightCallsign: callsign,
                category: 'C',
                stand: chosen,
                concourse: getConcourseForStand(chosen),
                isBridge: isContactStand(chosen),
                startTime: new Date(simStartMs),
                endTime: new Date(simEndMs)
            });
        } else {
            unaccommodated.push(callsign);
            bottleneckNotes.push(`Kategori C (Dar Gövde) divert için yeterli pozisyon tükendi.`);
        }
    }

    const totalRequested = request.catCCount + request.catECount + reqF;
    const totalAllocated = allocC + allocE + allocF;

    let verdict: WhatIfSimulationResult['verdict'] = 'APPROVED';
    if (totalAllocated === 0 && totalRequested > 0) {
        verdict = 'REJECTED';
    } else if (totalAllocated < totalRequested) {
        verdict = 'PARTIAL';
    }

    let summaryMessage = '';
    if (verdict === 'APPROVED') {
        summaryMessage = `✅ TÜM DİVERT TALEBİ KABUL EDİLEBİLİR: Talep edilen ${request.catCCount} Cat C, ${request.catECount} Cat E${reqF > 0 ? `, ${reqF} Cat F` : ''} uçak tarifeli planı bozmadan başarıyla stantlara atanabilir.`;
    } else if (verdict === 'PARTIAL') {
        summaryMessage = `⚠️ KISMİ KABUL (KONTENJAN SINIRDA): Talep edilen ${totalRequested} uçağın sadece ${totalAllocated} tanesine yer bulundu. (${allocC}/${request.catCCount} Cat C, ${allocE}/${request.catECount} Cat E).`;
    } else {
        summaryMessage = `⛔ DİVERT KABUL EDİLEMEZ (MEYDAN DOYGUN): Seçilen ${request.dwellTimeHours} saatlik kalış süresi boyunca uygun stant bulunmamaktadır. Başka meydana yönlendirilmelidir.`;
    }

    return {
        feasible: verdict === 'APPROVED',
        verdict,
        summaryMessage,
        requestedCatC: request.catCCount,
        allocatedCatC: allocC,
        requestedCatE: request.catECount,
        allocatedCatE: allocE,
        requestedCatF: reqF,
        allocatedCatF: allocF,
        proposedAllocations,
        unaccommodatedFlights: unaccommodated,
        bottleneckNotes
    };
}
