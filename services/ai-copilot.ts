import { Flight, MaintenanceBlock } from '../types.ts';
import { CONCOURSE_LAYOUT, WIDE_BODY_AIRCRAFT } from '../constants.ts';
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
    StandSchedule
} from './ai-allocator.ts';
import { calculateRevenue } from './revenue-calculator.ts';

export type OpportunityType = 'DIRECT_GAP_FILL' | 'NARROW_CONSOLIDATION' | 'DOMESTIC_LIBERATION_SWAP' | 'MARS_OPTIMIZATION';
export type OpportunityPriority = 'HIGH' | 'MEDIUM' | 'NORMAL';

export interface CopilotOpportunity {
    id: string;
    type: OpportunityType;
    priority: OpportunityPriority;
    flightId: string;
    callsign: string;
    aircraftType: string;
    isWideBody: boolean;
    origin: string;
    destination: string;
    scheduledArrival: Date;
    scheduledDeparture: Date;
    durationMins: number;
    currentPosition: string;
    targetPosition: string;
    targetConcourse: string;
    revenueGainEur: number;
    explanation: string;
    ruleBadges: string[];
    // If consolidation swap involved
    relocatedFlight?: {
        flightId: string;
        callsign: string;
        aircraftType: string;
        fromPosition: string;
        toPosition: string;
    };
}

export interface CopilotStats {
    totalFlights: number;
    eligiblePaxCount: number;
    currentBridgeCount: number;
    currentRemoteCount: number;
    currentBridgeRate: number;
    currentRevenueEur: number;
    potentialBridgeCount: number;
    potentialBridgeRate: number;
    potentialRevenueEur: number;
    netGainFlights: number;
    netGainRevenueEur: number;
}

export interface CopilotDiagnostics {
    remoteLongStayCount: number; // 4 - 8 hours
    remoteVeryLongStayCount: number; // > 8 hours
    remotePureDomCount: number; // Pure domestic on remote
    remoteTurbopropCount: number; // AT76 / ATR72 / DH8D
    cargoCount: number;
    gaCount: number;
}

export interface CopilotAnalysisResult {
    stats: CopilotStats;
    opportunities: CopilotOpportunity[];
    executiveBriefing: string;
    diagnostics: CopilotDiagnostics;
}

const getDurationMins = (f: Flight): number => {
    return Math.max(30, (f.scheduledDeparture.getTime() - f.scheduledArrival.getTime()) / (60 * 1000));
};

const isFlightWide = (f: Flight): boolean => {
    if (f.acCategory === 'E' || f.acCategory === 'D' || f.acCategory === 'F') return true;
    const cat = getAircraftCategory(f.aircraftType);
    if (cat === 'E' || cat === 'D' || cat === 'F') return true;
    const cleanType = (f.aircraftType || '').toUpperCase().trim();
    return WIDE_BODY_AIRCRAFT.has(cleanType);
};

const isFlightHeavy = (f: Flight): boolean => {
    if (f.acCategory === 'F') return true;
    return getAircraftCategory(f.aircraftType) === 'F';
};

/**
 * Fast, 100% Client-Side OCC AI Co-Pilot Optimizer (Zero-Token / Zero-Tow).
 * Scans current schedule for:
 * 1. Direct Gap Fills (idle bridge windows that fit short-stay remote flights).
 * 2. Narrowbody Consolidation (relocates narrowbody from wide-capable stand to C/E, opening stand for remote widebody).
 */
