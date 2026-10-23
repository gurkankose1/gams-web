const fs = require('fs');
const xlsx = require('xlsx');

const filePath = 'C:/Users/gurka/Downloads/GAMS_Stand_Gate_Raporu_2026-10-20.xlsx';
const wb = xlsx.readFile(filePath);
const rawRows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

function parseDate(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.trim().split(' ');
    if (parts.length < 2) return null;
    const dParts = parts[0].split('.');
    const tParts = parts[1].split(':');
    if (dParts.length < 3 || tParts.length < 2) return null;
    return new Date(parseInt(dParts[2], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[0], 10), parseInt(tParts[0], 10), parseInt(tParts[1], 10));
}

const BRIDGE_PREFIXES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
function isBridgeStand(stand) {
    if (!stand || stand === 'Atanmadı') return false;
    const s = stand.toUpperCase().trim();
    if (s.startsWith('D19') || s.startsWith('D20')) return false;
    return BRIDGE_PREFIXES.includes(s[0]);
}

const oct19Start = new Date(2026, 9, 19, 0, 0, 0);
const oct19End = new Date(2026, 9, 19, 23, 59, 59, 999);

const bridgeFlights = rawRows.map(r => {
    const sta = parseDate(r.STA);
    const std = parseDate(r.STD);
    const stand = (r.Stand || '').trim();
    const durationMin = (sta && std) ? (std.getTime() - sta.getTime()) / (1000 * 60) : 0;
    const isBridge = isBridgeStand(stand);
    const isOnOct19 = std && std >= oct19Start && std <= oct19End;
    return {
        flightNo: r['Arrival Flight No'] || r['Departure Flight No'] || '',
        sta,
        std,
        stand,
        durationMin,
        isBridge,
        isOnOct19,
        rawSTA: r.STA,
        rawSTD: r.STD
    };
}).filter(f => f.isOnOct19 && f.isBridge && f.durationMin > 360);

// Day-time long stayers (arrives after 06:00 and departs before 22:00, staying > 5 hours)
const daytimeLongStayers = bridgeFlights.filter(f => {
    if (!f.sta || !f.std) return false;
    const arrH = f.sta.getHours();
    const depH = f.std.getHours();
    return arrH >= 6 && arrH <= 16 && f.durationMin >= 300;
});

console.log('Gündüz saatlerinde (06:00-22:00) körükte > 5 saat yatan uçak sayısı:', daytimeLongStayers.length);
daytimeLongStayers.forEach(f => {
    console.log(`• Stand ${f.stand}: ${f.flightNo} (${(f.durationMin/60).toFixed(1)} saat | ${f.rawSTA} - ${f.rawSTD})`);
});
