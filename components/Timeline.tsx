import React, { useState, useEffect, useRef } from 'react';
import { useDrop } from 'react-dnd';
import { Flight, ItemTypes, MaintenanceBlock } from '../types.ts';
import FlightCard from './FlightCard.tsx';
import { WIDE_BODY_AIRCRAFT, CONCOURSE_LAYOUT, DOMESTIC_CONCOURSES, INTERNATIONAL_CONCOURSES } from '../constants.ts';

interface TimelineLaneProps {
  laneId: string;
  laneType: 'parking' | 'gate';
  flights: Flight[];
  allFlights: Flight[];
  onDropFlight: (flightId: string, laneId: string) => void;
  startDate: Date;
  totalDurationMs: number;
  selectedFlightIds: Set<string>;
  onFlightClick: (flightId: string, event: React.MouseEvent) => void;
  onFlightContextMenu: (event: React.MouseEvent, flightId: string) => void;
  ruleOverrides: Set<string>;
  highlightedFlightId: string | null;
  activeFilter: 'all' | 'domestic' | 'international';
  flightElements: React.MutableRefObject<Map<string, HTMLDivElement>>;
  maintenanceBlocks: MaintenanceBlock[];
  onUpdateMaintenanceBlock: (blockId: string, newTimes: { startTime?: Date, endTime?: Date }) => void;
}

const getRelatedMarsPositions = (pos: string): string[] => {
    const baseMatch = pos.match(/^([A-Z\d]+)/);
    if (!baseMatch) return [];
    const basePosition = baseMatch[1];
    
    if (pos.endsWith('L') || pos.endsWith('R')) {
        return [basePosition];
    } else {
        return [`${basePosition}L`, `${basePosition}R`];
    }
};

const getParkingPositionType = (pos: string): 'domestic' | 'international' | 'mixed' => {
    const concourse = Object.keys(CONCOURSE_LAYOUT).find(c => CONCOURSE_LAYOUT[c].includes(pos));
    if (concourse) {
        if (DOMESTIC_CONCOURSES.has(concourse)) return 'domestic';
        if (INTERNATIONAL_CONCOURSES.has(concourse)) return 'international';
    }
    return 'mixed';
};


