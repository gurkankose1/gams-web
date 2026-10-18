import { Flight } from '../types.ts';
import { CONCOURSE_LAYOUT, TURKISH_DOMESTIC_AIRPORTS } from '../constants.ts';
import { 
    isCargoFlight, 
    isPropellerAircraft, 
    getAircraftCategory, 
    isContactStand,
    CAT_F_HEAVY_STANDS 
} from './ams-rules.ts';

export interface BridgeUtilizationStats {
    totalFlights: number;
    eligibleFlightsCount: number;
    bridgeAssignedCount: number;
    remoteAssignedCount: number;
    unassignedCount: number;
    cargoCount: number;
    gaCount: number;
    propCount: number;
    noAcCount: number;
    bridgeRate: number; // e.g. 84.5%
}

// ---------------------------------------------------------------------------
// 1. Flight Modes and Category Classification (Official OCC Table)
// ---------------------------------------------------------------------------

export const FLIGHT_MODE_DESCRIPTIONS: Record<string, { desc: string; category: 'PAX' | 'CARGO' | 'GA' | 'SPECIAL' | 'MAINTENANCE' }> = {
    'A': { desc: 'Additional Flight PAX/CGO/MAIL', category: 'PAX' },
    'B': { desc: 'Additional PAX - Shuttle Mode', category: 'PAX' },
    'C': { desc: 'Charter Passenger only', category: 'PAX' },
    'D': { desc: 'General Aviation', category: 'GA' },
    'E': { desc: 'Special (FAA / Government)', category: 'SPECIAL' },
    'F': { desc: 'Scheduled CGO/Mail', category: 'CARGO' },
    'G': { desc: 'Additional Flights PAX Normal', category: 'PAX' },
    'H': { desc: 'Charter CGO and/or Mail', category: 'CARGO' },
    'I': { desc: 'Ambulance Flight', category: 'SPECIAL' },
    'J': { desc: 'Scheduled PAX Normal Service', category: 'PAX' },
    'K': { desc: 'Training (School/Crew Check)', category: 'MAINTENANCE' },
    'L': { desc: 'Charter PAX and CGO/MAIL', category: 'PAX' },
    'M': { desc: 'Mail only', category: 'CARGO' },
    'N': { desc: 'Business Aviation/Air Taxi', category: 'GA' },
    'O': { desc: 'Charter with Special Handling', category: 'PAX' },
    'P': { desc: 'Non Revenue Flt. (Positioning/Ferry/Delivery)', category: 'MAINTENANCE' },
    'Q': { desc: 'Scheduled PAX/CGO in Cabin', category: 'PAX' },
    'R': { desc: 'Additional PAX/CGO in Cabin', category: 'PAX' },
    'S': { desc: 'Scheduled PAX - Shuttle Mode', category: 'PAX' },
    'T': { desc: 'Technical Test', category: 'MAINTENANCE' },
    'U': { desc: 'Passenger by Surface Vehicle', category: 'SPECIAL' },
    'V': { desc: 'CGO/Mail by Surface Vehicle', category: 'CARGO' },
    'W': { desc: 'Military', category: 'SPECIAL' },
    'X': { desc: 'Technical Stop', category: 'SPECIAL' },
    'Y': { desc: 'Transit (Sadece hava tarafi)', category: 'PAX' },
    'Z': { desc: 'Maintenance', category: 'MAINTENANCE' },
};

export const PASSENGER_MODES = new Set(['J', 'C', 'G', 'A', 'B', 'L', 'O', 'Q', 'R', 'S', 'Y']);
export const CARGO_MODES = new Set(['F', 'H', 'M', 'V']);
export const GENERAL_AVIATION_MODES = new Set(['D', 'N']);
export const SPECIAL_MAINTENANCE_MODES = new Set(['E', 'I', 'K', 'P', 'T', 'W', 'X', 'Z', 'U']);

export function isNoAcFlight(f: Flight): boolean {
    if (f.isTransparent) return true;
    if (!f.aircraftType || f.aircraftType.trim() === '' || f.aircraftType.toUpperCase() === 'NAN' || f.aircraftType.toUpperCase() === 'NULL') {
        return true;
    }
    const cat = f.acCategory ? f.acCategory.trim().toUpperCase() : '';
    if (cat === 'NAN' || cat === 'NULL') return true;
    return false;
}

