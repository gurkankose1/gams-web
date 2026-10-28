import { FlightState } from '../types.ts';

export interface FlightTrackingQuery {
  callsign?: string;
  regNo?: string;
  flightNumber?: string;
}

export const findFlightState = async (
  queryOrFlightNumber: string | FlightTrackingQuery
): Promise<FlightState | null> => {
  let callsign = '';
  let regNo = '';
  let flightNumber = '';

  if (typeof queryOrFlightNumber === 'string') {
    callsign = queryOrFlightNumber;
    flightNumber = queryOrFlightNumber;
  } else if (queryOrFlightNumber) {
    callsign = queryOrFlightNumber.callsign || '';
    regNo = queryOrFlightNumber.regNo || '';
    flightNumber = queryOrFlightNumber.flightNumber || '';
  }

  // 1. Primary Source: Vercel Serverless FR24 ADS-B API
  try {
    const params = new URLSearchParams();
    if (callsign) params.append('callsign', callsign);
    if (regNo) params.append('reg', regNo);
    if (flightNumber) params.append('flight', flightNumber);

    const res = await fetch(`/api/radar?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.found && data.latitude && data.longitude) {
        return {
          icao24: data.hex || 'N/A',
          callsign: data.callsign || callsign || 'N/A',
          origin_country: data.origin || 'N/A',
          longitude: data.longitude,
          latitude: data.latitude,
          baro_altitude: data.baro_altitude,
          altitude_ft: data.altitude_ft,
          on_ground: !!data.on_ground,
          velocity: data.velocity,
          speed_kmh: data.speed_kmh,
          speed_kts: data.speed_kts,
          true_track: data.true_track,
          vertical_rate: null,
          aircraft_type: data.aircraft_type,
          registration: data.registration || regNo,
          origin: data.origin,
          destination: data.destination,
          flight_number: data.flight_number || flightNumber,
          source: 'FLIGHTRADAR24'
        };
      }
    }
  } catch (err) {
    console.warn('API radar fetch failed, trying fallbacks:', err);
  }

  // 2. Secondary Fallback: OpenSky Network
  try {
    const searchTarget = (callsign || flightNumber).replace(/\s+/g, '').toUpperCase();
    if (searchTarget) {
      const res = await fetch(`https://opensky-network.org/api/states/all`);
      if (res.ok) {
        const osData = await res.json();
        if (osData && Array.isArray(osData.states)) {
          const match = osData.states.find(
            (s: any[]) => s[1]?.trim().toUpperCase() === searchTarget
          );
          if (match && match[6] && match[5]) {
            return {
              icao24: match[0],
              callsign: match[1]?.trim() || searchTarget,
              origin_country: match[2],
              longitude: match[5],
              latitude: match[6],
              baro_altitude: match[7],
              altitude_ft: match[7] ? Math.round(match[7] * 3.28084) : 0,
              on_ground: !!match[8],
              velocity: match[9],
              speed_kmh: match[9] ? Math.round(match[9] * 3.6) : 0,
              speed_kts: match[9] ? Math.round(match[9] * 1.94384) : 0,
              true_track: match[10],
              vertical_rate: match[11],
              source: 'OPENSKY'
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn('OpenSky fallback failed:', err);
  }

  return null;
};