export const TimelineLane: React.FC<TimelineLaneProps> = ({ 
    laneId,
    laneType,
    flights, 
    allFlights, 
    onDropFlight, 
    startDate, 
    totalDurationMs, 
    selectedFlightIds, 
    onFlightClick, 
    onFlightContextMenu, 
    ruleOverrides,
    highlightedFlightId,
    activeFilter,
    flightElements,
    maintenanceBlocks,
    onUpdateMaintenanceBlock
}) => {
    const laneRef = useRef<HTMLDivElement | null>(null);

    const handleResizeStart = (e: React.MouseEvent, blockId: string, handle: 'start' | 'end') => {
        e.preventDefault();
        e.stopPropagation();

        const initialX = e.clientX;
        const block = maintenanceBlocks.find(b => b.id === blockId);
        if (!block || !laneRef.current) return;

        const laneWidth = laneRef.current.clientWidth;
        const msPerPixel = totalDurationMs / laneWidth;
        const initialStartTime = block.startTime.getTime();
        const initialEndTime = block.endTime.getTime();

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - initialX;
            const deltaMs = Math.round(deltaX * msPerPixel);

            if (handle === 'start') {
                const newStartTime = new Date(initialStartTime + deltaMs);
                if (newStartTime < block.endTime) {
                    onUpdateMaintenanceBlock(blockId, { startTime: newStartTime });
                }
            } else { // 'end'
                const newEndTime = new Date(initialEndTime + deltaMs);
                if (newEndTime > block.startTime) {
                    onUpdateMaintenanceBlock(blockId, { endTime: newEndTime });
                }
            }
        };

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    };


    const [{ isOver, canDrop, isDragging }, drop] = useDrop(() => ({
        accept: ItemTypes.FLIGHT,
        drop: (item: { id: string }) => onDropFlight(item.id, laneId),
        canDrop: (item: { id: string }) => {
            const draggedFlight = allFlights.find(f => f.id === item.id);
            if (!draggedFlight) return false;

            const flightsOnThisLane = allFlights.filter(f => laneType === 'parking' ? f.parkingPosition === laneId : f.gate === laneId);

            const hasTimeOverlap = flightsOnThisLane.some(
                existingFlight =>
                    existingFlight.id !== draggedFlight.id &&
                    draggedFlight.scheduledArrival < existingFlight.scheduledDeparture &&
                    draggedFlight.scheduledDeparture > existingFlight.scheduledArrival
            );
            if (hasTimeOverlap) return false;

            if (laneType === 'parking') {
                const hasMaintenanceConflict = maintenanceBlocks.some(block =>
                    draggedFlight.scheduledArrival < block.endTime &&
                    draggedFlight.scheduledDeparture > block.startTime
                );
                if (hasMaintenanceConflict) return false;

                if (!ruleOverrides.has(draggedFlight.id)) {
                    let isDepartureDomestic: boolean | null = null;
                    if (draggedFlight.type === 'turnaround') {
                        isDepartureDomestic = draggedFlight.departureIsDomestic ?? false;
                    } else if (draggedFlight.type === 'departure') {
                        isDepartureDomestic = draggedFlight.isDomestic;
                    }
                    
                    if (isDepartureDomestic !== null) {
                        const gateType = getParkingPositionType(laneId);
                        if (gateType === 'domestic' && !isDepartureDomestic) return false;
                        if (gateType === 'international' && isDepartureDomestic) return false;
                    }

                    const isWideBody = WIDE_BODY_AIRCRAFT.has(draggedFlight.aircraftType);
                    const isCenterPosition = !laneId.endsWith('L') && !laneId.endsWith('R');
                    if (isWideBody && !isCenterPosition) {
                        return false;
                    }
                }

                const relatedPositions = getRelatedMarsPositions(laneId);
                if (relatedPositions.length > 0) {
                     const assignedFlightsOnRelatedPositions = allFlights.filter(f =>
                        f.id !== draggedFlight.id &&
                        f.parkingPosition && relatedPositions.includes(f.parkingPosition)
                    );

                    const draggedArrival = draggedFlight.scheduledArrival.getTime();
                    const draggedDeparture = draggedFlight.scheduledDeparture.getTime();

                    const hasMarsConflict = assignedFlightsOnRelatedPositions.some(existingFlight => 
                        draggedArrival < existingFlight.scheduledDeparture.getTime() &&
                        draggedDeparture > existingFlight.scheduledArrival.getTime()
                    );
                     if (hasMarsConflict) return false;
                }
            }
           
            return true;
        },
        collect: (monitor) => ({
            isOver: monitor.isOver(),
            canDrop: monitor.canDrop(),
            isDragging: !!monitor.getItem(),
        }),
    }), [onDropFlight, laneId, allFlights, ruleOverrides, maintenanceBlocks, laneType]);

    let laneBgClass = 'bg-[#3a3a3a]';
    if (isDragging) {
        if (isOver) {
            laneBgClass = canDrop
                ? 'bg-emerald-600/75 border-l-4 border-l-emerald-300 ring-2 ring-emerald-400/90 z-20 shadow-lg'
                : 'bg-rose-600/75 border-l-4 border-l-rose-300 ring-2 ring-rose-400/90 z-20 shadow-lg';
        } else {
            laneBgClass = canDrop
                ? 'bg-emerald-950/50 border-l-4 border-l-emerald-500/80 transition-colors'
                : 'bg-rose-950/40 border-l-4 border-l-rose-500/60 opacity-70 transition-colors';
        }
    }

    return (
        <div 
            ref={(node) => {
                drop(node);
                if (laneRef) (laneRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            }} 
            className={`
                h-10 border-b border-gray-600/70 relative
                transition-colors duration-200 ${laneBgClass}
            `}
        >
            {/* 1-Hour continuous vertical grid lines passing through the lane */}
            {totalDurationMs > 0 && (
                <div 
                    className="absolute inset-0 pointer-events-none z-10"
                    style={{
                        backgroundImage: `linear-gradient(to right, rgba(255, 255, 255, 0.35) 1px, transparent 1px)`,
                        backgroundSize: `${100 / (totalDurationMs / (60 * 60 * 1000))}% 100%`
                    }}
                />
            )}

            {/* MARS Conflict Shadow Overlay (Gölgeleme) */}
            {laneType === 'parking' && (() => {
                const relatedPositions = getRelatedMarsPositions(laneId);
                if (relatedPositions.length === 0 || totalDurationMs <= 0) return null;

                const marsSiblingFlights = allFlights.filter(f => 
                    f.parkingPosition && relatedPositions.includes(f.parkingPosition)
                );

                const viewStartMs = startDate.getTime();
                const viewEndMs = viewStartMs + totalDurationMs;

                return marsSiblingFlights.map(siblingFlight => {
                    const flightStartMs = siblingFlight.scheduledArrival.getTime();
                    const flightEndMs = siblingFlight.scheduledDeparture.getTime();

                    if (flightEndMs < viewStartMs || flightStartMs > viewEndMs) return null;

                    const visibleStartMs = Math.max(flightStartMs, viewStartMs);
                    const visibleEndMs = Math.min(flightEndMs, viewEndMs);

                    const left = ((visibleStartMs - viewStartMs) / totalDurationMs) * 100;
                    const width = ((visibleEndMs - visibleStartMs) / totalDurationMs) * 100;

                    return (
                        <div
                            key={`mars-shadow-${siblingFlight.id}-${laneId}`}
                            className="absolute top-2.5 bottom-2.5 rounded border border-gray-400/50 bg-zinc-600/75 shadow-inner z-5 pointer-events-none flex items-center justify-center"
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`MARS Kapalı Pozisyon (${siblingFlight.parkingPosition} üzerinde ${siblingFlight.arrivalFlightNumber || siblingFlight.departureFlightNumber} var)`}
                        >
                            <div className="w-full h-full rounded opacity-35 bg-[repeating-linear-gradient(45deg,#000,#000_6px,transparent_6px,transparent_12px)]" />
                        </div>
                    );
                });
            })()}
            {maintenanceBlocks.map(block => {
                if (totalDurationMs <= 0) return null;
                const viewStartMs = startDate.getTime();
                const viewEndMs = viewStartMs + totalDurationMs;
                const blockStartMs = block.startTime.getTime();
                const blockEndMs = block.endTime.getTime();

                if (blockEndMs < viewStartMs || blockStartMs > viewEndMs) return null;

                const visibleStartMs = Math.max(blockStartMs, viewStartMs);
                const visibleEndMs = Math.min(blockEndMs, viewEndMs);
                const left = ((visibleStartMs - viewStartMs) / totalDurationMs) * 100;
                const width = ((visibleEndMs - visibleStartMs) / totalDurationMs) * 100;

                return (
                    <div
                        key={block.id}
                        className="absolute top-0 bottom-0 opacity-70 group"
                        style={{ 
                            left: `${left}%`, 
                            width: `${width}%`,
                            backgroundImage: 'repeating-linear-gradient(45deg, #f59e0b, #f59e0b 10px, #1f2937 10px, #1f2937 20px)',
                            backgroundSize: '28.28px 28.28px'
                        }}
                        title={`Bakım: ${block.reason}\n${block.startTime.toLocaleTimeString()} - ${block.endTime.toLocaleTimeString()}`}
                    >
                         <div
                            onMouseDown={(e) => handleResizeStart(e, block.id, 'start')}
                            className="absolute top-0 left-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-yellow-400/50"
                        />
                        <div
                            onMouseDown={(e) => handleResizeStart(e, block.id, 'end')}
                            className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-yellow-400/50"
                        />
                    </div>
                );
            })}
            {flights.map(flight => {
                if (totalDurationMs <= 0) return null;

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
                        isDimmed = true; // Arrival-only legs are dimmed when a filter is active
                    }
                }


                return (
                    <div
                        key={flight.id}
                        ref={node => {
                            if (node) flightElements.current.set(flight.id, node);
                            else flightElements.current.delete(flight.id);
                        }}
                        className="absolute top-4 bottom-4 rounded-md overflow-hidden z-10"
                        style={{ left: `${left}%`, width: `${width}%` }}
                    >
                        <FlightCard 
                            flight={flight} 
                            isPositioned={true} 
                            isSelected={selectedFlightIds.has(flight.id)} 
                            onSelect={(e) => onFlightClick(flight.id, e)}
                            onContextMenu={(e) => onFlightContextMenu(e, flight.id)}
                            isOverridden={ruleOverrides.has(flight.id)}
                            isSearched={isSearched}
                            isHighlighted={isHighlighted || isSearched}
                            isDimmed={isDimmed && !isSearched}
                        />
                    </div>
                );
            })}
        </div>
    );
};

