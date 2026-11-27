import React from 'react';

interface DateTime24InputProps {
    id?: string;
    value: string; // "YYYY-MM-DDTHH:mm"
    onChange: (value: string) => void;
    className?: string;
    accentClass?: string;
    compact?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export const DateTime24Input: React.FC<DateTime24InputProps> = ({
    id,
    value,
    onChange,
    className = '',
    accentClass = 'text-gray-200',
    compact = false,
}) => {
    const safeVal = value || '';
    const [datePartRaw, timePartRaw] = safeVal.split('T');
    const datePart = datePartRaw || '';
    const [hhRaw, mmRaw] = (timePartRaw || '00:00').split(':');
    const hh = HOURS.includes(hhRaw) ? hhRaw : '00';
    const mm = MINUTES.includes(mmRaw) ? mmRaw : '00';

    const emit = (nextDate: string, nextH: string, nextM: string) => {
        if (!nextDate) {
            onChange('');
            return;
        }
        onChange(`${nextDate}T${nextH}:${nextM}`);
    };

    const selectCls = compact
        ? `bg-gray-800/90 border border-gray-700/80 rounded px-0.5 py-0.5 text-[11px] font-mono ${accentClass} outline-none cursor-pointer focus:border-indigo-500`
        : `bg-gray-800 border border-gray-700 rounded-md px-1.5 py-1 text-xs font-mono ${accentClass} outline-none cursor-pointer focus:border-indigo-500`;

    const dateCls = compact
        ? `bg-transparent text-[11px] font-mono ${accentClass} outline-none cursor-pointer w-[106px]`
        : `bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs font-mono ${accentClass} outline-none cursor-pointer focus:border-indigo-500 flex-1 min-w-0`;

    return (
        <div className={`inline-flex items-center gap-1 ${className}`}>
            <input
                id={id}
                type="date"
                value={datePart}
                onChange={(e) => emit(e.target.value, hh, mm)}
                className={dateCls}
            />
            <div className="inline-flex items-center gap-0.5 flex-shrink-0">
                <select
                    aria-label="Saat (00-23)"
                    value={hh}
                    onChange={(e) => emit(datePart, e.target.value, mm)}
                    className={selectCls}
                >
                    {HOURS.map((h) => (
                        <option key={h} value={h} className="bg-gray-900 text-gray-100">
                            {h}
                        </option>
                    ))}
                </select>
                <span className="text-gray-500 font-mono text-xs select-none">:</span>
                <select
                    aria-label="Dakika (00-59)"
                    value={mm}
                    onChange={(e) => emit(datePart, hh, e.target.value)}
                    className={selectCls}
                >
                    {MINUTES.map((m) => (
                        <option key={m} value={m} className="bg-gray-900 text-gray-100">
                            {m}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
};
