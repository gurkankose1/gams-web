import { Flight } from '../types.ts';
import { CONCOURSE_LAYOUT, TURKISH_DOMESTIC_AIRPORTS } from '../constants.ts';

// ----------------------------------------------------------------------
// 1. Aircraft Classification Rules
// ----------------------------------------------------------------------

export const WINGLET_AIRCRAFT_TYPES = new Set([
    'B738', '738', '73H', '73W', 'B739', '739', '73J',
    'B38M', '73M', 'B39M',
    'A20N', 'A320N', 'A21N', 'A321N',
    'A359', 'A35K',
    'B788', 'B789', 'B781',
    'E195', 'E295', 'SU95', 'CRJX'
]);

export function isWingletAircraft(aircraftType: string, rawData?: any): boolean {
    if (!aircraftType) return false;
    const cleanType = aircraftType.toUpperCase().trim();
    if (WINGLET_AIRCRAFT_TYPES.has(cleanType)) return true;
    if (cleanType.includes('MAX') || cleanType.includes('NEO') || cleanType.endsWith('W') || cleanType.endsWith('N')) return true;
    if (rawData && (rawData.Winglet === true || String(rawData.Winglet).toLowerCase() === 'true')) return true;
    return false;
}

export const PROPELLER_AIRCRAFT_TYPES = new Set([
    'ATR72', 'AT72', 'AT75', 'AT76', 'ATR', 'DH8D', 'DH8', 'DHC8', 'CRJX', 'C560'
]);

export function isPropellerAircraft(aircraftType: string): boolean {
    if (!aircraftType) return false;
    const cleanType = aircraftType.toUpperCase().trim();
    return PROPELLER_AIRCRAFT_TYPES.has(cleanType);
}

export type AircraftCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export function getAircraftCategory(aircraftType: string): AircraftCategory {
    if (!aircraftType) return 'C';
    const cleanType = aircraftType.toUpperCase().trim();

    // Heavy / Super Widebody (Category F)
    if (['B748', 'B744', 'B747', '748', '744', '747', 'A380', '380', 'AN124', 'A124'].includes(cleanType)) {
        return 'F';
    }

    // Widebody (Category D / E)
    if (['A330', 'A332', 'A333', 'A338', 'A339', '330', '332', '333',
         'A340', 'A343', 'A345', 'A346', '340',
         'A359', 'A35K', '359', '351',
         'B767', 'B762', 'B763', 'B764', '763',
         'B777', 'B772', 'B77W', 'B77L', 'B77X', '77W', '772', '77L',
         'B787', 'B788', 'B789', 'B781', '788', '789'].includes(cleanType)) {
        return 'E';
    }

    // Small / Regional (Category A / B)
    if (['ATR72', 'AT72', 'DH8D', 'DH8', 'CRJ2', 'CRJ7', 'CRJ9', 'E145', 'C560'].includes(cleanType)) {
        return 'B';
    }

    // Default Narrowbody (Category C: A320 family, B737 family, CS300, E190, SU95)
    return 'C';
}

export function isCargoFlight(flight: Flight): boolean {
    const airline = (flight.airline || '').toUpperCase().trim();
    if (airline === '7L' || airline === 'EP' || airline === 'FX' || airline === '5Y' || airline === 'QY' || airline === 'RU') return true;
    const arrNo = (flight.arrivalFlightNumber || '').toUpperCase();
    const depNo = (flight.departureFlightNumber || '').toUpperCase();
    if (arrNo.startsWith('7L') || depNo.startsWith('7L') || arrNo.startsWith('EP') || depNo.startsWith('EP')) return true;
    
    const raw = flight.raw_data || {};
    const qualifier = String(raw.Qualifier || raw['Arr Qualifier'] || raw['Dep Qualifier'] || '').toUpperCase();
    if (qualifier === 'F' || qualifier === 'H') return true;
    
    return false;
}

// ----------------------------------------------------------------------
// 2. Winglet Adjacent Stand Rules (PDF 1)
// ----------------------------------------------------------------------

