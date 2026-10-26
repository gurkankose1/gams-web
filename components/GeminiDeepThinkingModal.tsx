import React, { useState } from 'react';
import { Flight, MaintenanceBlock } from '../types.ts';
import {
    runGeminiDeepThinkingOptimization,
    applyDeepThinkingSwaps,
    DeepThinkingResult,
    DeepThinkingSwap,
    getStoredModel,
    getStoredApiKey
} from '../services/gemini-api.ts';

interface GeminiDeepThinkingModalProps {
    isOpen: boolean;
    onClose: () => void;
    flights: Flight[];
    maintenanceBlocks?: MaintenanceBlock[];
    onApplyUpdates: (updatedFlights: Flight[], message: string) => void;
    onOpenSettings: () => void;
}

export const GeminiDeepThinkingModal: React.FC<GeminiDeepThinkingModalProps> = ({
    isOpen,
    onClose,
    flights,
    maintenanceBlocks,
    onApplyUpdates,
    onOpenSettings
}) => {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [progressStep, setProgressStep] = useState<string>('');
    const [result, setResult] = useState<DeepThinkingResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [appliedSwapIds, setAppliedSwapIds] = useState<Set<string>>(new Set());

    if (!isOpen) return null;

    const currentModel = getStoredModel();
    const apiKey = getStoredApiKey();

    const handleRunOptimization = async () => {
        setIsLoading(true);
        setError(null);
        setProgressStep('Başlatılıyor...');

        try {
            const res = await runGeminiDeepThinkingOptimization(
                flights,
                maintenanceBlocks,
                (msg) => setProgressStep(msg)
            );
            setResult(res);
            setAppliedSwapIds(new Set());
        } catch (err: any) {
            setError(err.message || 'Derin akıl yürütme sırasında hata oluştu.');
        } finally {
            setIsLoading(false);
            setProgressStep('');
        }
    };

    const handleApplySingleSwap = (swap: DeepThinkingSwap) => {
        const updated = applyDeepThinkingSwaps(flights, [swap]);
        setAppliedSwapIds(prev => new Set(prev).add(swap.id));
        onApplyUpdates(
            updated,
            `🧠 Gemini Derin Akıl: ${swap.callsign} uçağı ${swap.fromStand} yerine ${swap.toStand} körüğüne alındı.`
        );
    };

    const handleApplyAllSwaps = () => {
        if (!result) return;
        const validSwaps = result.swaps.filter(s => s.ruleCompliant && !appliedSwapIds.has(s.id));
        if (validSwaps.length === 0) return;

        const updated = applyDeepThinkingSwaps(flights, validSwaps);
        setAppliedSwapIds(new Set(result.swaps.map(s => s.id)));
        onApplyUpdates(
            updated,
            `🚀 Gemini Tümünü Uygula: Toplam +${validSwaps.length} uçak körüğe bağlandı! (Hedef Köprü Oranı: %${result.projectedBridgeRate.toFixed(1)})`
        );
        onClose();
    };

    const validSwaps = result?.swaps.filter(s => s.ruleCompliant && !appliedSwapIds.has(s.id)) || [];

    return (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[97] p-4 backdrop-blur-md animate-fade-in select-none">
            <div className="bg-gray-900 border border-purple-500/40 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-white">
                
                {/* Header */}
                <header className="p-4 bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 border-b border-purple-500/30 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-xl shadow-lg shadow-purple-600/30 animate-pulse">
                            🧠
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-white tracking-wide">
                                    Gemini Derin Düşünce Optimizasyonu
                                </h2>
                                <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                    {currentModel}
                                </span>
                            </div>
                            <p className="text-xs text-purple-200/70">
                                Katı kurallara takılmadan, insan sezgisi ve stratejik takaslarla körük oranını maksimize eder.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={onOpenSettings}
                            className="px-2.5 py-1 text-xs rounded-lg bg-gray-800 hover:bg-gray-700 text-purple-300 border border-purple-500/30 flex items-center gap-1.5 transition"
                            title="API Key ve Model Seçimi"
                        >
                            <span>🔑</span>
                            <span>Model Ayarları</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition"
                        >
                            ✕
                        </button>
                    </div>
                </header>

                {/* KPI Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-gray-950/60 border-b border-gray-800">
                    <div className="p-3 bg-gray-900/80 rounded-xl border border-gray-800">
                        <div className="text-[10px] text-gray-400 uppercase font-bold">Mevcut Uçuş Sayısı</div>
                        <div className="text-lg font-black text-gray-200 mt-0.5">{flights.length}</div>
                    </div>
                    <div className="p-3 bg-gray-900/80 rounded-xl border border-gray-800">
                        <div className="text-[10px] text-gray-400 uppercase font-bold">Mevcut Köprü Oranı</div>
                        <div className="text-lg font-black text-indigo-400 mt-0.5">
                            %{result ? result.initialBridgeRate.toFixed(1) : '--'}
                        </div>
                    </div>
                    <div className="p-3 bg-gray-900/80 rounded-xl border border-purple-500/30 bg-purple-950/10">
                        <div className="text-[10px] text-purple-300 uppercase font-bold">Gemini Hedef Oran</div>
                        <div className="text-lg font-black text-emerald-400 mt-0.5">
                            %{result ? result.projectedBridgeRate.toFixed(1) : '--'}
                            {result && result.netBridgeGainCount > 0 && (
                                <span className="text-xs text-emerald-300 ml-1.5 font-semibold">
                                    (+%{(result.projectedBridgeRate - result.initialBridgeRate).toFixed(1)})
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="p-3 bg-gray-900/80 rounded-xl border border-purple-500/30 bg-purple-950/10">
                        <div className="text-[10px] text-purple-300 uppercase font-bold">Net Köprü Kazancı</div>
                        <div className="text-lg font-black text-purple-300 mt-0.5">
                            {result ? `+${result.netBridgeGainCount} Uçak` : '--'}
                        </div>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Error Banner */}
                    {error && (
                        <div className="p-4 bg-rose-950/50 border border-rose-600/50 rounded-xl text-rose-300 text-xs flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-lg">⚠️</span>
                                <div>
                                    <div className="font-bold">Optimizasyon Hatası</div>
                                    <div>{error}</div>
                                </div>
                            </div>
                            <button
                                onClick={onOpenSettings}
                                className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-white rounded text-xs font-semibold"
                            >
                                API Key Kontrol Et
                            </button>
                        </div>
                    )}

                    {/* Empty State before Run */}
                    {!result && !isLoading && (
                        <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600/20 to-indigo-600/20 border border-purple-500/30 flex items-center justify-center text-3xl">
                                🛫
                            </div>
                            <div className="max-w-md">
                                <h3 className="text-base font-bold text-gray-200">
                                    Derin Düşünme Motorunu Başlatın
                                </h3>
                                <p className="text-xs text-gray-400 mt-1">
                                    Gemini, apron darboğazlarını ve açığa park edilmiş geniş gövdeleri tarayarak çok adımlı stratejik takas zincirleri kurgular.
                                </p>
                            </div>
                            <button
                                onClick={handleRunOptimization}
                                disabled={flights.length === 0}
                                className="px-5 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-600/30 transition transform hover:scale-[1.02] disabled:opacity-40"
                            >
                                ⚡ Derin Analizi Başlat (Gemini Token Harca)
                            </button>
                        </div>
                    )}

                    {/* Loading State with Live Progress */}
                    {isLoading && (
                        <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
                            <div className="relative">
                                <div className="w-16 h-16 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center text-xl">
                                    🧠
                                </div>
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-purple-300 animate-pulse">
                                    Gemini Derin Düşünce Süreci Devam Ediyor...
                                </h3>
                                <p className="text-xs text-gray-400 mt-1 font-mono">
                                    {progressStep || 'Stratejik takas olasılıkları hesaplanıyor...'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Results Display */}
                    {result && !isLoading && (
                        <div className="space-y-4">
                            {/* Executive Summary */}
                            <div className="p-4 bg-purple-950/30 border border-purple-600/30 rounded-xl text-xs space-y-2">
                                <div className="flex items-center gap-2 font-bold text-purple-300">
                                    <span>📋</span>
                                    <span>OCC Baş Dispeçer Değerlendirmesi:</span>
                                </div>
                                <p className="text-gray-300 leading-relaxed italic">
                                    "{result.executiveSummary}"
                                </p>
                            </div>

                            {/* Chain of Thought / Reasoning Steps */}
                            {result.reasoningThoughts.length > 0 && (
                                <div className="p-3 bg-gray-950/70 border border-gray-800 rounded-xl text-xs space-y-1.5">
                                    <div className="font-semibold text-gray-400 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                                        <span>💭</span>
                                        <span>Yapay Zeka Akıl Yürütme Adımları (Chain of Thought):</span>
                                    </div>
                                    <ul className="space-y-1 pl-4 list-disc text-gray-300 text-[11px]">
                                        {result.reasoningThoughts.map((thought, idx) => (
                                            <li key={idx}>{thought}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Recommended Swaps List */}
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between text-xs font-bold text-gray-300 px-1">
                                    <span>Önerilen Stratejik Hamleler ({result.swaps.length}):</span>
                                    <span className="text-purple-400 font-normal text-[11px]">
                                        Uygulanan: {appliedSwapIds.size} / {result.swaps.length}
                                    </span>
                                </div>

                                {result.swaps.map(swap => {
                                    const isApplied = appliedSwapIds.has(swap.id);
                                    return (
                                        <div
                                            key={swap.id}
                                            className={`p-3.5 rounded-xl border transition ${
                                                isApplied
                                                    ? 'bg-gray-900/40 border-gray-800 opacity-60'
                                                    : swap.ruleCompliant
                                                    ? 'bg-gray-900 border-indigo-500/30 hover:border-purple-500/50'
                                                    : 'bg-rose-950/20 border-rose-800/40'
                                            }`}
                                        >
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                                                        swap.isWideBody 
                                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                                                            : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                                                    }`}>
                                                        {swap.aircraftType}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-sm text-white">
                                                                {swap.callsign}
                                                            </span>
                                                            <span className="text-[11px] text-gray-400 font-mono">
                                                                ({swap.arrivalFormatted} - {swap.departureFormatted})
                                                            </span>
                                                            {swap.isWideBody && (
                                                                <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                                                    Geniş Gövde
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-1 text-xs">
                                                            <span className="text-gray-400">Mevcut:</span>
                                                            <span className="font-mono text-rose-300 bg-rose-950/40 px-1.5 py-0.2 rounded">
                                                                {swap.fromStand}
                                                            </span>
                                                            <span className="text-gray-500">➔</span>
                                                            <span className="text-gray-400">Hedef Körük:</span>
                                                            <span className="font-mono text-emerald-300 bg-emerald-950/40 px-1.5 py-0.2 rounded font-bold">
                                                                Stand {swap.toStand}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    {swap.ruleCompliant ? (
                                                        <button
                                                            onClick={() => handleApplySingleSwap(swap)}
                                                            disabled={isApplied}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                                                                isApplied
                                                                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                                                            }`}
                                                        >
                                                            {isApplied ? '✓ Uygulandı' : 'Uygula'}
                                                        </button>
                                                    ) : (
                                                        <span className="text-[10px] text-rose-400 bg-rose-950/60 px-2 py-1 rounded border border-rose-800">
                                                            ⚠️ {swap.rejectionReason}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="mt-2 text-xs text-gray-300/80 bg-gray-950/40 p-2 rounded-lg">
                                                <span className="font-semibold text-purple-300">Strateji:</span> {swap.reason}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <footer className="p-4 bg-gray-950/90 border-t border-gray-800 flex items-center justify-between">
                    <div className="text-xs text-gray-400 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>API Durumu: Aktif (Kişisel Pro Key)</span>
                    </div>

                    <div className="flex items-center gap-2">
                        {result && (
                            <button
                                onClick={handleRunOptimization}
                                disabled={isLoading}
                                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-purple-300 border border-purple-500/30 transition disabled:opacity-40"
                            >
                                🔄 Yeniden Analiz Et
                            </button>
                        )}

                        <button
                            onClick={handleApplyAllSwaps}
                            disabled={!result || validSwaps.length === 0}
                            className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-700/30 transition disabled:opacity-40"
                        >
                            🚀 Tümünü Uygula ({validSwaps.length} Uçak)
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default GeminiDeepThinkingModal;
