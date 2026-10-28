import { Flight } from '../types.ts';

export interface FidsPublicationStatus {
    isPublished: boolean;
    thresholdMinutes: number; // 75, 90, or 120
    minutesUntilDeparture: number;
    destinationType: 'SPECIAL_SECURITY' | 'DISTANT_PIER' | 'STANDARD';
    reason: string;
}

// Special Security Destinations from GATE__PARAMETRELER_20_Kasm_2025_.xlsx (STD/ETD - 120 minutes)
export const FIDS_SPECIAL_SECURITY_DESTINATIONS = new Set([
    'USA', 'UNITED STATES', 'ENGLAND', 'UNITED KINGDOM', 'UK', 'LONDON', 'LHR', 'LGW', 'MAN', 'BHX',
    'CANADA', 'TORONTO', 'YYZ', 'YVR', 'YUL', 'YYC',
    'IRELAND', 'DUBLIN', 'DUB',
    'ISRAEL', 'TEL-AVIV', 'TEL AVIV', 'TLV',
    'COLOMBIA', 'BOGOTA', 'BOG',
    'VENEZUELA', 'CARACAS', 'CCS',
    'MEXICO', 'CANCUN', 'CUN', 'MEXICO CITY', 'MEX',
    'ARGENTINA', 'BUENOS AIRES', 'EZE',
    'BRAZIL', 'SAO PAULO', 'GRU',
    'CUBA', 'HAVANA', 'HAV',
    'PANAMA', 'PANAMA CITY', 'PTY'
]);

// Distant Pier Gates from GATE__PARAMETRELER_20_Kasm_2025_.xlsx (STD/ETD - 90 minutes)
export const FIDS_DISTANT_PIER_GATES = new Set([
    // Concourse A
    'A6A', 'A6B', 'A7A', 'A7B', 'A8A', 'A8B', 'A9', 'A10A', 'A10B', 'A11A', 'A11B',
    // Concourse B
    'B7A', 'B7B', 'B8A', 'B8B', 'B9A', 'B9B', 'B10A', 'B10B', 'B12A', 'B12B', 
    'B13', 'B14', 'B15', 'B16', 'B17', 'B18A', 'B18B',
    // Concourse D
    'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17',
    // Concourse F
    'F7A', 'F7B', 'F8A', 'F8B', 'F9A', 'F9B', 'F12A', 'F12B', 'F13A', 'F13B', 
    'F14', 'F15', 'F16', 'F17', 'F18', 'F19'
]);

/**
 * Checks if a distant pier gate matches (handles variants like A6, A6A, A6B, etc.)
 */
export function isDistantPierGate(gateStr: string): boolean {
    if (!gateStr) return false;
    const clean = gateStr.toUpperCase().trim();
    if (FIDS_DISTANT_PIER_GATES.has(clean)) return true;
    return /^(A[6-9]|A1[0-1]|B[7-9]|B1[0-8]|D[6-9]|D1[0-7]|F[7-9]|F1[2-9])/.test(clean);
}

/**
 * Checks whether a destination is a special security destination (120 min)
 */
export function isSpecialSecurityDestination(destStr: string, countryStr?: string): boolean {
    const combined = `${destStr || ''} ${countryStr || ''}`.toUpperCase();
    for (const term of FIDS_SPECIAL_SECURITY_DESTINATIONS) {
        if (combined.includes(term)) return true;
    }
    return false;
}

/**
 * Evaluates the FIDS publication status of a flight based on official IGA gate parameters.
 */
export function getFidsPublicationStatus(flight: Flight, referenceTime: Date = new Date()): FidsPublicationStatus {
    const raw = flight.raw_data || {};
    const depTime = flight.scheduledDeparture;
    const diffMs = depTime.getTime() - referenceTime.getTime();
    const diffMinutes = Math.round(diffMs / (60 * 1000));

    const dest = flight.destination || raw['To Station'] || raw.ToStation || '';
    const country = raw.DepCountry || raw.ArrCountry || raw.ToStation || '';
    const gate = flight.gate || raw.Gate || raw.DepGate || '';

    // 1. Special Security Check (120 min)
    if (isSpecialSecurityDestination(dest, country)) {
        return {
            isPublished: diffMinutes <= 120,
            thresholdMinutes: 120,
            minutesUntilDeparture: diffMinutes,
            destinationType: 'SPECIAL_SECURITY',
            reason: 'Özel Güvenlikli Destinasyon (STD/ETD - 120 dk eşiği)'
        };
    }

    // 2. Distant Pier Check (90 min)
    if (isDistantPierGate(gate)) {
        return {
            isPublished: diffMinutes <= 90,
            thresholdMinutes: 90,
            minutesUntilDeparture: diffMinutes,
            destinationType: 'DISTANT_PIER',
            reason: 'Uzak İskele Kapısı (STD/ETD - 90 dk eşiği)'
        };
    }

    // 3. Standard Close Gates (75 min)
    return {
        isPublished: diffMinutes <= 75,
        thresholdMinutes: 75,
        minutesUntilDeparture: diffMinutes,
        destinationType: 'STANDARD',
        reason: 'Standart Kapı (STD/ETD - 75 dk eşiği)'
    };
}
