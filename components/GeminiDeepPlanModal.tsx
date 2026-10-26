import React, { useState, useMemo } from 'react';
import { Flight, MaintenanceBlock } from '../types.ts';
import {
    runAutonomousDeepPlanning,
    DeepPlanProgress,
    DeepPlanResult
} from '../services/gemini-full-planner.ts';
import {
    AVAILABLE_MODELS,
    getStoredModel,
    getStoredApiKey
} from '../services/gemini-api.ts';

interface GeminiDeepPlanModalProps {
    isOpen: boolean;
    onClose: () => void;
    flights: Flight[];
    currentStartDate: Date;
    currentEndDate: Date;
    maintenanceBlocks?: MaintenanceBlock[];
    onApplyPlan: (updatedFlights: Flight[], summaryMessage: string) => void;
    onOpenApiKeyModal: () => void;
}

export const GeminiDeepPlanModal: React.FC<GeminiDeepPlanModalProps> = ({
    isOpen,
    onClose,
    flights,
    currentStartDate,
    currentEndDate,
    maintenanceBlocks,
    onApplyPlan,
    onOpenApiKeyModal
}) => {
    // Format helper YYYY-MM-DD
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    const [scopeStart, setScopeStart] = useState<string>(() => formatDate(currentStartDate));
    const [scopeEnd, setScopeEnd] = useState<string>(() => formatDate(currentEndDate));
    const [selectedModel, setSelectedModel] = useState<string>(() => getStoredModel());
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [progress, setProgress] = useState<DeepPlanProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [planResult, setPlanResult] = useState<DeepPlanResult | null>(null);

    // Min and Max dates in dataset
    const datasetBounds = useMemo(() => {
        if (flights.length === 0) return { min: new Date(), max: new Date() };
        let min = flights[0].scheduledArrival;
        let max = flights[0].scheduledDeparture;
        flights.forEach(f => {
            if (f.scheduledArrival < min) min = f.scheduledArrival;
            if (f.scheduledDeparture > max) max = f.scheduledDeparture;
        });
        return { min, max };
    }, [flights]);

    // Count flights in selected scope
    const flightsInScopeCount = useMemo(() => {
        const s = new Date(scopeStart + 'T00:00:00').getTime();
        const e = new Date(scopeEnd + 'T23:59:59').getTime();
        return flights.filter(f => {
            const arr = f.scheduledArrival.getTime();
            const dep = f.scheduledDeparture.getTime();
            return (arr >= s && arr <= e) || (dep >= s && dep <= e);
        }).length;
    }, [flights, scopeStart, scopeEnd]);

    if (!isOpen) return null;

    const apiKey = getStoredApiKey();

    const handleSelectCurrentView = () => {
        setScopeStart(formatDate(currentStartDate));
        setScopeEnd(formatDate(currentEndDate));
    };

    const handleSelectAllFlights = () => {
        setScopeStart(formatDate(datasetBounds.min));
        setScopeEnd(formatDate(datasetBounds.max));
    };

    const handleStartDeepPlan = async () => {
        if (!apiKey) {
            setError('Lütfen önce Gemini API anahtarınızı tanımlayın.');
            return;
        }

        setIsRunning(true);
        setError(null);
        setProgress(null);
        setPlanResult(null);

        const startDate = new Date(scopeStart + 'T00:00:00');
        const endDate = new Date(scopeEnd + 'T23:59:59');

        try {
            const result = await runAutonomousDeepPlanning(
                flights,
                startDate,
                endDate,
                maintenanceBlocks,
                selectedModel,
                (p) => setProgress(p)
            );

            setPlanResult(result);
            onApplyPlan(
                result.updatedFlights,
                `🧠 AI Derin Planlama Tamamlandı: %${result.stats.bridgeRate.toFixed(1)} Köprü Oranı (${result.stats.bridgeAssignedCount} Körük, ${result.totalAllocated} Uçuş Sıfırdan Planlandı).`
            );
        } catch (err: any) {
            setError(err.message || 'Derin planlama sırasında hata oluştu.');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[100] p-4 backdrop-blur-md animate-fade-in select-none">
            <div className="bg-gray-900 border border-purple-500/40 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden text-white">
                
                {/* Header */}
                <header className="p-4 bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 border-b border-purple-500/30 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-600 flex items-center justify-center text-xl shadow-lg shadow-purple-600/30 animate-pulse">
                            🧠
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-white tracking-wide">
                                    AI Derin Planla (Autonomous Schedulling)
                                </h2>
                                <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                    Sıfırdan Atama
                                </span>
                            </div>
                            <p className="text-xs text-purple-200/70">
                                Gemini modelleri ile seçilen tarih aralığındaki tüm uçuşları sıfırdan planlar.
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        disabled={isRunning}
                        className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition disabled:opacity-30"
                    >
                        ✕
                    </button>
                </header>

                {/* Body */}
                <div className="p-5 space-y-4 text-sm">
                    {/* API Key Warning if missing */}
                    {!apiKey && (
                        <div className="p-3 bg-amber-950/50 border border-amber-600/50 rounded-xl text-amber-200 text-xs flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span>⚠️</span>
                                <span>Gemini API anahtarınız henüz girilmemiş.</span>
                            </div>
                            <button
                                onClick={onOpenApiKeyModal}
                                className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-gray-950 font-bold rounded text-xs transition"
                            >
                                Key Tanımla ↗
                            </button>
                        </div>
                    )}

                    {/* Scope Selection Box */}
                    <div className="p-4 bg-gray-950/60 border border-gray-800 rounded-xl space-y-3">
                        <div className="flex justify-between items-center">
                            <label className="text-xs font-bold text-gray-300 uppercase tracking-wide">
                                🗓️ Planlama Tarih Aralığı
                            </label>
                            <div className="flex items-center gap-1.5 text-xs">
                                <button
                                    type="button"
                                    onClick={handleSelectCurrentView}
                                    className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-purple-300 text-[11px] font-semibold"
                                >
                                    Görüntülenen Gün
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSelectAllFlights}
                                    className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-indigo-300 text-[11px] font-semibold"
                                >
                                    Tüm Liste
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <span className="text-[11px] text-gray-400 block mb-1">Başlangıç Tarihi:</span>
                                <input
                                    type="date"
                                    value={scopeStart}
                                    disabled={isRunning}
                                    onChange={(e) => setScopeStart(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-purple-500"
                                />
                            </div>
                            <div>
                                <span className="text-[11px] text-gray-400 block mb-1">Bitiş Tarihi:</span>
                                <input
                                    type="date"
                                    value={scopeEnd}
                                    disabled={isRunning}
                                    onChange={(e) => setScopeEnd(e.target.value)}
                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-purple-500"
                                />
                            </div>
                        </div>

                        <div className="text-[11px] text-gray-400 flex justify-between items-center pt-1 border-t border-gray-800/80">
                            <span>Kapsama giren uçuş sayısı:</span>
                            <span className="font-bold text-purple-300">{flightsInScopeCount} Uçuş</span>
                        </div>
                    </div>

                    {/* Model Selector */}
                    <div>
                        <label className="block text-xs font-bold text-gray-300 uppercase tracking-wide mb-1.5">
                            ⚡ Akıl Yürütme Modeli
                        </label>
                        <select
                            value={selectedModel}
                            disabled={isRunning}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="w-full bg-gray-950 border border-gray-700 focus:border-purple-500 rounded-lg px-3 py-2 text-xs text-gray-200 outline-none transition"
                        >
                            {AVAILABLE_MODELS.map(m => (
                                <option key={m.id} value={m.id}>
                                    {m.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Error Banner */}
                    {error && (
                        <div className="p-3 bg-rose-950/50 border border-rose-600/50 rounded-xl text-rose-300 text-xs">
                            <span className="font-bold">Hata:</span> {error}
                        </div>
                    )}

                    {/* Live Progress Bar when Running */}
                    {isRunning && progress && (
                        <div className="p-4 bg-purple-950/30 border border-purple-500/40 rounded-xl space-y-2.5">
                            <div className="flex justify-between items-center text-xs font-semibold">
                                <span className="text-purple-300 flex items-center gap-1.5">
                                    <span className="animate-spin">⚙️</span>
                                    <span>Dalga {progress.currentWave} / {progress.totalWaves} ({progress.waveTimeRange})</span>
                                </span>
                                <span className="font-mono text-emerald-400 font-bold">%{progress.percent}</span>
                            </div>

                            {/* Progress bar */}
                            <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                                <div
                                    className="bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 h-full transition-all duration-300"
                                    style={{ width: `${progress.percent}%` }}
                                ></div>
                            </div>

                            <div className="flex justify-between items-center text-[11px] text-gray-300">
                                <span>{progress.currentMessage}</span>
                                <span className="font-mono text-indigo-300 font-semibold">
                                    Yerleştirilen: {progress.allocatedCount} / {progress.totalFlightsInScope}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Completed Result Summary */}
                    {planResult && !isRunning && (
                        <div className="p-4 bg-emerald-950/40 border border-emerald-600/50 rounded-xl space-y-2 text-xs">
                            <div className="flex items-center gap-2 font-bold text-emerald-300 text-sm">
                                <span>✅</span>
                                <span>Sıfırdan Derin Planlama Başarıyla Tamamlandı!</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-center">
                                <div className="p-2 bg-gray-900/80 rounded border border-emerald-800/40">
                                    <div className="text-[10px] text-gray-400">Yeni Köprü Oranı</div>
                                    <div className="text-base font-bold text-emerald-400">%{planResult.stats.bridgeRate.toFixed(1)}</div>
                                </div>
                                <div className="p-2 bg-gray-900/80 rounded border border-emerald-800/40">
                                    <div className="text-[10px] text-gray-400">Körükteki Uçaklar</div>
                                    <div className="text-base font-bold text-purple-300">
                                        {planResult.stats.bridgeAssignedCount} / {planResult.stats.eligibleFlightsCount}
                                    </div>
                                </div>
                                <div className="p-2 bg-gray-900/80 rounded border border-emerald-800/40">
                                    <div className="text-[10px] text-gray-400">Süre / Model</div>
                                    <div className="text-[11px] font-bold text-gray-200 mt-1">
                                        {(planResult.executionTimeMs / 1000).toFixed(1)}s
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <footer className="p-4 bg-gray-950/90 border-t border-gray-800 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isRunning}
                        className="px-4 py-2 rounded-xl text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-300 transition disabled:opacity-30"
                    >
                        {planResult ? 'Tamam' : 'Vazgeç'}
                    </button>

                    <button
                        type="button"
                        onClick={handleStartDeepPlan}
                        disabled={isRunning || flightsInScopeCount === 0 || !apiKey}
                        className="px-5 py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-600/30 transition transform hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isRunning ? (
                            <>
                                <span className="animate-spin">⚙️</span>
                                <span>Derin Planlama Yapılıyor...</span>
                            </>
                        ) : (
                            <>
                                <span>🚀</span>
                                <span>Sıfırdan Derin Planlamayı Başlat ({flightsInScopeCount} Uçuş)</span>
                            </>
                        )}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default GeminiDeepPlanModal;
