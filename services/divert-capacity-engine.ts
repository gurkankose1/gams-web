import { Flight, MaintenanceBlock } from '../types.ts';
import { CONCOURSE_LAYOUT, PARKING_POSITIONS } from '../constants.ts';
import { 
    isStandWidebodyCompatible, 
    isStandCatFCompatible, 
    getMarsRelatedPositions, 
    isContactStand,
    getAircraftCategory
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

export interface PoolDemand {
    totalUnassigned: number;
    catCCount: number; // Havuzdaki dar gövdeler (A320, B738 vb.)
    catECount: number; // Havuzdaki geniş gövdeler (A330, B777 vb.)
    catFCount: number; // Havuzdaki heavy uçaklar (A380, B748)
    flightCallsigns: string[];
}

export interface ConcourseCapacityBreakdown {
    concourse: string;
    label: string;
    totalStands: number;
    grossFreeCatC: number;
    grossFreeCatE: number;
    grossFreeCatF: number;
    standaloneFreeCatE: number;
    marsFreeCatE: number;
    netFreeCatC: number;
    netFreeCatE: number;
}

export interface WindowCapacityResult {
    windowHours: number;
    windowLabel: string;
    windowEnd: Date;

    // 1. Atama Bekleyen Havuz İhtiyacı (Unassigned Scheduled Demand)
    poolDemand: PoolDemand;

    // 2. Fiziksel Brüt Boş Stand Sayıları
    grossCatCCount: number;
    grossCatECount: number;
    grossCatFCount: number;

    // 3. Standalone vs MARS Kırılımı (Kullanıcı Talebi: 4h, 8h, 12h standalone vs mars)
    standaloneFreeCatE: number; // Bağımsız geniş gövde stantları (D6-D17, B13-B17 vb.)
    marsFreeCatE: number;       // MARS Center pozisyonları (L/R altı olanlar)
    marsFreeSubStands: number;  // MARS Sub-stands (L ve R dar gövdeler)

    // 4. Max Uçak Senaryoları (Kullanıcı Talebi: Max WB vs Max NB senaryoları)
    maxNarrowBodyCapacity: number; // Tüm MARS'lar dar gövdeye ayrılırsa toplam brüt Cat C
    maxWideBodyCapacity: number;   // Standalone + MARS center tümü geniş gövdeye ayrılırsa toplam brüt Cat E/F

    // 5. Net Divert Kontenjanı (Brüt Boşluk - Havuzdaki Tarifeli Uçaklar)
    netDivertCatC: number; // Max NB senaryosunda havuz düşüldükten sonra net divert Cat C
    netDivertCatE: number; // Max WB senaryosunda havuz düşüldükten sonra net divert Cat E
    netDivertCatF: number; // Havuz düşüldükten sonra net Cat F

    // 6. Dengeli Operasyonel Senaryo (Standalone WB öncelikli, kalan dar gövdelere korunmuş)
    balancedCatEAllocated: number;
    balancedCatCAllocated: number;

    // 7. Concourse / Apron Bazlı Detay Kırılım (Kullanıcı Talebi: Apron 100, Apron 200, Concourse A..G)
    concourseBreakdown: ConcourseCapacityBreakdown[];

    // 8. Bölgesel Toplamlar
    bridgeStandCount: number;
    remoteStandCount: number;
    cargoStandCount: number;
    deicingStandCount: number;

    // 9. Müsait Stand Listesi
    availableStands: StandFreeSlot[];
}

export interface HourlyCapacityPoint {
    hourOffset: number; // 0, 1, 2, ... 12
    time: Date;
    freeCatC: number;
    freeCatE: number;
    freeCatF: number;
    standaloneFreeCatE: number;
    marsFreeCatE: number;
    totalFreeStands: number;
    status: 'OPTIMAL' | 'MODERATE' | 'CRITICAL';
}

export interface WhatIfRequest {
    catCCount: number;
    catECount: number;
    catFCount?: number;
    inboundDelayHours: number; // 0 = şimdi, 1 = 1 saat sonra
    dwellTimeHours: number;    // 4 saat vb.
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
        isStandalone: boolean;
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
        standaloneE: number;
        marsE: number;
    };
    totalPoolDemand: PoolDemand;
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

export function getConcourseFriendlyLabel(concourseName: string): string {
    if (concourseName === 'APRON 1') return 'Apron 1 (100\'ler - Uzak)';
    if (concourseName === 'APRON 2') return 'Apron 2 (200\'ler - Uzak)';
    if (concourseName === 'APRON 3') return 'Apron 3 (300\'ler - Uzak)';
    if (concourseName === 'APRON 4') return 'Apron 4 (400\'ler)';
    if (concourseName === 'APRON 5') return 'Apron 5 (500\'ler)';
    if (concourseName === 'CARGO APRON') return 'Kargo Apronu (K Stantları)';
    if (concourseName.includes('DEICING')) return 'De-icing Apronu (H Stantları)';
    if (concourseName.includes('THY')) return 'THY Teknik / Hangarlar';
    return concourseName; // Concourse A, B, C, D, E, F, G
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

// Check if a stand is occupied by a flight or maintenance at targetMs
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

    // 3. Overall Unassigned Pool Demand in entire dataset
    const unassignedFlightsAll = flights.filter(f => !f.parkingPosition && !f.gate);
    let totalPoolCatC = 0;
    let totalPoolCatE = 0;
    let totalPoolCatF = 0;
    const totalPoolCallsigns: string[] = [];

    unassignedFlightsAll.forEach(f => {
        const cat = getAircraftCategory(f.aircraftType);
        if (cat === 'F') totalPoolCatF++;
        else if (cat === 'E' || cat === 'D') totalPoolCatE++;
        else totalPoolCatC++;
        totalPoolCallsigns.push(f.arrivalFlightNumber || f.departureFlightNumber || f.id);
    });

    const totalPoolDemand: PoolDemand = {
        totalUnassigned: unassignedFlightsAll.length,
        catCCount: totalPoolCatC,
        catECount: totalPoolCatE,
        catFCount: totalPoolCatF,
        flightCallsigns: totalPoolCallsigns
    };

    // 4. Immediate (T=0) availability
    let immCatC = 0;
    let immCatE = 0;
    let immCatF = 0;
    let immStandaloneE = 0;
    let immMarsE = 0;

    allStands.forEach(stand => {
        if (isStandContinuouslyFree(stand, refMs, refMs + dwellMs, flights, maintenanceBlocks)) {
            const meta = standMetadata.get(stand)!;
            if (meta.maxCategory === 'F') {
                immCatF++;
                if (meta.isStandaloneWidebody) immStandaloneE++;
                else if (meta.isMarsCenter) immMarsE++;
            } else if (meta.maxCategory === 'E') {
                immCatE++;
                if (meta.isStandaloneWidebody) immStandaloneE++;
                else if (meta.isMarsCenter) immMarsE++;
            } else {
                immCatC++;
            }
        }
    });

    // 5. Windows Calculation: T+4, T+8, T+12, T+24
    const windowsToAnalyze = [4, 8, 12, 24];
    const windowsResult: Record<number, WindowCapacityResult> = {};

    windowsToAnalyze.forEach(wHours => {
        const windowEndMs = refMs + wHours * 60 * 60 * 1000;
        const availableStands: StandFreeSlot[] = [];

        // Unassigned flights demand within THIS specific window
        const poolInWindow = unassignedFlightsAll.filter(f => {
            const arr = f.scheduledArrival ? f.scheduledArrival.getTime() : (f.scheduledDeparture ? f.scheduledDeparture.getTime() - 60 * 60 * 1000 : 0);
            const dep = f.scheduledDeparture ? f.scheduledDeparture.getTime() : (f.scheduledArrival ? f.scheduledArrival.getTime() + 60 * 60 * 1000 : Infinity);
            return Math.max(refMs, arr) < Math.min(windowEndMs, dep);
        });

        let windowPoolCatC = 0;
        let windowPoolCatE = 0;
        let windowPoolCatF = 0;
        const windowPoolCallsigns: string[] = [];

        poolInWindow.forEach(f => {
            const cat = getAircraftCategory(f.aircraftType);
            if (cat === 'F') windowPoolCatF++;
            else if (cat === 'E' || cat === 'D') windowPoolCatE++;
            else windowPoolCatC++;
            windowPoolCallsigns.push(f.arrivalFlightNumber || f.departureFlightNumber || f.id);
        });

        const poolDemand: PoolDemand = {
            totalUnassigned: poolInWindow.length,
            catCCount: windowPoolCatC,
            catECount: windowPoolCatE,
            catFCount: windowPoolCatF,
            flightCallsigns: windowPoolCallsigns
        };

        // Check each stand if it has at least one dwellMs free contiguous block within [refMs, windowEndMs]
        allStands.forEach(stand => {
            const isFreeFromStart = isStandContinuouslyFree(stand, refMs, refMs + dwellMs, flights, maintenanceBlocks);
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

        // Categorize free stands
        const catFStands = availableStands.filter(s => s.maxCategory === 'F');
        const catEStands = availableStands.filter(s => s.maxCategory === 'E');
        const catCStands = availableStands.filter(s => s.maxCategory === 'C');

        // Standalone vs MARS counts for Widebody
        const standaloneE = catEStands.filter(s => s.isStandaloneWidebody);
        const marsCenterE = catEStands.filter(s => s.isMarsCenter);
        const marsSubStands = catCStands.filter(s => s.isMarsSubStand);

        // Maximum Tradeoff Scenarios:
        // 1) "Max WB" Scenario: Standalone WB + all MARS centers that are free
        const maxWB = catFStands.length + catEStands.length; // All eligible widebody stands

        // 2) "Max NB" Scenario: Dedicate all MARS to Narrowbody (L and R), plus pure Cat C stands
        // Standalone WB stands can also take Cat C if needed, but primarily count Cat C + Substands
        const maxNB = catCStands.length;

        // Net Divert Capacity (Gross minus unassigned pool demand)
        const netDivertF = Math.max(0, catFStands.length - poolDemand.catFCount);
        const netDivertE = Math.max(0, maxWB - poolDemand.catECount);
        const netDivertC = Math.max(0, maxNB - poolDemand.catCCount);

        // Balanced Allocation Simulation (Standalone first):
        const blockedSubStands = new Set<string>();
        marsCenterE.forEach(m => {
            const mars = getMarsRelatedPositions(m.stand);
            mars.subStands.forEach(sub => blockedSubStands.add(sub));
        });
        const balancedCatC = catCStands.filter(c => !blockedSubStands.has(c.stand)).length;

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

        // Concourse / Apron Level Detailed Breakdown (Apron 1, 2, 3, Concourse A..G etc.)
        const concourseBreakdown: ConcourseCapacityBreakdown[] = [];
        const concourseOrder = [
            'Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 
            'Concourse E', 'Concourse F', 'Concourse G',
            'APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5', 
            'CARGO APRON', 'DEICING 1 APRON', 'THY HANGAR1'
        ];

        // Gather all existing concourses in CONCOURSE_LAYOUT
        const allConcourses = Array.from(new Set([...concourseOrder, ...Object.keys(CONCOURSE_LAYOUT)]));

        allConcourses.forEach(cName => {
            const standsInC = CONCOURSE_LAYOUT[cName];
            if (!standsInC || standsInC.length === 0) return;

            const freeInC = availableStands.filter(s => s.concourse === cName);
            if (freeInC.length === 0) return; // Only show active concourses with at least 1 free stand or show relevant

            let cFreeC = 0;
            let cFreeE = 0;
            let cFreeF = 0;
            let cStandaloneE = 0;
            let cMarsE = 0;

            freeInC.forEach(s => {
                if (s.maxCategory === 'F') {
                    cFreeF++;
                    if (s.isStandaloneWidebody) cStandaloneE++;
                    else if (s.isMarsCenter) cMarsE++;
                } else if (s.maxCategory === 'E') {
                    cFreeE++;
                    if (s.isStandaloneWidebody) cStandaloneE++;
                    else if (s.isMarsCenter) cMarsE++;
                } else {
                    cFreeC++;
                }
            });

            concourseBreakdown.push({
                concourse: cName,
                label: getConcourseFriendlyLabel(cName),
                totalStands: standsInC.length,
                grossFreeCatC: cFreeC,
                grossFreeCatE: cFreeE,
                grossFreeCatF: cFreeF,
                standaloneFreeCatE: cStandaloneE,
                marsFreeCatE: cMarsE,
                netFreeCatC: cFreeC,
                netFreeCatE: cFreeE
            });
        });

        windowsResult[wHours] = {
            windowHours: wHours,
            windowLabel: `T + ${wHours} Saat`,
            windowEnd: new Date(windowEndMs),
            poolDemand,
            grossCatCCount: catCStands.length,
            grossCatECount: catEStands.length,
            grossCatFCount: catFStands.length,
            standaloneFreeCatE: standaloneE.length,
            marsFreeCatE: marsCenterE.length,
            marsFreeSubStands: marsSubStands.length,
            maxNarrowBodyCapacity: maxNB,
            maxWideBodyCapacity: maxWB,
            netDivertCatC: netDivertC,
            netDivertCatE: netDivertE,
            netDivertCatF: netDivertF,
            balancedCatEAllocated: catEStands.length,
            balancedCatCAllocated: balancedCatC,
            concourseBreakdown,
            bridgeStandCount: bridgeCount,
            remoteStandCount: remoteCount,
            cargoStandCount: cargoCount,
            deicingStandCount: deicingCount,
            availableStands
        };
    });

    // 6. Hourly Profile (12 hours) with Standalone vs MARS
    const hourlyProfile: HourlyCapacityPoint[] = [];
    for (let h = 0; h <= 12; h++) {
        const timePointMs = refMs + h * 60 * 60 * 1000;
        let cCount = 0;
        let eCount = 0;
        let fCount = 0;
        let standaloneE = 0;
        let marsE = 0;

        allStands.forEach(stand => {
            if (!isStandOccupiedAt(stand, timePointMs, flights, maintenanceBlocks)) {
                const meta = standMetadata.get(stand)!;
                if (meta.maxCategory === 'F') {
                    fCount++;
                    if (meta.isStandaloneWidebody) standaloneE++;
                    else if (meta.isMarsCenter) marsE++;
                } else if (meta.maxCategory === 'E') {
                    eCount++;
                    if (meta.isStandaloneWidebody) standaloneE++;
                    else if (meta.isMarsCenter) marsE++;
                } else {
                    cCount++;
                }
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
            standaloneFreeCatE: standaloneE,
            marsFreeCatE: marsE,
            totalFreeStands: total,
            status
        });
    }

    // 7. Generate Formal Executive Aviation Report
    const w4 = windowsResult[4];
    const w8 = windowsResult[8];
    const w12 = windowsResult[12];

    const concourseText = w4.concourseBreakdown.map(c => 
        `  • ${c.label.padEnd(28)}: ${c.grossFreeCatC} Dar Gövde (C) | ${c.grossFreeCatE} Geniş Gövde (E) [${c.standaloneFreeCatE} Standalone / ${c.marsFreeCatE} MARS]`
    ).join('\n');

    const generatedReportText = `======================================================================
🚨 HAVALİMANI DİNAMİK DİVERT & KRİZ KAPASİTE RAPORU (DAC-REPORT)
Referans Zaman: ${refTime.toLocaleString('tr-TR')}
Öngörülen Divert Yerde Kalış (Dwell Time): ${dwellTimeHours} Saat
======================================================================

1. ATAMA BEKLEYEN TARİFELİ UÇUŞ HAVUZU (T+4h İhtiyacı):
----------------------------------------------------------------------
• Toplam Havuzdaki Tarifeli Uçak : ${w4.poolDemand.totalUnassigned} Uçuş
  - Dar Gövde İhtiyacı (Cat C)   : ${w4.poolDemand.catCCount} Uçak
  - Geniş Gövde İhtiyacı (Cat E) : ${w4.poolDemand.catECount} Uçak
  - Heavy İhtiyacı (Cat F)       : ${w4.poolDemand.catFCount} Uçak
* Not: Bu uçaklar tarifeli operasyonun parçası olup, divert kapasitesinden 
  öncelikli olarak düşülerek NET kabul edilebilir kontenjan hesaplanmıştır.

2. ANLIK VE DİNAMİK NET DİVERT KAPASİTESİ:
----------------------------------------------------------------------
• [T + 4 SAAT DİLİMİ] (Kısa Vade):
  - NET Kabul Edilebilir Cat C (Dar Gövde) : ${w4.netDivertCatC} Uçak (Brüt: ${w4.maxNarrowBodyCapacity} - Havuz: ${w4.poolDemand.catCCount})
  - NET Kabul Edilebilir Cat E (Geniş Gövde): ${w4.netDivertCatE} Uçak (Brüt: ${w4.maxWideBodyCapacity} - Havuz: ${w4.poolDemand.catECount})
  - NET Kabul Edilebilir Cat F (Heavy)      : ${w4.netDivertCatF} Uçak
  - Stant Karakteristiği: ${w4.standaloneFreeCatE} Standalone WB | ${w4.marsFreeCatE} MARS WB | ${w4.marsFreeSubStands} MARS Alt Stand (L/R)
  - Bölge Dağılımı: ${w4.bridgeStandCount} Körük | ${w4.remoteStandCount} Açık Remote | ${w4.cargoStandCount} Kargo | ${w4.deicingStandCount} De-icing

• [T + 8 SAAT DİLİMİ] (Orta Vade / Yatı İhtimali):
  - NET Divert Cat C : ${w8.netDivertCatC} Uçak (Brüt: ${w8.maxNarrowBodyCapacity} - Havuz: ${w8.poolDemand.catCCount})
  - NET Divert Cat E : ${w8.netDivertCatE} Uçak (Brüt: ${w8.maxWideBodyCapacity} - Havuz: ${w8.poolDemand.catECount})
  - Stant Tipi: ${w8.standaloneFreeCatE} Standalone WB | ${w8.marsFreeCatE} MARS WB

• [T + 12 SAAT DİLİMİ] (Uzun Vade / Gece Toparlanması):
  - NET Divert Cat C : ${w12.netDivertCatC} Uçak (Brüt: ${w12.maxNarrowBodyCapacity} - Havuz: ${w12.poolDemand.catCCount})
  - NET Divert Cat E : ${w12.netDivertCatE} Uçak (Brüt: ${w12.maxWideBodyCapacity} - Havuz: ${w12.poolDemand.catECount})
  - Stant Tipi: ${w12.standaloneFreeCatE} Standalone WB | ${w12.marsFreeCatE} MARS WB

3. APRON / CONCOURSE BAZLI DETAYLI BOŞLUK DAĞILIMI (T+4 Saat):
----------------------------------------------------------------------
${concourseText}

4. STRATEJİK YÖNETİM TAVSİYESİ:
----------------------------------------------------------------------
* MAX NB Senaryosu: Tüm MARS stantları dar gövdeye ayrılırsa toplam ${w4.netDivertCatC} Cat C divert alınabilir.
* MAX WB Senaryosu: Tüm uygun pozisyonlar geniş gövdeye verilirse toplam ${w4.netDivertCatE} Cat E divert alınabilir.
* Geniş gövdeler öncelikle Standalone (${w4.standaloneFreeCatE} adet) stantlara verilirse dar gövde kapasitesi feda edilmez.
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
            catF: immCatF,
            standaloneE: immStandaloneE,
            marsE: immMarsE
        },
        totalPoolDemand,
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
        const candidates = PARKING_POSITIONS.filter(p => isStandCatFCompatible(p));
        candidates.sort((a, b) => {
            const aBridge = isContactStand(a) ? 1 : 0;
            const bBridge = isContactStand(b) ? 1 : 0;
            return aBridge - bBridge;
        });

        const chosen = candidates.find(p => checkSimulatedAvailable(p));
        if (chosen) {
            reserveStand(chosen);
            allocF++;
            const mars = getMarsRelatedPositions(chosen);
            proposedAllocations.push({
                flightCallsign: callsign,
                category: 'F',
                stand: chosen,
                concourse: getConcourseForStand(chosen),
                isBridge: isContactStand(chosen),
                isStandalone: !mars.hasSubStands,
                startTime: new Date(simStartMs),
                endTime: new Date(simEndMs)
            });
        } else {
            unaccommodated.push(callsign);
            bottleneckNotes.push(`Kategori F (A380/B748) için uygun boş stand bulunamadı.`);
        }
    }

    // 2. Allocate Cat E (Widebody) - Prioritize Standalone Widebody stands!
    let allocE = 0;
    for (let i = 1; i <= request.catECount; i++) {
        const callsign = `DIV-E${i}`;
        const allEStands = PARKING_POSITIONS.filter(p => isStandWidebodyCompatible(p));
        allEStands.sort((a, b) => {
            const aMars = getMarsRelatedPositions(a).hasSubStands ? 1 : 0;
            const bMars = getMarsRelatedPositions(b).hasSubStands ? 1 : 0;
            if (aMars !== bMars) return aMars - bMars; // Standalone first!
            const aBridge = isContactStand(a) ? 1 : 0;
            const bBridge = isContactStand(b) ? 1 : 0;
            return aBridge - bBridge; // Remote first
        });

        const chosen = allEStands.find(p => checkSimulatedAvailable(p));
        if (chosen) {
            reserveStand(chosen);
            allocE++;
            const mars = getMarsRelatedPositions(chosen);
            proposedAllocations.push({
                flightCallsign: callsign,
                category: 'E',
                stand: chosen,
                concourse: getConcourseForStand(chosen),
                isBridge: isContactStand(chosen),
                isStandalone: !mars.hasSubStands,
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
        const allCStands = PARKING_POSITIONS.filter(p => !isStandWidebodyCompatible(p) || p.endsWith('L') || p.endsWith('R'));
        allCStands.sort((a, b) => {
            const aBridge = isContactStand(a) ? 1 : 0;
            const bBridge = isContactStand(b) ? 1 : 0;
            return aBridge - bBridge;
        });

        let chosen = allCStands.find(p => checkSimulatedAvailable(p));
        if (!chosen) {
            chosen = PARKING_POSITIONS.find(p => checkSimulatedAvailable(p));
        }

        if (chosen) {
            reserveStand(chosen);
            allocC++;
            const mars = getMarsRelatedPositions(chosen);
            proposedAllocations.push({
                flightCallsign: callsign,
                category: 'C',
                stand: chosen,
                concourse: getConcourseForStand(chosen),
                isBridge: isContactStand(chosen),
                isStandalone: !mars.hasSubStands,
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