export const WINGLET_ADJACENT_MAP: Record<string, string[]> = {
    '100': ['101'],
    '101': ['100', '102'],
    '102': ['101', '103'],
    '103': ['102', '104'],
    '104': ['103', '105'],
    '105': ['104', '106'],
    '106': ['105', '107'],
    '107': ['106', '108'],
    '108': ['107'],
    '110': ['111'],
    '111': ['110', '112'],
    '112': ['111', '113'],
    '113': ['112', '114'],
    '114': ['113', '115'],
    '115': ['114', '116'],
    '116': ['115', '117'],
    '117': ['116', '118'],
    '118': ['117', '119'],
    '119': ['118', '120'],
    '120': ['119', '121'],
    '121': ['120'],
    '122': ['123'],
    '123': ['122', '124'],
    '124': ['123', '125'],
    '125': ['124', '126'],
    '126': ['125', '127'],
    '127': ['126', '128'],
    '128': ['127', '129'],
    '129': ['128', '130'],
    '130': ['129', '131'],
    '131': ['130', '200'],
    '200': ['131'],
};

// ----------------------------------------------------------------------
// 3. MARS Center vs Sub-Stands Rules (PDF 3)
// ----------------------------------------------------------------------

export function getMarsRelatedPositions(pos: string): { center: string; subStands: string[]; isSubStand: boolean } {
    const isSub = pos.endsWith('L') || pos.endsWith('R');
    let center = pos;
    if (isSub) {
        center = pos.slice(0, -1);
    }
    const left = `${center}L`;
    const right = `${center}R`;
    
    const subStands = isSub ? [center] : [left, right];
    return { center, subStands, isSubStand: isSub };
}

// ----------------------------------------------------------------------
// 4. Contact Stand vs Remote Apron Classifier
// ----------------------------------------------------------------------

export function isContactStand(pos: string): boolean {
    const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(pos));
    if (!concourse) return false;
    return ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F', 'Concourse G'].includes(concourse);
}

export function isDomesticConcourse(pos: string): boolean {
    const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(pos));
    return concourse === 'Concourse G';
}

export function isInternationalConcourse(pos: string): boolean {
    const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(pos));
    if (!concourse) return false;
    return ['Concourse A', 'Concourse B', 'Concourse C', 'Concourse D', 'Concourse E', 'Concourse F'].includes(concourse);
}

export const CAT_F_HEAVY_STANDS = new Set([
    '215', '216', '217', '218', '219',
    '313', '314', '315', '316', '317', '318', '319',
    'H10', 'H11', 'H12', 'H13', 'H14',
    'H20', 'H21', 'H22', 'H23', 'H24', 'H25',
    'H30', 'H31', 'H32', 'H33', 'H34', 'H35', 'H36',
    'H40', 'H41', 'H42', 'H43', 'H44', 'H45', 'H46',
    'H50', 'H51', 'K53', 'MTA'
]);

// ----------------------------------------------------------------------
// 5. Master Validation Engine
// ----------------------------------------------------------------------

export interface ValidationResult {
    isValid: boolean;
    reasons: string[];
}

