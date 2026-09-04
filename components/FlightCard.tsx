import React, { useMemo, useEffect, useRef } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Flight, ItemTypes } from '../types.ts';
import { WIDE_BODY_AIRCRAFT, AIRLINE_COLORS } from '../constants.ts';
import { calculateRevenue } from '../services/revenue-calculator.ts';

interface FlightCardProps {
  flight: Flight;
  isPositioned?: boolean;
  isSelected: boolean;
  isOverridden: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  isSearched?: boolean;
}

const getFlightDisplayText = (flight: Flight): string => {
    const isUnregistered = !flight.regNo || flight.regNo === '' || flight.regNo.startsWith('ER') || flight.regNo === 'DUMMY' || flight.regNo === 'NONE';
    const erPrefix = isUnregistered && !flight.arrivalFlightNumber?.startsWith('ER') && !flight.departureFlightNumber?.startsWith('ER') ? 'ER/' : '';

    const typeSuffix = flight.aircraftType ? ` / ${flight.aircraftType}` : '';
    const parkingInfo = flight.parkingPosition ? ` [P:${flight.parkingPosition}]` : '';
    const gateInfo = flight.gate ? ` [G:${flight.gate}]` : '';
    
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

    return `${erPrefix}${flightNumText}${typeSuffix}${parkingInfo}${gateInfo}`;
}

const generateTooltipText = (flight: Flight): string => {
    const timeFormatOptions: Intl.DateTimeFormatOptions = {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    };

    const arrivalD = flight.type === 'turnaround' ? flight.arrivalIsDomestic : flight.isDomestic;
    const departureD = flight.type === 'turnaround' ? flight.departureIsDomestic : flight.isDomestic;

    const arrivalE = arrivalD ? '🇹🇷' : '🌍';
    const departureE = departureD ? '🇹🇷' : '🌍';
    
    let emojiPrefix = '';
    if (flight.type === 'turnaround') {
        emojiPrefix = `[${arrivalE}] -> [${departureE}]`;
    } else if (flight.type === 'arrival') {
        emojiPrefix = `[${arrivalE}]`;
    } else if (flight.type === 'departure') {
        emojiPrefix = `[${departureE}]`;
    }

    let tooltip = `${emojiPrefix} ${getFlightDisplayText(flight)}\n`;
    if (flight.departureMode) {
        tooltip += `Departure Mode: ${flight.departureMode}\n`;
    }
    if (flight.type === 'turnaround') {
      tooltip += `${flight.origin} -> ${flight.destination}\n`;
      tooltip += `Time: ${flight.scheduledArrival.toLocaleTimeString('tr-TR', timeFormatOptions)} - ${flight.scheduledDeparture.toLocaleTimeString('tr-TR', timeFormatOptions)}\n`;
    } else if (flight.type === 'arrival') {
        tooltip += `${flight.origin} -> ???\n`;
        tooltip += `Arrival Time: ${flight.scheduledArrival.toLocaleTimeString('tr-TR', timeFormatOptions)}\n`;
    } else {
        tooltip += `??? -> ${flight.destination}\n`;
        tooltip += `Departure Time: ${flight.scheduledDeparture.toLocaleTimeString('tr-TR', timeFormatOptions)}\n`;
    }

    const revenue = calculateRevenue(flight);
    if (revenue) {
        const formatEur = (val: number) => `€${Math.round(val).toLocaleString('tr-TR')}`;
        const formatTry = (val: number) => `₺${Math.round(val).toLocaleString('tr-TR')}`;

        tooltip += `\n\n--- 💰 KOİ UÇAK GELİR BİLGİSİ (${revenue.isBridge ? '🌉 Köprülü Pier' : '🚌 Remote / Açık'}) ---`;
        tooltip += `\n• MTOW: ${revenue.mtow} Ton | Tahmini Yolcu: ${revenue.paxCount} Pax`;
        tooltip += `\n• Konma Ücreti: ${formatEur(revenue.landingEur)} (${formatTry(revenue.landingTry)})`;
        if (revenue.parkingEur > 0) tooltip += `\n• Konaklama Ücreti: ${formatEur(revenue.parkingEur)} (${formatTry(revenue.parkingTry)})`;
        if (revenue.isBridge) tooltip += `\n• Yolcu Köprü Ücreti: ${formatEur(revenue.bridgeEur)} (${formatTry(revenue.bridgeTry)})`;
        tooltip += `\n• Yolcu Servis Ücreti: ${formatEur(revenue.paxServiceEur)} (${formatTry(revenue.paxServiceTry)})`;
        tooltip += `\n---------------------------------`;
        tooltip += `\nTOPLAM TAHMİNİ GELİR: ${formatEur(revenue.totalEur)} (${formatTry(revenue.totalTry)})`;
    }


    if (flight.raw_data) {
        tooltip += '\n\n--- Excel Verileri ---';
        const formatValue = (value: any) => {
             if (value instanceof Date) {
                 return value.toLocaleString('tr-TR');
             }
             if (value === null || value === undefined) return '';
             return String(value);
        }
        
        if (flight.raw_data.arrival && flight.raw_data.departure) { // From paired legs
            tooltip += '\nGeliş Bacağı:';
            Object.entries(flight.raw_data.arrival).forEach(([key, value]) => {
                tooltip += `\n  ${key}: ${formatValue(value)}`;
            });
            tooltip += '\n\nGidiş Bacağı:';
            Object.entries(flight.raw_data.departure).forEach(([key, value]) => {
                tooltip += `\n  ${key}: ${formatValue(value)}`;
            });
        } else { // From turnaround or single row
            Object.entries(flight.raw_data).forEach(([key, value]) => {
                tooltip += `\n${key}: ${formatValue(value)}`;
            });
        }
    }

    return tooltip.trim();
};


