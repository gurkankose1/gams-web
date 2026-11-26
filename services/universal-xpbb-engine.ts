import * as XLSX from 'xlsx';
import type { Flight, MaintenanceBlock } from '../types.ts';
import type { CompiledTopology, BridgeStandSpec } from './universal-xpbb-topology.ts';
import {
  NON_BRIDGEABLE_TYPES,
  getAircraftCategory,
  isBridgeStandName
} from './universal-xpbb-topology.ts';

export interface RawFlight {
  id: string;
  flightNo: string;
  airline: string;
  acType: string;
  acCategory: 'B' | 'C' | 'D' | 'E' | 'F';
  arrStand: string;
  depStand: string;
  isDepBridge: boolean;
  isArrBridge: boolean;
  isHybridBridge: boolean;
  isPassengerMode: boolean;
  isEligible: boolean;
  dateStr: string;      // ATD date (YYYY-MM-DD)
  ataDateStr: string;   // ATA date (YYYY-MM-DD)
  flightType: 'D/D' | 'I/I' | 'D/I' | 'I/D';
  // Scheduled window (STA -> STD)
  planStartMs: number;
  planEndMs: number;
  planGroundMins: number;
  // Realized / OTP window (On Block/ATA -> Off Block/ATD)
  actualStartMs: number;
  actualEndMs: number;
  actualGroundMins: number;
  arrDelayMins?: number;
  depDelayMins?: number;
}

export interface StandOutageBlock {
  stand: string;
  dateStr: string;
  startMs: number;
  endMs: number;
  hours: number;
  isDomStand: boolean;
  /** True if this outage closes an entire MARS center (blocks both L and R = 2 narrow slots) */
  isMarsCenterClosure?: boolean;
}

export interface UnplacedBreakdown {
  domFull: number;
  wideFull: number;
  capacityFull: number;
  closureLoss: number;
}

export interface AirportFlightDynamics {
  sampleCount: number;
  avgGroundMins: number;
  medianTurnaroundMins: number;   // P50
  p75GroundMins: number;          // P75
  autoLongStayThresholdMins: number; // P80 (meydanın en uzun %20 kalışları = otomatik yatı eşiği!)
  autoBoardingWindowMins: number;    // Medyan dönüşe göre otomatik çekme/biniş penceresi (45..110 dk)
  longStaySharePct: number;
}

export function computeAirportFlightDynamics(flights: RawFlight[]): AirportFlightDynamics {
  const durs = flights
    .filter(f => f.isEligible && f.actualGroundMins >= 20 && f.actualGroundMins <= 1440)
    .map(f => f.actualGroundMins)
    .sort((a, b) => a - b);

  if (durs.length === 0) {
    return {
      sampleCount: 0,
      avgGroundMins: 180,
      medianTurnaroundMins: 110,
      p75GroundMins: 210,
      autoLongStayThresholdMins: 300,
      autoBoardingWindowMins: 90,
      longStaySharePct: 20
    };
  }

  const pct = (p: number) => durs[Math.min(durs.length - 1, Math.floor(durs.length * p))];
  const avg = Math.round(durs.reduce((s, v) => s + v, 0) / durs.length);
  const p50 = pct(0.50);
  const p75 = pct(0.75);
  const p80 = pct(0.80);

  // Evrensel adaptif yatı eşiği: O meydanın en uzun %20'lik kalış sınırı (P80), min 180 dk
  const autoLongStayThresholdMins = Math.max(180, Math.round(p80 / 5) * 5);
  // Evrensel adaptif biniş/çekme penceresi: Medyan dönüşün %80'i (LCC'de ~45 dk, mega hub'da ~90 dk)
  const autoBoardingWindowMins = Math.max(45, Math.min(110, Math.round((p50 * 0.8) / 5) * 5));
  const longCount = durs.filter(v => v >= autoLongStayThresholdMins).length;

  return {
    sampleCount: durs.length,
    avgGroundMins: avg,
    medianTurnaroundMins: p50,
    p75GroundMins: p75,
    autoLongStayThresholdMins,
    autoBoardingWindowMins,
    longStaySharePct: Math.round((longCount / durs.length) * 1000) / 10
  };
}

export interface UniversalDayResult {
  date: string;
  paxFlights: number;
  eligibleFlights: number;
  // Reel APOC + Hibrit (xpbb-web ile birebir aynı!)
  apocBridgeCount: number;
  apocPbb: number;
  hybridCount: number;
  hybridBonus: number;
  totalServicePbb: number;
  // Universal Physics Outputs (Sıfır Veri / Sıfır Regresyon!)
  xpbbSta: number;          // STA/STD tarifesine göre fiziksel tavan (rötar & kapalılık yok)
  xpbbOtpCeiling: number;   // Gerçekleşen saatlere (OTP/rötar) göre fiziksel tavan (kapalılık yok)
  xpbbLiveCeiling: number;  // Gerçekleşen saatler + Kapalılık fiziksel tavanı
  otpImpactPct: number;     // xpbbSta - xpbbOtpCeiling (rötar/OTP'nin fiziksel etkisi)
  closureHours: number;
  closureLossPct: number;   // xpbbOtpCeiling - xpbbLiveCeiling
  frictionPct: number;      // Evrensel canlı operasyon sürtünmesi (FIDS/belirsizlik)
  xpbbLive: number;         // xpbbLiveCeiling - frictionPct
  deltaVsApoc: number;      // apocPbb - xpbbLive
  deltaVsTotal: number;     // totalServicePbb - xpbbLive
  otpArr: number;
  otpDep: number;
  widebodyRatio: number;
  domRatio: number;
  unplaced: UnplacedBreakdown;
  solveMs: number;
}

