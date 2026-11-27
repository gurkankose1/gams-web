export type StandZone = 'DOM' | 'INT' | 'SWING';
export type MaxCat = 'C' | 'D' | 'E' | 'F';

export interface UniversalStandInventory {
  name: string;
  marsF: number;        // 1x Cat F/E/D or 2x Cat C
  marsE: number;        // 1x Cat E/D or 2x Cat C
  standaloneF: number;  // 1x Cat F/E/D/C
  standaloneE: number;  // 1x Cat E/D/C
  standaloneD: number;  // 1x Cat D/C
  standaloneC: number;  // 1x Cat C only
  /** Opsiyonel: Sadece İç Hat'a ayrılmış MARS E ve Standalone C sayısı (0 = tüm meydan karma/swing!) */
  domMarsE: number;
  domStandaloneC: number;
}

export interface BridgeStandSpec {
  id: string;
  zone: StandZone;
  maxCat: MaxCat;
  conflictsWith: string[];
  isMarsCenter: boolean;
  isMarsSub: boolean;
  nominalSlots: number;
}

export interface CompiledTopology {
  inventory: UniversalStandInventory;
  physicalStands: number;       // e.g. 77
  nominalNarrowSlots: number;   // e.g. 114
  domNarrowSlots: number;
  intOrSwingNarrowSlots: number;
  stands: BridgeStandSpec[];
}

export const DEFAULT_IGA_INVENTORY: UniversalStandInventory = {
  name: 'İGA İstanbul (78 Pozisyon / 113 Nominal — B10 & F12 Güncel)',
  marsF: 15,
  marsE: 20,          // B10 (standalone E) ve F12 (2x standalone C) MARS'tan çıktı
  standaloneF: 0,
  standaloneE: 26,    // B10 eklendi (WB center veya tek B10R)
  standaloneD: 0,
  standaloneC: 17,    // F12L ve F12R bağımsız 2 dar gövde eklendi
  domMarsE: 9,        // G Pieri: 9 MARS E (18 TOPLAM C)
  domStandaloneC: 0
};

export const GENERIC_PRESETS: UniversalStandInventory[] = [
  DEFAULT_IGA_INVENTORY,
  {
    name: 'Orta Hub (35 Pozisyon / 43 Nominal)',
    marsF: 2,
    marsE: 6,
    standaloneF: 0,
    standaloneE: 12,
    standaloneD: 3,
    standaloneC: 12,
    domMarsE: 0,
    domStandaloneC: 8
  },
  {
    name: 'Bölgesel Meydan (14 Pozisyon / 14 Nominal)',
    marsF: 0,
    marsE: 0,
    standaloneF: 0,
    standaloneE: 2,
    standaloneD: 2,
    standaloneC: 10,
    domMarsE: 0,
    domStandaloneC: 0
  }
];

export const NON_BRIDGEABLE_TYPES = new Set([
  'AT72', 'AT75', 'AT76', 'AT45', 'AT43', 'ATR', 'ATR72',
  'DH8D', 'DH8C', 'DH8B', 'DH8A', 'DH8', 'DHC8',
  'CRJ1', 'CRJ2', 'CRJ7', 'CRJ9', 'CRJX',
  'E135', 'E140', 'E145', 'E35L', 'E55P',
  'GLEX', 'GL7T', 'GL5T', 'GLF4', 'GLF5', 'GLF6',
  'CL30', 'CL35', 'CL60', 'FA7X', 'FA6X', 'C560', 'C56X', 'C68A', 'H25B',
  'SF34', 'SW4', 'BE20', 'B350', 'C208', 'PC12', 'JS32', 'D228', 'D328', 'L410', 'AN24', 'AN26'
]);

export function getAircraftCategory(acType: string): 'B' | 'C' | 'D' | 'E' | 'F' {
  if (!acType) return 'C';
  const c = acType.toUpperCase().trim();
  if (['B748', 'B744', 'B747', '748', '744', '747', 'A380', 'A388', '380', '388', 'AN124'].includes(c)) return 'F';
  if ([
    'A330', 'A332', 'A333', 'A338', 'A339', '332', '333', '339',
    'A340', 'A342', 'A343', 'A345', 'A346',
    'A359', 'A35K', 'A350', '359', '351',
    'B767', 'B763', 'B764', '763',
    'B777', 'B772', 'B77W', 'B77L', 'B773', '77W', '772', '77L',
    'B787', 'B788', 'B789', 'B781', '788', '789', '78X',
    'A306', 'A310', 'A300', 'IL96', 'MD11'
  ].includes(c)) return 'E';
  if (['B757', 'B752', 'B753', 'B762', '752', '753'].includes(c)) return 'D';
  if (NON_BRIDGEABLE_TYPES.has(c)) return 'B';
  return 'C';
}

