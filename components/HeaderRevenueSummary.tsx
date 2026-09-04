import React, { useMemo } from 'react';
import { Flight } from '../types.ts';
import { calculateRevenue, EUR_TRY_EXCHANGE_RATE } from '../services/revenue-calculator.ts';

interface HeaderRevenueSummaryProps {
  flights: Flight[];
}

export const HeaderRevenueSummary: React.FC<HeaderRevenueSummaryProps> = ({ flights }) => {
  const summary = useMemo(() => {
    let domesticEur = 0;
    let internationalEur = 0;
    let assignedCount = 0;

    flights.forEach(flight => {
      const rev = calculateRevenue(flight);
      const isDomestic = flight.type === 'turnaround'
        ? (flight.arrivalIsDomestic && flight.departureIsDomestic)
        : flight.isDomestic;

      if (isDomestic) {
        domesticEur += rev.totalEur;
      } else {
        internationalEur += rev.totalEur;
      }

      if (flight.parkingPosition) {
        assignedCount++;
      }
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
  }, [flights]);

  const formatEur = (val: number) => `€${Math.round(val).toLocaleString('tr-TR')}`;
  const formatTry = (val: number) => `₺${Math.round(val).toLocaleString('tr-TR')}`;

  return (
    <div className="flex items-center space-x-3 text-xs select-none">
      {/* Günlük İç Hat Gelir */}
      <div className="bg-red-950/70 border border-red-500/50 rounded-lg px-2.5 py-1 flex items-center space-x-2 shadow">
        <span className="text-red-400 font-bold">🇹🇷 İç Hat Gelir:</span>
        <span className="text-white font-extrabold">{formatEur(summary.domesticEur)}</span>
        <span className="text-gray-400 text-[10px]">({formatTry(summary.domesticTry)})</span>
      </div>

      {/* Günlük Dış Hat Gelir */}
      <div className="bg-blue-950/70 border border-blue-500/50 rounded-lg px-2.5 py-1 flex items-center space-x-2 shadow">
        <span className="text-blue-400 font-bold">🌍 Dış Hat Gelir:</span>
        <span className="text-white font-extrabold">{formatEur(summary.internationalEur)}</span>
        <span className="text-gray-400 text-[10px]">({formatTry(summary.internationalTry)})</span>
      </div>

      {/* Toplam Günlük Gelir */}
      <div className="bg-emerald-950/90 border border-emerald-400/60 rounded-lg px-3 py-1 flex items-center space-x-2 shadow-lg ring-1 ring-emerald-400/30">
        <span className="text-emerald-400 font-bold">💰 Toplam Gelir:</span>
        <span className="text-emerald-300 font-black text-sm">{formatEur(summary.totalEur)}</span>
        <span className="text-emerald-200/70 text-[10px]">({formatTry(summary.totalTry)})</span>
      </div>
    </div>
  );
};

export default HeaderRevenueSummary;
