const XLSX = require('xlsx');
const fs = require('fs');

const filePath = "C:\\Users\\gurka\\OneDrive\\Desktop\\IHK_ Report_Hourly_Flights (1).xlsx";
const workbook = XLSX.readFile(filePath, { cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rawData = XLSX.utils.sheet_to_json(sheet);

console.log('Total Raw Rows in Sheet:', rawData.length);

const parseAnyCell = (cellValue) => {
    if (cellValue === null || cellValue === undefined || cellValue === '') return null;
    if (cellValue instanceof Date && !isNaN(cellValue.getTime())) {
        return cellValue;
    }
    if (typeof cellValue === 'string') {
        const str = cellValue.trim();
        if (!str) return null;

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

const failures = [];
const parsedFlights = [];

rawData.forEach((row, i) => {
    let arrDate = parseAnyCell(row['ETA'] || row['STA']);
    let depDate = parseAnyCell(row['ETD'] || row['STD']);

    if (arrDate && arrDate.getFullYear() < 1970) arrDate = null;
    if (depDate && depDate.getFullYear() < 1970) depDate = null;

    const arrNum = row['Arr Flight'] || row['ArrFlight'];
    const depNum = row['Dep Flight'] || row['DepFlight'];
    const arrStand = row['ArrStand'] || row['Arr Stand'];
    const depStand = row['Dep Stand'] || row['DepStand'];

    if (!arrDate && !depDate) {
        failures.push({
            rowIndex: i + 2,
            reason: 'Hem Geliş (ETA/STA) hem Gidiş (ETD/STD) tarihi okunamadı veya boş.',
            arrNum,
            depNum,
            arrDateRaw: row['ETA'] || row['STA'],
            depDateRaw: row['ETD'] || row['STD']
        });
    } else {
        parsedFlights.push({
            rowIndex: i + 2,
            arrNum,
            depNum,
            arrDate: arrDate ? arrDate.toLocaleString('tr-TR') : null,
            depDate: depDate ? depDate.toLocaleString('tr-TR') : null,
            arrStand,
            depStand
        });
    }
});

console.log('Total Parsed Flights:', parsedFlights.length);
console.log('Total Failed Rows:', failures.length);
if (failures.length > 0) {
    console.log('\n--- FAILED ROWS DETAIL ---');
    console.log(JSON.stringify(failures, null, 2));
}

// Print distribution of parsed flights across hours on 04.09.2026
const hourlyDistribution = {};
parsedFlights.forEach(f => {
    if (f.arrDate) {
        const hourKey = f.arrDate.split(' ')[0] + ' ' + f.arrDate.split(' ')[1].split(':')[0] + ':00';
        hourlyDistribution[hourKey] = (hourlyDistribution[hourKey] || 0) + 1;
    }
});

console.log('\n--- HOURLY DISTRIBUTION ---');
console.table(hourlyDistribution);
