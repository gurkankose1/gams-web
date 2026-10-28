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
import MaintenanceImportModal from './components/MaintenanceImportModal.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import ExcelErrorModal from './components/ExcelErrorModal.tsx';
import ExcelImportReportModal, { ImportReport } from './components/ExcelImportReportModal.tsx';
import MaintenanceManagementModal from './components/MaintenanceManagementModal.tsx';
import GateAssignmentModal from './components/GateAssignmentModal.tsx';
import AdminPanel from './auth/AdminPanel.tsx';
import ChangePasswordModal from './auth/ChangePasswordModal.tsx';
import CustomDragLayer from './components/CustomDragLayer.tsx';
import HeaderRevenueSummary from './components/HeaderRevenueSummary.tsx';
import BottomRevenueSummaryBar from './components/BottomRevenueSummaryBar.tsx';
import { runAiBridgeAllocation, calculateBridgeUtilization, hasMaintenanceConflict, AiAllocationOptions } from './services/ai-allocator.ts';
import { getAircraftCategory, isContactStand } from './services/ams-rules.ts';
import AiAllocationReportModal, { AiReportData } from './components/AiAllocationReportModal.tsx';
import AiScorePlannerModal from './components/AiScorePlannerModal.tsx';
import RadarTrackingModal from './components/RadarTrackingModal.tsx';
import AiCopilotModal from './components/AiCopilotModal.tsx';
import DivertCapacityModal from './components/DivertCapacityModal.tsx';
import GeminiSettingsModal from './components/GeminiSettingsModal.tsx';
import GeminiDeepThinkingModal from './components/GeminiDeepThinkingModal.tsx';
import GeminiDeepPlanModal from './components/GeminiDeepPlanModal.tsx';
import { getStoredApiKey } from './services/gemini-api.ts';
import { database } from './firebase.ts';
import { ref, onValue, set, update, remove } from 'firebase/database';
import { User } from 'firebase/auth';
import { signOutUser } from './auth/auth-service.ts';

const SINGLE_LEG_DURATION_MS = 60 * 60 * 1000; // 1 hour for visualization

interface ParsedFlightsResult {
    flights: Flight[];
    errors: { rowIndex: number, reason: string, rowData: any }[];
}