export function isGeneralAviationFlight(f: Flight): boolean {
    const mode = (f.trafficMode || f.departureMode || '').toUpperCase().trim();
    if (GENERAL_AVIATION_MODES.has(mode)) return true;
    const arrNo = (f.arrivalFlightNumber || '').toUpperCase().trim();
    const depNo = (f.departureFlightNumber || '').toUpperCase().trim();
    const airline = (f.airline || '').toUpperCase().trim();
    if (arrNo.startsWith('ZZ') || depNo.startsWith('ZZ') || airline.startsWith('ZZ')) return true;
    return false;
}

export function isCargoModeFlight(f: Flight): boolean {
    const mode = (f.trafficMode || f.departureMode || '').toUpperCase().trim();
    if (CARGO_MODES.has(mode)) return true;
    return isCargoFlight(f);
}

export function isSpecialOrMaintenanceFlight(f: Flight): boolean {
    const mode = (f.trafficMode || f.departureMode || '').toUpperCase().trim();
    return SPECIAL_MAINTENANCE_MODES.has(mode);
}

export function isPassengerFlight(f: Flight): boolean {
    if (isCargoModeFlight(f)) return false;
    if (isGeneralAviationFlight(f)) return false;
    if (isSpecialOrMaintenanceFlight(f)) return false;
    const mode = (f.trafficMode || f.departureMode || '').toUpperCase().trim();
    if (mode && !PASSENGER_MODES.has(mode)) return false;
    return true;
}

export function isFlightBridgeEligible(f: Flight): boolean {
    // 1. Missing / Unassigned A/C -> Excluded
    if (isNoAcFlight(f)) return false;

    // 2. Cargo flight (F, H, M, V) -> Excluded
    if (isCargoModeFlight(f)) return false;

    // 3. General Aviation (D, N, ZZ) -> Excluded
    if (isGeneralAviationFlight(f)) return false;

    // 4. Special / Maintenance / Ferry (E, W, P, X, Z) -> Excluded
    if (isSpecialOrMaintenanceFlight(f)) return false;

    // 5. Must be a Passenger flight (J, C, G, A, B, L, O, Q, R, S, Y)
    if (!isPassengerFlight(f)) return false;

    // 6. Propeller / Turboprop (ATR72, DH8D etc.) -> Excluded
    if (isPropellerAircraft(f.aircraftType)) return false;

    // 7. Heavy Cat F without bridge access
    const cat = f.acCategory || getAircraftCategory(f.aircraftType);
    if (cat === 'F') return false;

    return true;
}

export function calculateBridgeUtilization(
    flights: Flight[],
    startDate?: Date,
    endDate?: Date
): BridgeUtilizationStats {
    let eligibleCount = 0;
    let bridgeAssigned = 0;
    let remoteAssigned = 0;
    let unassigned = 0;
    let cargoCount = 0;
    let gaCount = 0;
    let propCount = 0;
    let noAcCount = 0;
    let consideredFlightsCount = 0;

    const startMs = startDate ? startDate.getTime() : 0;
    const endMs = endDate ? endDate.getTime() : Infinity;

    flights.forEach(f => {
        // Sadece seçili tarih aralığında giden uçuşlar (ATD / scheduledDeparture referans alınır)
        const depMs = f.scheduledDeparture ? f.scheduledDeparture.getTime() : 0;
        if (depMs < startMs || depMs > endMs) {
            return; // Seçili tarih aralığı dışındaki uçuşlar hesaba dahil edilmez
        }

        consideredFlightsCount++;

        if (isNoAcFlight(f)) {
            noAcCount++;
            unassigned++;
            return;
        }

        const isCargo = f.trafficMode === 'F' || f.departureMode === 'F' || isCargoFlight(f);
        if (isCargo) {
            cargoCount++;
            return;
        }

        if (isGeneralAviationFlight(f)) {
            gaCount++;
            return;
        }

        if (isPropellerAircraft(f.aircraftType)) {
            propCount++;
            return;
        }

        const cat = f.acCategory || getAircraftCategory(f.aircraftType);
        if (cat === 'F') {
            return;
        }

        // Eligible Passenger Flight (Sadece köprüye alınabilir yolcu uçuşları)
        eligibleCount++;
        if (f.parkingPosition) {
            if (isContactStand(f.parkingPosition)) {
                bridgeAssigned++;
            } else {
                remoteAssigned++;
            }
        } else {
            unassigned++;
        }
    });

    const bridgeRate = eligibleCount > 0 ? (bridgeAssigned / eligibleCount) * 100 : 0;

    return {
        totalFlights: consideredFlightsCount,
        eligibleFlightsCount: eligibleCount,
        bridgeAssignedCount: bridgeAssigned,
        remoteAssignedCount: remoteAssigned,
        unassignedCount: unassigned,
        cargoCount,
        gaCount,
        propCount,
        noAcCount,
        bridgeRate: Math.round(bridgeRate * 10) / 10
    };
}

