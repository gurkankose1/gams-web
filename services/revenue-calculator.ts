import { Flight } from '../types.ts';
import { WIDE_BODY_AIRCRAFT, CONCOURSE_LAYOUT } from '../constants.ts';

export const EUR_TRY_EXCHANGE_RATE = 40.50; // 1 EUR = 40.50 TRY

// --- Standard MTOW Fallback Presets (in Metric Tons) ---
export const AIRCRAFT_MTOW_PRESETS: Record<string, number> = {
  // Airbus Narrow-Body
  'A318': 68,
  'A319': 76,
  'A320': 78,
  'A321': 94,
  'A20N': 79,
  'A21N': 97,
  'A320NEO': 79,
  'A321NEO': 97,
  // Boeing Narrow-Body
  'B737': 70,
  'B738': 79,
  'B739': 85,
  'B38M': 82,
  'B39M': 88,
  '73H': 79,
  '738': 79,
  '739': 85,
  // Wide-Body Airbus
  'A332': 233,
  'A333': 242,
  'A339': 251,
  'A343': 275,
  'A346': 368,
  'A359': 280,
  'A35K': 319,
  'A388': 575,
  '333': 242,
  '332': 233,
  '359': 280,
  // Wide-Body Boeing
  'B772': 297,
  'B77L': 347,
  'B77W': 351,
  'B773': 351,
  '77W': 351,
  '773': 351,
  'B788': 228,
  'B789': 254,
  'B781': 271,
  '789': 254,
  'B744': 412,
  'B748': 447,
  // Regional
  'E190': 51,
  'E195': 52,
  'CRJ9': 38,
  'AT76': 23,
  'DH8D': 30,
};

