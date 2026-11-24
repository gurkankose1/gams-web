import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';

interface DashboardPortalProps {
    onSelectGAMS: () => void;
    flightsCount?: number;
    user?: User | null;
    onQuickUploadExcel?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const DashboardPortal: React.FC<DashboardPortalProps> = ({
    onSelectGAMS,
    flightsCount = 0,
    user,
    onQuickUploadExcel,
}) => {
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Format local time (TR / UTC+3) and UTC (ZULU)
    const localTimeStr = currentTime.toLocaleTimeString('tr-TR', { hour12: false });
    const localDateStr = currentTime.toLocaleDateString('tr-TR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const utcHours = String(currentTime.getUTCHours()).padStart(2, '0');
    const utcMins = String(currentTime.getUTCMinutes()).padStart(2, '0');
    const utcSecs = String(currentTime.getUTCSeconds()).padStart(2, '0');
    const zuluTimeStr = `${utcHours}:${utcMins}:${utcSecs}Z`;

    const handleNavigateExternal = (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="min-h-screen bg-[#0b0f19] text-white flex flex-col justify-between selection:bg-indigo-500 selection:text-white relative overflow-x-hidden font-sans">
            {/* Subtle high-tech background pattern & ambient glows */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute top-1/3 -right-40 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }}></div>
                <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl"></div>
                <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-20"></div>
            </div>

            {/* Top Navigation Bar */}
            <header className="relative z-10 w-full border-b border-gray-800/80 bg-gray-900/60 backdrop-blur-md px-6 py-3.5 flex items-center justify-between shadow-lg">
                <div className="flex items-center space-x-3.5">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-900/80 to-indigo-900/80 border border-blue-500/40 shadow-inner">
                        <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping"></div>
                        <span className="text-base font-black tracking-wider text-white">GAMS</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/30 text-cyan-300 uppercase tracking-widest border border-cyan-400/20">
                            AOS SUITE
                        </span>
                    </div>
                    <div className="hidden sm:block text-xs text-gray-400 border-l border-gray-800 pl-3">
                        <span className="font-semibold text-gray-300">Havalimanı Operasyon & Optimizasyon Merkezi</span>
                    </div>
                </div>

                <div className="flex items-center space-x-4 text-xs">
                    {/* Clocks: Local TR & Zulu */}
                    <div className="hidden md:flex items-center space-x-3 bg-gray-800/70 border border-gray-700/60 px-3 py-1.5 rounded-lg text-gray-300 font-mono">
                        <div className="flex items-center space-x-1.5">
                            <span className="text-gray-400 text-[10px]">TR:</span>
                            <span className="text-white font-bold">{localTimeStr}</span>
                        </div>
                        <span className="text-gray-600">|</span>
                        <div className="flex items-center space-x-1.5">
                            <span className="text-cyan-400 text-[10px]">ZULU:</span>
                            <span className="text-cyan-300 font-bold">{zuluTimeStr}</span>
                        </div>
                    </div>

                    {/* User profile badge */}
                    <div className="flex items-center space-x-2 bg-gray-800/80 border border-gray-700/70 px-2.5 py-1 rounded-lg">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-cyan-400 flex items-center justify-center text-[11px] font-bold text-white shadow">
                            {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'G'}
                        </div>
                        <div className="flex flex-col text-left">
                            <span className="text-[11px] font-semibold text-gray-200 leading-tight">
                                {user?.displayName || 'Gürkan Köse'}
                            </span>
                            <span className="text-[9px] text-emerald-400 font-mono leading-tight flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                                Sistem Aktif
                            </span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="relative z-10 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex-1 flex flex-col justify-center">
                {/* Hero / Welcome Greeting */}
                <div className="text-center mb-10 sm:mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-medium mb-3">
                        <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                        Havalimanı Operasyonel Karar Destek & Yönetim Portalı
                    </div>
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight">
                        Operasyonel <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-cyan-400">Modül Seçimi</span>
                    </h1>
                    <p className="mt-3 text-sm sm:text-base text-gray-400 max-w-2xl mx-auto">
                        Çalışmak istediğiniz havalimanı yönetim, köprü optimizasyon veya maliyet hesaplama sistemini seçerek doğrudan işlem yapabilirsiniz.
                    </p>
                </div>

                {/* 3 Large Module Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-stretch">
                    {/* MODULE 1: GAMS Planlama */}
                    <div
                        onClick={onSelectGAMS}
                        className="group relative flex flex-col justify-between rounded-2xl bg-gradient-to-b from-[#151c2e] to-[#0f172a] border border-blue-500/30 hover:border-blue-400 p-6 sm:p-7 shadow-xl hover:shadow-2xl hover:shadow-blue-500/20 transition-all duration-300 cursor-pointer transform hover:-translate-y-1.5"
                    >
                        <div className="absolute top-4 right-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase tracking-wider">
                                Ana Platform
                            </span>
                        </div>

                        <div>
                            {/* Card Icon */}
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-600/30 group-hover:scale-110 transition-transform duration-300 mb-6">
                                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                            </div>

                            {/* Card Header & Description */}
                            <h2 className="text-2xl font-black text-white group-hover:text-blue-300 transition-colors flex items-center gap-2">
                                GAMS Planlama
                            </h2>
                            <p className="text-xs font-semibold text-blue-400 mt-1 uppercase tracking-wider">
                                Gate & Stand Allocation System
                            </p>
                            <p className="text-gray-300 text-xs sm:text-sm mt-3 leading-relaxed">
                                İnteraktif apron zaman çizelgesi (Gantt), uçuş programı entegrasyonu, yapay zeka destekli körük tahsisi ve anlık operasyonel çakışma denetimi.
                            </p>

                            {/* Module Feature Bullets */}
                            <ul className="mt-5 space-y-2 text-xs text-gray-400">
                                <li className="flex items-center gap-2">
                                    <span className="text-blue-400 text-sm">✓</span>
                                    <span>İnteraktif Apron & Kapı Çizelgesi</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <span className="text-blue-400 text-sm">✓</span>
                                    <span>AI Destekli Akıllı Körük Tahsisi</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <span className="text-blue-400 text-sm">✓</span>
                                    <span>Çakışma & Bakım (AOG) Yönetimi</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <span className="text-blue-400 text-sm">✓</span>
                                    <span>Canlı Gelir Özeti & Finansal KPI'lar</span>
                                </li>
                            </ul>
                        </div>

                        {/* Bottom Status & Action */}
                        <div className="mt-8 pt-4 border-t border-gray-800 flex items-center justify-between">
                            <span className="text-[11px] font-medium text-gray-400 flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${flightsCount > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`}></span>
                                {flightsCount > 0 ? `${flightsCount} Uçuş Yüklü` : 'Giriş Yap'}
                            </span>
                            <button
                                type="button"
                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 group-hover:gap-2.5"
                            >
                                <span>Plana Git</span>
                                <span>→</span>
                            </button>
                        </div>
                    </div>

                    {/* MODULE 2: xPBB */}
                    <div
                        onClick={() => handleNavigateExternal('https://xpbb-web.vercel.app/')}
                        className="group relative flex flex-col justify-between rounded-2xl bg-gradient-to-b from-[#1b152d] to-[#0f172a] border border-purple-500/30 hover:border-purple-400 p-6 sm:p-7 shadow-xl hover:shadow-2xl hover:shadow-purple-500/20 transition-all duration-300 cursor-pointer transform hover:-translate-y-1.5"
                    >
                        <div className="absolute top-4 right-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-wider">
                                Harici Sistem ↗
                            </span>
                        </div>

                        <div>
                            {/* Card Icon */}
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-fuchsia-700 flex items-center justify-center shadow-lg shadow-purple-600/30 group-hover:scale-110 transition-transform duration-300 mb-6">
                                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                            </div>

                            {/* Card Header & Description */}
                            <h2 className="text-2xl font-black text-white group-hover:text-purple-300 transition-colors flex items-center gap-2">
                                xPBB
                            </h2>
                            <p className="text-xs font-semibold text-purple-400 mt-1 uppercase tracking-wider">
                                Expected Passenger Boarding Bridge
                            </p>
                            <p className="text-gray-300 text-xs sm:text-sm mt-3 leading-relaxed">
                                Körük (PBB) kullanım oranı simülasyonu, katma değer (ΔPBB) analitiği, yer süresi ve geniş gövde baskısı bazlı köprü beklenti hesaplamaları.
                            </p>

                            {/* Module Feature Bullets */}
                            <ul className="mt-5 space-y-2 text-xs text-gray-400">
                                <li className="flex items-center gap-2">
                                    <span className="text-purple-400 text-sm">✓</span>
                                    <span>Teorik vs. Fiili Körük Kullanım Karşılaştırması</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <span className="text-purple-400 text-sm">✓</span>
                                    <span>Ramp Kontrol Katma Değeri (ΔPBB)</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <span className="text-purple-400 text-sm">✓</span>
                                    <span>Geniş Gövde & Yer Süresi Baskı Metrikleri</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <span className="text-purple-400 text-sm">✓</span>
                                    <span>Tarihsel Trend & Slot Darboğaz Analizi</span>
                                </li>
                            </ul>
                        </div>

                        {/* Bottom Status & Action */}
                        <div className="mt-8 pt-4 border-t border-gray-800 flex items-center justify-between">
                            <span className="text-[11px] font-medium text-gray-400">
                                xpbb-web.vercel.app
                            </span>
                            <button
                                type="button"
                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 group-hover:gap-2.5"
                            >
                                <span>xPBB'ye Git</span>
                                <span>↗</span>
                            </button>
                        </div>
                    </div>

                    {/* MODULE 3: KOI Ücret Hesaplama */}
                    <div
                        onClick={() => handleNavigateExternal('https://koi-hesaplama.vercel.app/')}
                        className="group relative flex flex-col justify-between rounded-2xl bg-gradient-to-b from-[#132321] to-[#0f172a] border border-emerald-500/30 hover:border-emerald-400 p-6 sm:p-7 shadow-xl hover:shadow-2xl hover:shadow-emerald-500/20 transition-all duration-300 cursor-pointer transform hover:-translate-y-1.5"
                    >
                        <div className="absolute top-4 right-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                                Harici Sistem ↗
                            </span>
                        </div>

                        <div>
                            {/* Card Icon */}
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-600/30 group-hover:scale-110 transition-transform duration-300 mb-6">
                                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>

                            {/* Card Header & Description */}
                            <h2 className="text-2xl font-black text-white group-hover:text-emerald-300 transition-colors flex items-center gap-2">
                                KOI Ücret Hesaplama
                            </h2>
                            <p className="text-xs font-semibold text-emerald-400 mt-1 uppercase tracking-wider">
                                Havalimanı & Körük Tarifeleri
                            </p>
                            <p className="text-gray-300 text-xs sm:text-sm mt-3 leading-relaxed">
                                DHMİ ve havalimanı tarifelerine göre körük, otopark, konma-konaklama, PCA/400Hz ve yolcu başına operasyonel gelir/gider hesaplama motoru.
                            </p>

                            {/* Module Feature Bullets */}
                            <ul className="mt-5 space-y-2 text-xs text-gray-400">
                                <li className="flex items-center gap-2">
                                    <span className="text-emerald-400 text-sm">✓</span>
                                    <span>DHMİ & İGA Resmi Ücret Tarifeleri</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <span className="text-emerald-400 text-sm">✓</span>
                                    <span>Körük (PBB), Otopark ve Apron Hizmet Gelirleri</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <span className="text-emerald-400 text-sm">✓</span>
                                    <span>Havayolu & Uçak Tipi Bazlı Mali Simülasyon</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <span className="text-emerald-400 text-sm">✓</span>
                                    <span>Detaylı Finansal Raporlama ve Dışa Aktarım</span>
                                </li>
                            </ul>
                        </div>

                        {/* Bottom Status & Action */}
                        <div className="mt-8 pt-4 border-t border-gray-800 flex items-center justify-between">
                            <span className="text-[11px] font-medium text-gray-400">
                                koi-hesaplama.vercel.app
                            </span>
                            <button
                                type="button"
                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-1.5 group-hover:gap-2.5"
                            >
                                <span>KOI'ye Git</span>
                                <span>↗</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Quick Action / Excel Load Card */}
                {onQuickUploadExcel && (
                    <div className="mt-8 rounded-xl bg-gray-900/50 border border-gray-800 p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 flex-shrink-0">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                            </div>
                            <div>
                                <h4 className="text-xs sm:text-sm font-bold text-gray-200">
                                    Hızlı Uçuş Programı Yükleme
                                </h4>
                                <p className="text-[11px] text-gray-400">
                                    Excel uçuş listenizi (.xlsx, .csv) doğrudan seçerek planlama modülünü anında başlatabilirsiniz.
                                </p>
                            </div>
                        </div>
                        <div className="flex-shrink-0">
                            <label
                                htmlFor="quick-dashboard-excel-upload"
                                className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold border border-gray-700 hover:border-gray-600 shadow-sm transition"
                            >
                                <svg className="w-4 h-4 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                <span>Dosya Seç & Planı Aç</span>
                            </label>
                            <input
                                id="quick-dashboard-excel-upload"
                                type="file"
                                className="hidden"
                                onChange={(e) => {
                                    if (onQuickUploadExcel) onQuickUploadExcel(e);
                                    onSelectGAMS();
                                }}
                                accept=".xlsx, .xls, .csv"
                            />
                        </div>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="relative z-10 w-full border-t border-gray-800/80 bg-gray-900/60 backdrop-blur-md px-6 py-3 flex flex-col sm:flex-row items-center justify-between text-[11px] text-gray-500 gap-2">
                <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-400">GAMS Aviation Operations Suite</span>
                    <span>•</span>
                    <span>Tüm Operasyonel Modüller Aktif</span>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-gray-400">v1.0.1 Production</span>
                    <span>•</span>
                    <span className="text-gray-500">© 2026 GAMS Operations</span>
                </div>
            </footer>
        </div>
    );
};

export default DashboardPortal;