export function isBridgeStandName(stand: string): boolean {
  if (!stand) return false;
  const s = stand.trim().toUpperCase();
  if (s.startsWith('D19') || s.startsWith('D20')) return false;
  return s.length >= 2 && ['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(s[0]) && /\d/.test(s[1]);
}

/**
 * Compiles ANY user-entered stand inventory (MARS F/E + Standalone F/E/D/C) into a physical stand graph.
 * Zero airport-specific hardcoding!
 */
export function compileTopologyFromInventory(inv: UniversalStandInventory): CompiledTopology {
  const stands: BridgeStandSpec[] = [];
  const hasDedicatedDom = (inv.domMarsE > 0) || (inv.domStandaloneC > 0);
  const nonDomZone: StandZone = hasDedicatedDom ? 'INT' : 'SWING';

  const safeDomMarsE = Math.min(Math.max(0, inv.domMarsE), Math.max(0, inv.marsE));
  const safeDomStdC = Math.min(Math.max(0, inv.domStandaloneC), Math.max(0, inv.standaloneC));

  const addMars = (prefix: string, idx: number, maxCat: 'E' | 'F', zone: StandZone) => {
    const center = `${prefix}${idx}`;
    const left = `${center}L`;
    const right = `${center}R`;
    stands.push({
      id: center, zone, maxCat,
      conflictsWith: [center, left, right],
      isMarsCenter: true, isMarsSub: false, nominalSlots: 0
    });
    stands.push({
      id: left, zone, maxCat: 'C',
      conflictsWith: [left, center],
      isMarsCenter: false, isMarsSub: true, nominalSlots: 1
    });
    stands.push({
      id: right, zone, maxCat: 'C',
      conflictsWith: [right, center],
      isMarsCenter: false, isMarsSub: true, nominalSlots: 1
    });
  };

  const addStandalone = (id: string, maxCat: MaxCat, zone: StandZone) => {
    stands.push({
      id, zone, maxCat,
      conflictsWith: [id],
      isMarsCenter: false, isMarsSub: false, nominalSlots: 1
    });
  };

  for (let i = 1; i <= Math.max(0, inv.marsF); i++) addMars('MF', i, 'F', nonDomZone);
  for (let i = 1; i <= Math.max(0, inv.marsE); i++) {
    const z: StandZone = i <= safeDomMarsE ? 'DOM' : nonDomZone;
    addMars('ME', i, 'E', z);
  }
  for (let i = 1; i <= Math.max(0, inv.standaloneF); i++) addStandalone(`SF${i}`, 'F', nonDomZone);
  for (let i = 1; i <= Math.max(0, inv.standaloneE); i++) addStandalone(`SE${i}`, 'E', nonDomZone);
  for (let i = 1; i <= Math.max(0, inv.standaloneD); i++) addStandalone(`SD${i}`, 'D', nonDomZone);
  for (let i = 1; i <= Math.max(0, inv.standaloneC); i++) {
    const z: StandZone = i <= safeDomStdC ? 'DOM' : nonDomZone;
    addStandalone(`SC${i}`, 'C', z);
  }

  const physicalStands =
    Math.max(0, inv.marsF) +
    Math.max(0, inv.marsE) +
    Math.max(0, inv.standaloneF) +
    Math.max(0, inv.standaloneE) +
    Math.max(0, inv.standaloneD) +
    Math.max(0, inv.standaloneC);

  const nominalNarrowSlots =
    Math.max(0, inv.marsF) * 2 +
    Math.max(0, inv.marsE) * 2 +
    Math.max(0, inv.standaloneF) +
    Math.max(0, inv.standaloneE) +
    Math.max(0, inv.standaloneD) +
    Math.max(0, inv.standaloneC);

  const domNarrowSlots = safeDomMarsE * 2 + safeDomStdC;
  const intOrSwingNarrowSlots = nominalNarrowSlots - domNarrowSlots;

  return {
    inventory: inv,
    physicalStands,
    nominalNarrowSlots,
    domNarrowSlots,
    intOrSwingNarrowSlots,
    stands
  };
}