const FlightCard: React.FC<FlightCardProps> = ({ 
    flight, 
    isPositioned = false, 
    isSelected, 
    isOverridden, 
    onSelect, 
    onContextMenu,
    isHighlighted = false,
    isDimmed = false,
    isSearched = false
}) => {
  const cardElementRef = useRef<HTMLDivElement | null>(null);

  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: ItemTypes.FLIGHT,
    item: () => {
      const el = cardElementRef.current;
      const rect = el ? el.getBoundingClientRect() : null;
      return {
        id: flight.id,
        flight,
        width: rect ? rect.width : 200,
        height: rect ? rect.height : 44,
      };
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [flight]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);
  
  const isWideBody = WIDE_BODY_AIRCRAFT.has(flight.aircraftType);
  const isSpecial = flight.departureMode === 'F';

  const cardStyle = useMemo(() => {
    const isWideBody = WIDE_BODY_AIRCRAFT.has(flight.aircraftType?.toUpperCase().trim());
    const isUnregistered = !flight.regNo || flight.regNo.trim() === '' || flight.regNo.toUpperCase().startsWith('ER') || flight.regNo.toUpperCase() === 'DUMMY' || flight.regNo.toUpperCase() === 'NONE';

    let style: React.CSSProperties;

    if (isUnregistered) {
      // Tescili tanımlanmamış uçuşlar: Beyaz / Açık Gri tonlarında
      style = {
        backgroundColor: '#b0bec5',
        borderColor: '#78909c',
        color: '#0f172a',
      };
    } else if (isWideBody) {
      // Geniş Gövde: Açık Mavi (Steel/Slate Blue)
      style = {
        backgroundColor: '#527891',
        borderColor: '#3b586c',
        color: '#ffffff',
      };
    } else {
      // Dar Gövde: Koyu Mavi (Deep Cobalt Blue)
      style = {
        backgroundColor: '#2e3984',
        borderColor: '#1e265c',
        color: '#ffffff',
      };
    }

    if (isOverridden) {
      style.borderColor = '#FBBF24'; // yellow-400
    }

    return style;
  }, [flight.aircraftType, flight.regNo, isOverridden]);


  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(e);
  }
  
  const handleContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    onContextMenu(e);
  };


  const tooltipText = useMemo(() => generateTooltipText(flight), [flight]);
  const displayText = useMemo(() => getFlightDisplayText(flight), [flight]);
  
  const { startDisplay, endDisplay } = useMemo(() => {
    const domesticFlag = <span className="font-bold text-red-500">TR</span>;
    const internationalFlag = <span>🌍</span>;

    const getIcon = (isDomestic: boolean | undefined) => {
      if (isDomestic === true) return domesticFlag;
      if (isDomestic === false) return internationalFlag;
      return null; // Return null if undefined, showing no icon.
    };

    if (flight.type === 'turnaround') {
      return {
        startDisplay: getIcon(flight.arrivalIsDomestic),
        endDisplay: getIcon(flight.departureIsDomestic),
      };
    }
    if (flight.type === 'arrival') {
      return { startDisplay: getIcon(flight.isDomestic), endDisplay: null };
    }
    if (flight.type === 'departure') {
      return { startDisplay: getIcon(flight.isDomestic), endDisplay: null };
    }
    
    return { startDisplay: null, endDisplay: null };
  }, [flight]);


  return (
    <div
      ref={(node) => {
        drag(node);
        cardElementRef.current = node;
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      style={cardStyle}
      className={`
        rounded-md transition-all duration-200 border-l-4 w-full h-full flex items-center
        cursor-grab
        ${isDragging ? 'opacity-30 shadow-2xl scale-105' : 'shadow-md'}
        ${isSelected ? 'ring-2 ring-offset-2 ring-offset-gray-800 ring-blue-500' : ''}
        ${isHighlighted && !isSearched ? 'ring-2 ring-yellow-400' : ''}
        ${isDimmed ? 'opacity-30' : 'opacity-100'}
        ${isSearched ? 'scale-110 z-20 ring-4 ring-yellow-300 ring-offset-2 ring-offset-gray-800' : ''}
      `}
      title={tooltipText}
    >
      <div className="flex items-center justify-between w-full px-2 text-xs font-bold text-white leading-tight">
        <span className="w-4 text-left flex-shrink-0">{startDisplay}</span>
        <span className="flex-grow text-center truncate px-1">{displayText}</span>
        <span className="w-4 text-right flex-shrink-0">{endDisplay}</span>
      </div>
    </div>
  );
};

export default FlightCard;