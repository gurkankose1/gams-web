import { Flight, MaintenanceBlock } from '../types.ts';
import { CONCOURSE_LAYOUT, TURKISH_DOMESTIC_AIRPORTS } from '../constants.ts';
import { 
    isCargoFlight, 
    isPropellerAircraft, 
    getAircraftCategory, 
    isContactStand,
    isStandWidebodyCompatible,
    isStandCatFCompatible,
    AMS_WIDEBODY_PERMITTED_STANDS,
    AMS_CAT_F_HEAVY_STANDS,
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
    const hasReg = !!(f.regNo && f.regNo.trim() !== '' && f.regNo.toUpperCase() !== 'NULL' && f.regNo.toUpperCase() !== 'NONE');
    const hasType = !!(f.aircraftType && f.aircraftType.trim() !== '' && f.aircraftType.toUpperCase() !== 'NAN' && f.aircraftType.toUpperCase() !== 'NULL');

    // If flight has a valid registration or aircraft type defined in Excel, it is allocatable by AI
    if (hasReg || hasType) {
        return false;
    }

    if (f.isTransparent) return true;
    return true;
}

export function getEffectiveTrafficMode(f: Flight): string {
    const raw = f.raw_data || {};
    const excelDepMod = raw['Mod_1'] || raw['Mod.1'] || raw['DepMod'] || raw['Dep Mod'];
    if (excelDepMod) return String(excelDepMod).toUpperCase().trim();

    const dm = (f.departureMode || '').toUpperCase().trim();
    // 'I' ve 'D' havalimanı raporlarında genellikle İç/Dış Hat (I/D) sütunundan gelir, trafik modu değildir
    if (dm && dm !== 'I' && dm !== 'D') return dm;

    const tm = (f.trafficMode || '').toUpperCase().trim();
    if (tm && tm !== 'I' && tm !== 'D') return tm;

    // Standart havayolu uçuşları için varsayılan tarifeli yolcu (J)
    return 'J';
}

export function isGeneralAviationFlight(f: Flight): boolean {
    const raw = f.raw_data || {};
    const dMode = raw['Mod_1'] || raw['Mod.1'] || raw['DepMod'] || raw['Dep Mod'];
    if (dMode && GENERAL_AVIATION_MODES.has(String(dMode).toUpperCase().trim())) return true;

    const dm = (f.departureMode || '').toUpperCase().trim();
    if (dm && dm !== 'D' && dm !== 'I' && GENERAL_AVIATION_MODES.has(dm)) return true;

    const tm = (f.trafficMode || '').toUpperCase().trim();
    if (tm && tm !== 'D' && tm !== 'I' && GENERAL_AVIATION_MODES.has(tm)) return true;

    const arrNo = (f.arrivalFlightNumber || '').toUpperCase().trim();
    const depNo = (f.departureFlightNumber || '').toUpperCase().trim();
    const airline = (f.airline || '').toUpperCase().trim();
    if (arrNo.startsWith('ZZ') || depNo.startsWith('ZZ') || airline.startsWith('ZZ')) return true;
    return false;
}

export function isCargoModeFlight(f: Flight): boolean {
    const mode = getEffectiveTrafficMode(f);
    if (CARGO_MODES.has(mode)) return true;
    return isCargoFlight(f);
}

export function isSpecialOrMaintenanceFlight(f: Flight): boolean {
    const mode = getEffectiveTrafficMode(f);
    return SPECIAL_MAINTENANCE_MODES.has(mode);
}

export function isPassengerFlight(f: Flight): boolean {
    if (isCargoModeFlight(f)) return false;
    if (isGeneralAviationFlight(f)) return false;
    if (isSpecialOrMaintenanceFlight(f)) return false;

    const mode = getEffectiveTrafficMode(f);
    if (mode === 'P' || SPECIAL_MAINTENANCE_MODES.has(mode) || CARGO_MODES.has(mode) || GENERAL_AVIATION_MODES.has(mode)) {
        return false;
    }
    if (mode && !PASSENGER_MODES.has(mode)) return false;
    return true;
}

