import React, { useState, useEffect, useRef } from 'react';
import { Flight, FlightState } from '../types.ts';
import { findFlightState } from '../services/flight-tracking-service.ts';

declare var L: any;

interface RadarTrackingModalProps {
    flight: Flight;
    onClose: () => void;
}

export const RadarTrackingModal: React.FC<RadarTrackingModalProps> = ({ flight, onClose }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstance = useRef<any>(null);
    const markerInstance = useRef<any>(null);

    const [flightState, setFlightState] = useState<FlightState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copiedField, setCopiedField] = useState<'user' | 'pass' | null>(null);

    // Flight identifiers
    const flightNumber = flight.departureFlightNumber || flight.arrivalFlightNumber || '';
    const cleanFlightNumber = flightNumber.replace(/\s+/g, '');
    const callsign = ((flight as any).callsign || flight.raw_data?.['Call Sign'] || cleanFlightNumber).replace(/\s+/g, '');
    const regNo = (flight.regNo || '').replace(/[^A-Za-z0-9]/g, '');
    const aircraftType = flight.aircraftType || 'N/A';
    const origin = flight.origin || (flight.raw_data && flight.raw_data['From Statition']) || 'IST';
    const destination = flight.destination || (flight.raw_data && flight.raw_data['To Station']) || 'N/A';
    const currentStand = flight.parkingPosition || 'Atanmadı';
    const currentGate = flight.gate || flight.raw_data?.Gate || flight.raw_data?.DepGate || 'Atanmadı';

    // Corporate Credentials
    const fr24User = "RAMP2.RCOSCTM@igairport.aero";
    const fr24Pass = "Ramp.kontrol2023***";

    // Flightradar24 URL targets
    // FR24 supports finding aircraft by callsign, registration, or flight number:
    // Format: https://www.flightradar24.com/{CALLSIGN} or https://www.flightradar24.com/{REGISTRATION}
    const trackingQuery = callsign || cleanFlightNumber || regNo;
    const fr24LiveUrl = `https://www.flightradar24.com/${encodeURIComponent(trackingQuery)}`;
    const fr24DataUrl = `https://www.flightradar24.com/data/flights/${encodeURIComponent(cleanFlightNumber.toLowerCase())}`;
    const fr24RegUrl = regNo ? `https://www.flightradar24.com/data/aircraft/${encodeURIComponent(regNo.toLowerCase())}` : null;

    const handleCopy = (text: string, field: 'user' | 'pass') => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2500);
    };

    const handleOpenFlightradar24 = (url: string = fr24LiveUrl) => {
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    // Live state polling
    useEffect(() => {
        const fetchRadarData = async () => {
            const query = callsign || cleanFlightNumber;
            if (!query) {
                setError('Canlı radar için çağrı adı veya uçuş numarası bulunamadı.');
                setLoading(false);
                return;
            }

            try {
                const state = await findFlightState(query);
                if (state && state.latitude && state.longitude) {
                    setFlightState(state);
                    setError(null);
                } else if (loading) {
                    setError('Yerel/OpenSky radar beslemesinde anlık transponder sinyali aranıyor...');
                }
            } catch (err) {
                console.warn('Radar fetch error:', err);
                if (loading) {
                    setError('Canlı radar soketi taranıyor...');
                }
            } finally {
                if (loading) setLoading(false);
            }
        };

        fetchRadarData();
        const timer = setInterval(fetchRadarData, 12000);
        return () => clearInterval(timer);
    }, [callsign, cleanFlightNumber, loading]);

    // Initialize Leaflet Map
    useEffect(() => {
        if (mapRef.current && !mapInstance.current) {
            const defaultLat = flightState?.latitude ?? 41.2753; // IST Airport center
            const defaultLon = flightState?.longitude ?? 28.7519;

            if (typeof L !== 'undefined') {
                const map = L.map(mapRef.current).setView([defaultLat, defaultLon], flightState ? 9 : 8);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap contributors | Radar Feed'
                }).addTo(map);

                // Add IST Airport reference marker
                const istMarker = L.circleMarker([41.2753, 28.7519], {
                    radius: 7,
                    fillColor: '#8b5cf6',
                    color: '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.85
                }).addTo(map);
                istMarker.bindPopup('<b>İstanbul Havalimanı (IST / LTFM)</b><br>Apron Radar Merkezi');

                mapInstance.current = map;
            }
        }
    }, [flightState]);

    // Update Plane Marker
    useEffect(() => {
        if (mapInstance.current && flightState?.latitude && flightState?.longitude && typeof L !== 'undefined') {
            const { latitude, longitude, true_track } = flightState;
            const latLng = [latitude, longitude];

            if (!markerInstance.current) {
                const planeIcon = L.divIcon({
                    html: `<div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">✈️</div>`,
                    className: 'leaflet-rotated-icon',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                });
                const marker = L.marker(latLng, { icon: planeIcon }).addTo(mapInstance.current);
                marker.bindPopup(`<b>${flightNumber} (${callsign})</b><br>Tip: ${aircraftType}<br>İrtifa: ${Math.round(flightState.baro_altitude || 0)}m<br>Hız: ${Math.round((flightState.velocity || 0) * 3.6)} km/s`).openPopup();
                markerInstance.current = marker;
            } else {
                markerInstance.current.setLatLng(latLng);
            }

            const iconElement = markerInstance.current.getElement();
            if (iconElement) {
                iconElement.style.transform = iconElement.style.transform.replace(/ rotate\([^)]+\)/, '');
                if (true_track !== null && true_track !== undefined) {
                    iconElement.style.transform += ` rotate(${true_track}deg)`;
                }
            }

            mapInstance.current.panTo(latLng);
        }
    }, [flightState, flightNumber, callsign, aircraftType]);

    return (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[90] p-4 backdrop-blur-md animate-fade-in select-none">
            <div className="bg-gray-850 border border-cyan-500/40 rounded-2xl shadow-2xl shadow-cyan-950/60 w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden text-white">
                
                {/* Header */}
                <header className="p-4 bg-gradient-to-r from-gray-950 via-slate-900 to-cyan-950 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/20">
                            📡
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-white tracking-wide">
                                    {flightNumber} <span className="text-cyan-400 font-mono">({callsign})</span>
                                </h2>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 font-mono">
                                    {regNo ? `TC: ${regNo}` : 'Tescil Yok'} • {aircraftType}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                    Canlı Radar Modu
                                </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                                <span>Rota: <strong>{origin}</strong> ➔ <strong>{destination}</strong></span>
                                <span>•</span>
                                <span>Stant: <strong className="text-amber-300">{currentStand}</strong></span>
                                <span>•</span>
                                <span>Kapı: <strong className="text-purple-300">{currentGate}</strong></span>
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="text-gray-400 hover:text-white text-2xl font-bold leading-none px-2.5 py-1 rounded-lg hover:bg-gray-800 transition"
                    >
                        &times;
                    </button>
                </header>

                {/* Top Action & Credentials Bar */}
                <div className="px-5 py-3 bg-gray-900/90 border-b border-gray-750 flex flex-wrap items-center justify-between gap-3 text-xs flex-shrink-0">
                    
                    {/* Primary Flightradar24 Button */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handleOpenFlightradar24(fr24LiveUrl)}
                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-bold shadow-lg shadow-red-950/60 flex items-center gap-2 transition duration-200 cursor-pointer border border-rose-400/40 text-xs"
                            title="Flightradar24 üzerinde uçağı doğrudan haritada bul, markla ve kilitle"
                        >
                            <span className="text-sm animate-pulse">🔴</span>
                            <span>Flightradar24'te Uçağı Canlı Takip Et ve Markla</span>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </button>

                        {fr24RegUrl && (
                            <button
                                onClick={() => handleOpenFlightradar24(fr24RegUrl)}
                                className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-750 text-gray-200 font-semibold border border-gray-700 flex items-center gap-1.5 transition text-xs cursor-pointer"
                                title="Uçak tesciline (Kuyruk Numarası) ait uçuş geçmişini aç"
                            >
                                <span>✈️</span>
                                <span>Kuyruk Geçmişi ({regNo})</span>
                            </button>
                        )}
                    </div>

                    {/* Corporate FR24 Credentials Badge */}
                    <div className="flex items-center gap-2 bg-gray-950/80 border border-gray-700/80 rounded-xl px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                            <span className="text-amber-400">👤</span>
                            <span className="text-gray-400">İGA FR24 Hesabı:</span>
                            <code className="text-cyan-300 font-mono text-[11px] bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/40">
                                {fr24User}
                            </code>
                            <button
                                onClick={() => handleCopy(fr24User, 'user')}
                                className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-800 transition text-[11px]"
                                title="Kullanıcı adını kopyala"
                            >
                                {copiedField === 'user' ? '✓ Kopyalandı' : 'Kopyala'}
                            </button>
                        </div>
                        <span className="text-gray-600">|</span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-gray-400">Şifre:</span>
                            <code className="text-amber-300 font-mono text-[11px] bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/40">
                                •••••••••••••••
                            </code>
                            <button
                                onClick={() => handleCopy(fr24Pass, 'pass')}
                                className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-800 transition text-[11px]"
                                title="Kurumsal şifreyi kopyala"
                            >
                                {copiedField === 'pass' ? '✓ Kopyalandı' : 'Şifre Kopyala'}
                            </button>
                        </div>
                    </div>

                </div>

                {/* Main Content Area (Map + Live Telemetry) */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
                    
                    {/* Live Radar Map */}
                    <div className="flex-1 h-full w-full relative bg-gray-900">
                        <div ref={mapRef} className="h-full w-full z-10" />

                        {loading && (
                            <div className="absolute inset-0 bg-gray-900/75 flex items-center justify-center z-20 backdrop-blur-xs">
                                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-800 border border-cyan-500/30 text-cyan-200 text-xs shadow-xl">
                                    <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                                    <span>Radar sinyali ve koordinatlar taranıyor...</span>
                                </div>
                            </div>
                        )}

                        {/* Floating Quick Action Overlay */}
                        <div className="absolute bottom-4 left-4 z-20 bg-gray-900/90 border border-gray-750 backdrop-blur-md rounded-xl p-3 shadow-xl max-w-sm text-xs">
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-bold text-gray-200">Flightradar24 Canlı Hedef</span>
                                <span className="text-[10px] text-emerald-400 font-mono">Otomatik Mark</span>
                            </div>
                            <p className="text-[11px] text-gray-400 mb-2">
                                Uçak havada veya yerdeyse tek tıkla Flightradar24'te merkezlenir ve detaylı radar kartı açılır.
                            </p>
                            <button
                                onClick={() => handleOpenFlightradar24(fr24LiveUrl)}
                                className="w-full py-1.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                            >
                                <span>📡 Radarda {cleanFlightNumber} Uçağını Kilitle</span>
                            </button>
                        </div>
                    </div>

                    {/* Telemetry Sidebar */}
                    <div className="w-full md:w-80 bg-gray-900 border-t md:border-t-0 md:border-l border-gray-750 p-4 flex flex-col justify-between overflow-y-auto text-xs space-y-4">
                        
                        <div>
                            <h3 className="text-xs uppercase font-bold tracking-wider text-cyan-400 mb-3 flex items-center gap-1.5">
                                <span>📊</span>
                                Uçak Telemetrisi & Konum Verileri
                            </h3>

                            <div className="space-y-2.5">
                                <div className="p-2.5 rounded-xl bg-gray-800/80 border border-gray-700/70">
                                    <span className="text-gray-400 block text-[11px]">Uçuş Çağrı Adı (Callsign):</span>
                                    <span className="font-bold font-mono text-cyan-300 text-sm">{callsign}</span>
                                </div>

                                <div className="p-2.5 rounded-xl bg-gray-800/80 border border-gray-700/70">
                                    <span className="text-gray-400 block text-[11px]">Tescil (Tail / RegNo):</span>
                                    <span className="font-bold font-mono text-amber-300 text-sm">{flight.regNo || 'Bilinmiyor'}</span>
                                </div>

                                <div className="p-2.5 rounded-xl bg-gray-800/80 border border-gray-700/70">
                                    <span className="text-gray-400 block text-[11px]">Uçak Tipi & Sınıf:</span>
                                    <span className="font-bold text-white text-xs">{aircraftType}</span>
                                </div>

                                {flightState ? (
                                    <>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="p-2 rounded-lg bg-gray-800 border border-gray-700">
                                                <span className="text-gray-400 block text-[10px]">İrtifa:</span>
                                                <span className="font-bold font-mono text-emerald-400">
                                                    {Math.round(flightState.baro_altitude || 0)} m
                                                </span>
                                            </div>
                                            <div className="p-2 rounded-lg bg-gray-800 border border-gray-700">
                                                <span className="text-gray-400 block text-[10px]">Hız (Yer):</span>
                                                <span className="font-bold font-mono text-emerald-400">
                                                    {Math.round((flightState.velocity || 0) * 3.6)} km/s
                                                </span>
                                            </div>
                                        </div>

                                        <div className="p-2.5 rounded-xl bg-gray-800/80 border border-gray-700/70">
                                            <span className="text-gray-400 block text-[11px]">Canlı Koordinatlar:</span>
                                            <span className="font-mono text-gray-200 text-xs">
                                                {flightState.latitude?.toFixed(4)}° N, {flightState.longitude?.toFixed(4)}° E
                                            </span>
                                        </div>
                                    </>
                                ) : (
                                    <div className="p-3 rounded-xl bg-gray-800/40 border border-dashed border-gray-700 text-gray-400 text-center text-[11px]">
                                        Uçak şu an yer radarı veya apron sahasında olabilir. Detaylı canlı konum için Flightradar24'te aç butonunu kullanınız.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Operational Notice */}
                        <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/30 text-[11px] text-cyan-200/90 leading-relaxed">
                            <strong>İGA OCC & Apron Entegrasyonu:</strong>
                            <p className="mt-1 text-gray-400">
                                GAMS slot çubukları ile canlı ADS-B transponder sinyali eşleştiğinde uçağın iniş anı (ALDT) ve kapıya yanaşma (AIBT) süresi otomatik güncellenir.
                            </p>
                        </div>

                    </div>

                </div>

            </div>
        </div>
    );
};
export default RadarTrackingModal;
