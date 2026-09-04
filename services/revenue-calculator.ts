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
  
  if (flight.raw_data) {
    const rawMtow = flight.raw_data.MTOW || flight.raw_data.mtow || flight.raw_data['MTOW (Tons)'] || flight.raw_data['MTOW (kg)'];
    if (rawMtow) {
      const parsed = parseFloat(String(rawMtow).replace(/[^0-9.]/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
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

  const isWideBody = WIDE_BODY_AIRCRAFT.has(cleanType) || WIDE_BODY_AIRCRAFT.has(flight.aircraftType);
  return isWideBody ? 240 : 79;
};

// Check if a parking position is a Bridge (Köprülü Pier A-G) position vs Remote
export const isBridgePosition = (position: string | null): boolean => {
  if (!position) return false;
  const cleanPos = position.trim().toUpperCase();

  const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(cleanPos));
  if (concourse) {
    const cUpper = concourse.toUpperCase();
    if (['PIER A', 'PIER B', 'PIER C', 'PIER D', 'PIER E', 'PIER F', 'PIER G'].some(p => cUpper.includes(p))) {
      return true;
    }
  }

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
  gpuEur: number;
  gpuTry: number;
  pcaEur: number;
  pcaTry: number;
  waterEur: number;
  waterTry: number;
  paxServiceEur: number;
  paxServiceTry: number;
  totalEur: number;
  totalTry: number;
  isBridge: boolean;
  isWideBody: boolean;
  serviceHours: number;
  mtow: number;
  paxCount: number;
  bridgeCount: number;
  gpuCount: number;
  pcaCount: number;
}

export const calculateRevenue = (flight: Flight): RevenueDetails => {
  const mtow = getAircraftMtow(flight);
  const isDomestic = flight.type === 'turnaround'
    ? (flight.arrivalIsDomestic && flight.departureIsDomestic)
    : flight.isDomestic;

  const isWideBody = WIDE_BODY_AIRCRAFT.has(flight.aircraftType?.toUpperCase().trim() || '');

  // 1. Landing Fee (Konma)
  const landingRateEur = isDomestic ? 4.50 : 10.50;
  const landingEur = mtow * landingRateEur;
  const landingTry = landingEur * EUR_TRY_EXCHANGE_RATE;

  // 2. Parking Fee (Konaklama)
  let parkingEur = 0;
  let parkingDurationHours = 0;
  if (flight.parkingPosition) {
    const durationMs = Math.max(0, flight.scheduledDeparture.getTime() - flight.scheduledArrival.getTime());
    parkingDurationHours = durationMs / (1000 * 60 * 60);
    if (parkingDurationHours > 2) {
      const chargeableDays = Math.ceil((parkingDurationHours - 2) / 24);
      const parkingRateEur = isDomestic ? 0.95 : 2.20;
      parkingEur = mtow * parkingRateEur * chargeableDays;
    }
  }
  const parkingTry = parkingEur * EUR_TRY_EXCHANGE_RATE;

  // 3. Passenger Service Fee (Yolcu Servis)
  let paxCount = 0;
  if (flight.raw_data) {
    const rawPax = flight.raw_data['Arr Pax'] || flight.raw_data['Dep Pax'] || flight.raw_data.pax || flight.raw_data.Pax;
    if (rawPax) paxCount = parseInt(String(rawPax), 10) || 0;
  }
  if (paxCount <= 0) {
    paxCount = isWideBody ? 260 : 145;
  }

  const paxRateEur = isDomestic ? 2.50 : 17.50;
  const paxServiceEur = paxCount * paxRateEur;
  const paxServiceTry = paxServiceEur * EUR_TRY_EXCHANGE_RATE;

  // 4. Köprülü (Pier A-G) Ekipman ve Köprü Hizmetleri Hesaplamaları
  // Rule: Açık (Remote) pozisyonlar için Köprü, GPU, PCA, Su = €0 ("Açıklar için hiçbirşeyi hesaplama")
  const isBridge = isBridgePosition(flight.parkingPosition);

  let bridgeEur = 0;
  let gpuEur = 0;
  let pcaEur = 0;
  let waterEur = 0;

  // Rule: Yatı süresi 4 saat ve üzeri ise servis süresi tam 4 saate fixlenir (serviceHours = Math.min(duration, 4))
  const serviceHours = isBridge && parkingDurationHours > 0
    ? (parkingDurationHours >= 4 ? 4.0 : Math.max(0.5, parkingDurationHours))
    : 0;

  const bridgeCount = isWideBody ? 2 : 1;
  const gpuCount = isWideBody ? 2 : 1;
  const pcaCount = isWideBody ? 2 : 1;

  if (isBridge && serviceHours > 0) {
    // A) Yolcu Köprüsü (PBB)
    const periods30m = Math.ceil(serviceHours * 2); // Max 8 periyot (4 saat)
    let rate30mEur = 55;
    if (mtow > 200) rate30mEur = 185;
    else if (mtow > 100) rate30mEur = 135;
    else if (mtow > 50) rate30mEur = 85;

    const baseBridgeTotal = periods30m * rate30mEur;
    bridgeEur = baseBridgeTotal * (bridgeCount === 2 ? 1.20 : 1.0); // 2 PBB %20 ilave zamlı

    // B) GPU (400Hz Elektrik - Geniş: 2GPU, Dar: 1GPU)
    const gpuMinutes = Math.round(serviceHours * 60); // Max 240 dakika (4 saat)
    const gpuPricePerMin = 0.65; // €0.65 / dk
    const baseGpuTotal = gpuMinutes * gpuPricePerMin;
    gpuEur = baseGpuTotal * (gpuCount === 2 ? 1.50 : 1.0); // 2 GPU (2 kablo) %50 ilave zamlı

    // C) PCA (İklimlendirme - Geniş: 2PCA, Dar: 1PCA)
    const pcaMinutes = Math.round(serviceHours * 60); // Max 240 dakika (4 saat)
    let pcaBaseRateEur = 0.45;
    if (mtow > 200) pcaBaseRateEur = 1.65;
    else if (mtow > 100) pcaBaseRateEur = 1.15;
    else if (mtow > 50) pcaBaseRateEur = 0.75;

    const basePcaTotal = pcaMinutes * pcaBaseRateEur;
    pcaEur = basePcaTotal * (pcaCount === 2 ? 1.50 : 1.0); // 2 PCA (2 kanal) %50 ilave zamlı

    // D) Su Servisi (Water)
    waterEur = 45.00; // €45.00 maktu iniş başına
  }

  const bridgeTry = bridgeEur * EUR_TRY_EXCHANGE_RATE;
  const gpuTry = gpuEur * EUR_TRY_EXCHANGE_RATE;
  const pcaTry = pcaEur * EUR_TRY_EXCHANGE_RATE;
  const waterTry = waterEur * EUR_TRY_EXCHANGE_RATE;

  // Total Revenue
  const totalEur = landingEur + parkingEur + paxServiceEur + bridgeEur + gpuEur + pcaEur + waterEur;
  const totalTry = totalEur * EUR_TRY_EXCHANGE_RATE;

  return {
    landingEur,
    landingTry,
    parkingEur,
    parkingTry,
    bridgeEur,
    bridgeTry,
    gpuEur,
    gpuTry,
    pcaEur,
    pcaTry,
    waterEur,
    waterTry,
    paxServiceEur,
    paxServiceTry,
    totalEur,
    totalTry,
    isBridge,
    isWideBody,
    serviceHours,
    mtow,
    paxCount,
    bridgeCount,
    gpuCount,
    pcaCount,
  };
};