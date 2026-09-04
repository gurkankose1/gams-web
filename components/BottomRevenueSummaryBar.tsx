import React, { useState, useMemo } from 'react';
import { Flight } from '../types.ts';
import { calculateRevenue, EUR_TRY_EXCHANGE_RATE } from '../services/revenue-calculator.ts';

interface BottomRevenueSummaryBarProps {
  flights: Flight[];
}

export const BottomRevenueSummaryBar: React.FC<BottomRevenueSummaryBarProps> = ({ flights }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const stats = useMemo(() => {
    let landingTotalEur = 0;
    let parkingTotalEur = 0;
    let bridgeTotalEur = 0;
    let gpuTotalEur = 0;
    let pcaTotalEur = 0;
    let waterTotalEur = 0;
    let paxServiceTotalEur = 0;
    let grandTotalEur = 0;

    let assignedCount = 0;
    let bridgeCount = 0;
    let remoteCount = 0;
    let domesticCount = 0;
    let internationalCount = 0;

    flights.forEach(flight => {
      if (!flight.parkingPosition && !flight.gate) return;

      assignedCount++;
      const rev = calculateRevenue(flight);

      landingTotalEur += rev.landingEur;
      parkingTotalEur += rev.parkingEur;
      bridgeTotalEur += rev.bridgeEur;
      gpuTotalEur += rev.gpuEur;
      pcaTotalEur += rev.pcaEur;
      waterTotalEur += rev.waterEur;
      paxServiceTotalEur += rev.paxServiceEur;
      grandTotalEur += rev.totalEur;

      if (rev.isBridge) {
        bridgeCount++;
      } else {
        remoteCount++;
      }

      const isDom = flight.type === 'turnaround'
        ? (flight.arrivalIsDomestic && flight.departureIsDomestic)
        : flight.isDomestic;

      if (isDom) {
        domesticCount++;
      } else {
        internationalCount++;
      }
    });

    const grandTotalTry = grandTotalEur * EUR_TRY_EXCHANGE_RATE;

    return {
      landingTotalEur,
      parkingTotalEur,
      bridgeTotalEur,
      gpuTotalEur,
      pcaTotalEur,
      waterTotalEur,
      paxServiceTotalEur,
      grandTotalEur,
      grandTotalTry,
      assignedCount,
      bridgeCount,
      remoteCount,
      domesticCount,
      internationalCount,
    };
  }, [flights]);

  const formatEur = (val: number) => `€${Math.round(val).toLocaleString('tr-TR')}`;
  const formatTry = (val: number) => `₺${Math.round(val).toLocaleString('tr-TR')}`;

  if (isCollapsed) {
    return (
      <footer className="sticky bottom-0 z-40 bg-[#1e232a]/95 backdrop-blur-md border-t border-amber-500/40 px-3 py-1 flex items-center justify-between text-xs text-gray-200 select-none shadow-[0_-4px_15px_rgba(0,0,0,0.4)]">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsCollapsed(false)}
            className="flex items-center space-x-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold px-2 py-0.5 rounded border border-amber-500/40 transition text-xs"
            title="Gelir detay çerçevesini aç"
          >
            <span>▲ Gelir Özeti (Göster)</span>
          </button>
          <span className="text-gray-400 text-[11px]">
            Atanmış: <strong className="text-white">{stats.assignedCount} Uçuş</strong> (🇹🇷 {stats.domesticCount} / 🌍 {stats.internationalCount})
          </span>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-baseline space-x-1.5">
            <span className="text-emerald-400 font-bold text-xs">Toplam Gelir:</span>
            <span className="text-emerald-300 font-black text-sm">{formatEur(stats.grandTotalEur)}</span>
            <span className="text-emerald-200/70 text-[10px]">({formatTry(stats.grandTotalTry)})</span>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="sticky bottom-0 z-40 bg-[#1e232a]/95 backdrop-blur-md border-t border-amber-500/40 shadow-[0_-4px_20px_rgba(0,0,0,0.5)] px-4 py-2 flex items-center justify-between text-xs text-gray-200 select-none transition-all duration-200">
      {/* Sol: Gizle Butonu & Genel İstatistik */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => setIsCollapsed(true)}
          className="flex items-center space-x-1 bg-gray-800 hover:bg-gray-700 text-amber-300 font-bold px-2 py-1 rounded border border-amber-500/30 transition text-[11px]"
          title="Ekranı genişletmek için özet çerçeveyi gizle"
        >
          <span>▼ Gizle</span>
        </button>

        <div className="flex items-center space-x-2 bg-gray-800/80 border border-gray-700 rounded-md px-3 py-1.5">
          <span className="text-amber-400 font-bold text-xs">📊 Atanmış Uçuşlar:</span>
          <span className="text-white font-extrabold text-xs">{stats.assignedCount} Uçuş</span>
          <span className="text-gray-400 text-[11px]">
            (🇹🇷 {stats.domesticCount} / 🌍 {stats.internationalCount})
          </span>
        </div>

        {/* Köprülü vs Remote Dağılımı */}
        <div className="flex items-center space-x-3 bg-gray-800/60 border border-gray-700/70 rounded-md px-3 py-1.5 text-[11px]">
          <span className="flex items-center text-cyan-300 font-semibold">
            🌉 Köprülü Pier: <strong className="ml-1 text-white">{stats.bridgeCount}</strong>
          </span>
          <span className="text-gray-500">|</span>
          <span className="flex items-center text-yellow-300 font-semibold">
            🚌 Remote/Açık: <strong className="ml-1 text-white">{stats.remoteCount}</strong>
          </span>
        </div>
      </div>

      {/* Orta: Kategori Bazlı Gelir Kırılımı */}
      <div className="hidden lg:flex items-center space-x-3 bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-1.5 text-[10px]">
        <div>
          <span className="text-gray-400 block">🛬 Konma</span>
          <span className="text-white font-bold">{formatEur(stats.landingTotalEur)}</span>
        </div>
        <div className="h-6 w-px bg-gray-700" />
        <div>
          <span className="text-gray-400 block">🅿️ Konaklama</span>
          <span className="text-white font-bold">{formatEur(stats.parkingTotalEur)}</span>
        </div>
        <div className="h-6 w-px bg-gray-700" />
        <div>
          <span className="text-cyan-300 block">🌉 PBB Köprü</span>
          <span className="text-cyan-200 font-bold">{formatEur(stats.bridgeTotalEur)}</span>
        </div>
        <div className="h-6 w-px bg-gray-700" />
        <div>
          <span className="text-amber-300 block">⚡ GPU 400Hz</span>
          <span className="text-amber-200 font-bold">{formatEur(stats.gpuTotalEur)}</span>
        </div>
        <div className="h-6 w-px bg-gray-700" />
        <div>
          <span className="text-sky-300 block">❄️ PCA İklim</span>
          <span className="text-sky-200 font-bold">{formatEur(stats.pcaTotalEur)}</span>
        </div>
        <div className="h-6 w-px bg-gray-700" />
        <div>
          <span className="text-blue-300 block">🚰 Su Servisi</span>
          <span className="text-blue-200 font-bold">{formatEur(stats.waterTotalEur)}</span>
        </div>
        <div className="h-6 w-px bg-gray-700" />
        <div>
          <span className="text-purple-300 block">🧳 Yolcu Servis</span>
          <span className="text-purple-200 font-bold">{formatEur(stats.paxServiceTotalEur)}</span>
        </div>
      </div>

      {/* Sağ: Genel Toplam Gelir Çerçevesi */}
      <div className="flex items-center space-x-3 bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-950 border-2 border-emerald-400/80 rounded-xl px-4 py-1.5 shadow-lg shadow-emerald-900/30 ring-2 ring-emerald-400/20">
        <div className="text-right">
          <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-300">
            MEVCUT PLAN TOPLAM GELİR
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-white font-black text-base tracking-tight">
              {formatEur(stats.grandTotalEur)}
            </span>
            <span className="text-emerald-300/80 font-semibold text-xs">
              ({formatTry(stats.grandTotalTry)})
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default BottomRevenueSummaryBar;
