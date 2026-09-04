import React, { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import * as XLSX from 'xlsx';
import { Flight, FlightHistoryEntry, MaintenanceBlock } from './types.ts';
import { PARKING_POSITIONS, WIDE_BODY_AIRCRAFT, FLIGHT_CARD_HEIGHT, FLIGHT_CARD_MARGIN, TURKISH_DOMESTIC_AIRPORTS, CONCOURSE_LAYOUT, MAX_INITIAL_POOL_TRACKS, SORTED_PARKING_POSITIONS, GATES } from './constants.ts';
import FlightPool from './components/FlightPool.tsx';
import { TimelineHeader, TimelineLane, CurrentTimeIndicator, ConcourseOccupancyBar } from './components/Timeline.tsx';
import ColumnMappingModal, { Mapping, ImportMode } from './components/ColumnMappingModal.tsx';
import FlightContextMenu from './components/FlightContextMenu.tsx';
import FlightHistoryModal from './components/FlightHistoryModal.tsx';
import FlightTrackingModal from './components/FlightTrackingModal.tsx';
import MaintenanceModal from './components/MaintenanceModal.tsx';
import ExcelErrorModal from './components/ExcelErrorModal.tsx';
import ExcelImportReportModal, { ImportReport } from './components/ExcelImportReportModal.tsx';
import MaintenanceManagementModal from './components/MaintenanceManagementModal.tsx';
import GateAssignmentModal from './components/GateAssignmentModal.tsx';
import AdminPanel from './auth/AdminPanel.tsx';
import ChangePasswordModal from './auth/ChangePasswordModal.tsx';
import CustomDragLayer from './components/CustomDragLayer.tsx';
import HeaderRevenueSummary from './components/HeaderRevenueSummary.tsx';
import BottomRevenueSummaryBar from './components/BottomRevenueSummaryBar.tsx';
import { database } from './firebase.ts';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { User } from 'firebase/auth';
import { signOutUser } from './auth/auth-service.ts';

const SINGLE_LEG_DURATION_MS = 60 * 60 * 1000; // 1 hour for visualization

interface ParsedFlightsResult {
    flights: Flight[];
    errors: { rowIndex: number, reason: string, rowData: any }[];
}

const calculateLayout = (flights: Flight[]) => {
    const tracks: Flight[][] = [];
    const flightPositions = new Map<string, { trackIndex: number }>();

    const sortedFlights = [...flights].sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());

    for (const flight of sortedFlights) {
        let placed = false;
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const hasOverlap = track.some(
                existingFlight =>
                    flight.scheduledArrival < existingFlight.scheduledDeparture &&
                    flight.scheduledDeparture > existingFlight.scheduledArrival
            );

            if (!hasOverlap) {
                track.push(flight);
                flightPositions.set(flight.id, { trackIndex: i });
                placed = true;
                break;
            }
        }

        if (!placed) {
            const newTrackIndex = tracks.length;
            tracks.push([flight]);
            flightPositions.set(flight.id, { trackIndex: newTrackIndex });
        }
    }
    return { flightPositions };
};

const extractValidParkingPosition = (rawPosition: any): string | null => {
    if (rawPosition === null || rawPosition === undefined || rawPosition === '') return null;
    const rawStr = String(rawPosition).toUpperCase().trim();
    if (!rawStr || rawStr === 'NULL' || rawStr === 'NONE' || rawStr === '-' || rawStr === 'BUS') return null;

    // 1. Direct match with alphanumeric string (e.g. "A2", "201", "B8R", "C-03" -> "C03")
    const cleanPos = rawStr.replace(/[^A-Z0-9]/g, '');
    if (PARKING_POSITIONS.includes(cleanPos)) {
        return cleanPos;
    }

    // 2. Unpadded variation (e.g. "A02" -> "A2", "C03" -> "C3", "0101" -> "101", "B08R" -> "B8R")
    const unpaddedPos = cleanPos.replace(/^([A-Z]+)0+(\d+)/, '$1$2').replace(/^0+(\d+)/, '$1');
    if (PARKING_POSITIONS.includes(unpaddedPos)) {
        return unpaddedPos;
    }

    // 3. Match using sorted parking positions list
    for (const validPos of SORTED_PARKING_POSITIONS) {
        if (cleanPos === validPos || cleanPos.startsWith(validPos) || cleanPos.endsWith(validPos)) {
            return validPos;
        }
    }
    return null;
};


const parseTurnaroundDataWithMapping = (rawData: any[], mapping: Mapping, startDate: Date): ParsedFlightsResult => {
    const errors: { rowIndex: number, reason: string, rowData: any }[] = [];
    const m = {
        arrNum: mapping.arrivalFlightNumber!,
        depNum: mapping.departureFlightNumber!,
        arrDateTime: mapping.arrivalDateTime!,
        depDateTime: mapping.departureDateTime!,
        ac: mapping.aircraftType!,
        regNo: mapping.regNo,
        origin: mapping.origin!,
        dest: mapping.destination!,
        parkingPosition: mapping.parkingPosition,
        arrParkingPosition: mapping.arrivalParkingPosition,
        depParkingPosition: mapping.departureParkingPosition,
        arrMode: mapping.arrivalMode,
        depMode: mapping.departureMode,
        gate: mapping.gate,
        arrGate: mapping.arrivalGate,
        depGate: mapping.departureGate,
    };

    const flights = rawData.flatMap((row, i): Flight[] => {
        // Skip footer/summary lines (like "Number of rows: 460")
        const rowString = JSON.stringify(row);
        if (rowString.includes('Number of rows') || rowString.includes('TOTAL') || rowString.includes('Total')) {
            return [];
        }

        let rawArrDate = combineDateAndTime(null, row[m.arrDateTime], startDate);
        let rawDepDate = combineDateAndTime(null, row[m.depDateTime], startDate);

        // Filter out 1899 zero-dates
        if (rawArrDate && rawArrDate.getFullYear() < 1970) rawArrDate = null;
        if (rawDepDate && rawDepDate.getFullYear() < 1970) rawDepDate = null;

        const hasArrival = !!rawArrDate;
        const hasDeparture = !!rawDepDate;

        if (!hasArrival && !hasDeparture) {
            const arrNumStr = String(row[m.arrNum] || '').trim();
            const depNumStr = String(row[m.depNum] || '').trim();
            if (arrNumStr || depNumStr) {
                errors.push({ rowIndex: i + 2, reason: "Geçersiz geliş/gidiş zamanı formatı.", rowData: row });
            }
            return [];
        }

        const arrivalFlightNumber = String(row[m.arrNum] || '').trim();
        const departureFlightNumber = String(row[m.depNum] || '').trim();
        const origin = String(row[m.origin] || '').trim();
        const destination = String(row[m.dest] || '').trim();
        const aircraftType = String(row[m.ac] || '').trim();
        const rawRegNo = m.regNo ? String(row[m.regNo] ?? '').toUpperCase().trim() : (row['RegNo'] || row['RegNo_1'] || row['Reg No'] || row['Reg'] || '');
        const regNo = rawRegNo && rawRegNo !== 'NULL' && rawRegNo !== 'NONE' ? rawRegNo : undefined;
        const airlineCode = (arrivalFlightNumber || departureFlightNumber).substring(0, 2);

        const mtowKey = mapping.mtow;
        const rawMtowVal = mtowKey ? row[mtowKey] : (row['MTOW'] || row['mtow'] || row['Max MTOW'] || row['MTOW (Tons)']);
        let mtowVal: number | undefined = undefined;
        if (rawMtowVal !== undefined && rawMtowVal !== null && rawMtowVal !== '') {
            const parsed = parseFloat(String(rawMtowVal).replace(/[^0-9.]/g, ''));
            if (!isNaN(parsed) && parsed > 0) {
                mtowVal = parsed > 1000 ? Math.ceil(parsed / 1000) : Math.ceil(parsed);
            }
        }

        const arrivalIsDomestic = m.arrMode ? String(row[m.arrMode] ?? '').toUpperCase().startsWith('D') : TURKISH_DOMESTIC_AIRPORTS.has(origin);
        const departureIsDomestic = m.depMode ? String(row[m.depMode] ?? '').toUpperCase().startsWith('D') : TURKISH_DOMESTIC_AIRPORTS.has(destination);
        const departureMode = m.depMode ? String(row[m.depMode] ?? '').toUpperCase().trim() : undefined;
        
        const arrGateStr = m.arrGate ? String(row[m.arrGate] ?? '').toUpperCase().trim() || null : null;
        const depGateStr = m.depGate ? String(row[m.depGate] ?? '').toUpperCase().trim() || null : null;
        const genGateStr = m.gate ? String(row[m.gate] ?? '').toUpperCase().trim() || null : null;
        const gate = arrGateStr || depGateStr || genGateStr || null;

        const generalPos = extractValidParkingPosition(m.parkingPosition ? row[m.parkingPosition] : null);
        const arrPos = extractValidParkingPosition(m.arrParkingPosition ? row[m.arrParkingPosition] : null);
        const depPos = extractValidParkingPosition(m.depParkingPosition ? row[m.depParkingPosition] : null);

        // Case 1: Both arrival & departure dates exist -> Turnaround or split arrival/departure legs
        if (hasArrival && hasDeparture) {
            const arrival = rawArrDate!;
            const departure = rawDepDate!;
            if (departure < arrival) {
                departure.setDate(departure.getDate() + 1);
            }

            const baseFlightData = {
                airline: airlineCode,
                aircraftType,
                regNo,
                mtow: mtowVal,
                raw_data: row,
                history: [],
                arrivalFlightNumber,
                departureFlightNumber,
                origin,
                destination,
                scheduledArrival: arrival,
                scheduledDeparture: departure,
                isDomestic: arrivalIsDomestic && departureIsDomestic,
                arrivalIsDomestic,
                departureIsDomestic,
                departureMode,
                gate: gate,
            };

            if (arrPos && depPos && arrPos !== depPos) {
                const arrivalLeg: Flight = {
                    ...baseFlightData,
                    id: `${arrivalFlightNumber || 'ARR'}-${arrival.toISOString()}-arr-${i}`,
                    type: 'arrival',
                    departureFlightNumber: undefined,
                    destination: undefined,
                    scheduledDeparture: new Date(arrival.getTime() + SINGLE_LEG_DURATION_MS),
                    isDomestic: arrivalIsDomestic,
                    parkingPosition: arrPos,
                };
                const departureLeg: Flight = {
                    ...baseFlightData,
                    id: `${departureFlightNumber || 'DEP'}-${departure.toISOString()}-dep-${i}`,
                    type: 'departure',
                    arrivalFlightNumber: undefined,
                    origin: undefined,
                    scheduledArrival: new Date(departure.getTime() - SINGLE_LEG_DURATION_MS),
                    isDomestic: departureIsDomestic,
                    parkingPosition: depPos,
                };
                return [arrivalLeg, departureLeg];
            } else {
                const turnaroundFlight: Flight = {
                    ...baseFlightData,
                    id: `${arrivalFlightNumber || departureFlightNumber}-${arrival.toISOString()}-${i}`,
                    type: 'turnaround',
                    parkingPosition: arrPos || depPos || generalPos,
                };
                return [turnaroundFlight];
            }
        }

        // Case 2: Only Arrival date exists -> Single Arrival Leg
        if (hasArrival && !hasDeparture) {
            const arrival = rawArrDate!;
            const singleArrivalFlight: Flight = {
                id: `${arrivalFlightNumber || 'ARR'}-${arrival.toISOString()}-single-arr-${i}`,
                type: 'arrival',
                arrivalFlightNumber,
                departureFlightNumber: undefined,
                airline: airlineCode,
                origin,
                destination: undefined,
                aircraftType,
                regNo,
                scheduledArrival: arrival,
                scheduledDeparture: new Date(arrival.getTime() + SINGLE_LEG_DURATION_MS),
                parkingPosition: arrPos || generalPos,
                gate,
                isDomestic: arrivalIsDomestic,
                arrivalIsDomestic,
                departureIsDomestic: false,
                departureMode,
                raw_data: row,
                history: []
            };
            return [singleArrivalFlight];
        }

        // Case 3: Only Departure date exists -> Single Departure Leg
        if (!hasArrival && hasDeparture) {
            const departure = rawDepDate!;
            const singleDepartureFlight: Flight = {
                id: `${departureFlightNumber || 'DEP'}-${departure.toISOString()}-single-dep-${i}`,
                type: 'departure',
                arrivalFlightNumber: undefined,
                departureFlightNumber,
                airline: airlineCode,
                origin: undefined,
                destination,
                aircraftType,
                regNo,
                scheduledArrival: new Date(departure.getTime() - SINGLE_LEG_DURATION_MS),
                scheduledDeparture: departure,
                parkingPosition: depPos || generalPos,
                gate,
                isDomestic: departureIsDomestic,
                arrivalIsDomestic: false,
                departureIsDomestic,
                departureMode,
                raw_data: row,
                history: []
            };
            return [singleDepartureFlight];
        }

        return [];
    });
    
    return { flights: flights.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime()), errors };
};