const APOC_PASSENGER_MODES = new Set(['C', 'G', 'J', 'O', 'Y']);

function excelSerialToLocalDate(serial: number): Date {
  const totalDays = serial - 25569;
  const wholeDays = Math.floor(totalDays);
  const dayMs = Math.round((totalDays - wholeDays) * 86400000);
  const ep = new Date(Date.UTC(1970, 0, 1 + wholeDays));
  return new Date(
    ep.getUTCFullYear(),
    ep.getUTCMonth(),
    ep.getUTCDate(),
    Math.floor(dayMs / 3600000),
    Math.floor((dayMs % 3600000) / 60000),
    Math.floor((dayMs % 60000) / 1000)
  );
}

export function parseDateTime(val: any): Date | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  if (val instanceof Date) return isNaN(val.getTime()) ? undefined : val;
  if (typeof val === 'number' && val > 30000 && val < 65000) return excelSerialToLocalDate(val);
  const s = String(val).trim();
  if (!s) return undefined;
  if (!isNaN(Number(s)) && !s.includes('-') && !s.includes('/') && !s.includes(':')) {
    const n = Number(s);
    if (n > 30000 && n < 65000) return excelSerialToLocalDate(n);
  }
  const mTr = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (mTr) return new Date(+mTr[3], +mTr[2] - 1, +mTr[1], +(mTr[4] || 0), +(mTr[5] || 0), +(mTr[6] || 0));
  const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (mIso) return new Date(+mIso[1], +mIso[2] - 1, +mIso[3], +(mIso[4] || 0), +(mIso[5] || 0), +(mIso[6] || 0));
  const d = new Date(s);
  return isNaN(d.getTime()) || d.getFullYear() < 2000 ? undefined : d;
}