export function runAiCopilotAnalysis(flights: Flight[], maintenanceBlocks?: MaintenanceBlock[]): CopilotAnalysisResult {
    const topology = buildStandTopology(maintenanceBlocks);

    // Populate topology with current assignments
    flights.forEach(f => {
        if (!f.parkingPosition) return;
        // If flight already conflicts with a maintenance block, do not place into topology
        if (hasMaintenanceConflict(f.parkingPosition, f.scheduledArrival, f.scheduledDeparture, maintenanceBlocks)) {
            return;
        }
        const sched = topology.get(f.parkingPosition);
        if (sched) {
            sched.intervals.push({
                start: f.scheduledArrival.getTime(),
                end: f.scheduledDeparture.getTime(),
                flightId: f.id
            });
        }
    });

    let eligiblePaxCount = 0;
    let currentBridgeCount = 0;
    let currentRemoteCount = 0;
    let currentRevenueEur = 0;

    const remoteEligibleFlights: Flight[] = [];

    flights.forEach(f => {
        if (!isFlightBridgeEligible(f)) return;
        eligiblePaxCount++;

        const isBridge = f.parkingPosition ? isContactStand(f.parkingPosition) : false;
        const rev = calculateRevenue(f);
        currentRevenueEur += rev.totalEur;

        if (isBridge) {
            currentBridgeCount++;
        } else {
            currentRemoteCount++;
            if (f.parkingPosition) {
                remoteEligibleFlights.push(f);
            }
        }
    });

    const currentBridgeRate = eligiblePaxCount > 0 ? (currentBridgeCount / eligiblePaxCount) * 100 : 0;

    const opportunities: CopilotOpportunity[] = [];
    const simulatedAssignments = new Map<string, string>(); // flightId -> new stand
    const committedFlightIds = new Set<string>();

    // ---------------------------------------------------------------------------
    // Strategy 1: DIRECT GAP FILL (Boşluk Doldurma)
    // Short-stay turnarounds (< 3.5 hours) prioritized to maximize efficiency
    // ---------------------------------------------------------------------------
    const sortedRemotes = [...remoteEligibleFlights].sort((a, b) => {
        const durA = getDurationMins(a);
        const durB = getDurationMins(b);
        if (Math.abs(durA - durB) > 30) return durA - durB;
        return a.scheduledArrival.getTime() - b.scheduledArrival.getTime();
    });

    for (const flight of sortedRemotes) {
        if (committedFlightIds.has(flight.id)) continue;

        const isWide = isFlightWide(flight);
        const isHeavy = isFlightHeavy(flight);
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const allowedConcourses = getAllowedBridgeConcourses(flight);

        let targetStand: StandSchedule | null = null;

        // Ordering candidate stands:
        // For narrowbodies: Try dedicated C/E/D1-D5 first, then MARS sub-stands (L/R), then single contact
        // For widebodies: Try single wide stands first, then MARS Center
        const candidateStands: StandSchedule[] = [];

        if (!isWide) {
            // Narrow: Concourse C & E & D1-D5 first
            for (const conc of allowedConcourses) {
                if (conc === 'Concourse C' || conc === 'Concourse E') {
                    for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                        const sched = topology.get(s);
                        if (sched) candidateStands.push(sched);
                    }
                }
            }
            if (allowedConcourses.includes('Concourse D')) {
                for (const s of ['D1', 'D2', 'D3', 'D4', 'D5']) {
                    const sched = topology.get(s);
                    if (sched) candidateStands.push(sched);
                }
            }
            // Next: MARS sub-stands (L/R)
            for (const conc of allowedConcourses) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && sched.isMarsSub && !candidateStands.includes(sched)) {
                        candidateStands.push(sched);
                    }
                }
            }
            // Next: Single contact stands (NEVER center stands for narrowbody!)
            for (const conc of allowedConcourses) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && !sched.isMarsSub && !sched.isMarsCenter && !candidateStands.includes(sched)) {
                        candidateStands.push(sched);
                    }
                }
            }
        } else {
            // Widebody: Single wide stands first, then MARS centers
            for (const conc of allowedConcourses) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && sched.isWideCompatible) {
                        if (!sched.isMarsSub && !sched.isMarsCenter) {
                            candidateStands.push(sched);
                        }
                    }
                }
            }
            for (const conc of allowedConcourses) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && sched.isMarsCenter && sched.isWideCompatible) {
                        candidateStands.push(sched);
                    }
                }
            }
        }

        // Test candidate stands
        for (const cand of candidateStands) {
            if (canFitOnStand(cand, arrMs, depMs, isWide, topology, isHeavy) && !hasMaintenanceConflict(cand.stand, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks)) {
                targetStand = cand;
                break;
            }
        }

        if (targetStand) {
            // Calculate revenue delta if moved to bridge
            const simulatedFlight: Flight = { ...flight, parkingPosition: targetStand.stand };
            const revAfter = calculateRevenue(simulatedFlight);
            const revBefore = calculateRevenue(flight);
            const revenueGain = Math.max(0, revAfter.totalEur - revBefore.totalEur);

            // Commit placement into working topology
            placeOnStand(targetStand, arrMs, depMs, flight.id);
            simulatedAssignments.set(flight.id, targetStand.stand);
            committedFlightIds.add(flight.id);

            const callsign = flight.departureFlightNumber || flight.arrivalFlightNumber || flight.id;
            const durHours = (getDurationMins(flight) / 60).toFixed(1);

            opportunities.push({
                id: `opp-gap-${flight.id}`,
                type: 'DIRECT_GAP_FILL',
                priority: getDurationMins(flight) <= 150 ? 'HIGH' : 'NORMAL',
                flightId: flight.id,
                callsign,
                aircraftType: flight.aircraftType || 'A/C',
                isWideBody: isWide,
                origin: flight.origin || 'IST',
                destination: flight.destination || 'IST',
                scheduledArrival: flight.scheduledArrival,
                scheduledDeparture: flight.scheduledDeparture,
                durationMins: Math.round(getDurationMins(flight)),
                currentPosition: flight.parkingPosition || 'Remote',
                targetPosition: targetStand.stand,
                targetConcourse: targetStand.concourse,
                revenueGainEur: Math.round(revenueGain),
                explanation: `${targetStand.stand} (${targetStand.concourse}) körüğü ${durHours} saatlik yatış penceresinde tamamen boş. ${callsign} açığa gönderilmek yerine doğrudan körüğe bağlanabilir.`,
                ruleBadges: [
                    isWide ? 'Geniş Gövde Körük' : 'Dar Gövde Körük',
                    'Sıfır Çakışma',
                    'Sıfır Tow (Maktu Yatış)',
                    `+€${Math.round(revenueGain)} KOİ Geliri`
                ]
            });
        }
    }

    // ---------------------------------------------------------------------------
    // Strategy 2: NARROWBODY CONSOLIDATION SWAPS
    // Relocate narrowbody on D6-D17 widebody stands to C/E, opening stand for remote widebody
    // ---------------------------------------------------------------------------
    const remainingRemoteWide = sortedRemotes.filter(f => isFlightWide(f) && !committedFlightIds.has(f.id));

    for (const remWide of remainingRemoteWide) {
        const wArr = remWide.scheduledArrival.getTime();
        const wDep = remWide.scheduledDeparture.getTime();
        const wConcs = getAllowedBridgeConcourses(remWide);
        const isHeavy = isFlightHeavy(remWide);

        let swapFound = false;

        // Find a widebody stand currently hosting a narrowbody during this window
        for (const conc of wConcs) {
            const stands = CONCOURSE_LAYOUT[conc] || [];
            for (const s of stands) {
                const sched = topology.get(s);
                if (!sched || !sched.isWideCompatible || sched.isMarsSub || sched.isMarsCenter) continue;

                // Look for an overlapping flight on this stand
                const overlappingIntervals = sched.intervals.filter((i: { start: number; end: number; flightId: string }) => i.start < wDep && i.end > wArr);
                if (overlappingIntervals.length !== 1) continue;

                const blockingFlightId = overlappingIntervals[0].flightId;
                const blockingFlight = flights.find(f => f.id === blockingFlightId);
                if (!blockingFlight || isFlightWide(blockingFlight)) continue;

                const bArr = blockingFlight.scheduledArrival.getTime();
                const bDep = blockingFlight.scheduledDeparture.getTime();
                const bConcs = getAllowedBridgeConcourses(blockingFlight);

                // Can the blocking narrowbody be safely relocated to an empty slot on Pier C, Pier E, or D1-D5?
                const narrowTargets: StandSchedule[] = [];
                for (const c of bConcs) {
                    if (c === 'Concourse C' || c === 'Concourse E') {
                        for (const ns of (CONCOURSE_LAYOUT[c] || [])) {
                            const nSched = topology.get(ns);
                            if (nSched) narrowTargets.push(nSched);
                        }
                    }
                }
                if (bConcs.includes('Concourse D')) {
                    for (const ns of ['D1', 'D2', 'D3', 'D4', 'D5']) {
                        const nSched = topology.get(ns);
                        if (nSched) narrowTargets.push(nSched);
                    }
                }

                let relocatedStand: StandSchedule | null = null;
                for (const ns of narrowTargets) {
                    if (canFitOnStand(ns, bArr, bDep, false, topology) && !hasMaintenanceConflict(ns.stand, blockingFlight.scheduledArrival, blockingFlight.scheduledDeparture, maintenanceBlocks)) {
                        relocatedStand = ns;
                        break;
                    }
                }

                if (relocatedStand) {
                    // Temporarily remove blocking flight from old stand
                    sched.intervals = sched.intervals.filter((i: { start: number; end: number; flightId: string }) => i.flightId !== blockingFlightId);

                    // Verify widebody can fit now without maintenance conflict
                    if (canFitOnStand(sched, wArr, wDep, true, topology, isHeavy) && !hasMaintenanceConflict(sched.stand, remWide.scheduledArrival, remWide.scheduledDeparture, maintenanceBlocks)) {
                        // Place narrowbody on new dedicated stand
                        placeOnStand(relocatedStand, bArr, bDep, blockingFlightId);
                        simulatedAssignments.set(blockingFlightId, relocatedStand.stand);

                        // Place widebody on liberated stand
                        placeOnStand(sched, wArr, wDep, remWide.id);
                        simulatedAssignments.set(remWide.id, sched.stand);
                        committedFlightIds.add(remWide.id);

                        const wCallsign = remWide.departureFlightNumber || remWide.arrivalFlightNumber || remWide.id;
                        const bCallsign = blockingFlight.departureFlightNumber || blockingFlight.arrivalFlightNumber || blockingFlight.id;

                        const revBefore = calculateRevenue(remWide);
                        const revAfter = calculateRevenue({ ...remWide, parkingPosition: sched.stand });
                        const revGain = Math.max(0, revAfter.totalEur - revBefore.totalEur);

                        opportunities.push({
                            id: `opp-cons-${remWide.id}`,
                            type: 'NARROW_CONSOLIDATION',
                            priority: 'HIGH',
                            flightId: remWide.id,
                            callsign: wCallsign,
                            aircraftType: remWide.aircraftType || 'Widebody',
                            isWideBody: true,
                            origin: remWide.origin || 'IST',
                            destination: remWide.destination || 'IST',
                            scheduledArrival: remWide.scheduledArrival,
                            scheduledDeparture: remWide.scheduledDeparture,
                            durationMins: Math.round(getDurationMins(remWide)),
                            currentPosition: remWide.parkingPosition || 'Remote',
                            targetPosition: sched.stand,
                            targetConcourse: sched.concourse,
                            revenueGainEur: Math.round(revGain),
                            relocatedFlight: {
                                flightId: blockingFlightId,
                                callsign: bCallsign,
                                aircraftType: blockingFlight.aircraftType || 'Dar Gövde',
                                fromPosition: sched.stand,
                                toPosition: relocatedStand.stand
                            },
                            explanation: `${sched.stand} geniş gövde köprüsünde duran dar gövdeli ${bCallsign}, Concourse ${relocatedStand.stand}'e kaydırıldı. Boşalan körüğe açıktaki ${wCallsign} (${remWide.aircraftType}) bağlandı.`,
                            ruleBadges: [
                                'Akıllı Konsolidasyon',
                                'Geniş Gövde Kurtarma',
                                'Sıfır Tow',
                                `+€${Math.round(revGain)} Ek Gelir`
                            ]
                        });

                        swapFound = true;
                        break;
                    } else {
                        // Revert
                        sched.intervals.push({ start: bArr, end: bDep, flightId: blockingFlightId });
                    }
                }
            }
            if (swapFound) break;
        }
    }

    // ---------------------------------------------------------------------------
    // Strategy 3: DOMESTIC LIBERATION SWAPS (İç Hat Tahliye Takası)
    // Relocate mixed flights (D-I / I-D) from Concourse G to Concourse A-F,
    // freeing Concourse G stands for pure domestic flights stuck on remote!
    // ---------------------------------------------------------------------------
    const remotePureDom = sortedRemotes.filter(f => 
        !committedFlightIds.has(f.id) &&
        (f.arrivalIsDomestic ?? f.isDomestic) && 
        (f.departureIsDomestic ?? f.isDomestic)
    );

    const concourseGStands = CONCOURSE_LAYOUT['Concourse G'] || [];

    for (const remDom of remotePureDom) {
        if (committedFlightIds.has(remDom.id)) continue;

        const dArr = remDom.scheduledArrival.getTime();
        const dDep = remDom.scheduledDeparture.getTime();
        const isDomWide = isFlightWide(remDom);
        if (isDomWide) continue;

        let liberationFound = false;

        for (const gStandName of concourseGStands) {
            const schedG = topology.get(gStandName);
            if (!schedG || schedG.isMarsCenter) continue;

            // Check overlapping flights on this G stand
            const overlapping = schedG.intervals.filter((i: { start: number; end: number; flightId: string }) => i.start < dDep && i.end > dArr);
            if (overlapping.length !== 1) continue;

            const blockingId = overlapping[0].flightId;
            const blockingFlight = flights.find(f => f.id === blockingId);
            if (!blockingFlight) continue;

            const isBlockingDomArr = blockingFlight.arrivalIsDomestic ?? blockingFlight.isDomestic;
            const isBlockingDomDep = blockingFlight.departureIsDomestic ?? blockingFlight.isDomestic;
            const isBlockingMixed = (isBlockingDomArr !== isBlockingDomDep);

            // Only mixed flights are eligible to be liberated from G to International piers!
            if (!isBlockingMixed) continue;

            const bArr = blockingFlight.scheduledArrival.getTime();
            const bDep = blockingFlight.scheduledDeparture.getTime();
            const bWide = isFlightWide(blockingFlight);

            // Can blocking mixed flight fit onto an open stand in Concourse A, B, C, D, E, F?
            let targetIntStand: StandSchedule | null = null;
            const intConcourses = ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F'];

            for (const ic of intConcourses) {
                for (const isName of (CONCOURSE_LAYOUT[ic] || [])) {
                    const isSched = topology.get(isName);
                    if (isSched && canFitOnStand(isSched, bArr, bDep, bWide, topology)) {
                        targetIntStand = isSched;
                        break;
                    }
                }
                if (targetIntStand) break;
            }

            if (targetIntStand) {
                // Temporarily remove blocking flight from G stand
                schedG.intervals = schedG.intervals.filter((i: { start: number; end: number; flightId: string }) => i.flightId !== blockingId);

                if (canFitOnStand(schedG, dArr, dDep, false, topology)) {
                    // Place blocking flight on target international stand
                    placeOnStand(targetIntStand, bArr, bDep, blockingId);
                    simulatedAssignments.set(blockingId, targetIntStand.stand);

                    // Place remote domestic flight on liberated G stand
                    placeOnStand(schedG, dArr, dDep, remDom.id);
                    simulatedAssignments.set(remDom.id, schedG.stand);
                    committedFlightIds.add(remDom.id);

                    const dCallsign = remDom.departureFlightNumber || remDom.arrivalFlightNumber || remDom.id;
                    const bCallsign = blockingFlight.departureFlightNumber || blockingFlight.arrivalFlightNumber || blockingFlight.id;

                    const revBefore = calculateRevenue(remDom);
                    const revAfter = calculateRevenue({ ...remDom, parkingPosition: schedG.stand });
                    const revGain = Math.max(0, revAfter.totalEur - revBefore.totalEur);

                    opportunities.push({
                        id: `opp-dom-${remDom.id}`,
                        type: 'DOMESTIC_LIBERATION_SWAP',
                        priority: 'HIGH',
                        flightId: remDom.id,
                        callsign: dCallsign,
                        aircraftType: remDom.aircraftType || 'Dar Gövde',
                        isWideBody: false,
                        origin: remDom.origin || 'IST',
                        destination: remDom.destination || 'IST',
                        scheduledArrival: remDom.scheduledArrival,
                        scheduledDeparture: remDom.scheduledDeparture,
                        durationMins: Math.round(getDurationMins(remDom)),
                        currentPosition: remDom.parkingPosition || 'Remote',
                        targetPosition: schedG.stand,
                        targetConcourse: 'Concourse G',
                        revenueGainEur: Math.round(revGain),
                        relocatedFlight: {
                            flightId: blockingId,
                            callsign: bCallsign,
                            aircraftType: blockingFlight.aircraftType || 'Uçak',
                            fromPosition: schedG.stand,
                            toPosition: targetIntStand.stand
                        },
                        explanation: `Concourse G'de duran karma uçuş (${bCallsign}), Dış Hat ${targetIntStand.stand} (${targetIntStand.concourse}) körüğüne kaydırıldı. Açılan G körüğüne açıktaki Saf İç Hat uçuşu ${dCallsign} bağlandı.`,
                        ruleBadges: [
                            'İç Hat Tahliye Takası',
                            'Saf İç Hat Kurtarma',
                            'G ➔ Dış Hat',
                            'Sıfır Tow',
                            `+€${Math.round(revGain)} KOİ Geliri`
                        ]
                    });

                    liberationFound = true;
                    break;
                } else {
                    // Revert
                    schedG.intervals.push({ start: bArr, end: bDep, flightId: blockingId });
                }
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Operational Bottleneck Diagnostics (OCC Teşhis & Kısıt Analizi)
    // ---------------------------------------------------------------------------
    let remoteLongStayCount = 0; // 4 - 8 hours
    let remoteVeryLongStayCount = 0; // > 8 hours
    let remotePureDomCount = 0;
    let remoteTurbopropCount = 0;
    let cargoCount = 0;
    let gaCount = 0;

    flights.forEach(f => {
        if (isCargoFlight(f)) { cargoCount++; return; }
        if (isPropellerAircraft(f.aircraftType)) { remoteTurbopropCount++; return; }
        if (f.parkingPosition && !isContactStand(f.parkingPosition)) {
            const durH = getDurationMins(f) / 60;
            if (durH > 8) remoteVeryLongStayCount++;
            else if (durH > 4) remoteLongStayCount++;

            const isDomArr = f.arrivalIsDomestic ?? f.isDomestic;
            const isDomDep = f.departureIsDomestic ?? f.isDomestic;
            if (isDomArr && isDomDep) remotePureDomCount++;
        }
    });

    const diagnostics: CopilotDiagnostics = {
        remoteLongStayCount,
        remoteVeryLongStayCount,
        remotePureDomCount,
        remoteTurbopropCount,
        cargoCount,
        gaCount
    };

    // ---------------------------------------------------------------------------
    // Summary KPI Projections
    // ---------------------------------------------------------------------------
    const netGainFlights = opportunities.length;
    const potentialBridgeCount = currentBridgeCount + netGainFlights;
    const potentialBridgeRate = eligiblePaxCount > 0 ? (potentialBridgeCount / eligiblePaxCount) * 100 : 0;
    const netGainRevenueEur = opportunities.reduce((sum, o) => sum + o.revenueGainEur, 0);
    const potentialRevenueEur = currentRevenueEur + netGainRevenueEur;

    const stats: CopilotStats = {
        totalFlights: flights.length,
        eligiblePaxCount,
        currentBridgeCount,
        currentRemoteCount,
        currentBridgeRate,
        currentRevenueEur,
        potentialBridgeCount,
        potentialBridgeRate,
        potentialRevenueEur,
        netGainFlights,
        netGainRevenueEur
    };

    // Executive briefing in Turkish
    const rateDiff = (potentialBridgeRate - currentBridgeRate).toFixed(1);
    const executiveBriefing = `OCC Co-Pilot analizi tamamlandı: Mevcut planda %${currentBridgeRate.toFixed(1)} olan körük kullanım oranı, sıfır tow kuralı korunarak %${potentialBridgeRate.toFixed(1)} seviyesine (+%${rateDiff}) çıkarılabilir. Toplam +${netGainFlights} ilave yolcu uçağı körüğe bağlanarak havalimanına +€${netGainRevenueEur.toLocaleString('tr-TR')} ek KOİ köprü/ekipman geliri (PBB, GPU, PCA, Su, VDGS) kazandırılabilir.`;

    return {
        stats,
        opportunities,
        executiveBriefing,
        diagnostics
    };
}

/**
 * Apply a single Co-Pilot opportunity to the flight dataset.
 */
export function applyCopilotOpportunity(flights: Flight[], opp: CopilotOpportunity): Flight[] {
    return flights.map(f => {
        if (f.id === opp.flightId) {
            return {
                ...f,
                parkingPosition: opp.targetPosition
            };
        }
        if (opp.relocatedFlight && f.id === opp.relocatedFlight.flightId) {
            return {
                ...f,
                parkingPosition: opp.relocatedFlight.toPosition
            };
        }
        return f;
    });
}

/**
 * Apply all detected Co-Pilot opportunities in one atomic click.
 */
export function applyAllCopilotOpportunities(flights: Flight[], opportunities: CopilotOpportunity[]): Flight[] {
    const flightUpdates = new Map<string, string>();

    opportunities.forEach(opp => {
        flightUpdates.set(opp.flightId, opp.targetPosition);
        if (opp.relocatedFlight) {
            flightUpdates.set(opp.relocatedFlight.flightId, opp.relocatedFlight.toPosition);
        }
    });

    return flights.map(f => {
        if (flightUpdates.has(f.id)) {
            return {
                ...f,
                parkingPosition: flightUpdates.get(f.id)!
            };
        }
        return f;
    });
}
