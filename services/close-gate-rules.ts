import type { Flight } from '../types.ts';

/**
 * ABD, İngiltere ve Kanada Gidiş Destinasyonları — Close Gate Kuralları (Soft Priority)
 * Altın Kural: Köprü kullanım oranını ASLA azaltmadan ve ideal tampon/gölge kurallarından
 * feragat etmeden bu seferleri öncelikli close gate'lere yönlendirir.
 */

export const CLOSE_GATE_WIDE_TIER1 = new Set([
    'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15'
]);

export const CLOSE_GATE_WIDE_TIER2 = new Set([
    'D6', 'D16', 'D17'
]);

export const CLOSE_GATE_WIDE_TIER3 = new Set([
    'B4', 'B10', 'B12', 'A7'
]);

export const CLOSE_GATE_NARROW_BASES = [
    'A2', 'A3', 'A5', 'A6', 'A11',
    'B1', 'B3', 'B5', 'B7',
    'D5',
    'F1', 'F3', 'F5', 'F7', 'F8'
];

export const CLOSE_GATE_NARROW_TIER1 = new Set<string>(
    CLOSE_GATE_NARROW_BASES.flatMap(b => b === 'D5' ? ['D5'] : [b, `${b}L`, `${b}R`])
);

const CLOSE_GATE_COUNTRY_KEYWORDS = [
    'UNITED STATES', 'USA', 'U.S.A', 'AMERIKA', 'ABD',
    'UNITED KINGDOM', 'GREAT BRITAIN', 'ENGLAND', 'SCOTLAND', 'WALES', 'NORTHERN IRELAND', 'INGILTERE', 'İNGİLTERE', 'BIRLESIK KRALLIK', 'BİRLEŞİK KRALLIK',
    'CANADA', 'KANADA'
];

const CLOSE_GATE_COUNTRY_CODES = new Set(['US', 'USA', 'UK', 'GB', 'GBR', 'CA', 'CAN']);

// Kapsamlı ABD, İngiltere ve Kanada IATA Havalimanı Kodları (DepCountry boş olsa bile kesin tespit!)
const US_UK_CA_AIRPORTS = new Set([
    // USA
    'JFK', 'EWR', 'LGA', 'IAD', 'DCA', 'BWI', 'BOS', 'ORD', 'MDW', 'ATL',
    'MIA', 'FLL', 'MCO', 'TPA', 'IAH', 'HOU', 'DFW', 'DAL', 'LAX', 'SFO',
    'SJC', 'OAK', 'SEA', 'DTW', 'DEN', 'PHL', 'CLT', 'MSP', 'PHX', 'LAS',
    'SAN', 'PDX', 'SLC', 'AUS', 'BNA', 'RDU', 'CVG', 'CLE', 'PIT', 'IND',
    'MCI', 'STL', 'MSY', 'RSW', 'PBI', 'HNL', 'ANC', 'SJU', 'MEM', 'SDF',
    // United Kingdom
    'LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN', 'MAN', 'BHX', 'EDI', 'GLA',
    'BRS', 'NCL', 'LPL', 'EMA', 'LBA', 'ABZ', 'BFS', 'BHD', 'CWL', 'SOU',
    'BOH', 'EXT', 'INV', 'PIK', 'DSA', 'MME', 'NQY',
    // Canada
    'YYZ', 'YTZ', 'YUL', 'YVR', 'YYC', 'YEG', 'YOW', 'YHZ', 'YWG', 'YQB',
    'YYJ', 'YLW', 'YXE', 'YQR', 'YYT', 'YQM', 'YFC', 'YXY', 'YZF'
]);

/**
 * Yalnızca GİDİŞ (Departure) destinasyonu ABD, İngiltere veya Kanada olan uçuşları tespit eder.
 * Arrival-only bacaklar hariçtir (güvenlik/close gate gidiş yolcusu içindir).
 */
export function isCloseGateRequiredDeparture(f: Flight): boolean {
    if (f.type === 'arrival') return false;
    if (!f.departureFlightNumber && !f.destination) return false;

    const dest = (f.destination || '').toUpperCase().trim();
    if (dest && US_UK_CA_AIRPORTS.has(dest)) return true;

    const raw = f.raw_data || {};
    const toStation = String(raw['To Station'] || raw['DepToStatition'] || raw['ToStation'] || '').toUpperCase().trim();
    if (toStation && US_UK_CA_AIRPORTS.has(toStation)) return true;

    const depCountry = String(raw['DepCountry'] || raw['Dep Country'] || raw['Country'] || '').toUpperCase().trim();
    if (depCountry) {
        if (CLOSE_GATE_COUNTRY_CODES.has(depCountry)) return true;
        if (CLOSE_GATE_COUNTRY_KEYWORDS.some(k => depCountry.includes(k))) return true;
    }

    return false;
}

/**
 * Verilen standın bu uçak (geniş/dar gövde) için Close Gate öncelik kademesini döndürür.
 * 1 = Birincil Close Gate, 2 = Alternatif (D6/D16/D17), 3 = Yedek (B4/B10/B12/A7), 0 = Normal Stand
 */
export function getCloseGateTier(stand: string, isWide: boolean): 0 | 1 | 2 | 3 {
    const s = (stand || '').toUpperCase().trim();
    if (!s) return 0;
    if (isWide) {
        if (CLOSE_GATE_WIDE_TIER1.has(s)) return 1;
        if (CLOSE_GATE_WIDE_TIER2.has(s)) return 2;
        if (CLOSE_GATE_WIDE_TIER3.has(s)) return 3;
        return 0;
    } else {
        if (CLOSE_GATE_NARROW_TIER1.has(s)) return 1;
        return 0;
    }
}

/**
 * Soft öncelik puanı (yüksek = daha çok tercih edilir).
 * Geniş gövde: Tier 1 (+300) > Tier 2 (+180) > Tier 3 (+80) > Diğer (0)
 * Dar gövde: Tier 1 (+240) > Diğer (0)
 */
export function getCloseGateStandBonus(f: Flight, stand: string, isWide: boolean): number {
    if (!isCloseGateRequiredDeparture(f)) return 0;
    const tier = getCloseGateTier(stand, isWide);
    if (isWide) {
        if (tier === 1) return 300;
        if (tier === 2) return 180;
        if (tier === 3) return 80;
        return 0;
    }
    return tier === 1 ? 240 : 0;
}
