import React, { useState, useMemo } from 'react';
import { Flight, MaintenanceBlock } from '../types.ts';
import { 
    calculateDivertCapacity, 
    runWhatIfSimulation, 
    DivertDwellTimeHours, 
    WhatIfSimulationResult 
} from '../services/divert-capacity-engine.ts';

interface DivertCapacityModalProps {
    isOpen: boolean;
    onClose: () => void;
    flights: Flight[];
    maintenanceBlocks?: MaintenanceBlock[];
    startDate?: Date;
    endDate?: Date;
}

export const DivertCapacityModal: React.FC<DivertCapacityModalProps> = ({
    isOpen,
    onClose,
    flights,
    maintenanceBlocks = [],
    startDate
}) => {
    const [dwellHours, setDwellHours] = useState<DivertDwellTimeHours>(4);
    const [activeTab, setActiveTab] = useState<'MATRIX' | 'CONCOURSES' | 'HOURLY' | 'WHAT_IF' | 'STAND_LIST'>('MATRIX');
    
    // What-If Simulator Form States
    const [simCatC, setSimCatC] = useState<number>(4);
    const [simCatE, setSimCatE] = useState<number>(2);
    const [simCatF, setSimCatF] = useState<number>(0);
    const [simDelayHours, setSimDelayHours] = useState<number>(0);
    const [simDwellHours, setSimDwellHours] = useState<number>(4);
    const [simulationResult, setSimulationResult] = useState<WhatIfSimulationResult | null>(null);

    // Stand List filter
    const [standFilterCategory, setStandFilterCategory] = useState<'ALL' | 'C' | 'E' | 'F'>('ALL');
    const [standFilterZone, setStandFilterZone] = useState<'ALL' | 'BRIDGE' | 'REMOTE' | 'CARGO' | 'DEICING'>('ALL');
    const [standSearch, setStandSearch] = useState<string>('');

    // Copy Notification
    const [copySuccess, setCopySuccess] = useState(false);

    // Reference time: use startDate or current time
    const referenceTime = useMemo(() => {
        if (startDate && !isNaN(startDate.getTime())) {
            return new Date(startDate);
        }
        return new Date();
    }, [startDate]);

    // Calculate Divert Capacity Report
    const report = useMemo(() => {
        if (!isOpen) return null;
        return calculateDivertCapacity(flights, maintenanceBlocks, {
            referenceTime,
            dwellTimeHours: dwellHours
        });
    }, [isOpen, flights, maintenanceBlocks, referenceTime, dwellHours]);

    if (!isOpen || !report) return null;

    const handleRunSimulation = () => {
        const result = runWhatIfSimulation(
            flights,
            maintenanceBlocks,
            {
                catCCount: simCatC,
                catECount: simCatE,
                catFCount: simCatF,
                inboundDelayHours: simDelayHours,
                dwellTimeHours: simDwellHours
            },
            referenceTime
        );
        setSimulationResult(result);
    };

    const handleCopyReport = () => {
        if (!report) return;
        navigator.clipboard.writeText(report.generatedReportText).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2500);
        });
    };

    const w4 = report.windows[4];
    const w8 = report.windows[8];
    const w12 = report.windows[12];
    const w24 = report.windows[24];

    // Filter available stands for Stand List Tab
    const filteredStands = report.allStandsSnapshot.filter(s => {
        if (standFilterCategory !== 'ALL' && s.maxCategory !== standFilterCategory) return false;
        if (standFilterZone === 'BRIDGE' && !s.isBridge) return false;
        if (standFilterZone === 'REMOTE' && (s.isBridge || s.concourse.includes('CARGO') || s.concourse.includes('DEICING'))) return false;
        if (standFilterZone === 'CARGO' && !s.concourse.includes('CARGO')) return false;
        if (standFilterZone === 'DEICING' && !s.concourse.includes('DEICING')) return false;
        if (standSearch.trim()) {
            const query = standSearch.trim().toUpperCase();
            return s.stand.toUpperCase().includes(query) || s.concourse.toUpperCase().includes(query);
        }
        return true;
    });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
            <div className="bg-[#121721] border border-cyan-500/40 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl shadow-cyan-950/50 text-gray-100 overflow-hidden">
                
                {/* 1. Header Bar */}
                <div className="px-6 py-4 bg-gradient-to-r from-cyan-950/80 via-gray-900 to-indigo-950/80 border-b border-cyan-500/30 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-cyan-500/20 rounded-xl border border-cyan-400/50 text-cyan-300 shadow-md">
                            <span className="text-xl">🚨</span>
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-black text-white tracking-wide">
                                    Dinamik Divert & Apron Kapasite Modülü (DAC-Engine)
                                </h2>
                                <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 text-[10px] font-black uppercase tracking-wider">
                                    Kriz Karar Destek
                                </span>
                                {w4.poolDemand.totalUnassigned > 0 && (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40 text-[10px] font-bold">
                                        ⚠️ Havuzda {w4.poolDemand.totalUnassigned} Tarifeli Uçak Var (Düşüldü)
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-gray-400">
                                Çevre meydan kapalılıklarında T+4, T+8, T+12 saatlik net boş stant, Max WB/NB ve Concourse kırılımları
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <button
                            onClick={handleCopyReport}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition duration-200 border shadow ${
                                copySuccess 
                                    ? 'bg-emerald-600 border-emerald-400 text-white' 
                                    : 'bg-gray-800 hover:bg-gray-750 text-cyan-300 border-cyan-500/40 hover:text-white'
                            }`}
                            title="Hazır kriz kapasite raporunu panoya kopyala (OCC/IT için)"
                        >
                            <span>{copySuccess ? '✓ Kopyalandı' : '📋 Raporu Kopyala (OCC/IT)'}</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition text-sm"
                            title="Kapat"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* 2. Parameters & Sliding Dwell Time Bar */}
                <div className="px-6 py-2.5 bg-gray-900/90 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400 font-semibold">📅 Referans Zaman:</span>
                            <span className="font-mono bg-gray-800 px-2 py-1 rounded text-cyan-300 font-bold border border-gray-700">
                                {report.referenceTime.toLocaleDateString('tr-TR')} {report.referenceTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>

                        {/* Havuz Durumu Bilgisi */}
                        <div className="flex items-center gap-1.5 bg-gray-950/80 px-2.5 py-1 rounded-lg border border-gray-800 text-[11px]">
                            <span className="text-amber-400 font-bold">🏊‍♂️ Atama Bekleyen Havuz:</span>
                            <span className="text-white font-extrabold">{w4.poolDemand.totalUnassigned} Uçuş</span>
                            <span className="text-gray-400">({w4.poolDemand.catCCount} Dar / {w4.poolDemand.catECount} Geniş)</span>
                        </div>
                    </div>

                    {/* Dwell Time Selector */}
                    <div className="flex items-center gap-2">
                        <span className="text-gray-400 font-semibold">⏱️ Beklenen Yerde Kalış (Dwell Time):</span>
                        <div className="flex items-center bg-gray-950 p-0.5 rounded-lg border border-gray-800">
                            {([2, 4, 8, 12] as DivertDwellTimeHours[]).map(hours => (
                                <button
                                    key={hours}
                                    onClick={() => setDwellHours(hours)}
                                    className={`px-2.5 py-1 rounded-md font-bold text-xs transition select-none ${
                                        dwellHours === hours
                                            ? 'bg-cyan-600 text-white shadow-sm'
                                            : 'text-gray-400 hover:text-gray-200'
                                    }`}
                                >
                                    {hours} Saat
                                    {hours === 2 && ' (Yakıt)'}
                                    {hours === 8 && ' (Yatı)'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 3. Top KPI Cards: T+4, T+8, T+12, T+24 (With Gross, Pool Deduction, and NET Divert Capacity) */}
                <div className="px-6 py-3.5 grid grid-cols-1 md:grid-cols-4 gap-3 bg-gray-950/40 border-b border-gray-800">
                    {[w4, w8, w12, w24].map((w, idx) => {
                        const isCritical = w.netDivertCatC + w.netDivertCatE < 5;
                        const isModerate = w.netDivertCatC + w.netDivertCatE < 15;
                        const badgeColor = isCritical 
                            ? 'text-red-400 border-red-500/40 bg-red-950/40' 
                            : isModerate 
                            ? 'text-amber-300 border-amber-500/40 bg-amber-950/40' 
                            : 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40';

                        return (
                            <div key={w.windowHours} className={`p-3 rounded-xl border bg-gray-900/80 shadow-md ${idx === 0 ? 'ring-1 ring-cyan-500/40' : ''}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-black text-xs text-cyan-300 uppercase tracking-wider">
                                        {w.windowLabel}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold border ${badgeColor}`}>
                                        {isCritical ? '🔴 DOYGUN' : isModerate ? '🟡 ORTA' : '🟢 MÜSAİT'}
                                    </span>
                                </div>

                                {/* NET DİVERT KABULÜ */}
                                <div className="space-y-1.5 text-xs">
                                    <div className="flex justify-between items-baseline bg-gray-950/60 px-2 py-1 rounded border border-gray-800">
                                        <span className="text-emerald-400 font-bold">NET Max NB (Dar):</span>
                                        <span className="font-mono font-black text-sm text-emerald-300">
                                            {w.netDivertCatC} <span className="text-[10px] text-gray-500 font-normal">uçak</span>
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-baseline bg-gray-950/60 px-2 py-1 rounded border border-gray-800">
                                        <span className="text-amber-400 font-bold">NET Max WB (Geniş):</span>
                                        <span className="font-mono font-black text-sm text-amber-300">
                                            {w.netDivertCatE} <span className="text-[10px] text-gray-500 font-normal">uçak</span>
                                        </span>
                                    </div>

                                    {/* Stand Type Breakdown (Standalone vs MARS) */}
                                    <div className="pt-1.5 border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-400">
                                        <span title="Dar gövde kapasitesini öldürmeyen bağımsız geniş gövde stantları">
                                            🛡️ Standalone WB: <strong className="text-white">{w.standaloneFreeCatE}</strong>
                                        </span>
                                        <span title="L ve R alt stantları olan MARS Center geniş gövde stantları">
                                            ⚖️ MARS WB: <strong className="text-white">{w.marsFreeCatE}</strong>
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] text-gray-500">
                                        <span>Brüt Boş: {w.grossCatCCount + w.grossCatECount} Stand</span>
                                        <span>Tarifeli Havuz: -{w.poolDemand.totalUnassigned} Uçak</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 4. Navigation Tabs */}
                <div className="px-6 border-b border-gray-800 flex items-center space-x-2 bg-gray-900/60">
                    <button
                        onClick={() => setActiveTab('MATRIX')}
                        className={`py-2.5 px-3 font-bold text-xs border-b-2 transition select-none flex items-center gap-1.5 ${
                            activeTab === 'MATRIX'
                                ? 'border-cyan-400 text-cyan-300'
                                : 'border-transparent text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        <span>📊 Kapasite Matrisi & Max Senaryolar</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('CONCOURSES')}
                        className={`py-2.5 px-3 font-bold text-xs border-b-2 transition select-none flex items-center gap-1.5 ${
                            activeTab === 'CONCOURSES'
                                ? 'border-cyan-400 text-cyan-300'
                                : 'border-transparent text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        <span>📍 Apron & Concourse Dağılımı ({w4.concourseBreakdown.length})</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('HOURLY')}
                        className={`py-2.5 px-3 font-bold text-xs border-b-2 transition select-none flex items-center gap-1.5 ${
                            activeTab === 'HOURLY'
                                ? 'border-cyan-400 text-cyan-300'
                                : 'border-transparent text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        <span>📈 Saatlik Doluluk Profili (12 Saat)</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('WHAT_IF')}
                        className={`py-2.5 px-3 font-bold text-xs border-b-2 transition select-none flex items-center gap-1.5 ${
                            activeTab === 'WHAT_IF'
                                ? 'border-cyan-400 text-cyan-300'
                                : 'border-transparent text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        <span>🧪 "What-If" Divert Simülatörü</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('STAND_LIST')}
                        className={`py-2.5 px-3 font-bold text-xs border-b-2 transition select-none flex items-center gap-1.5 ${
                            activeTab === 'STAND_LIST'
                                ? 'border-cyan-400 text-cyan-300'
                                : 'border-transparent text-gray-400 hover:text-gray-200'
                        }`}
                    >
                        <span>🅿️ Müsait Stand Listesi ({filteredStands.length})</span>
                    </button>
                </div>

                {/* 5. Tab Content Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-4">
                    
                    {/* TAB 1: MATRIX & MAX TRADEOFF SCENARIOS */}
                    {activeTab === 'MATRIX' && (
                        <div className="space-y-4">
                            {/* Havuz Etkisi Açıklama Kartı */}
                            <div className="bg-gradient-to-r from-amber-950/40 via-gray-900 to-amber-950/20 border border-amber-500/40 rounded-xl p-4 flex items-start gap-3">
                                <span className="text-xl">💡</span>
                                <div className="text-xs space-y-1">
                                    <div className="font-bold text-amber-300 text-sm">
                                        Atama Bekleyen Havuzundaki Tarifeli Uçaklar ve Gerçek Net Kapasite
                                    </div>
                                    <p className="text-gray-300 leading-relaxed">
                                        Meydanda fiziksel olarak boş stand bulunsa bile, <strong>atama bekleyen havuzunda henüz stant verilmemiş {w4.poolDemand.totalUnassigned} adet tarifeli uçuş</strong> bulunmaktadır ({w4.poolDemand.catCCount} Dar Gövde, {w4.poolDemand.catECount} Geniş Gövde). 
                                        Sistem bu uçakları öncelikli rezerve ederek havayollarına <strong>yanıltıcı kapasite vermez</strong>; brüt boşluktan havuz ihtiyacını düşerek <strong>GERÇEK NET DİVERT KABUL SAYISINI</strong> hesaplar.
                                    </p>
                                </div>
                            </div>

                            {/* Max WB vs Max NB vs Standalone / MARS Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                                {/* Max NB Card */}
                                <div className="bg-gray-900/80 border border-emerald-500/40 rounded-xl p-4 shadow">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-black text-emerald-300 uppercase tracking-wider">
                                            ✈️ MAX DAR GÖVDE (NB) SENARYOSU
                                        </span>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-400/30 font-bold">
                                            A320 / B738
                                        </span>
                                    </div>
                                    <div className="text-2xl font-black text-white font-mono mb-2">
                                        {w4.netDivertCatC} <span className="text-xs font-normal text-emerald-400">Net Uçak</span>
                                    </div>
                                    <p className="text-[11px] text-gray-400 leading-normal">
                                        Tüm MARS stantları (L ve R) dar gövdeye ayrılırsa ve havuzdaki {w4.poolDemand.catCCount} dar gövde planlandıktan sonra kabul edilebilecek <strong>azami Cat C divert</strong> sayısıdır.
                                    </p>
                                    <div className="mt-3 pt-2 border-t border-gray-800 text-[11px] text-gray-400 flex justify-between">
                                        <span>Brüt Boş: {w4.maxNarrowBodyCapacity} Stand</span>
                                        <span>Havuz: -{w4.poolDemand.catCCount} Uçak</span>
                                    </div>
                                </div>

                                {/* Max WB Card */}
                                <div className="bg-gray-900/80 border border-amber-500/40 rounded-xl p-4 shadow">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-black text-amber-300 uppercase tracking-wider">
                                            🛫 MAX GENİŞ GÖVDE (WB) SENARYOSU
                                        </span>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-400/30 font-bold">
                                            A330 / B777 / A350
                                        </span>
                                    </div>
                                    <div className="text-2xl font-black text-white font-mono mb-2">
                                        {w4.netDivertCatE} <span className="text-xs font-normal text-amber-400">Net Uçak</span>
                                    </div>
                                    <p className="text-[11px] text-gray-400 leading-normal">
                                        Hem Standalone hem de tüm MARS Center pozisyonları geniş gövdeye ayrılırsa (L/R alt stantları kilitlenir) kabul edilebilecek <strong>azami Cat E divert</strong> sayısıdır.
                                    </p>
                                    <div className="mt-3 pt-2 border-t border-gray-800 text-[11px] text-gray-400 flex justify-between">
                                        <span>Brüt Boş: {w4.maxWideBodyCapacity} Stand</span>
                                        <span>Havuz: -{w4.poolDemand.catECount} Uçak</span>
                                    </div>
                                </div>

                                {/* Standalone vs MARS Breakdown */}
                                <div className="bg-gray-900/80 border border-cyan-500/40 rounded-xl p-4 shadow">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-black text-cyan-300 uppercase tracking-wider">
                                            🛡️ STANDALONE vs MARS (T+4h)
                                        </span>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-400/30 font-bold">
                                            Stant Tipi
                                        </span>
                                    </div>
                                    <div className="space-y-2 mt-2 text-xs">
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-gray-300 font-semibold">Standalone WB (Saf):</span>
                                            <span className="font-mono font-black text-white text-base">{w4.standaloneFreeCatE} Stand</span>
                                        </div>
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-gray-300 font-semibold">MARS Center WB:</span>
                                            <span className="font-mono font-black text-amber-300 text-base">{w4.marsFreeCatE} Stand</span>
                                        </div>
                                        <div className="flex justify-between items-baseline">
                                            <span className="text-gray-300 font-semibold">MARS Alt Stand (L/R):</span>
                                            <span className="font-mono font-black text-cyan-300 text-base">{w4.marsFreeSubStands} Stand</span>
                                        </div>
                                    </div>
                                    <p className="mt-2 text-[10px] text-gray-500">
                                        * Standalone stantlar doldurulursa dar gövde kapasitesi feda edilmez.
                                    </p>
                                </div>
                            </div>

                            {/* 4 Saat, 8 Saat, 12 Saat Standalone vs MARS Karşılaştırma Tablosu */}
                            <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-4">
                                <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-3 flex items-center justify-between">
                                    <span>⏱️ 4 Saat / 8 Saat / 12 Saat / 24 Saat Karakteristik Kapasite Matrisi</span>
                                    <span className="text-[11px] text-gray-400 font-normal">Dwell Time: {dwellHours} Saat</span>
                                </h4>
                                <table className="w-full text-xs text-left">
                                    <thead className="text-[11px] text-gray-400 border-b border-gray-800 bg-gray-950/40">
                                        <tr>
                                            <th className="py-2.5 px-3">Zaman Penceresi</th>
                                            <th className="py-2.5 px-3">NET Max NB (Dar)</th>
                                            <th className="py-2.5 px-3">NET Max WB (Geniş)</th>
                                            <th className="py-2.5 px-3">Standalone WB Boş</th>
                                            <th className="py-2.5 px-3">MARS Center WB Boş</th>
                                            <th className="py-2.5 px-3">Tarifeli Havuz</th>
                                            <th className="py-2.5 px-3">Bölgesel (Körük / Açık)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800">
                                        {[w4, w8, w12, w24].map(w => (
                                            <tr key={w.windowHours} className="hover:bg-gray-800/40 transition">
                                                <td className="py-3 px-3 font-bold text-white font-mono">{w.windowLabel}</td>
                                                <td className="py-3 px-3 font-mono font-bold text-emerald-400 text-sm">{w.netDivertCatC} Uçak</td>
                                                <td className="py-3 px-3 font-mono font-bold text-amber-300 text-sm">{w.netDivertCatE} Uçak</td>
                                                <td className="py-3 px-3 font-mono font-semibold text-white">{w.standaloneFreeCatE} Stand</td>
                                                <td className="py-3 px-3 font-mono font-semibold text-amber-200">{w.marsFreeCatE} Stand</td>
                                                <td className="py-3 px-3 text-gray-400 font-mono">
                                                    {w.poolDemand.totalUnassigned > 0 ? `-${w.poolDemand.totalUnassigned} Uçak` : '0 (Tam Planlı)'}
                                                </td>
                                                <td className="py-3 px-3 text-gray-400 text-[11px]">
                                                    🌉 {w.bridgeStandCount} Körük | 🚌 {w.remoteStandCount} Açık
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* TAB 2: CONCOURSE / APRON LEVEL DETAILED BREAKDOWN (Apron 100, 200, Concourse A..G) */}
                    {activeTab === 'CONCOURSES' && (
                        <div className="space-y-4">
                            <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-4">
                                <h3 className="text-sm font-bold text-white mb-1 flex items-center justify-between">
                                    <span>📍 Apron & Concourse Bazında Boşluk Dağılımı (T+4 Saat)</span>
                                    <span className="text-xs text-gray-400 font-normal">
                                        Toplam {w4.concourseBreakdown.length} bölgede fiziksel boşluk tespit edildi
                                    </span>
                                </h3>
                                <p className="text-xs text-gray-400">
                                    Hangi apronda kaç dar gövde, kaç geniş gövde ve kaç standalone pozisyon olduğunu anlık olarak görebilirsiniz.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                                {w4.concourseBreakdown.map(c => {
                                    const isApronRemote = c.concourse.includes('APRON');
                                    const isCargo = c.concourse.includes('CARGO');
                                    const isDeicing = c.concourse.includes('DEICING');
                                    const borderCol = isCargo ? 'border-amber-500/40' : isDeicing ? 'border-blue-500/40' : isApronRemote ? 'border-emerald-500/40' : 'border-cyan-500/40';

                                    return (
                                        <div key={c.concourse} className={`bg-gray-900/90 border ${borderCol} rounded-xl p-3.5 shadow-md flex flex-col justify-between`}>
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="font-black text-sm text-white">{c.label}</span>
                                                    <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 font-semibold text-gray-300">
                                                        Toplam {c.totalStands} Stand
                                                    </span>
                                                </div>

                                                <div className="space-y-2 text-xs">
                                                    <div className="flex justify-between items-baseline bg-gray-950/60 px-2.5 py-1.5 rounded border border-gray-800">
                                                        <span className="text-cyan-300 font-bold">Dar Gövde (Cat C):</span>
                                                        <span className="font-mono font-black text-sm text-white">
                                                            {c.grossFreeCatC} <span className="text-[10px] text-gray-400 font-normal">stand</span>
                                                        </span>
                                                    </div>

                                                    <div className="flex justify-between items-baseline bg-gray-950/60 px-2.5 py-1.5 rounded border border-gray-800">
                                                        <span className="text-amber-400 font-bold">Geniş Gövde (Cat E):</span>
                                                        <span className="font-mono font-black text-sm text-amber-300">
                                                            {c.grossFreeCatE} <span className="text-[10px] text-gray-400 font-normal">stand</span>
                                                        </span>
                                                    </div>

                                                    {c.grossFreeCatF > 0 && (
                                                        <div className="flex justify-between items-baseline bg-gray-950/60 px-2.5 py-1 rounded border border-purple-800/40">
                                                            <span className="text-purple-300 font-bold">Heavy (Cat F / A380):</span>
                                                            <span className="font-mono font-black text-xs text-purple-200">{c.grossFreeCatF} stand</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="mt-3 pt-2 border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-400">
                                                <span>🛡️ Standalone: <strong className="text-white">{c.standaloneFreeCatE}</strong></span>
                                                <span>⚖️ MARS: <strong className="text-amber-300">{c.marsFreeCatE}</strong></span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* TAB 3: HOURLY PROFILE HEATMAP */}
                    {activeTab === 'HOURLY' && (
                        <div className="space-y-4">
                            <div className="bg-gray-900/80 border border-gray-800 rounded-xl p-4">
                                <h3 className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-3">
                                    🕒 12 Saatlik Dinamik Boş Stand Profili (Standalone ve MARS Ayrımıyla)
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                                    {report.hourlyProfile.map(pt => {
                                        const cardBg = pt.status === 'CRITICAL' ? 'bg-red-950/40 border-red-500/40' : pt.status === 'MODERATE' ? 'bg-amber-950/40 border-amber-500/40' : 'bg-emerald-950/40 border-emerald-500/40';
                                        const textCol = pt.status === 'CRITICAL' ? 'text-red-300' : pt.status === 'MODERATE' ? 'text-amber-300' : 'text-emerald-300';

                                        return (
                                            <div key={pt.hourOffset} className={`p-2.5 rounded-lg border ${cardBg}`}>
                                                <div className="flex justify-between items-center text-[11px] mb-1">
                                                    <span className="font-bold text-gray-300">T+{pt.hourOffset}h</span>
                                                    <span className="font-mono text-gray-400">
                                                        {pt.time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <div className={`text-base font-black ${textCol}`}>
                                                    {pt.totalFreeStands} <span className="text-[10px] font-normal text-gray-400">Boş</span>
                                                </div>
                                                <div className="mt-1 text-[10px] text-gray-400 flex justify-between">
                                                    <span>C: {pt.freeCatC}</span>
                                                    <span>E: {pt.freeCatE}</span>
                                                    <span>F: {pt.freeCatF}</span>
                                                </div>
                                                <div className="mt-1 pt-1 border-t border-gray-800/80 text-[9px] text-gray-400 flex justify-between">
                                                    <span>🛡️ Standalone: {pt.standaloneFreeCatE}</span>
                                                    <span>⚖️ MARS: {pt.marsFreeCatE}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB 4: WHAT-IF SCENARIO SIMULATOR */}
                    {activeTab === 'WHAT_IF' && (
                        <div className="space-y-4">
                            <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-4">
                                <h3 className="text-sm font-bold text-white mb-2">
                                    🧪 Divert Senaryo Testi ("What-If" Analysis)
                                </h3>
                                <p className="text-xs text-gray-400 mb-4">
                                    Havayolu veya kriz masasından gelen divert talebini girin; motor anlık olarak mevcut planı tarar, standalone pozisyonları önceliklendirir ve tarifeli planı bozmadan yer bulunup bulunamayacağını test eder.
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-300 mb-1">
                                            Cat C (Dar Gövde)
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="50"
                                            value={simCatC}
                                            onChange={e => setSimCatC(parseInt(e.target.value) || 0)}
                                            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-300 mb-1">
                                            Cat D/E (Geniş Gövde)
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="30"
                                            value={simCatE}
                                            onChange={e => setSimCatE(parseInt(e.target.value) || 0)}
                                            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-300 mb-1">
                                            Cat F (Heavy)
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="10"
                                            value={simCatF}
                                            onChange={e => setSimCatF(parseInt(e.target.value) || 0)}
                                            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-300 mb-1">
                                            Varış Gecikmesi
                                        </label>
                                        <select
                                            value={simDelayHours}
                                            onChange={e => setSimDelayHours(parseInt(e.target.value))}
                                            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                                        >
                                            <option value={0}>Şimdi (0 Saat)</option>
                                            <option value={1}>1 Saat Sonra</option>
                                            <option value={2}>2 Saat Sonra</option>
                                            <option value={4}>4 Saat Sonra</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-gray-300 mb-1">
                                            Kalış Süresi
                                        </label>
                                        <select
                                            value={simDwellHours}
                                            onChange={e => setSimDwellHours(parseInt(e.target.value))}
                                            className="w-full bg-gray-950 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
                                        >
                                            <option value={2}>2 Saat (Yakıt / Quick)</option>
                                            <option value={4}>4 Saat (Standart)</option>
                                            <option value={8}>8 Saat (Ekip Mesai / Yatı)</option>
                                            <option value={12}>12 Saat (Gece Yatı)</option>
                                        </select>
                                    </div>
                                </div>

                                <button
                                    onClick={handleRunSimulation}
                                    className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-lg text-xs shadow-md transition duration-200 flex items-center gap-2"
                                >
                                    <span>🚀 Divert Senaryosunu Simüle Et</span>
                                </button>
                            </div>

                            {/* Simulation Results View */}
                            {simulationResult && (
                                <div className={`p-4 rounded-xl border ${
                                    simulationResult.verdict === 'APPROVED'
                                        ? 'bg-emerald-950/40 border-emerald-500/50'
                                        : simulationResult.verdict === 'PARTIAL'
                                        ? 'bg-amber-950/40 border-amber-500/50'
                                        : 'bg-red-950/40 border-red-500/50'
                                }`}>
                                    <div className="flex items-center gap-2 font-bold text-sm mb-2">
                                        <span>{simulationResult.summaryMessage}</span>
                                    </div>

                                    {/* Proposed Stand Allocations Table */}
                                    {simulationResult.proposedAllocations.length > 0 && (
                                        <div className="mt-3">
                                            <h4 className="text-xs font-bold text-gray-200 mb-2">
                                                📋 Önerilen Divert Stand Atamaları ({simulationResult.proposedAllocations.length} Uçak):
                                            </h4>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                                {simulationResult.proposedAllocations.map((alloc, idx) => (
                                                    <div key={idx} className="bg-gray-900/90 border border-gray-700/80 rounded-lg p-2.5 text-xs">
                                                        <div className="flex justify-between items-center font-bold">
                                                            <span className="text-cyan-300">{alloc.flightCallsign}</span>
                                                            <span className={`px-1.5 py-0.2 rounded text-[10px] ${
                                                                alloc.category === 'E' ? 'bg-amber-900 text-amber-200' : alloc.category === 'F' ? 'bg-purple-900 text-purple-200' : 'bg-blue-900 text-blue-200'
                                                            }`}>
                                                                Cat {alloc.category}
                                                            </span>
                                                        </div>
                                                        <div className="mt-1 flex justify-between text-gray-400 text-[11px]">
                                                            <span>Stand: <strong className="text-white">{alloc.stand}</strong></span>
                                                            <span>{alloc.isBridge ? '🌉 Pier' : '🚌 Remote'}</span>
                                                        </div>
                                                        <div className="text-[10px] text-gray-400 mt-0.5 flex justify-between">
                                                            <span className="truncate">{alloc.concourse}</span>
                                                            {alloc.isStandalone && (
                                                                <span className="text-emerald-400 font-bold">🛡️ Standalone</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Bottlenecks / Unaccommodated */}
                                    {simulationResult.unaccommodatedFlights.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-red-500/30 text-xs text-red-300">
                                            <strong>⚠️ Yer Bulunamayan Uçuşlar: </strong> 
                                            {simulationResult.unaccommodatedFlights.join(', ')}
                                            {simulationResult.bottleneckNotes.map((note, idx) => (
                                                <p key={idx} className="text-[11px] text-red-400 mt-0.5">• {note}</p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 5: AVAILABLE STAND DIRECTORY */}
                    {activeTab === 'STAND_LIST' && (
                        <div className="space-y-3">
                            {/* Filter Bar */}
                            <div className="flex flex-wrap items-center justify-between gap-2 bg-gray-900/80 p-3 rounded-xl border border-gray-800 text-xs">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        placeholder="Stand veya apron ara (örn. 215, Concourse B)..."
                                        value={standSearch}
                                        onChange={e => setStandSearch(e.target.value)}
                                        className="bg-gray-950 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none w-64 focus:border-cyan-500"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={standFilterCategory}
                                        onChange={e => setStandFilterCategory(e.target.value as any)}
                                        className="bg-gray-950 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                                    >
                                        <option value="ALL">Tüm Kategoriler (C, E, F)</option>
                                        <option value="C">Yalnızca Cat C (Dar Gövde)</option>
                                        <option value="E">Yalnızca Cat D/E (Geniş Gövde)</option>
                                        <option value="F">Yalnızca Cat F (Heavy / A380)</option>
                                    </select>
                                    <select
                                        value={standFilterZone}
                                        onChange={e => setStandFilterZone(e.target.value as any)}
                                        className="bg-gray-950 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                                    >
                                        <option value="ALL">Tüm Bölgeler</option>
                                        <option value="BRIDGE">🌉 Sadece Pier Köprülü</option>
                                        <option value="REMOTE">🚌 Sadece Açık Apron</option>
                                        <option value="CARGO">📦 Sadece Kargo</option>
                                        <option value="DEICING">❄️ Sadece De-icing</option>
                                    </select>
                                </div>
                            </div>

                            {/* Stand Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                {filteredStands.slice(0, 72).map(s => (
                                    <div key={s.stand} className="bg-gray-900/80 border border-gray-800 rounded-lg p-2 text-xs hover:border-cyan-500/50 transition">
                                        <div className="flex justify-between items-center font-bold">
                                            <span className="text-white text-sm">{s.stand}</span>
                                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-black ${
                                                s.maxCategory === 'F' ? 'bg-purple-900 text-purple-200' : s.maxCategory === 'E' ? 'bg-amber-900 text-amber-200' : 'bg-blue-900 text-blue-200'
                                            }`}>
                                                Cat {s.maxCategory}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-gray-400 mt-1 truncate">
                                            {s.concourse}
                                        </div>
                                        <div className="mt-1 flex items-center justify-between text-[10px] text-gray-500">
                                            <span>{s.isBridge ? '🌉 Pier' : '🚌 Remote'}</span>
                                            {s.isStandaloneWidebody && (
                                                <span className="text-emerald-400 font-bold">Standalone</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {filteredStands.length > 72 && (
                                <p className="text-center text-xs text-gray-500">
                                    Toplam {filteredStands.length} uygun stand bulundu. (İlk 72 gösteriliyor)
                                </p>
                            )}
                        </div>
                    )}

                </div>

                {/* 6. Footer */}
                <div className="px-6 py-3 bg-gray-950 border-t border-gray-800 flex items-center justify-between text-xs text-gray-400">
                    <div className="flex items-center gap-2">
                        <span className="text-cyan-400 font-bold">💡 Operasyonel Kural:</span>
                        <span>Divert geniş gövdeleri MARS Center yerine Standalone stantlara vererek dar gövde kapasitesini koruyun.</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-gray-800 hover:bg-gray-750 text-white font-bold rounded-lg transition"
                    >
                        Kapat
                    </button>
                </div>

            </div>
        </div>
    );
};

export default DivertCapacityModal;
