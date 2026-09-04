import React, { useState, useRef, useEffect } from 'react';
import { useDrop } from 'react-dnd';
import { Flight, ItemTypes } from '../types.ts';
import FlightCard from './FlightCard.tsx';
import { FLIGHT_CARD_HEIGHT, FLIGHT_CARD_MARGIN } from '../constants.ts';

interface FlightPoolProps {
  unassignedFlights: Flight[];
  onDropFlight: (flightId: string) => void;
  selectedFlightIds: Set<string>;
  onFlightClick: (flightId: string, event: React.MouseEvent) => void;
  setSelectedFlightIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  startDate: Date;
  totalDurationMs: number;
  flightPositions: Map<string, { trackIndex: number }>;
  onFlightContextMenu: (event: React.MouseEvent, flightId: string) => void;
  ruleOverrides: Set<string>;
  highlightedFlightId: string | null;
  flightElements: React.MutableRefObject<Map<string, HTMLDivElement>>;
  activeFilter: 'all' | 'domestic' | 'international';
}

const FlightPool: React.FC<FlightPoolProps> = ({ 
  unassignedFlights, 
  onDropFlight,
  selectedFlightIds,
  onFlightClick,
  setSelectedFlightIds,
  startDate,
  totalDurationMs,
  flightPositions,
  onFlightContextMenu,
  ruleOverrides,
  highlightedFlightId,
  flightElements,
  activeFilter
}) => {
  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: ItemTypes.FLIGHT,
    drop: (item: { id: string }) => onDropFlight(item.id),
    collect: (monitor) => ({
      isOver: !!monitor.isOver(),
      canDrop: !!monitor.canDrop(),
    }),
  }), [onDropFlight]);
  
  const poolRef = useRef<HTMLDivElement>(null);
  const [lasso, setLasso] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
  const isLassoing = useRef(false);
  const lassoStartPoint = useRef<{ x: number, y: number } | null>(null);
  
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !poolRef.current) return;
    
    isLassoing.current = true;
    const rect = poolRef.current.getBoundingClientRect();
    const scrollContainer = poolRef.current.closest('.overflow-auto');
    const scrollLeft = scrollContainer?.scrollLeft || 0;
    const scrollTop = scrollContainer?.scrollTop || 0;

    const x = e.clientX - rect.left + scrollLeft;
    const y = e.clientY - rect.top + scrollTop;
    lassoStartPoint.current = { x, y };

    setLasso({ x, y, width: 0, height: 0 });

    if (!e.ctrlKey && !e.metaKey) {
      setSelectedFlightIds(new Set());
    }
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isLassoing.current || !lassoStartPoint.current || !poolRef.current) return;
    
    const rect = poolRef.current.getBoundingClientRect();
    const scrollContainer = poolRef.current.closest('.overflow-auto');
    const scrollLeft = scrollContainer?.scrollLeft || 0;
    const scrollTop = scrollContainer?.scrollTop || 0;

    const currentX = e.clientX - rect.left + scrollLeft;
    const currentY = e.clientY - rect.top + scrollTop;


    const newLasso = {
      x: Math.min(lassoStartPoint.current.x, currentX),
      y: Math.min(lassoStartPoint.current.y, currentY),
      width: Math.abs(currentX - lassoStartPoint.current.x),
      height: Math.abs(currentY - lassoStartPoint.current.y),
    };
    setLasso(newLasso);

    const newSelectedIds = new Set(e.ctrlKey || e.metaKey ? selectedFlightIds : undefined);
    flightElements.current.forEach((cardEl, flightId) => {
        if (cardEl && unassignedFlights.some(f => f.id === flightId)) { // Ensure we only check flights in the pool
            const cardRect = {
              left: cardEl.offsetLeft,
              top: cardEl.offsetTop,
              right: cardEl.offsetLeft + cardEl.offsetWidth,
              bottom: cardEl.offsetTop + cardEl.offsetHeight,
            };

            if (
                cardRect.left < newLasso.x + newLasso.width &&
                cardRect.right > newLasso.x &&
                cardRect.top < newLasso.y + newLasso.height &&
                cardRect.bottom > newLasso.y
            ) {
              newSelectedIds.add(flightId);
            }
        }
    });
    setSelectedFlightIds(newSelectedIds);
  };

  const handleMouseUp = () => {
    isLassoing.current = false;
    lassoStartPoint.current = null;
    setLasso(null);
  };
  
  const maxTrackIndex = unassignedFlights.reduce((max, flight) => {
    const pos = flightPositions.get(flight.id);
    if (pos && pos.trackIndex > max) {
        return pos.trackIndex;
    }
    return max;
  }, -1);

  const contentHeight = Math.max(130, (maxTrackIndex + 1) * (FLIGHT_CARD_HEIGHT + FLIGHT_CARD_MARGIN) + FLIGHT_CARD_MARGIN);

  return (
    <div 
      ref={drop}
      className={`
        h-full w-full flex-shrink-0 relative transition-colors duration-300
        ${isOver && canDrop ? 'bg-blue-500/30' : 'bg-[#3a3a3a]'}
      `}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div ref={poolRef} className="w-full relative select-none bg-[#3a3a3a] min-h-full" style={{ height: `${contentHeight}px` }}>
        {/* 1-Hour continuous vertical grid lines passing through the Flight Pool */}
        {totalDurationMs > 0 && (
          <div 
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              backgroundImage: `linear-gradient(to right, rgba(255, 255, 255, 0.35) 1px, transparent 1px)`,
              backgroundSize: `${100 / (totalDurationMs / (60 * 60 * 1000))}% 100%`
            }}
          />
        )}
        {unassignedFlights.length > 0 ? (
          unassignedFlights.map(flight => {
            const positionInfo = flightPositions.get(flight.id);
            if (!positionInfo || totalDurationMs <= 0) return null;

            const viewStartMs = startDate.getTime();
            const viewEndMs = viewStartMs + totalDurationMs;
            const flightStartMs = flight.scheduledArrival.getTime();
            const flightEndMs = flight.scheduledDeparture.getTime();
        
            if (flightEndMs < viewStartMs || flightStartMs > viewEndMs) {
                return null;
            }
        
            const visibleStartMs = Math.max(flightStartMs, viewStartMs);
            const visibleEndMs = Math.min(flightEndMs, viewEndMs);
        
            const visibleDurationMs = visibleEndMs - visibleStartMs;
            const leftOffsetMs = visibleStartMs - viewStartMs;
        
            const left = (leftOffsetMs / totalDurationMs) * 100;
            const width = (visibleDurationMs / totalDurationMs) * 100;
            const top = positionInfo.trackIndex * (FLIGHT_CARD_HEIGHT + FLIGHT_CARD_MARGIN) + FLIGHT_CARD_MARGIN;
            
            if (width < 0.01) return null;

            const isSearched = flight.id === highlightedFlightId;
            let isHighlighted = false;
            let isDimmed = false;

            let departureIsDomestic: boolean | undefined;
            if (flight.type === 'turnaround') {
                departureIsDomestic = flight.departureIsDomestic;
            } else if (flight.type === 'departure') {
                departureIsDomestic = flight.isDomestic;
            }

            if (activeFilter !== 'all') {
                if (departureIsDomestic !== undefined) {
                    const filterIsDomestic = activeFilter === 'domestic';
                    if (filterIsDomestic === departureIsDomestic) {
                        isHighlighted = true;
                    } else {
                        isDimmed = true;
                    }
                } else {
                    isDimmed = true;
                }
            }

            return (
              <div 
                key={flight.id} 
                ref={node => {
                  if (node) flightElements.current.set(flight.id, node);
                  else flightElements.current.delete(flight.id);
                }}
                className="absolute"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  top: `${top}px`,
                  height: `${FLIGHT_CARD_HEIGHT}px`,
                }}
              >
                  <FlightCard 
                      flight={flight}
                      isSelected={selectedFlightIds.has(flight.id)}
                      onSelect={(e) => onFlightClick(flight.id, e)}
                      isPositioned={true}
                      onContextMenu={(e) => onFlightContextMenu(e, flight.id)}
                      isOverridden={ruleOverrides.has(flight.id)}
                      isSearched={isSearched}
                      isHighlighted={isHighlighted || isSearched}
                      isDimmed={isDimmed && !isSearched}
                  />
              </div>
            )
          })
        ) : (
          <div className="sticky left-0 w-full flex items-center justify-center min-h-[130px] bg-[#3a3a3a] text-gray-300 font-bold text-sm">
            Atanacak uçuş yok.
          </div>
        )}
        {lasso && (
            <div
                className="absolute border-2 border-dashed border-blue-400 bg-blue-400/20 pointer-events-none z-[25]"
                style={{
                    left: lasso.x,
                    top: lasso.y,
                    width: lasso.width,
                    height: lasso.height,
                }}
            />
        )}
      </div>
    </div>
  );
};

export default FlightPool;