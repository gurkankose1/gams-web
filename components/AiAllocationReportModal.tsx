import React, { useState } from 'react';
import { BridgeUtilizationStats, SwapDetail } from '../services/ai-allocator.ts';

export interface AiReportData {
    stats: BridgeUtilizationStats;
    swapDetails: SwapDetail[];
    totalSwapsPerformed: number;
    netFlightsGained: number;
    gapFillsPerformed: number;
}

interface AiAllocationReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    report: AiReportData | null;
}

const HISTORICAL_HUMAN_BRIDGE_COUNT = 1912;
const HISTORICAL_HUMAN_BRIDGE_RATE = 76.4;

const AiAllocationReportModal: React.FC<AiAllocationReportModalProps> = ({ isOpen, onClose, report }) => {
    const [activeTab, setActiveTab] = useState<'kpi' | 'swaps' | 'rules'>('kpi');

    if (!isOpen || !report) return null;

    const { stats, swapDetails, totalSwapsPerformed, netFlightsGained, gapFillsPerformed } = report;
    const aiBridgeCount = stats.bridgeAssignedCount;
    const diffVsHuman = aiBridgeCount - HISTORICAL_HUMAN_BRIDGE_COUNT;
    const rateDiff = stats.bridgeRate - HISTORICAL_HUMAN_BRIDGE_RATE;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[95] p-4 backdrop-blur-sm animate-fade-in select-none">
            <div className="bg-gray-850 border border-gray-700/80 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-white">
                
                {/* Header */}
                <header className="p-5 bg-gradient-to-r from-purple-950/90 via-indigo-950/90 to-gray-900 border-b border-gray-700 flex justify-between items-center">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-2xl">🤖</span>
                            <h2 className="text-xl font-bold bg-gradient-to-r from-purple-300 via-indigo-200 to-amber-300 bg-clip-text text-transparent">
                                AI Planlama: Senaryo 1 Başarı Karnesi
                            </h2>
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30">
                                Maksimum Köprü & Durum Analizi
                            </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                            A-B-C-D-E-F-G köprü optimizasyonu, MARS fırsat analizi ve geriye dönük takas (review & self-healing) denetimi
                        </p>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="text-gray-400 hover:text-white text-2xl font-bold leading-none px-2.5 py-1 rounded-lg hover:bg-gray-800 transition"
                    >
                        &times;
                    </button>
                </header>

                {/* Sub-header Navigation Tabs */}
                <div className="flex items-center gap-2 px-6 pt-3 pb-1 bg-gray-900/60 border-b border-gray-750 text-xs">
                    <button
                        onClick={() => setActiveTab('kpi')}
                        className={`px-3 py-1.5 font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                            activeTab === 'kpi' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                        }`}
                    >
                        <span>🏆</span> Karşılaştırma Karnesi
                    </button>
                    <button
                        onClick={() => setActiveTab('swaps')}
                        className={`px-3 py-1.5 font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                            activeTab === 'swaps' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                        }`}
                    >
                        <span>🔄</span> Yapılan Akıllı Takaslar ({totalSwapsPerformed})
                    </button>
                    <button
                        onClick={() => setActiveTab('rules')}
                        className={`px-3 py-1.5 font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                            activeTab === 'rules' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                        }`}
                    >
                        <span>📋</span> Uygulanan Operasyonel Kriterler
                    </button>
                </div>

                {/* Main Content */}
                <main className="p-6 flex-grow overflow-y-auto space-y-6">
                    {activeTab === 'kpi' && (
                        <>
                            {/* Big Comparison Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Human Dispatcher Benchmark */}
                                <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                                            <span>👤</span> Gerçekleşen İnsan Dispatcher
                                        </span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">Tarihsel Referans</span>
                                    </div>
                                    <div className="my-3">
                                        <div className="text-3xl font-black text-gray-200">%{HISTORICAL_HUMAN_BRIDGE_RATE.toFixed(1)}</div>
                                        <div className="text-xs text-gray-400 mt-1">
                                            <strong className="text-gray-200">{HISTORICAL_HUMAN_BRIDGE_COUNT.toLocaleString('tr-TR')}</strong> yolcu uçuşu köprüye alındı
                                        </div>
                                    </div>
                                    <div className="text-[11px] text-gray-400 border-t border-gray-750 pt-2">
                                        Uzun yatan geniş gövdeler köprüde tutulduğu için birçok dar gövde açık aprona taştı.
                                    </div>
                                </div>

                                {/* AI Optimizer */}
                                <div className="bg-gradient-to-b from-purple-950/40 to-indigo-950/30 border-2 border-purple-500/60 rounded-xl p-4 shadow-lg flex flex-col justify-between relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/10 rounded-full blur-xl pointer-events-none"></div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                                            <span>🤖</span> Yapay Zeka (AI Senaryo 1)
                                        </span>
                                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-200 border border-purple-400/40">
                                            Optimize Edildi
                                        </span>
                                    </div>
                                    <div className="my-3">
                                        <div className="text-3xl font-black text-purple-200">%{stats.bridgeRate.toFixed(1)}</div>
                                        <div className="text-xs text-gray-300 mt-1">
                                            <strong className="text-emerald-400 text-sm font-black">{stats.bridgeAssignedCount.toLocaleString('tr-TR')}</strong> / {stats.eligibleFlightsCount.toLocaleString('tr-TR')} Yolcu Uçuşu Köprüde
                                        </div>
                                    </div>
                                    <div className="text-[11px] text-purple-200/80 border-t border-purple-900/60 pt-2 flex items-center gap-1">
                                        <span>🎯</span> MARS doluluğu, gündüz yatış kısıtı ve geriye dönük takas uygulandı.
                                    </div>
                                </div>

                                {/* Net Gain Badge */}
                                <div className="bg-gradient-to-b from-emerald-950/40 to-teal-950/30 border-2 border-emerald-500/60 rounded-xl p-4 shadow-lg flex flex-col justify-between">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                                            <span>📈</span> Net Kazanç & Operasyonel Fark
                                        </span>
                                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-200 border border-emerald-400/40">
                                            +%{rateDiff.toFixed(1)}
                                        </span>
                                    </div>
                                    <div className="my-3">
                                        <div className="text-3xl font-black text-emerald-400">
                                            {diffVsHuman >= 0 ? `+${diffVsHuman}` : diffVsHuman} Uçak
                                        </div>
                                        <div className="text-xs text-gray-300 mt-1">
                                            İnsan planlamasına kıyasla fazladan körüğe bağlandı
                                        </div>
                                    </div>
                                    <div className="text-[11px] text-emerald-200/80 border-t border-emerald-900/60 pt-2">
                                        🚌 On binlerce yolcu otobüsten kurtarıldı, doğrudan terminale bağlandı!
                                    </div>
                                </div>
                            </div>

                            {/* Self-Healing Review & Swap Audit Summary Box */}
                            <div className="bg-gray-900/80 border border-indigo-500/30 rounded-xl p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">🔄</span>
                                        <h3 className="font-bold text-sm text-indigo-300">
                                            Yapay Zeka Durum Analizi & Geriye Dönük İnceleme (Review & Self-Healing Audit)
                                        </h3>
                                    </div>
                                    <span className="text-xs text-gray-400">
                                        İnsan başkontrolör gibi planı denetleyip hataları düzelten motor
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                    <div className="bg-gray-800/80 rounded-lg p-2.5 border border-gray-700/60">
                                        <div className="text-gray-400">Gerçekleştirilen Akıllı Takas:</div>
                                        <div className="text-base font-bold text-amber-400 mt-0.5">{totalSwapsPerformed} Takas</div>
                                    </div>
                                    <div className="bg-gray-800/80 rounded-lg p-2.5 border border-gray-700/60">
                                        <div className="text-gray-400">Boşluk Doldurma (Gap Filling):</div>
                                        <div className="text-base font-bold text-cyan-400 mt-0.5">{gapFillsPerformed} Uçuş</div>
                                    </div>
                                    <div className="bg-gray-800/80 rounded-lg p-2.5 border border-gray-700/60">
                                        <div className="text-gray-400">Takasla Kurtarılan Ek Uçuş:</div>
                                        <div className="text-base font-bold text-emerald-400 mt-0.5">+{netFlightsGained} Uçuş</div>
                                    </div>
                                    <div className="bg-gray-800/80 rounded-lg p-2.5 border border-gray-700/60">
                                        <div className="text-gray-400">Açık Apronlara Yönlendirilen:</div>
                                        <div className="text-base font-bold text-gray-300 mt-0.5">{stats.remoteAssignedCount} Uçuş</div>
                                    </div>
                                </div>

                                <p className="text-[11px] text-gray-400 leading-relaxed">
                                    💡 <strong>Nasıl çalıştı?</strong> Sistem ilk atamayı tamamladıktan sonra köprüdeki uçakları tek tek denetledi. 
                                    Özellikle <strong>B5</strong> gibi MARS merkez stantlarında 8-13 saat yatarak iki dar gövde stantını (B5L ve B5R) kilitleyen geniş gövdeleri tespit etti. 
                                    Bu uçakları açık park pozisyonlarına kaydırarak, yerlerine aynı saat diliminde açıkta bekleyen 2 veya 3 dar gövdeyi köprüye çekti.
                                </p>
                            </div>
                        </>
                    )}

                    {activeTab === 'swaps' && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-sm text-gray-200 flex items-center gap-2">
                                    <span>🔄</span> Yapılan Akıllı Takasların (Swaps) Detaylı Listesi
                                </h3>
                                <span className="text-xs text-gray-400">
                                    Toplam {swapDetails.length} takas operasyonu gerçekleştirildi
                                </span>
                            </div>

                            {swapDetails.length === 0 ? (
                                <div className="p-8 text-center bg-gray-900/60 rounded-xl border border-gray-800 text-gray-400 text-sm">
                                    İlk yerleştirme aşamasında tüm uçuşlar optimum şekilde yerleştirildi; ek takas gerektirecek uzun yatış tespit edilmedi.
                                </div>
                            ) : (
                                <div className="border border-gray-750 rounded-xl overflow-hidden">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead className="bg-gray-900 text-gray-300 font-semibold border-b border-gray-750">
                                            <tr>
                                                <th className="p-2.5">Köprülü Pozisyon</th>
                                                <th className="p-2.5">Concourse</th>
                                                <th className="p-2.5">Açığa Atılan Uçuş (Uzun Yatış)</th>
                                                <th className="p-2.5">Yönlendirildiği Açık Park</th>
                                                <th className="p-2.5">Körüğe Kurtarılan Dar Gövdeler</th>
                                                <th className="p-2.5 text-right">Net Kazanç</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-800 bg-gray-850">
                                            {swapDetails.map((sw, idx) => (
                                                <tr key={idx} className="hover:bg-gray-800/60 transition">
                                                    <td className="p-2.5 font-bold text-amber-400">{sw.stand}</td>
                                                    <td className="p-2.5 text-gray-400">{sw.concourse}</td>
                                                    <td className="p-2.5">
                                                        <div className="font-bold text-red-300">{sw.removedFlight.callsign}</div>
                                                        <div className="text-[10px] text-gray-400">
                                                            {sw.removedFlight.acType} ({sw.removedFlight.durationHours} sa yatış)
                                                        </div>
                                                    </td>
                                                    <td className="p-2.5 font-semibold text-gray-300">
                                                        {sw.sentToRemote} (Açık Apron)
                                                    </td>
                                                    <td className="p-2.5">
                                                        <div className="flex flex-wrap gap-1">
                                                            {sw.gainedFlights.map((gf, gIdx) => (
                                                                <span key={gIdx} className="px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-600/40 text-emerald-300 font-bold text-[10px]">
                                                                    {gf.stand}: {gf.callsign} ({gf.acType})
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td className="p-2.5 text-right font-black text-emerald-400">
                                                        +{sw.netGain} Uçak
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'rules' && (
                        <div className="space-y-4 text-xs">
                            <h3 className="font-bold text-sm text-gray-200">
                                📋 Senaryo 1 Boyunca Uygulanan Tam Operasyonel Kurallar
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="p-3 bg-gray-900/70 border border-gray-750 rounded-lg space-y-1">
                                    <div className="font-bold text-amber-400 flex items-center gap-1.5">
                                        <span>1.</span> MARS Fırsat Kontrolü (Opportunity Cost)
                                    </div>
                                    <p className="text-gray-400 text-[11px] leading-relaxed">
                                        B5, A2, F1 gibi MARS merkez stantlarına geniş gövde koymadan önce, bu uçağın 2 veya daha fazla dar gövdeyi kilitleyip kilitlemeyeceği kontrol edilir. 2 dar gövde daima 1 geniş gövdeye tercih edilir.
                                    </p>
                                </div>

                                <div className="p-3 bg-gray-900/70 border border-gray-750 rounded-lg space-y-1">
                                    <div className="font-bold text-amber-400 flex items-center gap-1.5">
                                        <span>2.</span> Gündüz Kalış Süresi Kısıtı (Max Ground Time)
                                    </div>
                                    <p className="text-gray-400 text-[11px] leading-relaxed">
                                        Gündüz saatlerinde (06:00 - 23:00) 3.5 saatten uzun yatan geniş gövdeler ve 4.5 saatten uzun yatan dar gövdeler körükleri kitlememek için öncelikli olarak açık park pozisyonlarına yönlendirilir.
                                    </p>
                                </div>

                                <div className="p-3 bg-gray-900/70 border border-gray-750 rounded-lg space-y-1">
                                    <div className="font-bold text-amber-400 flex items-center gap-1.5">
                                        <span>3.</span> Geriye Dönük Takas ve İnceleme (Self-Healing Review)
                                    </div>
                                    <p className="text-gray-400 text-[11px] leading-relaxed">
                                        Plan bittiğinde sistem tüm stantları tarar; köprüdeki 1 uçağı açığa çıkarıp yerine 2 veya daha fazla dar gövdeyi köprüye sokabiliyorsa otomatik takas yapar.
                                    </p>
                                </div>

                                <div className="p-3 bg-gray-900/70 border border-gray-750 rounded-lg space-y-1">
                                    <div className="font-bold text-amber-400 flex items-center gap-1.5">
                                        <span>4.</span> Zero Buffer Time & Yapay Towing Yasağı
                                    </div>
                                    <p className="text-gray-400 text-[11px] leading-relaxed">
                                        Körük kullanım oranını yapay olarak şişirmek için uçakları körükten açığa çeken hayali towing hareketleri üretilmez; gerçekleşen bacaklar korunur. Buffer time 0 dakika uygulanır.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </main>

                {/* Footer */}
                <footer className="p-4 bg-gray-900 border-t border-gray-750 flex items-center justify-between">
                    <div className="text-[11px] text-gray-400 flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>Planlama başarıyla veritabanına kaydedildi ve ekrana yansıtıldı.</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-5 py-2 font-bold rounded-lg bg-purple-600 hover:bg-purple-500 text-white shadow transition text-xs"
                    >
                        Tamam, Planı İncele
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default AiAllocationReportModal;
