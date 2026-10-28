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

    // Flightradar24 External URL (if the user wants to open in new tab)
    const trackingQuery = callsign || cleanFlightNumber || regNo;
    const fr24LiveUrl = `https://www.flightradar24.com/${encodeURIComponent(trackingQuery)}`;

    const handleCopy = (text: string, field: 'user' | 'pass') => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2500);
    };

    const handleOpenFlightradar24 = (url: string = fr24LiveUrl) => {
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    // 1. Fetch Real-time ADS-B / Flightradar24 state
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

    // 2. Initialize Leaflet Map (Guaranteed Dark Matter Radar tiles + range rings)
    useEffect(() => {
        if (!mapRef.current || mapInstance.current || typeof L === 'undefined') return;

        const map = L.map(mapRef.current, {
            zoomControl: true,
            attributionControl: false
        }).setView(IST_COORDS, 7);

        // Esri World Dark Gray Canvas (No API Key required, clean dark ATC radar map)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 16
        }).addTo(map);

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 16
        }).addTo(map);

        // Add Istanbul Airport Base Marker
        const istIcon = L.divIcon({
            html: `
                <div style="position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
                    <div style="position: absolute; inset: 0; background: rgba(59, 130, 246, 0.4); border-radius: 50%; animation: ping 2s infinite;"></div>
                    <div style="width: 24px; height: 24px; background: #2563eb; border: 2px solid #ffffff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; box-shadow: 0 0 12px rgba(37,99,235,0.9);">🏢</div>
                </div>
            `,
            className: 'leaflet-ist-icon',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });
        const istMarker = L.marker(IST_COORDS, { icon: istIcon }).addTo(map);
        istMarker.bindPopup(`<b>İstanbul Havalimanı (IST / LTFM)</b><br>Apron Radar & Operasyon Merkezi`);
        istMarkerInstance.current = istMarker;

        // Radar Range Rings from IST (25 NM, 50 NM, 100 NM)
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

        // Invalidate size to guarantee tiles render properly inside modal
        setTimeout(() => {
            map.invalidateSize();
        }, 200);

        return () => {
            map.remove();
            mapInstance.current = null;
        };
    }, []);

    // 3. Update Plane Marker, Flight Path Polyline, and Camera Bounds
    useEffect(() => {
        if (!mapInstance.current || typeof L === 'undefined') return;
        const map = mapInstance.current;

        // Force Leaflet to resize if container size changed
        map.invalidateSize();

        if (flightState && flightState.latitude && flightState.longitude) {
            const { latitude, longitude, true_track, baro_altitude, speed_kmh, velocity } = flightState;
            const planeLatLng: [number, number] = [latitude, longitude];

            // Rotating SVG Aircraft Icon with glowing radar pulse
            const planeHtml = `
                <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
                    <div style="position: absolute; inset: 0; background: rgba(6, 182, 212, 0.35); border-radius: 50%; animation: ping 1.5s infinite;"></div>
                    <div style="width: 32px; height: 32px; background: rgba(15, 23, 42, 0.85); border: 2px solid #06b6d4; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 14px #06b6d4;">
                        <div style="font-size: 20px; transform: rotate(${true_track || 0}deg); filter: drop-shadow(0 0 4px #06b6d4);">
                            ✈️
                        </div>
                    </div>
                </div>
            `;

            const planeIcon = L.divIcon({
                html: planeHtml,
                className: 'leaflet-plane-icon',
                iconSize: [44, 44],
                iconAnchor: [22, 22],
            });

            const popupContent = `
                <div style="color: #0f172a; font-family: sans-serif; min-width: 180px;">
                    <b style="font-size: 13px; color: #0284c7;">${flightNumber} (${callsign})</b><br>
                    <span style="font-size: 11px; color: #475569;">Tescil: <b>${flightState.registration || regNo || 'Bilinmiyor'}</b></span><br>
                    <span style="font-size: 11px; color: #475569;">Tip: <b>${flightState.aircraft_type || aircraftType}</b></span><br>
                    <hr style="margin: 4px 0; border: 0; border-top: 1px solid #e2e8f0;">
                    <span style="font-size: 11px;">İrtifa: <b style="color: #16a34a;">${Math.round(baro_altitude || 0)} m (${Math.round((baro_altitude || 0) * 3.28)} ft)</b></span><br>
                    <span style="font-size: 11px;">Hız: <b style="color: #16a34a;">${speed_kmh || Math.round((velocity || 0) * 3.6)} km/s</b></span><br>
                    <span style="font-size: 11px;">Baş Açısı: <b>${true_track || 0}°</b></span>
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

            // Draw cyan dashed trajectory to Istanbul Airport
            if (!polylineInstance.current) {
                polylineInstance.current = L.polyline([planeLatLng, IST_COORDS], {
                    color: '#06b6d4',
                    weight: 2.5,
                    dashArray: '6, 8',
                    opacity: 0.9
                }).addTo(map);
            } else {
                polylineInstance.current.setLatLngs([planeLatLng, IST_COORDS]);
            }

            // Fit camera to view both plane and destination airport
            map.fitBounds([planeLatLng, IST_COORDS], { padding: [60, 60], maxZoom: 11 });

        } else if (!loading) {
            // Plane parked at apron / stand
            const standIcon = L.divIcon({
                html: `
                    <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
                        <div style="position: absolute; inset: 0; background: rgba(245, 158, 11, 0.4); border-radius: 50%;"></div>
                        <div style="width: 28px; height: 28px; background: #d97706; border: 2px solid #ffffff; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: bold; color: white; box-shadow: 0 0 12px rgba(217,119,6,0.9);">
                            🅿️
                        </div>
                    </div>
                `,
                className: 'leaflet-stand-icon',
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            });

            if (!markerInstance.current) {
                const marker = L.marker(IST_COORDS, { icon: standIcon }).addTo(map);
                marker.bindPopup(`
                    <b>${flightNumber} (${callsign})</b><br>
                    Tescil: <b>${regNo || 'Bilinmiyor'}</b><br>
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

    const handleFitRoute = () => {
        if (mapInstance.current && flightState?.latitude && flightState?.longitude) {
            mapInstance.current.fitBounds([[flightState.latitude, flightState.longitude], IST_COORDS], {
                padding: [60, 60]
            });
        }
    };

    const handleZoomPlane = () => {
        if (mapInstance.current && flightState?.latitude && flightState?.longitude) {
            mapInstance.current.setView([flightState.latitude, flightState.longitude], 10);
        }
    };

    const handleZoomIST = () => {
        if (mapInstance.current) {
            mapInstance.current.setView(IST_COORDS, 13);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[90] p-2 md:p-4 backdrop-blur-md animate-fade-in select-none">
            <div className="bg-gray-900 border border-cyan-500/50 rounded-2xl shadow-2xl shadow-cyan-950/70 w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden text-white">
                
                {/* Header */}
                <header className="px-5 py-3 bg-gradient-to-r from-gray-950 via-slate-900 to-cyan-950 border-b border-gray-750 flex justify-between items-center flex-shrink-0">
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
                                        🅿️ Apron / Stand Konumu
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

                {/* Sub-Header Actions & Flightradar24 Account info */}
                <div className="px-5 py-2.5 bg-gray-950 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3 text-xs flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5 bg-cyan-950/60 border border-cyan-800/60 px-3 py-1.5 rounded-xl">
                            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
                            Canlı ADS-B Uçak Takip Radarı
                        </span>
                        
                        <button
                            onClick={() => handleOpenFlightradar24(fr24LiveUrl)}
                            className="px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-750 text-gray-300 border border-gray-700 flex items-center gap-1.5 transition text-xs font-semibold cursor-pointer"
                            title="İsteğe bağlı harici sekmede Flightradar24 aç"
                        >
                            <span className="text-red-400">🔴</span>
                            <span>Flightradar24 (Harici Sekme)</span>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </button>
                    </div>

                    {/* Corporate Credentials Box */}
                    <div className="flex items-center gap-2 bg-gray-900 border border-cyan-800/40 rounded-xl px-2.5 py-1 text-xs text-gray-300">
                        <span className="text-cyan-400 font-semibold">İGA FR24 Hesabı:</span>
                        <span className="font-mono text-cyan-200 text-[11px]">{fr24User}</span>
                        <button
                            onClick={() => handleCopy(fr24User, 'user')}
                            className="text-gray-400 hover:text-white px-1 rounded hover:bg-gray-800 text-[11px] cursor-pointer"
                        >
                            {copiedField === 'user' ? '✓' : 'Kop.'}
                        </button>
                        <span className="text-gray-600">|</span>
                        <span className="font-mono text-amber-300">••••••••</span>
                        <button
                            onClick={() => handleCopy(fr24Pass, 'pass')}
                            className="text-gray-400 hover:text-white px-1 rounded hover:bg-gray-800 text-[11px] cursor-pointer"
                        >
                            {copiedField === 'pass' ? '✓' : 'Şifre'}
                        </button>
                    </div>
                </div>

                {/* Main Content Body: Split View (Map on Left, Telemetry on Right) */}
                <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden relative">
                    
                    {/* Live Radar Map Area */}
                    <div className="flex-1 h-full min-h-[400px] relative bg-gray-950">
                        <div ref={mapRef} className="w-full h-full" />

                        {loading && (
                            <div className="absolute inset-0 bg-gray-950/70 flex items-center justify-center z-20 backdrop-blur-xs">
                                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-800 border border-cyan-500/40 text-cyan-200 text-xs shadow-xl">
                                    <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                                    <span>Canlı radar transponder koordinatları sorgulanıyor...</span>
                                </div>
                            </div>
                        )}

                        {/* Top-Right Quick Map Control Overlays */}
                        <div className="absolute top-4 right-4 z-[400] flex flex-col gap-1.5">
                            {flightState && flightState.latitude && (
                                <>
                                    <button
                                        onClick={handleZoomPlane}
                                        className="px-2.5 py-1.5 rounded-lg bg-gray-900/95 hover:bg-gray-800 text-cyan-300 border border-cyan-500/40 backdrop-blur-md shadow-xl text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer"
                                        title="Haritayı uçağa odakla"
                                    >
                                        <span>✈️ Uçağa Yakınlaş</span>
                                    </button>
                                    <button
                                        onClick={handleFitRoute}
                                        className="px-2.5 py-1.5 rounded-lg bg-gray-900/95 hover:bg-gray-800 text-emerald-300 border border-emerald-500/40 backdrop-blur-md shadow-xl text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer"
                                        title="Uçak ile İstanbul arasındaki rotanın tamamını gör"
                                    >
                                        <span>🔄 Rotanın Tamamı</span>
                                    </button>
                                </>
                            )}
                            <button
                                onClick={handleZoomIST}
                                className="px-2.5 py-1.5 rounded-lg bg-gray-900/95 hover:bg-gray-800 text-blue-300 border border-blue-500/40 backdrop-blur-md shadow-xl text-[11px] font-bold flex items-center gap-1.5 transition cursor-pointer"
                                title="Haritayı İstanbul Havalimanı LTFM Apronuna odakla"
                            >
                                <span>🏢 LTFM Apron</span>
                            </button>
                        </div>

                        {/* Distance & Approach Overlay (Bottom Left) */}
                        {distanceKm !== null && (
                            <div className="absolute bottom-4 left-4 z-[400] bg-gray-900/95 border border-cyan-500/50 backdrop-blur-md rounded-xl p-3 shadow-2xl max-w-xs text-xs">
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="font-bold text-cyan-300 flex items-center gap-1">
                                        <span>🎯</span> IST / LTFM Yaklaşma
                                    </span>
                                    <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded">
                                        CANLI RADAR
                                    </span>
                                </div>
                                <div className="space-y-1 mt-1 text-gray-300 text-[11px]">
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Kuş Uçuşu Mesafe:</span>
                                        <span className="font-bold font-mono text-white text-xs">{distanceKm} km ({distanceNm} NM)</span>
                                    </div>
                                    {etaMinutes !== null && (
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">Tahmini Teker Koyma:</span>
                                            <span className="font-bold font-mono text-emerald-400 text-xs">~{etaMinutes} dakika</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Hedef Meydan:</span>
                                        <span className="font-bold text-cyan-200">İstanbul Havalimanı (IST)</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Telemetry Sidebar (Right Side) */}
                    <div className="w-full md:w-80 lg:w-96 bg-gray-950 border-t md:border-t-0 md:border-l border-gray-800 p-4 flex flex-col justify-between overflow-y-auto text-xs space-y-4 flex-shrink-0">
                        
                        <div>
                            <h3 className="text-xs uppercase font-bold tracking-wider text-cyan-400 mb-3 flex items-center gap-1.5">
                                <span>📊</span>
                                Uçak Telemetrisi & Canlı Durum
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
                                                <span className="text-gray-400 block text-[10px]">Baş Açısı:</span>
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
                                        <strong className="block mb-1 text-amber-300">🅿️ Stand / Apron Durumu:</strong>
                                        Transponder yayını beklemede. Uçak İstanbul Havalimanı (LTFM) <strong>{currentStand}</strong> standı üzerinde park pozisyonundadır.
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