// ---------------------------------------------------------------------------
// 2. Concourse & Pier Restrictions (Domestic vs International Destination)
// ---------------------------------------------------------------------------

export function getAllowedBridgeConcourses(f: Flight): string[] {
    const isArrDom = f.type === 'turnaround' ? (f.arrivalIsDomestic ?? f.isDomestic) : f.isDomestic;
    const isDepDom = f.type === 'turnaround' ? (f.departureIsDomestic ?? f.isDomestic) : f.isDomestic;

    if (isArrDom && isDepDom) {
        // İç - İç: Sadece Concourse G
        return ['Concourse G'];
    } else if (!isArrDom && !isDepDom) {
        // Dış - Dış: Sadece Concourse A, B, C, D, E, F
        return ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F'];
    } else {
        // İç - Dış veya Dış - İç: Tüm pierler serbest
        return ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F', 'Concourse G'];
    }
}

// ---------------------------------------------------------------------------
// 3. Stand Categorization and MARS Topology
// ---------------------------------------------------------------------------

interface StandSchedule {
    stand: string;
    concourse: string;
    isMarsCenter: boolean;
    isMarsSub: boolean;
    marsCenterStand?: string;
    marsSubStands?: string[];
    isWideCompatible: boolean;
    intervals: { start: number; end: number; flightId: string }[];
}

function buildStandTopology(): Map<string, StandSchedule> {
    const topology = new Map<string, StandSchedule>();

    // Step 1: Detect all MARS relations
    const allStandsWithConcourse: { stand: string; concourse: string }[] = [];
    Object.entries(CONCOURSE_LAYOUT).forEach(([concourse, stands]) => {
        stands.forEach(stand => allStandsWithConcourse.push({ stand, concourse }));
    });

    const marsSubsByCenter = new Map<string, string[]>();
    allStandsWithConcourse.forEach(({ stand }) => {
        if (stand.endsWith('L') || stand.endsWith('R')) {
            const center = stand.slice(0, -1);
            if (!marsSubsByCenter.has(center)) {
                marsSubsByCenter.set(center, []);
            }
            marsSubsByCenter.get(center)!.push(stand);
        }
    });

    // Step 2: Populate StandSchedule
    allStandsWithConcourse.forEach(({ stand, concourse }) => {
        const isMarsSub = stand.endsWith('L') || stand.endsWith('R');
        const center = isMarsSub ? stand.slice(0, -1) : undefined;
        const isMarsCenter = marsSubsByCenter.has(stand);
        const subs = isMarsCenter ? marsSubsByCenter.get(stand) : undefined;

        // Widebody compatibility: center stands or non-MARS contact stands in Concourse D, etc.
        const isContact = isContactStand(stand);
        let isWideCompatible = false;
        if (isMarsCenter) {
            isWideCompatible = true;
        } else if (!isMarsSub) {
            if (concourse === 'Concourse D' || concourse === 'Concourse C' || concourse === 'Concourse E') {
                isWideCompatible = true;
            } else if (!isContact) {
                // Remote open stands: center stands or single positions
                isWideCompatible = true;
            }
        }

        topology.set(stand, {
            stand,
            concourse,
            isMarsCenter,
            isMarsSub,
            marsCenterStand: center,
            marsSubStands: subs,
            isWideCompatible,
            intervals: []
        });
    });

    return topology;
}

function canFitOnStand(
    schedule: StandSchedule,
    arrMs: number,
    depMs: number,
    isWide: boolean,
    topology: Map<string, StandSchedule>
): boolean {
    // 1. Physical compatibility
    if (isWide && schedule.isMarsSub) return false;
    if (isWide && !schedule.isWideCompatible) return false;

    // 2. Direct overlap on this stand (buffer = 0)
    for (const item of schedule.intervals) {
        if (arrMs < item.end && depMs > item.start) {
            return false;
        }
    }

    // 3. MARS conflict checking
    if (schedule.isMarsSub && schedule.marsCenterStand) {
        const centerSched = topology.get(schedule.marsCenterStand);
        if (centerSched) {
            for (const item of centerSched.intervals) {
                if (arrMs < item.end && depMs > item.start) {
                    return false;
                }
            }
        }
    } else if (schedule.isMarsCenter && schedule.marsSubStands) {
        for (const subName of schedule.marsSubStands) {
            const subSched = topology.get(subName);
            if (subSched) {
                for (const item of subSched.intervals) {
                    if (arrMs < item.end && depMs > item.start) {
                        return false;
                    }
                }
            }
        }
    }

    return true;
}

