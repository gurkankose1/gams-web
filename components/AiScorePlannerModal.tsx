import React, { useState, useMemo } from 'react';
import { Flight } from '../types.ts';
import { AiAllocationOptions } from '../services/ai-allocator.ts';
import { getFidsPublicationStatus } from '../services/fids-service.ts';

interface AiScorePlannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRunPlanning: (options: AiAllocationOptions) => void;
    flights: Flight[];
    currentStartDate?: Date;
    currentEndDate?: Date;
}

export const AiScorePlannerModal: React.FC<AiScorePlannerModalProps> = ({
    isOpen,
    onClose,
    onRunPlanning,
    flights,
    currentStartDate,
    currentEndDate
}) => {
    // Mode selection: 'BATCH' | 'LIVE_FIDS' | 'TIME_WINDOW'
    const [selectedMode, setSelectedMode] = useState<'BATCH' | 'LIVE_FIDS' | 'TIME_WINDOW'>('BATCH');

    // FIDS gate parameters option
    const [ignoreFidsParameters, setIgnoreFidsParameters] = useState<boolean>(false);

    // Time window options
    const [timeFilterEnabled, setTimeFilterEnabled] = useState<boolean>(false);
    
    // Auto-compute default date range from flights or props
    const defaultDates = useMemo(() => {
        if (flights.length === 0) {
            const now = new Date();
            const startStr = now.toISOString().slice(0, 16);
            const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const endStr = end.toISOString().slice(0, 16);
            return { startStr, endStr, refStr: startStr };
        }

        let minArr = flights[0].scheduledArrival.getTime();
        let maxArr = flights[0].scheduledArrival.getTime();
        flights.forEach(f => {
            const arr = f.scheduledArrival.getTime();
            if (arr < minArr) minArr = arr;
            if (arr > maxArr) maxArr = arr;
        });

        const startD = new Date(minArr);
        const endD = new Date(maxArr);

        const formatIsoLocal = (d: Date) => {
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };

        return {
            startStr: formatIsoLocal(startD),
            endStr: formatIsoLocal(endD),
            refStr: formatIsoLocal(new Date(minArr + 4 * 60 * 60 * 1000))
        };
    }, [flights]);

    const [filterStartStr, setFilterStartStr] = useState<string>(defaultDates.startStr);
    const [filterEndStr, setFilterEndStr] = useState<string>(defaultDates.endStr);
    const [referenceTimeStr, setReferenceTimeStr] = useState<string>(defaultDates.refStr);

    // Calculate preview counts
    const previewStats = useMemo(() => {
        if (!isOpen) return { total: 0, fidsLocked: 0, timeFiltered: 0, eligible: 0 };
        const refD = new Date(referenceTimeStr || defaultDates.refStr);
        let fidsLocked = 0;
        let timeFiltered = 0;

        const effectiveIgnoreFids = selectedMode === 'BATCH' || ignoreFidsParameters;
        const effectiveTimeFilter = selectedMode === 'TIME_WINDOW' || timeFilterEnabled;

        const startD = new Date(filterStartStr);
        const endD = new Date(filterEndStr);

        flights.forEach(f => {
            // Check time filter
            if (effectiveTimeFilter) {
                const arrTime = f.scheduledArrival;
                if (arrTime < startD || arrTime > endD) {
                    timeFiltered++;
                    return;
                }
            }

            // Check FIDS lock
            if (!effectiveIgnoreFids) {
                const fids = getFidsPublicationStatus(f, refD);
                if (fids.isPublished && (f.gate || f.raw_data?.Gate || f.raw_data?.DepGate)) {
                    fidsLocked++;
                }
            }
        });

        const eligible = Math.max(0, flights.length - fidsLocked - timeFiltered);
        return {
            total: flights.length,
            fidsLocked,
            timeFiltered,
            eligible
        };
    }, [isOpen, flights, selectedMode, ignoreFidsParameters, timeFilterEnabled, filterStartStr, filterEndStr, referenceTimeStr, defaultDates]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        const effectiveIgnoreFids = selectedMode === 'BATCH' || ignoreFidsParameters;
        const effectiveTimeFilter = selectedMode === 'TIME_WINDOW' || timeFilterEnabled;

        const options: AiAllocationOptions = {
            ignoreFidsParameters: effectiveIgnoreFids,
            timeFilterEnabled: effectiveTimeFilter,
            filterStart: effectiveTimeFilter ? new Date(filterStartStr) : undefined,
            filterEnd: effectiveTimeFilter ? new Date(filterEndStr) : undefined,
            referenceTime: new Date(referenceTimeStr)
        };

        onRunPlanning(options);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[90] p-4 backdrop-blur-sm animate-fade-in select-none">
            <div className="bg-gray-850 border border-gray-700/80 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden text-white flex flex-col max-h-[92vh]">
                
                {/* Header */}
                <header className="p-5 bg-gradient-to-r from-purple-950 via-indigo-950 to-gray-900 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
                    <div className="flex items-center gap-2.5">
                        <span className="text-2xl">⚡</span>
                        <div>
                            <h2 className="text-lg font-bold bg-gradient-to-r from-purple-300 via-indigo-200 to-amber-300 bg-clip-text text-transparent">
                                AI Skor Planlama & Otomatik Kapı Tahsis Yapılandırması
                            </h2>
                            <p className="text-xs text-gray-400 mt-0.5">
                                Kural tabanlı deterministik köprü optimizasyonu, FIDS kapı kilitleri ve zaman filtreleme
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

                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-5 text-sm">
                    
                    {/* 3 Core Principles Selector */}
                    <div>
                        <label className="text-xs uppercase font-bold tracking-wider text-gray-400 block mb-2">
                            1. Planlama Prensibi & Çalışma Modu Seçimi
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            
                            {/* Mod 1 */}
                            <div 
                                onClick={() => {
                                    setSelectedMode('BATCH');
                                    setTimeFilterEnabled(false);
                                    setIgnoreFidsParameters(true);
                                }}
                                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                                    selectedMode === 'BATCH'
                                        ? 'bg-purple-950/40 border-purple-500 shadow-md shadow-purple-950/50 ring-1 ring-purple-500/50'
                                        : 'bg-gray-800/60 border-gray-700/70 hover:border-gray-600'
                                }`}
                            >
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="font-bold text-purple-300 text-sm">Mod 1: Genel Toplu</span>
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">Mevcut Yapı</span>
                                    </div>
                                    <p className="text-xs text-gray-300 leading-relaxed">
                                        Excel'den import edilmiş tüm uçuşları AI kendi skor parametrelerine göre kısıtsız planlar.
                                    </p>
                                </div>
                                <div className="mt-3 pt-2 border-t border-gray-700/50 text-[11px] text-gray-400">
                                    ✓ Gate parametreleri göz ardı edilir
                                </div>
                            </div>

                            {/* Mod 2 */}
                            <div 
                                onClick={() => {
                                    setSelectedMode('LIVE_FIDS');
                                    setTimeFilterEnabled(false);
                                    setIgnoreFidsParameters(false);
                                }}
                                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                                    selectedMode === 'LIVE_FIDS'
                                        ? 'bg-indigo-950/40 border-indigo-500 shadow-md shadow-indigo-950/50 ring-1 ring-indigo-500/50'
                                        : 'bg-gray-800/60 border-gray-700/70 hover:border-gray-600'
                                }`}
                            >
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="font-bold text-indigo-300 text-sm">Mod 2: Canlı AODB / FIDS</span>
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">FIDS Korumalı</span>
                                    </div>
                                    <p className="text-xs text-gray-300 leading-relaxed">
                                        Kalkış kapısı FIDS ekranlarına basılmış uçuşları KİLİTLER. Yalnızca ekranlara yansımamış uçuşları planlar.
                                    </p>
                                </div>
                                <div className="mt-3 pt-2 border-t border-gray-700/50 text-[11px] text-indigo-300/90 font-medium">
                                    🛡️ 75 / 90 / 120 dk FIDS Emniyet Kilidi
                                </div>
                            </div>

                            {/* Mod 3 */}
                            <div 
                                onClick={() => {
                                    setSelectedMode('TIME_WINDOW');
                                    setTimeFilterEnabled(true);
                                }}
                                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                                    selectedMode === 'TIME_WINDOW'
                                        ? 'bg-amber-950/40 border-amber-500 shadow-md shadow-amber-950/50 ring-1 ring-amber-500/50'
                                        : 'bg-gray-800/60 border-gray-700/70 hover:border-gray-600'
                                }`}
                            >
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="font-bold text-amber-300 text-sm">Mod 3: Tarih & Saat</span>
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">Zaman Pencereli</span>
                                    </div>
                                    <p className="text-xs text-gray-300 leading-relaxed">
                                        Belirli bir tarih ve saat aralığında gelen uçakları planlar. Bu aralık dışındaki uçaklar sabit kalır.
                                    </p>
                                </div>
                                <div className="mt-3 pt-2 border-t border-gray-700/50 text-[11px] text-amber-300/90 font-medium">
                                    ⏱️ Geliş Saati Bazlı Dinamik Filtre
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* FIDS Gate Parameters Toggle (Canlı AODB / FIDS Seçenekleri) */}
                    <div className="bg-gray-900/70 border border-gray-750 rounded-xl p-4 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="font-bold text-gray-200 text-sm flex items-center gap-2">
                                    <span>🚪</span>
                                    FIDS Gate Parametreleri Kısıtı (Resmî Kapı Yayın Eşikleri)
                                </h3>
                                <p className="text-xs text-gray-400 mt-1">
                                    Kapısı yolcu ekranlarına (FIDS) yansımış uçuşların kapı değişikliğini engeller (Hard Lock).
                                    Yakın Kapılar: <span className="text-amber-400 font-mono">STD-75 dk</span> | 
                                    Uzak İskeleler: <span className="text-amber-400 font-mono">STD-90 dk</span> | 
                                    USA / UK / Kanada / Özel: <span className="text-amber-400 font-mono">STD-120 dk</span>.
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 mt-1">
                                <input 
                                    type="checkbox" 
                                    className="sr-only peer"
                                    checked={!ignoreFidsParameters}
                                    onChange={(e) => setIgnoreFidsParameters(!e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                            </label>
                        </div>

                        {ignoreFidsParameters && (
                            <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-600/40 text-amber-300 text-xs flex items-center gap-2">
                                <span>⚠️</span>
                                <span><strong>Gate Parametreleri Göz Ardı Edildi:</strong> Kapısı FIDS ekranlarına basılmış uçuşlar da kısıtsız olarak taşınabilir/optimize edilebilir.</span>
                            </div>
                        )}

                        {!ignoreFidsParameters && (
                            <div className="pt-2 border-t border-gray-800 flex items-center gap-3">
                                <label className="text-xs text-gray-400 whitespace-nowrap">
                                    FIDS Hesaplama Referans Saati:
                                </label>
                                <input 
                                    type="datetime-local" 
                                    value={referenceTimeStr}
                                    onChange={(e) => setReferenceTimeStr(e.target.value)}
                                    className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-indigo-200 font-mono focus:border-indigo-500 focus:outline-none"
                                />
                                <span className="text-[11px] text-gray-500">
                                    (Test ve simülasyon için operasyonel an saati)
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Tarih & Saat Aralığı Filtresi (Mod 3 ve Özel Aralık) */}
                    <div className="bg-gray-900/70 border border-gray-750 rounded-xl p-4 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h3 className="font-bold text-gray-200 text-sm flex items-center gap-2">
                                    <span>📅</span>
                                    Geliş Tarihi ve Saat Aralığı Filtresi
                                </h3>
                                <p className="text-xs text-gray-400 mt-1">
                                    Yalnızca belirtilen tarih ve saat aralığında <strong>gelen (Arrival)</strong> uçakları planlar.
                                    Gidiş saatine bakılmaksızın bu aralıkta gelenler optimize edilir; aralık dışındakiler sabit kalır.
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 mt-1">
                                <input 
                                    type="checkbox" 
                                    className="sr-only peer"
                                    checked={timeFilterEnabled}
                                    onChange={(e) => setTimeFilterEnabled(e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                            </label>
                        </div>

                        {timeFilterEnabled && (
                            <div className="pt-2 border-t border-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-gray-400 block mb-1">
                                        Başlangıç Geliş Zamanı (Bu saatten sonra gelenler):
                                    </label>
                                    <input 
                                        type="datetime-local" 
                                        value={filterStartStr}
                                        onChange={(e) => setFilterStartStr(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-amber-200 font-mono focus:border-amber-500 focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400 block mb-1">
                                        Bitiş Geliş Zamanı (Bu saate kadar gelenler):
                                    </label>
                                    <input 
                                        type="datetime-local" 
                                        value={filterEndStr}
                                        onChange={(e) => setFilterEndStr(e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-amber-200 font-mono focus:border-amber-500 focus:outline-none"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Canlı Önizleme Özeti */}
                    <div className="bg-gray-800/80 border border-gray-700 rounded-xl p-3.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-4">
                            <div>
                                <span className="text-gray-400">Toplam Yüklü Uçuş:</span>{' '}
                                <strong className="text-white font-mono">{previewStats.total}</strong>
                            </div>
                            {previewStats.fidsLocked > 0 && (
                                <div className="text-indigo-300">
                                    <span>🛡️ FIDS Kilitli:</span>{' '}
                                    <strong className="font-mono">{previewStats.fidsLocked} uçuş</strong>
                                </div>
                            )}
                            {previewStats.timeFiltered > 0 && (
                                <div className="text-amber-300">
                                    <span>⏱️ Zaman Dışı Sabit:</span>{' '}
                                    <strong className="font-mono">{previewStats.timeFiltered} uçuş</strong>
                                </div>
                            )}
                        </div>
                        <div className="text-right">
                            <span className="text-gray-400">AI Optimize Edecek:</span>{' '}
                            <span className="text-sm font-bold text-emerald-400 font-mono px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30">
                                {previewStats.eligible} Uçuş
                            </span>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <footer className="p-4 bg-gray-900 border-t border-gray-700 flex justify-between items-center flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium transition text-xs cursor-pointer"
                    >
                        İptal
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-5 py-2.5 rounded-lg font-bold text-white shadow-lg transition duration-200 cursor-pointer flex items-center gap-2 bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 shadow-purple-900/40 text-xs border border-purple-400/40"
                    >
                        <span>⚡</span>
                        Seçili Parametrelerle AI Skor Planla
                    </button>
                </footer>

            </div>
        </div>
    );
};
export default AiScorePlannerModal;