export const TimelineHeader: React.FC<{startDate: Date, totalDurationMs: number}> = ({ startDate, totalDurationMs }) => {
    if (totalDurationMs <= 0) return null;
    const totalHours = totalDurationMs / (1000 * 60 * 60);

    const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
    const dateOptions: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' };

    const hourBlocks = [];
    for (let i = 0; i < Math.floor(totalHours); i++) {
        const date = new Date(startDate.getTime() + i * 60 * 60 * 1000);
        const dayChanged = date.getHours() === 0 && i > 0;
        
        hourBlocks.push({
            hourLabel: dayChanged 
                ? date.toLocaleDateString('tr-TR', dateOptions) 
                : date.toLocaleTimeString('tr-TR', timeOptions),
            isDayMarker: dayChanged,
            subTicks: ['10', '20', '30', '40', '50']
        });
    }

    return (
        <div className="h-10 border-b-2 border-gray-600 flex bg-[#2b2b2b] select-none">
            <div className="flex-grow grid" style={{ gridTemplateColumns: `repeat(${hourBlocks.length}, 1fr)`}}>
                {hourBlocks.map((block, index) => (
                    <div key={index} className={`flex flex-col border-r border-gray-400/50 ${block.isDayMarker ? 'bg-amber-950/40' : ''}`}>
                        <div className={`text-[11px] font-bold text-center border-b border-gray-700 py-0.5 ${block.isDayMarker ? 'text-amber-400 font-bold' : 'text-amber-300'}`}>
                            {block.hourLabel}
                        </div>
                        <div className="flex-grow grid grid-cols-6 text-[9px] text-gray-400 text-center items-center">
                            <span className="font-mono text-[8px] text-gray-300">00</span>
                            {block.subTicks.map((tick, tIdx) => (
                                <span key={tIdx} className="font-mono text-[8px] text-gray-400">
                                    {tick}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export const ConcourseOccupancyBar: React.FC<{
    concourseName: string;
    positions: string[];
    flightsByParkingPosition: Record<string, Flight[]>;
    startDate: Date;
    totalDurationMs: number;
}> = ({ positions, flightsByParkingPosition, startDate, totalDurationMs }) => {
    if (totalDurationMs <= 0) return null;

    const totalSlots = Math.max(1, Math.floor(totalDurationMs / (10 * 60 * 1000)));
    const slotDurationMs = 10 * 60 * 1000;
    const startMs = startDate.getTime();

    const concourseFlights: Flight[] = [];
    positions.forEach(pos => {
        if (flightsByParkingPosition[pos]) {
            concourseFlights.push(...flightsByParkingPosition[pos]);
        }
    });

    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
        const slotStart = startMs + i * slotDurationMs;
        const slotEnd = slotStart + slotDurationMs;

        const count = concourseFlights.filter(f => 
            f.scheduledArrival.getTime() < slotEnd && f.scheduledDeparture.getTime() > slotStart
        ).length;

        // Color scale matching reference app:
        // 0: Dark Green (#1B5E20)
        // 1-2: Bright Green (#2E7D32)
        // 3-4: Medium Green (#388E3C)
        // 5-7: Amber/Yellow (#F9A825)
        // 8+: Red (#B71C1C)
        let bg = '#1B5E20';
        if (count > 0 && count <= 2) bg = '#2E7D32';
        else if (count >= 3 && count <= 4) bg = '#388E3C';
        else if (count >= 5 && count <= 7) bg = '#F9A825';
        else if (count >= 8) bg = '#B71C1C';

        slots.push({ count, bg });
    }

    return (
        <div className="h-10 border-b border-gray-700 flex w-full bg-gray-900 select-none">
            <div className="flex-grow grid" style={{ gridTemplateColumns: `repeat(${totalSlots}, 1fr)` }}>
                {slots.map((slot, index) => (
                    <div 
                        key={index} 
                        className="flex items-center justify-center text-xs font-bold text-white border-r border-gray-950/30 transition-colors"
                        style={{ backgroundColor: slot.bg }}
                        title={`Zaman Dilimi: ${new Date(startMs + index * slotDurationMs).toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}\nAtanmış Uçuş: ${slot.count}`}
                    >
                        {slot.count}
                    </div>
                ))}
            </div>
        </div>
    );
};


export const CurrentTimeIndicator: React.FC<{ startDate: Date, totalDurationMs: number }> = ({ startDate, totalDurationMs }) => {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, 60000); // Update every minute
        return () => clearInterval(timer);
    }, []);

    if (totalDurationMs <= 0) return null;

    const elapsedMs = now.getTime() - startDate.getTime();
    if (elapsedMs < 0 || elapsedMs > totalDurationMs) return null;

    const leftPercentage = (elapsedMs / totalDurationMs) * 100;

    return (
        <div 
            className="absolute top-0 bottom-0 z-20 pointer-events-none"
            style={{ left: `${leftPercentage}%` }}
            title={`Current Time: ${now.toLocaleTimeString('tr-TR')}`}
        >
            <div className="w-[2px] h-full bg-red-500 opacity-80"></div>
            <div className="absolute -top-2.5 -translate-x-1/2">
                <div className="text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5 whitespace-nowrap">
                    {now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>
        </div>
    );
};