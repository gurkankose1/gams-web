const XLSX = require('xlsx');
const fs = require('fs');

const filePath = 'C:\\Users\\gurka\\Downloads\\IHK_ Report (2).xlsx';
const workbook = XLSX.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

console.log('Total Raw Rows:', rawData.length);

const TURKISH_DOMESTIC_AIRPORTS = new Set([
  'ADA', 'ADB', 'ESB', 'AYT', 'SAW', 'IST',
  'GZT', 'NAV', 'ASR', 'DNZ', 'EZS', 'SZF'
]);

const SINGLE_LEG_DURATION_MS = 60 * 60 * 1000;
const startDate = new Date('2026-09-04T00:00:00');

// Mapping based on user's exact file headers
const mapping = {
  arrivalFlightNumber: 'Arr Flight',
  departureFlightNumber: 'Dep Flight',
  arrivalDateTime: 'ETA',
  departureDateTime: 'ETD',
  aircraftType: 'A/C Type',
  origin: 'From',
  destination: 'Dep To Statition',
  arrivalMode: 'Arr I/D',
  departureMode: 'Dep I/D',
  arrivalParkingPosition: 'ArrStand',
  departureParkingPosition: 'Dep Stand',
  arrivalGate: 'ArrGate',
  departureGate: 'Gate',
};

const parseAnyCell = (cellValue) => {
    if (!cellValue) return null;
    if (cellValue instanceof Date && !isNaN(cellValue.getTime())) {
        return cellValue;
    }
    if (typeof cellValue === 'string') {
        const str = cellValue.trim();
        const match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (match) {
            const day = parseInt(match[1], 10);
            const month = parseInt(match[2], 10) - 1;
            const year = parseInt(match[3], 10);
            const hours = match[4] ? parseInt(match[4], 10) : 0;
            const minutes = match[5] ? parseInt(match[5], 10) : 0;
            const seconds = match[6] ? parseInt(match[6], 10) : 0;
            const d = new Date(year, month, day, hours, minutes, seconds);
            if (!isNaN(d.getTime())) return d;
        }

        const d = new Date(cellValue);
        if (!isNaN(d.getTime())) return d;
    }
    if (typeof cellValue === 'number' && cellValue > 1) { 
        const d = new Date(Math.round((cellValue - 25569) * 86400 * 1000));
        if(!isNaN(d.getTime())) return d;
    }
    return null;
};

const combineDateAndTime = (dateValue, timeValue, defaultDate) => {
    const parsedTimeCell = parseAnyCell(timeValue);
    if (parsedTimeCell && parsedTimeCell.getFullYear() > 1970) {
        return parsedTimeCell;
    }
    return null;
};

// Check parsing
let parsedCount = 0;
let errorCount = 0;
let standsFound = 0;

rawData.forEach((row, i) => {
  const arrDate = combineDateAndTime(null, row[mapping.arrivalDateTime], startDate);
  const depDate = combineDateAndTime(null, row[mapping.departureDateTime], startDate);

  const arrStand = String(row[mapping.arrivalParkingPosition] || '').trim();
  const depStand = String(row[mapping.departureParkingPosition] || '').trim();

  if (arrStand || depStand) standsFound++;

  if (arrDate || depDate) {
    parsedCount++;
  } else {
    errorCount++;
  }
});

console.log(`Parsed flights: ${parsedCount}, Errors/Skipped: ${errorCount}, Rows with Stands: ${standsFound}`);
