import React, { useState, useMemo } from 'react';
import { Flight } from '../types.ts';
import { calculateRevenue, EUR_TRY_EXCHANGE_RATE } from '../services/revenue-calculator.ts';

interface BottomRevenueSummaryBarProps {
  flights: Flight[];
  startDate?: Date;
  endDate?: Date;
}

export const BottomRevenueSummaryBar: React.FC<BottomRevenueSummaryBarProps> = ({ flights, startDate, endDate }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const dateRangeLabel = useMemo(() => {
    if (!startDate && !endDate) return null;
    if (startDate && endDate) {
      const isSameDay =
        startDate.getFullYear() === endDate.getFullYear() &&
        startDate.getMonth() === endDate.getMonth() &&
        startDate.getDate() === endDate.getDate();
      if (isSameDay) {
        return startDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
      }
      return `${startDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })} - ${endDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })}`;
    }
    if (startDate) {
      return startDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
    }
    return null;
  }, [startDate, endDate]);

  const stats = useMemo(() => {
    let bridgeTotalEur = 0;
    let gpuTotalEur = 0;
    let pcaTotalEur = 0;
    let waterTotalEur = 0;
    let vdgsTotalEur = 0;
    let grandTotalEur = 0;

    let assignedCount = 0;
    let bridgeCount = 0;
    let remoteCount = 0;
    let domesticCount = 0;
    let internationalCount = 0;

    const startMs = startDate ? startDate.getTime() : 0;
    const endMs = endDate ? endDate.getTime() : Infinity;

    flights.forEach(flight => {
      // Sadece park pozisyonu veya kapısı atanmış uçuşlar
      if (!flight.parkingPosition && !flight.gate) return;

      // ATD / Kalkış odaklı filtre: tek bacak geliş uçuşları (arrival) gerçek kalkış içermez
      if (flight.type === 'arrival') return;

      // Sadece seçili tarih aralığında giden uçuşlar (scheduledDeparture)
      // Ertesi güne sarkan uçuşlar scheduledDeparture gününde değerlendirilir
      const depMs = flight.scheduledDeparture instanceof Date && !isNaN(flight.scheduledDeparture.getTime())
        ? flight.scheduledDeparture.getTime()
        : 0;

      if (depMs < startMs || depMs > endMs) return;

      assignedCount++;
      const rev = calculateRevenue(flight);

      bridgeTotalEur += rev.bridgeEur;
      gpuTotalEur += rev.gpuEur;
      pcaTotalEur += rev.pcaEur;
      waterTotalEur += rev.waterEur;
      vdgsTotalEur += rev.vdgsEur;
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
      bridgeTotalEur,
      gpuTotalEur,
      pcaTotalEur,
      waterTotalEur,
      vdgsTotalEur,
      grandTotalEur,
      grandTotalTry,
      assignedCount,
      bridgeCount,
      remoteCount,
      domesticCount,
      internationalCount,
    };
  }, [flights, startDate, endDate]);

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
          {dateRangeLabel && (
            <span className="text-emerald-400 font-bold text-[10px] bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded shadow-sm">
              📅 {dateRangeLabel}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-baseline space-x-1.5">
            <span className="text-emerald-400 font-bold text-xs">Planlı Gelir:</span>
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

        <div className="flex items-center space-x-2 bg-gray-800/80 border border-gray-700 rounded-md px-3 py-1.5" title="Seçili tarih aralığında kalkışı olan ve bir standa/kapıya atanmış uçuşlar">
          <span className="text-amber-400 font-bold text-xs">📊 Atanmış Kalkışlar:</span>
          <span className="text-white font-extrabold text-xs">{stats.assignedCount} Uçuş</span>
          <span className="text-gray-400 text-[11px]">
            (🇹🇷 {stats.domesticCount} / 🌍 {stats.internationalCount})
          </span>
          {dateRangeLabel && (
            <span className="ml-1 text-emerald-400 font-bold text-[10px] bg-emerald-950/80 border border-emerald-500/40 px-1.5 py-0.5 rounded">
              📅 {dateRangeLabel}
            </span>
          )}
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

      {/* Orta: Kategori Bazlı Gelir Kırılımı (Sadece PBB, GPU, PCA, Su ve VDGS) */}
      <div className="hidden lg:flex items-center space-x-3 bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-1.5 text-[10px]">
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
          <span className="text-emerald-300 block">🅿️ VDGS Park</span>
          <span className="text-emerald-200 font-bold">{formatEur(stats.vdgsTotalEur)}</span>
        </div>
      </div>

      {/* Sağ: Genel Toplam Gelir Çerçevesi */}
      <div className="flex items-center space-x-3 bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-950 border-2 border-emerald-400/80 rounded-xl px-4 py-1.5 shadow-lg shadow-emerald-900/30 ring-2 ring-emerald-400/20">
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5 text-[10px] uppercase font-bold tracking-wider text-emerald-300">
            <span>PLANLI TOPLAM GELİR</span>
            {dateRangeLabel && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-800/80 text-emerald-200 text-[9px] font-bold border border-emerald-400/40 normal-case">
                📅 {dateRangeLabel}
              </span>
            )}
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