const pairAndParseFlightData = (rawData: any[], startDate: Date, mapping: Mapping): ParsedFlightsResult => {
    const HOME_AIRPORT = 'IST'; 
    const errors: { rowIndex: number, reason: string, rowData: any }[] = [];

    const m = {
        flightNumber: mapping.flightNumber!,
        date: mapping.date,
        time: mapping.time!,
        aircraftType: mapping.aircraftType!,
        origin: mapping.origin!,
        destination: mapping.destination!,
        parkingPosition: mapping.parkingPosition,
        flightMode: mapping.flightMode,
        gate: mapping.gate,
    };

    interface FlightLeg {
        type: 'arrival' | 'departure';
        flightNumber: string;
        time: Date;
        airport: string; 
        aircraftType: string;
        isDomesticLeg: boolean;
        flightMode?: string;
        parkingPosition: string | null;
        gate: string | null;
        raw_data: any;
    }
    
    const parseTime = (timeValue: any, baseDate: Date) => {
        const date = new Date(baseDate);
        if (timeValue instanceof Date) {
            const cellDate = timeValue;
            if (cellDate.getFullYear() > 1970) { 
                return cellDate;
            }
            date.setHours(timeValue.getHours(), timeValue.getMinutes(), 0, 0);
            return date;
        }
        if (typeof timeValue === 'string' && timeValue.includes(':')) {
            const [hours, minutes] = timeValue.split(':').map(Number);
            if (!isNaN(hours) && !isNaN(minutes)) {
                date.setHours(hours, minutes, 0, 0);
                return date;
            }
        }
        if (typeof timeValue === 'number' && timeValue > 0 && timeValue < 1) { 
             const totalSeconds = timeValue * 24 * 60 * 60;
             const hours = Math.floor(totalSeconds / 3600);
             const minutes = Math.floor((totalSeconds % 3600) / 60);
             date.setHours(hours, minutes, 0, 0);
             return date;
        }
        return null;
    };
    
    if (!rawData || rawData.length === 0) return { flights: [], errors };

    const allLegs: FlightLeg[] = rawData.map((row, i): FlightLeg | null => {
        const origin = row[m.origin];
        const dest = row[m.destination];
        
        let type: 'arrival' | 'departure' | null = null;
        let airport: string | null = null;
        
        if (dest && String(dest).toUpperCase().includes(HOME_AIRPORT)) {
            type = 'arrival';
            airport = origin;
        } else if (origin && String(origin).toUpperCase().includes(HOME_AIRPORT)) {
            type = 'departure';
            airport = dest;
        } else {
            errors.push({ rowIndex: i + 2, reason: "Satır bir geliş veya gidiş olarak tanımlanamadı.", rowData: row });
            return null;
        }

        const legDate = m.date && row[m.date] ? new Date(row[m.date]) : startDate;
        const time = parseTime(row[m.time], legDate);

        if (!time || !airport) {
            errors.push({ rowIndex: i + 2, reason: "Geçersiz saat veya havalimanı bilgisi.", rowData: row });
            return null;
        }

        const parkingPosition = extractValidParkingPosition(m.parkingPosition ? row[m.parkingPosition] : null);
        const flightModeRaw = m.flightMode ? String(row[m.flightMode] ?? '').toUpperCase().trim() : undefined;
        const isDomesticLeg = flightModeRaw ? flightModeRaw.startsWith('D') : TURKISH_DOMESTIC_AIRPORTS.has(String(airport));
        const gate = m.gate ? String(row[m.gate] ?? '').toUpperCase().trim() || null : null;


        return {
            type,
            airport: String(airport),
            time,
            flightNumber: String(row[m.flightNumber]),
            aircraftType: String(row[m.aircraftType]),
            isDomesticLeg,
            flightMode: flightModeRaw,
            parkingPosition,
            gate,
            raw_data: row,
        };
    }).filter((f): f is FlightLeg => f !== null);

    const legsByAircraft = allLegs.reduce((acc, leg) => {
        const key = leg.aircraftType;
        if (!acc[key]) acc[key] = [];
        acc[key].push(leg);
        return acc;
    }, {} as Record<string, FlightLeg[]>);
    
    const flights: Flight[] = [];
    let flightCounter = 0;
    
    for (const ac in legsByAircraft) {
        const sortedLegs = legsByAircraft[ac].sort((a, b) => a.time.getTime() - b.time.getTime());
        
        for (let i = 0; i < sortedLegs.length - 1; i++) {
            const currentLeg = sortedLegs[i];
            const nextLeg = sortedLegs[i+1];
            
            if (currentLeg.type === 'arrival' && nextLeg.type === 'departure') {
                const arrivalLeg = currentLeg;
                const departureLeg = nextLeg;
                
                if (departureLeg.time < arrivalLeg.time) {
                   if (departureLeg.time.getDate() === arrivalLeg.time.getDate()) {
                       departureLeg.time.setDate(departureLeg.time.getDate() + 1);
                   }
                }
                
                flights.push({
                    id: `${arrivalLeg.flightNumber}-${arrivalLeg.time.toISOString()}-${flightCounter++}`,
                    type: 'turnaround',
                    arrivalFlightNumber: arrivalLeg.flightNumber,
                    departureFlightNumber: departureLeg.flightNumber,
                    airline: arrivalLeg.flightNumber.substring(0, 2),
                    origin: arrivalLeg.airport,
                    destination: departureLeg.airport,
                    aircraftType: ac,
                    scheduledArrival: arrivalLeg.time,
                    scheduledDeparture: departureLeg.time,
                    isDomestic: arrivalLeg.isDomesticLeg && departureLeg.isDomesticLeg,
                    arrivalIsDomestic: arrivalLeg.isDomesticLeg,
                    departureIsDomestic: departureLeg.isDomesticLeg,
                    departureMode: departureLeg.flightMode,
                    parkingPosition: arrivalLeg.parkingPosition,
                    gate: arrivalLeg.gate || departureLeg.gate || null,
                    raw_data: { arrival: arrivalLeg.raw_data, departure: departureLeg.raw_data },
                    history: [],
                });
                
                i++; 
            }
        }
    }
    
    return { flights: flights.sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime()), errors };
};


