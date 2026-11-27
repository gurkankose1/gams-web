import type { Flight, FlightShadowInfo, PlanningTimeMode } from '../types.ts';
import rawStats from '../data/historical-7yr-stats.json';

interface HistoricalStatsSchema {
    meta: {
        source: string;
        totalRows: number;
        turnaroundRows: number;
        delayRows: number;
        minTurnPairs: number;
        flightDelayCount: number;
        airlineDestDelayCount: number;
    };
    minTurnaround: Record<string, number>;
    acTypeMinFallback: Record<string, number>;
    flightDelay: Record<string, [number, number]>;
    airlineDestDelay: Record<string, [number, number]>;
}

const STATS = rawStats as unknown as HistoricalStatsSchema;

// Zero-stripped flight-number index (e.g. "IR0718" -> also indexed as "IR718", "TK0001" -> "TK1")
const NORMALIZED_FLIGHT_DELAY = new Map<string, { key: string; avg: number; count: number }>();
for (const [k, val] of Object.entries(STATS.flightDelay)) {
    const clean = k.toUpperCase().replace(/\s+/g, '');
    const m = clean.match(/^([A-Z0-9]{2,3}?)(0*)(\d+[A-Z]?)$/);
    const norm = m ? `${m[1]}${m[3]}` : clean;
    const prev = NORMALIZED_FLIGHT_DELAY.get(norm);
    if (!prev || val[1] > prev.count) {
        NORMALIZED_FLIGHT_DELAY.set(norm, { key: k, avg: val[0], count: val[1] });
    }
}

function extractAirlineCode(f: Flight): string {
    const flt = (f.departureFlightNumber || f.arrivalFlightNumber || '').toUpperCase().trim();
    const m = flt.match(/^([A-Z0-9]{2,3}?)(?=\d)/);
    if (m) return m[1];
    const al = (f.airline || '').toUpperCase().trim();
    const m2 = al.match(/^([A-Z0-9]{2,3})/);
    return m2 ? m2[1] : '';
}

function normalizeFlightNo(rawNo?: string): { exact: string; stripped: string } {
    if (!rawNo) return { exact: '', stripped: '' };
    const exact = rawNo.toUpperCase().replace(/\s+/g, '');
    const m = exact.match(/^([A-Z0-9]{2,3}?)(0*)(\d+[A-Z]?)$/);
    const stripped = m ? `${m[1]}${m[3]}` : exact;
    return { exact, stripped };
}

const EMPTY_SHADOW: FlightShadowInfo = {
    minTurnGapMins: 0,
    avgDelayMins: 0,
    totalShadowMins: 0,
    hasSplitDivider: false,
};

/**
 * 7 Yıllık Gerçek İGA Verisi (1.878.650 Sefer) Bazlı Hayalet Gölge Çubuğu Hesaplayıcı
 * Yalnızca ETA-ETD (Canlı Öngörü) planlama modunda aktif olur.
 */
export function getFlightShadowInfo(f: Flight, mode: PlanningTimeMode): FlightShadowInfo {
    if (mode !== 'ETA_ETD') return EMPTY_SHADOW;
    if (f.type === 'arrival') return EMPTY_SHADOW;

    const airlineCode = extractAirlineCode(f);
    const acType = (f.aircraftType || '').toUpperCase().trim();

    // 1. Gölge 1: Havayolu + Uçak Tipi Minimum Çevrim (Turnaround) Açığı
    let minTurnGapMins = 0;
    let minTurnaroundRefMins: number | undefined = undefined;

    if (f.type === 'turnaround' && acType) {
        const key = `${airlineCode}|${acType}`;
        const refMin = STATS.minTurnaround[key] ?? STATS.acTypeMinFallback[acType];
        if (refMin !== undefined && refMin > 0) {
            minTurnaroundRefMins = refMin;
            const plannedMins = (f.scheduledDeparture.getTime() - f.scheduledArrival.getTime()) / 60000;
            if (plannedMins < refMin) {
                minTurnGapMins = Math.round(refMin - plannedMins);
            }
        }
    }

    // 2. Gölge 2: 2 Kademeli Sefer / Destinasyon Ortalama ETD Gecikme Alışkanlığı
    // (DepOffBlock - DepETD1; zamanında/erken gidenler 0 sayılır -> 0 ise gölge görünmez!)
    let avgDelayMins = 0;
    let delaySourceLabel: string | undefined = undefined;

    const { exact, stripped } = normalizeFlightNo(f.departureFlightNumber);
    if (exact && STATS.flightDelay[exact]) {
        const [avg, cnt] = STATS.flightDelay[exact];
        avgDelayMins = Math.round(avg);
        delaySourceLabel = `${exact} (${cnt} sefer ort.)`;
    } else if (stripped && NORMALIZED_FLIGHT_DELAY.has(stripped)) {
        const hit = NORMALIZED_FLIGHT_DELAY.get(stripped)!;
        avgDelayMins = Math.round(hit.avg);
        delaySourceLabel = `${hit.key} (${hit.count} sefer ort.)`;
    } else {
        const dest = (f.destination || String(f.raw_data?.['To Station'] || f.raw_data?.['DepToStatition'] || '')).toUpperCase().trim();
        const adKey = `${airlineCode}|${dest}`;
        if (airlineCode && dest && STATS.airlineDestDelay[adKey]) {
            const [avg, cnt] = STATS.airlineDestDelay[adKey];
            avgDelayMins = Math.round(avg);
            delaySourceLabel = `${airlineCode}→${dest} (${cnt} sefer ort.)`;
        }
    }

    if (avgDelayMins < 1) avgDelayMins = 0;

    // 3. Birleşim Kuralı:
    // - Önce minimum turnaround açığı (s1) görülür.
    // - Sefer gecikme alışkanlığı (s2) s1'den fazlaysa, s1 noktasında tırtıklı kesik çizgiyle ayrılıp s2'ye kadar uzar.
    // - s1 === 0 ise yalnızca s2 (gecikme alışkanlığı) görülür.
    const totalShadowMins = Math.max(minTurnGapMins, avgDelayMins);
    const hasSplitDivider = minTurnGapMins > 0 && avgDelayMins > minTurnGapMins;

    return {
        minTurnGapMins,
        minTurnaroundRefMins,
        avgDelayMins,
        delaySourceLabel,
        totalShadowMins,
        hasSplitDivider,
    };
}

export function getFlightShadowEndMs(f: Flight, mode: PlanningTimeMode): number {
    const baseEnd = f.scheduledDeparture.getTime();
    if (mode !== 'ETA_ETD') return baseEnd;
    const info = getFlightShadowInfo(f, mode);
    return baseEnd + info.totalShadowMins * 60000;
}

export function getHistoricalStatsMeta() {
    return STATS.meta;
}