export function validateFlightPlacement(
    flight: Flight,
    targetPosition: string,
    allFlights: Flight[],
    ruleOverrides?: Set<string>,
    globalSuperSet?: boolean
): ValidationResult {
    // If override is enabled for this flight, pass validation
    if (ruleOverrides && ruleOverrides.has(flight.id)) {
        return { isValid: true, reasons: [] };
    }

    const reasons: string[] = [];
    const isSuperSet = flight.isSuperSet === true || globalSuperSet === true;

    const category = getAircraftCategory(flight.aircraftType);
    const isWide = category === 'D' || category === 'E' || category === 'F';
    const isHeavy = category === 'F';
    const isWinglet = isWingletAircraft(flight.aircraftType, flight.raw_data);
    const isProp = isPropellerAircraft(flight.aircraftType);
    const isCargo = isCargoFlight(flight);

    const flightArr = flight.scheduledArrival.getTime();
    const flightDep = flight.scheduledDeparture.getTime();

    // --- RULE A: MARS / Widebody Center Stand Requirement (PDF 3) ---
    const mars = getMarsRelatedPositions(targetPosition);
    if (isWide && mars.isSubStand) {
        reasons.push(`Geniş gövdeli uçak (${flight.aircraftType}) L/R alt pozisyona (${targetPosition}) park edemez. Center pozisyona (${mars.center}) verilmeli.`);
    }

    // --- RULE B: MARS Overlap Conflicts (Center vs L/R Occupancy) ---
    const overlappingMarsFlights = allFlights.filter(f => 
        f.id !== flight.id &&
        !!f.parkingPosition &&
        mars.subStands.includes(f.parkingPosition!) &&
        flightArr < f.scheduledDeparture.getTime() &&
        flightDep > f.scheduledArrival.getTime()
    );
    if (overlappingMarsFlights.length > 0) {
        const conflictingPos = overlappingMarsFlights.map(f => f.parkingPosition).join(', ');
        reasons.push(`MARS çakışması: Bağlantılı pozisyonda (${conflictingPos}) aktif uçuş bulunmaktadır.`);
    }

    // --- RULE C: Winglet Adjacent Combination Rules (PDF 1) ---
    if (isWinglet && WINGLET_ADJACENT_MAP[targetPosition]) {
        const adjacentStands = WINGLET_ADJACENT_MAP[targetPosition];
        const conflictingWingletFlights = allFlights.filter(f =>
            f.id !== flight.id &&
            !!f.parkingPosition &&
            adjacentStands.includes(f.parkingPosition!) &&
            isWingletAircraft(f.aircraftType, f.raw_data) &&
            flightArr < f.scheduledDeparture.getTime() &&
            flightDep > f.scheduledArrival.getTime()
        );
        if (conflictingWingletFlights.length > 0) {
            const adjacentPos = conflictingWingletFlights.map(f => f.parkingPosition).join(', ');
            reasons.push(`Winglet Çakışması: Komşu pozisyonda (${adjacentPos}) başka bir wingletli uçak park etmektedir.`);
        }
    }

    // --- RULE D: Heavy Category F Stand Restriction (PDF 2) ---
    if (isHeavy) {
        const basePos = targetPosition.replace(/[LR]$/, '');
        if (!CAT_F_HEAVY_STANDS.has(basePos) && !CAT_F_HEAVY_STANDS.has(targetPosition)) {
            reasons.push(`Ağır Geniş Gövde (${flight.aircraftType}) bu pozisyona park edemez. Ağır stantlara (215-219, 313-319, H10-H51 vb.) verilmeli.`);
        }
    }

    // --- SUPER SET EXEMPTION: Bypasses Destination / Route / Int-Dom / Cargo / Propeller restrictions ---
    if (!isSuperSet) {
        // --- RULE E: Propeller / Turboprop Contact Stand Restriction (PDF 2) ---
        if (isProp && isContactStand(targetPosition)) {
            reasons.push(`Pervaneli / Turboprop uçak (${flight.aircraftType}) Körük (Pier A-G) pozisyonuna park edemez. Remote Apron (H) kullanmalı.`);
        }

        // --- RULE F: Domestic vs International Concourse Rules (PDF 2) ---
        let isDepartureDomestic: boolean | null = null;
        if (flight.type === 'turnaround') {
            isDepartureDomestic = flight.departureIsDomestic ?? flight.isDomestic;
        } else if (flight.type === 'departure') {
            isDepartureDomestic = flight.isDomestic;
        } else if (flight.type === 'arrival') {
            isDepartureDomestic = flight.arrivalIsDomestic ?? flight.isDomestic;
        }

        if (isDepartureDomestic !== null) {
            if (isDomesticConcourse(targetPosition) && !isDepartureDomestic) {
                reasons.push(`Dış hat uçuşu İç hat körüğüne (${targetPosition}) park edemez.`);
            }
            if (isInternationalConcourse(targetPosition) && isDepartureDomestic) {
                reasons.push(`İç hat uçuşu Dış hat körüğüne (${targetPosition}) park edemez.`);
            }
        }

        // --- RULE G: Cargo Flight Apron Restrictions (PDF 2) ---
        if (isCargo) {
            const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(targetPosition)) || '';
            if (isContactStand(targetPosition) && !concourse.includes('CARGO')) {
                reasons.push(`Kargo uçuşu yolcu körüğüne (${targetPosition}) park edemez. Kargo Apronu kullanmalı.`);
            }
        }
    }

    return {
        isValid: reasons.length === 0,
        reasons
    };
}