export function formatYmd(d?: Date): string {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeWindow(tIn?: Date, tOut?: Date): { startMs: number; endMs: number; mins: number } {
  let startMs = tIn ? tIn.getTime() : (tOut ? tOut.getTime() - 75 * 60000 : 0);
  let endMs = tOut ? tOut.getTime() : (tIn ? tIn.getTime() + 75 * 60000 : 0);
  if (endMs <= startMs) endMs = startMs + 75 * 60000;
  // Çok-günlü hangar/bakım kayıtlarını (>36 sa) sınırla
  if (endMs - startMs > 36 * 3600000) endMs = startMs + 18 * 3600000;
  return { startMs, endMs, mins: Math.round((endMs - startMs) / 60000) };
}

export function parseIhkFile(buffer: ArrayBuffer, fileName: string): RawFlight[] {
  const isCsv = fileName.toLowerCase().endsWith('.csv');
  let rawRows: Record<string, any>[] = [];

  if (isCsv) {
    const text = new TextDecoder('utf-8').decode(buffer);
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];
    const headerLine = lines[0].replace(/^\uFEFF/, '');
    const delim = (headerLine.match(/;/g) || []).length > (headerLine.match(/,/g) || []).length ? ';' : ',';
    const splitLine = (line: string): string[] => {
      const res: string[] = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (q && line[i + 1] === '"') { cur += '"'; i++; }
          else q = !q;
        } else if (ch === delim && !q) { res.push(cur); cur = ''; }
        else cur += ch;
      }
      res.push(cur);
      return res;
    };
    const rawH = splitLine(headerLine).map(h => h.trim());
    const seen = new Map<string, number>();
    const keys = rawH.map(h => {
      const c = seen.get(h) || 0;
      seen.set(h, c + 1);
      return c === 0 ? h : `${h}_${c}`;
    });
    for (let r = 1; r < lines.length; r++) {
      if (!lines[r] || lines[r].length < 5) continue;
      const cols = splitLine(lines[r]);
      const obj: Record<string, any> = {};
      for (let i = 0; i < keys.length; i++) obj[keys[i]] = cols[i] ?? '';
      rawRows.push(obj);
    }
  } else {
    const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rawRows = XLSX.utils.sheet_to_json(ws);
  }

  let hasAnyAtd = false;
  for (let i = 0; i < Math.min(rawRows.length, 300); i++) {
    if (rawRows[i]['ATD'] || rawRows[i]['Actual Time of Departure']) { hasAnyAtd = true; break; }
  }

  const flights: RawFlight[] = [];
  rawRows.forEach((row, idx) => {
    const depStatus = String(row['Dep Status'] || '').toUpperCase().trim();
    const arrStatus = String(row['Status'] || '').toUpperCase().trim();
    if (depStatus === 'DX' || depStatus.includes('CANCEL') || (!depStatus && (arrStatus === 'DX' || arrStatus.includes('CANCEL')))) return;

    const depMod = String(row['Mod_1'] || row['Mod.1'] || row['Dep Mod'] || '').toUpperCase().trim();
    const isPassengerMode = APOC_PASSENGER_MODES.has(depMod);

    const sta = parseDateTime(row['STA'] || row['SIBT']);
    const aldt = parseDateTime(row['ATA'] || row['ALDT']);
    const aibt = parseDateTime(row['On Block'] || row['AIBT']);
    const std = parseDateTime(row['STD'] || row['SOBT']);
    const aobt = parseDateTime(row['Off Block'] || row['AOBT']);
    const atd = parseDateTime(row['ATD'] || row['Actual Time of Departure']);

    const dateStr = hasAnyAtd
      ? formatYmd(atd)
      : (formatYmd(atd) || formatYmd(aobt) || formatYmd(std));
    const ataDateStr = formatYmd(aldt);
    if (!dateStr && !ataDateStr) return;

    const acType = String(row['A/C Type_1'] || row['A/C Type.1'] || row['A/C Type'] || '').toUpperCase().trim();
    const acCatRaw = String(row['A/C C'] || '').toUpperCase().trim();
    const acCategory = (['B', 'C', 'D', 'E', 'F'].includes(acCatRaw)
      ? acCatRaw
      : getAircraftCategory(acType)) as 'B' | 'C' | 'D' | 'E' | 'F';

    const arrStand = String(row['Stand'] || row['Arr Stand'] || '').toUpperCase().trim();
    const depStand = String(row['DepStand'] || row['Dep Stand'] || '').toUpperCase().trim();
    const isDepBridge = isBridgeStandName(depStand);
    const isArrBridge = isBridgeStandName(arrStand);
    const isHybridBridge = isArrBridge && !!depStand && !isDepBridge;
    const isEligible = isPassengerMode && !NON_BRIDGEABLE_TYPES.has(acType);

    const arrId = String(row['I/D'] || 'I').trim().toUpperCase().startsWith('D') ? 'D' : 'I';
    const depId = String(row['I/D_1'] || row['I/D.1'] || row['Dep I/D'] || row['I/D'] || 'I').trim().toUpperCase().startsWith('D') ? 'D' : 'I';
    const flightType: 'D/D' | 'I/I' | 'D/I' | 'I/D' =
      arrId === 'D' && depId === 'D' ? 'D/D' :
      arrId === 'I' && depId === 'I' ? 'I/I' :
      arrId === 'D' && depId === 'I' ? 'D/I' : 'I/D';

    // 1. Scheduled window (STA -> STD)
    const planWin = normalizeWindow(sta || aibt || aldt, std || aobt || atd);
    // 2. Realized / OTP window (On Block/ATA -> Off Block/ATD)
    const actWin = normalizeWindow(aibt || aldt || sta, aobt || atd || std);

    let arrDelayMins: number | undefined;
    let depDelayMins: number | undefined;
    if (sta && (aibt || aldt)) arrDelayMins = Math.round(((aibt || aldt)!.getTime() - sta.getTime()) / 60000);
    if (std && (aobt || atd)) depDelayMins = Math.round(((aobt || atd)!.getTime() - std.getTime()) / 60000);

    flights.push({
      id: `F-${idx}`,
      flightNo: String(row['Dep Flight'] || row['Arr Flight'] || `FLT-${idx}`),
      airline: String(row['Airline'] || ''),
      acType,
      acCategory,
      arrStand,
      depStand,
      isDepBridge,
      isArrBridge,
      isHybridBridge,
      isPassengerMode,
      isEligible,
      dateStr,
      ataDateStr,
      flightType,
      planStartMs: planWin.startMs,
      planEndMs: planWin.endMs,
      planGroundMins: planWin.mins,
      actualStartMs: actWin.startMs,
      actualEndMs: actWin.endMs,
      actualGroundMins: actWin.mins,
      arrDelayMins,
      depDelayMins
    });
  });

  return flights;
}