export const getAircraftMtow = (flight: Flight): number => {
  if (flight.mtow && flight.mtow > 0) {
    return Math.ceil(flight.mtow);
  }
  
  // Look in raw_data if excel contained MTOW
  if (flight.raw_data) {
    const rawMtow = flight.raw_data.MTOW || flight.raw_data.mtow || flight.raw_data['MTOW (Tons)'] || flight.raw_data['MTOW (kg)'];
    if (rawMtow) {
      const parsed = parseFloat(String(rawMtow).replace(/[^0-9.]/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
        // If MTOW is provided in kg (e.g. 79000), convert to Tons (79)
        const mtowInTons = parsed > 1000 ? Math.ceil(parsed / 1000) : Math.ceil(parsed);
        return Math.max(20, mtowInTons);
      }
    }
  }

  const cleanType = (flight.aircraftType || '').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
  for (const [presetKey, weight] of Object.entries(AIRCRAFT_MTOW_PRESETS)) {
    if (cleanType.includes(presetKey)) {
      return weight;
    }
  }

  // Fallback defaults: 240t for wide body, 79t for narrow body
  const isWideBody = WIDE_BODY_AIRCRAFT.has(cleanType) || WIDE_BODY_AIRCRAFT.has(flight.aircraftType);
  return isWideBody ? 240 : 79;
};

// Check if a parking position is a Bridge (Köprülü Pier A-G) position vs Remote
export const isBridgePosition = (position: string | null): boolean => {
  if (!position) return false;
  const cleanPos = position.trim().toUpperCase();

  // Check concourse layout
  const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(cleanPos));
  if (concourse) {
    const cUpper = concourse.toUpperCase();
    if (['PIER A', 'PIER B', 'PIER C', 'PIER D', 'PIER E', 'PIER F', 'PIER G'].some(p => cUpper.includes(p))) {
      return true;
    }
  }

  // Direct prefix check (A, B, C, D, E, F, G)
  const firstChar = cleanPos.charAt(0);
  return ['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(firstChar);
};

export interface RevenueDetails {
  landingEur: number;
  landingTry: number;
  parkingEur: number;
  parkingTry: number;
  bridgeEur: number;
  bridgeTry: number;
  paxServiceEur: number;
  paxServiceTry: number;
  totalEur: number;
  totalTry: number;
  isBridge: boolean;
  mtow: number;
  paxCount: number;
}

export const calculateRevenue = (flight: Flight): RevenueDetails => {
  const mtow = getAircraftMtow(flight);
  const isDomestic = flight.type === 'turnaround'
    ? (flight.arrivalIsDomestic && flight.departureIsDomestic)
    : flight.isDomestic;

  // 1. Landing Fee (Konma)
  // International: €10.50 / ton, Domestic: ₺180 / ton (€4.44)
  const landingRateEur = isDomestic ? 4.50 : 10.50;
  const landingEur = mtow * landingRateEur;
  const landingTry = landingEur * EUR_TRY_EXCHANGE_RATE;

  // 2. Parking Fee (Konaklama)
  // Free for first 2 hours. Beyond 2 hours: Int €2.20/ton/day, Dom €0.95/ton/day
  let parkingEur = 0;
  if (flight.parkingPosition) {
    const durationMs = Math.max(0, flight.scheduledDeparture.getTime() - flight.scheduledArrival.getTime());
    const durationHours = durationMs / (1000 * 60 * 60);
    if (durationHours > 2) {
      const chargeableDays = Math.ceil((durationHours - 2) / 24);
      const parkingRateEur = isDomestic ? 0.95 : 2.20;
      parkingEur = mtow * parkingRateEur * chargeableDays;
    }
  }
  const parkingTry = parkingEur * EUR_TRY_EXCHANGE_RATE;

  // 3. Passenger Service Fee (Yolcu Servis)
  // Extract pax from raw_data or estimate based on aircraft capacity
  let paxCount = 0;
  if (flight.raw_data) {
    const rawPax = flight.raw_data['Arr Pax'] || flight.raw_data['Dep Pax'] || flight.raw_data.pax || flight.raw_data.Pax;
    if (rawPax) paxCount = parseInt(String(rawPax), 10) || 0;
  }
  if (paxCount <= 0) {
    const isWideBody = WIDE_BODY_AIRCRAFT.has(flight.aircraftType?.toUpperCase().trim() || '');
    paxCount = isWideBody ? 260 : 145; // Standard average passenger load
  }

  const paxRateEur = isDomestic ? 2.50 : 17.50;
  const paxServiceEur = paxCount * paxRateEur;
  const paxServiceTry = paxServiceEur * EUR_TRY_EXCHANGE_RATE;

  // 4. Passenger Boarding Bridge Fee (Yolcu Köprüsü)
  // Applies ONLY if position is Pier A, B, C, D, E, F, G (isBridge = true)
  let bridgeEur = 0;
  const isBridge = isBridgePosition(flight.parkingPosition);

  if (isBridge && flight.parkingPosition) {
    const durationMs = Math.max(0, flight.scheduledDeparture.getTime() - flight.scheduledArrival.getTime());
    const durationHours = Math.max(1, durationMs / (1000 * 60 * 60));
    const periods30m = Math.ceil(durationHours * 2);

    // MTOW Bracketed Rates per 30 minutes
    let rate30mEur = 55;
    if (mtow > 200) rate30mEur = 185;
    else if (mtow > 100) rate30mEur = 135;
    else if (mtow > 50) rate30mEur = 85;

    bridgeEur = periods30m * rate30mEur;
  }
  const bridgeTry = bridgeEur * EUR_TRY_EXCHANGE_RATE;

  // Total Revenue
  const totalEur = landingEur + parkingEur + bridgeEur + paxServiceEur;
  const totalTry = totalEur * EUR_TRY_EXCHANGE_RATE;

  return {
    landingEur,
    landingTry,
    parkingEur,
    parkingTry,
    bridgeEur,
    bridgeTry,
    paxServiceEur,
    paxServiceTry,
    totalEur,
    totalTry,
    isBridge,
    mtow,
    paxCount
  };
};