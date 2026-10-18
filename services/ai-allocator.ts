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

    // 7. Heavy Cat F without bridge access:
    // Cargo Cat F (e.g. B748) is already excluded above by isCargoModeFlight.
    // Passenger Cat F flights (e.g. Emirates EK123/124 A388) have bridge access via Stand A2.
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

    // Single arrival flight: arrival destination determines terminal pier
    if (f.type === 'arrival') {
        return isArrDom
            ? ['Concourse G']
            : ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F'];
    }

    // Turnaround and departure flights:
    // IST bridge gate boarding is governed by the departure leg destination:
    // - Domestic departure (İç-İç or Dış-İç): Boards at Domestic Pier G only.
    // - International departure (Dış-Dış or İç-Dış): Boards at International Piers (A, B, C, D, E, F). Pier G is strictly forbidden!
    if (isDepDom) {
        return ['Concourse G'];
    } else {
        return ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F'];
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

        // Widebody compatibility:
        // - MARS Center stands: Widebody compatible
        // - Concourse D: D6-D17 & single wide contact stands: Widebody compatible
        // - Concourse C (C1-C4), Concourse E (E1-E4), and D1-D5: Strictly Narrowbody (Cat C) only! ZERO widebody allowed!
        // - MARS sub-stands (L/R) & B2, F2: Strictly Narrowbody (Cat C) only!
        const isContact = isContactStand(stand);
        const isNarrowOnlyContact = concourse === 'Concourse C' || concourse === 'Concourse E' || stand === 'B2' || stand === 'F2' || ['D1', 'D2', 'D3', 'D4', 'D5'].includes(stand);
        let isWideCompatible = false;
        if (isMarsCenter) {
            isWideCompatible = true;
        } else if (!isMarsSub && !isNarrowOnlyContact) {
            if (concourse === 'Concourse D') {
                isWideCompatible = !['D1', 'D2', 'D3', 'D4', 'D5'].includes(stand);
            } else if (stand === 'A9' || stand === 'B4' || (stand.startsWith('B') && parseInt(stand.slice(1)) >= 13 && parseInt(stand.slice(1)) <= 17) || (stand.startsWith('F') && parseInt(stand.slice(1)) >= 14 && parseInt(stand.slice(1)) <= 19)) {
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
    topology: Map<string, StandSchedule>,
    isHeavy: boolean = false
): boolean {
    // 1. Physical compatibility
    if (isWide && schedule.isMarsSub) return false;
    if (isWide && !schedule.isWideCompatible) return false;
    if (isHeavy) {
        const baseStand = schedule.stand.replace(/[LR]$/, '');
        if (!CAT_F_HEAVY_STANDS.has(baseStand) && !CAT_F_HEAVY_STANDS.has(schedule.stand)) {
            return false;
        }
    }

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

export interface SwapDetail {
    stand: string;
    concourse: string;
    removedFlight: {
        id: string;
        callsign: string;
        acType: string;
        durationHours: number;
    };
    sentToRemote: string;
    gainedFlights: {
        id: string;
        callsign: string;
        acType: string;
        stand: string;
    }[];
    netGain: number;
}

export interface AiAllocationResult {
    flights: Flight[];
    stats: BridgeUtilizationStats;
    swapDetails: SwapDetail[];
    totalSwapsPerformed: number;
    netFlightsGained: number;
    gapFillsPerformed: number;
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
        if (f.acCategory === 'E' || f.acCategory === 'D' || f.acCategory === 'F') return true;
        const cat = getAircraftCategory(f.aircraftType);
        return cat === 'E' || cat === 'D' || cat === 'F';
    };

    const isFlightHeavy = (f: Flight): boolean => {
        if (f.acCategory === 'F') return true;
        return getAircraftCategory(f.aircraftType) === 'F';
    };

    const getDurationMins = (f: Flight): number => {
        return Math.max(30, (f.scheduledDeparture.getTime() - f.scheduledArrival.getTime()) / (60 * 1000));
    };

    // Daytime long-stay threshold:
    // Flights staying > 3.5 hours during daytime (06:00 - 23:00) must not monopolize bridge gates
    const isDaytimeLongStay = (flight: Flight): boolean => {
        const durHours = getDurationMins(flight) / 60;
        if (durHours <= 3.5) return false;

        const arr = flight.scheduledArrival;
        const dep = flight.scheduledDeparture;
        const arrHour = arr.getHours();
        const depHour = dep.getHours();

        // Overnight stay exemption: Arrives late (22:00 - 02:00) and departs early morning (05:00 - 09:00) and stay <= 9h
        const isPureNightStay = (arrHour >= 22 || arrHour <= 2) && (depHour >= 5 && depHour <= 9) && durHours <= 9.0;
        if (isPureNightStay) return false;

        return true;
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

    // Helper: Dynamic Concourse Occupancy Ratio at time window [arrMs, depMs]
    const getConcourseLoad = (concourse: string, arrMs: number, depMs: number): number => {
        const stands = CONCOURSE_LAYOUT[concourse] || [];
        if (stands.length === 0) return 1.0;
        let occupied = 0;
        for (const s of stands) {
            const sched = topology.get(s);
            if (sched && sched.intervals.some(item => arrMs < item.end && depMs > item.start)) {
                occupied++;
            }
        }
        return occupied / stands.length;
    };

    // -----------------------------------------------------------------------
    // Pass A: Narrowbody Flights -> C/E Prioritization & Dynamic Concourse Load Balancing
    // -----------------------------------------------------------------------
    const overflowToRemote: Flight[] = [];
    const daytimeLongStayNarrow: Flight[] = [];

    narrowEligible.forEach(flight => {
        // Very long stay narrowbodies (> 4.5h daytime) deferred to remote so they don't block turnarounds
        if (isDaytimeLongStay(flight) && getDurationMins(flight) / 60 > 4.5) {
            daytimeLongStayNarrow.push(flight);
            return;
        }

        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const allowedConc = getAllowedBridgeConcourses(flight);

        let placed = false;

        // Step 1: Priority for Dedicated Cat C Contact Stands (C1-C4, E1-E4, D1-D5, B2, F2)
        // These stands CANNOT take widebody aircraft under any circumstances.
        // Using them first prevents widebody MARS centers from being blocked!
        const dedicatedNarrowStands: StandSchedule[] = [];
        const allowedDedicatedConcourses = ['Concourse C', 'Concourse E'].filter(c => allowedConc.includes(c));
        if (allowedDedicatedConcourses.length > 0) {
            // Balance between C and E based on current load
            allowedDedicatedConcourses.sort((c1, c2) => getConcourseLoad(c1, arrMs, depMs) - getConcourseLoad(c2, arrMs, depMs));
            for (const c of allowedDedicatedConcourses) {
                for (const s of (CONCOURSE_LAYOUT[c] || [])) {
                    const sched = topology.get(s);
                    if (sched) dedicatedNarrowStands.push(sched);
                }
            }
        }
        // D1 through D5 in Concourse D are strictly narrowbody only!
        if (allowedConc.includes('Concourse D')) {
            for (const s of ['D1', 'D2', 'D3', 'D4', 'D5']) {
                const sched = topology.get(s);
                if (sched) dedicatedNarrowStands.push(sched);
            }
        }
        // Also B2 and F2 if in allowed concourses
        for (const s of ['B2', 'F2']) {
            const conc = s.startsWith('B') ? 'Concourse B' : 'Concourse F';
            if (allowedConc.includes(conc)) {
                const sched = topology.get(s);
                if (sched) dedicatedNarrowStands.push(sched);
            }
        }

        for (const sched of dedicatedNarrowStands) {
            if (canFitOnStand(sched, arrMs, depMs, false, topology)) {
                placeOnStand(sched, arrMs, depMs, flight.id);
                flightUpdates.set(flight.id, sched.stand);
                placed = true;
                break;
            }
        }

        // Step 2: Dynamic Concourse Load Balancing for MARS sub-stands (L/R)
        if (!placed) {
            // Sort allowed concourses by least loaded first in this time window
            const balancedConcourses = [...allowedConc].sort((c1, c2) => {
                return getConcourseLoad(c1, arrMs, depMs) - getConcourseLoad(c2, arrMs, depMs);
            });

            for (const conc of balancedConcourses) {
                const stands = CONCOURSE_LAYOUT[conc] || [];
                // Try MARS sub-stands (L/R) in this concourse first
                for (const s of stands) {
                    const sched = topology.get(s);
                    if (sched && sched.isMarsSub && canFitOnStand(sched, arrMs, depMs, false, topology)) {
                        placeOnStand(sched, arrMs, depMs, flight.id);
                        flightUpdates.set(flight.id, sched.stand);
                        placed = true;
                        break;
                    }
                }
                if (placed) break;
            }
        }

        // Step 3: Single contact stands (e.g. Concourse D or A9) only as fallback
        if (!placed) {
            const singleContactStands: StandSchedule[] = [];
            const balancedConcourses = [...allowedConc].sort((c1, c2) => {
                return getConcourseLoad(c1, arrMs, depMs) - getConcourseLoad(c2, arrMs, depMs);
            });
            for (const conc of balancedConcourses) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && !sched.isMarsSub && !sched.isMarsCenter && !dedicatedNarrowStands.includes(sched)) {
                        singleContactStands.push(sched);
                    }
                }
            }
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

    // Add deferred long-stay narrowbodies to overflow pool
    overflowToRemote.push(...daytimeLongStayNarrow);

    // -----------------------------------------------------------------------
    // Pass B: Widebody Flights -> Concourse Balancing, Single Wide Stands & MARS Center Stands
    // -----------------------------------------------------------------------
    const daytimeLongStayWide: Flight[] = [];

    wideEligible.forEach(flight => {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const allowedConc = getAllowedBridgeConcourses(flight);

        // Rule 1: Daytime long stay widebodies (> 3.5h) must not tie up bridge stands
        if (isDaytimeLongStay(flight)) {
            daytimeLongStayWide.push(flight);
            return;
        }

        const balancedConc = [...allowedConc].sort((c1, c2) => {
            return getConcourseLoad(c1, arrMs, depMs) - getConcourseLoad(c2, arrMs, depMs);
        });

        const singleCandidateStands: StandSchedule[] = [];
        const centerCandidateStands: StandSchedule[] = [];

        balancedConc.forEach(c => {
            const stands = CONCOURSE_LAYOUT[c] || [];
            stands.forEach(s => {
                const sched = topology.get(s);
                if (sched && sched.isWideCompatible) {
                    if (!sched.isMarsSub && !sched.isMarsCenter) {
                        singleCandidateStands.push(sched);
                    } else if (sched.isMarsCenter) {
                        centerCandidateStands.push(sched);
                    }
                }
            });
        });

        let placed = false;
        const isHeavy = isFlightHeavy(flight);

        // Try single contact stands first (e.g. Concourse D)
        for (const sched of singleCandidateStands) {
            if (canFitOnStand(sched, arrMs, depMs, true, topology, isHeavy)) {
                placeOnStand(sched, arrMs, depMs, flight.id);
                flightUpdates.set(flight.id, sched.stand);
                placed = true;
                break;
            }
        }

        // Rule 2: MARS Center Opportunity Cost Check:
        // Try MARS Center stands ONLY IF it doesn't block 2+ overflow narrowbodies!
        if (!placed) {
            for (const sched of centerCandidateStands) {
                if (canFitOnStand(sched, arrMs, depMs, true, topology, isHeavy)) {
                    // Check opportunity cost against narrowbodies waiting in overflowToRemote
                    if (sched.marsSubStands && sched.marsSubStands.length >= 2) {
                        const [subL, subR] = sched.marsSubStands;
                        const schedL = topology.get(subL);
                        const schedR = topology.get(subR);

                        let fittingNarrowCount = 0;
                        for (const ofFlight of overflowToRemote) {
                            const ofArr = ofFlight.scheduledArrival.getTime();
                            const ofDep = ofFlight.scheduledDeparture.getTime();
                            if (ofArr < depMs && ofDep > arrMs) {
                                if (schedL && canFitOnStand(schedL, ofArr, ofDep, false, topology)) {
                                    fittingNarrowCount++;
                                } else if (schedR && canFitOnStand(schedR, ofArr, ofDep, false, topology)) {
                                    fittingNarrowCount++;
                                }
                                if (fittingNarrowCount >= 2) break;
                            }
                        }

                        // If 2+ narrowbodies would be blocked, DO NOT GIVE this center stand to the widebody!
                        if (fittingNarrowCount >= 2) {
                            continue; // Reject center stand, preserve for narrowbodies!
                        }
                    }

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

    // Add deferred long-stay widebodies to overflow pool
    overflowToRemote.push(...daytimeLongStayWide);

    // -----------------------------------------------------------------------
    // Pass B.2: "Eğer Boş Yer Kalırsa" - Remaining narrowbody turnarounds fill idle widebody contact stands
    // -----------------------------------------------------------------------
    const shortStayOverflowNarrow = overflowToRemote.filter(f => getDurationMins(f) / 60 <= 3.5);
    shortStayOverflowNarrow.sort((a, b) => getDurationMins(a) - getDurationMins(b));

    const remainingPlacedNarrowIds = new Set<string>();

    for (const narrowFlight of shortStayOverflowNarrow) {
        const arrMs = narrowFlight.scheduledArrival.getTime();
        const depMs = narrowFlight.scheduledDeparture.getTime();
        const allowedConc = getAllowedBridgeConcourses(narrowFlight);

        const candidateWideStands: StandSchedule[] = [];
        allowedConc.forEach(c => {
            const stands = CONCOURSE_LAYOUT[c] || [];
            stands.forEach(s => {
                const sched = topology.get(s);
                if (sched && (sched.concourse === 'Concourse D' || sched.isMarsCenter)) {
                    candidateWideStands.push(sched);
                }
            });
        });

        for (const sched of candidateWideStands) {
            if (canFitOnStand(sched, arrMs, depMs, false, topology)) {
                placeOnStand(sched, arrMs, depMs, narrowFlight.id);
                flightUpdates.set(narrowFlight.id, sched.stand);
                remainingPlacedNarrowIds.add(narrowFlight.id);
                break;
            }
        }
    }

    const finalOverflowToRemote = overflowToRemote.filter(f => !remainingPlacedNarrowIds.has(f.id));

    // -----------------------------------------------------------------------
    // Pass C: Overflow Passenger Flights & Propellers -> Open Aprons (100, 200, 300)
    // -----------------------------------------------------------------------
    const remotePassengerFlights = [...finalOverflowToRemote, ...propFlights];
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
    // Pass F: Self-Healing Review & Swap Engine (Geriye Dönük İnceleme ve Takas)
    // -----------------------------------------------------------------------
    const swapDetails: SwapDetail[] = [];
    let totalSwapsPerformed = 0;
    let netFlightsGained = 0;
    let gapFillsPerformed = 0;

    const MAX_AUDIT_PASSES = 6;
    let auditPass = 0;

    while (auditPass < MAX_AUDIT_PASSES) {
        auditPass++;
        let madeProgressInPass = false;

        // --- SUB-PHASE 1: GAP FILLING (Boşluk Doldurma) ---
        // Find if any passenger flight currently on a remote apron can fit directly into an empty slot on a bridge stand
        const currentRemoteFlights = eligibleFlights.filter(f => {
            const pos = flightUpdates.get(f.id);
            return pos && !isContactStand(pos);
        });

        // Sort short turnaround first for gap filling
        currentRemoteFlights.sort((a, b) => getDurationMins(a) - getDurationMins(b));

        for (const remFlight of currentRemoteFlights) {
            const arrMs = remFlight.scheduledArrival.getTime();
            const depMs = remFlight.scheduledDeparture.getTime();
            const allowedConc = getAllowedBridgeConcourses(remFlight);
            const isWide = isFlightWide(remFlight);

            let placedBridgeStand: string | null = null;
            for (const conc of allowedConc) {
                const stands = CONCOURSE_LAYOUT[conc] || [];
                for (const s of stands) {
                    const sched = topology.get(s);
                    if (sched && canFitOnStand(sched, arrMs, depMs, isWide, topology)) {
                        // Remove from old remote stand
                        const oldPos = flightUpdates.get(remFlight.id);
                        if (oldPos) {
                            const oldSched = topology.get(oldPos);
                            if (oldSched) {
                                oldSched.intervals = oldSched.intervals.filter(i => i.flightId !== remFlight.id);
                            }
                        }

                        // Place onto bridge stand
                        placeOnStand(sched, arrMs, depMs, remFlight.id);
                        flightUpdates.set(remFlight.id, sched.stand);
                        placedBridgeStand = sched.stand;
                        madeProgressInPass = true;
                        gapFillsPerformed++;
                        netFlightsGained++;
                        break;
                    }
                }
                if (placedBridgeStand) break;
            }
        }

        // --- SUB-PHASE 1.5: WIDEBODY ELEVATION SWAP (Açıktaki Geniş Gövdeyi Köprüye Alma) ---
        // Find if a short-stay remote widebody (< 3.5h) can be brought to a bridge stand by relocating
        // 1 or 2 narrowbodies currently on that stand (or its MARS sub-stands) to empty slots on C, E, or other contact stands.
        const currentRemoteWide = eligibleFlights.filter(f => {
            const pos = flightUpdates.get(f.id);
            return pos && !isContactStand(pos) && isFlightWide(f) && getDurationMins(f) / 60 <= 3.5;
        });

        currentRemoteWide.sort((a, b) => getDurationMins(a) - getDurationMins(b));

        for (const remWide of currentRemoteWide) {
            const wArr = remWide.scheduledArrival.getTime();
            const wDep = remWide.scheduledDeparture.getTime();
            const wAllowed = getAllowedBridgeConcourses(remWide);

            let elevated = false;

            for (const conc of wAllowed) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (!sched || !sched.isWideCompatible) continue;

                    // Direct overlap on center stand by another flight? Skip
                    const directOverlap = sched.intervals.some(i => wArr < i.end && wDep > i.start);
                    if (directOverlap) continue;

                    // Case A: MARS Center stand blocked by 1 or 2 narrowbodies on subL/subR
                    if (sched.isMarsCenter && sched.marsSubStands) {
                        const [subLName, subRName] = sched.marsSubStands;
                        const schedL = subLName ? topology.get(subLName) : undefined;
                        const schedR = subRName ? topology.get(subRName) : undefined;

                        const blockingFlights: { flight: Flight; subSched: StandSchedule }[] = [];
                        if (schedL) {
                            for (const it of schedL.intervals) {
                                if (wArr < it.end && wDep > it.start) {
                                    const bf = eligibleFlights.find(f => f.id === it.flightId);
                                    if (bf) blockingFlights.push({ flight: bf, subSched: schedL });
                                }
                            }
                        }
                        if (schedR) {
                            for (const it of schedR.intervals) {
                                if (wArr < it.end && wDep > it.start) {
                                    const bf = eligibleFlights.find(f => f.id === it.flightId);
                                    if (bf) blockingFlights.push({ flight: bf, subSched: schedR });
                                }
                            }
                        }

                        if (blockingFlights.length > 0 && blockingFlights.length <= 2) {
                            // Test if all blocking flights can find open slots on C, E, or other contact stands
                            const relocations: { flight: Flight; targetSched: StandSchedule }[] = [];
                            let allCanRelocate = true;

                            // Temporarily remove blocking flights
                            for (const bf of blockingFlights) {
                                bf.subSched.intervals = bf.subSched.intervals.filter(i => i.flightId !== bf.flight.id);
                            }

                            for (const bf of blockingFlights) {
                                const bArr = bf.flight.scheduledArrival.getTime();
                                const bDep = bf.flight.scheduledDeparture.getTime();
                                const bAllowed = getAllowedBridgeConcourses(bf.flight);

                                let foundTarget: StandSchedule | null = null;
                                for (const bc of bAllowed) {
                                    for (const bs of (CONCOURSE_LAYOUT[bc] || [])) {
                                        if (bs === sched.stand || bs === subLName || bs === subRName) continue;
                                        const bSched = topology.get(bs);
                                        if (bSched && canFitOnStand(bSched, bArr, bDep, false, topology)) {
                                            placeOnStand(bSched, bArr, bDep, bf.flight.id);
                                            foundTarget = bSched;
                                            break;
                                        }
                                    }
                                    if (foundTarget) break;
                                }

                                if (foundTarget) {
                                    relocations.push({ flight: bf.flight, targetSched: foundTarget });
                                } else {
                                    allCanRelocate = false;
                                    break;
                                }
                            }

                            if (allCanRelocate && canFitOnStand(sched, wArr, wDep, true, topology)) {
                                // Remove remWide from old remote stand
                                const oldRemote = flightUpdates.get(remWide.id);
                                if (oldRemote) {
                                    const oldSched = topology.get(oldRemote);
                                    if (oldSched) {
                                        oldSched.intervals = oldSched.intervals.filter(i => i.flightId !== remWide.id);
                                    }
                                }

                                // Place remWide on bridge
                                placeOnStand(sched, wArr, wDep, remWide.id);
                                flightUpdates.set(remWide.id, sched.stand);

                                // Commit relocations
                                for (const rel of relocations) {
                                    flightUpdates.set(rel.flight.id, rel.targetSched.stand);
                                }

                                const callsignW = remWide.departureFlightNumber || remWide.arrivalFlightNumber || remWide.id;
                                swapDetails.push({
                                    stand: sched.stand,
                                    concourse: sched.concourse,
                                    removedFlight: {
                                        id: remWide.id,
                                        callsign: callsignW,
                                        acType: remWide.aircraftType || '',
                                        durationHours: Math.round(getDurationMins(remWide) / 60 * 10) / 10
                                    },
                                    sentToRemote: 'BRIDGE (Elevated from Remote)',
                                    gainedFlights: relocations.map(r => ({
                                        id: r.flight.id,
                                        callsign: r.flight.departureFlightNumber || r.flight.arrivalFlightNumber || r.flight.id,
                                        acType: r.flight.aircraftType || '',
                                        stand: r.targetSched.stand
                                    })),
                                    netGain: 1
                                });

                                totalSwapsPerformed++;
                                netFlightsGained++;
                                madeProgressInPass = true;
                                elevated = true;
                                break;
                            } else {
                                // Revert relocations
                                for (const rel of relocations) {
                                    rel.targetSched.intervals = rel.targetSched.intervals.filter(i => i.flightId !== rel.flight.id);
                                }
                                for (const bf of blockingFlights) {
                                    placeOnStand(bf.subSched, bf.flight.scheduledArrival.getTime(), bf.flight.scheduledDeparture.getTime(), bf.flight.id);
                                }
                            }
                        }
                    }
                }
                if (elevated) break;
            }
        }

        // --- SUB-PHASE 2: 1-to-N REPLACEMENT SWAP (Geriye Dönük Takas) ---
        // Look for flights currently on bridge stands that can be sent to remote to make room for >= 2 remote narrowbodies
        const currentBridgeFlights = eligibleFlights.filter(f => {
            const pos = flightUpdates.get(f.id);
            return pos && isContactStand(pos);
        });

        // Sort by longest stay first and MARS center first
        currentBridgeFlights.sort((a, b) => {
            const posA = flightUpdates.get(a.id) || '';
            const posB = flightUpdates.get(b.id) || '';
            const isCenterA = topology.get(posA)?.isMarsCenter ? 1 : 0;
            const isCenterB = topology.get(posB)?.isMarsCenter ? 1 : 0;
            if (isCenterA !== isCenterB) return isCenterB - isCenterA;
            return getDurationMins(b) - getDurationMins(a);
        });

        for (const bridgeFlight of currentBridgeFlights) {
            const bridgePos = flightUpdates.get(bridgeFlight.id);
            if (!bridgePos || !isContactStand(bridgePos)) continue;

            const standSched = topology.get(bridgePos);
            if (!standSched) continue;

            const bArrMs = bridgeFlight.scheduledArrival.getTime();
            const bDepMs = bridgeFlight.scheduledDeparture.getTime();
            const bDurHours = getDurationMins(bridgeFlight) / 60;

            // Only consider swapping if it stays >= 2.5 hours or is a MARS Center stand
            if (bDurHours < 2.5 && !standSched.isMarsCenter) continue;

            // Temporarily remove bridgeFlight from topology
            standSched.intervals = standSched.intervals.filter(i => i.flightId !== bridgeFlight.id);

            // Candidate remote narrowbodies that overlap with this window
            const availableRemotes = eligibleFlights.filter(f => {
                const pos = flightUpdates.get(f.id);
                if (!pos || isContactStand(pos) || isFlightWide(f)) return false;
                const fArr = f.scheduledArrival.getTime();
                const fDep = f.scheduledDeparture.getTime();
                if (fArr < bDepMs && fDep > bArrMs) {
                    const concs = getAllowedBridgeConcourses(f);
                    return concs.includes(standSched.concourse);
                }
                return false;
            });

            // Sort by arrival time
            availableRemotes.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());

            const candidateFits: { flight: Flight; stand: string }[] = [];

            if (standSched.isMarsCenter && standSched.marsSubStands) {
                // Test fitting onto SubL and SubR
                const [subLName, subRName] = standSched.marsSubStands;
                const schedL = subLName ? topology.get(subLName) : undefined;
                const schedR = subRName ? topology.get(subRName) : undefined;

                for (const rf of availableRemotes) {
                    const rfArr = rf.scheduledArrival.getTime();
                    const rfDep = rf.scheduledDeparture.getTime();
                    if (candidateFits.some(c => c.flight.id === rf.id)) continue;

                    if (schedL && canFitOnStand(schedL, rfArr, rfDep, false, topology)) {
                        placeOnStand(schedL, rfArr, rfDep, rf.id);
                        candidateFits.push({ flight: rf, stand: schedL.stand });
                    } else if (schedR && canFitOnStand(schedR, rfArr, rfDep, false, topology)) {
                        placeOnStand(schedR, rfArr, rfDep, rf.id);
                        candidateFits.push({ flight: rf, stand: schedR.stand });
                    }
                }
            } else if (!standSched.isMarsSub) {
                // Single stand (e.g. Concourse D)
                for (const rf of availableRemotes) {
                    const rfArr = rf.scheduledArrival.getTime();
                    const rfDep = rf.scheduledDeparture.getTime();
                    if (canFitOnStand(standSched, rfArr, rfDep, false, topology)) {
                        placeOnStand(standSched, rfArr, rfDep, rf.id);
                        candidateFits.push({ flight: rf, stand: standSched.stand });
                    }
                }
            }

            // CRITICAL SWAP RULE: candidateFits must be >= 2 (Net gain = candidateFits.length - 1 >= 1)
            if (candidateFits.length >= 2) {
                // Find an open remote stand for the removed flight
                const isWide = isFlightWide(bridgeFlight);
                let remoteTarget: string | null = null;

                for (const ap of openAprons) {
                    const stList = CONCOURSE_LAYOUT[ap] || [];
                    for (const st of stList) {
                        const rSched = topology.get(st);
                        if (rSched && canFitOnStand(rSched, bArrMs, bDepMs, isWide, topology)) {
                            remoteTarget = st;
                            placeOnStand(rSched, bArrMs, bDepMs, bridgeFlight.id);
                            break;
                        }
                    }
                    if (remoteTarget) break;
                }

                if (remoteTarget) {
                    // SUCCESSFUL SWAP! Commit changes
                    flightUpdates.set(bridgeFlight.id, remoteTarget);

                    for (const fit of candidateFits) {
                        const oldPos = flightUpdates.get(fit.flight.id);
                        if (oldPos) {
                            const oldSched = topology.get(oldPos);
                            if (oldSched) {
                                oldSched.intervals = oldSched.intervals.filter(i => i.flightId !== fit.flight.id);
                            }
                        }
                        flightUpdates.set(fit.flight.id, fit.stand);
                    }

                    const netGain = candidateFits.length - 1;
                    totalSwapsPerformed++;
                    netFlightsGained += netGain;

                    const callsignB = bridgeFlight.departureFlightNumber || bridgeFlight.arrivalFlightNumber || bridgeFlight.id;
                    swapDetails.push({
                        stand: bridgePos,
                        concourse: standSched.concourse,
                        removedFlight: {
                            id: bridgeFlight.id,
                            callsign: callsignB,
                            acType: bridgeFlight.aircraftType || '',
                            durationHours: Math.round(bDurHours * 10) / 10
                        },
                        sentToRemote: remoteTarget,
                        gainedFlights: candidateFits.map(cf => ({
                            id: cf.flight.id,
                            callsign: cf.flight.departureFlightNumber || cf.flight.arrivalFlightNumber || cf.flight.id,
                            acType: cf.flight.aircraftType || '',
                            stand: cf.stand
                        })),
                        netGain
                    });

                    madeProgressInPass = true;
                    break; // Restart loop with newly committed state
                } else {
                    // Revert candidate fits
                    for (const fit of candidateFits) {
                        const sched = topology.get(fit.stand);
                        if (sched) {
                            sched.intervals = sched.intervals.filter(i => i.flightId !== fit.flight.id);
                        }
                    }
                    placeOnStand(standSched, bArrMs, bDepMs, bridgeFlight.id);
                }
            } else {
                // Revert candidate fits
                for (const fit of candidateFits) {
                    const sched = topology.get(fit.stand);
                    if (sched) {
                        sched.intervals = sched.intervals.filter(i => i.flightId !== fit.flight.id);
                    }
                }
                placeOnStand(standSched, bArrMs, bDepMs, bridgeFlight.id);
            }
        }

        if (!madeProgressInPass) {
            break; // Converged
        }
    }

    // -----------------------------------------------------------------------
    // Result Assembly & Safety Net
    // -----------------------------------------------------------------------
    const updatedFlights: Flight[] = allFlights.map(f => {
        const newPos = flightUpdates.get(f.id) !== undefined ? flightUpdates.get(f.id)! : f.parkingPosition;
        return {
            ...f,
            parkingPosition: newPos
        };
    });

    // Safety Net: Guarantee 0 rule violations across all contact assigned flights
    updatedFlights.forEach(f => {
        if (!f.parkingPosition) return;
        const pos = f.parkingPosition;
        if (!isContactStand(pos)) return;

        const isWide = isFlightWide(f);
        const isHeavy = isFlightHeavy(f);
        const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(pos)) || '';
        const isNarrowOnly = concourse === 'Concourse C' || concourse === 'Concourse E' || pos === 'B2' || pos === 'F2' || ['D1', 'D2', 'D3', 'D4', 'D5'].includes(pos) || pos.endsWith('L') || pos.endsWith('R');

        let needsDemotion = false;

        // Rule 1: No widebody on narrow-only contact stand
        if (isWide && isNarrowOnly) {
            console.warn(`[SAFETY NET] Widebody violation prevented on ${pos} for flight ${f.id}. Demoting to remote.`);
            needsDemotion = true;
        }

        // Rule 1.5: Heavy Cat F violation prevented on non-heavy stands
        if (isHeavy) {
            const basePos = pos.replace(/[LR]$/, '');
            if (!CAT_F_HEAVY_STANDS.has(basePos) && !CAT_F_HEAVY_STANDS.has(pos)) {
                console.warn(`[SAFETY NET] Heavy Cat F violation prevented on ${pos} for flight ${f.id}. Demoting to remote.`);
                needsDemotion = true;
            }
        }

        // Rule 2: Pier G vs International
        const isDepDom = f.type === 'turnaround' ? (f.departureIsDomestic ?? f.isDomestic) : (f.type === 'arrival' ? (f.arrivalIsDomestic ?? f.isDomestic) : f.isDomestic);
        if (concourse === 'Concourse G' && !isDepDom) {
            console.warn(`[SAFETY NET] Dış hat flight on Concourse G prevented (${pos}, ${f.id}). Demoting to remote.`);
            needsDemotion = true;
        } else if (concourse !== 'Concourse G' && concourse.startsWith('Concourse') && isDepDom) {
            console.warn(`[SAFETY NET] İç hat flight on International Concourse prevented (${pos}, ${f.id}). Demoting to remote.`);
            needsDemotion = true;
        }

        if (needsDemotion) {
            f.parkingPosition = null;
            flightUpdates.delete(f.id);

            // Re-allocate to open remote apron
            const arrMs = f.scheduledArrival.getTime();
            const depMs = f.scheduledDeparture.getTime();
            for (const ap of ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4']) {
                for (const s of (CONCOURSE_LAYOUT[ap] || [])) {
                    const sched = topology.get(s);
                    if (sched && canFitOnStand(sched, arrMs, depMs, isWide, topology)) {
                        placeOnStand(sched, arrMs, depMs, f.id);
                        f.parkingPosition = s;
                        flightUpdates.set(f.id, s);
                        break;
                    }
                }
                if (f.parkingPosition) break;
            }
        }
    });

    const stats = calculateBridgeUtilization(updatedFlights, startDate, endDate);

    return {
        flights: updatedFlights,
        stats,
        swapDetails,
        totalSwapsPerformed,
        netFlightsGained,
        gapFillsPerformed
    };
}
