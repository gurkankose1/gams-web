import React, { useState, useEffect, useRef } from 'react';
import { Flight, FlightState } from '../types.ts';
import { findFlightState } from '../services/flight-tracking-service.ts';

// declare L to satisfy typescript for Leaflet loaded from script tag
declare var L: any;

interface FlightTrackingModalProps {
  flight: Flight;
  onClose: () => void;
}

const FlightTrackingModal: React.FC<FlightTrackingModalProps> = ({ flight, onClose }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markerInstance = useRef<any>(null);
  const [flightState, setFlightState] = useState<FlightState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const flightNumberToTrack = flight.departureFlightNumber || flight.arrivalFlightNumber;

  useEffect(() => {
    const fetchFlightData = async () => {
      if (!flightNumberToTrack) {
        setError('Uçuş numarası bulunamadı.');
        setLoading(false);
        return;
      }
      try {
        // Don't reset error on poll, only on first load
        const state = await findFlightState(flightNumberToTrack);
        if (state && state.latitude && state.longitude) {
          setFlightState(state);
          setError(null); // Clear error if data is found
        } else if (loading) { // Only set error if it's the first load and nothing was found
          setError('Uçuş canlı verisi bulunamadı.');
        }
      } catch (e) {
        setError('Veri alınırken bir hata oluştu.');
        console.error(e);
      } finally {
        if (loading) {
            setLoading(false);
        }
      }
    };

    fetchFlightData();
    const interval = setInterval(fetchFlightData, 15000); // Poll every 15 seconds

    return () => clearInterval(interval);
  }, [flightNumberToTrack, loading]);

  useEffect(() => {
    if (mapRef.current && !mapInstance.current && flightState?.latitude && flightState?.longitude) {
      const map = L.map(mapRef.current).setView([flightState.latitude, flightState.longitude], 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      mapInstance.current = map;
    }
  }, [flightState]);

  useEffect(() => {
    if (mapInstance.current && flightState?.latitude && flightState?.longitude) {
        const { latitude, longitude, true_track } = flightState;
        const latLng = [latitude, longitude];

        if (!markerInstance.current) {
            const planeIcon = L.divIcon({
                html: '✈️',
                className: 'leaflet-rotated-icon',
                iconSize: [24, 24],
                iconAnchor: [12, 12],
            });
            const marker = L.marker(latLng, { icon: planeIcon }).addTo(mapInstance.current);
            marker.bindPopup(`<b>${flightNumberToTrack}</b>`).openPopup();
            markerInstance.current = marker;
        } else {
            markerInstance.current.setLatLng(latLng);
        }

        const iconElement = markerInstance.current.getElement();
        if (iconElement) {
             // Reset transform before applying new rotation
            iconElement.style.transform = iconElement.style.transform.replace(/ rotate\([^)]+\)/, '');
            if (true_track !== null) {
                iconElement.style.transform += ` rotate(${true_track}deg)`;
            }
        }
        
        mapInstance.current.panTo(latLng);
    }
  }, [flightState, flightNumberToTrack]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[70] p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        <header className="p-4 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
          <h2 className="text-xl font-bold text-white">Canlı Uçuş Takibi: {flightNumberToTrack}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </header>

        <main className="flex-grow relative bg-gray-700">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <p className="text-white bg-black/50 p-4 rounded-lg">Canlı veri aranıyor...</p>
            </div>
          )}
          {error && !flightState && (
            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
              <p className="text-yellow-400 bg-black/50 p-4 rounded-lg">{error}</p>
            </div>
          )}
          <div ref={mapRef} className="w-full h-full z-10" />
        </main>
        
        <footer className="p-2 bg-gray-900/50 border-t border-gray-700 flex justify-around text-xs text-center flex-shrink-0 z-20">
          {flightState ? (
            <>
                <div className="text-white"><span className="font-bold text-gray-400">İrtifa: </span>{flightState.baro_altitude ? `${Math.round(flightState.baro_altitude * 3.28084)} ft` : 'N/A'}</div>
                <div className="text-white"><span className="font-bold text-gray-400">Hız: </span>{flightState.velocity ? `${Math.round(flightState.velocity * 1.94384)} kts` : 'N/A'}</div>
                <div className="text-white"><span className="font-bold text-gray-400">Yön: </span>{flightState.true_track ? `${Math.round(flightState.true_track)}°` : 'N/A'}</div>
                <div className="text-white"><span className="font-bold text-gray-400">Durum: </span>{flightState.on_ground ? 'Yerde' : 'Havada'}</div>
            </>
          ) : (
             <div className="text-gray-500">{loading ? '...' : error || 'Veri bekleniyor...'}</div>
          )}
        </footer>
      </div>
    </div>
  );
};

export default FlightTrackingModal;