import { FlightState } from '../types.ts';

const CORS_PROXY_URL = 'https://corsproxy.io/?';
const OPENSKY_URL = `${CORS_PROXY_URL}https://opensky-network.org/api/states/all`;

// State vector indices from OpenSky Network API documentation
const StateVector = {
  ICAO24: 0,
  CALLSIGN: 1,
  ORIGIN_COUNTRY: 2,
  TIME_POSITION: 3,
  LAST_CONTACT: 4,
  LONGITUDE: 5,
  LATITUDE: 6,
  BARO_ALTITUDE: 7,
  ON_GROUND: 8,
  VELOCITY: 9,
  TRUE_TRACK: 10,
  VERTICAL_RATE: 11,
  SENSORS: 12,
  GEO_ALTITUDE: 13,
  SQUAWK: 14,
  SPI: 15,
  POSITION_SOURCE: 16,
};

// This function needs to return an object matching the FlightState interface
const parseStateVector = (state: any[]): FlightState => ({
  icao24: state[StateVector.ICAO24],
  callsign: state[StateVector.CALLSIGN]?.trim() ?? 'N/A',
  origin_country: state[StateVector.ORIGIN_COUNTRY],
  longitude: state[StateVector.LONGITUDE],
  latitude: state[StateVector.LATITUDE],
  baro_altitude: state[StateVector.BARO_ALTITUDE],
  on_ground: state[StateVector.ON_GROUND],
  velocity: state[StateVector.VELOCITY],
  true_track: state[StateVector.TRUE_TRACK],
  vertical_rate: state[StateVector.VERTICAL_RATE],
});

export const findFlightState = async (flightNumber: string): Promise<FlightState | null> => {
  try {
    const response = await fetch(OPENSKY_URL);
    if (!response.ok) {
        console.error('Failed to fetch from OpenSky Network via proxy:', response.status, response.statusText);
        return null;
    }
    const data = await response.json();

    if (!data || !Array.isArray(data.states)) {
      console.error('Invalid data structure from OpenSky API');
      return null;
    }

    const flightStateVector = data.states.find(
      (state: any[]) => state[StateVector.CALLSIGN]?.trim() === flightNumber
    );

    if (flightStateVector) {
      return parseStateVector(flightStateVector);
    }

    return null; // Flight not found
  } catch (error) {
    console.error('Error fetching or parsing flight state:', error);
    return null;
  }
};