export function parseEquipmentOutages(buffer: ArrayBuffer): StandOutageBlock[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

  let targetSheetName = wb.SheetNames.find(s => /duplicate\s*silinmi/i.test(s));
  if (!targetSheetName) {
    for (const name of wb.SheetNames) {
      const sh = wb.Sheets[name];
      const probe: any[][] = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
      const hasStand = probe.slice(0, 12).some(row =>
        row.some((c: any) => typeof c === 'string' && /^(stand(\s*name)?|parking\s*position|pozisyon|equipment)$/i.test(c.trim()))
      );
      if (hasStand) { targetSheetName = name; break; }
    }
  }
  if (!targetSheetName) targetSheetName = wb.SheetNames[0];

  const ws = wb.Sheets[targetSheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return [];

  let headerIdx = -1;
  let standCol = -1;
  let startDateCol = -1;
  let endDateCol = -1;
  const hourCols: number[] = [];

  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const row = rows[r] || [];
    const trimmed = row.map(c => String(c || '').trim());
    const sIdx = trimmed.findIndex(c => /^(stand(\s*name)?|parking\s*position|pozisyon|equipment)$/i.test(c));
    if (sIdx >= 0) {
      headerIdx = r;
      standCol = sIdx;
      startDateCol = trimmed.findIndex(c => /^(start[_\s]*date|baslangic|başlangıç|tarih|date|day)$/i.test(c));
      endDateCol = trimmed.findIndex(c => /^(end[_\s]*date|bitis|bitiş)$/i.test(c));
      for (let c = 0; c < trimmed.length; c++) {
        if (/^(0?\d|1\d|2[0-3]):\d{2}$/.test(trimmed[c]) || /^H(0?\d|1\d|2[0-3])$/i.test(trimmed[c])) {
          hourCols.push(c);
        }
      }
      break;
    }
  }
  if (headerIdx < 0 || standCol < 0) return [];

  // Ham satırları (stand + tarih + saat) bazında toplayıp önce mükerrer kayıtları, sonra MARS Center/L/R çakışmasını tekilleştir!
  const hourlyByStandDate = new Map<string, { stand: string; dateStr: string; dayStart: number; isDomStand: boolean; mins: number[] }>();

  const addHourRange = (stand: string, dateStr: string, dayStart: number, isDomStand: boolean, h: number, m: number) => {
    const key = `${stand}|${dateStr}`;
    let rec = hourlyByStandDate.get(key);
    if (!rec) {
      rec = { stand, dateStr, dayStart, isDomStand, mins: new Array(24).fill(0) };
      hourlyByStandDate.set(key, rec);
    }
    rec.mins[h] = Math.min(60, Math.max(rec.mins[h], m));
  };

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[standCol]) continue;
    const stand = String(row[standCol]).trim().toUpperCase();
    if (!isBridgeStandName(stand)) continue;
    const isDomStand = stand.startsWith('G');

    const dtStart = startDateCol >= 0 ? parseDateTime(row[startDateCol]) : undefined;
    if (!dtStart) continue;
    const dateStr = formatYmd(dtStart);
    const dayStart = new Date(dtStart.getFullYear(), dtStart.getMonth(), dtStart.getDate(), 0, 0, 0).getTime();

    if (hourCols.length >= 24) {
      for (let h = 0; h < 24; h++) {
        const mins = Math.min(60, Math.max(0, parseFloat(row[hourCols[h]]) || 0));
        if (mins >= 10) addHourRange(stand, dateStr, dayStart, isDomStand, h, mins);
      }
    } else if (endDateCol >= 0) {
      const dtEnd = parseDateTime(row[endDateCol]);
      if (dtEnd && dtEnd.getTime() > dtStart.getTime()) {
        let cur = dtStart.getTime();
        const hardEnd = dtEnd.getTime();
        while (cur < hardEnd) {
          const curDt = new Date(cur);
          const nextHr = cur + (3600000 - (cur % 3600000));
          const segEnd = Math.min(hardEnd, nextHr);
          const dStr = formatYmd(curDt);
          const dStart = new Date(curDt.getFullYear(), curDt.getMonth(), curDt.getDate(), 0, 0, 0).getTime();
          const mins = Math.round((segEnd - cur) / 60000);
          if (mins >= 10) addHourRange(stand, dStr, dStart, isDomStand, curDt.getHours(), mins);
          cur = segEnd;
        }
      }
    }
  }

  // MARS Center Deduplication:
  // Eğer aynı tarih & saatte hem Center (ör. B5) hem de alt kolu (B5L / B5R) kapalı görünüyorsa,
  // Center satırını L/R üzerine yayarak tekilleştir -> 3 slot değil, gerçek fiziksel kayıp olan max 2 slot (L+R) sayılır!
  const allKeys = Array.from(hourlyByStandDate.keys());
  const centersToDrop = new Set<string>();
  for (const key of allKeys) {
    const rec = hourlyByStandDate.get(key)!;
    const isSub = rec.stand.endsWith('L') || rec.stand.endsWith('R');
    if (isSub) continue;
    const leftKey = `${rec.stand}L|${rec.dateStr}`;
    const rightKey = `${rec.stand}R|${rec.dateStr}`;
    const hasLeft = hourlyByStandDate.has(leftKey);
    const hasRight = hourlyByStandDate.has(rightKey);
    if (hasLeft || hasRight) {
      // Center kapalı olduğu her saatte hem L hem R fiziksel olarak kapalıdır; L ve R kayıtlarına max() ile birleştir ve center'ı düş!
      for (let h = 0; h < 24; h++) {
        if (rec.mins[h] >= 10) {
          addHourRange(`${rec.stand}L`, rec.dateStr, rec.dayStart, rec.isDomStand, h, rec.mins[h]);
          addHourRange(`${rec.stand}R`, rec.dateStr, rec.dayStart, rec.isDomStand, h, rec.mins[h]);
        }
      }
      centersToDrop.add(key);
    }
  }
  centersToDrop.forEach(k => hourlyByStandDate.delete(k));

  const blocks: StandOutageBlock[] = [];
  for (const rec of hourlyByStandDate.values()) {
    let openStart = -1;
    for (let h = 0; h < 24; h++) {
      if (rec.mins[h] >= 10) {
        if (openStart < 0) openStart = rec.dayStart + h * 3600000;
      } else if (openStart >= 0) {
        const endMs = rec.dayStart + h * 3600000;
        blocks.push({ stand: rec.stand, dateStr: rec.dateStr, startMs: openStart, endMs, hours: (endMs - openStart) / 3600000, isDomStand: rec.isDomStand });
        openStart = -1;
      }
    }
    if (openStart >= 0) {
      const endMs = rec.dayStart + 24 * 3600000;
      blocks.push({ stand: rec.stand, dateStr: rec.dateStr, startMs: openStart, endMs, hours: (endMs - openStart) / 3600000, isDomStand: rec.isDomStand });
    }
  }
  return blocks;
}

