export interface FlightHistoryEntry {
  user: string;
  action: string;
  timestamp: Date;
}

export type FlightType = 'turnaround' | 'arrival' | 'departure';
export type PlanningTimeMode = 'AIBT_AOBT' | 'ETA_ETD';

export interface FlightShadowInfo {
  /** Shadow 1: Min turnaround gap past ETD in minutes (0 if ETD - ETA >= minTurnaround) */
  minTurnGapMins: number;
  /** Historical min turnaround for this Airline + A/C Type (minutes) */
  minTurnaroundRefMins?: number;
  /** Shadow 2: Historical avg positive delay (AOBT - ETD) past ETD in minutes */
  avgDelayMins: number;
  /** Lookup label for Shadow 2 (e.g. "IRA718 (n=412)" or "IR→IKA (n=850)") */
  delaySourceLabel?: string;
  /** Total shadow extension past ETD: max(minTurnGapMins, avgDelayMins) */
  totalShadowMins: number;
  /** Whether Shadow 2 exceeds Shadow 1 and both are positive (triggers dashed cut divider) */
  hasSplitDivider: boolean;
}

export interface Flight {
  id: string;
  type: FlightType;
  arrivalFlightNumber?: string;
  departureFlightNumber?: string;
  airline: string;
  origin?: string;
  destination?: string;
  aircraftType: string;
  regNo?: string;
  scheduledArrival: Date;
  scheduledDeparture: Date;
  /** Gerçekleşmiş zamanlar (AIBT / ATA -> AOBT / ATD) — Mod 1 için */
  actualArrival?: Date;
  actualDeparture?: Date;
  /** Canlı öngörü zamanları (ETA / STA -> ETD / STD) — Mod 2 için */
  estimatedArrival?: Date;
  estimatedDeparture?: Date;
  parkingPosition: string | null;
  gate: string | null;
  isDomestic: boolean;
  arrivalIsDomestic?: boolean;
  departureIsDomestic?: boolean;
  departureMode?: string;
  trafficMode?: string;
  acCategory?: string;
  isTransparent?: boolean;
  timeSource?: 'BLOCK' | 'ACTUAL' | 'SCHEDULED';
  mtow?: number;
  isSuperSet?: boolean;
  raw_data?: any;
  isOperationalLocked?: boolean;
  history?: FlightHistoryEntry[];
}

export interface FlightState {
  icao24: string;
  callsign: string;
  origin_country: string;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null; // meters
  on_ground: boolean;
  velocity: number | null; // m/s
  true_track: number | null; // degrees
  vertical_rate: number | null; // m/s
  altitude_ft?: number;
  speed_kmh?: number;
  speed_kts?: number;
  aircraft_type?: string;
  registration?: string;
  origin?: string;
  destination?: string;
  flight_number?: string;
  source?: string;
  is_at_stand?: boolean;
}

export interface MaintenanceBlock {
  id: string;
  parkingPosition: string;
  startTime: Date;
  endTime: Date;
  reason: string;
}

export const ItemTypes = {
  FLIGHT: 'flight',
};