const combineDateAndTime = (dateValue: any, timeValue: any, defaultDate: Date): Date | null => {
    const parseAnyCell = (cellValue: any): Date | null => {
        if (cellValue === null || cellValue === undefined || cellValue === '') return null;
        if (cellValue instanceof Date && !isNaN(cellValue.getTime())) {
            return cellValue;
        }
        if (typeof cellValue === 'string') {
            const str = cellValue.trim();
            if (!str) return null;

            // Turkish format: DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
            const dmyMatch = str.match(/^(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
            if (dmyMatch) {
                const day = parseInt(dmyMatch[1], 10);
                const month = parseInt(dmyMatch[2], 10) - 1;
                const year = parseInt(dmyMatch[3], 10);
                const hours = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
                const minutes = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
                const seconds = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
                const d = new Date(year, month, day, hours, minutes, seconds);
                if (!isNaN(d.getTime())) return d;
            }

            // ISO format: YYYY-MM-DD or YYYY/MM/DD
            const ymdMatch = str.match(/^(\d{4})[\.\/-](\d{1,2})[\.\/-](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
            if (ymdMatch) {
                const year = parseInt(ymdMatch[1], 10);
                const month = parseInt(ymdMatch[2], 10) - 1;
                const day = parseInt(ymdMatch[3], 10);
                const hours = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
                const minutes = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
                const seconds = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
                const d = new Date(year, month, day, hours, minutes, seconds);
                if (!isNaN(d.getTime())) return d;
            }

            const d = new Date(str);
            if (!isNaN(d.getTime())) return d;
        }
        if (typeof cellValue === 'number' && cellValue > 1) { 
            const d = new Date(Math.round((cellValue - 25569) * 86400 * 1000));
            if(!isNaN(d.getTime())) return d;
        }
        return null;
    };
    
    const parsedTimeCell = parseAnyCell(timeValue);
    if (parsedTimeCell && parsedTimeCell.getFullYear() > 1970) {
        return parsedTimeCell;
    }

    const parsedDateCell = parseAnyCell(dateValue);
    const baseDate = parsedDateCell ? new Date(parsedDateCell) : new Date(defaultDate);
    if (isNaN(baseDate.getTime())) return null;
    baseDate.setHours(0, 0, 0, 0); 

    if (timeValue instanceof Date) {
        baseDate.setHours(timeValue.getHours(), timeValue.getMinutes(), timeValue.getSeconds(), 0);
        return baseDate;
    }
    if (typeof timeValue === 'string' && timeValue.includes(':')) {
        const [hours, minutes] = timeValue.split(':').map(Number);
        if (!isNaN(hours) && !isNaN(minutes)) {
            baseDate.setHours(hours, minutes, 0, 0);
            return baseDate;
        }
    }
    if (typeof timeValue === 'number' && timeValue >= 0 && timeValue < 1) {
         const totalSeconds = timeValue * 24 * 60 * 60;
         const hours = Math.floor(totalSeconds / 3600);
         const minutes = Math.floor((totalSeconds % 3600) / 60);
         baseDate.setHours(hours, minutes, 0, 0);
         return baseDate;
    }
    
    if (parsedTimeCell) {
        baseDate.setHours(parsedTimeCell.getHours(), parsedTimeCell.getMinutes(), parsedTimeCell.getSeconds(), 0);
        return baseDate;
    }

    return null;
};


const formatDateForInput = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

const App: React.FC<{ user: User }> = ({ user }) => {
    const currentUser = {
        username: user.email!.split('@')[0],
        isAdmin: user.email!.startsWith('gurkankose@'),
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const [flights, setFlights] = useState<Flight[]>([]);
    const [maintenanceBlocks, setMaintenanceBlocks] = useState<MaintenanceBlock[]>([]);
    const [gateList, setGateList] = useState<string[]>(GATES);
    const [currentView, setCurrentView] = useState<'parking' | 'gate'>('parking');

    const [startDate, setStartDate] = useState<Date>(today);
    const [endDate, setEndDate] = useState<Date>(tomorrow);

    const [isMappingModalOpen, setMappingModalOpen] = useState(false);
    const [isMaintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
    const [isMaintenanceManagementModalOpen, setMaintenanceManagementModalOpen] = useState(false);
    const [isAdminPanelOpen, setAdminPanelOpen] = useState(false);
    const [isChangePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
    const [editingMaintenanceBlock, setEditingMaintenanceBlock] = useState<MaintenanceBlock | null>(null);
    const excelData = useRef<{ data: any[], headers: string[] } | null>(null);
    const [excelErrors, setExcelErrors] = useState<ParsedFlightsResult['errors']>([]);
    const [isExcelErrorModalOpen, setExcelErrorModalOpen] = useState(false);
    const [importReport, setImportReport] = useState<ImportReport | null>(null);
    const [isReportModalOpen, setReportModalOpen] = useState(false);

    const [selectedFlightIds, setSelectedFlightIds] = useState<Set<string>>(new Set());
    const mainContentRef = useRef<HTMLDivElement>(null);
    const timelineContainerRef = useRef<HTMLDivElement>(null);
    const userHasResized = useRef(false);
    const [scale, setScale] = useState(1);
    const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
    const lastMouseX = useRef(0);
    
    const initialCollapsedState = useMemo(() => {
        const state: Record<string, boolean> = {};
        Object.keys(CONCOURSE_LAYOUT).forEach(name => {
            state[name] = false; // Open by default so flights are immediately visible!
        });
        return state;
    }, []);

    const [collapsedConcourses, setCollapsedConcourses] = useState<Record<string, boolean>>(initialCollapsedState);
    const [isPoolCollapsed, setPoolCollapsed] = useState(false);
    const COLLAPSED_POOL_HEIGHT = 40; // px

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flightId: string; } | null>(null);
    const [ruleOverrides, setRuleOverrides] = useState<Set<string>>(new Set());
    const [historyModalFlight, setHistoryModalFlight] = useState<Flight | null>(null);
    const [trackingFlight, setTrackingFlight] = useState<Flight | null>(null);
    const [gateAssignmentFlight, setGateAssignmentFlight] = useState<Flight | null>(null);


    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<'all' | 'domestic' | 'international'>('all');
    const [highlightedFlightId, setHighlightedFlightId] = useState<string | null>(null);
    const [scrollToFlightId, setScrollToFlightId] = useState<string | null>(null);
    const flightElements = useRef(new Map<string, HTMLDivElement>());

    const toggleConcourse = useCallback((concourseName: string) => {
        setCollapsedConcourses(prev => ({
            ...prev,
            [concourseName]: !prev[concourseName]
        }));
    }, []);

    const updateDatabase = (newState: { flights: Flight[], maintenanceBlocks: MaintenanceBlock[], gates?: string[] }) => {
        setFlights(newState.flights);
        setMaintenanceBlocks(newState.maintenanceBlocks);
        if (newState.gates) {
            setGateList(newState.gates);
        }

        try {
            const flightsObject = newState.flights.reduce((acc, flight) => {
                acc[flight.id] = flight;
                return acc;
            }, {} as Record<string, Flight>);

            const maintenanceObject = newState.maintenanceBlocks.reduce((acc, block) => {
                acc[block.id] = block;
                return acc;
            }, {} as Record<string, MaintenanceBlock>);
            
            const updateData: any = {
                flights: flightsObject,
                maintenanceBlocks: maintenanceObject
            };

            if (newState.gates) {
                updateData.gates = newState.gates;
            }
            
            set(ref(database, 'plan'), updateData).catch(err => console.warn('Firebase error:', err));
        } catch (e) {
            console.warn('Firebase error:', e);
        }
    };


    // Listen for real-time data from Firebase
    useEffect(() => {
        const planRef = ref(database, 'plan');
        const unsubscribe = onValue(planRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();

                const reviveDates = (key: string, value: any) => {
                    if (typeof value === 'string' && ['scheduledArrival', 'scheduledDeparture', 'timestamp', 'startTime', 'endTime'].includes(key)) {
                        const d = new Date(value);
                        if (!isNaN(d.getTime())) return d;
                    }
                    return value;
                };
                
                const flightsArray = data.flights ? Object.values(data.flights) : [];
                const maintenanceArray = data.maintenanceBlocks ? Object.values(data.maintenanceBlocks) : [];
                const gatesArray = data.gates ? data.gates : GATES;

                const parsedFlights = JSON.parse(JSON.stringify(flightsArray), reviveDates);
                const parsedMaintenance = JSON.parse(JSON.stringify(maintenanceArray), reviveDates);

                setFlights(parsedFlights);
                setMaintenanceBlocks(parsedMaintenance);
                setGateList(gatesArray.sort((a:string, b:string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
            } else {
                setFlights([]);
                setMaintenanceBlocks([]);
                setGateList(GATES);
            }
        });

        return () => unsubscribe();
    }, []);
    
    // Search and scroll to flight
    useEffect(() => {
        if (!searchQuery) {
            setHighlightedFlightId(null);
            return;
        }

        const lowerCaseQuery = searchQuery.toLowerCase();
        const foundFlight = flights.find(f =>
            f.arrivalFlightNumber?.toLowerCase().includes(lowerCaseQuery) ||
            f.departureFlightNumber?.toLowerCase().includes(lowerCaseQuery) ||
            f.aircraftType.toLowerCase().includes(lowerCaseQuery) ||
            f.origin?.toLowerCase().includes(lowerCaseQuery) ||
            f.destination?.toLowerCase().includes(lowerCaseQuery) ||
            f.gate?.toLowerCase().includes(lowerCaseQuery) ||
            f.parkingPosition?.toLowerCase().includes(lowerCaseQuery)
        );

        if (foundFlight) {
            setHighlightedFlightId(foundFlight.id);
            if (foundFlight.parkingPosition && currentView === 'parking') {
                const concourseEntry = Object.entries(CONCOURSE_LAYOUT).find(([_, positions]) =>
                    positions.includes(foundFlight.parkingPosition!)
                );
                if (concourseEntry) {
                    const [concourseName] = concourseEntry;
                    if (collapsedConcourses[concourseName]) {
                        toggleConcourse(concourseName);
                    }
                }
            }
             setScrollToFlightId(foundFlight.id);
        } else {
            setHighlightedFlightId(null);
        }
    }, [searchQuery, flights, collapsedConcourses, toggleConcourse, currentView]);

     // Effect for scrolling after a potential re-render from concourse expansion
    useLayoutEffect(() => {
        if (scrollToFlightId) {
            const element = flightElements.current.get(scrollToFlightId);
            if (element) {
                 setTimeout(() => {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                    setScrollToFlightId(null);
                }, 100);
            }
        }
    }, [scrollToFlightId, collapsedConcourses]);

    const handleFlightContextMenu = useCallback((event: React.MouseEvent, flightId: string) => {
        event.preventDefault();
        setContextMenu({
            x: event.clientX,
            y: event.clientY,
            flightId,
        });
    }, []);

    const handleShowHistory = useCallback((flightId: string) => {
        const flightToShow = flights.find(f => f.id === flightId);
        if (flightToShow) {
            setHistoryModalFlight(flightToShow);
        }
    }, [flights]);

    const handleShowMap = useCallback((flightId: string) => {
        const flightToTrack = flights.find(f => f.id === flightId);
        if (flightToTrack) {
            setTrackingFlight(flightToTrack);
        }
    }, [flights]);

    const handleOpenGateAssignmentModal = useCallback((flightId: string) => {
        const flightToEdit = flights.find(f => f.id === flightId);
        if (flightToEdit) {
            setGateAssignmentFlight(flightToEdit);
        }
    }, [flights]);
    
    const handleSaveGate = useCallback((flight: Flight, gate: string | null) => {
        const action = gate 
            ? `${gate} gate'i atandı.`
            : `Gate ataması kaldırıldı.`;
        const description = `${flight.arrivalFlightNumber || flight.departureFlightNumber} uçuşu için ${action}`;
        
        const newHistoryEntry: FlightHistoryEntry = {
            user: currentUser.username,
            action: description,
            timestamp: new Date()
        };
    
        const newFlights = flights.map(f => 
            f.id === flight.id
                ? { ...f, gate, history: [...(f.history || []), newHistoryEntry] }
                : f
        );
        
        updateDatabase({ flights: newFlights, maintenanceBlocks, gates: gateList });
        setGateAssignmentFlight(null); // Close modal if open
    }, [flights, maintenanceBlocks, gateList, currentUser.username]);


    const toggleRuleOverride = useCallback((flightId: string) => {
        const flight = flights.find(f => f.id === flightId);
        if (!flight) return;
    
        const isCurrentlyOverridden = ruleOverrides.has(flightId);
        const action = isCurrentlyOverridden ? "Yerleşim kuralı etkinleştirildi." : "Yerleşim kuralı esnetildi.";
        const newHistoryEntry: FlightHistoryEntry = { user: currentUser.username, action, timestamp: new Date() };
    
        const newFlights = flights.map(f =>
            f.id === flightId ? { ...f, history: [...(f.history || []), newHistoryEntry] } : f
        );
        updateDatabase({ flights: newFlights, maintenanceBlocks, gates: gateList });
    
        setRuleOverrides(prev => {
            const newSet = new Set(prev);
            if (newSet.has(flightId)) {
                newSet.delete(flightId);
            } else {
                newSet.add(flightId);
            }
            return newSet;
        });
    }, [flights, maintenanceBlocks, ruleOverrides, currentUser.username, gateList]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (contextMenu && !(event.target as HTMLElement).closest('.context-menu-class')) {
                setContextMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [contextMenu]);


    const handleWheel = (e: React.WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const newScale = Math.max(0.2, scale - e.deltaY * 0.001);
        setScale(newScale);
      }
    };
    
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0 || !mainContentRef.current) return;
        if (e.target !== timelineContainerRef.current && !(timelineContainerRef.current?.contains(e.target as Node))) return;
        setIsDraggingTimeline(true);
        lastMouseX.current = e.clientX;
        mainContentRef.current.style.cursor = 'grabbing';
        mainContentRef.current.style.userSelect = 'none';
    };

    const handleMouseUp = () => {
        setIsDraggingTimeline(false);
        if(mainContentRef.current) {
            mainContentRef.current.style.cursor = 'default';
            mainContentRef.current.style.userSelect = 'auto';
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDraggingTimeline || !mainContentRef.current) return;
        const deltaX = e.clientX - lastMouseX.current;
        mainContentRef.current.scrollLeft -= deltaX;
        lastMouseX.current = e.clientX;
    };
    
    useEffect(() => {
        const container = mainContentRef.current;
        if (container) {
          container.addEventListener('mousedown', handleMouseDown as any);
          window.addEventListener('mouseup', handleMouseUp);
          container.addEventListener('mousemove', handleMouseMove as any);
          container.addEventListener('mouseleave', handleMouseUp);
      
          return () => {
            container.removeEventListener('mousedown', handleMouseDown as any);
            window.removeEventListener('mouseup', handleMouseUp);
            container.removeEventListener('mousemove', handleMouseMove as any);
            container.removeEventListener('mouseleave', handleMouseUp);
          };
        }
    }, [isDraggingTimeline]);

    const totalDurationMs = endDate.getTime() - startDate.getTime();

    const unassignedFlights = useMemo(() => flights.filter(f => currentView === 'parking' ? !f.parkingPosition : !f.gate), [flights, currentView]);

    const { flightPositions } = useMemo(() => calculateLayout(unassignedFlights), [unassignedFlights]);
    
    const maxTrackIndex = useMemo(() => {
        if (!flightPositions || unassignedFlights.length === 0) return -1;
        return unassignedFlights.reduce((max, flight) => {
            const pos = flightPositions.get(flight.id);
            if (pos && pos.trackIndex > max) {
                return pos.trackIndex;
            }
            return max;
        }, -1);
    }, [unassignedFlights, flightPositions]);

    const DEFAULT_POOL_HEIGHT = 144; // 3x of 48px (spacious 3-track height)
    const calculatedPoolHeight = useMemo(() => {
        if (unassignedFlights.length === 0) return DEFAULT_POOL_HEIGHT;
        const numTracks = Math.max(3, maxTrackIndex + 1);
        return Math.min(numTracks * (FLIGHT_CARD_HEIGHT + FLIGHT_CARD_MARGIN) + FLIGHT_CARD_MARGIN, 240);
    }, [maxTrackIndex, unassignedFlights.length]);

    const [flightPoolHeight, setFlightPoolHeight] = useState(calculatedPoolHeight);

    useEffect(() => {
        if (!userHasResized.current) {
            setFlightPoolHeight(calculatedPoolHeight);
        }
    }, [calculatedPoolHeight]);
    
    const handlePoolResizeMouseDown = useCallback((e: React.MouseEvent) => {
        userHasResized.current = true;
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = flightPoolHeight;

        const handleMouseMove = (event: MouseEvent) => {
            const deltaY = event.clientY - startY;
            const newHeight = Math.max(60, startHeight + deltaY);
            setFlightPoolHeight(newHeight);
        };

        const handleMouseUp = () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [flightPoolHeight]);




    const handleDropFlightOnParking = useCallback((flightId: string, parkingPosition: string) => {
        const flight = flights.find(f => f.id === flightId);
        if (!flight) return;

        const description = `${flight.arrivalFlightNumber || flight.departureFlightNumber} uçuşu ${parkingPosition} pozisyonuna atandı.`;
        const newHistoryEntry: FlightHistoryEntry = {
            user: currentUser.username,
            action: description,
            timestamp: new Date()
        };
        
        const newFlights = flights.map(f =>
            f.id === flightId ? { ...f, parkingPosition, history: [...(f.history || []), newHistoryEntry] } : f
        );
        updateDatabase({ flights: newFlights, maintenanceBlocks, gates: gateList });
        
        setSelectedFlightIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(flightId);
            return newSet;
        });
    }, [flights, maintenanceBlocks, currentUser.username, gateList]);
    
    const handleDropFlightOnGate = useCallback((flightId: string, gate: string) => {
        const flight = flights.find(f => f.id === flightId);
        if (!flight) return;
        handleSaveGate(flight, gate);
        setSelectedFlightIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(flightId);
            return newSet;
        });
    }, [flights, handleSaveGate]);


    const handleUnassignFlight = useCallback((flightId: string) => {
        const flight = flights.find(f => f.id === flightId);
        if (!flight) return;
        
        if (currentView === 'parking') {
            const description = `${flight.arrivalFlightNumber || flight.departureFlightNumber} uçuşu ${flight.parkingPosition} pozisyonundan kaldırıldı.`;
            const newHistoryEntry: FlightHistoryEntry = { user: currentUser.username, action: description, timestamp: new Date() };
            const newFlights = flights.map(f => f.id === flightId ? { ...f, parkingPosition: null, history: [...(f.history || []), newHistoryEntry] } : f );
            updateDatabase({ flights: newFlights, maintenanceBlocks, gates: gateList });
        } else { // currentView === 'gate'
             handleSaveGate(flight, null);
        }

    }, [flights, maintenanceBlocks, currentUser.username, currentView, gateList, handleSaveGate]);

    const handleFlightClick = useCallback((flightId: string, event: React.MouseEvent) => {
        setContextMenu(null);
        setSelectedFlightIds(prev => {
            const newSet = new Set(prev);
            if (event.ctrlKey || event.metaKey) {
                if (newSet.has(flightId)) {
                    newSet.delete(flightId);
                } else {
                    newSet.add(flightId);
                }
            } else {
                newSet.clear();
                newSet.add(flightId);
            }
            return newSet;
        });
    }, []);

    const onFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const data = e.target?.result;
                if (data) {
                    const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(sheet);
                    const rawHeaders = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[];
                    
                    const headerCounts = new Map<string, number>();
                    const uniqueHeaders = rawHeaders.map(h => {
                        const count = headerCounts.get(h) || 0;
                        headerCounts.set(h, count + 1);
                        return count > 0 ? `${h}_${count}` : h;
                    });
                    
                    excelData.current = { data: jsonData, headers: uniqueHeaders };
                    setMappingModalOpen(true);
                }
            };
            reader.readAsArrayBuffer(file);
        }
        event.target.value = '';
    };

    const handleConfirmMapping = (mapping: Mapping, importMode: ImportMode) => {
        if (!excelData.current) return;
    
        let result: ParsedFlightsResult;
        if (importMode === 'turnaround') {
            result = parseTurnaroundDataWithMapping(excelData.current.data, mapping, startDate);
        } else {
            result = pairAndParseFlightData(excelData.current.data, startDate, mapping);
        }

        const { flights: parsedFlights, errors } = result;

        const description = "Excel'den yeni uçuş listesi yüklendi.";
        const newHistoryEntry: FlightHistoryEntry = { user: currentUser.username, action: description, timestamp: new Date() };

        const flightsWithHistory = parsedFlights.map(f => ({ ...f, history: [newHistoryEntry] }));
    
        if (errors.length > 0) {
            setExcelErrors(errors);
            setExcelErrorModalOpen(true);
        }

        const newGatesFromExcel = new Set(parsedFlights.map(f => f.gate).filter((g): g is string => Boolean(g)));
        const updatedGateList = Array.from(new Set([...gateList, ...newGatesFromExcel]));

        if (flightsWithHistory.length > 0) {
            updateDatabase({ flights: flightsWithHistory, maintenanceBlocks, gates: updatedGateList });
            setSelectedFlightIds(new Set());
            userHasResized.current = false;
    
            // Automatically adjust startDate and endDate to match imported flights date range!
            const validArrivals = flightsWithHistory.map(f => f.scheduledArrival.getTime()).filter(t => !isNaN(t) && t > 0);
            const validDepartures = flightsWithHistory.map(f => f.scheduledDeparture.getTime()).filter(t => !isNaN(t) && t > 0);

            if (validArrivals.length > 0) {
                const minArrivalMs = Math.min(...validArrivals);
                const maxDepartureMs = validDepartures.length > 0 ? Math.max(...validDepartures) : minArrivalMs + 24 * 60 * 60 * 1000;

                const firstFlightArrival = new Date(minArrivalMs);
                const newStart = new Date(minArrivalMs);
                newStart.setHours(0, 0, 0, 0);
                setStartDate(newStart);

                const newEnd = new Date(Math.max(maxDepartureMs, minArrivalMs + 24 * 60 * 60 * 1000));
                newEnd.setHours(23, 59, 59, 999);
                setEndDate(newEnd);

                // Auto uncollapse pool if unassigned flights exist
                const hasUnassigned = flightsWithHistory.some(f => currentView === 'parking' ? !f.parkingPosition : !f.gate);
                if (hasUnassigned) {
                    setPoolCollapsed(false);
                }

                // Smoothly scroll timeline container to the first flight's arrival time!
                setTimeout(() => {
                    if (mainContentRef.current) {
                        const totalMs = newEnd.getTime() - newStart.getTime();
                        if (totalMs > 0) {
                            const ratio = (firstFlightArrival.getTime() - newStart.getTime()) / totalMs;
                            const scrollWidth = mainContentRef.current.scrollWidth;
                            const clientWidth = mainContentRef.current.clientWidth;
                            const targetScrollLeft = Math.max(0, Math.min(scrollWidth - clientWidth, ratio * scrollWidth - clientWidth / 4));
                            mainContentRef.current.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
                        }
                    }
                }, 300);
            }

            // Automatically expand concourses that have assigned flights so they are immediately visible!
            const concoursesToExpand = new Set<string>();
            flightsWithHistory.forEach(f => {
                if (f.parkingPosition) {
                    Object.entries(CONCOURSE_LAYOUT).forEach(([name, posList]) => {
                        if (posList.includes(f.parkingPosition!)) {
                            concoursesToExpand.add(name);
                        }
                    });
                }
            });

            if (concoursesToExpand.size > 0) {
                setCollapsedConcourses(prev => {
                    const next = { ...prev };
                    concoursesToExpand.forEach(name => {
                        next[name] = false; // Expand!
                    });
                    return next;
                });
            }

            // Build detailed import report for user
            const totalExcelRows = excelData.current ? excelData.current.data.length : flightsWithHistory.length;
            const assignedFlights = flightsWithHistory.filter(f => Boolean(f.parkingPosition));
            const unassignedFlights = flightsWithHistory.filter(f => !f.parkingPosition);

            const concourseCounts: Record<string, number> = {};
            assignedFlights.forEach(f => {
                if (f.parkingPosition) {
                    Object.entries(CONCOURSE_LAYOUT).forEach(([cName, pList]) => {
                        if (pList.includes(f.parkingPosition!)) {
                            concourseCounts[cName] = (concourseCounts[cName] || 0) + 1;
                        }
                    });
                }
            });

            const unassignedList = unassignedFlights.map((f, idx) => {
                const rowIdx = f.raw_data && excelData.current ? (excelData.current.data.indexOf(f.raw_data) ?? idx) + 2 : idx + 2;
                const timeOptions: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
                const timeStr = f.type === 'turnaround'
                    ? `${f.scheduledArrival.toLocaleString('tr-TR', timeOptions)} - ${f.scheduledDeparture.toLocaleString('tr-TR', timeOptions)}`
                    : f.type === 'arrival'
                    ? `ARR: ${f.scheduledArrival.toLocaleString('tr-TR', timeOptions)}`
                    : `DEP: ${f.scheduledDeparture.toLocaleString('tr-TR', timeOptions)}`;

                const originDest = f.type === 'turnaround'
                    ? `${f.origin || '?'} ➔ ${f.destination || '?'}`
                    : f.origin ? `Geliş: ${f.origin}` : `Gidiş: ${f.destination || '?'}`;

                return {
                    rowIndex: rowIdx,
                    flightNumber: f.arrivalFlightNumber || f.departureFlightNumber || 'Bilinmiyor',
                    timeStr,
                    originDest,
                    aircraftType: f.aircraftType || '-'
                };
            });

            const allDates = flightsWithHistory.flatMap(f => [f.scheduledArrival, f.scheduledDeparture]).filter(d => !isNaN(d.getTime()));
            const minDate = allDates.length > 0 ? new Date(Math.min(...allDates.map(d => d.getTime()))) : undefined;
            const maxDate = allDates.length > 0 ? new Date(Math.max(...allDates.map(d => d.getTime()))) : undefined;

            setImportReport({
                totalExcelRows,
                totalParsedFlights: flightsWithHistory.length,
                assignedFlightsCount: assignedFlights.length,
                unassignedFlightsCount: unassignedFlights.length,
                errors,
                concourseCounts,
                minDate,
                maxDate,
                unassignedList
            });
            setReportModalOpen(true);
        } else if (errors.length === 0) {
            alert("Seçilen eşleştirme ile dosyadan geçerli uçuş okunamadı. Lütfen eşleştirmenizi ve dosya formatınızı kontrol edin.");
        }
    };
    
    const handleClearAllFlights = () => {
        if (window.confirm('Tüm uçuşları ve bakım planlarını silmek istediğinizden emin misiniz?')) {
            updateDatabase({ flights: [], maintenanceBlocks: [], gates: GATES });
            setSelectedFlightIds(new Set());
            userHasResized.current = false;

            const newToday = new Date();
            newToday.setHours(0, 0, 0, 0);
            setStartDate(newToday);
            
            const newEnd = new Date(newToday);
            newEnd.setDate(newToday.getDate() + 1);
            setEndDate(newEnd);
        }
    };
    
    const handleSaveMaintenance = (block: Omit<MaintenanceBlock, 'id'>, id_to_update?: string) => {
        if (id_to_update) {
            const newBlocks = maintenanceBlocks.map(b => b.id === id_to_update ? { ...b, ...block } : b);
            updateDatabase({ flights, maintenanceBlocks: newBlocks, gates: gateList });
        } else {
            const newBlock: MaintenanceBlock = { ...block, id: `maint-${Date.now()}` };
            updateDatabase({ flights, maintenanceBlocks: [...maintenanceBlocks, newBlock], gates: gateList });
        }
    };
    
    const handleUpdateMaintenanceBlock = (blockId: string, newTimes: { startTime?: Date; endTime?: Date }) => {
        const newBlocks = maintenanceBlocks.map(b => b.id === blockId ? { ...b, ...newTimes } : b );
        updateDatabase({ flights, maintenanceBlocks: newBlocks, gates: gateList });
    };
    
    const handleDeleteMaintenanceBlock = (blockId: string) => {
        if (window.confirm('Bu bakım bloğunu silmek istediğinizden emin misiniz?')) {
            const newBlocks = maintenanceBlocks.filter(b => b.id !== blockId);
            updateDatabase({ flights, maintenanceBlocks: newBlocks, gates: gateList });
        }
    };
    
    const handleOpenEditMaintenanceModal = (block: MaintenanceBlock) => {
        setEditingMaintenanceBlock(block);
        setMaintenanceManagementModalOpen(false);
        setMaintenanceModalOpen(true);
    };


    const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.value) return;
        const newStartDate = new Date(e.target.value);
        if (isNaN(newStartDate.getTime())) return;

        setStartDate(newStartDate);

        if (newStartDate >= endDate) {
            const newEndDate = new Date(newStartDate);
            newEndDate.setHours(newEndDate.getHours() + 24);
            setEndDate(newEndDate);
        }
    };
    
    const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.value) return;
        const newEndDate = new Date(e.target.value);
        if (isNaN(newEndDate.getTime())) return;

        if (newEndDate > startDate) {
            setEndDate(newEndDate);
        }
    };

    const flightsByParkingPosition = useMemo(() => {
        return flights.reduce((acc, flight) => {
            const { parkingPosition } = flight;
            if (parkingPosition) {
                if (!acc[parkingPosition]) acc[parkingPosition] = [];
                acc[parkingPosition].push(flight);
            }
            return acc;
        }, {} as Record<string, Flight[]>);
    }, [flights]);

    const flightsByGate = useMemo(() => {
        return flights.reduce((acc, flight) => {
            const { gate } = flight;
            if (gate) {
                if (!acc[gate]) acc[gate] = [];
                acc[gate].push(flight);
            }
            return acc;
        }, {} as Record<string, Flight[]>);
    }, [flights]);
    
    const { canUnlink, canLink, selectedLegs } = useMemo(() => {
        const selected = Array.from(selectedFlightIds).map(id => flights.find(f => f.id === id)).filter(f => f) as Flight[];
        const canUnlink = selected.length === 1 && selected[0].type === 'turnaround';
        const arrivals = selected.filter(f => f.type === 'arrival');
        const departures = selected.filter(f => f.type === 'departure');
        const canLink = selected.length === 2 && arrivals.length === 1 && departures.length === 1;
        return { canUnlink, canLink, selectedLegs: selected };
    }, [selectedFlightIds, flights]);

    const handleUnlink = useCallback(() => {
        if (!canUnlink) return;
        const flightToUnlink = selectedLegs[0];

        const description = `${flightToUnlink.arrivalFlightNumber}/${flightToUnlink.departureFlightNumber} uçuşunun bağlantısı koparıldı.`;
        const newHistoryEntry: FlightHistoryEntry = { user: currentUser.username, action: description, timestamp: new Date() };
        
        const arrivalLeg: Flight = { ...flightToUnlink, id: `${flightToUnlink.id}-arr`, type: 'arrival', departureFlightNumber: undefined, destination: undefined, scheduledDeparture: new Date(flightToUnlink.scheduledArrival.getTime() + SINGLE_LEG_DURATION_MS), isDomestic: flightToUnlink.arrivalIsDomestic ?? flightToUnlink.isDomestic, parkingPosition: null, history: [newHistoryEntry], gate: flightToUnlink.gate };
        const departureLeg: Flight = { ...flightToUnlink, id: `${flightToUnlink.id}-dep`, type: 'departure', arrivalFlightNumber: undefined, origin: undefined, scheduledArrival: new Date(flightToUnlink.scheduledDeparture.getTime() - SINGLE_LEG_DURATION_MS), isDomestic: flightToUnlink.departureIsDomestic ?? flightToUnlink.isDomestic, parkingPosition: null, history: [newHistoryEntry], gate: flightToUnlink.gate };
        
        const newFlights = flights.filter(f => f.id !== flightToUnlink.id).concat([arrivalLeg, departureLeg]);
        updateDatabase({ flights: newFlights, maintenanceBlocks, gates: gateList });
        setSelectedFlightIds(new Set());
    }, [canUnlink, selectedLegs, flights, maintenanceBlocks, currentUser.username, gateList]);
    
    const handleLink = useCallback(() => {
        if (!canLink) return;
        const arrivalLeg = selectedLegs.find(f => f.type === 'arrival')!;
        const departureLeg = selectedLegs.find(f => f.type === 'departure')!;
        if (arrivalLeg.aircraftType !== departureLeg.aircraftType) { alert("Uçak tipleri farklı olan bacaklar birleştirilemez."); return; }
        if (arrivalLeg.scheduledArrival >= departureLeg.scheduledDeparture) { alert("Geliş saati, gidiş saatinden sonra veya aynı olamaz."); return; }
        
        const description = `${arrivalLeg.arrivalFlightNumber} ve ${departureLeg.departureFlightNumber} uçuşları birleştirildi.`;
        const newHistoryEntry: FlightHistoryEntry = { user: currentUser.username, action: description, timestamp: new Date() };
    
        const newTurnaround: Flight = { id: `${arrivalLeg.arrivalFlightNumber}-${departureLeg.departureFlightNumber}-${new Date().toISOString()}`, type: 'turnaround', arrivalFlightNumber: arrivalLeg.arrivalFlightNumber, departureFlightNumber: departureLeg.departureFlightNumber, airline: arrivalLeg.airline, origin: arrivalLeg.origin, destination: departureLeg.destination, aircraftType: arrivalLeg.aircraftType, scheduledArrival: arrivalLeg.scheduledArrival, scheduledDeparture: departureLeg.scheduledDeparture, isDomestic: (arrivalLeg.arrivalIsDomestic ?? arrivalLeg.isDomestic) && (departureLeg.departureIsDomestic ?? departureLeg.isDomestic), arrivalIsDomestic: arrivalLeg.arrivalIsDomestic ?? arrivalLeg.isDomestic, departureIsDomestic: departureLeg.departureIsDomestic ?? departureLeg.isDomestic, parkingPosition: null, raw_data: { arrival: arrivalLeg.raw_data, departure: departureLeg.raw_data }, history: [newHistoryEntry], gate: arrivalLeg.gate || departureLeg.gate };
        const newFlights = flights.filter(f => f.id !== arrivalLeg.id && f.id !== departureLeg.id).concat(newTurnaround);
        updateDatabase({ flights: newFlights, maintenanceBlocks, gates: gateList });
        setSelectedFlightIds(new Set());
    }, [canLink, selectedLegs, flights, maintenanceBlocks, currentUser.username, gateList]);

    const handleLogout = async () => {
        try {
            await signOutUser();
        } catch (error) {
            console.error("Logout failed", error);
            alert("Çıkış yaparken bir hata oluştu.");
        }
    };

    const handleExportGateExcel = useCallback(() => {
        if (flights.length === 0) {
            alert('Dışa aktarılacak uçuş verisi bulunamadı.');
            return;
        }

        const formatDateTime = (d: Date | undefined | null) => {
            if (!d || isNaN(d.getTime())) return '';
            return d.toLocaleString('tr-TR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        };

        const exportRows = flights.map(flight => {
            const raw = flight.raw_data || {};
            
            const arrivalFlightNo = flight.arrivalFlightNumber || raw.arrivalFlightNumber || raw.arrival_flight || raw['Geliş Uçuş No'] || '';
            const departureFlightNo = flight.departureFlightNumber || raw.departureFlightNumber || raw.departure_flight || raw['Gidiş Uçuş No'] || '';
            
            const sta = formatDateTime(flight.scheduledArrival);
            const std = formatDateTime(flight.scheduledDeparture);

            const eta = raw.eta || raw.ETA || raw['Geliş Tahmini'] ? String(raw.eta || raw.ETA || raw['Geliş Tahmini']) : sta;
            const etd = raw.etd || raw.ETD || raw['Gidiş Tahmini'] ? String(raw.etd || raw.ETD || raw['Gidiş Tahmini']) : std;

            const stand = flight.parkingPosition || 'Atanmadı';
            const gate = flight.gate || 'Atanmadı';

            return {
                'Arrival Flight No': arrivalFlightNo,
                'STA': sta,
                'ETA': eta,
                'Stand': stand,
                'Gate': gate,
                'Departure Flight No': departureFlightNo,
                'STD': std,
                'ETD': etd,
                'Departure Stand': stand,
                'Departure Gate': gate,
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(exportRows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Stand Gate Raporu');

        const max_widths = [20, 18, 18, 12, 12, 20, 18, 18, 14, 14];
        worksheet['!cols'] = max_widths.map(w => ({ wch: w }));

        const fileName = `GAMS_Stand_Gate_Raporu_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(workbook, fileName);
    }, [flights]);

    // --- Layout and Sticky Positioning Calculation ---
    const TIMELINE_HEADER_HEIGHT = 40; // The row with hours/dates (h-10)
    const RESIZER_HEIGHT = 6;

    // Height of the flight pool section, including the resizer
    const flightPoolStickySectionHeight = (isPoolCollapsed ? COLLAPSED_POOL_HEIGHT : flightPoolHeight) + (isPoolCollapsed ? 0 : RESIZER_HEIGHT);
    
    // Top offsets for all sticky elements inside mainContentRef scroll container
    const subHeaderTop = 0; // For "Pozisyon" and Timeline Hours headers (top of scroll container)
    const poolTop = subHeaderTop + TIMELINE_HEADER_HEIGHT; // For Flight Pool (40px)
    const concourseHeaderTop = poolTop + flightPoolStickySectionHeight; // For Concourse headers


    return (
        <div className="bg-gray-900 text-white h-screen flex flex-col overflow-hidden" onContextMenu={(e) => e.preventDefault()}>
            <header className="flex flex-col p-2 bg-gray-800 border-b border-gray-700 shadow-md flex-shrink-0 z-40 gap-y-2 text-sm">
                {/* Top Row: App Title, Data Management, User Actions */}
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-x-3">
                        <h1 className="text-xl font-bold">GAMS</h1>
                        <HeaderRevenueSummary flights={flights} />
                        <div className="h-8 border-l border-gray-600"></div>
                        {/* Data Management */}
                        <label htmlFor="file-upload" className="font-semibold py-1.5 px-3 rounded transition duration-300 bg-purple-600 hover:bg-purple-700 cursor-pointer">
                            Excel Yükle
                        </label>
                        <input id="file-upload" type="file" className="hidden" onChange={onFileUpload} accept=".xlsx, .xls, .csv" />
                        <button onClick={() => { setEditingMaintenanceBlock(null); setMaintenanceModalOpen(true); }} className="bg-orange-600 hover:bg-orange-700 text-white font-semibold py-1.5 px-3 rounded transition duration-300">
                            Bakım Ekle
                        </button>
                        <button onClick={() => setMaintenanceManagementModalOpen(true)} className="bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-1.5 px-3 rounded transition duration-300">
                            Bakım Yönetimi
                        </button>
                        <button onClick={handleClearAllFlights} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-1.5 px-3 rounded transition duration-300">
                            Tümünü Sil
                        </button>
                    </div>
                    <div className="flex items-center gap-x-3">
                        <button 
                            onClick={() => {
                                if (flights.length === 0 || !mainContentRef.current) return;
                                const sorted = [...flights].sort((a, b) => a.scheduledArrival.getTime() - b.scheduledArrival.getTime());
                                const firstFlight = sorted[0];
                                const startMs = startDate.getTime();
                                const endMs = endDate.getTime();
                                const totalMs = endMs - startMs;
                                if (totalMs <= 0) return;

                                const ratio = (firstFlight.scheduledArrival.getTime() - startMs) / totalMs;
                                const scrollWidth = mainContentRef.current.scrollWidth;
                                const clientWidth = mainContentRef.current.clientWidth;
                                const targetScrollLeft = Math.max(0, Math.min(scrollWidth - clientWidth, ratio * scrollWidth - clientWidth / 4));
                                mainContentRef.current.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
                            }}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-1.5 px-3 rounded shadow-md transition duration-300 flex items-center gap-1.5"
                            title="Zaman akışında ilk uçuşun saatinin olduğu yere otomatik kaydır"
                        >
                            <span>🎯</span> Uçuşlara Git
                        </button>
                        <button 
                            onClick={handleExportGateExcel} 
                            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1.5 px-4 rounded shadow-md transition duration-300 flex items-center gap-2"
                            title="Uçuş atama ve gate bilgilerini Excel olarak dışa aktar"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Gate Dışa Aktar
                        </button>
                    </div>
                </div>
                
                {/* Bottom Row: View Controls */}
                <div className="flex items-center justify-between w-full border-t border-gray-700 pt-2">
                    <div className="flex items-center gap-x-3">
                        {/* View Type */}
                        <div className="flex items-center rounded-md bg-gray-700 p-0.5">
                            <button onClick={() => setCurrentView('parking')} className={`px-3 py-1 font-medium rounded-md transition-colors ${currentView === 'parking' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Park Planı</button>
                            <button onClick={() => setCurrentView('gate')} className={`px-3 py-1 font-medium rounded-md transition-colors ${currentView === 'gate' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Gate Planı</button>
                        </div>
                        {/* Flight Actions */}
                        <div className="h-8 border-l border-gray-600"></div>
                        <div className="flex items-center gap-x-2">
                            <button onClick={handleUnlink} disabled={!canUnlink} className="w-36 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded-md transition duration-300 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
                                Bağlantıyı Kopar
                            </button>
                            <button onClick={handleLink} disabled={!canLink} className="w-36 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded-md transition duration-300 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
                                Bağla
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center gap-x-3">
                        {/* Filter Type */}
                        <div className="flex items-center rounded-md bg-gray-700 p-0.5">
                            <button onClick={() => setActiveFilter('all')} className={`px-3 py-1 font-medium rounded-md transition-colors ${activeFilter === 'all' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Tümü</button>
                            <button onClick={() => setActiveFilter('domestic')} className={`px-3 py-1 font-medium rounded-md transition-colors ${activeFilter === 'domestic' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>İç Hat</button>
                            <button onClick={() => setActiveFilter('international')} className={`px-3 py-1 font-medium rounded-md transition-colors ${activeFilter === 'international' ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}>Dış Hat</button>
                        </div>
                        {/* Search */}
                        <input
                            type="text"
                            placeholder="Uçuş Ara..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="bg-gray-700 border border-gray-600 rounded-md px-3 py-1.5 text-white focus:ring-purple-500 focus:border-purple-500 w-56"
                        />
                        {/* Date Pickers */}
                        <div className="flex items-center gap-x-2">
                            <label htmlFor="start-date" className="font-medium text-gray-300 whitespace-nowrap">Başlangıç:</label>
                            <input id="start-date" type="datetime-local" value={formatDateForInput(startDate)} onChange={handleStartDateChange} className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-white focus:ring-purple-500 focus:border-purple-500"/>
                        </div>
                        <div className="flex items-center gap-x-2">
                            <label htmlFor="end-date" className="font-medium text-gray-300 whitespace-nowrap">Bitiş:</label>
                            <input id="end-date" type="datetime-local" value={formatDateForInput(endDate)} onChange={handleEndDateChange} className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-white focus:ring-purple-500 focus:border-purple-500"/>
                        </div>
                    </div>
                </div>
            </header>

            <ExcelImportReportModal isOpen={isReportModalOpen} onClose={() => setReportModalOpen(false)} report={importReport} />
            <ExcelErrorModal isOpen={isExcelErrorModalOpen} onClose={() => setExcelErrorModalOpen(false)} errors={excelErrors} />
            {historyModalFlight && <FlightHistoryModal flight={historyModalFlight} onClose={() => setHistoryModalFlight(null)} />}
            {trackingFlight && <FlightTrackingModal flight={trackingFlight} onClose={() => setTrackingFlight(null)} />}
            
            <MaintenanceModal isOpen={isMaintenanceModalOpen} onClose={() => { setMaintenanceModalOpen(false); setEditingMaintenanceBlock(null); }} onSave={handleSaveMaintenance} blockToEdit={editingMaintenanceBlock} />
            <MaintenanceManagementModal isOpen={isMaintenanceManagementModalOpen} onClose={() => setMaintenanceManagementModalOpen(false)} maintenanceBlocks={maintenanceBlocks} onEdit={handleOpenEditMaintenanceModal} onDelete={handleDeleteMaintenanceBlock} />
            
            {gateAssignmentFlight && (
                <GateAssignmentModal
                    isOpen={!!gateAssignmentFlight}
                    onClose={() => setGateAssignmentFlight(null)}
                    onSave={(gate) => handleSaveGate(gateAssignmentFlight, gate)}
                    flight={gateAssignmentFlight}
                    gateList={gateList}
                />
            )}

            <CustomDragLayer />
            {currentUser.isAdmin && <AdminPanel isOpen={isAdminPanelOpen} onClose={() => setAdminPanelOpen(false)} />}
            <ChangePasswordModal isOpen={isChangePasswordModalOpen} onClose={() => setChangePasswordModalOpen(false)} />

            <FlightContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onToggleOverride={toggleRuleOverride} ruleOverrides={ruleOverrides} onShowHistory={handleShowHistory} onShowMap={handleShowMap} onAssignGate={handleOpenGateAssignmentModal} />

            {isMappingModalOpen && excelData.current && (
                <ColumnMappingModal isOpen={isMappingModalOpen} onClose={() => setMappingModalOpen(false)} headers={excelData.current.headers} dataPreview={excelData.current.data.slice(0, 5)} onConfirm={handleConfirmMapping} />
            )}
            
            <div className="flex-grow flex flex-col overflow-hidden">
                <div ref={mainContentRef} className="flex-grow overflow-auto">
                    <div className="flex relative">
                        {/* Left Sticky Panel */}
                        <div className="w-48 flex-shrink-0 bg-[#2b2b2b] sticky left-0 z-30 flex flex-col border-r border-gray-600/70">
                            <div className="h-10 border-b-2 border-r border-gray-600 flex items-center justify-between px-2 font-bold text-sm sticky bg-[#2b2b2b] text-amber-400 z-[38]" style={{top: `${subHeaderTop}px`}}>
                                <span>{currentView === 'parking' ? 'Pozisyon' : 'Gate'}</span>
                                {currentView === 'parking' && (
                                    <button 
                                        onClick={() => {
                                            const allCollapsed = Object.values(collapsedConcourses).every(v => v);
                                            const nextState: Record<string, boolean> = {};
                                            Object.keys(CONCOURSE_LAYOUT).forEach(k => {
                                                nextState[k] = !allCollapsed;
                                            });
                                            setCollapsedConcourses(nextState);
                                        }}
                                        className="text-[10px] font-semibold bg-gray-700 hover:bg-gray-600 text-amber-300 px-1.5 py-0.5 rounded transition"
                                        title="Tüm Concourse'ları Aç / Kapat"
                                    >
                                        {Object.values(collapsedConcourses).every(v => v) ? '📂 Tümünü Aç' : '📁 Tümünü Kapat'}
                                    </button>
                                )}
                            </div>
                            <div className="flex-shrink-0 sticky bg-[#2b2b2b] z-[35]" style={{top: `${poolTop}px`}}>
                                <div onClick={() => setPoolCollapsed(!isPoolCollapsed)} className="border-b border-r border-gray-600 flex items-center justify-center text-xs font-semibold text-amber-400 p-2 text-center select-none cursor-pointer bg-[#2b2b2b]" style={{ height: `${isPoolCollapsed ? COLLAPSED_POOL_HEIGHT : flightPoolHeight}px`, transition: 'height 0.2s ease' }}>
                                    <span className="inline-block w-4 text-center mr-1">{isPoolCollapsed ? '▸' : '▾'}</span>
                                    <span className="flex-grow font-bold">ATANMAMIŞ UÇUŞLAR</span>
                                </div>
                                {!isPoolCollapsed && (<div onMouseDown={handlePoolResizeMouseDown} className="h-1.5 bg-gray-600 hover:bg-purple-500 transition-colors cursor-ns-resize border-r border-gray-600" /> )}
                            </div>
                            {currentView === 'parking' ? (
                                Object.entries(CONCOURSE_LAYOUT).map(([concourseName, positions]) => (
                                <div key={concourseName}>
                                    <div onClick={() => toggleConcourse(concourseName)} className="h-10 border-b border-r border-gray-600 bg-[#252525] text-amber-400 font-bold text-sm sticky z-[25] cursor-pointer select-none flex items-center px-3 truncate" style={{ top: `${concourseHeaderTop}px` }}>
                                        <span className="inline-block w-4 text-center">{collapsedConcourses[concourseName] ? '▸' : '▾'}</span>
                                        {concourseName}
                                    </div>
                                    {!collapsedConcourses[concourseName] && positions.map(pos => (
                                        <div key={pos} className="h-10 border-b border-r border-gray-600/70 flex items-center justify-center text-xs font-bold bg-[#3a3a3a] text-amber-400/90">{pos}</div>
                                    ))}
                                </div>
                            ))) : (
                                <>
                                    <div className="h-10 border-b border-r border-gray-600 bg-[#252525] text-amber-400 font-bold text-sm sticky z-[25] flex items-center px-3" style={{ top: `${concourseHeaderTop}px` }}>
                                        Gate Planlama Ekranı
                                    </div>
                                    {gateList.map(gate => (
                                         <div key={gate} className="h-10 border-b border-r border-gray-600/70 flex items-center justify-center text-xs font-bold bg-[#3a3a3a] text-amber-400/90">{gate}</div>
                                    ))}
                                </>
                            )}
                        </div>

                        {/* Timeline Content */}
                        <div className="flex-grow relative z-0" style={{ minWidth: `calc(100% - 12rem)` }}>
                             <div className="relative" style={{ width: `${scale * Math.max(1, totalDurationMs / (1000 * 60 * 60)) * 150}px`, minWidth: '100%' }} onWheel={handleWheel}>
                                <div ref={timelineContainerRef} className="sticky z-[38] bg-gray-900" style={{ top: `${subHeaderTop}px` }}>
                                    <TimelineHeader startDate={startDate} totalDurationMs={totalDurationMs}/>
                                </div>
                                <div className="sticky bg-[#3a3a3a] z-[35]" style={{top: `${poolTop}px`}}>
                                    <div className="relative border-b border-gray-600/70 bg-[#3a3a3a]" style={{ height: `${isPoolCollapsed ? COLLAPSED_POOL_HEIGHT : flightPoolHeight}px`, transition: 'height 0.2s ease', overflowY: 'auto' }}>
                                        {!isPoolCollapsed && (
                                            <FlightPool 
                                                unassignedFlights={unassignedFlights} 
                                                onDropFlight={handleUnassignFlight} 
                                                selectedFlightIds={selectedFlightIds} 
                                                onFlightClick={handleFlightClick} 
                                                setSelectedFlightIds={setSelectedFlightIds} 
                                                startDate={startDate} 
                                                totalDurationMs={totalDurationMs} 
                                                flightPositions={flightPositions} 
                                                onFlightContextMenu={handleFlightContextMenu} 
                                                ruleOverrides={ruleOverrides} 
                                                highlightedFlightId={highlightedFlightId}
                                                flightElements={flightElements}
                                                activeFilter={activeFilter}
                                            />
                                        )}
                                    </div>
                                    {!isPoolCollapsed && ( <div onMouseDown={handlePoolResizeMouseDown} className="h-1.5 bg-gray-600 hover:bg-purple-500 transition-colors cursor-ns-resize" /> )}
                                </div>
                                 {currentView === 'parking' ? (
                                    Object.entries(CONCOURSE_LAYOUT).map(([concourseName, positions]) => (
                                        <div key={concourseName}>
                                            {collapsedConcourses[concourseName] ? (
                                                <ConcourseOccupancyBar 
                                                    concourseName={concourseName}
                                                    positions={positions}
                                                    flightsByParkingPosition={flightsByParkingPosition}
                                                    startDate={startDate}
                                                    totalDurationMs={totalDurationMs}
                                                />
                                            ) : (
                                                <>
                                                    <div className="h-10 border-b border-gray-600 bg-[#252525] text-transparent pointer-events-none font-bold text-sm sticky z-[25] flex items-center px-3 truncate" style={{ top: `${concourseHeaderTop}px` }}>
                                                        <span className="inline-block w-4 text-center">{collapsedConcourses[concourseName] ? '▸' : '▾'}</span>
                                                        {concourseName}
                                                    </div>
                                                    {positions.map(pos => 
                                                        <TimelineLane 
                                                            key={pos} 
                                                            laneId={pos} 
                                                            laneType="parking"
                                                            flights={flightsByParkingPosition[pos] || []} 
                                                            allFlights={flights} 
                                                            onDropFlight={handleDropFlightOnParking} 
                                                            startDate={startDate} 
                                                            totalDurationMs={totalDurationMs} 
                                                            selectedFlightIds={selectedFlightIds} 
                                                            onFlightClick={handleFlightClick} 
                                                            onFlightContextMenu={handleFlightContextMenu} 
                                                            ruleOverrides={ruleOverrides}
                                                            highlightedFlightId={highlightedFlightId}
                                                            activeFilter={activeFilter}
                                                            flightElements={flightElements}
                                                            maintenanceBlocks={maintenanceBlocks.filter(b => b.parkingPosition === pos)}
                                                            onUpdateMaintenanceBlock={handleUpdateMaintenanceBlock}
                                                        />
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    ))
                                 ) : (
                                    <>
                                        <div className="h-10 border-b border-gray-600 bg-[#252525] text-transparent pointer-events-none font-bold text-sm sticky z-20 flex items-center px-3" style={{ top: `${concourseHeaderTop}px` }}>
                                            Gate Planlama Ekranı
                                        </div>
                                        {gateList.map(gate => 
                                            <TimelineLane
                                                key={gate}
                                                laneId={gate}
                                                laneType="gate"
                                                flights={flightsByGate[gate] || []}
                                                allFlights={flights}
                                                onDropFlight={handleDropFlightOnGate}
                                                startDate={startDate}
                                                totalDurationMs={totalDurationMs}
                                                selectedFlightIds={selectedFlightIds}
                                                onFlightClick={handleFlightClick}
                                                onFlightContextMenu={handleFlightContextMenu}
                                                ruleOverrides={ruleOverrides}
                                                highlightedFlightId={highlightedFlightId}
                                                activeFilter={activeFilter}
                                                flightElements={flightElements}
                                                maintenanceBlocks={[]} // Maintenance is per-parking-position
                                                onUpdateMaintenanceBlock={() => {}} // Not applicable for gates
                                            />
                                        )}
                                    </>
                                 )}
                                <CurrentTimeIndicator startDate={startDate} totalDurationMs={totalDurationMs} />
                             </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Zoom Controls (Bottom Right Floating Widget) */}
            <div className="fixed bottom-4 right-4 z-40 bg-gray-800/95 border border-gray-700 shadow-2xl rounded-lg p-1.5 flex items-center gap-1.5 backdrop-blur-md text-white text-xs select-none">
                <span className="text-gray-400 font-semibold px-1 text-[11px] uppercase tracking-wider">Ölçek:</span>
                
                <button
                    onClick={() => setScale(prev => Math.max(0.3, Math.round((prev - 0.1) * 10) / 10))}
                    title="Uzaklaştır (%-10)"
                    className="w-7 h-7 flex items-center justify-center bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded font-bold text-sm transition-colors"
                >
                    −
                </button>
                
                <button
                    onClick={() => setScale(1)}
                    title="Varsayılan Sıfırla (%100)"
                    className={`px-2 h-7 flex items-center justify-center rounded font-bold transition-colors ${Math.abs(scale - 1) < 0.05 ? 'bg-purple-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`}
                >
                    %{Math.round(scale * 100)}
                </button>
                
                <button
                    onClick={() => setScale(prev => Math.min(3.0, Math.round((prev + 0.1) * 10) / 10))}
                    title="Yakınlaştır (%+10)"
                    className="w-7 h-7 flex items-center justify-center bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded font-bold text-sm transition-colors"
                >
                    +
                </button>

                <div className="h-4 border-l border-gray-600 mx-0.5"></div>

                <div className="flex items-center gap-1">
                    {[0.75, 1.0, 1.25, 1.5].map((presetScale) => (
                        <button
                            key={presetScale}
                            onClick={() => setScale(presetScale)}
                            className={`px-1.5 h-6 text-[11px] rounded font-medium transition-colors ${Math.abs(scale - presetScale) < 0.05 ? 'bg-purple-600 text-white font-bold' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                        >
                            %{Math.round(presetScale * 100)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Bottom Revenue Summary Bar */}
            <BottomRevenueSummaryBar flights={flights} />
        </div>
    );
};

export default App;