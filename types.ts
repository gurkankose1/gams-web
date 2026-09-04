export interface FlightHistoryEntry {
  user: string;
  action: string;
  timestamp: Date;
}

export type FlightType = 'turnaround' | 'arrival' | 'departure';

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
  parkingPosition: string | null;
  gate: string | null;
  isDomestic: boolean;
  arrivalIsDomestic?: boolean;
  departureIsDomestic?: boolean;
  departureMode?: string;
  mtow?: number;
  raw_data?: any;
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