interface Interval {
  start: number;
  end: number;
}

function overlaps(aStart: number, aEnd: number, list: Interval[]): boolean {
  for (let i = 0; i < list.length; i++) {
    if (aStart < list[i].end && aEnd > list[i].start) return true;
  }
  return false;
}

function latestEndBefore(start: number, list: Interval[]): number {
  let best = -Infinity;
  for (let i = 0; i < list.length; i++) {
    if (list[i].end <= start && list[i].end > best) best = list[i].end;
  }
  return best;
}

const CAT_RANK: Record<string, number> = { B: 1, C: 2, D: 3, E: 4, F: 5 };

function canStandAccept(stand: BridgeStandSpec, f: RawFlight): boolean {
  if ((CAT_RANK[f.acCategory] || 2) > (CAT_RANK[stand.maxCat] || 2)) return false;
  if (f.flightType === 'D/D') return stand.zone === 'DOM' || stand.zone === 'SWING';
  if (f.flightType === 'I/I') return stand.zone === 'INT' || stand.zone === 'SWING';
  return true;
}

function standPriorityScore(
  stand: BridgeStandSpec,
  f: RawFlight,
  occ: Map<string, Interval[]>,
  reqStart: number,
  reqEnd: number
): number {
  const isWide = f.acCategory === 'D' || f.acCategory === 'E' || f.acCategory === 'F';
  let score = 0;

  if (isWide) {
    // 1. Standalone widebody first (preserves MARS for 2x narrowbodies)
    if (!stand.isMarsCenter) score += 1000;
    else score += 450;
    // Tightest category fit (D -> D, E -> E, F -> F)
    const waste = (CAT_RANK[stand.maxCat] || 4) - (CAT_RANK[f.acCategory] || 4);
    score -= waste * 90;
  } else {
    // Narrowbody: 1. Standalone C, 2. MARS sub with busy sibling (pair packing), 3. Empty MARS sub, 4. Standalone D/E/F last
    if (stand.maxCat === 'C' && !stand.isMarsSub) score += 1000;
    else if (stand.isMarsSub) {
      const centerId = stand.id.slice(0, -1);
      const siblingId = stand.id.endsWith('L') ? `${centerId}R` : `${centerId}L`;
      const siblingBusy = overlaps(reqStart, reqEnd, occ.get(siblingId) || []);
      score += siblingBusy ? 920 : 780;
    } else {
      score += 250 - ((CAT_RANK[stand.maxCat] || 4) - 2) * 40;
    }
  }

  return score;
}

/**
 * Universally maps uploaded outage blocks onto ANY airport's generic stand inventory (no hardcoded stand names!).
 */
function seedUniversalOutages(
  occ: Map<string, Interval[]>,
  topology: CompiledTopology,
  outages: StandOutageBlock[]
) {
  if (outages.length === 0) return;

  // Deterministic stand pools for outage mapping (narrow slots = standalone + MARS L/R)
  const domSlots = topology.stands.filter(s => s.nominalSlots === 1 && s.zone === 'DOM');
  const otherSlots = topology.stands.filter(s => s.nominalSlots === 1 && s.zone !== 'DOM');
  const allSlots = topology.stands.filter(s => s.nominalSlots === 1);

  for (const blk of outages) {
    const pool = blk.isDomStand && domSlots.length > 0 ? domSlots : (otherSlots.length > 0 ? otherSlots : allSlots);
    // Find a slot in pool not already closed during this outage window
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      const list = occ.get(s.id)!;
      if (!overlaps(blk.startMs, blk.endMs, list)) {
        list.push({ start: blk.startMs, end: blk.endMs });
        break;
      }
    }
  }
}

/**
 * Pure Universal Earliest-Finish-Time (EFT) Interval Packing Solver.
 * Zero airport-specific magic thresholds!
 */
