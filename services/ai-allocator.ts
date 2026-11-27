import { Flight, MaintenanceBlock, PlanningTimeMode } from '../types.ts';
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
import { getFidsPublicationStatus, FidsPublicationStatus } from './fids-service.ts';
import { calculateRevenue } from './revenue-calculator.ts';
import { getFlightShadowEndMs } from './shadow-bar-service.ts';
import {
    isCloseGateRequiredDeparture,
    getCloseGateTier,
    CLOSE_GATE_WIDE_TIER1,
    CLOSE_GATE_WIDE_TIER2,
    CLOSE_GATE_WIDE_TIER3,
    CLOSE_GATE_NARROW_TIER1
} from './close-gate-rules.ts';

export interface FidsAdvisoryWarning {
    flightId: string;
    flightNumber: string;
    airline: string;
    gate: string;
    stand: string;
    scheduledDeparture: Date;
    destination: string;
    fidsThresholdMinutes: number;
    minutesUntilDeparture: number;
    reason: string;
    status: 'LOCKED_ON_STAND' | 'CONFLICT_DETECTED' | 'REMOTE_STAND_WARNING';
}

export interface AiAllocationOptions {
    ignoreFidsParameters?: boolean; // if true, don't lock FIDS published flights
    timeFilterEnabled?: boolean;
    filterStart?: Date;
    filterEnd?: Date;
    referenceTime?: Date;
    /** Planlama Zaman Modu: Gerçekleşmiş (AIBT_AOBT) veya Canlı Öngörü (ETA_ETD + Gölge Çubukları) */
    planningMode?: PlanningTimeMode;
}

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
    // xPBB (Expected PBB) & xPBB-Live fields (Synchronized with xpbb-web.vercel.app)
    xPbbRate: number;      // xPBB (Plan) e.g. 88.4%
    xPbbLiveRate: number;  // xPBB-Live (Real-time / Operational) e.g. 86.1%
    deltaPbb: number;      // bridgeRate - xPbbLiveRate
    avgGroundTimeMins: number;
    widebodyRatio: number;
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

export const PASSENGER_MODES = new Set(['C', 'G', 'J', 'O', 'Y']);
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

/**
 * Operasyonel Sabit Uçuş Kontrolü (AOG / Towing / Geliş Körük - Gidiş Açık veya Açık-Körük)
 * Gerçek hayatta meydana gelen teknik çekilmeleri ve sabitlenmiş operasyonları korur;
 * AI Skor Planlama asla bu uçuşların standlarını değiştirmez, etrafından planlar.
 */
export function isOperationalLockedFlight(f: Flight): boolean {
    if (f.isOperationalLocked === true) return true;
    if (f.raw_data) {
        const row = f.raw_data;
        const arr = String(row['Arr Stand'] || row['ArrStand'] || row['Arr Pos'] || row['ArrPos'] || row['ArrPark'] || '').trim();
        const dep = String(row['Dep Stand'] || row['DepStand'] || row['Dep Pos'] || row['DepPos'] || row['DepPark'] || row['Stand_1'] || row['Stand.1'] || '').trim();
        if (arr && dep && arr !== dep) {
            if ((isContactStand(arr) && !isContactStand(dep)) || (!isContactStand(arr) && isContactStand(dep))) {
                return true;
            }
        }
    }
    return false;
}

/**
 * FIDS Gate Parametreleri ve Zaman Aralığı Filtresi Kontrolü
 * 1. Eğer zaman filtresi aktifse, seçili geliş aralığı dışındaki uçuşlar kilitlenir.
 * 2. Eğer gate parametreleri aktifse (ignoreFidsParameters !== true), kapısı FIDS ekranlarına
 *    yansıma süresi geçmiş olan uçuşlar KİLİTLENİR (Hard Lock).
 */
export function isFlightLockedByFidsOrTime(
    f: Flight, 
    options?: AiAllocationOptions, 
    referenceTime?: Date
): { isLocked: boolean; reason?: string; fidsWarning?: FidsAdvisoryWarning } {
    // 1. Time Window Filter Check (Sadece belirli geliş aralığındaki uçakları planla)
    if (options?.timeFilterEnabled && options.filterStart && options.filterEnd) {
        const arrTime = f.scheduledArrival;
        if (arrTime < options.filterStart || arrTime > options.filterEnd) {
            return {
                isLocked: true,
                reason: 'Seçili geliş zaman aralığı dışında kaldığı için mevcut pozisyonu korundu'
            };
        }
    }

    // 2. FIDS Gate Parameters Check
    if (!options?.ignoreFidsParameters) {
        const refTime = options?.referenceTime || referenceTime || new Date();
        const fids = getFidsPublicationStatus(f, refTime);
        const raw = f.raw_data || {};
        const currentGate = f.gate || raw.Gate || raw.DepGate || '';
        if (fids.isPublished && currentGate) {
            const hasBridge = f.parkingPosition && isContactStand(f.parkingPosition);
            const warning: FidsAdvisoryWarning = {
                flightId: f.id,
                flightNumber: f.departureFlightNumber || f.arrivalFlightNumber || 'N/A',
                airline: f.airline || '',
                gate: currentGate,
                stand: f.parkingPosition || 'Atanmadı',
                scheduledDeparture: f.scheduledDeparture,
                destination: f.destination || '',
                fidsThresholdMinutes: fids.thresholdMinutes,
                minutesUntilDeparture: fids.minutesUntilDeparture,
                reason: fids.reason,
                status: hasBridge ? 'LOCKED_ON_STAND' : 'REMOTE_STAND_WARNING'
            };
            return {
                isLocked: true,
                reason: `Kapı FIDS ekranlarına basıldı (${fids.reason})`,
                fidsWarning: warning
            };
        }
    }

    return { isLocked: false };
}

/**
 * Akşam Geniş Gövde Yatı Kuralı (15:00+ Geliş, 7-11h Yatı, Gece 00:00-04:30 Kalkış)
 * Bu uçuşların köprüye planlanmasına İZİN VERİLİR fakat KESİNLİKLE SADECE STANDALONE
 * köprülerde (D6-D17, B13-B17, F14-F18, A9) denenir. MARS Center standlarına asla verilmez!
 */
