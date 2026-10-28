import React, { useState, useEffect, useRef } from 'react';
import { Flight, FlightState } from '../types.ts';
import { findFlightState } from '../services/flight-tracking-service.ts';

declare var L: any;

interface RadarTrackingModalProps {
    flight: Flight;
    onClose: () => void;
}

const IST_COORDS: [number, number] = [41.2753, 28.7519]; // Istanbul Airport (LTFM)

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

export const RadarTrackingModal: React.FC<RadarTrackingModalProps> = ({ flight, onClose }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstance = useRef<any>(null);
    const markerInstance = useRef<any>(null);
    const istMarkerInstance = useRef<any>(null);
    const polylineInstance = useRef<any>(null);
    const rangeRingsRef = useRef<any[]>([]);

    const [flightState, setFlightState] = useState<FlightState | null>(null);
    const [loading, setLoading] = useState(true);
    const [copiedField, setCopiedField] = useState<'user' | 'pass' | null>(null);
    const [activeTab, setActiveTab] = useState<'RADAR' | 'DETAILS'>('RADAR');

    // Flight identifiers
    const flightNumber = flight.departureFlightNumber || flight.arrivalFlightNumber || '';
    const cleanFlightNumber = flightNumber.replace(/\s+/g, '');
    const rawCallsign = ((flight as any).callsign || flight.raw_data?.['Call Sign'] || cleanFlightNumber).replace(/\s+/g, '');
    const callsign = rawCallsign;
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
        let isMounted = true;

        const fetchRadarData = async () => {
            try {
                const state = await findFlightState({
                    callsign: callsign,
                    regNo: regNo,
                    flightNumber: cleanFlightNumber
                });

                if (isMounted) {
                    if (state && state.latitude && state.longitude) {
                        setFlightState(state);
                    }
                    setLoading(false);
                }
            } catch (err) {
                console.warn('Radar fetch error:', err);
                if (isMounted) setLoading(false);
            }
        };

        fetchRadarData();
        const timer = setInterval(fetchRadarData, 10000);
        return () => {
            isMounted = false;
            clearInterval(timer);
        };
    }, [callsign, regNo, cleanFlightNumber]);

    // Initialize Leaflet Map with CartoDB Dark Matter Radar Theme
    useEffect(() => {
        if (mapRef.current && !mapInstance.current && typeof L !== 'undefined') {
            const map = L.map(mapRef.current, {
                zoomControl: true,
                attributionControl: false
            }).setView(IST_COORDS, 8);

            // Dark Matter tiles for realistic ATC radar look
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                subdomains: 'abcd',
                maxZoom: 19
            }).addTo(map);

            // Add IST Airport Base Marker
            const istIcon = L.divIcon({
                html: `
                    <div style="position: relative; width: 22px; height: 22px;">
                        <div style="position: absolute; inset: 0; background: rgba(59, 130, 246, 0.35); border-radius: 50%; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
                        <div style="position: relative; width: 22px; height: 22px; background: #2563eb; border: 2px solid #ffffff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; box-shadow: 0 0 12px rgba(37,99,235,0.8);">🏢</div>
                    </div>
                `,
                className: 'leaflet-ist-icon',
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });
            const istMarker = L.marker(IST_COORDS, { icon: istIcon }).addTo(map);
            istMarker.bindPopup(`<b>İstanbul Havalimanı (IST / LTFM)</b><br>Apron Radar & Operasyon Merkezi`);
            istMarkerInstance.current = istMarker;

            // Add Radar Range Rings (25 NM, 50 NM, 100 NM)
            const rings = [
                { radius: 46300, label: '25 NM' },
                { radius: 92600, label: '50 NM' },
                { radius: 185200, label: '100 NM' }
            ];
            rings.forEach(r => {
                const circle = L.circle(IST_COORDS, {
                    radius: r.radius,
                    color: '#06b6d4',
                    weight: 1,
                    opacity: 0.25,
                    dashArray: '4, 8',
                    fill: false
                }).addTo(map);
                rangeRingsRef.current.push(circle);
            });

            mapInstance.current = map;
        }
    }, []);

    // Update Plane Marker, Flight Path Polyline, and Camera Bounds
    useEffect(() => {
        if (!mapInstance.current || typeof L === 'undefined') return;
        const map = mapInstance.current;

        if (flightState && flightState.latitude && flightState.longitude) {
            const { latitude, longitude, true_track, baro_altitude, velocity, speed_kmh } = flightState;
            const planeLatLng: [number, number] = [latitude, longitude];

            // 1. Update or create Plane Marker
            const planeHtml = `
                <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                    <div style="position: absolute; inset: 0; background: rgba(6, 182, 212, 0.3); border-radius: 50%; animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
                    <div style="font-size: 26px; transform: rotate(${true_track || 0}deg); filter: drop-shadow(0 0 8px #06b6d4);">
                        ✈️
                    </div>
                </div>
            `;

            const planeIcon = L.divIcon({
                html: planeHtml,
                className: 'leaflet-plane-icon',
                iconSize: [36, 36],
                iconAnchor: [18, 18],
            });

            const popupContent = `
                <div style="color: #0f172a; font-family: sans-serif; min-width: 170px;">
                    <b style="font-size: 13px; color: #0284c7;">${flightNumber} (${callsign})</b><br>
                    <span style="font-size: 11px; color: #475569;">Tescil: <b>${flightState.registration || regNo || 'Bilinmiyor'}</b></span><br>
                    <span style="font-size: 11px; color: #475569;">Tip: <b>${aircraftType}</b></span><br>
                    <hr style="margin: 4px 0; border: 0; border-top: 1px solid #e2e8f0;">
                    <span style="font-size: 11px;">İrtifa: <b style="color: #16a34a;">${Math.round(baro_altitude || 0)} m (${Math.round((baro_altitude || 0) * 3.28)} ft)</b></span><br>
                    <span style="font-size: 11px;">Hız: <b style="color: #16a34a;">${speed_kmh || Math.round((velocity || 0) * 3.6)} km/s</b></span><br>
                    <span style="font-size: 11px;">Baş Açısı: <b>${true_track || 0}°</b></span><br>
                    <span style="font-size: 10px; color: #64748b;">Kaynak: Flightradar24 ADS-B</span>
                </div>
            `;

            if (!markerInstance.current) {
                const marker = L.marker(planeLatLng, { icon: planeIcon }).addTo(map);
                marker.bindPopup(popupContent).openPopup();
                markerInstance.current = marker;
            } else {
                markerInstance.current.setLatLng(planeLatLng);
                markerInstance.current.setIcon(planeIcon);
                markerInstance.current.setPopupContent(popupContent);
            }

            // 2. Draw or update direct flight path line towards Istanbul Airport
            if (!polylineInstance.current) {
                const pathLine = L.polyline([planeLatLng, IST_COORDS], {
                    color: '#06b6d4',
                    weight: 2,
                    dashArray: '6, 8',
                    opacity: 0.85
                }).addTo(map);
                polylineInstance.current = pathLine;
            } else {
                polylineInstance.current.setLatLngs([planeLatLng, IST_COORDS]);
            }

            // 3. Auto-fit camera bounds so both plane and Istanbul Airport are in full view
            map.fitBounds([planeLatLng, IST_COORDS], {
                padding: [50, 50],
                maxZoom: 12
            });

        } else if (!loading) {
            // Aircraft not currently airborne; show it at Istanbul Airport Apron / Stand
            const standHtml = `
                <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;">
                    <div style="position: absolute; inset: 0; background: rgba(245, 158, 11, 0.35); border-radius: 50%;"></div>
                    <div style="width: 26px; height: 26px; background: #d97706; border: 2px solid #ffffff; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: bold; color: white; box-shadow: 0 0 10px rgba(217,119,6,0.8);">
                        🅿️
                    </div>
                </div>
            `;

            const standIcon = L.divIcon({
                html: standHtml,
                className: 'leaflet-stand-icon',
                iconSize: [34, 34],
                iconAnchor: [17, 17]
            });

            if (!markerInstance.current) {
                const marker = L.marker(IST_COORDS, { icon: standIcon }).addTo(map);
                marker.bindPopup(`
                    <b>${flightNumber} (${callsign})</b><br>
                    Tescil: ${regNo || 'Bilinmiyor'}<br>
                    <b style="color: #d97706;">Apronda Park Halinde</b><br>
                    Stand: <b>${currentStand}</b> | Kapı: <b>${currentGate}</b>
                `).openPopup();
                markerInstance.current = marker;
            }

            map.setView(IST_COORDS, 14);
        }
    }, [flightState, loading, flightNumber, callsign, aircraftType, regNo, currentStand, currentGate]);

    // Calculated metrics
    const distanceKm = flightState?.latitude && flightState?.longitude
        ? calculateDistanceKm(flightState.latitude, flightState.longitude, IST_COORDS[0], IST_COORDS[1])
        : null;
    const distanceNm = distanceKm !== null ? Math.round(distanceKm * 0.539957) : null;
    const speedKmh = flightState?.speed_kmh || (flightState?.velocity ? Math.round(flightState.velocity * 3.6) : null);
    const etaMinutes = distanceKm !== null && speedKmh && speedKmh > 50
        ? Math.round((distanceKm / speedKmh) * 60)
        : null;

    return (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[90] p-3 md:p-5 backdrop-blur-md animate-fade-in select-none">
            <div className="bg-gray-900 border border-cyan-500/50 rounded-2xl shadow-2xl shadow-cyan-950/70 w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden text-white">
                
                {/* Header */}
                <header className="px-5 py-3.5 bg-gradient-to-r from-gray-950 via-slate-900 to-cyan-950 border-b border-gray-750 flex justify-between items-center flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-400/50 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/20 animate-pulse">
                            📡
                        </div>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-lg font-bold text-white tracking-wide">
                                    {flightNumber} <span className="text-cyan-400 font-mono">({callsign})</span>
                                </h2>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 font-mono font-bold">
                                    {regNo ? `Tescil: ${regNo}` : 'Tescil Yok'} • {aircraftType}
                                </span>
                                {flightState ? (
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 flex items-center gap-1.5 font-bold">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                                        🟢 Canlı Havadaki Radar Konumu
                                    </span>
                                ) : (
                                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40 flex items-center gap-1 font-bold">
                                        🅿️ Apron / Standda Park Halinde
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                                <span>Rota: <strong className="text-gray-200">{origin}</strong> ➔ <strong className="text-gray-200">{destination}</strong></span>
                                <span>•</span>
                                <span>Stant: <strong className="text-amber-300">{currentStand}</strong></span>
                                <span>•</span>
                                <span>Kapı: <strong className="text-purple-300">{currentGate}</strong></span>
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="text-gray-400 hover:text-white text-2xl font-bold leading-none px-2.5 py-1 rounded-lg hover:bg-gray-800 transition cursor-pointer"
                    >
                        &times;
                    </button>
                </header>

                {/* Top Action & Credentials Bar */}
                <div className="px-5 py-2.5 bg-gray-950 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3 text-xs flex-shrink-0">
                    
                    {/* Primary Flightradar24 Button */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handleOpenFlightradar24(fr24LiveUrl)}
                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white font-bold shadow-lg shadow-red-950/60 flex items-center gap-2 transition duration-200 cursor-pointer border border-rose-400/40 text-xs"
                            title="Flightradar24 üzerinde uçağı haritada markla ve kilitle"
                        >
                            <span className="text-sm">🔴</span>
                            <span>Flightradar24 Sayfasında Aç (Harici Sekme)</span>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </button>

                        {fr24RegUrl && (
                            <button
                                onClick={() => handleOpenFlightradar24(fr24RegUrl)}
                                className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold border border-gray-700 flex items-center gap-1.5 transition text-xs cursor-pointer"
                            >
                                <span>✈️ Kuyruk Geçmişi ({regNo})</span>
                            </button>
                        )}
                    </div>

                    {/* Corporate Credentials Box */}
                    <div className="flex items-center gap-2 bg-gray-900 border border-cyan-800/50 rounded-xl px-3 py-1.5 text-xs text-gray-300">
                        <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                            <span>👤</span>
                            <span>İGA FR24 Hesabı:</span>
                        </div>
                        
                        <div className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded border border-gray-700">
                            <span className="font-mono text-cyan-200">{fr24User}</span>
                            <button
                                onClick={() => handleCopy(fr24User, 'user')}
                                className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-800 transition text-[11px] cursor-pointer"
                                title="Kullanıcı adını kopyala"
                            >
                                {copiedField === 'user' ? '✓ Kopyalandı' : 'Kopyala'}
                            </button>
                        </div>

                        <span className="text-gray-600">|</span>

                        <div className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded border border-gray-700">
                            <span className="font-mono text-amber-300 tracking-wider">•••••••••••••</span>
                            <button
                                onClick={() => handleCopy(fr24Pass, 'pass')}
                                className="text-gray-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-800 transition text-[11px] cursor-pointer"
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
                    <div className="flex-1 h-full w-full relative bg-gray-950">
                        <div ref={mapRef} className="h-full w-full z-10" />

                        {loading && (
                            <div className="absolute inset-0 bg-gray-950/70 flex items-center justify-center z-20 backdrop-blur-xs">
                                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-800 border border-cyan-500/40 text-cyan-200 text-xs shadow-xl">
                                    <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                                    <span>Canlı ADS-B / Flightradar24 transponder sinyali sorgulanıyor...</span>
                                </div>
                            </div>
                        )}

                        {/* Radar Distance & ETA Card (Left Bottom) */}
                        {distanceKm !== null && (
                            <div className="absolute bottom-4 left-4 z-20 bg-gray-900/90 border border-cyan-500/40 backdrop-blur-md rounded-xl p-3 shadow-xl max-w-xs text-xs">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="font-bold text-cyan-300 flex items-center gap-1">
                                        <span>🎯</span> IST / LTFM Yaklaşma
                                    </span>
                                    <span className="text-[10px] text-emerald-400 font-mono font-bold">CANLI ROTA</span>
                                </div>
                                <div className="space-y-1 mt-1 text-gray-300 text-[11px]">
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Kalan Mesafe:</span>
                                        <span className="font-bold font-mono text-white">{distanceKm} km ({distanceNm} NM)</span>
                                    </div>
                                    {etaMinutes !== null && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Tahmini İniş:</span>
                                            <span className="font-bold font-mono text-emerald-400">~{etaMinutes} dakika</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Hedef Havalimanı:</span>
                                        <span className="font-bold text-cyan-200">İstanbul Havalimanı (IST)</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Reset View Buttons (Top Right Overlay) */}
                        <div className="absolute top-4 right-4 z-20 flex flex-col gap-1.5">
                            {flightState && flightState.latitude && (
                                <button
                                    onClick={() => {
                                        if (mapInstance.current && flightState.latitude && flightState.longitude) {
                                            mapInstance.current.setView([flightState.latitude, flightState.longitude], 10);
                                        }
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-gray-900/90 hover:bg-gray-800 text-cyan-300 border border-cyan-500/30 backdrop-blur-md shadow-lg text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer"
                                    title="Haritayı uçağa odakla"
                                >
                                    <span>✈️ Uçağa Odaklan</span>
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    if (mapInstance.current) {
                                        mapInstance.current.setView(IST_COORDS, 13);
                                    }
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-gray-900/90 hover:bg-gray-800 text-blue-300 border border-blue-500/30 backdrop-blur-md shadow-lg text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer"
                                title="Haritayı İstanbul Havalimanı LTFM Apronuna odakla"
                            >
                                <span>🏢 LTFM Apronuna Odaklan</span>
                            </button>
                        </div>
                    </div>

                    {/* Telemetry Sidebar */}
                    <div className="w-full md:w-88 bg-gray-950 border-t md:border-t-0 md:border-l border-gray-800 p-4 flex flex-col justify-between overflow-y-auto text-xs space-y-4">
                        
                        <div>
                            <h3 className="text-xs uppercase font-bold tracking-wider text-cyan-400 mb-3 flex items-center gap-1.5">
                                <span>📊</span>
                                Uçak Telemetrisi & Canlı Konum
                            </h3>

                            <div className="space-y-2.5">
                                <div className="p-2.5 rounded-xl bg-gray-900 border border-gray-800">
                                    <span className="text-gray-400 block text-[11px]">Uçuş Çağrı Adı (Callsign):</span>
                                    <span className="font-bold font-mono text-cyan-300 text-sm">{callsign}</span>
                                </div>

                                <div className="p-2.5 rounded-xl bg-gray-900 border border-gray-800">
                                    <span className="text-gray-400 block text-[11px]">Tescil (Tail / RegNo):</span>
                                    <span className="font-bold font-mono text-amber-300 text-sm">
                                        {flightState?.registration || flight.regNo || 'Bilinmiyor'}
                                    </span>
                                </div>

                                <div className="p-2.5 rounded-xl bg-gray-900 border border-gray-800">
                                    <span className="text-gray-400 block text-[11px]">Uçak Tipi & Sınıf:</span>
                                    <span className="font-bold text-white text-xs">
                                        {flightState?.aircraft_type || aircraftType}
                                    </span>
                                </div>

                                {flightState ? (
                                    <>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="p-2.5 rounded-xl bg-gray-900 border border-gray-800">
                                                <span className="text-gray-400 block text-[10px]">İrtifa:</span>
                                                <span className="font-bold font-mono text-emerald-400 text-xs">
                                                    {Math.round(flightState.baro_altitude || 0)} m
                                                </span>
                                                <span className="text-[10px] text-gray-500 block">
                                                    ({flightState.altitude_ft ? `${flightState.altitude_ft} ft` : `${Math.round((flightState.baro_altitude || 0) * 3.28)} ft`})
                                                </span>
                                            </div>
                                            <div className="p-2.5 rounded-xl bg-gray-900 border border-gray-800">
                                                <span className="text-gray-400 block text-[10px]">Yer Hızı:</span>
                                                <span className="font-bold font-mono text-emerald-400 text-xs">
                                                    {speedKmh || 0} km/s
                                                </span>
                                                <span className="text-[10px] text-gray-500 block">
                                                    ({flightState.speed_kts ? `${flightState.speed_kts} kts` : `${Math.round((speedKmh || 0) * 0.539957)} kts`})
                                                </span>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="p-2 rounded-lg bg-gray-900 border border-gray-800">
                                                <span className="text-gray-400 block text-[10px]">Baş Açısı (Track):</span>
                                                <span className="font-bold font-mono text-cyan-300">
                                                    {flightState.true_track !== null ? `${flightState.true_track}°` : 'N/A'}
                                                </span>
                                            </div>
                                            <div className="p-2 rounded-lg bg-gray-900 border border-gray-800">
                                                <span className="text-gray-400 block text-[10px]">Veri Kaynağı:</span>
                                                <span className="font-bold font-mono text-emerald-400 text-[11px]">
                                                    {flightState.source || 'FLIGHTRADAR24'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="p-2.5 rounded-xl bg-gray-900 border border-gray-800">
                                            <span className="text-gray-400 block text-[11px]">Canlı Koordinatlar:</span>
                                            <span className="font-mono text-gray-200 text-xs">
                                                {flightState.latitude?.toFixed(4)}° N, {flightState.longitude?.toFixed(4)}° E
                                            </span>
                                        </div>
                                    </>
                                ) : (
                                    <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-800/30 text-amber-200/90 text-[11px] leading-relaxed">
                                        <strong className="block mb-1 text-amber-300">🅿️ Stand / Apron Konumu:</strong>
                                        Uçak havadaki transponder yayını göndermemektedir. Harita üzerinde İstanbul Havalimanı (LTFM) <strong>{currentStand}</strong> numaralı stand üzerinde park halinde gösterilmektedir.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Operational Notice */}
                        <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/30 text-[11px] text-cyan-200/90 leading-relaxed">
                            <strong>İGA RAMP & Apron Entegrasyonu:</strong>
                            <p className="mt-1 text-gray-400">
                                Canlı ADS-B transponder sinyali uçağın iniş teker koyma anını (ALDT) ve kapıya yanaşma (AIBT) süresini gerçek zamanlı günceller.
                            </p>
                        </div>

                    </div>

                </div>

            </div>
        </div>
    );
};
export default RadarTrackingModal;