function solveUniversalPacking(
  dayTargetIds: Set<string>,
  flights: RawFlight[],
  topology: CompiledTopology,
  outages: StandOutageBlock[],
  bufferMins: number,
  useScheduledTimes: boolean,
  allowTowing: boolean,
  longStayThresholdMins: number,
  boardingWindowMins: number
): Set<string> {
  const occ = new Map<string, Interval[]>();
  topology.stands.forEach(s => occ.set(s.id, []));

  // Seed outages universally
  seedUniversalOutages(occ, topology, outages);

  // Pure Earliest-Finish-Time (EFT) sorting — mathematically optimal universal interval packing!
  const items = flights.map(f => ({
    f,
    s: useScheduledTimes ? f.planStartMs : f.actualStartMs,
    e: useScheduledTimes ? f.planEndMs : f.actualEndMs,
    dur: useScheduledTimes ? f.planGroundMins : f.actualGroundMins
  }));
  items.sort((a, b) => {
    if (a.e !== b.e) return a.e - b.e;
    return a.dur - b.dur;
  });

  const bufMs = bufferMins * 60000;
  const placedTargetIds = new Set<string>();

  const tryPlace = (f: RawFlight, reqStart: number, reqEnd: number): boolean => {
    let bestStand: BridgeStandSpec | null = null;
    let bestScore = -Infinity;
    let bestLatestEnd = -Infinity;

    for (let i = 0; i < topology.stands.length; i++) {
      const s = topology.stands[i];
      if (!canStandAccept(s, f)) continue;

      let blocked = false;
      for (let c = 0; c < s.conflictsWith.length; c++) {
        const cList = occ.get(s.conflictsWith[c]);
        if (cList && overlaps(reqStart, reqEnd, cList)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const prio = standPriorityScore(s, f, occ, reqStart, reqEnd);
      const lEnd = latestEndBefore(reqStart, occ.get(s.id)!);
      if (prio > bestScore || (prio === bestScore && lEnd > bestLatestEnd)) {
        bestScore = prio;
        bestLatestEnd = lEnd;
        bestStand = s;
      }
    }

    if (bestStand) {
      occ.get(bestStand.id)!.push({ start: reqStart, end: reqEnd });
      return true;
    }
    return false;
  };

  for (const it of items) {
    const ok = tryPlace(it.f, it.s, it.e + bufMs);
    if (ok) {
      if (dayTargetIds.has(it.f.id)) placedTargetIds.add(it.f.id);
    } else if (allowTowing && it.dur >= longStayThresholdMins) {
      // Evrensel adaptif çekme: Meydanın kendi P80 yatı eşiğini aşan uçuş, kendi medyan biniş penceresi kadar önce köprüye çekilebilir
      if (tryPlace(it.f, it.e - boardingWindowMins * 60000, it.e + bufMs)) {
        if (dayTargetIds.has(it.f.id)) placedTargetIds.add(it.f.id);
      }
    }
  }

  return placedTargetIds;
}

export function runUniversalXpbbSimulation(
  flights: RawFlight[],
  outages: StandOutageBlock[],
  topology: CompiledTopology,
  bufferMins: number,
  fixedFrictionPct: number | null,
  allowTowing: boolean
): UniversalDayResult[] {
  const byAtd = new Map<string, RawFlight[]>();
  const byAta = new Map<string, RawFlight[]>();
  const outagesByDate = new Map<string, StandOutageBlock[]>();

  for (const f of flights) {
    if (f.dateStr) {
      if (!byAtd.has(f.dateStr)) byAtd.set(f.dateStr, []);
      byAtd.get(f.dateStr)!.push(f);
    }
    if (f.ataDateStr) {
      if (!byAta.has(f.ataDateStr)) byAta.set(f.ataDateStr, []);
      byAta.get(f.ataDateStr)!.push(f);
    }
  }
  for (const o of outages) {
    if (!outagesByDate.has(o.dateStr)) outagesByDate.set(o.dateStr, []);
    outagesByDate.get(o.dateStr)!.push(o);
  }

  const shiftDate = (ymd: string, delta: number): string => {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  };

  const dynamics = computeAirportFlightDynamics(flights);
  const dates = Array.from(byAtd.keys()).sort();
  const results: UniversalDayResult[] = [];

  for (const d of dates) {
    const t0 = performance.now();
    const dayAll = byAtd.get(d) || [];
    const paxList = dayAll.filter(f => f.isPassengerMode);
    const eligibleList = paxList.filter(f => f.isEligible);
    if (eligibleList.length < 20) continue;

    // 1. Reel APOC + Hibrit (xpbb-web ile %100 birebir aynı!)
    const apocBridgeCount = dayAll.filter(f => f.isDepBridge).length;
    const apocPbb = Math.round((apocBridgeCount / eligibleList.length) * 1000) / 10;

    const dayAta = byAta.get(d) || [];
    const hybridCount = dayAta.filter(f => f.isHybridBridge).length;
    const hybridBonus = Math.round((hybridCount / eligibleList.length) * 1000) / 10;
    const totalServicePbb = Math.min(100, Math.round(((apocBridgeCount + hybridCount) / eligibleList.length) * 1000) / 10);

    const [y, m, da] = d.split('-').map(Number);
    const dayStartMs = new Date(y, m - 1, da, 0, 0, 0).getTime();
    const dayEndMs = new Date(y, m - 1, da, 23, 59, 59, 999).getTime();

    const poolNearby = [
      ...(byAtd.get(shiftDate(d, -1)) || []),
      ...dayAll,
      ...(byAtd.get(shiftDate(d, 1)) || [])
    ].filter(f => f.isEligible);

    const planIntersecting = poolNearby.filter(f => f.planEndMs >= dayStartMs && f.planStartMs <= dayEndMs);
    const actualIntersecting = poolNearby.filter(f => f.actualEndMs >= dayStartMs && f.actualStartMs <= dayEndMs);

    const dayTargetIds = new Set(eligibleList.map(f => f.id));
    const dayOutages = outagesByDate.get(d) || [];
    const closureHours = Math.round(dayOutages.reduce((s, o) => s + o.hours, 0) * 10) / 10;

    // A. STA/STD Plan Physics Solve (Tarifeye göre tavan — rötar & kapalılık yok)
    const staPlaced = solveUniversalPacking(dayTargetIds, planIntersecting, topology, [], bufferMins, true, allowTowing, dynamics.autoLongStayThresholdMins, dynamics.autoBoardingWindowMins);
    // B. OTP / Actual Times Physics Solve (Gerçekleşen saatlere göre tavan — kapalılık yok)
    const otpPlaced = solveUniversalPacking(dayTargetIds, actualIntersecting, topology, [], bufferMins, false, allowTowing, dynamics.autoLongStayThresholdMins, dynamics.autoBoardingWindowMins);
    // C. Live Physics Solve (Gerçekleşen saatler + Kapalılık!)
    const livePlaced = dayOutages.length > 0
      ? solveUniversalPacking(dayTargetIds, actualIntersecting, topology, dayOutages, bufferMins, false, allowTowing, dynamics.autoLongStayThresholdMins, dynamics.autoBoardingWindowMins)
      : otpPlaced;

    const xpbbSta = Math.round((staPlaced.size / eligibleList.length) * 1000) / 10;
    const xpbbOtpCeiling = Math.round((otpPlaced.size / eligibleList.length) * 1000) / 10;
    const xpbbLiveCeiling = Math.round((livePlaced.size / eligibleList.length) * 1000) / 10;
    const otpImpactPct = Math.round((xpbbSta - xpbbOtpCeiling) * 10) / 10;
    const closureLossPct = Math.max(0, Math.round((xpbbOtpCeiling - xpbbLiveCeiling) * 10) / 10);

    const unplaced: UnplacedBreakdown = { domFull: 0, wideFull: 0, capacityFull: 0, closureLoss: 0 };
    for (const f of eligibleList) {
      if (livePlaced.has(f.id)) continue;
      if (otpPlaced.has(f.id)) unplaced.closureLoss++;
      else if (f.flightType === 'D/D' && topology.domNarrowSlots > 0) unplaced.domFull++;
      else if (['D', 'E', 'F'].includes(f.acCategory)) unplaced.wideFull++;
      else unplaced.capacityFull++;
    }

    const vArr = eligibleList.filter(f => f.arrDelayMins !== undefined);
    const vDep = eligibleList.filter(f => f.depDelayMins !== undefined);
    const otpArr = vArr.length > 0 ? Math.round((vArr.filter(f => f.arrDelayMins! <= 15).length / vArr.length) * 1000) / 10 : 82.0;
    const otpDep = vDep.length > 0 ? Math.round((vDep.filter(f => f.depDelayMins! <= 15).length / vDep.length) * 1000) / 10 : 83.0;
    const avgOtp = (otpArr + otpDep) / 2;

    const frictionPct = fixedFrictionPct !== null
      ? fixedFrictionPct
      : Math.round(Math.max(0.5, Math.min(2.5, 0.5 + 0.05 * Math.max(0, 100 - avgOtp))) * 10) / 10;

    const xpbbLive = Math.max(0, Math.min(100, Math.round((xpbbLiveCeiling - frictionPct) * 10) / 10));
    const widebodyRatio = Math.round((eligibleList.filter(f => ['D', 'E', 'F'].includes(f.acCategory)).length / eligibleList.length) * 1000) / 10;
    const domRatio = Math.round((eligibleList.filter(f => f.flightType === 'D/D').length / eligibleList.length) * 1000) / 10;

    results.push({
      date: d,
      paxFlights: paxList.length,
      eligibleFlights: eligibleList.length,
      apocBridgeCount,
      apocPbb,
      hybridCount,
      hybridBonus,
      totalServicePbb,
      xpbbSta,
      xpbbOtpCeiling,
      xpbbLiveCeiling,
      otpImpactPct,
      closureHours,
      closureLossPct,
      frictionPct,
      xpbbLive,
      deltaVsApoc: Math.round((apocPbb - xpbbLive) * 10) / 10,
      deltaVsTotal: Math.round((totalServicePbb - xpbbLive) * 10) / 10,
      otpArr,
      otpDep,
      widebodyRatio,
      domRatio,
      unplaced,
      solveMs: Math.round((performance.now() - t0) * 10) / 10
    });
  }

  return results;
}

/**
 * Converts GAMS Gantt Flight[] directly into Universal xPBB RawFlight[]
 * so users can run Universal xPBB immediately on their currently loaded GAMS schedule!
 */
export function convertGamsFlightsToUniversal(gamsFlights: Flight[]): RawFlight[] {
  const out: RawFlight[] = [];
  gamsFlights.forEach((f, idx) => {
    const raw = f.raw_data || {};
    const depStatus = String(raw['Dep Status'] || '').toUpperCase().trim();
    if (depStatus === 'DX' || depStatus.includes('CANCEL')) return;

    const depMod = String(raw['Mod_1'] || raw['Mod.1'] || raw['Dep Mod'] || f.departureMode || f.trafficMode || 'J').toUpperCase().trim();
    const isPassengerMode = APOC_PASSENGER_MODES.has(depMod);

    const sta = parseDateTime(raw['STA'] || raw['SIBT']) || f.scheduledArrival;
    const aldt = parseDateTime(raw['ATA'] || raw['ALDT']);
    const aibt = parseDateTime(raw['On Block'] || raw['AIBT']);
    const std = parseDateTime(raw['STD'] || raw['SOBT']) || f.scheduledDeparture;
    const aobt = parseDateTime(raw['Off Block'] || raw['AOBT']);
    const atd = parseDateTime(raw['ATD'] || raw['Actual Time of Departure']);

    const dateStr = f.type === 'arrival' ? '' : (formatYmd(atd) || formatYmd(aobt) || formatYmd(std));
    const ataDateStr = formatYmd(aldt || aibt || f.scheduledArrival);
    if (!dateStr && !ataDateStr) return;

    const acType = String(f.aircraftType || '').toUpperCase().trim();
    const acCategory = getAircraftCategory(acType);

    const arrStand = String(raw['Stand'] || raw['Arr Stand'] || f.parkingPosition || '').toUpperCase().trim();
    const depStand = String(f.parkingPosition || raw['DepStand'] || raw['Dep Stand'] || '').toUpperCase().trim();
    const isDepBridge = isBridgeStandName(depStand);
    const isArrBridge = isBridgeStandName(arrStand);
    const isHybridBridge = isArrBridge && !!depStand && !isDepBridge;
    const isEligible = f.type !== 'arrival' && isPassengerMode && !NON_BRIDGEABLE_TYPES.has(acType);

    const isArrDom = f.type === 'turnaround' ? (f.arrivalIsDomestic ?? f.isDomestic) : f.isDomestic;
    const isDepDom = f.type === 'turnaround' ? (f.departureIsDomestic ?? f.isDomestic) : f.isDomestic;
    const flightType: 'D/D' | 'I/I' | 'D/I' | 'I/D' =
      isArrDom && isDepDom ? 'D/D' :
      !isArrDom && !isDepDom ? 'I/I' :
      isArrDom && !isDepDom ? 'D/I' : 'I/D';

    const planWin = normalizeWindow(sta, std);
    const actWin = normalizeWindow(aibt || aldt || sta, aobt || atd || std);

    let arrDelayMins: number | undefined;
    let depDelayMins: number | undefined;
    if (sta && (aibt || aldt)) arrDelayMins = Math.round(((aibt || aldt)!.getTime() - sta.getTime()) / 60000);
    if (std && (aobt || atd)) depDelayMins = Math.round(((aobt || atd)!.getTime() - std.getTime()) / 60000);

    out.push({
      id: f.id || `GAMS-${idx}`,
      flightNo: f.departureFlightNumber || f.arrivalFlightNumber || `FLT-${idx}`,
      airline: f.airline || '',
      acType,
      acCategory,
      arrStand,
      depStand,
      isDepBridge,
      isArrBridge,
      isHybridBridge,
      isPassengerMode: f.type !== 'arrival' && isPassengerMode,
      isEligible,
      dateStr,
      ataDateStr,
      flightType,
      planStartMs: planWin.startMs,
      planEndMs: planWin.endMs,
      planGroundMins: planWin.mins,
      actualStartMs: actWin.startMs,
      actualEndMs: actWin.endMs,
      actualGroundMins: actWin.mins,
      arrDelayMins,
      depDelayMins
    });
  });
  return out;
}

export function convertGamsOutagesToUniversal(blocks: MaintenanceBlock[]): StandOutageBlock[] {
  const out: StandOutageBlock[] = [];
  for (const b of blocks) {
    const stand = String(b.parkingPosition || '').toUpperCase().trim();
    if (!isBridgeStandName(stand)) continue;
    const sMs = new Date(b.startTime).getTime();
    const eMs = new Date(b.endTime).getTime();
    if (isNaN(sMs) || isNaN(eMs) || eMs <= sMs) continue;
    let cur = sMs;
    while (cur < eMs) {
      const curDt = new Date(cur);
      const nextMid = new Date(curDt.getFullYear(), curDt.getMonth(), curDt.getDate() + 1, 0, 0, 0).getTime();
      const segEnd = Math.min(eMs, nextMid);
      out.push({
        stand,
        dateStr: formatYmd(curDt),
        startMs: cur,
        endMs: segEnd,
        hours: Math.round(((segEnd - cur) / 3600000) * 10) / 10,
        isDomStand: stand.startsWith('G')
      });
      cur = segEnd;
    }
  }
  return out;
}