const EMPTY_FLIGHTS: Flight[] = [];
const EMPTY_MAINTENANCE: MaintenanceBlock[] = [];

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

        // Time Fallback Hierarchy:
        // Priority 1: AIBT - AOBT (On Block - Off Block)
        // Priority 2: ALDT - ATOT (ATA - ATD)
        // Priority 3: ETA - ETD
        // Priority 4: STA - STD
        // Priority 5: m.arrDateTime / m.depDateTime from mapping
        const onBlock = combineDateAndTime(null, row['On Block'] || row['AIBT'], startDate);
        const offBlock = combineDateAndTime(null, row['Off Block'] || row['AOBT'], startDate);

        const ata = combineDateAndTime(null, row['ATA'] || row['ALDT'], startDate);
        const atd = combineDateAndTime(null, row['ATD'] || row['ATOT'], startDate);

        const eta = combineDateAndTime(null, row['ETA'], startDate);
        const etd = combineDateAndTime(null, row['ETD'], startDate);

        const sta = combineDateAndTime(null, row['STA'], startDate);
        const std = combineDateAndTime(null, row['STD'], startDate);

        const mappedArr = m.arrDateTime ? combineDateAndTime(null, row[m.arrDateTime], startDate) : null;
        const mappedDep = m.depDateTime ? combineDateAndTime(null, row[m.depDateTime], startDate) : null;

        let rawArrDate = onBlock || ata || eta || sta || mappedArr;
        let rawDepDate = offBlock || atd || etd || std || mappedDep;

        let timeSource: 'BLOCK' | 'ACTUAL' | 'SCHEDULED' = 'SCHEDULED';
        if (onBlock && offBlock) timeSource = 'BLOCK';
        else if (ata && atd) timeSource = 'ACTUAL';

        // Filter out 1899 zero-dates
        if (rawArrDate && rawArrDate.getFullYear() < 1970) rawArrDate = null;
        if (rawDepDate && rawDepDate.getFullYear() < 1970) rawDepDate = null;

        // Check for DX / Cancelled Flight status across BOTH Arrival and Departure status/remark columns
        const isCancelledStr = (val: any) => {
            if (val === null || val === undefined || val === '') return false;
            const s = String(val).toUpperCase().trim();
            return s === 'DX' || s.startsWith('DX') || s.includes('CANCEL') || s.includes('İPTAL') || s.includes('IPTAL');
        };

        const statusMapped = mapping.status ? row[mapping.status] : null;
        const statusArr = row['Status'] || row['Arr Status'] || row['ArrStatus'];
        const statusDep = row['Dep Status'] || row['DepStatus'] || row['Status_1'] || row['Status.1'];
        const statusRemark = row[' Remark'] || row['Remark'] || row['Aksaklik'] || row['Stand_Change_Reason'];

        if (isCancelledStr(statusMapped) || isCancelledStr(statusArr) || isCancelledStr(statusDep) || isCancelledStr(statusRemark)) {
            errors.push({ rowIndex: i + 2, reason: "İptal Uçuş (DX) - Planlamaya yansıtılmadı.", rowData: row });
            return [];
        }

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
        if (!arrivalFlightNumber && !departureFlightNumber) {
            return []; // Skip ghost/empty rows
        }
        const origin = String(row[m.origin] || '').trim();
        const destination = String(row[m.dest] || '').trim();
        const aircraftType = String(row[m.ac] || '').trim();
        const rawRegNo = (m.regNo && row[m.regNo] !== undefined && row[m.regNo] !== null && String(row[m.regNo]).trim() !== '')
            ? String(row[m.regNo]).toUpperCase().trim()
            : String(row['RegNo'] || row['RegNo_1'] || row['RegNo.1'] || row['Reg No'] || row['Reg'] || row['A/C Reg'] || row['Tescil'] || row['Tail'] || '').toUpperCase().trim();
        const regNo = rawRegNo && rawRegNo !== 'NULL' && rawRegNo !== 'NONE' && rawRegNo !== 'NAN' ? rawRegNo : undefined;
        const isUnregistered = !regNo || regNo === '' || regNo === 'ER' || regNo === 'ER/' || regNo === 'DUMMY' || regNo === 'NONE' || regNo === 'TBA' || regNo === 'TC-';
        const airlineCode = (arrivalFlightNumber || departureFlightNumber).substring(0, 2);

        const rawAcCategory = String(row['A/C C'] || row['A/C C_1'] || row['acCategory'] || '').toUpperCase().trim();
        const rawTrafficMode = String(row['Mod'] || row['Mod_1'] || row['Mod.1'] || row['trafficMode'] || '').toUpperCase().trim();
        const effectiveCategory = (rawAcCategory && rawAcCategory !== 'NAN' && rawAcCategory !== 'NULL')
            ? rawAcCategory
            : (aircraftType ? getAircraftCategory(aircraftType) : '');

        const isNoAc = (!aircraftType || aircraftType.toUpperCase() === 'NAN' || aircraftType.toUpperCase() === 'NULL') && !regNo;
        // Otomatik Excel yüklemesinde tescilsiz uçaklar standa atanmaz (havuzda kalır)
        const shouldAssignInitialStand = !isNoAc && !isUnregistered;

        const mtowKey = mapping.mtow;
        const rawMtowVal = mtowKey ? row[mtowKey] : (row['MTOW'] || row['mtow'] || row['Max MTOW'] || row['MTOW (Tons)']);
        let mtowVal: number | undefined = undefined;
        if (rawMtowVal !== undefined && rawMtowVal !== null && rawMtowVal !== '') {
            const parsed = parseFloat(String(rawMtowVal).replace(/[^0-9.]/g, ''));
            if (!isNaN(parsed) && parsed > 0) {
                mtowVal = parsed > 1000 ? Math.ceil(parsed / 1000) : Math.ceil(parsed);
            }
        }

        const parseDomesticFlag = (val: unknown, fallbackAirport?: string): boolean => {
            if (val !== undefined && val !== null && String(val).trim() !== '') {
                const str = String(val).toUpperCase().trim();
                if (str === 'D' || str.startsWith('DOM') || str === 'İÇ' || str === 'IC') return true;
                if (str === 'I' || str.startsWith('INT') || str === 'DIŞ' || str === 'DIS') return false;
            }
            if (fallbackAirport && TURKISH_DOMESTIC_AIRPORTS.has(fallbackAirport.toUpperCase().trim())) {
                return true;
            }
            return false;
        };

        const rawArrMode = m.arrMode ? row[m.arrMode] : (row['I/D'] ?? row['Arr I/D'] ?? row['ArrMod']);
        const rawDepMode = m.depMode ? row[m.depMode] : (row['I/D.1'] ?? row['I/D_1'] ?? row['Dep I/D'] ?? row['DepMod']);
        const isArrDom = parseDomesticFlag(rawArrMode, origin);
        const isDepDom = parseDomesticFlag(rawDepMode, destination);
        const rawActualDepTrafficMode = String(row['Mod_1'] || row['Mod.1'] || row['DepMod'] || row['Dep Mod'] || row['Mod'] || rawTrafficMode || '').toUpperCase().trim();
        const departureMode = rawActualDepTrafficMode || undefined;
        
        const arrGateStr = m.arrGate ? String(row[m.arrGate] ?? '').toUpperCase().trim() || null : null;
        const depGateStr = m.depGate ? String(row[m.depGate] ?? '').toUpperCase().trim() || null : null;
        const genGateStr = m.gate ? String(row[m.gate] ?? '').toUpperCase().trim() || null : null;
        const gate = arrGateStr || depGateStr || genGateStr || null;

        const generalPos = extractValidParkingPosition(m.parkingPosition ? row[m.parkingPosition] : null);
        const arrPos = extractValidParkingPosition(
            m.arrParkingPosition ? row[m.arrParkingPosition] : (
                row['Arr Stand'] || row['ArrStand'] || row['Arrival Stand'] || row['ArrivalStand'] || row['Arr Pos'] || row['ArrPos'] || row['Arr Park'] || row['ArrPark'] || row['Geliş Park'] || row['Stand']
            )
        );
        const depPos = extractValidParkingPosition(
            m.depParkingPosition ? row[m.depParkingPosition] : (
                row['Departure Stand'] || row['DepartureStand'] || row['Dep Stand'] || row['DepStand'] || row['Dep Pos'] || row['DepPos'] || row['Dep Park'] || row['DepPark'] || row['Gidiş Park'] || row['Stand_1'] || row['Stand.1'] || row['Pos_1'] || row['Pos.1']
            )
        );

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
                isDomestic: isArrDom && isDepDom,
                arrivalIsDomestic: isArrDom,
                departureIsDomestic: isDepDom,
                departureMode: departureMode || rawTrafficMode,
                trafficMode: rawTrafficMode,
                acCategory: effectiveCategory,
                isTransparent: isNoAc,
                timeSource,
                gate: gate,
            };

            if (arrPos && depPos && arrPos !== depPos) {
                const isArrContact = isContactStand(arrPos);
                const isDepContact = isContactStand(depPos);
                // Gerçek hayattaki AOG / Bakım / Çekilme (Körük-Açık veya Açık-Körük / Farklı Standlar)
                // Bu uçuşlar operasyonel kilitlidir; AI Skor Planlama asla yerlerini değiştirmez.
                const isTowedOrSplit = (isArrContact && !isDepContact) || (!isArrContact && isDepContact) || (arrPos !== depPos);

                const arrivalLeg: Flight = {
                    ...baseFlightData,
                    id: `${arrivalFlightNumber || 'ARR'}-${arrival.toISOString()}-arr-${i}`,
                    type: 'arrival',
                    departureFlightNumber: undefined,
                    destination: undefined,
                    scheduledDeparture: new Date(arrival.getTime() + SINGLE_LEG_DURATION_MS),
                    isDomestic: isArrDom,
                    parkingPosition: shouldAssignInitialStand ? arrPos : null,
                    isOperationalLocked: isTowedOrSplit ? true : undefined,
                };
                const departureLeg: Flight = {
                    ...baseFlightData,
                    id: `${departureFlightNumber || 'DEP'}-${departure.toISOString()}-dep-${i}`,
                    type: 'departure',
                    arrivalFlightNumber: undefined,
                    origin: undefined,
                    scheduledArrival: new Date(departure.getTime() - SINGLE_LEG_DURATION_MS),
                    isDomestic: isDepDom,
                    parkingPosition: shouldAssignInitialStand ? depPos : null,
                    isOperationalLocked: isTowedOrSplit ? true : undefined,
                };
                return [arrivalLeg, departureLeg];
            } else {
                const turnaroundFlight: Flight = {
                    ...baseFlightData,
                    id: `${arrivalFlightNumber || departureFlightNumber}-${arrival.toISOString()}-${i}`,
                    type: 'turnaround',
                    parkingPosition: shouldAssignInitialStand ? (arrPos || depPos || generalPos) : null,
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
                parkingPosition: shouldAssignInitialStand ? (arrPos || generalPos) : null,
                gate,
                isDomestic: isArrDom,
                arrivalIsDomestic: isArrDom,
                departureIsDomestic: false,
                departureMode: departureMode || rawTrafficMode,
                trafficMode: rawTrafficMode,
                acCategory: effectiveCategory,
                isTransparent: isNoAc,
                timeSource,
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
                parkingPosition: shouldAssignInitialStand ? (depPos || generalPos) : null,
                gate,
                isDomestic: isDepDom,
                arrivalIsDomestic: false,
                departureIsDomestic: isDepDom,
                departureMode: departureMode || rawTrafficMode,
                trafficMode: rawTrafficMode,
                acCategory: effectiveCategory,
                isTransparent: isNoAc,
                timeSource,
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
                
                const arrPos = arrivalLeg.parkingPosition;
                const depPos = departureLeg.parkingPosition;
                const isDiffStands = arrPos && depPos && arrPos !== depPos;
                const isOpLocked = isDiffStands && (
                    (isContactStand(arrPos) && !isContactStand(depPos)) ||
                    (!isContactStand(arrPos) && isContactStand(depPos)) ||
                    (arrPos !== depPos)
                );

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
                    isOperationalLocked: isOpLocked ? true : undefined,
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
    const [isMaintenanceImportModalOpen, setMaintenanceImportModalOpen] = useState(false);
    const [isAdminPanelOpen, setAdminPanelOpen] = useState(false);
    const [isChangePasswordModalOpen, setChangePasswordModalOpen] = useState(false);
    const [editingMaintenanceBlock, setEditingMaintenanceBlock] = useState<MaintenanceBlock | null>(null);
    const excelData = useRef<{ data: any[], headers: string[] } | null>(null);
    const [excelErrors, setExcelErrors] = useState<ParsedFlightsResult['errors']>([]);
    const [isExcelErrorModalOpen, setExcelErrorModalOpen] = useState(false);
    const [importReport, setImportReport] = useState<ImportReport | null>(null);
    const [isReportModalOpen, setReportModalOpen] = useState(false);
    const [aiReportData, setAiReportData] = useState<AiReportData | null>(null);
    const [isAiReportModalOpen, setIsAiReportModalOpen] = useState(false);
    const [isCopilotOpen, setIsCopilotOpen] = useState(false);
    const [isDivertModalOpen, setIsDivertModalOpen] = useState(false);
    const [isGeminiThinkingOpen, setIsGeminiThinkingOpen] = useState(false);
    const [isGeminiDeepPlanOpen, setIsGeminiDeepPlanOpen] = useState(false);
    const [isGeminiSettingsOpen, setIsGeminiSettingsOpen] = useState(false);
    const [geminiKeyActive, setGeminiKeyActive] = useState<boolean>(() => Boolean(getStoredApiKey()));

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
    const [isSuperSetMode, setIsSuperSetMode] = useState(false);
    const [historyModalFlight, setHistoryModalFlight] = useState<Flight | null>(null);
    const [trackingFlight, setTrackingFlight] = useState<Flight | null>(null);
    const [radarTrackingFlight, setRadarTrackingFlight] = useState<Flight | null>(null);
    const [isAiScorePlannerModalOpen, setIsAiScorePlannerModalOpen] = useState(false);
    const [gateAssignmentFlight, setGateAssignmentFlight] = useState<Flight | null>(null);


    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<'all' | 'domestic' | 'international'>('all');
    const [highlightedFlightId, setHighlightedFlightId] = useState<string | null>(null);
    const [scrollToFlightId, setScrollToFlightId] = useState<string | null>(null);
    const flightElements = useRef(new Map<string, HTMLDivElement>());
    const isLocalUpdateRef = useRef(false);

    const [undoStack, setUndoStack] = useState<Flight[][]>([]);
    const [redoStack, setRedoStack] = useState<Flight[][]>([]);
    const [committedFlights, setCommittedFlights] = useState<Flight[] | null>(null);

    const toggleConcourse = useCallback((concourseName: string) => {
        setCollapsedConcourses(prev => ({
            ...prev,
            [concourseName]: !prev[concourseName]
        }));
    }, []);

    const updateDatabase = (newState: { flights: Flight[], maintenanceBlocks: MaintenanceBlock[], gates?: string[] }, skipHistory?: boolean) => {
        isLocalUpdateRef.current = true;
        if (!skipHistory && flights.length > 0) {
            setUndoStack(prev => [...prev.slice(-30), flights]);
            setRedoStack([]);
        }
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
            
            set(ref(database, 'plan'), updateData).catch(err => {
                console.warn('Firebase error:', err);
                isLocalUpdateRef.current = false;
            });
        } catch (e) {
            console.warn('Firebase error:', e);
            isLocalUpdateRef.current = false;
        }
    };


    // Listen for real-time data from Firebase
    useEffect(() => {
        const planRef = ref(database, 'plan');
        const unsubscribe = onValue(planRef, (snapshot) => {
            if (isLocalUpdateRef.current) {
                // Skip processing snapshot echoed back from our own local mutation
                isLocalUpdateRef.current = false;
                return;
            }

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

    const [isAiAllocating, setIsAiAllocating] = useState(false);
    const [allocationMessage, setAllocationMessage] = useState<string | null>(null);

    const bridgeStats = useMemo(() => {
        return calculateBridgeUtilization(flights, startDate, endDate);
    }, [flights, startDate, endDate]);

    const availableDays = useMemo(() => {
        if (flights.length === 0) return [];
        const dayMap = new Map<string, { label: string; date: Date; count: number }>();
        flights.forEach(f => {
            if (f.type === 'arrival') return;
            const d = f.scheduledDeparture;
            if (!d || isNaN(d.getTime())) return;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!dayMap.has(key)) {
                const label = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
                const dayStart = new Date(d);
                dayStart.setHours(0, 0, 0, 0);
                dayMap.set(key, { label, date: dayStart, count: 0 });
            }
            dayMap.get(key)!.count++;
        });
        return Array.from(dayMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, val]) => ({ key, ...val }));
    }, [flights]);

    const handleSelectDay = useCallback((dayDate: Date) => {
        const start = new Date(dayDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(dayDate);
        end.setHours(23, 59, 59, 999);
        setStartDate(start);
        setEndDate(end);

        setTimeout(() => {
            if (mainContentRef.current) {
                mainContentRef.current.scrollTo({ left: 0, behavior: 'smooth' });
            }
        }, 100);
    }, []);

    const handleUndo = useCallback(() => {
        if (undoStack.length === 0) return;
        const prevFlights = undoStack[undoStack.length - 1];
        setUndoStack(prev => prev.slice(0, prev.length - 1));
        setRedoStack(prev => [...prev, flights]);
        updateDatabase({ flights: prevFlights, maintenanceBlocks, gates: gateList }, true);
        setAllocationMessage("↶ İşlem geri alındı (Undo)");
        setTimeout(() => setAllocationMessage(null), 3000);
    }, [undoStack, flights, maintenanceBlocks, gateList]);

    const handleRedo = useCallback(() => {
        if (redoStack.length === 0) return;
        const nextFlights = redoStack[redoStack.length - 1];
        setRedoStack(prev => prev.slice(0, prev.length - 1));
        setUndoStack(prev => [...prev, flights]);
        updateDatabase({ flights: nextFlights, maintenanceBlocks, gates: gateList }, true);
        setAllocationMessage("↷ İşlem yinelendi (Redo)");
        setTimeout(() => setAllocationMessage(null), 3000);
    }, [redoStack, flights, maintenanceBlocks, gateList]);

    const handleResetChanges = useCallback(() => {
        const baseline = committedFlights || (undoStack.length > 0 ? undoStack[0] : null);
        if (!baseline) return;
        if (window.confirm("Son kaydedilen/başlangıç durumuna dönmek ve tüm bekleyen değişiklikleri iptal etmek istediğinize emin misiniz?")) {
            setRedoStack(prev => [...prev, flights]);
            setUndoStack([]);
            updateDatabase({ flights: baseline, maintenanceBlocks, gates: gateList }, true);
            setAllocationMessage("↺ Değişiklikler iptal edildi, önceki plana dönüldü.");
            setTimeout(() => setAllocationMessage(null), 4000);
        }
    }, [committedFlights, undoStack, flights, maintenanceBlocks, gateList]);

    const handleCommitPlan = useCallback(() => {
        setCommittedFlights(flights);
        setUndoStack([]);
        setRedoStack([]);
        setAllocationMessage("💾 Planlama başarıyla onaylandı ve sabitlendi (Commit).");
        setTimeout(() => setAllocationMessage(null), 4000);
    }, [flights]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                if (e.shiftKey) {
                    e.preventDefault();
                    handleRedo();
                } else {
                    e.preventDefault();
                    handleUndo();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                handleRedo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleUndo, handleRedo]);

    const handleSelectAllRange = useCallback(() => {
        if (flights.length === 0) return;
        const allDates = flights.flatMap(f => [f.scheduledArrival, f.scheduledDeparture]).filter(d => d && !isNaN(d.getTime()));
        if (allDates.length === 0) return;
        const minMs = Math.min(...allDates.map(d => d.getTime()));
        const maxMs = Math.max(...allDates.map(d => d.getTime()));
        const start = new Date(minMs);
        start.setHours(0, 0, 0, 0);
        const end = new Date(maxMs);
        end.setHours(23, 59, 59, 999);
        setStartDate(start);
        setEndDate(end);
    }, [flights]);

    const isDaySelected = useCallback((dayDate: Date) => {
        const dayStart = new Date(dayDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayDate);
        dayEnd.setHours(23, 59, 59, 999);
        return Math.abs(startDate.getTime() - dayStart.getTime()) < 3600000 && Math.abs(endDate.getTime() - dayEnd.getTime()) < 3600000;
    }, [startDate, endDate]);

    const handleUnallocateAll = useCallback(() => {
        if (flights.length === 0) return;
        const confirmed = window.confirm("Tüm uçuşların stant atamaları sıfırlanıp bekleme havuzuna (Flight Pool) aktarılacak. Onaylıyor musunuz?");
        if (!confirmed) return;

        const newHistoryEntry: FlightHistoryEntry = {
            user: currentUser.username,
            action: "Tüm uçuşlar havuza çekildi (Unallocated All).",
            timestamp: new Date()
        };

        const unallocatedFlights = flights.map(f => ({
            ...f,
            parkingPosition: null,
            history: [...(f.history || []), newHistoryEntry]
        }));

        updateDatabase({ flights: unallocatedFlights, maintenanceBlocks, gates: gateList });
        setSelectedFlightIds(new Set());
        setPoolCollapsed(false);
        setAllocationMessage("Tüm uçuşlar başarıyla bekleme havuzuna aktarıldı.");
        setTimeout(() => setAllocationMessage(null), 5000);
    }, [flights, currentUser.username, maintenanceBlocks, gateList]);

    const handleRunAiAllocation = useCallback((options?: AiAllocationOptions) => {
        if (flights.length === 0) return;
        setIsAiAllocating(true);

        setTimeout(() => {
            try {
                const initialStats = calculateBridgeUtilization(flights, startDate, endDate);
                const { flights: newFlights, stats, swapDetails, totalSwapsPerformed, netFlightsGained, gapFillsPerformed, bufferSmoothedCount, fidsWarnings, fidsLockedCount, timeFilteredFlightCount } = runAiBridgeAllocation(flights, startDate, endDate, maintenanceBlocks, options);

                const fidsMsg = (fidsLockedCount && fidsLockedCount > 0) ? `, 🛡️ ${fidsLockedCount} FIDS Kilitli` : '';
                const timeMsg = (timeFilteredFlightCount && timeFilteredFlightCount > 0) ? `, ⏱️ ${timeFilteredFlightCount} Zaman Dışı Korundu` : '';

                const newHistoryEntry: FlightHistoryEntry = {
                    user: currentUser.username,
                    action: `AI Skor Planlama yapıldı (Köprü Oranı: %${stats.bridgeRate.toFixed(1)}, ${totalSwapsPerformed} akıllı takas${fidsMsg}${timeMsg}).`,
                    timestamp: new Date()
                };

                const flightsWithHistory = newFlights.map(f => ({
                    ...f,
                    history: [...(f.history || []), newHistoryEntry]
                }));

                updateDatabase({ flights: flightsWithHistory, maintenanceBlocks, gates: gateList });
                setSelectedFlightIds(new Set());

                // Auto expand concourses that have newly assigned flights
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
                            next[name] = false;
                        });
                        return next;
                    });
                }

                const smoothMsg = (bufferSmoothedCount && bufferSmoothedCount > 0) ? `, 🛡️ ${bufferSmoothedCount} Tampon Dengelendi` : '';
                setAllocationMessage(`⚡ AI Skor Planlama Tamamlandı: %${stats.bridgeRate.toFixed(1)} Köprü Oranı (${stats.bridgeAssignedCount} / ${stats.eligibleFlightsCount} Yolcu Körükte, ${totalSwapsPerformed} Akıllı Takas${smoothMsg}${fidsMsg})`);
                setTimeout(() => setAllocationMessage(null), 8000);

                // Open AI Report Card Modal
                setAiReportData({
                    stats,
                    initialStats,
                    swapDetails,
                    totalSwapsPerformed,
                    netFlightsGained,
                    gapFillsPerformed,
                    fidsWarnings,
                    fidsLockedCount,
                    timeFilteredFlightCount
                });
                setIsAiReportModalOpen(true);
            } catch (err) {
                console.error("AI allocation error:", err);
                alert("AI planlama sırasında bir hata oluştu.");
            } finally {
                setIsAiAllocating(false);
            }
        }, 100);
    }, [flights, startDate, endDate, currentUser.username, maintenanceBlocks, gateList]);

    const handleCopilotUpdates = useCallback((updatedFlights: Flight[], message: string) => {
        const newHistoryEntry: FlightHistoryEntry = {
            user: currentUser.username,
            action: message,
            timestamp: new Date()
        };
        const flightsWithHistory = updatedFlights.map(f => ({
            ...f,
            history: [...(f.history || []), newHistoryEntry]
        }));
        updateDatabase({ flights: flightsWithHistory, maintenanceBlocks, gates: gateList });
        setAllocationMessage(message);
        setTimeout(() => setAllocationMessage(null), 8000);
    }, [currentUser.username, maintenanceBlocks, gateList]);
    
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

    const handleToggleFlightSuperSet = useCallback((flightId: string) => {
        const targetFlight = flights.find(f => f.id === flightId);
        if (!targetFlight) return;
        const nextState = !targetFlight.isSuperSet;
        const action = nextState ? "Super Set etkinleştirildi (Destinasyon kuralları askıya alındı)." : "Super Set devre dışı bırakıldı.";
        const newHistoryEntry: FlightHistoryEntry = { user: currentUser.username, action, timestamp: new Date() };

        const newFlights = flights.map(f =>
            f.id === flightId ? { ...f, isSuperSet: nextState, history: [...(f.history || []), newHistoryEntry] } : f
        );
        updateDatabase({ flights: newFlights, maintenanceBlocks, gates: gateList });
    }, [flights, maintenanceBlocks, currentUser.username, gateList]);

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

        // Strict Operational Rule: Do not allow manual assignment onto stands during active maintenance/downgrade
        if (hasMaintenanceConflict(parkingPosition, flight.scheduledArrival, flight.scheduledDeparture, maintenanceBlocks)) {
            const conflictBlock = maintenanceBlocks.find(b => {
                const bPos = b.parkingPosition ? b.parkingPosition.trim().toUpperCase() : '';
                const fPos = parkingPosition.trim().toUpperCase();
                const isMatch = fPos === bPos ||
                    ((fPos.endsWith('L') || fPos.endsWith('R')) && fPos.slice(0, -1) === bPos) ||
                    ((bPos.endsWith('L') || bPos.endsWith('R')) && bPos.slice(0, -1) === fPos);
                const bStart = new Date(b.startTime).getTime();
                const bEnd = new Date(b.endTime).getTime();
                return isMatch && flight.scheduledArrival.getTime() < bEnd && flight.scheduledDeparture.getTime() > bStart;
            });

            const durStr = conflictBlock ? `(${new Date(conflictBlock.startTime).toLocaleString('tr-TR')} - ${new Date(conflictBlock.endTime).toLocaleString('tr-TR')})` : '';
            const reasonStr = conflictBlock?.reason ? `[${conflictBlock.reason}]` : 'Bakım';
            alert(`⚠️ MANUEL ATAMA ENGELLENDİ!\n\n${parkingPosition} park pozisyonunda aktif bakım/downgrade bulunmaktadır:\n${reasonStr} ${durStr}\n\nBakım süresi boyunca bu pozisyona manuel uçak yatırılamaz.`);
            return;
        }

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
        const savedBlock: MaintenanceBlock = id_to_update 
            ? { ...block, id: id_to_update } 
            : { ...block, id: `maint-${Date.now()}` };

        const newBlocks = id_to_update
            ? maintenanceBlocks.map(b => b.id === id_to_update ? savedBlock : b)
            : [...maintenanceBlocks, savedBlock];

        // Flights remain intact as planned; maintenance block is placed on the stand
        updateDatabase({ flights, maintenanceBlocks: newBlocks, gates: gateList });

        setAllocationMessage(`✅ ${savedBlock.parkingPosition} pozisyonuna bakım/downgrade başarıyla kaydedildi.`);
        setTimeout(() => setAllocationMessage(null), 5000);
    };

    const handleImportMaintenanceBlocks = (importedBlocks: MaintenanceBlock[]) => {
        const existingKeys = new Set(
            maintenanceBlocks.map(b =>
                `${b.parkingPosition.trim().toUpperCase()}|${new Date(b.startTime).getTime()}|${new Date(b.endTime).getTime()}|${b.reason.trim().toUpperCase()}`
            )
        );

        const filteredNewBlocks = importedBlocks.filter(b => {
            const key = `${b.parkingPosition.trim().toUpperCase()}|${new Date(b.startTime).getTime()}|${new Date(b.endTime).getTime()}|${b.reason.trim().toUpperCase()}`;
            return !existingKeys.has(key);
        });

        const newBlocks = [...maintenanceBlocks, ...filteredNewBlocks];
        updateDatabase({ flights, maintenanceBlocks: newBlocks, gates: gateList });

        setAllocationMessage(`✅ ${filteredNewBlocks.length} adet bakım/downgrade kaydı sisteme başarıyla yüklendi!`);
        setTimeout(() => setAllocationMessage(null), 8000);
    };

    const handleClearAllMaintenance = () => {
        updateDatabase({ flights, maintenanceBlocks: [], gates: gateList });
        setAllocationMessage(`🧹 Tüm bakım ve downgrade kayıtları temizlendi.`);
        setTimeout(() => setAllocationMessage(null), 6000);
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

    const maintenanceByParkingPosition = useMemo(() => {
        const map: Record<string, MaintenanceBlock[]> = {};
        maintenanceBlocks.forEach(b => {
            if (!map[b.parkingPosition]) map[b.parkingPosition] = [];
            map[b.parkingPosition].push(b);
        });
        return map;
    }, [maintenanceBlocks]);
    
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
            <header className="flex flex-col px-3 py-2 bg-[#1a1f2c] border-b border-gray-750 shadow-xl flex-shrink-0 z-40 gap-y-2 text-xs">
                {/* Top Row: Brand, Financial KPIs, Operational Groups, Super Set, Export & Quick Actions */}
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-x-3">
                        {/* GAMS Brand Badge */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-950/90 to-indigo-950/90 border border-blue-500/30 shadow-sm">
                            <span className="text-sm font-black tracking-wider text-white">GAMS</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 uppercase tracking-wider">AOS</span>
                        </div>

                        {/* Financial Revenue Summary */}
                        <HeaderRevenueSummary flights={flights} startDate={startDate} endDate={endDate} />

                        {/* Bridge Utilization Rate KPI Badge */}
                        {flights.length > 0 && (
                            <div className="bg-gradient-to-r from-indigo-950/90 to-purple-950/90 border border-indigo-400/50 rounded-lg px-2.5 py-1 flex items-center space-x-1.5 shadow select-none" title={`Kalkış (ATD) Bazlı Köprü Kullanım Oranı: Seçili dönemde kalkışı olan ${bridgeStats.eligibleFlightsCount} tarifeli/uygun yolcu uçağının ${bridgeStats.bridgeAssignedCount} tanesi köprüye (PBB Pier A-G) bağlandı.`}>
                                <span className="text-indigo-300 font-bold">🌉 Köprü Oranı:</span>
                                <span className="text-emerald-300 font-black text-sm">%{bridgeStats.bridgeRate.toFixed(1)}</span>
                                <span className="text-gray-400 text-[10px]">({bridgeStats.bridgeAssignedCount}/{bridgeStats.eligibleFlightsCount} Yolcu)</span>
                            </div>
                        )}

                        <div className="h-6 w-px bg-gray-700"></div>

                        {/* Data Management Group */}
                        <div className="flex items-center gap-1.5">
                            <label htmlFor="file-upload" className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm hover:shadow transition duration-200 cursor-pointer select-none">
                                <svg className="w-3.5 h-3.5 text-indigo-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Excel Yükle
                            </label>
                            <input id="file-upload" type="file" className="hidden" onChange={onFileUpload} accept=".xlsx, .xls, .csv" />

                            {/* ↶ UNDO / ↷ REDO / ↺ CANCEL / 💾 COMMIT */}
                            <div className="flex items-center bg-gray-800/80 p-0.5 rounded-lg border border-gray-700/80 shadow-sm">
                                <button
                                    onClick={handleUndo}
                                    disabled={undoStack.length === 0}
                                    className="px-2 py-1 text-xs font-semibold rounded text-gray-200 hover:text-white hover:bg-gray-700/80 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-1 cursor-pointer"
                                    title="Geri Al (Ctrl+Z)"
                                >
                                    <span>↶</span>
                                    <span>Geri Al</span>
                                    {undoStack.length > 0 && <span className="text-[10px] bg-gray-700 px-1 rounded text-gray-300">{undoStack.length}</span>}
                                </button>
                                <button
                                    onClick={handleRedo}
                                    disabled={redoStack.length === 0}
                                    className="px-2 py-1 text-xs font-semibold rounded text-gray-200 hover:text-white hover:bg-gray-700/80 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-1 border-l border-gray-700 cursor-pointer"
                                    title="Yinele (Ctrl+Y)"
                                >
                                    <span>↷</span>
                                    <span>Yinele</span>
                                    {redoStack.length > 0 && <span className="text-[10px] bg-gray-700 px-1 rounded text-gray-300">{redoStack.length}</span>}
                                </button>
                                <button
                                    onClick={handleResetChanges}
                                    disabled={undoStack.length === 0 && !committedFlights}
                                    className="px-2 py-1 text-xs font-semibold rounded text-red-300 hover:text-red-100 hover:bg-red-950/60 disabled:opacity-30 disabled:cursor-not-allowed transition flex items-center gap-1 border-l border-gray-700 cursor-pointer"
                                    title="Tüm bekleyen değişiklikleri iptal et ve önceki duruma dön (Cancel/Reset)"
                                >
                                    <span>↺</span>
                                    <span>İptal Et</span>
                                </button>
                                <button
                                    onClick={handleCommitPlan}
                                    disabled={flights.length === 0}
                                    className="px-2.5 py-1 text-xs font-semibold rounded bg-blue-600/80 hover:bg-blue-500 text-white transition flex items-center gap-1 border-l border-gray-700 shadow-sm cursor-pointer"
                                    title="Mevcut planlamayı onayla ve sabitle (Commit)"
                                >
                                    <span>💾</span>
                                    <span>Onayla</span>
                                </button>
                            </div>

                            {/* 🟠 TÜMÜNÜ HAVUZA ÇEK (UNALLOCATE ALL) */}
                            <button 
                                onClick={handleUnallocateAll}
                                disabled={flights.length === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg bg-amber-600/90 hover:bg-amber-500 text-white shadow-sm transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none border border-amber-500/50"
                                title="Tüm uçuşların stant atamalarını kaldırıp bekleme havuzuna (Flight Pool) aktar"
                            >
                                <svg className="w-3.5 h-3.5 text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                Tümünü Havuza Çek
                            </button>

                            {/* 🟣 AI PLANLA: SENARYO 1 (MAKSİMUM KÖPRÜ) */}
                            <button 
                                onClick={() => setIsAiScorePlannerModalOpen(true)}
                                disabled={flights.length === 0 || isAiAllocating}
                                className={`flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg text-white shadow-md transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none border border-purple-400/40 ${
                                    isAiAllocating 
                                        ? 'bg-purple-800 animate-pulse' 
                                        : 'bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 shadow-purple-600/30'
                                }`}
                                title="AI Skor Planla: Hızlı kural ve skor tabanlı deterministik köprü planlaması"
                            >
                                <svg className={`w-3.5 h-3.5 text-purple-200 ${isAiAllocating ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                {isAiAllocating ? 'Skor Planlanıyor...' : '⚡ AI Skor Planla'}
                            </button>

                            {/* 🟢 OCC AI CO-PİLOT (CANLI FIRSATLAR & GELİR) */}
                            <button 
                                onClick={() => setIsCopilotOpen(true)}
                                disabled={flights.length === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg text-white shadow-md transition duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none border border-emerald-400/50 bg-gradient-to-r from-teal-600 via-emerald-600 to-indigo-600 hover:from-teal-500 hover:to-emerald-500 shadow-emerald-700/30"
                                title="Körük doluluk oranını artırmak için canlı AI Co-Pilot fırsatlarını ve ek gelir analizini aç"
                            >
                                <span className="text-sm">🤖</span>
                                <span>OCC AI Co-Pilot</span>
                                <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-emerald-300 text-gray-950 shadow-sm">
                                    Fırsatlar
                                </span>
                            </button>

                            {/* 🚨 DİNAMİK DİVERT & KRİZ KAPASİTE (DAC) */}
                            <button
                                onClick={() => setIsDivertModalOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg text-white shadow-md transition duration-200 cursor-pointer select-none border border-cyan-400/50 bg-gradient-to-r from-cyan-700 via-blue-700 to-indigo-700 hover:from-cyan-600 hover:to-blue-600 shadow-cyan-900/40"
                                title="Çevre meydan kapanmaları için T+4, T+8, T+12 saatlik boş stand ve divert kabul kapasitesini aç"
                            >
                                <span className="text-sm">🚨</span>
                                <span>Divert & Kriz Kapasite</span>
                                <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-cyan-300 text-gray-950 shadow-sm">
                                    T+4 / T+8
                                </span>
                            </button>


                            {/* 🔑 GEMINI API KEY AYARLARI */}
                            <button
                                onClick={() => setIsGeminiSettingsOpen(true)}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                                    geminiKeyActive
                                        ? 'bg-purple-950/60 border-purple-500/50 text-purple-200 hover:bg-purple-900/80'
                                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                                }`}
                                title="Gemini API Anahtarı ve Model Ayarları"
                            >
                                <span className="text-xs">🔑</span>
                                <span>API Key</span>
                                <span className={`w-2 h-2 rounded-full ${geminiKeyActive ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                            </button>

                            <button 
                                onClick={handleExportGateExcel} 
                                className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg bg-gray-800/90 hover:bg-gray-750 text-emerald-400 hover:text-emerald-300 border border-emerald-600/40 shadow-sm transition duration-200"
                                title="Uçuş atama ve gate bilgilerini Excel olarak dışa aktar"
                            >
                                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Gate Dışa Aktar
                            </button>
                        </div>

                        <div className="h-6 w-px bg-gray-700"></div>

                        {/* Maintenance Controls Group */}
                        <div className="flex items-center bg-gray-900/70 border border-gray-700 rounded-lg p-0.5 shadow-inner">
                            <button 
                                onClick={() => { setEditingMaintenanceBlock(null); setMaintenanceModalOpen(true); }} 
                                className="px-2.5 py-1 font-semibold text-amber-300 hover:bg-gray-800 rounded-md transition flex items-center gap-1"
                                title="Yeni park pozisyonu bakımı ekle"
                            >
                                <span className="text-amber-400 font-bold">+</span> Bakım Ekle
                            </button>
                            <div className="h-4 w-px bg-gray-700/80 mx-0.5"></div>
                            <button 
                                onClick={() => setMaintenanceImportModalOpen(true)} 
                                className="px-2.5 py-1 font-semibold text-indigo-400 hover:text-indigo-300 hover:bg-gray-800 rounded-md transition flex items-center gap-1"
                                title="Excel dosyasından toplu bakım / downgrade yükle"
                            >
                                <span>📥</span> Bakım Excel Yükle
                            </button>
                            <div className="h-4 w-px bg-gray-700/80 mx-0.5"></div>
                            <button 
                                onClick={() => setMaintenanceManagementModalOpen(true)} 
                                className="px-2.5 py-1 font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-md transition flex items-center gap-1"
                                title="Tanımlı bakımları listele ve yönet"
                            >
                                <span>🛠️</span> Bakım Yönetimi
                                {maintenanceBlocks.length > 0 && (
                                    <span className="bg-purple-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full ml-1">
                                        {maintenanceBlocks.length}
                                    </span>
                                )}
                            </button>
                        </div>

                        <div className="h-6 w-px bg-gray-700"></div>

                        {/* Super Set AMS Rule Bypass Mode */}
                        <button
                            onClick={() => setIsSuperSetMode(prev => !prev)}
                            className={`flex items-center gap-2 px-3 py-1.5 font-bold rounded-lg transition duration-200 select-none shadow-sm border ${
                                isSuperSetMode
                                    ? 'bg-amber-400 text-gray-950 border-amber-300 ring-2 ring-amber-300/60 shadow-amber-500/20 animate-pulse'
                                    : 'bg-gray-900/80 hover:bg-gray-800 text-amber-400 border-amber-500/40 hover:border-amber-400'
                            }`}
                            title="Tip ve MARS emniyeti hariç tüm destinasyon, iç/dış hat ve kargo kurallarını askıya alır."
                        >
                            <span className="text-sm">⚡</span>
                            <span>Super Set</span>
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded tracking-wide ${isSuperSetMode ? 'bg-black text-amber-300' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                                {isSuperSetMode ? 'AÇIK' : 'KAPALI'}
                            </span>
                        </button>
                    </div>

                    {/* Right Side: Quick Navigation & Clear */}
                    <div className="flex items-center gap-x-2.5">
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
                            className="flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition duration-200"
                            title="Zaman akışında ilk uçuşun saatinin olduğu yere otomatik kaydır"
                        >
                            <span>🎯</span> Uçuşlara Git
                        </button>

                        <button 
                            onClick={handleClearAllFlights} 
                            className="flex items-center gap-1.5 px-2.5 py-1.5 font-semibold rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 hover:text-red-200 border border-red-800/40 transition duration-200"
                            title="Tüm uçuşları ve bakım kayıtlarını temizle"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Tümünü Sil
                        </button>
                    </div>
                </div>
                
                {/* Bottom Row: View Selection, Flight Linking, Search & Filter Controls */}
                <div className="flex items-center justify-between w-full border-t border-gray-750/80 pt-2">
                    <div className="flex items-center gap-x-3">
                        {/* View Switcher: Park Planı vs Gate Planı */}
                        <div className="flex items-center bg-gray-900/80 border border-gray-700/80 rounded-lg p-0.5 shadow-inner">
                            <button 
                                onClick={() => setCurrentView('parking')} 
                                className={`px-3 py-1 font-semibold rounded-md transition duration-200 ${currentView === 'parking' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                Park Planı
                            </button>
                            <button 
                                onClick={() => setCurrentView('gate')} 
                                className={`px-3 py-1 font-semibold rounded-md transition duration-200 ${currentView === 'gate' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                Gate Planı
                            </button>
                        </div>

                        <div className="h-6 w-px bg-gray-700/60"></div>

                        {/* Turnaround Linking Group */}
                        <div className="flex items-center bg-gray-900/80 border border-gray-700/80 rounded-lg p-0.5 shadow-inner">
                            <button 
                                onClick={handleUnlink} 
                                disabled={!canUnlink} 
                                className="px-3 py-1 font-medium rounded-md transition duration-200 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 hover:text-white hover:bg-gray-800"
                            >
                                Bağlantıyı Kopar
                            </button>
                            <div className="h-4 w-px bg-gray-700/80 mx-0.5"></div>
                            <button 
                                onClick={handleLink} 
                                disabled={!canLink} 
                                className="px-3 py-1 font-medium rounded-md transition duration-200 disabled:opacity-30 disabled:cursor-not-allowed text-gray-300 hover:text-white hover:bg-gray-800"
                            >
                                Bağla
                            </button>
                        </div>
                    </div>

                    {/* Right Side: Filters, Search, Timeline Dates */}
                    <div className="flex items-center gap-x-2.5">
                        {/* Domestic / International Filter Pill */}
                        <div className="flex items-center bg-gray-900/80 border border-gray-700/80 rounded-lg p-0.5 shadow-inner">
                            <button 
                                onClick={() => setActiveFilter('all')} 
                                className={`px-2.5 py-1 font-semibold rounded-md transition duration-200 ${activeFilter === 'all' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                Tümü
                            </button>
                            <button 
                                onClick={() => setActiveFilter('domestic')} 
                                className={`px-2.5 py-1 font-semibold rounded-md transition duration-200 ${activeFilter === 'domestic' ? 'bg-red-800 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                İç Hat
                            </button>
                            <button 
                                onClick={() => setActiveFilter('international')} 
                                className={`px-2.5 py-1 font-semibold rounded-md transition duration-200 ${activeFilter === 'international' ? 'bg-blue-800 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                Dış Hat
                            </button>
                        </div>

                        {/* Search Input with Search Icon */}
                        <div className="relative">
                            <svg className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Uçuş Ara (No, Tip, Reg)..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="bg-gray-900/90 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-white placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 w-52 text-xs outline-none transition"
                            />
                        </div>

                        {/* Day Pills & Unified Date Range Container */}
                        <div className="flex items-center gap-2">
                            {availableDays.length > 1 && (
                                <div className="flex items-center gap-1 bg-gray-900/90 border border-gray-700/80 px-1.5 py-0.5 rounded-lg overflow-x-auto max-w-[280px] scrollbar-none shadow-inner">
                                    <button
                                        onClick={handleSelectAllRange}
                                        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition select-none ${
                                            !availableDays.some(d => isDaySelected(d.date))
                                                ? 'bg-blue-600 text-white shadow'
                                                : 'text-gray-400 hover:text-gray-200'
                                        }`}
                                        title="Tüm yüklenen uçuş haftasını kapsa"
                                    >
                                        Tümü
                                    </button>
                                    {availableDays.map(d => {
                                        const selected = isDaySelected(d.date);
                                        return (
                                            <button
                                                key={d.key}
                                                onClick={() => handleSelectDay(d.date)}
                                                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition whitespace-nowrap select-none ${
                                                    selected
                                                        ? 'bg-emerald-600 text-white shadow ring-1 ring-emerald-400 font-bold'
                                                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                                                }`}
                                                title={`${d.label} (Toplam ${d.count} kalkış)`}
                                            >
                                                {d.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Unified Date Range Container */}
                            <div className="flex items-center gap-1.5 bg-gray-900/80 border border-gray-700/80 px-2.5 py-1 rounded-lg text-xs">
                                <span className="text-gray-400 font-medium">Başlangıç:</span>
                                <input 
                                    id="start-date" 
                                    type="datetime-local" 
                                    value={formatDateForInput(startDate)} 
                                    onChange={handleStartDateChange} 
                                    className="bg-transparent text-gray-200 outline-none text-xs cursor-pointer focus:text-white"
                                />
                                <span className="text-gray-600">|</span>
                                <span className="text-gray-400 font-medium">Bitiş:</span>
                                <input 
                                    id="end-date" 
                                    type="datetime-local" 
                                    value={formatDateForInput(endDate)} 
                                    onChange={handleEndDateChange} 
                                    className="bg-transparent text-gray-200 outline-none text-xs cursor-pointer focus:text-white"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {allocationMessage && (
                <div className="bg-gradient-to-r from-purple-950 via-indigo-950 to-purple-950 text-white px-4 py-2 border-b border-purple-500/50 flex items-center justify-between text-xs font-semibold shadow-lg z-50 animate-fadeIn">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-2.5 w-2.5 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </span>
                        <span className="text-gray-100">{allocationMessage}</span>
                    </div>
                    <button onClick={() => setAllocationMessage(null)} className="text-gray-400 hover:text-white font-bold ml-4 text-sm leading-none">✕</button>
                </div>
            )}

            <ExcelImportReportModal isOpen={isReportModalOpen} onClose={() => setReportModalOpen(false)} report={importReport} />
            <AiAllocationReportModal isOpen={isAiReportModalOpen} onClose={() => setIsAiReportModalOpen(false)} report={aiReportData} />
            {isGeminiDeepPlanOpen && (
                <ErrorBoundary fallbackTitle="AI Derin Planla Modalı Hatası">
                    <GeminiDeepPlanModal
                        isOpen={isGeminiDeepPlanOpen}
                        onClose={() => setIsGeminiDeepPlanOpen(false)}
                        flights={flights}
                        currentStartDate={startDate}
                        currentEndDate={endDate}
                        maintenanceBlocks={maintenanceBlocks}
                        onApplyPlan={handleCopilotUpdates}
                        onOpenApiKeyModal={() => {
                            setIsGeminiDeepPlanOpen(false);
                            setIsGeminiSettingsOpen(true);
                        }}
                    />
                </ErrorBoundary>
            )}
            <AiCopilotModal isOpen={isCopilotOpen} onClose={() => setIsCopilotOpen(false)} flights={flights} maintenanceBlocks={maintenanceBlocks} onApplyUpdates={handleCopilotUpdates} />
            <DivertCapacityModal 
                isOpen={isDivertModalOpen} 
                onClose={() => setIsDivertModalOpen(false)} 
                flights={flights} 
                maintenanceBlocks={maintenanceBlocks} 
                startDate={startDate} 
                endDate={endDate} 
            />
            {isGeminiThinkingOpen && (
                <ErrorBoundary fallbackTitle="Gemini Derin Düşünce Modalı Hatası">
                    <GeminiDeepThinkingModal
                        isOpen={isGeminiThinkingOpen}
                        onClose={() => setIsGeminiThinkingOpen(false)}
                        flights={flights}
                        maintenanceBlocks={maintenanceBlocks}
                        onApplyUpdates={handleCopilotUpdates}
                        onOpenSettings={() => {
                            setIsGeminiThinkingOpen(false);
                            setIsGeminiSettingsOpen(true);
                        }}
                    />
                </ErrorBoundary>
            )}
            {isGeminiSettingsOpen && (
                <ErrorBoundary fallbackTitle="Gemini Ayarları Modalı Hatası">
                    <GeminiSettingsModal
                        isOpen={isGeminiSettingsOpen}
                        onClose={() => setIsGeminiSettingsOpen(false)}
                        onKeyUpdated={() => setGeminiKeyActive(Boolean(getStoredApiKey()))}
                    />
                </ErrorBoundary>
            )}
            <ExcelErrorModal isOpen={isExcelErrorModalOpen} onClose={() => setExcelErrorModalOpen(false)} errors={excelErrors} />
            {historyModalFlight && <FlightHistoryModal flight={historyModalFlight} onClose={() => setHistoryModalFlight(null)} />}
            {trackingFlight && <FlightTrackingModal flight={trackingFlight} onClose={() => setTrackingFlight(null)} />}
            
            <MaintenanceModal isOpen={isMaintenanceModalOpen} onClose={() => { setMaintenanceModalOpen(false); setEditingMaintenanceBlock(null); }} onSave={handleSaveMaintenance} blockToEdit={editingMaintenanceBlock} />
            <MaintenanceManagementModal 
                isOpen={isMaintenanceManagementModalOpen} 
                onClose={() => setMaintenanceManagementModalOpen(false)} 
                maintenanceBlocks={maintenanceBlocks} 
                onEdit={handleOpenEditMaintenanceModal} 
                onDelete={handleDeleteMaintenanceBlock}
                onOpenImport={() => setMaintenanceImportModalOpen(true)}
                onClearAll={handleClearAllMaintenance}
            />
            {isMaintenanceImportModalOpen && (
                <ErrorBoundary fallbackTitle="Bakım İçe Aktarma Modalı Hatası">
                    <MaintenanceImportModal
                        isOpen={isMaintenanceImportModalOpen}
                        onClose={() => setMaintenanceImportModalOpen(false)}
                        existingBlocks={maintenanceBlocks}
                        onImport={handleImportMaintenanceBlocks}
                    />
                </ErrorBoundary>
            )}
            
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

            <FlightContextMenu 
                menu={contextMenu} 
                onClose={() => setContextMenu(null)} 
                onToggleOverride={toggleRuleOverride} 
                onToggleSuperSet={handleToggleFlightSuperSet} 
                ruleOverrides={ruleOverrides} 
                onShowHistory={handleShowHistory} 
                onShowMap={handleShowMap} 
                onShowRadar={(flightId) => {
                    const f = flights.find(fl => fl.id === flightId);
                    if (f) setRadarTrackingFlight(f);
                }}
                onAssignGate={handleOpenGateAssignmentModal} 
            />

            {radarTrackingFlight && (
                <RadarTrackingModal
                    flight={radarTrackingFlight}
                    onClose={() => setRadarTrackingFlight(null)}
                />
            )}

            <AiScorePlannerModal
                isOpen={isAiScorePlannerModalOpen}
                onClose={() => setIsAiScorePlannerModalOpen(false)}
                onRunPlanning={(options) => handleRunAiAllocation(options)}
                flights={flights}
                currentStartDate={startDate}
                currentEndDate={endDate}
            />

            {isMappingModalOpen && excelData.current && (
                <ColumnMappingModal isOpen={isMappingModalOpen} onClose={() => setMappingModalOpen(false)} headers={excelData.current.headers} dataPreview={excelData.current.data.slice(0, 5)} onConfirm={handleConfirmMapping} />
            )}
            
            <div className="flex-grow flex flex-col overflow-hidden">
                <div ref={mainContentRef} className="flex-grow overflow-auto">
                    <div className="flex relative w-max min-w-full">
                        {/* Left Sticky Panel (Dondurulmuş Stant Başlıkları Kolonu) */}
                        <div className="w-48 flex-shrink-0 bg-[#2b2b2b] sticky left-0 z-30 flex flex-col border-r border-gray-600 shadow-[4px_0_12px_rgba(0,0,0,0.6)] select-none">
                            <div className="h-10 border-b-2 border-r border-gray-600 flex items-center justify-between px-2 font-bold text-sm sticky bg-[#2b2b2b] text-amber-400 z-[45]" style={{top: `${subHeaderTop}px`}}>
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
                            <div className="flex-shrink-0 sticky bg-[#2b2b2b] z-[40]" style={{top: `${poolTop}px`}}>
                                <div onClick={() => setPoolCollapsed(!isPoolCollapsed)} className="border-b border-r border-gray-600 flex items-center justify-center text-xs font-semibold text-amber-400 p-2 text-center select-none cursor-pointer bg-[#2b2b2b]" style={{ height: `${isPoolCollapsed ? COLLAPSED_POOL_HEIGHT : flightPoolHeight}px`, transition: 'height 0.2s ease' }}>
                                    <span className="inline-block w-4 text-center mr-1">{isPoolCollapsed ? '▸' : '▾'}</span>
                                    <span className="flex-grow font-bold">ATANMAMIŞ UÇUŞLAR</span>
                                </div>
                                {!isPoolCollapsed && (<div onMouseDown={handlePoolResizeMouseDown} className="h-1.5 bg-gray-600 hover:bg-purple-500 transition-colors cursor-ns-resize border-r border-gray-600" /> )}
                            </div>
                            {currentView === 'parking' ? (
                                Object.entries(CONCOURSE_LAYOUT).map(([concourseName, positions]) => (
                                <div key={concourseName}>
                                    <div onClick={() => toggleConcourse(concourseName)} className="h-10 border-b border-r border-gray-600 bg-[#252525] text-amber-400 font-bold text-sm sticky z-[35] cursor-pointer select-none flex items-center px-3 truncate" style={{ top: `${concourseHeaderTop}px` }}>
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
                                                            flights={flightsByParkingPosition[pos] || EMPTY_FLIGHTS} 
                                                            allFlights={flights} 
                                                            flightsByParkingPosition={flightsByParkingPosition}
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
                                                            maintenanceBlocks={maintenanceByParkingPosition[pos] || EMPTY_MAINTENANCE}
                                                            allMaintenanceBlocks={maintenanceBlocks}
                                                            onUpdateMaintenanceBlock={handleUpdateMaintenanceBlock}
                                                            isSuperSetMode={isSuperSetMode}
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
                                                flights={flightsByGate[gate] || EMPTY_FLIGHTS}
                                                allFlights={flights}
                                                flightsByParkingPosition={flightsByParkingPosition}
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
                                                maintenanceBlocks={EMPTY_MAINTENANCE}
                                                onUpdateMaintenanceBlock={() => {}} // Not applicable for gates
                                                isSuperSetMode={isSuperSetMode}
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
            <BottomRevenueSummaryBar flights={flights} startDate={startDate} endDate={endDate} />
        </div>
    );
};

export default App;