function placeOnStand(schedule: StandSchedule, arrMs: number, depMs: number, flightId: string) {
    schedule.intervals.push({ start: arrMs, end: depMs, flightId });
}

// ---------------------------------------------------------------------------
// 4. Main Scenario 1 AI Allocation Engine
// ---------------------------------------------------------------------------

export interface AiAllocationResult {
    flights: Flight[];
    stats: BridgeUtilizationStats;
}

export function runAiBridgeAllocation(
    allFlights: Flight[],
    startDate?: Date,
    endDate?: Date
): AiAllocationResult {
    const topology = buildStandTopology();
    const flightUpdates = new Map<string, string | null>();

    // 1. Identify and categorize flights
    const eligibleFlights: Flight[] = [];
    const cargoFlights: Flight[] = [];
    const gaFlights: Flight[] = [];
    const propFlights: Flight[] = [];
    const noAcFlights: Flight[] = [];

    allFlights.forEach(f => {
        if (isNoAcFlight(f)) {
            noAcFlights.push(f);
            flightUpdates.set(f.id, null); // Keep in pool!
        } else if (f.trafficMode === 'F' || f.departureMode === 'F' || isCargoFlight(f)) {
            cargoFlights.push(f);
        } else if (isGeneralAviationFlight(f)) {
            gaFlights.push(f);
        } else if (isPropellerAircraft(f.aircraftType)) {
            propFlights.push(f);
        } else {
            eligibleFlights.push(f);
        }
    });

    // 2. Sort eligible flights:
    // Narrowbodies have highest priority to maximize MARS sub-stands and contact stands.
    // Shorter turnarounds packed first to maximize total flights per stand.
    const isFlightWide = (f: Flight): boolean => {
        const cat = f.acCategory ? f.acCategory.toUpperCase().trim() : getAircraftCategory(f.aircraftType);
        return cat === 'E' || cat === 'D' || cat === 'F';
    };

    const getDurationMins = (f: Flight): number => {
        return Math.max(30, (f.scheduledDeparture.getTime() - f.scheduledArrival.getTime()) / (60 * 1000));
    };

    const narrowEligible = eligibleFlights.filter(f => !isFlightWide(f));
    const wideEligible = eligibleFlights.filter(f => isFlightWide(f));

    // Sort: arrival time primary, shorter duration secondary
    narrowEligible.sort((a, b) => {
        const diffArr = a.scheduledArrival.getTime() - b.scheduledArrival.getTime();
        if (diffArr !== 0) return diffArr;
        return getDurationMins(a) - getDurationMins(b);
    });

    wideEligible.sort((a, b) => {
        // For widebodies, short ground times (turnaround < 3 hours) are prioritized for bridge.
        const diffDur = getDurationMins(a) - getDurationMins(b);
        if (Math.abs(diffDur) > 60) return diffDur;
        return a.scheduledArrival.getTime() - b.scheduledArrival.getTime();
    });

    // -----------------------------------------------------------------------
    // Pass A: Narrowbody Flights -> Prefer MARS sub-stands (L/R) & single contact stands
    // -----------------------------------------------------------------------
    const overflowToRemote: Flight[] = [];

    narrowEligible.forEach(flight => {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const allowedConc = getAllowedBridgeConcourses(flight);

        // Sub-stands first (to leave single/center stands open for wide or others)
        let placed = false;
        const subStands: StandSchedule[] = [];
        const singleContactStands: StandSchedule[] = [];

        allowedConc.forEach(c => {
            const stands = CONCOURSE_LAYOUT[c] || [];
            stands.forEach(s => {
                const sched = topology.get(s);
                if (sched) {
                    if (sched.isMarsSub) subStands.push(sched);
                    else if (!sched.isMarsCenter) singleContactStands.push(sched);
                }
            });
        });

        // 1. Try Sub-stands
        for (const sched of subStands) {
            if (canFitOnStand(sched, arrMs, depMs, false, topology)) {
                placeOnStand(sched, arrMs, depMs, flight.id);
                flightUpdates.set(flight.id, sched.stand);
                placed = true;
                break;
            }
        }

        // 2. Try single non-MARS contact stands
        if (!placed) {
            for (const sched of singleContactStands) {
                if (canFitOnStand(sched, arrMs, depMs, false, topology)) {
                    placeOnStand(sched, arrMs, depMs, flight.id);
                    flightUpdates.set(flight.id, sched.stand);
                    placed = true;
                    break;
                }
            }
        }

        if (!placed) {
            overflowToRemote.push(flight);
        }
    });

    // -----------------------------------------------------------------------
    // Pass B: Widebody Flights -> Non-MARS contact stands & MARS center stands
    // -----------------------------------------------------------------------
    wideEligible.forEach(flight => {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const durationMins = getDurationMins(flight);
        const allowedConc = getAllowedBridgeConcourses(flight);

        // Long stay widebodies (> 4 hours) should not tie up critical bridge gates
        // unless there is abundant space.
        const candidateStands: StandSchedule[] = [];

        // Single contact stands (e.g. Concourse D)
        allowedConc.forEach(c => {
            const stands = CONCOURSE_LAYOUT[c] || [];
            stands.forEach(s => {
                const sched = topology.get(s);
                if (sched && sched.isWideCompatible && !sched.isMarsSub && !sched.isMarsCenter) {
                    candidateStands.push(sched);
                }
            });
        });

        // Center MARS stands
        allowedConc.forEach(c => {
            const stands = CONCOURSE_LAYOUT[c] || [];
            stands.forEach(s => {
                const sched = topology.get(s);
                if (sched && sched.isMarsCenter) {
                    candidateStands.push(sched);
                }
            });
        });

        let placed = false;
        for (const sched of candidateStands) {
            if (canFitOnStand(sched, arrMs, depMs, true, topology)) {
                placeOnStand(sched, arrMs, depMs, flight.id);
                flightUpdates.set(flight.id, sched.stand);
                placed = true;
                break;
            }
        }

        if (!placed) {
            overflowToRemote.push(flight);
        }
    });

    // -----------------------------------------------------------------------
    // Pass C: Overflow Passenger Flights & Propellers -> Open Aprons (100, 200, 300)
    // -----------------------------------------------------------------------
    const remotePassengerFlights = [...overflowToRemote, ...propFlights];
    remotePassengerFlights.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());

    const openAprons = ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5', 'APRON 6', 'APRON 7'];

    remotePassengerFlights.forEach(flight => {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const isWide = isFlightWide(flight);

        let placed = false;
        for (const apronName of openAprons) {
            const stands = CONCOURSE_LAYOUT[apronName] || [];
            for (const s of stands) {
                const sched = topology.get(s);
                if (sched && canFitOnStand(sched, arrMs, depMs, isWide, topology)) {
                    placeOnStand(sched, arrMs, depMs, flight.id);
                    flightUpdates.set(flight.id, sched.stand);
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }

        if (!placed) {
            // Keep in pool if completely out of apron space
            flightUpdates.set(flight.id, null);
        }
    });

    // -----------------------------------------------------------------------
    // Pass D: Cargo Flights -> CARGO APRON (K stands)
    // -----------------------------------------------------------------------
    cargoFlights.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());
    const cargoStands = CONCOURSE_LAYOUT['CARGO APRON'] || [];

    cargoFlights.forEach(flight => {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const isWide = isFlightWide(flight);

        let placed = false;
        for (const s of cargoStands) {
            const sched = topology.get(s);
            if (sched && canFitOnStand(sched, arrMs, depMs, isWide, topology)) {
                placeOnStand(sched, arrMs, depMs, flight.id);
                flightUpdates.set(flight.id, sched.stand);
                placed = true;
                break;
            }
        }
        if (!placed) flightUpdates.set(flight.id, null);
    });

    // -----------------------------------------------------------------------
    // Pass E: General Aviation Flights (including ZZ flights) -> APRON 6 & H Aprons
    // -----------------------------------------------------------------------
    gaFlights.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());
    const gaAprons = ['APRON 6', 'DEICING 4 APRON', 'DEICING 2 APRON', 'DEICING 3 APRON', 'DEICING 5 APRON', 'MOTOR TEST AREA'];

    gaFlights.forEach(flight => {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();

        let placed = false;
        for (const apronName of gaAprons) {
            const stands = CONCOURSE_LAYOUT[apronName] || [];
            for (const s of stands) {
                const sched = topology.get(s);
                if (sched && canFitOnStand(sched, arrMs, depMs, false, topology)) {
                    placeOnStand(sched, arrMs, depMs, flight.id);
                    flightUpdates.set(flight.id, sched.stand);
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }
        if (!placed) flightUpdates.set(flight.id, null);
    });

    // -----------------------------------------------------------------------
    // Result Assembly
    // -----------------------------------------------------------------------
    const updatedFlights: Flight[] = allFlights.map(f => {
        const newPos = flightUpdates.get(f.id) !== undefined ? flightUpdates.get(f.id)! : f.parkingPosition;
        return {
            ...f,
            parkingPosition: newPos
        };
    });

    const stats = calculateBridgeUtilization(updatedFlights, startDate, endDate);

    return {
        flights: updatedFlights,
        stats
    };
}
