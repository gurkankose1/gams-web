import React, { useState, useMemo } from 'react';
import { Flight } from '../types.ts';
import { 
    CopilotOpportunity, 
    CopilotAnalysisResult, 
    runAiCopilotAnalysis, 
    applyCopilotOpportunity, 
    applyAllCopilotOpportunities 
} from '../services/ai-copilot.ts';

interface AiCopilotModalProps {
    isOpen: boolean;
    onClose: () => void;
    flights: Flight[];
    onApplyUpdates: (updatedFlights: Flight[], message: string) => void;
}

export const AiCopilotModal: React.FC<AiCopilotModalProps> = ({
    isOpen,
    onClose,
    flights,
    onApplyUpdates,
}) => {
    const [selectedTab, setSelectedTab] = useState<'ALL' | 'GAP' | 'CONSOLIDATION' | 'WIDEBODY'>('ALL');
    const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');

    // Run Co-Pilot Analysis on current flights
    const analysis: CopilotAnalysisResult = useMemo(() => {
        if (!isOpen) {
            return {
                stats: {
                    totalFlights: 0,
                    eligiblePaxCount: 0,
                    currentBridgeCount: 0,
                    currentRemoteCount: 0,
                    currentBridgeRate: 0,
                    currentRevenueEur: 0,
                    potentialBridgeCount: 0,
                    potentialBridgeRate: 0,
                    potentialRevenueEur: 0,
                    netGainFlights: 0,
                    netGainRevenueEur: 0
                },
                opportunities: [],
                executiveBriefing: ''
            };
        }
        return runAiCopilotAnalysis(flights);
    }, [flights, isOpen]);

    if (!isOpen) return null;

    const { stats, opportunities, executiveBriefing } = analysis;

    const activeOpportunities = opportunities.filter(o => !appliedIds.has(o.id));

    const filteredOpportunities = activeOpportunities.filter(o => {
        if (selectedTab === 'GAP' && o.type !== 'DIRECT_GAP_FILL') return false;
        if (selectedTab === 'CONSOLIDATION' && o.type !== 'NARROW_CONSOLIDATION') return false;
        if (selectedTab === 'WIDEBODY' && !o.isWideBody) return false;

        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            const matchCallsign = o.callsign.toLowerCase().includes(term);
            const matchAc = o.aircraftType.toLowerCase().includes(term);
            const matchCur = o.currentPosition.toLowerCase().includes(term);
            const matchTarget = o.targetPosition.toLowerCase().includes(term);
            return matchCallsign || matchAc || matchCur || matchTarget;
        }
        return true;
    });

    const handleApplySingle = (opp: CopilotOpportunity) => {
        const updated = applyCopilotOpportunity(flights, opp);
        setAppliedIds(prev => new Set(prev).add(opp.id));
        onApplyUpdates(
            updated,
            `💡 Co-Pilot: ${opp.callsign} uçağı ${opp.currentPosition} yerine ${opp.targetPosition} körüğüne alındı (+€${opp.revenueGainEur}).`
        );
    };

    const handleApplyAll = () => {
        if (activeOpportunities.length === 0) return;
        const updated = applyAllCopilotOpportunities(flights, activeOpportunities);
        const gainedCount = activeOpportunities.length;
        const gainedRev = activeOpportunities.reduce((sum, o) => sum + o.revenueGainEur, 0);

        setAppliedIds(new Set(opportunities.map(o => o.id)));
        onApplyUpdates(
            updated,
            `🚀 Co-Pilot Tümünü Uygula: +${gainedCount} uçak doğrudan körüğe bağlandı! (+€${gainedRev.toLocaleString('tr-TR')} KOİ köprü geliri)`
        );
        onClose();
    };

    const formatEur = (val: number) => `€${Math.round(val).toLocaleString('tr-TR')}`;

    return (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[96] p-4 backdrop-blur-md animate-fade-in select-none">
            <div className="bg-gray-900 border border-indigo-500/40 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden text-white">
                
                {/* Header */}
                <header className="p-4 bg-gradient-to-r from-indigo-950 via-slate-900 to-purple-950 border-b border-indigo-500/30 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-xl shadow-lg shadow-indigo-600/30">
                            🤖
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold bg-gradient-to-r from-indigo-300 via-purple-200 to-pink-300 bg-clip-text text-transparent">
                                    OCC Planlama AI Co-Pilot
                                </h2>
                                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                                    Sıfır Tow • Sıfır Token (Masaüstü Yerel Analiz)
                                </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                                Körük verimliliğini artıran anlık fırsat tespit motoru, dar/geniş gövde konsolidasyonu ve KOİ gelir simülasyonu
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

                {/* KPI Projections Ribbon */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 bg-gray-950/70 border-b border-gray-800">
                    {/* Current vs Target Rate */}
                    <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-3 flex flex-col justify-between">
                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                            📊 Körük Kullanım Oranı
                        </span>
                        <div className="flex items-baseline gap-2 my-1">
                            <span className="text-xl font-black text-gray-300">%{stats.currentBridgeRate.toFixed(1)}</span>
                            <span className="text-xs text-indigo-400 font-bold">➔</span>
                            <span className="text-2xl font-black text-emerald-400">%{stats.potentialBridgeRate.toFixed(1)}</span>
                        </div>
                        <div className="text-[10px] text-emerald-300/90 font-medium">
                            +%{ (stats.potentialBridgeRate - stats.currentBridgeRate).toFixed(1) } Net Artış Potansiyeli
                        </div>
                    </div>

                    {/* Flight Gain */}
                    <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-3 flex flex-col justify-between">
                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                            ✈️ Körüğe Alınabilir Uçuş
                        </span>
                        <div className="flex items-baseline gap-2 my-1">
                            <span className="text-2xl font-black text-cyan-300">+{activeOpportunities.length} Uçak</span>
                        </div>
                        <div className="text-[10px] text-gray-400">
                            Açıkta bekleyen ve körük boşluğuna sığabilen yolcu uçakları
                        </div>
                    </div>

                    {/* Revenue Gain */}
                    <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-3 flex flex-col justify-between">
                        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                            💰 Potansiyel Ek Gelir (KOİ)
                        </span>
                        <div className="flex items-baseline gap-2 my-1">
                            <span className="text-2xl font-black text-amber-400">+{formatEur(stats.netGainRevenueEur)}</span>
                        </div>
                        <div className="text-[10px] text-amber-300/80">
                            Sadece PBB, GPU, PCA, Su ve VDGS hizmetleri
                        </div>
                    </div>

                    {/* Quick Action Button */}
                    <div className="bg-gradient-to-br from-indigo-950/70 to-purple-950/70 border border-indigo-500/40 rounded-xl p-3 flex flex-col justify-between">
                        <div className="text-[11px] font-bold text-indigo-200">
                            ⚡ Hızlı Uygulama
                        </div>
                        <button
                            onClick={handleApplyAll}
                            disabled={activeOpportunities.length === 0}
                            className="w-full mt-2 py-2 px-3 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs rounded-lg shadow-lg shadow-emerald-700/40 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none flex items-center justify-center gap-1.5"
                        >
                            <span>✨</span>
                            Tümünü Tek Tıkla Uygula (+{activeOpportunities.length})
                        </button>
                    </div>
                </div>

                {/* Search & Filter Toolbar */}
                <div className="px-5 py-2.5 bg-gray-850 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setSelectedTab('ALL')}
                            className={`px-3 py-1.5 rounded-lg font-bold transition ${
                                selectedTab === 'ALL'
                                    ? 'bg-indigo-600 text-white shadow'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                            }`}
                        >
                            Tüm Fırsatlar ({activeOpportunities.length})
                        </button>
                        <button
                            onClick={() => setSelectedTab('GAP')}
                            className={`px-3 py-1.5 rounded-lg font-bold transition ${
                                selectedTab === 'GAP'
                                    ? 'bg-indigo-600 text-white shadow'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                            }`}
                        >
                            Boşluk Doldurma ({activeOpportunities.filter(o => o.type === 'DIRECT_GAP_FILL').length})
                        </button>
                        <button
                            onClick={() => setSelectedTab('CONSOLIDATION')}
                            className={`px-3 py-1.5 rounded-lg font-bold transition ${
                                selectedTab === 'CONSOLIDATION'
                                    ? 'bg-indigo-600 text-white shadow'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                            }`}
                        >
                            Akıllı Konsolidasyon ({activeOpportunities.filter(o => o.type === 'NARROW_CONSOLIDATION').length})
                        </button>
                        <button
                            onClick={() => setSelectedTab('WIDEBODY')}
                            className={`px-3 py-1.5 rounded-lg font-bold transition ${
                                selectedTab === 'WIDEBODY'
                                    ? 'bg-indigo-600 text-white shadow'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                            }`}
                        >
                            Geniş Gövdeler ({activeOpportunities.filter(o => o.isWideBody).length})
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="Uçuş no, tip veya stand ara..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 w-52"
                        />
                    </div>
                </div>

                {/* Briefing Text Bar */}
                <div className="px-5 py-2 bg-indigo-950/30 border-b border-indigo-900/30 text-[11px] text-indigo-200/90 flex items-center gap-2">
                    <span className="text-indigo-400 font-bold">📢 OCC Durum Notu:</span>
                    <span>{executiveBriefing}</span>
                </div>

                {/* Opportunity List */}
                <main className="p-5 flex-grow overflow-y-auto space-y-3 bg-gray-900/50">
                    {filteredOpportunities.length === 0 ? (
                        <div className="text-center py-16 text-gray-500 text-sm">
                            <span className="text-3xl block mb-2">🎉</span>
                            {activeOpportunities.length === 0 
                                ? 'Tüm uygun fırsatlar uygulandı! Körük kullanım oranı zirve seviyede.'
                                : 'Seçilen filtrelere uygun fırsat bulunamadı.'}
                        </div>
                    ) : (
                        filteredOpportunities.map(opp => (
                            <div 
                                key={opp.id} 
                                className="bg-gray-850/90 border border-gray-750 hover:border-indigo-500/50 rounded-xl p-3.5 transition flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm"
                            >
                                {/* Left: Flight Details */}
                                <div className="flex items-center gap-3.5 min-w-[240px]">
                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shadow ${
                                        opp.isWideBody 
                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                                            : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                                    }`}>
                                        {opp.isWideBody ? 'WIDE' : 'NARR'}
                                    </div>

                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-extrabold text-sm text-white tracking-wide">{opp.callsign}</span>
                                            <span className="text-[11px] px-1.5 py-0.2 rounded bg-gray-800 text-gray-300 border border-gray-700 font-mono">
                                                {opp.aircraftType}
                                            </span>
                                            {opp.priority === 'HIGH' && (
                                                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-400/30">
                                                    🔥 Yüksek Verim
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-[11px] text-gray-400 mt-0.5">
                                            {opp.origin} ➔ {opp.destination} • {opp.durationMins} dk yatış süresi
                                        </div>
                                    </div>
                                </div>

                                {/* Middle: Shift Information & Explanation */}
                                <div className="flex-grow space-y-1">
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="px-2 py-0.5 rounded bg-gray-800 text-amber-300 font-bold border border-gray-700">
                                            🚌 {opp.currentPosition}
                                        </span>
                                        <span className="text-emerald-400 font-black">➔</span>
                                        <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-extrabold border border-emerald-500/40 shadow-sm">
                                            🌉 {opp.targetPosition} ({opp.targetConcourse})
                                        </span>
                                    </div>

                                    <p className="text-[11px] text-gray-300 leading-snug">
                                        {opp.explanation}
                                    </p>

                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {opp.ruleBadges.map((badge, bIdx) => (
                                            <span key={bIdx} className="text-[10px] px-1.5 py-0.2 rounded bg-gray-800/80 text-gray-400 border border-gray-700/60">
                                                ✓ {badge}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {/* Right: Revenue & Apply Button */}
                                <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                                    <div className="text-right">
                                        <span className="text-[10px] text-emerald-400 font-semibold block">EK KOİ GELİRİ</span>
                                        <span className="text-sm font-black text-white">+{formatEur(opp.revenueGainEur)}</span>
                                    </div>

                                    <button
                                        onClick={() => handleApplySingle(opp)}
                                        className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg shadow-md shadow-indigo-700/30 transition cursor-pointer select-none flex items-center gap-1"
                                    >
                                        <span>Körüğe Al</span>
                                        <span>➔</span>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </main>

                {/* Footer */}
                <footer className="p-3 bg-gray-950 border-t border-gray-800 flex items-center justify-between text-xs text-gray-400">
                    <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold">ℹ️ Kural Uyumu:</span>
                        <span>DHMİ 2026 Maktu Hizmetler (PBB, GPU, PCA, Su, VDGS) esas alınmıştır. Konma/Konaklama/Yolcu ücretleri hariç tutulmuştur.</span>
                    </div>

                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold rounded-lg border border-gray-700 transition"
                    >
                        Kapat
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default AiCopilotModal;