export function isFlightBridgeEligible(f: Flight): boolean {
    // Arrival-only bacaklar ATD bazlı kalkış planlamasına girmez
    if (f.type === 'arrival') return false;

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
        // ATD / Kalkış odaklı köprü kullanım hesabı: Sadece kalkış bacağı olan uçuşlar (turnaround veya departure)
        // Arrival bacakları (towed geliş veya tek bacak geliş) yapay scheduledDeparture taşıdığı için ATD kalkış sayımına dahil edilemez.
        if (f.type === 'arrival') {
            return;
        }

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

        if (isCargoModeFlight(f)) {
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

        if (isSpecialOrMaintenanceFlight(f)) {
            return;
        }

        if (!isPassengerFlight(f)) {
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

    // Single departure flight
    if (f.type === 'departure') {
        return isDepDom
            ? ['Concourse G']
            : ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F'];
    }

    // Turnaround flights:
    // 1. Saf İç Hat (İç - İç): Sadece İç Hat İskelesi (Concourse G)
    if (isArrDom && isDepDom) {
        return ['Concourse G'];
    }

    // 2. Saf Dış Hat (Dış - Dış): Sadece Dış Hat İskeleleri (Concourse A, B, C, D, E, F)
    if (!isArrDom && !isDepDom) {
        return ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F'];
    }

    // 3. Karma Uçuşlar (Dış - İç veya İç - Dış):
    // Havalimanı kuralı: Kural şartı yoktur; boş olan herhangi bir körüğe (A-G) yanaşabilir!
    return ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F', 'Concourse G'];
}

// ---------------------------------------------------------------------------
// 3. Stand Categorization and MARS Topology
// ---------------------------------------------------------------------------

export interface StandSchedule {
    stand: string;
    concourse: string;
    isMarsCenter: boolean;
    isMarsSub: boolean;
    marsCenterStand?: string;
    marsSubStands?: string[];
    isWideCompatible: boolean;
    intervals: { start: number; end: number; flightId: string }[];
}

export function hasMaintenanceConflict(
    stand: string,
    arrDate: Date,
    depDate: Date,
    maintenanceBlocks?: MaintenanceBlock[]
): boolean {
    if (!stand || !maintenanceBlocks || maintenanceBlocks.length === 0) return false;
    const cleanStand = stand.trim().toUpperCase();
    const arrMs = arrDate.getTime();
    const depMs = depDate.getTime();

    for (const block of maintenanceBlocks) {
        const blockPos = block.parkingPosition ? block.parkingPosition.trim().toUpperCase() : '';
        if (!blockPos) continue;
        const bStartMs = new Date(block.startTime).getTime();
        const bEndMs = new Date(block.endTime).getTime();
        if (isNaN(bStartMs) || isNaN(bEndMs) || bStartMs >= bEndMs) continue;

        if (arrMs < bEndMs && depMs > bStartMs) {
            // Direct stand match
            if (cleanStand === blockPos) return true;

            // MARS relationship: sub-stand to center (e.g. cleanStand is A6L, blockPos is A6)
            if ((cleanStand.endsWith('L') || cleanStand.endsWith('R')) && cleanStand.slice(0, -1) === blockPos) {
                return true;
            }
            // MARS relationship: center to sub-stand (e.g. cleanStand is A6, blockPos is A6L)
            if ((blockPos.endsWith('L') || blockPos.endsWith('R')) && blockPos.slice(0, -1) === cleanStand) {
                return true;
            }
        }
    }
    return false;
}

export function buildStandTopology(maintenanceBlocks?: MaintenanceBlock[]): Map<string, StandSchedule> {
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

        // Widebody compatibility strictly defined by official AMS Stand Allocation Permissions (stand_allocation_permission.pdf):
        const isWideCompatible = isStandWidebodyCompatible(stand);

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

    // Step 3: Populate Maintenance Blocks (Downgrades) into Topology Intervals
    if (maintenanceBlocks && maintenanceBlocks.length > 0) {
        maintenanceBlocks.forEach(block => {
            const pos = block.parkingPosition ? block.parkingPosition.trim().toUpperCase() : '';
            if (!pos) return;
            const sched = topology.get(pos);
            const startMs = new Date(block.startTime).getTime();
            const endMs = new Date(block.endTime).getTime();
            if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) return;

            if (sched) {
                sched.intervals.push({
                    start: startMs,
                    end: endMs,
                    flightId: `MAINTENANCE-${block.id}`
                });
            }
        });
    }

    return topology;
}

export function canFitOnStand(
    schedule: StandSchedule,
    arrMs: number,
    depMs: number,
    isWide: boolean,
    topology: Map<string, StandSchedule>,
    isHeavy: boolean = false
): boolean {
    // 1. Physical & AMS Rule compatibility
    if (isWide && schedule.isMarsSub) return false;
    if (isWide && !schedule.isWideCompatible) return false;
    // Strict MARS Rule: Narrowbody (Cat A, B, C) cannot park on MARS Center stands!
    // It must park on L or R sub-stands (e.g. A11L/A11R), never on Center (A11).
    if (!isWide && schedule.isMarsCenter) return false;
    if (isHeavy && !isStandCatFCompatible(schedule.stand)) {
        return false;
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

export function placeOnStand(schedule: StandSchedule, arrMs: number, depMs: number, flightId: string) {
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

export function runFromScratchAllocation(
    allFlights: Flight[],
    startDate?: Date,
    endDate?: Date,
    maintenanceBlocks?: MaintenanceBlock[]
): AiAllocationResult {
    const topology = buildStandTopology(maintenanceBlocks);
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
        // High-turnover protection: Daytime stays > 3.5h and long stays > 5.0h are deferred
        // so they do NOT steal bridge stands from 60-150 minute fast turnarounds!
        if (isDaytimeLongStay(flight) || getDurationMins(flight) / 60 > 5.0) {
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

        // Step 2: Dynamic Concourse Load Balancing for MARS sub-stands (L/R) with Synchronized Pairing
        if (!placed) {
            const isMixed = (flight.arrivalIsDomestic ?? flight.isDomestic) !== (flight.departureIsDomestic ?? flight.isDomestic);
            const balancedConcourses = [...allowedConc].sort((c1, c2) => {
                if (isMixed) {
                    if (c1 === 'Concourse G') return 1;
                    if (c2 === 'Concourse G') return -1;
                }
                return getConcourseLoad(c1, arrMs, depMs) - getConcourseLoad(c2, arrMs, depMs);
            });

            interface SubStandCandidate {
                sched: StandSchedule;
                syncScore: number;
            }
            const subCandidates: SubStandCandidate[] = [];

            for (const conc of balancedConcourses) {
                const stands = CONCOURSE_LAYOUT[conc] || [];
                for (const s of stands) {
                    const sched = topology.get(s);
                    if (sched && sched.isMarsSub && canFitOnStand(sched, arrMs, depMs, false, topology)) {
                        // Protect Stand A2 for Cat F / A380 flights: Do not put narrowbodies on A2L / A2R if an A380 operates in that window!
                        if (sched.stand === 'A2L' || sched.stand === 'A2R') {
                            const blocksCatF = wideEligible.some(wf => {
                                if (!isFlightHeavy(wf)) return false;
                                const wArr = wf.scheduledArrival.getTime();
                                const wDep = wf.scheduledDeparture.getTime();
                                return arrMs < wDep + 45 * 60 * 1000 && depMs > wArr - 45 * 60 * 1000;
                            });
                            if (blocksCatF) continue;
                        }
                        // Check counterpart sub-stand synchronization:
                        // If counterpart (e.g. A6R) has a flight arriving and departing around the same time,
                        // placing this flight on A6L ensures BOTH vacate together, freeing A6 Center for widebody!
                        let syncScore = 0;
                        if (sched.marsCenterStand) {
                            const centerSched = topology.get(sched.marsCenterStand);
                            if (centerSched && centerSched.marsSubStands) {
                                const siblingName = centerSched.marsSubStands.find(sub => sub !== sched.stand);
                                if (siblingName) {
                                    const sibSched = topology.get(siblingName);
                                    if (sibSched && sibSched.intervals.length > 0) {
                                        for (const sInterval of sibSched.intervals) {
                                            const arrDiff = Math.abs(arrMs - sInterval.start) / (60 * 1000);
                                            const depDiff = Math.abs(depMs - sInterval.end) / (60 * 1000);
                                            if (arrDiff <= 45 && depDiff <= 45) {
                                                syncScore = Math.max(syncScore, 100 - (arrDiff + depDiff));
                                            } else if (depDiff <= 60) {
                                                syncScore = Math.max(syncScore, 50 - depDiff);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        subCandidates.push({ sched, syncScore });
                    }
                }
            }

            // Prioritize highest synchronization score (best pairs) first!
            subCandidates.sort((a, b) => b.syncScore - a.syncScore);

            for (const cand of subCandidates) {
                if (canFitOnStand(cand.sched, arrMs, depMs, false, topology)) {
                    placeOnStand(cand.sched, arrMs, depMs, flight.id);
                    flightUpdates.set(flight.id, cand.sched.stand);
                    placed = true;
                    break;
                }
            }
        }

        // Step 3: Single contact stands (e.g. Concourse D or A9) only as fallback
        if (!placed) {
            const singleContactStands: StandSchedule[] = [];
            const isMixed = (flight.arrivalIsDomestic ?? flight.isDomestic) !== (flight.departureIsDomestic ?? flight.isDomestic);
            const balancedConcourses = [...allowedConc].sort((c1, c2) => {
                if (isMixed) {
                    if (c1 === 'Concourse G') return 1;
                    if (c2 === 'Concourse G') return -1;
                }
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

    // -----------------------------------------------------------------------
    // Pass B: Widebody Flights -> Concourse Balancing, Single Wide Stands & MARS Center Stands
    // -----------------------------------------------------------------------
    wideEligible.forEach(flight => {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const allowedConc = getAllowedBridgeConcourses(flight);

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

    // -----------------------------------------------------------------------
    // Pass B.2: "Eğer Boş Yer Kalırsa" - Remaining narrowbody turnarounds fill idle widebody contact stands
    // -----------------------------------------------------------------------
    const candidateOverflowNarrow = overflowToRemote.filter(f => !isFlightWide(f));
    candidateOverflowNarrow.sort((a, b) => getDurationMins(a) - getDurationMins(b));

    const remainingPlacedNarrowIds = new Set<string>();

    for (const narrowFlight of candidateOverflowNarrow) {
        const arrMs = narrowFlight.scheduledArrival.getTime();
        const depMs = narrowFlight.scheduledDeparture.getTime();
        const allowedConc = getAllowedBridgeConcourses(narrowFlight);

        const candidateWideStands: StandSchedule[] = [];
        allowedConc.forEach(c => {
            const stands = CONCOURSE_LAYOUT[c] || [];
            stands.forEach(s => {
                const sched = topology.get(s);
                // Only non-MARS single stands (e.g. A9, B4, B13-B17, F14-F19, D6-D17)
                // MARS center stands are strictly excluded for narrowbodies!
                if (sched && !sched.isMarsSub && !sched.isMarsCenter) {
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
    // Pass B.3: Residual Bridge Slots for Medium Stays (<= 5.0h)
    // Flights staying > 5.0h daytime are kept for remote aprons so they do not block turnarounds!
    // -----------------------------------------------------------------------
    const mediumStays = daytimeLongStayNarrow.filter(f => getDurationMins(f) / 60 <= 5.0);
    const veryLongStays = daytimeLongStayNarrow.filter(f => getDurationMins(f) / 60 > 5.0);
    veryLongStays.forEach(f => finalOverflowToRemote.push(f));

    mediumStays.forEach(flight => {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const allowedConc = getAllowedBridgeConcourses(flight);
        let placed = false;

        for (const conc of allowedConc) {
            for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                const sched = topology.get(s);
                if (sched && !sched.isMarsCenter && canFitOnStand(sched, arrMs, depMs, false, topology)) {
                    placeOnStand(sched, arrMs, depMs, flight.id);
                    flightUpdates.set(flight.id, sched.stand);
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }

        if (!placed) {
            finalOverflowToRemote.push(flight);
        }
    });

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
        const isHeavy = isFlightHeavy(flight);

        let placed = false;
        for (const apronName of openAprons) {
            const stands = CONCOURSE_LAYOUT[apronName] || [];
            for (const s of stands) {
                const sched = topology.get(s);
                if (sched && canFitOnStand(sched, arrMs, depMs, isWide, topology, isHeavy)) {
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
            return pos && !isContactStand(pos) && isFlightWide(f);
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

            // Candidate remote narrowbodies that fit within this window [bArrMs, bDepMs]
            const availableRemotes = eligibleFlights.filter(f => {
                const pos = flightUpdates.get(f.id);
                if (!pos || isContactStand(pos) || isFlightWide(f)) return false;
                const fArr = f.scheduledArrival.getTime();
                const fDep = f.scheduledDeparture.getTime();
                if (fArr >= bArrMs && fDep <= bDepMs) {
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
            } else {
                // Single contact stand OR MARS Sub-stand (L/R)
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
                const isHeavy = isFlightHeavy(bridgeFlight);
                let remoteTarget: string | null = null;

                for (const ap of openAprons) {
                    const stList = CONCOURSE_LAYOUT[ap] || [];
                    for (const st of stList) {
                        const rSched = topology.get(st);
                        if (rSched && canFitOnStand(rSched, bArrMs, bDepMs, isWide, topology, isHeavy)) {
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

    // Safety Net: Guarantee 0 rule violations across ALL assigned flights (Contact & Remote)
    updatedFlights.forEach(f => {
        if (!f.parkingPosition) return;
        const pos = f.parkingPosition;

        const isWide = isFlightWide(f);
        const isHeavy = isFlightHeavy(f);
        const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(pos)) || '';

        let needsDemotion = false;

        // Rule 0: Maintenance / Downgrade conflict check
        if (hasMaintenanceConflict(pos, f.scheduledArrival, f.scheduledDeparture, maintenanceBlocks)) {
            console.warn(`[SAFETY NET] Maintenance conflict prevented on ${pos} for flight ${f.id}. Demoting/Relocating.`);
            needsDemotion = true;
        }

        // Rule 1: AMS Widebody Stand Permission Check (stand_allocation_permission.pdf)
        // No widebody on any narrowbody-only stand (e.g. 100-132, 200-214, 300-312, 601-604, C1-C4, E1-E4, D1-D5, L/R sub-stands)
        if (isWide && !isStandWidebodyCompatible(pos)) {
            console.warn(`[SAFETY NET] Widebody violation prevented on ${pos} for flight ${f.id}. Demoting/Relocating.`);
            needsDemotion = true;
        }

        // Rule 1.5: Heavy Cat F violation prevented on non-heavy stands (AMS Rule)
        if (isHeavy && !isStandCatFCompatible(pos)) {
            console.warn(`[SAFETY NET] Heavy Cat F violation prevented on ${pos} for flight ${f.id}. Demoting/Relocating.`);
            needsDemotion = true;
        }

        // Rule 1.8: Strict MARS Rule: No narrowbody on MARS Center stand
        if (!isWide) {
            const sched = topology.get(pos);
            if (sched && sched.isMarsCenter) {
                console.warn(`[SAFETY NET] Narrowbody on MARS center stand ${pos} prevented for flight ${f.id}. Demoting/Relocating.`);
                needsDemotion = true;
            }
        }

        // Rule 2: Pier G vs International (Contact stands only)
        if (isContactStand(pos)) {
            const isArrDom = f.type === 'turnaround' ? (f.arrivalIsDomestic ?? f.isDomestic) : f.isDomestic;
            const isDepDom = f.type === 'turnaround' ? (f.departureIsDomestic ?? f.isDomestic) : f.isDomestic;

            // Saf Dış Hat (Dış - Dış) asla Concourse G'ye verilemez
            if (concourse === 'Concourse G' && (!isArrDom && !isDepDom)) {
                console.warn(`[SAFETY NET] Saf Dış hat flight on Concourse G prevented (${pos}, ${f.id}). Demoting.`);
                needsDemotion = true;
            } else if (concourse !== 'Concourse G' && concourse.startsWith('Concourse') && (isArrDom && isDepDom)) {
                // Saf İç Hat (İç - İç) asla Concourse A-F'ye verilemez
                console.warn(`[SAFETY NET] Saf İç hat flight on International Concourse prevented (${pos}, ${f.id}). Demoting.`);
                needsDemotion = true;
            }
        }

        if (needsDemotion) {
            f.parkingPosition = null;
            flightUpdates.delete(f.id);

            // Re-allocate to a compatible stand
            const arrMs = f.scheduledArrival.getTime();
            const depMs = f.scheduledDeparture.getTime();
            for (const ap of ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5']) {
                for (const s of (CONCOURSE_LAYOUT[ap] || [])) {
                    const sched = topology.get(s);
                    if (sched && canFitOnStand(sched, arrMs, depMs, isWide, topology, isHeavy)) {
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

    // Gate Synchronization: Automatically match Gate pier with Stand pier to eliminate mismatches
    updatedFlights.forEach(f => {
        if (f.parkingPosition && isContactStand(f.parkingPosition)) {
            const pier = f.parkingPosition[0].toUpperCase();
            if (!f.gate || f.gate.toUpperCase()[0] !== pier) {
                f.gate = f.parkingPosition;
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

// ---------------------------------------------------------------------------
// 5. Warm-Start Optimization: Preserve & Elevate Human Dispatcher Plan
// ---------------------------------------------------------------------------
export function runPreserveAndElevateAllocation(
    allFlights: Flight[],
    startDate?: Date,
    endDate?: Date,
    maintenanceBlocks?: MaintenanceBlock[]
): AiAllocationResult | null {
    const existingContactCount = allFlights.filter(f => f.parkingPosition && isContactStand(f.parkingPosition)).length;
    if (existingContactCount === 0) return null;

    const topology = buildStandTopology(maintenanceBlocks);
    const flightUpdates = new Map<string, string | null>();

    const eligibleFlights: Flight[] = [];
    const cargoFlights: Flight[] = [];
    const gaFlights: Flight[] = [];
    const propFlights: Flight[] = [];
    const noAcFlights: Flight[] = [];

    allFlights.forEach(f => {
        if (isNoAcFlight(f)) {
            noAcFlights.push(f);
            flightUpdates.set(f.id, null);
        } else if (f.trafficMode === 'F' || f.departureMode === 'F' || isCargoFlight(f)) {
            cargoFlights.push(f);
            flightUpdates.set(f.id, f.parkingPosition || null);
        } else if (isGeneralAviationFlight(f)) {
            gaFlights.push(f);
            flightUpdates.set(f.id, f.parkingPosition || null);
        } else if (isPropellerAircraft(f.aircraftType)) {
            propFlights.push(f);
            flightUpdates.set(f.id, f.parkingPosition || null);
        } else {
            eligibleFlights.push(f);
        }
    });

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

    // Step 1: Retain valid existing contact stand flights in topology
    const validContactFlights: Flight[] = [];
    const remoteOrUnplacedEligible: Flight[] = [];

    const existingContact = eligibleFlights.filter(f => f.parkingPosition && isContactStand(f.parkingPosition));
    existingContact.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());

    for (const f of existingContact) {
        const pos = f.parkingPosition!;
        const sched = topology.get(pos);
        const arrMs = f.scheduledArrival.getTime();
        const depMs = f.scheduledDeparture.getTime();
        const isWide = isFlightWide(f);
        const isHeavy = isFlightHeavy(f);
        const allowedConc = getAllowedBridgeConcourses(f);

        // Immediate check: Does existing flight conflict with maintenance / downgrade block?
        if (hasMaintenanceConflict(pos, f.scheduledArrival, f.scheduledDeparture, maintenanceBlocks)) {
            remoteOrUnplacedEligible.push(f);
            continue;
        }

        let canKeep = false;
        if (sched && allowedConc.includes(sched.concourse)) {
            if (!isWide || sched.isWideCompatible) {
                if (!isHeavy || isStandCatFCompatible(sched.stand)) {
                    if (isWide || !sched.isMarsCenter) {
                        if (canFitOnStand(sched, arrMs, depMs, isWide, topology, isHeavy)) {
                            placeOnStand(sched, arrMs, depMs, f.id);
                            flightUpdates.set(f.id, pos);
                            validContactFlights.push(f);
                            canKeep = true;
                        }
                    }
                }
            }
        }
        if (!canKeep) {
            remoteOrUnplacedEligible.push(f);
        }
    }

    // Add remaining eligible flights (those on remote aprons or unallocated)
    for (const f of eligibleFlights) {
        if (!f.parkingPosition || !isContactStand(f.parkingPosition)) {
            remoteOrUnplacedEligible.push(f);
            if (f.parkingPosition) {
                flightUpdates.set(f.id, f.parkingPosition);
                const rSched = topology.get(f.parkingPosition);
                if (rSched) {
                    const arrMs = f.scheduledArrival.getTime();
                    const depMs = f.scheduledDeparture.getTime();
                    const isWide = isFlightWide(f);
                    const isHeavy = isFlightHeavy(f);
                    if (canFitOnStand(rSched, arrMs, depMs, isWide, topology, isHeavy)) {
                        placeOnStand(rSched, arrMs, depMs, f.id);
                    }
                }
            } else {
                flightUpdates.set(f.id, null);
            }
        }
    }

    let gapFillsPerformed = 0;
    let netFlightsGained = 0;
    const swapDetails: SwapDetail[] = [];
    let totalSwapsPerformed = 0;

    // Step 2: Direct Gap Filling - Elevate remote passenger flights into empty bridge slots
    remoteOrUnplacedEligible.sort((a, b) => {
        const isWideA = isFlightWide(a);
        const isWideB = isFlightWide(b);
        if (isWideA !== isWideB) return isWideA ? 1 : -1;
        const durA = getDurationMins(a);
        const durB = getDurationMins(b);
        if (Math.abs(durA - durB) > 30) return durA - durB;
        return a.scheduledArrival.getTime() - b.scheduledArrival.getTime();
    });

    for (const flight of remoteOrUnplacedEligible) {
        const currentPos = flightUpdates.get(flight.id);
        if (currentPos && isContactStand(currentPos)) continue;

        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const isWide = isFlightWide(flight);
        const isHeavy = isFlightHeavy(flight);
        const allowedConc = getAllowedBridgeConcourses(flight);

        const candidateStands: StandSchedule[] = [];

        if (!isWide) {
            // Dedicated narrow stands (C, E, D1-D5, B2, F2)
            for (const conc of allowedConc) {
                if (conc === 'Concourse C' || conc === 'Concourse E') {
                    for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                        const sched = topology.get(s);
                        if (sched) candidateStands.push(sched);
                    }
                }
            }
            if (allowedConc.includes('Concourse D')) {
                for (const s of ['D1', 'D2', 'D3', 'D4', 'D5']) {
                    const sched = topology.get(s);
                    if (sched) candidateStands.push(sched);
                }
            }
            for (const s of ['B2', 'F2']) {
                const conc = s.startsWith('B') ? 'Concourse B' : 'Concourse F';
                if (allowedConc.includes(conc)) {
                    const sched = topology.get(s);
                    if (sched) candidateStands.push(sched);
                }
            }
            // MARS sub-stands (L/R)
            for (const conc of allowedConc) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && sched.isMarsSub && !candidateStands.includes(sched)) {
                        candidateStands.push(sched);
                    }
                }
            }
            // Other non-center contact stands
            for (const conc of allowedConc) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && !sched.isMarsCenter && !candidateStands.includes(sched)) {
                        candidateStands.push(sched);
                    }
                }
            }
        } else {
            // For widebody: single wide stands first, then MARS Center
            for (const conc of allowedConc) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && sched.isWideCompatible && !sched.isMarsSub && !sched.isMarsCenter) {
                        candidateStands.push(sched);
                    }
                }
            }
            for (const conc of allowedConc) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && sched.isWideCompatible && sched.isMarsCenter) {
                        candidateStands.push(sched);
                    }
                }
            }
        }

        for (const sched of candidateStands) {
            if (canFitOnStand(sched, arrMs, depMs, isWide, topology, isHeavy)) {
                const oldPos = flightUpdates.get(flight.id);
                if (oldPos) {
                    const oldSched = topology.get(oldPos);
                    if (oldSched) {
                        oldSched.intervals = oldSched.intervals.filter(i => i.flightId !== flight.id);
                    }
                }
                placeOnStand(sched, arrMs, depMs, flight.id);
                flightUpdates.set(flight.id, sched.stand);
                gapFillsPerformed++;
                netFlightsGained++;
                break;
            }
        }
    }

    // Step 3: Self-Healing Review & Smart Swaps
    const openAprons = ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5', 'APRON 6', 'APRON 7'];
    const MAX_AUDIT_PASSES = 4;
    let auditPass = 0;

    while (auditPass < MAX_AUDIT_PASSES) {
        auditPass++;
        let madeProgress = false;

        const currentBridgeFlights = eligibleFlights.filter(f => {
            const pos = flightUpdates.get(f.id);
            return pos && isContactStand(pos);
        });

        currentBridgeFlights.sort((a, b) => getDurationMins(b) - getDurationMins(a));

        for (const bridgeFlight of currentBridgeFlights) {
            const bridgePos = flightUpdates.get(bridgeFlight.id);
            if (!bridgePos || !isContactStand(bridgePos)) continue;

            const standSched = topology.get(bridgePos);
            if (!standSched) continue;

            const bArrMs = bridgeFlight.scheduledArrival.getTime();
            const bDepMs = bridgeFlight.scheduledDeparture.getTime();
            const bDurHours = getDurationMins(bridgeFlight) / 60;

            if (bDurHours < 3.5 && !standSched.isMarsCenter) continue;

            standSched.intervals = standSched.intervals.filter(i => i.flightId !== bridgeFlight.id);

            const availableRemotes = eligibleFlights.filter(f => {
                const pos = flightUpdates.get(f.id);
                if (!pos || isContactStand(pos) || isFlightWide(f)) return false;
                const fArr = f.scheduledArrival.getTime();
                const fDep = f.scheduledDeparture.getTime();
                if (fArr >= bArrMs && fDep <= bDepMs) {
                    const concs = getAllowedBridgeConcourses(f);
                    return concs.includes(standSched.concourse);
                }
                return false;
            });

            availableRemotes.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());
            const candidateFits: { flight: Flight; stand: string }[] = [];

            if (standSched.isMarsCenter && standSched.marsSubStands) {
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
            } else {
                // Single stand OR MARS Sub-stand (L/R)
                for (const rf of availableRemotes) {
                    const rfArr = rf.scheduledArrival.getTime();
                    const rfDep = rf.scheduledDeparture.getTime();
                    if (canFitOnStand(standSched, rfArr, rfDep, false, topology)) {
                        placeOnStand(standSched, rfArr, rfDep, rf.id);
                        candidateFits.push({ flight: rf, stand: standSched.stand });
                    }
                }
            }

            if (candidateFits.length >= 2) {
                const isWide = isFlightWide(bridgeFlight);
                const isHeavy = isFlightHeavy(bridgeFlight);
                let remoteTarget: string | null = null;
                for (const ap of openAprons) {
                    for (const st of (CONCOURSE_LAYOUT[ap] || [])) {
                        const rSched = topology.get(st);
                        if (rSched && canFitOnStand(rSched, bArrMs, bDepMs, isWide, topology, isHeavy)) {
                            remoteTarget = st;
                            placeOnStand(rSched, bArrMs, bDepMs, bridgeFlight.id);
                            break;
                        }
                    }
                    if (remoteTarget) break;
                }

                if (remoteTarget) {
                    flightUpdates.set(bridgeFlight.id, remoteTarget);
                    for (const fit of candidateFits) {
                        const oldPos = flightUpdates.get(fit.flight.id);
                        if (oldPos) {
                            const oldSched = topology.get(oldPos);
                            if (oldSched) oldSched.intervals = oldSched.intervals.filter(i => i.flightId !== fit.flight.id);
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

                    madeProgress = true;
                    break;
                } else {
                    for (const fit of candidateFits) {
                        const sched = topology.get(fit.stand);
                        if (sched) sched.intervals = sched.intervals.filter(i => i.flightId !== fit.flight.id);
                    }
                    placeOnStand(standSched, bArrMs, bDepMs, bridgeFlight.id);
                }
            } else {
                for (const fit of candidateFits) {
                    const sched = topology.get(fit.stand);
                    if (sched) sched.intervals = sched.intervals.filter(i => i.flightId !== fit.flight.id);
                }
                placeOnStand(standSched, bArrMs, bDepMs, bridgeFlight.id);
            }
        }

        if (!madeProgress) break;
    }

    // Safety net and result assembly
    const updatedFlights: Flight[] = allFlights.map(f => ({
        ...f,
        parkingPosition: flightUpdates.get(f.id) !== undefined ? flightUpdates.get(f.id)! : f.parkingPosition
    }));

    // Safety Net: Guarantee 0 rule violations across ALL assigned flights
    updatedFlights.forEach(f => {
        if (!f.parkingPosition) return;
        const pos = f.parkingPosition;
        const isWide = isFlightWide(f);
        const isHeavy = isFlightHeavy(f);
        const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(pos)) || '';

        let needsDemotion = false;

        // Rule 0: Maintenance / Downgrade conflict check
        if (hasMaintenanceConflict(pos, f.scheduledArrival, f.scheduledDeparture, maintenanceBlocks)) {
            console.warn(`[SAFETY NET] Maintenance conflict on ${pos} for flight ${f.id}. Relocating.`);
            needsDemotion = true;
        }

        if (isWide && !isStandWidebodyCompatible(pos)) needsDemotion = true;
        if (isHeavy && !isStandCatFCompatible(pos)) needsDemotion = true;
        if (!isWide) {
            const sched = topology.get(pos);
            if (sched && sched.isMarsCenter) needsDemotion = true;
        }
        if (isContactStand(pos)) {
            const isArrDom = f.type === 'turnaround' ? (f.arrivalIsDomestic ?? f.isDomestic) : f.isDomestic;
            const isDepDom = f.type === 'turnaround' ? (f.departureIsDomestic ?? f.isDomestic) : f.isDomestic;
            if (concourse === 'Concourse G' && (!isArrDom && !isDepDom)) needsDemotion = true;
            else if (concourse !== 'Concourse G' && concourse.startsWith('Concourse') && (isArrDom && isDepDom)) needsDemotion = true;
        }

        if (needsDemotion) {
            f.parkingPosition = null;
            flightUpdates.delete(f.id);
            const arrMs = f.scheduledArrival.getTime();
            const depMs = f.scheduledDeparture.getTime();
            for (const ap of ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5']) {
                for (const s of (CONCOURSE_LAYOUT[ap] || [])) {
                    const sched = topology.get(s);
                    if (sched && canFitOnStand(sched, arrMs, depMs, isWide, topology, isHeavy)) {
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

    // Gate Synchronization: Automatically match Gate pier with Stand pier to eliminate mismatches
    updatedFlights.forEach(f => {
        if (f.parkingPosition && isContactStand(f.parkingPosition)) {
            const pier = f.parkingPosition[0].toUpperCase();
            if (!f.gate || f.gate.toUpperCase()[0] !== pier) {
                f.gate = f.parkingPosition;
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

// ---------------------------------------------------------------------------
// 6. Master AI Bridge Allocation Entry Point
// ---------------------------------------------------------------------------
export function runAiBridgeAllocation(
    allFlights: Flight[],
    startDate?: Date,
    endDate?: Date,
    maintenanceBlocks?: MaintenanceBlock[]
): AiAllocationResult {
    const existingContactCount = allFlights.filter(f => f.parkingPosition && isContactStand(f.parkingPosition)).length;

    // If flights already have contact stand assignments from human dispatcher, run Warm-Start Optimization
    let elevateResult: AiAllocationResult | null = null;
    if (existingContactCount > 0) {
        elevateResult = runPreserveAndElevateAllocation(allFlights, startDate, endDate, maintenanceBlocks);
    }

    const scratchResult = runFromScratchAllocation(allFlights, startDate, endDate, maintenanceBlocks);

    // If elevateResult exists and achieved >= bridge assigned count, prefer it!
    if (elevateResult && elevateResult.stats.bridgeAssignedCount >= scratchResult.stats.bridgeAssignedCount) {
        return elevateResult;
    }

    return scratchResult;
}
