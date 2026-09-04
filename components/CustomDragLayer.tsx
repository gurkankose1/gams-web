import React from 'react';
import { useDragLayer } from 'react-dnd';
import { ItemTypes, Flight } from '../types.ts';
import { WIDE_BODY_AIRCRAFT } from '../constants.ts';

const getFlightDisplayText = (flight: Flight): string => {
    const isUnregistered = !flight.regNo || flight.regNo === '' || flight.regNo.startsWith('ER') || flight.regNo === 'DUMMY' || flight.regNo === 'NONE';
    const erPrefix = isUnregistered && !flight.arrivalFlightNumber?.startsWith('ER') && !flight.departureFlightNumber?.startsWith('ER') ? 'ER/' : '';
    const typeSuffix = flight.aircraftType ? ` / ${flight.aircraftType}` : '';
    let flightNumText = '';
    switch (flight.type) {
        case 'turnaround':
            flightNumText = `${flight.arrivalFlightNumber || ''} / ${flight.departureFlightNumber || ''}`;
            break;
        case 'arrival':
            flightNumText = `${flight.arrivalFlightNumber || ''} ARR`;
            break;
        case 'departure':
            flightNumText = `${flight.departureFlightNumber || ''} DEP`;
            break;
        default:
            flightNumText = `Uçuş Bilgisi Yok`;
    }
    return `${erPrefix}${flightNumText}${typeSuffix}`;
};

export const CustomDragLayer: React.FC = () => {
    const { isDragging, item, initialOffset, currentOffset } = useDragLayer((monitor) => ({
        item: monitor.getItem() as { id: string; flight?: Flight; width?: number; height?: number } | null,
        itemType: monitor.getItemType(),
        initialOffset: monitor.getInitialSourceClientOffset(),
        currentOffset: monitor.getSourceClientOffset(),
        isDragging: monitor.isDragging(),
    }));

    if (!isDragging || !initialOffset || !currentOffset || !item || !item.flight) {
        return null;
    }

    // STRICT HORIZONTAL LOCK: Keep X fixed at initialOffset.x, only allow Y to move with cursor
    const x = initialOffset.x;
    const y = currentOffset.y;

    const flight = item.flight;
    const isWideBody = WIDE_BODY_AIRCRAFT.has(flight.aircraftType?.toUpperCase().trim() || '');
    const isUnregistered = !flight.regNo || flight.regNo.trim() === '' || flight.regNo.toUpperCase().startsWith('ER') || flight.regNo.toUpperCase() === 'DUMMY' || flight.regNo.toUpperCase() === 'NONE';

    let cardBg = '#2e3984'; // Narrow body default: Koyu Mavi
    let textColor = '#ffffff';
    let borderColor = '#1e265c';

    if (isUnregistered) {
        cardBg = '#b0bec5';
        textColor = '#0f172a';
        borderColor = '#78909c';
    } else if (isWideBody) {
        cardBg = '#527891';
        textColor = '#ffffff';
        borderColor = '#3b586c';
    }

    const transform = `translate3d(${x}px, ${y}px, 0px)`;

    return (
        <div className="fixed inset-0 pointer-events-none z-[99999] overflow-hidden">
            <div
                style={{
                    transform,
                    WebkitTransform: transform,
                    width: item.width ? `${item.width}px` : '200px',
                    height: item.height ? `${item.height}px` : '44px',
                    backgroundColor: cardBg,
                    color: textColor,
                    borderColor: borderColor,
                }}
                className="rounded-md border-2 border-amber-400 shadow-2xl scale-105 flex items-center justify-between px-2 text-xs font-bold ring-4 ring-amber-400/40"
            >
                <div className="flex items-center justify-between w-full px-1 text-xs font-semibold">
                    <span className="text-amber-300 font-extrabold mr-1">↕</span>
                    <span className="truncate flex-grow text-center">{getFlightDisplayText(flight)}</span>
                    <span className="text-amber-300 font-mono text-[10px] ml-1 px-1 bg-black/40 rounded">Zaman Kilitli</span>
                </div>
            </div>
        </div>
    );
};

export default CustomDragLayer;
