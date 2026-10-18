import { Flight } from '../types.ts';
import { CONCOURSE_LAYOUT, TURKISH_DOMESTIC_AIRPORTS, PARKING_POSITIONS } from '../constants.ts';

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
    if (['B748', 'B744', 'B747', '748', '744', '747', '74Y', 'A380', 'A388', '380', '388', 'AN124', 'A124'].includes(cleanType)) {
        return 'F';
    }

    // Widebody (Category D / E)
    if (['A330', 'A332', 'A333', 'A338', 'A339', '330', '332', '333', '338', '339',
         'A340', 'A342', 'A343', 'A345', 'A346', '340', '342', '343', '345', '346',
         'A359', 'A35K', 'A350', '359', '351', '350',
         'B767', 'B762', 'B763', 'B764', '767', '762', '763', '764',
         'B777', 'B772', 'B77W', 'B77L', 'B773', 'B77X', '77W', '772', '77L', '773', '77X', '777',
         'B787', 'B788', 'B789', 'B781', '787', '788', '789', '781',
         'A306', 'A310', 'A300', '306', '310', '300',
         'IL96', 'MD11', 'DC10'].includes(cleanType)) {
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

export function getMarsRelatedPositions(pos: string): { center: string; subStands: string[]; isSubStand: boolean; hasSubStands: boolean } {
    const isSub = pos.endsWith('L') || pos.endsWith('R');
    let center = pos;
    if (isSub) {
        center = pos.slice(0, -1);
    }
    const left = `${center}L`;
    const right = `${center}R`;
    
    const existingSubs = [left, right].filter(s => PARKING_POSITIONS.includes(s));
    const subStands = isSub ? [center] : existingSubs;
    const hasSubStands = existingSubs.length > 0;
    return { center, subStands, isSubStand: isSub, hasSubStands };
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
    'A2', // Primary Contact Gate for A380 / Super Heavy (EK123/EK124)
    '215', '216', '217', '218', '219',
    '313', '314', '315', '316', '317', '318', '319',
    'H10', 'H11', 'H12', 'H13', 'H14',
    'H20', 'H21', 'H22', 'H23', 'H24', 'H25',
    'H30', 'H31', 'H32', 'H33', 'H34', 'H35', 'H36',
    'H40', 'H41', 'H42', 'H43', 'H44', 'H45', 'H46',
    'H50', 'H51', 'K53', 'MTA'
]);

export const NARROW_ONLY_CONTACT_STANDS = new Set([
    'C1', 'C2', 'C3', 'C4',
    'E1', 'E2', 'E3', 'E4',
    'D1', 'D2', 'D3', 'D4', 'D5',
    'B2', 'F2'
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
    const isWide = flight.acCategory === 'D' || flight.acCategory === 'E' || flight.acCategory === 'F' || category === 'D' || category === 'E' || category === 'F';
    const isHeavy = flight.acCategory === 'F' || category === 'F';
    const isWinglet = isWingletAircraft(flight.aircraftType, flight.raw_data);
    const isProp = isPropellerAircraft(flight.aircraftType);
    const isCargo = isCargoFlight(flight);

    const flightArr = flight.scheduledArrival.getTime();
    const flightDep = flight.scheduledDeparture.getTime();

    // --- RULE A: MARS / Widebody & Narrowbody Stand Restriction (PDF 3) ---
    const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(targetPosition));
    const isNarrowOnlyContact = concourse === 'Concourse C' || concourse === 'Concourse E' || NARROW_ONLY_CONTACT_STANDS.has(targetPosition);
    const mars = getMarsRelatedPositions(targetPosition);
    if (isWide) {
        if (mars.isSubStand) {
            reasons.push(`Geniş gövdeli uçak (${flight.aircraftType}) L/R alt pozisyona (${targetPosition}) park edemez. Center pozisyona (${mars.center}) verilmeli.`);
        } else if (isNarrowOnlyContact) {
            reasons.push(`Geniş gövdeli uçak (${flight.aircraftType}) dar gövde körük pozisyonuna (${targetPosition}) park edemez. C, E ve D1-D5 iskeleleri yalnızca dar gövde (Cat C) içindir.`);
        }
    } else {
        // Narrowbody (Cat A, B, C): Cannot park on a MARS Center stand if L/R sub-stands exist
        if (!mars.isSubStand && mars.hasSubStands) {
            reasons.push(`Dar gövdeli uçak (${flight.aircraftType}) MARS Center pozisyonuna (${targetPosition}) park edemez. L veya R alt pozisyonuna (${targetPosition}L / ${targetPosition}R) park etmelidir.`);
        }
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
        const isArrDom = flight.type === 'turnaround' ? (flight.arrivalIsDomestic ?? flight.isDomestic) : flight.isDomestic;
        const isDepDom = flight.type === 'turnaround' ? (flight.departureIsDomestic ?? flight.isDomestic) : flight.isDomestic;

        // 1. Saf İç Hat (İç - İç): Dış hat körüklerine park edemez, Concourse G veya Remote kullanmalı
        if (isArrDom && isDepDom && isInternationalConcourse(targetPosition)) {
            reasons.push(`Saf İç hat uçuşu (${flight.arrivalFlightNumber || ''}/${flight.departureFlightNumber || ''}) Dış hat körüğüne (${targetPosition}) park edemez.`);
        }

        // 2. Saf Dış Hat (Dış - Dış): İç hat körüğüne (Concourse G) park edemez, Dış hat körükleri kullanmalı
        if (!isArrDom && !isDepDom && isDomesticConcourse(targetPosition)) {
            reasons.push(`Saf Dış hat uçuşu (${flight.arrivalFlightNumber || ''}/${flight.departureFlightNumber || ''}) İç hat körüğüne (${targetPosition}) park edemez.`);
        }

        // 3. Karma Uçuşlar (Dış - İç veya İç - Dış): İstediği körüğe (A-G) park edebilir, kural ihlali sayılmaz!

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
