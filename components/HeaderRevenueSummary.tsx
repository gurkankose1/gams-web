import React, { useMemo } from 'react';
import { Flight } from '../types.ts';
import { calculateRevenue, EUR_TRY_EXCHANGE_RATE } from '../services/revenue-calculator.ts';

interface HeaderRevenueSummaryProps {
  flights: Flight[];
  startDate?: Date;
  endDate?: Date;
}

export const HeaderRevenueSummary: React.FC<HeaderRevenueSummaryProps> = ({ flights, startDate, endDate }) => {
  const summary = useMemo(() => {
    let domesticEur = 0;
    let internationalEur = 0;
    let assignedCount = 0;

    const startMs = startDate ? startDate.getTime() : 0;
    const endMs = endDate ? endDate.getTime() : Infinity;

    flights.forEach(flight => {
      // Sadece standa veya kapıya atanmış uçuşlar
      if (!flight.parkingPosition && !flight.gate) return;

      // ATD / Kalkış odaklı filtre: tek bacak geliş uçuşları (arrival) gerçek kalkış içermez
      if (flight.type === 'arrival') return;

      // Sadece seçili tarih aralığında giden uçuşlar (scheduledDeparture)
      // Ertesi güne sarkan uçuşlar scheduledDeparture gününde değerlendirilir
      const depMs = flight.scheduledDeparture instanceof Date && !isNaN(flight.scheduledDeparture.getTime())
        ? flight.scheduledDeparture.getTime()
        : 0;

      if (depMs < startMs || depMs > endMs) return;

      const rev = calculateRevenue(flight);
      const isDomestic = flight.type === 'turnaround'
        ? (flight.arrivalIsDomestic && flight.departureIsDomestic)
        : flight.isDomestic;

      if (isDomestic) {
        domesticEur += rev.totalEur;
      } else {
        internationalEur += rev.totalEur;
      }

      assignedCount++;
    });

    const totalEur = domesticEur + internationalEur;
    const domesticTry = domesticEur * EUR_TRY_EXCHANGE_RATE;
    const internationalTry = internationalEur * EUR_TRY_EXCHANGE_RATE;
    const totalTry = totalEur * EUR_TRY_EXCHANGE_RATE;

    return {
      domesticEur,
      domesticTry,
      internationalEur,
      internationalTry,
      totalEur,
      totalTry,
      assignedCount,
      totalCount: flights.length
    };
  }, [flights, startDate, endDate]);

  const formatEur = (val: number) => `€${Math.round(val).toLocaleString('tr-TR')}`;
  const formatTry = (val: number) => `₺${Math.round(val).toLocaleString('tr-TR')}`;

  return (
    <div className="flex items-center space-x-3 text-xs select-none">
      {/* Seçili Dönem İç Hat Gelir */}
      <div className="bg-red-950/70 border border-red-500/50 rounded-lg px-2.5 py-1 flex items-center space-x-2 shadow" title="Seçili dönemde kalkan atanmış iç hat uçuş gelirleri">
        <span className="text-red-400 font-bold">🇹🇷 İç Hat Gelir:</span>
        <span className="text-white font-extrabold">{formatEur(summary.domesticEur)}</span>
        <span className="text-gray-400 text-[10px]">({formatTry(summary.domesticTry)})</span>
      </div>

      {/* Seçili Dönem Dış Hat Gelir */}
      <div className="bg-blue-950/70 border border-blue-500/50 rounded-lg px-2.5 py-1 flex items-center space-x-2 shadow" title="Seçili dönemde kalkan atanmış dış hat uçuş gelirleri">
        <span className="text-blue-400 font-bold">🌍 Dış Hat Gelir:</span>
        <span className="text-white font-extrabold">{formatEur(summary.internationalEur)}</span>
        <span className="text-gray-400 text-[10px]">({formatTry(summary.internationalTry)})</span>
      </div>

      {/* Toplam Planlı Gelir */}
      <div className="bg-emerald-950/90 border border-emerald-400/60 rounded-lg px-3 py-1 flex items-center space-x-2 shadow-lg ring-1 ring-emerald-400/30" title="Seçili dönemde kalkan atanmış tüm uçuşların toplam planlı geliri">
        <span className="text-emerald-400 font-bold">💰 Toplam Gelir:</span>
        <span className="text-emerald-300 font-black text-sm">{formatEur(summary.totalEur)}</span>
        <span className="text-emerald-200/70 text-[10px]">({formatTry(summary.totalTry)})</span>
      </div>
    </div>
  );
};

export default HeaderRevenueSummary;