export function isEveningWidebodyLongStay(f: Flight): boolean {
    const cat = f.acCategory || getAircraftCategory(f.aircraftType);
    const isWide = cat === 'E' || cat === 'D' || cat === 'F';
    if (!isWide) return false;

    const arrMs = f.scheduledArrival.getTime();
    const depMs = f.scheduledDeparture.getTime();
    const durHours = (depMs - arrMs) / (60 * 60 * 1000);
    if (durHours < 7.0 || durHours > 11.5) return false;

    const arrHour = f.scheduledArrival.getHours();
    const depHour = f.scheduledDeparture.getHours();

    // Arrives at or after 15:00
    if (arrHour < 15) return false;

    // Departs at night / early morning between 00:00 and 04:30
    if (depHour > 4 && depHour < 23) return false;

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
    endDate?: Date,
    maintenanceBlocks?: MaintenanceBlock[]
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
    let widebodyCount = 0;
    let domCount = 0;
    let long4hCount = 0;
    let totalGroundTimeMins = 0;
    let validGroundTimeCount = 0;
    // 1440-dakikalık kesin yer işgal simülasyonu (xpbb-web.vercel.app ile birebir aynı!)
    const minDemand = new Array(1440).fill(0);
    const hourlyDemand = new Array(24).fill(0);
    const hourlyClosed = new Array(24).fill(0);

    const startMs = startDate ? startDate.getTime() : 0;
    const endMs = endDate ? endDate.getTime() : Infinity;
    const daySpan = (startDate && endDate && endMs > startMs)
        ? Math.max(1, Math.round((endMs - startMs) / (24 * 3600 * 1000)))
        : 1;

    const parseRawDate = (val: any): Date | null => {
        if (!val) return null;
        if (val instanceof Date && !isNaN(val.getTime())) return val;
        if (typeof val === 'number' && val > 30000 && val < 65000) {
            const totalDays = val - 25569;
            const wholeDays = Math.floor(totalDays);
            const dayMs = Math.round((totalDays - wholeDays) * 86400000);
            const ep = new Date(Date.UTC(1970, 0, 1 + wholeDays));
            return new Date(ep.getUTCFullYear(), ep.getUTCMonth(), ep.getUTCDate(), Math.floor(dayMs / 3600000), Math.floor((dayMs % 3600000) / 60000));
        }
        const s = String(val).trim();
        const mTr = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
        if (mTr) return new Date(+mTr[3], +mTr[2] - 1, +mTr[1], +(mTr[4] || 0), +(mTr[5] || 0));
        const d = new Date(s);
        return !isNaN(d.getTime()) && d.getFullYear() > 1970 ? d : null;
    };

    flights.forEach(f => {
        // 1. xPBB V3.0 Dakika Bazlı Yer İşgali (xpbb-web ile birebir: seçili günle kesişen tüm uygun yolcu uçuşları)
        if (f.type !== 'arrival' && !isNoAcFlight(f) && !isCargoModeFlight(f) && !isGeneralAviationFlight(f) && !isPropellerAircraft(f.aircraftType) && !isSpecialOrMaintenanceFlight(f) && isPassengerFlight(f)) {
            const rawInSim = f.raw_data ? parseRawDate(f.raw_data['On Block'] || f.raw_data['AIBT'] || f.raw_data['ATA']) : null;
            const rawOutSim = f.raw_data ? parseRawDate(f.raw_data['Off Block'] || f.raw_data['AOBT'] || f.raw_data['ATD']) : null;
            const sIn = rawInSim || f.scheduledArrival;
            let sOut = rawOutSim || f.scheduledDeparture;
            if (sIn && sOut) {
                if (sOut.getTime() < sIn.getTime()) sOut = new Date(sIn.getTime() + 90 * 60000);
                if (sOut.getTime() - sIn.getTime() > 36 * 3600000) sOut = new Date(sIn.getTime() + 18 * 3600000);
                const ovStart = Math.max(startMs, sIn.getTime());
                const ovEnd = Math.min(endMs, sOut.getTime());
                if (ovEnd > ovStart) {
                    const mStart = startDate ? Math.max(0, Math.min(1439, Math.floor(((ovStart - startMs) % 86400000) / 60000))) : (sIn.getHours() * 60 + sIn.getMinutes());
                    const durMins = Math.min(1440, Math.ceil((ovEnd - ovStart) / 60000));
                    for (let k = 0; k < durMins; k++) {
                        minDemand[(mStart + k) % 1440]++;
                    }
                }
            }
        }

        // Resmi APOC Gidiş Bazlı Standart: Sadece kalkış bacağı olan uçuşlar (turnaround veya departure)
        if (f.type === 'arrival') {
            return;
        }

        // Resmi APOC Tarih Bazı: Fiili kalkış (ATD) -> Off Block (AOBT) -> scheduledDeparture
        const rawAtd = f.raw_data ? parseRawDate(f.raw_data['ATD'] || f.raw_data['Off Block'] || f.raw_data['AOBT']) : null;
        const depRef = rawAtd || f.scheduledDeparture;
        const depMs = depRef ? depRef.getTime() : 0;
        if (depMs < startMs || depMs > endMs) {
            return;
        }

        consideredFlightsCount++;

        // Resmi APOC Pay Kuralı (Mod Filtresiz!):
        // İlgili günde (ATD) Concourse A-G köprülerinden giden TÜM uçaklar (teknik/ferry/kargo dahil) köprü sayısına eklenir!
        const isOnBridge = !!(f.parkingPosition && isContactStand(f.parkingPosition));
        if (isOnBridge) {
            bridgeAssigned++;
        }

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

        // Eligible Passenger Flight (Resmi APOC Payda: ATD + Dep Mod ∈ {C, G, J, O, Y} — köprüye alınamayan tipler hariç)
        eligibleCount++;
        
        // Geniş Gövde (Cat D/E/F) & Saf İç Hat (D/D)
        const cat = getAircraftCategory(f.aircraftType);
        if (cat === 'D' || cat === 'E' || cat === 'F') {
            widebodyCount++;
        }
        const isDomFlight = f.type === 'turnaround'
            ? ((f.arrivalIsDomestic ?? f.isDomestic) && (f.departureIsDomestic ?? f.isDomestic))
            : f.isDomestic;
        if (isDomFlight) {
            domCount++;
        }

        // Park pozisyonu giriş–çıkış işgali (AIBT -> AOBT; >36sa bakım/hangar sınırı ile)
        const rawIn = f.raw_data ? parseRawDate(f.raw_data['On Block'] || f.raw_data['AIBT'] || f.raw_data['ATA']) : null;
        const rawOut = f.raw_data ? parseRawDate(f.raw_data['Off Block'] || f.raw_data['AOBT'] || f.raw_data['ATD']) : null;
        const tIn = rawIn || f.scheduledArrival;
        let tOut = rawOut || f.scheduledDeparture;
        if (tIn && tOut) {
            if (tOut.getTime() < tIn.getTime()) tOut = new Date(tIn.getTime() + 90 * 60000);
            if (tOut.getTime() - tIn.getTime() > 36 * 3600000) tOut = new Date(tIn.getTime() + 18 * 3600000);
            const gtMins = (tOut.getTime() - tIn.getTime()) / 60000;
            if (gtMins >= 30 && gtMins <= 1440) {
                totalGroundTimeMins += gtMins;
                validGroundTimeCount++;
            }
            if (gtMins >= 240 && gtMins <= 1440) {
                long4hCount++;
            }
        }

        if (f.parkingPosition) {
            if (!isOnBridge) {
                remoteAssigned++;
            }
        } else {
            unassigned++;
        }
    });

    const bridgeRate = eligibleCount > 0 ? (bridgeAssigned / eligibleCount) * 100 : 0;
    const widebodyRatioPct = eligibleCount > 0 ? Math.round((widebodyCount / eligibleCount) * 1000) / 10 : 23.0;
    const ddRatioPct = eligibleCount > 0 ? (domCount / eligibleCount) * 100 : 12.0;
    const long4hPct = eligibleCount > 0 ? (long4hCount / eligibleCount) * 100 : 25.0;

    // Saatlik bakım / kapalılık blokları (sadece köprü stantları)
    if (maintenanceBlocks && maintenanceBlocks.length > 0 && startDate && endDate) {
        for (const blk of maintenanceBlocks) {
            if (!blk.parkingPosition || !isContactStand(blk.parkingPosition)) continue;
            const bStart = Math.max(startMs, new Date(blk.startTime).getTime());
            const bEnd = Math.min(endMs, new Date(blk.endTime).getTime());
            if (bEnd > bStart) {
                let cur = bStart;
                while (cur < bEnd) {
                    const h = new Date(cur).getHours();
                    const nextHr = cur + (3600000 - (cur % 3600000));
                    const sliceHrs = (Math.min(bEnd, nextHr) - cur) / 3600000;
                    hourlyClosed[h] += sliceHrs / daySpan;
                    cur = nextHr;
                }
            }
        }
    }

    // 1440 dakikalık işgal dizisinden 24 saatlik ortalama talep (xpbb-web.vercel.app ile birebir aynı!)
    for (let h = 0; h < 24; h++) {
        let sumM = 0;
        for (let m = h * 60; m < (h + 1) * 60; m++) sumM += minDemand[m];
        hourlyDemand[h] = Math.round(sumM / (60 * daySpan));
    }

    // xPBB™ V3.0 (Güncel 113 Nominal Tavan: B10 standalone/B10R, F12 sadece F12L+F12R)
    const NOMINAL_BRIDGES = 113;
    let totalDemHrs = 0;
    let ex114Hrs = 0;
    let exNetHrs = 0;
    for (let h = 0; h < 24; h++) {
        const dem = hourlyDemand[h] || 0;
        const cl = Math.min(NOMINAL_BRIDGES, hourlyClosed[h] || 0);
        totalDemHrs += dem;
        ex114Hrs += Math.max(0, dem - NOMINAL_BRIDGES);
        exNetHrs += Math.max(0, dem - Math.max(0, NOMINAL_BRIDGES - cl));
    }
    const safeTot = Math.max(1, totalDemHrs);
    const acSpill114Pct = (ex114Hrs / safeTot) * 100;
    const acSpillNetPct = (exNetHrs / safeTot) * 100;
    const acSpillClosurePct = Math.max(0, acSpillNetPct - acSpill114Pct);

    const penaltySpill = Math.round((0.3971 * acSpill114Pct) * 10) / 10;
    const penaltyClosure = Math.round((0.3971 * acSpillClosurePct) * 10) / 10;
    const penaltyLongStay = Math.round((0.1381 * long4hPct) * 10) / 10;
    const penaltyFleetDom = Math.round((0.1118 * widebodyRatioPct + 0.2318 * ddRatioPct) * 10) / 10;

    let xpbbPlan = 100.0 - penaltySpill - penaltyLongStay - penaltyFleetDom;
    xpbbPlan = Math.max(65.0, Math.min(99.0, Math.round(xpbbPlan * 10) / 10));

    let xpbbLive = 100.0 - penaltySpill - penaltyClosure - penaltyLongStay - penaltyFleetDom;
    xpbbLive = Math.max(65.0, Math.min(99.0, Math.round(xpbbLive * 10) / 10));

    const delta = Math.round((bridgeRate - xpbbLive) * 10) / 10;
    const avgGt = validGroundTimeCount > 0 ? Math.round(totalGroundTimeMins / validGroundTimeCount) : 180;

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
        bridgeRate: Math.round(bridgeRate * 10) / 10,
        xPbbRate: xpbbPlan,
        xPbbLiveRate: xpbbLive,
        deltaPbb: delta,
        avgGroundTimeMins: avgGt,
        widebodyRatio: widebodyRatioPct
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
    // E ve C köprülerine karma (İç-Dış / Dış-İç) uçuş alınmaz! Sadece A, B, D, F ve G köprüleri kullanılabilir.
    return ['Concourse A', 'Concourse B', 'Concourse D', 'Concourse F', 'Concourse G'];
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

    const allStandSet = new Set(allStandsWithConcourse.map(x => x.stand));
    const marsSubsByCenter = new Map<string, string[]>();
    allStandsWithConcourse.forEach(({ stand }) => {
        if (stand.endsWith('L') || stand.endsWith('R')) {
            const center = stand.slice(0, -1);
            // Sadece center pozisyonu da mevcutsa gerçek MARS/ilişkili alt pozisyondur (örn. B10<->B10R; F12 center kapalı olduğu için F12L/F12R bağımsız 2 dar gövdedir!)
            if (allStandSet.has(center)) {
                if (!marsSubsByCenter.has(center)) {
                    marsSubsByCenter.set(center, []);
                }
                marsSubsByCenter.get(center)!.push(stand);
            }
        }
    });

    // Step 2: Populate StandSchedule
    allStandsWithConcourse.forEach(({ stand, concourse }) => {
        const rawCenter = (stand.endsWith('L') || stand.endsWith('R')) ? stand.slice(0, -1) : undefined;
        const isMarsSub = !!(rawCenter && allStandSet.has(rawCenter));
        const center = isMarsSub ? rawCenter : undefined;
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
            } else if (pos === 'F12') {
                // F12 center kapalı olduğu için bakım kaydı gelirse hem F12L hem F12R'ye uygula
                for (const sub of ['F12L', 'F12R']) {
                    const subSched = topology.get(sub);
                    if (subSched) {
                        subSched.intervals.push({ start: startMs, end: endMs, flightId: `MAINTENANCE-${block.id}` });
                    }
                }
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
    if (schedule.stand === 'B10L' || schedule.stand === 'F12') return false;
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
    revenueGainEur?: number;
    swapType?: 'OCC_REVENUE_SWAP' | 'CAPACITY_SWAP';
}

export interface RevenueSwapSummary {
    swapsCount: number;
    netRevenueGainEur: number;
    initialRevenueEur: number;
    finalRevenueEur: number;
    bridgeCountBefore: number;
    bridgeCountAfter: number;
    bridgeRateMaintained: boolean;
    details: {
        bridgeFlightCallsign: string;
        remoteFlightCallsign: string;
        bridgeStand: string;
        remoteStand: string;
        revenueGainEur: number;
        reason: string;
    }[];
}

export interface AiAllocationResult {
    flights: Flight[];
    stats: BridgeUtilizationStats;
    swapDetails: SwapDetail[];
    totalSwapsPerformed: number;
    netFlightsGained: number;
    gapFillsPerformed: number;
    bufferSmoothedCount: number;
    revenueSwapSummary?: RevenueSwapSummary;
    fidsWarnings?: FidsAdvisoryWarning[];
    fidsLockedCount?: number;
    timeFilteredFlightCount?: number;
    shadowAvoidedCount?: number;
    closeGateOptimizedCount?: number;
}

/**
 * Pass G: Buffer Smoothing & Stand Leveling (İki Aşamalı Dayanıklı Planlama)
 * Körük kullanım oranından %0.1 bile feragat etmeden; köprüdeki uçaklar arasında
 * 75 dakikanın altında kalan tamponları tespit eder ve boş kardeş MARS stantlarına (L/R dengelemesi)
 * veya aynı iskeledeki daha geniş tampona sahip stantlara kaydırarak yerde uçak bekleme riskini eler.
 */
export function runBufferSmoothingPass(
    allFlights: Flight[],
    flightUpdates: Map<string, string | null>,
    topology: Map<string, StandSchedule>,
    maintenanceBlocks?: MaintenanceBlock[],
    options?: AiAllocationOptions,
    enablePairwiseSwaps: boolean = false
): number {
    let smoothedCount = 0;
    const CRITICAL_BUFFER_MS = 75 * 60 * 1000; // 75 dk altı tamponlar (rahatlatılabilir alanlar)
    const TARGET_MIN_BUFFER_MS = 40 * 60 * 1000; // Taşınacağı stantta en az 40 dk tampon olmalı
    const MAX_SMOOTH_PASSES = 4;

    for (let pass = 0; pass < MAX_SMOOTH_PASSES; pass++) {
        let movedInPass = false;

        // Sadece köprüye atanmış ve operasyonel kilitli olmayan yolcu uçuşları
        const bridgeFlights = allFlights.filter(f => {
            const pos = flightUpdates.get(f.id);
            if (!pos || !isContactStand(pos)) return false;
            if (isOperationalLockedFlight(f)) return false;
            return true;
        });

        // En dar tampona sahip uçuşları öncelemek için süreye göre tara
        for (const flight of bridgeFlights) {
            const currentStand = flightUpdates.get(flight.id);
            if (!currentStand) continue;
            const currentSched = topology.get(currentStand);
            if (!currentSched) continue;

            const arrMs = flight.scheduledArrival.getTime();
            const depMs = flight.scheduledDeparture.getTime();
            const cat = flight.acCategory || getAircraftCategory(flight.aircraftType);
            const isWide = cat === 'E' || cat === 'D' || cat === 'F';
            const isHeavy = cat === 'F';

            // Mevcut standdaki komşu uçuşlarla olan tamponları hesapla
            const otherIntervals = currentSched.intervals
                .filter(i => i.flightId !== flight.id)
                .sort((a, b) => a.start - b.start);

            let minCurrentBuffer = Infinity;
            // Önündeki uçakla aralık
            const prev = [...otherIntervals].reverse().find(i => i.end <= arrMs);
            if (prev) {
                const gapBefore = arrMs - prev.end;
                if (gapBefore < minCurrentBuffer) minCurrentBuffer = gapBefore;
            }
            // Arkasındaki uçakla aralık
            const next = otherIntervals.find(i => i.start >= depMs);
            if (next) {
                const gapAfter = next.start - depMs;
                if (gapAfter < minCurrentBuffer) minCurrentBuffer = gapAfter;
            }

            // Eğer mevcut stantta zaten başka uçak yoksa veya aralık çok genişse (> 75 dk), taşımaya gerek yok!
            if (minCurrentBuffer > CRITICAL_BUFFER_MS) continue;

            // Uçuşun gidebileceği izinli köprü concourse'ları
            const allowedConc = getAllowedBridgeConcourses(flight);

            let bestTargetStand: StandSchedule | null = null;
            let bestTargetBuffer = minCurrentBuffer;

            // 1. ÖNCELİK: MARS İkiz Kardeş Stand Dengelemesi (Örn: A3L'deki uçağı boş A3R'ye alma)
            if (currentSched.isMarsSub && currentSched.marsCenterStand) {
                const centerSched = topology.get(currentSched.marsCenterStand);
                const siblingName = centerSched?.marsSubStands?.find(s => s !== currentStand);
                if (siblingName) {
                    const sibSched = topology.get(siblingName);
                    if (sibSched && canFitOnStand(sibSched, arrMs, depMs, isWide, topology, isHeavy) &&
                        !hasMaintenanceConflict(siblingName, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks)) {
                        
                        const sibIntervals = sibSched.intervals.filter(i => i.flightId !== flight.id).sort((a, b) => a.start - b.start);
                        let sibBefore = Infinity;
                        const sPrev = [...sibIntervals].reverse().find(i => i.end <= arrMs);
                        if (sPrev) sibBefore = arrMs - sPrev.end;

                        let sibAfter = Infinity;
                        const sNext = sibIntervals.find(i => i.start >= depMs);
                        if (sNext) sibAfter = sNext.start - depMs;

                        const sibMinBuffer = Math.min(sibBefore, sibAfter);
                        if (sibMinBuffer >= TARGET_MIN_BUFFER_MS && sibMinBuffer > minCurrentBuffer + (15 * 60 * 1000)) {
                            bestTargetStand = sibSched;
                            bestTargetBuffer = sibMinBuffer;
                        }
                    }
                }
            }

            // 2. GENEL ARAMA: Diğer tüm uygun köprü stantlarını tara
            if (!bestTargetStand) {
                for (const conc of allowedConc) {
                    for (const sName of (CONCOURSE_LAYOUT[conc] || [])) {
                        if (sName === currentStand) continue;
                        const candSched = topology.get(sName);
                        if (!candSched || !isContactStand(candSched.stand)) continue;

                        if (isEveningWidebodyLongStay(flight) && candSched.isMarsCenter && (candSched.marsSubStands?.length ?? 0) >= 2) continue;
                        if (hasMaintenanceConflict(sName, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks)) continue;
                        if (!canFitOnStand(candSched, arrMs, depMs, isWide, topology, isHeavy)) continue;

                        const candIntervals = candSched.intervals
                            .filter(i => i.flightId !== flight.id)
                            .sort((a, b) => a.start - b.start);

                        let candBufferBefore = Infinity;
                        const cPrev = [...candIntervals].reverse().find(i => i.end <= arrMs);
                        if (cPrev) candBufferBefore = arrMs - cPrev.end;

                        let candBufferAfter = Infinity;
                        const cNext = candIntervals.find(i => i.start >= depMs);
                        if (cNext) candBufferAfter = cNext.start - depMs;

                        const candMinBuffer = Math.min(candBufferBefore, candBufferAfter);

                        if (candMinBuffer >= TARGET_MIN_BUFFER_MS && candMinBuffer > bestTargetBuffer + (15 * 60 * 1000)) {
                            bestTargetStand = candSched;
                            bestTargetBuffer = candMinBuffer;
                        }
                    }
                }
            }

            // İdeal daha dengeli bir stant bulundu! Taşıma işlemini gerçekleştir
            if (bestTargetStand) {
                currentSched.intervals = currentSched.intervals.filter(i => i.flightId !== flight.id);
                placeOnStand(bestTargetStand, arrMs, depMs, flight.id);
                flightUpdates.set(flight.id, bestTargetStand.stand);

                smoothedCount++;
                movedInPass = true;
                break;
            }
        }

        if (!movedInPass) break;
    }

    if (!enablePairwiseSwaps) {
        return smoothedCount;
    }

    // 2. AŞAMA: KÖPRÜDEN KÖPRÜYE İKİLİ (1-to-1) VE KUYRUK (TAIL) TAMPON TAKASI
    // Oranı ve geliri hiç değiştirmeden, dar aralıklı (ör. G7L TK1272) bir uçağı/kuyruğu
    // daha geniş başlangıç boşluğu olan başka bir köprüdeki (ör. G6L TK2643) ile takas eder.
    const flightById = new Map(allFlights.map(f => [f.id, f]));
    const MIN_IMPROVE_MS = 15 * 60 * 1000;

    const getMinNeighborGap = (sched: StandSchedule, arrMs: number, depMs: number, ignoreSet: Set<string>): number => {
        const others = sched.intervals
            .filter(iv => !ignoreSet.has(iv.flightId))
            .sort((a, b) => a.start - b.start);
        let minG = Infinity;
        for (let i = others.length - 1; i >= 0; i--) {
            if (others[i].end <= arrMs) {
                minG = Math.min(minG, arrMs - others[i].end);
                break;
            }
        }
        for (let i = 0; i < others.length; i++) {
            if (others[i].start >= depMs) {
                minG = Math.min(minG, others[i].start - depMs);
                break;
            }
        }
        return minG;
    };

    for (let swapPass = 0; swapPass < 2; swapPass++) {
        let swappedInPass = false;

        const bridgeFlights = allFlights.filter(f => {
            const pos = flightUpdates.get(f.id);
            if (!pos || !isContactStand(pos)) return false;
            if (isOperationalLockedFlight(f)) return false;
            if (options && isFlightLockedByFidsOrTime(f, options).isLocked) return false;
            return true;
        });

        for (const fA of bridgeFlights) {
            const standA = flightUpdates.get(fA.id);
            if (!standA) continue;
            const schedA = topology.get(standA);
            if (!schedA) continue;

            const aArr = fA.scheduledArrival.getTime();
            const aDep = fA.scheduledDeparture.getTime();
            const oldGapA = getMinNeighborGap(schedA, aArr, aDep, new Set([fA.id]));
            if (oldGapA >= CRITICAL_BUFFER_MS) continue;

            let bestPartner: Flight | null = null;
            let bestScore = -Infinity;

            for (const fB of bridgeFlights) {
                if (fB.id === fA.id) continue;
                const standB = flightUpdates.get(fB.id);
                if (!standB || standB === standA) continue;
                const schedB = topology.get(standB);
                if (!schedB) continue;

                // Aynı zaman diliminde yakın komşu olmalı (tail/pairwise takas anlamlı olsun)
                const bArr = fB.scheduledArrival.getTime();
                const bDep = fB.scheduledDeparture.getTime();
                if (Math.abs(aArr - bArr) > 4 * 3600000) continue;

                const oldGapB = getMinNeighborGap(schedB, bArr, bDep, new Set([fB.id]));
                const oldMin = Math.min(oldGapA, oldGapB);

                const ign = new Set([fA.id, fB.id]);
                // İki uçuş da karşı standın kurallarına (İskele, MARS, Cat-F, Bakım, Zaman) uyuyor mu?
                if (!canFitIgnoringIds(topology, standB, fA, ign, maintenanceBlocks)) continue;
                if (!canFitIgnoringIds(topology, standA, fB, ign, maintenanceBlocks)) continue;

                const newGapA = getMinNeighborGap(schedB, aArr, aDep, ign);
                const newGapB = getMinNeighborGap(schedA, bArr, bDep, ign);
                const newMin = Math.min(newGapA, newGapB);

                if (newMin >= oldMin + MIN_IMPROVE_MS && newMin > bestScore) {
                    bestScore = newMin;
                    bestPartner = fB;
                }
            }

            if (bestPartner) {
                const standB = flightUpdates.get(bestPartner.id)!;
                const schedB = topology.get(standB)!;

                schedA.intervals = schedA.intervals.filter(iv => iv.flightId !== fA.id);
                schedB.intervals = schedB.intervals.filter(iv => iv.flightId !== bestPartner!.id);
                placeOnStand(schedB, aArr, aDep, fA.id);
                placeOnStand(schedA, bestPartner.scheduledArrival.getTime(), bestPartner.scheduledDeparture.getTime(), bestPartner.id);

                flightUpdates.set(fA.id, standB);
                flightUpdates.set(bestPartner.id, standA);
                smoothedCount += 2;
                swappedInPass = true;
            }
        }

        // Tail-Swap (Arkasındakilerle Birlikte Kuyruk Takası): 1'e 1 çakışırsa arka arkaya gelen 2-4 uçağı birlikte takas et
        for (const fA of bridgeFlights) {
            const standA = flightUpdates.get(fA.id);
            if (!standA || !isContactStand(standA)) continue;
            const schedA = topology.get(standA);
            if (!schedA || !schedA.intervals.some(iv => iv.flightId === fA.id)) continue;

            const aArr = fA.scheduledArrival.getTime();
            const aDep = fA.scheduledDeparture.getTime();
            const oldGapA = getMinNeighborGap(schedA, aArr, aDep, new Set([fA.id]));
            if (oldGapA >= CRITICAL_BUFFER_MS) continue;

            // standA üzerinde fA'dan sonraki 8 saatlik kuyruğu topla
            const tailA: Flight[] = schedA.intervals
                .filter(iv => iv.start >= aArr && iv.start <= aArr + 8 * 3600000)
                .sort((x, y) => x.start - y.start)
                .map(iv => flightById.get(iv.flightId))
                .filter((x): x is Flight => !!x && !isOperationalLockedFlight(x) && !(options && isFlightLockedByFidsOrTime(x, options).isLocked));
            if (tailA.length < 2) continue;

            // Kuyruk içi kendi kendine çakışma olmamalı
            let tailASelfOk = true;
            for (let i = 0; i < tailA.length - 1; i++) {
                if (tailA[i].scheduledDeparture.getTime() > tailA[i + 1].scheduledArrival.getTime()) { tailASelfOk = false; break; }
            }
            if (!tailASelfOk) continue;

            for (const [standB, schedB] of topology.entries()) {
                if (standB === standA || !isContactStand(standB)) continue;
                if (schedA.marsCenterStand === standB || (schedA.marsSubStands && schedA.marsSubStands.includes(standB))) continue;
                const tailB: Flight[] = schedB.intervals
                    .filter(iv => iv.start >= aArr - 2 * 3600000 && iv.start <= aArr + 8 * 3600000)
                    .sort((x, y) => x.start - y.start)
                    .map(iv => flightById.get(iv.flightId))
                    .filter((x): x is Flight => !!x && !isOperationalLockedFlight(x) && !(options && isFlightLockedByFidsOrTime(x, options).isLocked));
                if (tailB.length === 0) continue;

                let tailBSelfOk = true;
                for (let i = 0; i < tailB.length - 1; i++) {
                    if (tailB[i].scheduledDeparture.getTime() > tailB[i + 1].scheduledArrival.getTime()) { tailBSelfOk = false; break; }
                }
                if (!tailBSelfOk) continue;

                // Sadece başlangıç zamanı farkı varsa anlamlı
                const bFirstArr = tailB[0].scheduledArrival.getTime();
                if (bFirstArr <= aArr) continue;

                const ignTail = new Set<string>([...tailA.map(x => x.id), ...tailB.map(x => x.id)]);
                // tailA'daki ilk uçağın yeni boşluğu eski boşluğundan en az 15 dk daha geniş olmalı
                const newFirstGapA = getMinNeighborGap(schedB, aArr, aDep, ignTail);
                const oldFirstGapB = getMinNeighborGap(schedB, bFirstArr, tailB[0].scheduledDeparture.getTime(), new Set([tailB[0].id]));
                const newFirstGapB = getMinNeighborGap(schedA, bFirstArr, tailB[0].scheduledDeparture.getTime(), ignTail);
                if (Math.min(newFirstGapA, newFirstGapB) < Math.min(oldGapA, oldFirstGapB) + MIN_IMPROVE_MS) continue;

                // Tüm tailA -> standB ve tüm tailB -> standA sığıyor mu?
                let allFit = true;
                for (const fx of tailA) {
                    if (!canFitIgnoringIds(topology, standB, fx, ignTail, maintenanceBlocks)) { allFit = false; break; }
                }
                if (!allFit) continue;
                for (const fy of tailB) {
                    if (!canFitIgnoringIds(topology, standA, fy, ignTail, maintenanceBlocks)) { allFit = false; break; }
                }
                if (!allFit) continue;

                // Commit Tail Swap!
                schedA.intervals = schedA.intervals.filter(iv => !ignTail.has(iv.flightId));
                schedB.intervals = schedB.intervals.filter(iv => !ignTail.has(iv.flightId));
                for (const fx of tailA) {
                    placeOnStand(schedB, fx.scheduledArrival.getTime(), fx.scheduledDeparture.getTime(), fx.id);
                    flightUpdates.set(fx.id, standB);
                }
                for (const fy of tailB) {
                    placeOnStand(schedA, fy.scheduledArrival.getTime(), fy.scheduledDeparture.getTime(), fy.id);
                    flightUpdates.set(fy.id, standA);
                }
                smoothedCount += tailA.length + tailB.length;
                swappedInPass = true;
                break;
            }
        }

        if (!swappedInPass) break;
    }

    return smoothedCount;
}

export function runFromScratchAllocation(
    allFlights: Flight[],
    startDate?: Date,
    endDate?: Date,
    maintenanceBlocks?: MaintenanceBlock[],
    options?: AiAllocationOptions
): AiAllocationResult {
    const topology = buildStandTopology(maintenanceBlocks);
    const flightUpdates = new Map<string, string | null>();

    const fidsWarnings: FidsAdvisoryWarning[] = [];
    let fidsLockedCount = 0;
    let timeFilteredFlightCount = 0;

    // 0. Operasyonel Sabit Uçuşları ve FIDS / Zaman Kilitlerini Önceden Kilitle
    // Bu uçuşlar gerçek hayattaki pozisyonlarını korur; AI asla yerlerini değiştirmez.
    allFlights.forEach(f => {
        const isOpLocked = isOperationalLockedFlight(f);
        const lockStatus = isFlightLockedByFidsOrTime(f, options, startDate);

        if (isOpLocked || lockStatus.isLocked) {
            flightUpdates.set(f.id, f.parkingPosition || null);
            if (lockStatus.fidsWarning) {
                fidsWarnings.push(lockStatus.fidsWarning);
                fidsLockedCount++;
            }
            if (options?.timeFilterEnabled && lockStatus.reason?.includes('zaman aralığı')) {
                timeFilteredFlightCount++;
            }
            if (f.parkingPosition && topology.has(f.parkingPosition)) {
                const sched = topology.get(f.parkingPosition)!;
                const arrMs = f.scheduledArrival.getTime();
                const depMs = f.scheduledDeparture.getTime();
                placeOnStand(sched, arrMs, depMs, f.id);
            }
        }
    });

    // 1. Identify and categorize flights
    const eligibleFlights: Flight[] = [];
    const cargoFlights: Flight[] = [];
    const gaFlights: Flight[] = [];
    const propFlights: Flight[] = [];
    const noAcFlights: Flight[] = [];

    allFlights.forEach(f => {
        const isOpLocked = isOperationalLockedFlight(f);
        const lockStatus = isFlightLockedByFidsOrTime(f, options, startDate);
        if (isOpLocked || lockStatus.isLocked) {
            return; // Önceden kilitlendi, planlamadan muaf
        }
        if (isNoAcFlight(f)) {
            noAcFlights.push(f);
            flightUpdates.set(f.id, null); // Keep in pool!
        } else if (isCargoModeFlight(f)) {
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
        if (isEveningWidebodyLongStay(flight)) return false; // Akşam 15:00+ gelen WB yatısı serbest

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
        // Akşam 15:00+ gelen 8-10h yatılı WB uçakları standalone köprüleri değerlendirmek üzere öne alınır
        const isEveA = isEveningWidebodyLongStay(a);
        const isEveB = isEveningWidebodyLongStay(b);
        if (isEveA && !isEveB) return -1;
        if (!isEveA && isEveB) return 1;

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
        // Also B2, F2, F12L, F12R (F12 center kapalı; F12L ve F12R bağımsız 2 dar gövde köprüsü!)
        for (const s of ['B2', 'F2', 'F12L', 'F12R']) {
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
                currentLoad: number;
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
                        subCandidates.push({ sched, syncScore, currentLoad: sched.intervals.length });
                    }
                }
            }

            // Prioritize highest synchronization score (best pairs) first!
            // If synchronization is tied, pick the sibling sub-stand with FEWER flights to balance L & R!
            subCandidates.sort((a, b) => {
                if (b.syncScore !== a.syncScore) return b.syncScore - a.syncScore;
                return a.currentLoad - b.currentLoad;
            });

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
                    // B10 gibi yalnızca 1 alt kolu olan (B10R) pozisyonlar 2 dar gövde feda etmediği için standalone WB önceliği alır!
                    if (!sched.isMarsSub && (!sched.isMarsCenter || (sched.marsSubStands && sched.marsSubStands.length <= 1))) {
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
        // KRİTİK KURAL: Akşam 15:00+ gelen uzun yatılı WB uçakları MARS Center'a ASLA verilemez (sadece standalone)!
        if (!placed && !isEveningWidebodyLongStay(flight)) {
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

                    const blockingFlights: { flight: Flight; subSched: StandSchedule }[] = [];

                    // Case A: MARS Center stand blocked by 1 or 2 narrowbodies on subL/subR
                    if (sched.isMarsCenter && sched.marsSubStands) {
                        const [subLName, subRName] = sched.marsSubStands;
                        const schedL = subLName ? topology.get(subLName) : undefined;
                        const schedR = subRName ? topology.get(subRName) : undefined;

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
                    } else if (!sched.isMarsCenter && !sched.isMarsSub) {
                        // Case B: Standalone Wide Stand (Concourse D: D6-D17, B13-B17, F14-F18, A9)
                        // Açıkta kalan geniş gövde için bağımsız stanttaki dar gövdeleri başka körüklere tahliye et!
                        for (const it of sched.intervals) {
                            if (wArr < it.end && wDep > it.start) {
                                const bf = eligibleFlights.find(f => f.id === it.flightId);
                                if (bf && !isFlightWide(bf)) {
                                    blockingFlights.push({ flight: bf, subSched: sched });
                                } else {
                                    blockingFlights.length = 0;
                                    break;
                                }
                            }
                        }
                    }

                    if (blockingFlights.length > 0 && blockingFlights.length <= 2) {
                        if (blockingFlights.some(bf => isOperationalLockedFlight(bf.flight))) {
                            continue;
                        }
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
                                        if (bs === sched.stand || (sched.marsSubStands && sched.marsSubStands.includes(bs))) continue;
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
                if (elevated) break;
            }
        }

        // --- SUB-PHASE 2: 1-to-N REPLACEMENT SWAP (Geriye Dönük Takas) ---
        // Look for flights currently on bridge stands that can be sent to remote to make room for >= 2 remote narrowbodies
        const currentBridgeFlights = eligibleFlights.filter(f => {
            if (isOperationalLockedFlight(f) || isEveningWidebodyLongStay(f)) return false;
            const pos = flightUpdates.get(f.id);
            return pos && isContactStand(pos);
        });

        // Sort by longest stay first and MARS center first
        currentBridgeFlights.sort((a, b) => {
            const posA = flightUpdates.get(a.id) || '';
            const posB = flightUpdates.get(b.id) || '';
            const scA = topology.get(posA);
            const scB = topology.get(posB);
            const isCenterA = (scA?.isMarsCenter && (scA.marsSubStands?.length ?? 0) >= 2) ? 1 : 0;
            const isCenterB = (scB?.isMarsCenter && (scB.marsSubStands?.length ?? 0) >= 2) ? 1 : 0;
            if (isCenterA !== isCenterB) return isCenterB - isCenterA;
            return getDurationMins(b) - getDurationMins(a);
        });

        for (const bridgeFlight of currentBridgeFlights) {
            if (isOperationalLockedFlight(bridgeFlight) || isEveningWidebodyLongStay(bridgeFlight)) continue;
            const bridgePos = flightUpdates.get(bridgeFlight.id);
            if (!bridgePos || !isContactStand(bridgePos)) continue;

            const standSched = topology.get(bridgePos);
            if (!standSched) continue;

            const bArrMs = bridgeFlight.scheduledArrival.getTime();
            const bDepMs = bridgeFlight.scheduledDeparture.getTime();
            const bDurHours = getDurationMins(bridgeFlight) / 60;

            // Only consider swapping if it stays >= 2.5 hours or is a true 2-sub MARS Center stand (B10 has only B10R, behaves as standalone WB)
            if (bDurHours < 2.5 && !(standSched.isMarsCenter && (standSched.marsSubStands?.length ?? 0) >= 2)) continue;

            // Temporarily remove bridgeFlight from topology
            standSched.intervals = standSched.intervals.filter(i => i.flightId !== bridgeFlight.id);

            // Candidate remote narrowbodies overlapping [bArrMs, bDepMs] (canFitOnStand checks actual stand availability before/after!)
            const availableRemotes = eligibleFlights.filter(f => {
                if (isOperationalLockedFlight(f) || (options && isFlightLockedByFidsOrTime(f, options).isLocked)) return false;
                const pos = flightUpdates.get(f.id);
                if ((pos && isContactStand(pos)) || isFlightWide(f)) return false;
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
    // Pass G.5: Open Apron Fallback — Köprüye yerleşemeyen veya çakışma nedeniyle
    // boşa düşen tüm uygun yolcu uçuşlarını açık apronlara (100/200/300) yerleştir.
    // Böylece "Atama Bekleyen Havuzu"nda geçerli uçak kalmaz.
    // -----------------------------------------------------------------------
    const openApronsFallback = ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5', 'APRON 6', 'APRON 7'];
    const unassignedEligible = eligibleFlights.filter(f => {
        const curPos = flightUpdates.get(f.id);
        return !curPos || curPos === 'REMOTE';
    });
    unassignedEligible.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());
    for (const flight of unassignedEligible) {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const isWide = isFlightWide(flight);
        const isHeavy = isFlightHeavy(flight);
        let placed = false;
        for (const apronName of openApronsFallback) {
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
    }

    // -----------------------------------------------------------------------
    // Pass G: Buffer Smoothing & Stand Leveling (İki Aşamalı Dayanıklı Planlama)
    // -----------------------------------------------------------------------
    const bufferSmoothedCount = runBufferSmoothingPass(allFlights, flightUpdates, topology, maintenanceBlocks, options, false);

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
        const concourse = (pos && Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c]?.includes(pos))) || '';

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
            } else if ((concourse === 'Concourse C' || concourse === 'Concourse E') && f.type === 'turnaround' && (isArrDom !== isDepDom)) {
                // Karma Uçuş (İç-Dış / Dış-İç) asla Concourse C veya E'ye verilemez
                console.warn(`[SAFETY NET] Mixed (I/D) flight on ${concourse} prevented (${pos}, ${f.id}). Demoting.`);
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
        gapFillsPerformed,
        bufferSmoothedCount,
        fidsWarnings,
        fidsLockedCount,
        timeFilteredFlightCount
    };
}

// ---------------------------------------------------------------------------
// 5. Warm-Start Optimization: Preserve & Elevate Human Dispatcher Plan
// ---------------------------------------------------------------------------
export function runPreserveAndElevateAllocation(
    allFlights: Flight[],
    startDate?: Date,
    endDate?: Date,
    maintenanceBlocks?: MaintenanceBlock[],
    options?: AiAllocationOptions
): AiAllocationResult | null {
    const existingContactCount = allFlights.filter(f => f.parkingPosition && isContactStand(f.parkingPosition)).length;
    if (existingContactCount === 0) return null;

    const topology = buildStandTopology(maintenanceBlocks);
    const flightUpdates = new Map<string, string | null>();

    const fidsWarnings: FidsAdvisoryWarning[] = [];
    let fidsLockedCount = 0;
    let timeFilteredFlightCount = 0;

    // 0. Operasyonel Sabit Uçuşları ve FIDS / Zaman Kilitlerini Önceden Kilitle
    allFlights.forEach(f => {
        const isOpLocked = isOperationalLockedFlight(f);
        const lockStatus = isFlightLockedByFidsOrTime(f, options, startDate);

        if (isOpLocked || lockStatus.isLocked) {
            flightUpdates.set(f.id, f.parkingPosition || null);
            if (lockStatus.fidsWarning) {
                fidsWarnings.push(lockStatus.fidsWarning);
                fidsLockedCount++;
            }
            if (options?.timeFilterEnabled && lockStatus.reason?.includes('zaman aralığı')) {
                timeFilteredFlightCount++;
            }
            if (f.parkingPosition && topology.has(f.parkingPosition)) {
                const sched = topology.get(f.parkingPosition)!;
                const arrMs = f.scheduledArrival.getTime();
                const depMs = f.scheduledDeparture.getTime();
                placeOnStand(sched, arrMs, depMs, f.id);
            }
        }
    });

    const eligibleFlights: Flight[] = [];
    const cargoFlights: Flight[] = [];
    const gaFlights: Flight[] = [];
    const propFlights: Flight[] = [];
    const noAcFlights: Flight[] = [];

    allFlights.forEach(f => {
        const isOpLocked = isOperationalLockedFlight(f);
        const lockStatus = isFlightLockedByFidsOrTime(f, options, startDate);
        if (isOpLocked || lockStatus.isLocked) {
            return; // Önceden kilitlendi
        }
        if (isNoAcFlight(f)) {
            noAcFlights.push(f);
            flightUpdates.set(f.id, null);
        } else if (isCargoModeFlight(f)) {
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
            flightUpdates.set(f.id, null);
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
            // For widebody: single wide stands first (including B10 which only has 1 sub B10R), then 2-sub MARS Center
            for (const conc of allowedConc) {
                for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                    const sched = topology.get(s);
                    if (sched && sched.isWideCompatible && !sched.isMarsSub && (!sched.isMarsCenter || (sched.marsSubStands?.length ?? 0) <= 1)) {
                        candidateStands.push(sched);
                    }
                }
            }
            // KRİTİK KURAL: Akşam 15:00+ gelen 8-10h yatılı WB uçakları 2-sub MARS Center'a ASLA verilemez (sadece standalone & B10)!
            if (!isEveningWidebodyLongStay(flight)) {
                for (const conc of allowedConc) {
                    for (const s of (CONCOURSE_LAYOUT[conc] || [])) {
                        const sched = topology.get(s);
                        if (sched && sched.isWideCompatible && sched.isMarsCenter && (sched.marsSubStands?.length ?? 0) >= 2) {
                            candidateStands.push(sched);
                        }
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
            if (isOperationalLockedFlight(f) || isEveningWidebodyLongStay(f)) return false;
            const pos = flightUpdates.get(f.id);
            return pos && isContactStand(pos);
        });

        currentBridgeFlights.sort((a, b) => getDurationMins(b) - getDurationMins(a));

        for (const bridgeFlight of currentBridgeFlights) {
            if (isOperationalLockedFlight(bridgeFlight) || isEveningWidebodyLongStay(bridgeFlight)) continue;
            const bridgePos = flightUpdates.get(bridgeFlight.id);
            if (!bridgePos || !isContactStand(bridgePos)) continue;

            const standSched = topology.get(bridgePos);
            if (!standSched) continue;

            const bArrMs = bridgeFlight.scheduledArrival.getTime();
            const bDepMs = bridgeFlight.scheduledDeparture.getTime();
            const bDurHours = getDurationMins(bridgeFlight) / 60;

            if (bDurHours < 3.5 && !(standSched.isMarsCenter && (standSched.marsSubStands?.length ?? 0) >= 2)) continue;

            standSched.intervals = standSched.intervals.filter(i => i.flightId !== bridgeFlight.id);

            // Candidate remote narrowbodies overlapping [bArrMs, bDepMs]
            const availableRemotes = eligibleFlights.filter(f => {
                if (isOperationalLockedFlight(f) || (options && isFlightLockedByFidsOrTime(f, options).isLocked)) return false;
                const pos = flightUpdates.get(f.id);
                if ((pos && isContactStand(pos)) || isFlightWide(f)) return false;
                const fArr = f.scheduledArrival.getTime();
                const fDep = f.scheduledDeparture.getTime();
                if (fArr < bDepMs && fDep > bArrMs) {
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

    // -----------------------------------------------------------------------
    // Pass G.5: Open Apron Fallback — Köprüye yerleşemeyen veya çakışma nedeniyle
    // boşa düşen tüm uygun yolcu uçuşlarını açık apronlara (100/200/300) yerleştir.
    // Böylece "Atama Bekleyen Havuzu"nda geçerli uçak kalmaz.
    // -----------------------------------------------------------------------
    const openApronsFallback = ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5', 'APRON 6', 'APRON 7'];
    const unassignedEligible = eligibleFlights.filter(f => {
        const curPos = flightUpdates.get(f.id);
        return !curPos || curPos === 'REMOTE';
    });
    unassignedEligible.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());
    for (const flight of unassignedEligible) {
        const arrMs = flight.scheduledArrival.getTime();
        const depMs = flight.scheduledDeparture.getTime();
        const isWide = isFlightWide(flight);
        const isHeavy = isFlightHeavy(flight);
        let placed = false;
        for (const apronName of openApronsFallback) {
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
    }

    // -----------------------------------------------------------------------
    // Pass G: Buffer Smoothing & Stand Leveling (İki Aşamalı Dayanıklı Planlama)
    // -----------------------------------------------------------------------
    const bufferSmoothedCount = runBufferSmoothingPass(allFlights, flightUpdates, topology, maintenanceBlocks, options, false);

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
        const concourse = (pos && Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c]?.includes(pos))) || '';

        let needsDemotion = false;

        // Rule 0: Maintenance / Downgrade conflict check
        if (hasMaintenanceConflict(pos, f.scheduledArrival, f.scheduledDeparture, maintenanceBlocks)) {
            console.warn(`[SAFETY NET] Maintenance conflict on ${pos} for flight ${f.id}. Relocating.`);
            needsDemotion = true;
        }

        if (pos === 'B10L' || pos === 'F12') needsDemotion = true;
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
            else if ((concourse === 'Concourse C' || concourse === 'Concourse E') && f.type === 'turnaround' && (isArrDom !== isDepDom)) needsDemotion = true;
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
        gapFillsPerformed,
        bufferSmoothedCount,
        fidsWarnings,
        fidsLockedCount,
        timeFilteredFlightCount
    };
}

// ---------------------------------------------------------------------------
// 5b. Chain-Swap Pass (0-Buffer Maximum Capacity Relocation Shuffle)
// ---------------------------------------------------------------------------
function canFitIgnoringIds(
    topology: Map<string, StandSchedule>,
    stand: string,
    f: Flight,
    ignoreIds: Set<string>,
    maintenanceBlocks?: MaintenanceBlock[]
): boolean {
    const sched = topology.get(stand);
    if (!sched || !isContactStand(stand)) return false;

    const cat = f.acCategory || getAircraftCategory(f.aircraftType || '');
    const isWide = cat === 'D' || cat === 'E' || cat === 'F';
    const isHeavy = cat === 'F';
    const allowed = getAllowedBridgeConcourses(f);
    if (!allowed.some(c => sched.concourse.toUpperCase().includes(c.toUpperCase()))) return false;

    if (isWide && sched.isMarsSub) return false;
    if (isWide && !sched.isWideCompatible) return false;
    if (!isWide && sched.isMarsCenter) return false;
    if (isHeavy && !isStandCatFCompatible(stand)) return false;

    if (hasMaintenanceConflict(stand, f.scheduledArrival, f.scheduledDeparture, maintenanceBlocks)) {
        return false;
    }

    const arrMs = f.scheduledArrival.getTime();
    const depMs = f.scheduledDeparture.getTime();

    const checkIntervals = (ivs: StandSchedule['intervals']) => {
        for (const iv of ivs) {
            if (ignoreIds.has(iv.flightId)) continue;
            if (arrMs < iv.end && depMs > iv.start) return false;
        }
        return true;
    };

    if (!checkIntervals(sched.intervals)) return false;
    if (sched.isMarsSub && sched.marsCenterStand) {
        const c = topology.get(sched.marsCenterStand);
        if (c && !checkIntervals(c.intervals)) return false;
    } else if (sched.isMarsCenter && sched.marsSubStands) {
        for (const sub of sched.marsSubStands) {
            const s = topology.get(sub);
            if (s && !checkIntervals(s.intervals)) return false;
        }
    }
    return true;
}

export function runChainSwapPass(
    result: AiAllocationResult,
    startDate?: Date,
    endDate?: Date,
    maintenanceBlocks?: MaintenanceBlock[],
    options?: AiAllocationOptions
): AiAllocationResult {
    const working: Flight[] = result.flights.map(f => ({ ...f }));
    const topology = buildStandTopology(maintenanceBlocks);

    for (const f of working) {
        if (f.parkingPosition && isContactStand(f.parkingPosition)) {
            const sched = topology.get(f.parkingPosition);
            if (sched) {
                placeOnStand(sched, f.scheduledArrival.getTime(), f.scheduledDeparture.getTime(), f.id);
            }
        }
    }

    const flightById = new Map(working.map(f => [f.id, f]));
    let totalAdded = 0;
    const addedSwaps: SwapDetail[] = [];
    const MAX_PASSES = 4;
    const MAX_BLOCKERS = 3;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        let addedInPass = 0;

        const unplaced = working.filter(f => {
            if (f.parkingPosition && isContactStand(f.parkingPosition)) return false;
            if (!isFlightBridgeEligible(f)) return false;
            if (isOperationalLockedFlight(f)) return false;
            if (options && isFlightLockedByFidsOrTime(f, options).isLocked) return false;
            return true;
        });

        // Shortest ground time first to maximize total bridge count
        unplaced.sort((a, b) =>
            (a.scheduledDeparture.getTime() - a.scheduledArrival.getTime()) -
            (b.scheduledDeparture.getTime() - b.scheduledArrival.getTime())
        );

        for (const r of unplaced) {
            const rArr = r.scheduledArrival.getTime();
            const rDep = r.scheduledDeparture.getTime();
            const rCat = r.acCategory || getAircraftCategory(r.aircraftType || '');
            const rWide = rCat === 'D' || rCat === 'E' || rCat === 'F';
            const rHeavy = rCat === 'F';
            const rAllowed = getAllowedBridgeConcourses(r);

            for (const [stand, sched] of topology.entries()) {
                if (!isContactStand(stand)) continue;
                if (!rAllowed.some(c => sched.concourse.toUpperCase().includes(c.toUpperCase()))) continue;
                if (rWide && sched.isMarsSub) continue;
                if (rWide && !sched.isWideCompatible) continue;
                if (!rWide && sched.isMarsCenter) continue;
                if (rHeavy && !isStandCatFCompatible(stand)) continue;
                if (hasMaintenanceConflict(stand, r.scheduledArrival, r.scheduledDeparture, maintenanceBlocks)) continue;

                const blockers = new Set<string>();
                const collect = (ivs: StandSchedule['intervals']) => {
                    for (const iv of ivs) {
                        if (rArr < iv.end && rDep > iv.start) {
                            blockers.add(iv.flightId);
                        }
                    }
                };
                collect(sched.intervals);
                if (sched.isMarsSub && sched.marsCenterStand) {
                    const c = topology.get(sched.marsCenterStand);
                    if (c) collect(c.intervals);
                } else if (sched.isMarsCenter && sched.marsSubStands) {
                    for (const sub of sched.marsSubStands) {
                        const s = topology.get(sub);
                        if (s) collect(s.intervals);
                    }
                }

                if (blockers.size > MAX_BLOCKERS) continue;

                if (blockers.size === 0) {
                    r.parkingPosition = stand;
                    r.gate = stand;
                    placeOnStand(sched, rArr, rDep, r.id);
                    addedInPass++;
                    totalAdded++;
                    break;
                }

                const blockerFlights: Flight[] = [];
                let allMovable = true;
                for (const bid of blockers) {
                    const bf = flightById.get(bid);
                    if (!bf || isOperationalLockedFlight(bf) || (options && isFlightLockedByFidsOrTime(bf, options).isLocked)) {
                        allMovable = false;
                        break;
                    }
                    blockerFlights.push(bf);
                }
                if (!allMovable) continue;

                const moves: { bf: Flight; altStand: string }[] = [];
                const remainingBlockers = new Set<string>(blockers);
                let ok = true;

                for (const bf of blockerFlights) {
                    let altStand: string | null = null;
                    for (const [s2] of topology.entries()) {
                        if (s2 === stand) continue;
                        if (sched.marsCenterStand === s2 || (sched.marsSubStands && sched.marsSubStands.includes(s2))) continue;
                        if (canFitIgnoringIds(topology, s2, bf, remainingBlockers, maintenanceBlocks)) {
                            altStand = s2;
                            break;
                        }
                    }
                    if (!altStand) {
                        ok = false;
                        break;
                    }
                    moves.push({ bf, altStand });
                    remainingBlockers.delete(bf.id);
                    const altSched = topology.get(altStand)!;
                    placeOnStand(altSched, bf.scheduledArrival.getTime(), bf.scheduledDeparture.getTime(), bf.id);
                }

                if (!ok) {
                    for (const m of moves) {
                        const s = topology.get(m.altStand);
                        if (s) s.intervals = s.intervals.filter(iv => iv.flightId !== m.bf.id);
                    }

                    // 1-engelleyici 1-hop'a sığmadıysa ve aday uçuş <= 4.5 saat ise 2-Hop dene: r -> stand (bf1 -> s2) -> s2 (bf2 -> s3)
                    const rDurH = (rDep - rArr) / 3600000;
                    if (blockerFlights.length === 1 && rDurH <= 4.5 && pass === 0) {
                        const bf1 = blockerFlights[0];
                        const bf1Cat = bf1.acCategory || getAircraftCategory(bf1.aircraftType || '');
                        const bf1Wide = bf1Cat === 'D' || bf1Cat === 'E' || bf1Cat === 'F';
                        const bf1Heavy = bf1Cat === 'F';
                        const bf1Allowed = getAllowedBridgeConcourses(bf1);

                        let twoHopCommitted = false;
                        for (const [s2, sched2] of topology.entries()) {
                            if (s2 === stand || !isContactStand(s2)) continue;
                            if (sched.marsCenterStand === s2 || (sched.marsSubStands && sched.marsSubStands.includes(s2))) continue;
                            if (!bf1Allowed.some(c => sched2.concourse.toUpperCase().includes(c.toUpperCase()))) continue;
                            if (bf1Wide && sched2.isMarsSub) continue;
                            if (bf1Wide && !sched2.isWideCompatible) continue;
                            if (!bf1Wide && sched2.isMarsCenter) continue;
                            if (bf1Heavy && !isStandCatFCompatible(s2)) continue;
                            if (hasMaintenanceConflict(s2, bf1.scheduledArrival, bf1.scheduledDeparture, maintenanceBlocks)) continue;

                            const bf1Arr = bf1.scheduledArrival.getTime();
                            const bf1Dep = bf1.scheduledDeparture.getTime();
                            const b2Set = new Set<string>();
                            const collectB2 = (ivs: StandSchedule['intervals']) => {
                                for (const iv of ivs) {
                                    if (iv.flightId !== bf1.id && bf1Arr < iv.end && bf1Dep > iv.start) b2Set.add(iv.flightId);
                                }
                            };
                            collectB2(sched2.intervals);
                            if (sched2.isMarsSub && sched2.marsCenterStand) {
                                const c2 = topology.get(sched2.marsCenterStand);
                                if (c2) collectB2(c2.intervals);
                            } else if (sched2.isMarsCenter && sched2.marsSubStands) {
                                for (const sub2 of sched2.marsSubStands) {
                                    const sb2 = topology.get(sub2);
                                    if (sb2) collectB2(sb2.intervals);
                                }
                            }
                            if (b2Set.size !== 1) continue;
                            const bf2 = flightById.get([...b2Set][0]);
                            if (!bf2 || isOperationalLockedFlight(bf2) || (options && isFlightLockedByFidsOrTime(bf2, options).isLocked)) continue;

                            const ign2 = new Set<string>([bf1.id, bf2.id]);
                            for (const [s3] of topology.entries()) {
                                if (s3 === s2 || s3 === stand) continue;
                                if (sched2.marsCenterStand === s3 || (sched2.marsSubStands && sched2.marsSubStands.includes(s3))) continue;
                                if (sched.marsCenterStand === s3 || (sched.marsSubStands && sched.marsSubStands.includes(s3))) continue;
                                if (canFitIgnoringIds(topology, s3, bf2, ign2, maintenanceBlocks)) {
                                    const old1 = topology.get(bf1.parkingPosition!);
                                    if (old1) old1.intervals = old1.intervals.filter(iv => iv.flightId !== bf1.id);
                                    const old2 = topology.get(bf2.parkingPosition!);
                                    if (old2) old2.intervals = old2.intervals.filter(iv => iv.flightId !== bf2.id);

                                    bf2.parkingPosition = s3;
                                    bf2.gate = s3;
                                    placeOnStand(topology.get(s3)!, bf2.scheduledArrival.getTime(), bf2.scheduledDeparture.getTime(), bf2.id);

                                    bf1.parkingPosition = s2;
                                    bf1.gate = s2;
                                    placeOnStand(sched2, bf1Arr, bf1Dep, bf1.id);

                                    r.parkingPosition = stand;
                                    r.gate = stand;
                                    placeOnStand(sched, rArr, rDep, r.id);
                                    addedInPass++;
                                    totalAdded++;
                                    twoHopCommitted = true;
                                    break;
                                }
                            }
                            if (twoHopCommitted) break;
                        }
                        if (twoHopCommitted) break;
                    }
                    continue;
                }

                // Commit chain relocation
                for (const { bf, altStand } of moves) {
                    const oldStand = bf.parkingPosition!;
                    const oldSched = topology.get(oldStand);
                    if (oldSched) oldSched.intervals = oldSched.intervals.filter(iv => iv.flightId !== bf.id);
                    bf.parkingPosition = altStand;
                    bf.gate = altStand;
                }

                r.parkingPosition = stand;
                r.gate = stand;
                placeOnStand(sched, rArr, rDep, r.id);
                addedInPass++;
                totalAdded++;

                const rCallsign = r.departureFlightNumber || r.arrivalFlightNumber || r.id;
                addedSwaps.push({
                    stand,
                    concourse: sched.concourse,
                    removedFlight: {
                        id: blockerFlights[0].id,
                        callsign: blockerFlights[0].departureFlightNumber || blockerFlights[0].arrivalFlightNumber || blockerFlights[0].id,
                        acType: blockerFlights[0].aircraftType || '',
                        durationHours: Math.round((blockerFlights[0].scheduledDeparture.getTime() - blockerFlights[0].scheduledArrival.getTime()) / 3600000)
                    },
                    sentToRemote: moves[0]?.altStand || stand,
                    gainedFlights: [{
                        id: r.id,
                        callsign: rCallsign,
                        acType: r.aircraftType || '',
                        stand
                    }],
                    netGain: 1,
                    swapType: 'CAPACITY_SWAP'
                });
                break;
            }
        }

        if (addedInPass === 0) break;
    }

    // -----------------------------------------------------------------------
    // MARS CENTER 1-TO-2+ KAPASİTE TAKASI:
    // MARS Center standındaki 1 geniş gövde (ör. A8 TK0504) açığa alınınca
    // alt kollarına (A8L + A8R) açıkta bekleyen >= 2 dar gövde (ör. TK0775 + TK0355)
    // sığıyorsa, Öncelik 1 (Maksimum Uçak) gereği mutlaka 2+ dar gövdeyi köprüye al!
    // -----------------------------------------------------------------------
    const openApronsList = ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5', 'APRON 6', 'APRON 7'];
    const startMsWin = startDate ? startDate.getTime() : 0;
    const endMsWin = endDate ? endDate.getTime() : Infinity;
    const inSelectedDay = (f: Flight) => {
        const depMs = f.scheduledDeparture ? f.scheduledDeparture.getTime() : 0;
        return depMs >= startMsWin && depMs <= endMsWin;
    };

    const marsCenterFlights = working.filter(f => {
        if (!f.parkingPosition || !isContactStand(f.parkingPosition)) return false;
        const sc = topology.get(f.parkingPosition);
        if (!sc || !sc.isMarsCenter || !sc.marsSubStands || sc.marsSubStands.length < 2) return false;
        if (isOperationalLockedFlight(f)) return false;
        if (options && isFlightLockedByFidsOrTime(f, options).isLocked) return false;
        return true;
    });

    // En uzun yatan MARS Center geniş gövdelerini önce tara
    marsCenterFlights.sort((a, b) =>
        (b.scheduledDeparture.getTime() - b.scheduledArrival.getTime()) -
        (a.scheduledDeparture.getTime() - a.scheduledArrival.getTime())
    );

    for (const wb of marsCenterFlights) {
        const centerStand = wb.parkingPosition!;
        const centerSched = topology.get(centerStand);
        if (!centerSched || !centerSched.marsSubStands) continue;
        const [subLName, subRName] = centerSched.marsSubStands;
        const schedL = topology.get(subLName);
        const schedR = topology.get(subRName);
        if (!schedL || !schedR) continue;

        const wArr = wb.scheduledArrival.getTime();
        const wDep = wb.scheduledDeparture.getTime();
        const wbInDay = inSelectedDay(wb);

        // Açıkta bekleyen, bu zaman aralığıyla kesişen ve bu iskeleye uygun dar gövdeler
        const candidateNarrows = working.filter(f => {
            if (f.parkingPosition && isContactStand(f.parkingPosition)) return false;
            if (!isFlightBridgeEligible(f)) return false;
            if (isOperationalLockedFlight(f)) return false;
            if (options && isFlightLockedByFidsOrTime(f, options).isLocked) return false;
            const cat = f.acCategory || getAircraftCategory(f.aircraftType || '');
            if (cat === 'D' || cat === 'E' || cat === 'F') return false;
            const fArr = f.scheduledArrival.getTime();
            const fDep = f.scheduledDeparture.getTime();
            if (!(fArr < wDep && fDep > wArr)) return false;
            const allowed = getAllowedBridgeConcourses(f);
            return allowed.some(c => centerSched.concourse.toUpperCase().includes(c.toUpperCase()));
        });
        if (candidateNarrows.length < 2) continue;

        candidateNarrows.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());

        // Geçici olarak wb'yi center'dan kaldır
        centerSched.intervals = centerSched.intervals.filter(iv => iv.flightId !== wb.id);
        const placedNarrows: { f: Flight; subSched: StandSchedule }[] = [];

        for (const nf of candidateNarrows) {
            const nArr = nf.scheduledArrival.getTime();
            const nDep = nf.scheduledDeparture.getTime();
            if (!hasMaintenanceConflict(subLName, nf.scheduledArrival, nf.scheduledDeparture, maintenanceBlocks) &&
                canFitOnStand(schedL, nArr, nDep, false, topology, false)) {
                placeOnStand(schedL, nArr, nDep, nf.id);
                placedNarrows.push({ f: nf, subSched: schedL });
            } else if (!hasMaintenanceConflict(subRName, nf.scheduledArrival, nf.scheduledDeparture, maintenanceBlocks) &&
                canFitOnStand(schedR, nArr, nDep, false, topology, false)) {
                placeOnStand(schedR, nArr, nDep, nf.id);
                placedNarrows.push({ f: nf, subSched: schedR });
            }
        }

        const gainedInDay = placedNarrows.filter(p => inSelectedDay(p.f)).length;
        const netDayGain = gainedInDay - (wbInDay ? 1 : 0);

        if (placedNarrows.length >= 2 && netDayGain >= 1) {
            // wb için uygun açık park standı bul
            const wCat = wb.acCategory || getAircraftCategory(wb.aircraftType || '');
            const wHeavy = wCat === 'F';
            let remotePos: string | null = null;
            for (const ap of openApronsList) {
                for (const st of (CONCOURSE_LAYOUT[ap] || [])) {
                    const rSched = topology.get(st);
                    if (rSched && canFitOnStand(rSched, wArr, wDep, true, topology, wHeavy)) {
                        placeOnStand(rSched, wArr, wDep, wb.id);
                        remotePos = st;
                        break;
                    }
                }
                if (remotePos) break;
            }

            if (remotePos) {
                wb.parkingPosition = remotePos;
                wb.gate = null;
                for (const p of placedNarrows) {
                    p.f.parkingPosition = p.subSched.stand;
                    p.f.gate = p.subSched.stand;
                }
                const netGain = placedNarrows.length - 1;
                totalAdded += netGain;
                addedSwaps.push({
                    stand: centerStand,
                    concourse: centerSched.concourse,
                    removedFlight: {
                        id: wb.id,
                        callsign: wb.departureFlightNumber || wb.arrivalFlightNumber || wb.id,
                        acType: wb.aircraftType || '',
                        durationHours: Math.round((wDep - wArr) / 3600000)
                    },
                    sentToRemote: remotePos,
                    gainedFlights: placedNarrows.map(p => ({
                        id: p.f.id,
                        callsign: p.f.departureFlightNumber || p.f.arrivalFlightNumber || p.f.id,
                        acType: p.f.aircraftType || '',
                        stand: p.subSched.stand
                    })),
                    netGain,
                    swapType: 'CAPACITY_SWAP'
                });
                continue;
            }
        }

        // Olmadıysa geri al
        for (const p of placedNarrows) {
            p.subSched.intervals = p.subSched.intervals.filter(iv => iv.flightId !== p.f.id);
        }
        placeOnStand(centerSched, wArr, wDep, wb.id);
    }

    if (totalAdded === 0) return result;

    const stats = calculateBridgeUtilization(working, startDate, endDate);
    return {
        ...result,
        flights: working,
        stats,
        swapDetails: [...result.swapDetails, ...addedSwaps],
        totalSwapsPerformed: result.totalSwapsPerformed + totalAdded,
        netFlightsGained: result.netFlightsGained + totalAdded
    };
}

// ---------------------------------------------------------------------------
// 6. Master AI Bridge Allocation Entry Point
// ---------------------------------------------------------------------------
export function runAiBridgeAllocation(
    allFlights: Flight[],
    startDate?: Date,
    endDate?: Date,
    maintenanceBlocks?: MaintenanceBlock[],
    options?: AiAllocationOptions
): AiAllocationResult {
    // -----------------------------------------------------------------------
    // TARİH İZOLASYONU: Seçili tarih aralığı (±12 saat) dışındaki günler korunur
    // -----------------------------------------------------------------------
    let scopedFlights = allFlights;
    let outsideFlights: Flight[] = [];
    if (startDate && endDate) {
        const winStart = startDate.getTime() - 12 * 3600000;
        const winEnd = endDate.getTime() + 12 * 3600000;
        scopedFlights = [];
        for (const f of allFlights) {
            const depMs = f.scheduledDeparture ? f.scheduledDeparture.getTime() : 0;
            const arrMs = f.scheduledArrival ? f.scheduledArrival.getTime() : depMs;
            if ((depMs >= winStart && depMs <= winEnd) || (arrMs >= winStart && arrMs <= winEnd)) {
                scopedFlights.push(f);
            } else {
                outsideFlights.push({ ...f });
            }
        }
    }

    const existingContactCount = scopedFlights.filter(f => f.parkingPosition && isContactStand(f.parkingPosition)).length;

    // -----------------------------------------------------------------------
    // ÖNCELİK 1: MAKSİMUM UÇAK PLANLAMASI (0 dk tampon + Chain-Swap, Sıfır Tow)
    // -----------------------------------------------------------------------
    let elevateResult: AiAllocationResult | null = null;
    if (existingContactCount > 0) {
        elevateResult = runPreserveAndElevateAllocation(scopedFlights, startDate, endDate, maintenanceBlocks, options);
        if (elevateResult) {
            elevateResult = runChainSwapPass(elevateResult, startDate, endDate, maintenanceBlocks, options);
        }
    }

    let scratchResult = runFromScratchAllocation(scopedFlights, startDate, endDate, maintenanceBlocks, options);
    scratchResult = runChainSwapPass(scratchResult, startDate, endDate, maintenanceBlocks, options);

    let phase1Result: AiAllocationResult;
    if (elevateResult && elevateResult.stats.bridgeAssignedCount >= scratchResult.stats.bridgeAssignedCount) {
        phase1Result = elevateResult;
    } else {
        phase1Result = scratchResult;
    }

    // -----------------------------------------------------------------------
    // ÖNCELİK 2: KÖPRÜ ORANI KORUNARAK MAKSİMUM GELİR TAKASI (Revenue Swap)
    // -----------------------------------------------------------------------
    let revenueEnhancedResult = runRevenueMaximizationSwapPass(
        phase1Result,
        startDate,
        endDate,
        maintenanceBlocks,
        options
    );

    // Öncelik 1 Garantisi: Gelir takası sonrası MARS Center veya yeni açılan boşlukta
    // +1 / +2 ilave uçak fırsatı doğduysa hemen köprüye çek (Öncelik 1 > Öncelik 2)
    if (revenueEnhancedResult.revenueSwapSummary && revenueEnhancedResult.revenueSwapSummary.swapsCount > 0) {
        const postRevCapacity = runChainSwapPass(revenueEnhancedResult, startDate, endDate, maintenanceBlocks, options);
        if (postRevCapacity.stats.bridgeAssignedCount > revenueEnhancedResult.stats.bridgeAssignedCount) {
            revenueEnhancedResult = postRevCapacity;
        }
    }

    // -----------------------------------------------------------------------
    // ÖNCELİK 3: EN GENİŞ ARALIKLAR / KUSURSUZ DİZİLİM (Buffer Smoothing)
    // -----------------------------------------------------------------------
    const smoothTopology = buildStandTopology(maintenanceBlocks);
    const smoothUpdates = new Map<string, string | null>();
    for (const f of revenueEnhancedResult.flights) {
        smoothUpdates.set(f.id, f.parkingPosition || null);
        if (f.parkingPosition && isContactStand(f.parkingPosition)) {
            const sched = smoothTopology.get(f.parkingPosition);
            if (sched) placeOnStand(sched, f.scheduledArrival.getTime(), f.scheduledDeparture.getTime(), f.id);
        }
    }
    const postRevSmoothed = runBufferSmoothingPass(revenueEnhancedResult.flights, smoothUpdates, smoothTopology, maintenanceBlocks, options, true);
    const smoothedScopedFlights = revenueEnhancedResult.flights.map(f => {
        const newPos = smoothUpdates.get(f.id);
        if (newPos && newPos !== f.parkingPosition) {
            return { ...f, parkingPosition: newPos, gate: isContactStand(newPos) ? newPos : f.gate };
        }
        return f;
    });

    // Son kontrol: Revenue Swap veya çakışma temizliği sonrası 'REMOTE' veya null kalan uygun uçuşları açık apron standına yerleştir
    const finalOpenAprons = ['APRON 1', 'APRON 2', 'APRON 3', 'APRON 4', 'APRON 5', 'APRON 6', 'APRON 7'];
    const remoteTopo = buildStandTopology(maintenanceBlocks);
    for (const f of smoothedScopedFlights) {
        if (f.parkingPosition && remoteTopo.has(f.parkingPosition)) {
            placeOnStand(remoteTopo.get(f.parkingPosition)!, f.scheduledArrival.getTime(), f.scheduledDeparture.getTime(), f.id);
        }
    }
    for (const f of smoothedScopedFlights) {
        if (isOperationalLockedFlight(f) || (options && isFlightLockedByFidsOrTime(f, options).isLocked)) continue;
        if (!isFlightBridgeEligible(f)) continue;
        if (f.parkingPosition && f.parkingPosition !== 'REMOTE' && remoteTopo.has(f.parkingPosition)) continue;
        const arrMs = f.scheduledArrival.getTime();
        const depMs = f.scheduledDeparture.getTime();
        const cat = f.acCategory || getAircraftCategory(f.aircraftType || '');
        const isWide = cat === 'D' || cat === 'E' || cat === 'F';
        const isHeavy = cat === 'F';
        for (const apronName of finalOpenAprons) {
            const stands = CONCOURSE_LAYOUT[apronName] || [];
            let placed = false;
            for (const s of stands) {
                const sched = remoteTopo.get(s);
                if (sched && canFitOnStand(sched, arrMs, depMs, isWide, remoteTopo, isHeavy)) {
                    placeOnStand(sched, arrMs, depMs, f.id);
                    f.parkingPosition = sched.stand;
                    f.gate = null;
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }
    }

    // Dışarıdaki günlerin uçuşlarını birleştir
    const combinedFlights = outsideFlights.length > 0
        ? [...outsideFlights, ...smoothedScopedFlights]
        : smoothedScopedFlights;
    const finalStats = calculateBridgeUtilization(combinedFlights, startDate, endDate, maintenanceBlocks);

    return {
        ...revenueEnhancedResult,
        flights: combinedFlights,
        stats: finalStats,
        bufferSmoothedCount: (revenueEnhancedResult.bufferSmoothedCount || 0) + postRevSmoothed
    };
}

/**
 * FAZ 2: KÖPRÜ KULLANIM ORANI SABİT TUTULARAK GELİR MAKSİMİZASYONU
 *
 * Mantık:
 * 1. Faz 1'de ulaşılan maksimum köprü kullanım oranı ve köprüye bağlanan uçuş sayısı kesinlikle düşürülemez.
 * 2. Köprüdeki düşük gelirli/küçük MTOW'lu uçaklar ile açıktaki (remote) yüksek gelirli/geniş gövdeli/yüksek yolculu uçaklar taranır.
 * 3. 1'e 1 ve 1'e N takaslar denenir; sadece pozitif gelir farkı (+€) sağlayan ve tüm AMS/MARS kurallarını sağlayan takaslar commit edilir.
 * 4. Takas sonrası sistem yeniden taranır (iteratif döngü).
 */
export function runRevenueMaximizationSwapPass(
    phase1Result: AiAllocationResult,
    startDate?: Date,
    endDate?: Date,
    maintenanceBlocks?: MaintenanceBlock[],
    options?: AiAllocationOptions
): AiAllocationResult {
    const workingFlights: Flight[] = phase1Result.flights.map(f => ({ ...f }));
    const initialBridgeCount = workingFlights.filter(f => f.parkingPosition && isContactStand(f.parkingPosition)).length;
    
    // Toplam başlangıç geliri
    const calcTotalRev = (list: Flight[]) => list.reduce((sum, f) => sum + (calculateRevenue(f).totalEur || 0), 0);
    const initialRevenueEur = Math.round(calcTotalRev(workingFlights));

    const revenueSwapDetails: RevenueSwapSummary['details'] = [];
    const addedSwapDetails: SwapDetail[] = [];
    let performedRevenueSwaps = 0;

    // İteratif tarama (En fazla 15 tam geçiş)
    const MAX_ITERATIONS = 15;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        let swapFoundInIter = false;

        // Köprüdeki ve açıktaki uçuşları ayıkla (sadece köprüye uygun yolcu uçuşları)
        const bridgeFlights = workingFlights.filter(f => {
            if (!f.parkingPosition || !isContactStand(f.parkingPosition)) return false;
            if (!isFlightBridgeEligible(f)) return false;
            if (isOperationalLockedFlight(f)) return false;
            if (options && isFlightLockedByFidsOrTime(f, options).isLocked) return false;
            return true;
        });

        const remoteFlights = workingFlights.filter(f => {
            if (f.parkingPosition && isContactStand(f.parkingPosition)) return false;
            if (!isFlightBridgeEligible(f)) return false;
            if (isOperationalLockedFlight(f)) return false;
            if (options && isFlightLockedByFidsOrTime(f, options).isLocked) return false;
            return true;
        });

        // Açıktaki uçakları potansiyel gelirlerine göre azalan sırada sırala
        remoteFlights.sort((a, b) => {
            // Açıktaki uçak köprüye bağlansa ne kadar üretirdi?
            const dummyA = { ...a, parkingPosition: 'A1' };
            const dummyB = { ...b, parkingPosition: 'A1' };
            return (calculateRevenue(dummyB).totalEur || 0) - (calculateRevenue(dummyA).totalEur || 0);
        });

        // Köprüdeki uçakları mevcut gelirlerine göre artan sırada sırala (en düşük gelirli köprü uçağı en önce takas adayı)
        bridgeFlights.sort((a, b) => {
            return (calculateRevenue(a).totalEur || 0) - (calculateRevenue(b).totalEur || 0);
        });

        const startMs = startDate ? startDate.getTime() : 0;
        const endMs = endDate ? endDate.getTime() : Infinity;
        const isInSelectedDateWindow = (f: Flight) => {
            const depMs = f.scheduledDeparture ? f.scheduledDeparture.getTime() : 0;
            return depMs >= startMs && depMs <= endMs;
        };

        // Topolojiyi iterasyon başına BİR KEZ kur (100x hızlandırma)
        const iterTopology = buildStandTopology(maintenanceBlocks);
        for (const f of workingFlights) {
            if (!f.parkingPosition || !isContactStand(f.parkingPosition)) continue;
            const sched = iterTopology.get(f.parkingPosition);
            if (sched) {
                placeOnStand(sched, f.scheduledArrival.getTime(), f.scheduledDeparture.getTime(), f.id);
            }
        }

        // 1-to-1 ve Stand İçi Swap Arama
        for (const remoteF of remoteFlights) {
            if (remoteF.parkingPosition && isContactStand(remoteF.parkingPosition)) continue;

            const remArr = remoteF.scheduledArrival.getTime();
            const remDep = remoteF.scheduledDeparture.getTime();
            const remAllowedConcourses = getAllowedBridgeConcourses(remoteF);
            const remInWindow = isInSelectedDateWindow(remoteF);

            for (const bridgeF of bridgeFlights) {
                // Bu iterasyonda daha önce takas edilmişse atla
                if (!bridgeF.parkingPosition || !isContactStand(bridgeF.parkingPosition)) continue;

                // Seçili tarih aralığındaki köprü sayısının düşmemesi ve günler arası kayma olmaması için pencere uyumu kontrolü
                if (isInSelectedDateWindow(bridgeF) !== remInWindow) {
                    continue;
                }

                const bridgeStand = bridgeF.parkingPosition;
                const bridgeConcourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c]?.includes(bridgeStand)) || '';

                // İskele izinleri uyumlu mu?
                if (remAllowedConcourses.length > 0 && !remAllowedConcourses.some(allowed => bridgeConcourse.toUpperCase().includes(allowed.toUpperCase()))) {
                    continue;
                }

                // Gelir farkı kontrolü: Açıktaki uçak bu köprüde daha fazla gelir üretiyor mu?
                const currentBrgRev = calculateRevenue(bridgeF).totalEur || 0;
                const hypotheticalRem = { ...remoteF, parkingPosition: bridgeStand };
                const projectedRemRev = calculateRevenue(hypotheticalRem).totalEur || 0;

                const revenueGain = projectedRemRev - currentBrgRev;
                // En az €35 net gelir artışı şartı
                if (revenueGain < 35) continue;

                // Topoloji üzerinde bridgeF hariç çakışma ve AMS/MARS kuralları kontrolü
                const ignoreSet = new Set<string>([bridgeF.id]);
                if (!canFitIgnoringIds(iterTopology, bridgeStand, remoteF, ignoreSet, maintenanceBlocks)) {
                    continue;
                }

                // TAKAS ONAYLANDI!
                const oldRemoteStand = remoteF.parkingPosition || 'REMOTE';
                const brgArr = bridgeF.scheduledArrival.getTime();
                const brgDep = bridgeF.scheduledDeparture.getTime();
                
                // Topolojiyi yerinde güncelle
                const brgSched = iterTopology.get(bridgeStand);
                if (brgSched) {
                    brgSched.intervals = brgSched.intervals.filter(iv => iv.flightId !== bridgeF.id);
                    placeOnStand(brgSched, remArr, remDep, remoteF.id);
                }

                // Köprüdeki uçağı açığa, açıktaki uçağı köprüye al
                bridgeF.parkingPosition = oldRemoteStand;
                bridgeF.gate = null;
                remoteF.parkingPosition = bridgeStand;

                // Gate senkronizasyonu
                if (isContactStand(bridgeStand)) {
                    remoteF.gate = bridgeStand;
                }

                performedRevenueSwaps++;
                swapFoundInIter = true;

                const bridgeCallsign = bridgeF.departureFlightNumber || bridgeF.arrivalFlightNumber || bridgeF.id;
                const remoteCallsign = remoteF.departureFlightNumber || remoteF.arrivalFlightNumber || remoteF.id;

                revenueSwapDetails.push({
                    bridgeFlightCallsign: bridgeCallsign,
                    remoteFlightCallsign: remoteCallsign,
                    bridgeStand,
                    remoteStand: oldRemoteStand,
                    revenueGainEur: Math.round(revenueGain),
                    reason: `Körük geliri artırımı: ${remoteCallsign} (${remoteF.aircraftType || 'A/C'}) köprüye alındı, ${bridgeCallsign} açığa aktarıldı (+€${Math.round(revenueGain)})`
                });

                addedSwapDetails.push({
                    stand: bridgeStand,
                    concourse: bridgeConcourse,
                    removedFlight: {
                        id: bridgeF.id,
                        callsign: bridgeCallsign,
                        acType: bridgeF.aircraftType || '',
                        durationHours: Math.round((brgDep - brgArr) / 3600000)
                    },
                    sentToRemote: oldRemoteStand,
                    gainedFlights: [{
                        id: remoteF.id,
                        callsign: remoteCallsign,
                        acType: remoteF.aircraftType || '',
                        stand: bridgeStand
                    }],
                    netGain: 0, // Köprü sayısı sabit kaldı (+0 net gain in count, +€ in revenue)
                    revenueGainEur: Math.round(revenueGain),
                    swapType: 'OCC_REVENUE_SWAP'
                });

                break; // bridgeFlights döngüsünden çık, bir sonraki remote'a geç
            }
        }

        if (!swapFoundInIter) {
            // Başka takas imkanı kalmadı, döngüyü sonlandır
            break;
        }
    }

    // -------------------------------------------------------------------------
    // PASS H (Yalnızca ETA-ETD Modu): Hayalet Gölge Çubuğu Soft-Kaçınma Pass'i
    // - Gölge, başka bir uçağın slot gövdesiyle çakışıyorsa temiz köprü alternatifi arar.
    // - Gölgeler üst üste binebilir; hiç temiz alternatif kalmazsa köprü oranını koruyarak yerinde bırakır.
    // -------------------------------------------------------------------------
    const activePlanningMode: PlanningTimeMode = options?.planningMode || 'AIBT_AOBT';
    let shadowAvoidedCount = 0;
    let closeGateOptimizedCount = 0;

    const rebuildWorkingTopology = (): { topo: Map<string, StandSchedule>; byId: Map<string, Flight> } => {
        const topo = buildStandTopology(maintenanceBlocks);
        const byId = new Map<string, Flight>();
        for (const f of workingFlights) {
            byId.set(f.id, f);
            if (f.parkingPosition) {
                const s = topo.get(f.parkingPosition);
                if (s) placeOnStand(s, f.scheduledArrival.getTime(), f.scheduledDeparture.getTime(), f.id);
            }
        }
        return { topo, byId };
    };

    const hasShadowBodyCollision = (
        topo: Map<string, StandSchedule>,
        byId: Map<string, Flight>,
        standName: string,
        flight: Flight,
        ignoreIds: Set<string>
    ): boolean => {
        if (activePlanningMode !== 'ETA_ETD') return false;
        const sched = topo.get(standName);
        if (!sched) return false;
        const checkStands: string[] = [standName];
        if (sched.marsCenterStand) checkStands.push(sched.marsCenterStand);
        if (sched.marsSubStands) checkStands.push(...sched.marsSubStands);

        const fStart = flight.scheduledArrival.getTime();
        const fEnd = flight.scheduledDeparture.getTime();
        const fShEnd = getFlightShadowEndMs(flight, activePlanningMode);

        for (const st of checkStands) {
            const stSched = topo.get(st);
            if (!stSched) continue;
            for (const iv of stSched.intervals) {
                if (iv.flightId === flight.id || ignoreIds.has(iv.flightId) || iv.flightId.startsWith('MAINT_')) continue;
                const other = byId.get(iv.flightId);
                if (!other) continue;
                const oStart = other.scheduledArrival.getTime();
                const oEnd = other.scheduledDeparture.getTime();
                const oShEnd = getFlightShadowEndMs(other, activePlanningMode);

                // Uçuşun gölgesi (fEnd..fShEnd) diğerinin gövdesine (oStart..oEnd) değiyor mu?
                const myShadowHitsOther = fShEnd > fEnd && fShEnd > oStart && fEnd < oEnd;
                // Diğerinin gölgesi (oEnd..oShEnd) bu uçuşun gövdesine (fStart..fEnd) değiyor mu?
                const otherShadowHitsMe = oShEnd > oEnd && oShEnd > fStart && oEnd < fEnd;
                if (myShadowHitsOther || otherShadowHitsMe) return true;
            }
        }
        return false;
    };

    const isUnlockedForRelocation = (f: Flight): boolean => {
        if (isOperationalLockedFlight(f)) return false;
        if (isFlightLockedByFidsOrTime(f, options).isLocked) return false;
        return true;
    };

    if (activePlanningMode === 'ETA_ETD') {
        const { topo: shTopo, byId } = rebuildWorkingTopology();
        for (let pass = 0; pass < 3; pass++) {
            let movedAny = false;
            const bridgeList = workingFlights.filter(f =>
                f.parkingPosition && isContactStand(f.parkingPosition) && isUnlockedForRelocation(f)
            );
            for (const f of bridgeList) {
                const curStand = f.parkingPosition!;
                if (!hasShadowBodyCollision(shTopo, byId, curStand, f, new Set())) continue;

                const allowedConc = getAllowedBridgeConcourses(f);
                const ignoreSelf = new Set([f.id]);
                const fArr = f.scheduledArrival.getTime();
                const fDep = f.scheduledDeparture.getTime();
                const fCat = f.acCategory || getAircraftCategory(f.aircraftType);
                const fWide = fCat === 'D' || fCat === 'E' || fCat === 'F';

                // 1. Doğrudan gölge-temiz boş köprü standı ara
                let bestCleanStand: string | null = null;
                let bestCleanScore = -Infinity;
                for (const conc of allowedConc) {
                    for (const cand of (CONCOURSE_LAYOUT[conc] || [])) {
                        if (cand === curStand) continue;
                        if (!canFitIgnoringIds(shTopo, cand, f, ignoreSelf, maintenanceBlocks)) continue;
                        if (hasShadowBodyCollision(shTopo, byId, cand, f, ignoreSelf)) continue;

                        const candSched = shTopo.get(cand);
                        let sc = 100;
                        if (isCloseGateRequiredDeparture(f)) {
                            const tier = getCloseGateTier(cand, fWide);
                            if (tier === 1) sc += 300;
                            else if (tier === 2) sc += 180;
                            else if (tier === 3) sc += 80;
                        }
                        if (fWide && candSched && (!candSched.isMarsCenter || (candSched.marsSubStands?.length ?? 0) <= 1)) sc += 120;
                        if (!fWide && candSched && !candSched.isMarsSub && !isStandWidebodyCompatible(cand)) sc += 80;
                        if (sc > bestCleanScore) {
                            bestCleanScore = sc;
                            bestCleanStand = cand;
                        }
                    }
                }

                if (bestCleanStand) {
                    const oldSched = shTopo.get(curStand);
                    if (oldSched) oldSched.intervals = oldSched.intervals.filter(iv => iv.flightId !== f.id);
                    const newSched = shTopo.get(bestCleanStand)!;
                    placeOnStand(newSched, fArr, fDep, f.id);
                    f.parkingPosition = bestCleanStand;
                    f.gate = bestCleanStand;
                    shadowAvoidedCount++;
                    movedAny = true;
                }
            }
            if (!movedAny) break;
        }
    }

    // -------------------------------------------------------------------------
    // PASS I: ABD, İngiltere & Kanada Gidişleri — Close Gate Soft Öncelik Pass'i
    // - Geniş Gövde: 1) D7-D15  2) D6, D16, D17  3) B4, B10, B12, A7  4) Diğer köprüler
    // - Dar Gövde:   1) A2,A3,A5,A6,A11,B1,B3,B5,B7,D5,F1,F3,F5,F7,F8 (MARS L/R dahil)  2) Diğer köprüler
    // - Altın Kural: Köprü kullanım oranını ASLA düşürmez, gölge/tampon çakışması yaratmaz!
    // -------------------------------------------------------------------------
    {
        const { topo: cgTopo, byId } = rebuildWorkingTopology();
        const cgCandidates = workingFlights.filter(f =>
            f.parkingPosition &&
            isContactStand(f.parkingPosition) &&
            isCloseGateRequiredDeparture(f) &&
            isUnlockedForRelocation(f)
        );

        // Geniş gövdelere önce Close Gate hakkı ver
        cgCandidates.sort((a, b) => {
            const catA = a.acCategory || getAircraftCategory(a.aircraftType);
            const catB = b.acCategory || getAircraftCategory(b.aircraftType);
            const wA = (catA === 'D' || catA === 'E' || catA === 'F') ? 1 : 0;
            const wB = (catB === 'D' || catB === 'E' || catB === 'F') ? 1 : 0;
            if (wA !== wB) return wB - wA;
            return a.scheduledArrival.getTime() - b.scheduledArrival.getTime();
        });

        const standConcourseMap = new Map<string, string>();
        for (const [cName, list] of Object.entries(CONCOURSE_LAYOUT)) {
            for (const s of list) standConcourseMap.set(s, cName);
        }

        for (const f of cgCandidates) {
            const curStand = f.parkingPosition!;
            const fCat = f.acCategory || getAircraftCategory(f.aircraftType);
            const fWide = fCat === 'D' || fCat === 'E' || fCat === 'F';
            const curTier = getCloseGateTier(curStand, fWide);
            if (curTier === 1) continue; // Zaten 1. öncelikli Close Gate'te!

            const allowedConc = new Set(getAllowedBridgeConcourses(f));
            const betterStands: string[] = [];
            if (fWide) {
                betterStands.push(...Array.from(CLOSE_GATE_WIDE_TIER1));
                if (curTier === 0 || curTier > 2) betterStands.push(...Array.from(CLOSE_GATE_WIDE_TIER2));
                if (curTier === 0) betterStands.push(...Array.from(CLOSE_GATE_WIDE_TIER3));
            } else {
                betterStands.push(...Array.from(CLOSE_GATE_NARROW_TIER1));
            }

            const fArr = f.scheduledArrival.getTime();
            const fDep = f.scheduledDeparture.getTime();
            const ignoreSelf = new Set([f.id]);
            let placedBetter = false;

            // 1. Öncelik: Boş uygun Close Gate'e doğrudan taşı
            for (const cand of betterStands) {
                if (cand === curStand) continue;
                const candConc = standConcourseMap.get(cand);
                if (!candConc || !allowedConc.has(candConc)) continue;
                if (!canFitIgnoringIds(cgTopo, cand, f, ignoreSelf, maintenanceBlocks)) continue;
                if (hasShadowBodyCollision(cgTopo, byId, cand, f, ignoreSelf)) continue;

                const oldSched = cgTopo.get(curStand);
                if (oldSched) oldSched.intervals = oldSched.intervals.filter(iv => iv.flightId !== f.id);
                const newSched = cgTopo.get(cand)!;
                placeOnStand(newSched, fArr, fDep, f.id);
                f.parkingPosition = cand;
                f.gate = cand;
                closeGateOptimizedCount++;
                placedBetter = true;
                break;
            }

            // 2. Öncelik: Köprü oranını bozmadan (1-1 takas) Close Gate'teki normal bir uçakla yer değiştir
            if (!placedBetter) {
                const curConc = standConcourseMap.get(curStand);
                for (const cand of betterStands) {
                    if (cand === curStand) continue;
                    const candConc = standConcourseMap.get(cand);
                    if (!candConc || !allowedConc.has(candConc)) continue;
                    const candSched = cgTopo.get(cand);
                    if (!candSched) continue;

                    // cand üzerinde (MARS dahil) f ile çakışan tüm uçuşları bul
                    const checkStands = [cand];
                    if (candSched.marsCenterStand) checkStands.push(candSched.marsCenterStand);
                    if (candSched.marsSubStands) checkStands.push(...candSched.marsSubStands);

                    const blockingIds = new Set<string>();
                    let hasMaintBlock = false;
                    for (const st of checkStands) {
                        const stSched = cgTopo.get(st);
                        if (!stSched) continue;
                        for (const iv of stSched.intervals) {
                            if (iv.flightId === f.id) continue;
                            if (fArr < iv.end && fDep > iv.start) {
                                if (iv.flightId.startsWith('MAINT_')) { hasMaintBlock = true; break; }
                                blockingIds.add(iv.flightId);
                            }
                        }
                        if (hasMaintBlock) break;
                    }
                    if (hasMaintBlock || blockingIds.size !== 1) continue;

                    const blockerId = Array.from(blockingIds)[0];
                    const blocker = byId.get(blockerId);
                    if (!blocker || !blocker.parkingPosition) continue;
                    if (!isUnlockedForRelocation(blocker)) continue;
                    if (isCloseGateRequiredDeparture(blocker)) continue; // Başka ABD/UK/CA uçağını yerinden etme!

                    const blockerOrigStand = blocker.parkingPosition;
                    // blocker'ın eski f standına (curStand) sığıp sığmadığını kontrol et
                    if (!curConc || !getAllowedBridgeConcourses(blocker).includes(curConc)) continue;
                    const ignorePair = new Set([f.id, blocker.id]);
                    if (!canFitIgnoringIds(cgTopo, curStand, blocker, ignorePair, maintenanceBlocks)) continue;
                    if (!canFitIgnoringIds(cgTopo, cand, f, ignorePair, maintenanceBlocks)) continue;
                    if (hasShadowBodyCollision(cgTopo, byId, curStand, blocker, ignorePair)) continue;
                    if (hasShadowBodyCollision(cgTopo, byId, cand, f, ignorePair)) continue;

                    // 1-1 SIFIR KAYIPLI CLOSE GATE TAKASI!
                    const fOldSched = cgTopo.get(curStand);
                    const bOldSched = cgTopo.get(blockerOrigStand);
                    if (fOldSched) fOldSched.intervals = fOldSched.intervals.filter(iv => iv.flightId !== f.id);
                    if (bOldSched) bOldSched.intervals = bOldSched.intervals.filter(iv => iv.flightId !== blocker.id);

                    placeOnStand(cgTopo.get(cand)!, fArr, fDep, f.id);
                    placeOnStand(cgTopo.get(curStand)!, blocker.scheduledArrival.getTime(), blocker.scheduledDeparture.getTime(), blocker.id);

                    f.parkingPosition = cand;
                    f.gate = cand;
                    blocker.parkingPosition = curStand;
                    blocker.gate = curStand;
                    closeGateOptimizedCount++;
                    placedBetter = true;
                    break;
                }
            }
        }
    }

    // Son köprü kullanım istatistiklerini hesapla
    const finalStats = calculateBridgeUtilization(workingFlights, startDate, endDate, maintenanceBlocks);
    const finalBridgeCount = workingFlights.filter(f => f.parkingPosition && isContactStand(f.parkingPosition)).length;
    const finalRevenueEur = Math.round(calcTotalRev(workingFlights));
    const netRevenueGainEur = Math.max(0, finalRevenueEur - initialRevenueEur);

    // KÖPRÜ KULLANIM ORANI KONTROLÜ:
    // Eğer köprü sayısı veya seçili gün köprü oranı düştüyse, Faz 1 sonucunu aynen iade et!
    if (finalBridgeCount < initialBridgeCount || finalStats.bridgeAssignedCount < phase1Result.stats.bridgeAssignedCount) {
        console.warn('Revenue swap pass could not maintain bridge count/rate! Falling back to Phase 1 allocation.');
        return phase1Result;
    }

    const revenueSummary: RevenueSwapSummary = {
        swapsCount: performedRevenueSwaps,
        netRevenueGainEur,
        initialRevenueEur,
        finalRevenueEur,
        bridgeCountBefore: initialBridgeCount,
        bridgeCountAfter: finalBridgeCount,
        bridgeRateMaintained: finalBridgeCount >= initialBridgeCount,
        details: revenueSwapDetails
    };

    return {
        flights: workingFlights,
        stats: finalStats,
        swapDetails: [...phase1Result.swapDetails, ...addedSwapDetails],
        totalSwapsPerformed: phase1Result.totalSwapsPerformed + performedRevenueSwaps,
        netFlightsGained: phase1Result.netFlightsGained,
        gapFillsPerformed: phase1Result.gapFillsPerformed,
        bufferSmoothedCount: phase1Result.bufferSmoothedCount,
        revenueSwapSummary: revenueSummary,
        fidsWarnings: phase1Result.fidsWarnings,
        fidsLockedCount: phase1Result.fidsLockedCount,
        timeFilteredFlightCount: phase1Result.timeFilteredFlightCount,
        shadowAvoidedCount,
        closeGateOptimizedCount
    };
}
