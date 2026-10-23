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

const flights = rawRows.map((r, i) => ({
    row: i + 2,
    arrFlight: (r['Arrival Flight No'] || '').trim(),
    depFlight: (r['Departure Flight No'] || '').trim(),
    flightNo: (r['Arrival Flight No'] || r['Departure Flight No'] || `ROW-${i+1}`).trim(),
    sta: parseDate(r.STA),
    std: parseDate(r.STD),
    stand: (r.Stand || 'Atanmadı').trim(),
    gate: (r.Gate || 'Atanmadı').trim(),
    rawSTA: r.STA,
    rawSTD: r.STD,
    rawETA: r.ETA,
    rawETD: r.ETD,
}));

const flightsByStand = {};
flights.forEach(f => {
    if (f.stand === 'Atanmadı') return;
    if (!flightsByStand[f.stand]) flightsByStand[f.stand] = [];
    flightsByStand[f.stand].push(f);
});

console.log('--- TÜM 20 ZAMAN ÇAKIŞMASI LİSTESİ ---');
let overlapCount = 0;
Object.entries(flightsByStand).forEach(([stand, fList]) => {
    fList.sort((a, b) => (a.sta ? a.sta.getTime() : 0) - (b.sta ? b.sta.getTime() : 0));
    for (let i = 0; i < fList.length; i++) {
        for (let j = i + 1; j < fList.length; j++) {
            const f1 = fList[i];
            const f2 = fList[j];
            if (!f1.sta || !f1.std || !f2.sta || !f2.std) continue;
            if (f1.sta < f2.std && f1.std > f2.sta) {
                overlapCount++;
                const overlapStart = new Date(Math.max(f1.sta.getTime(), f2.sta.getTime()));
                const overlapEnd = new Date(Math.min(f1.std.getTime(), f2.std.getTime()));
                const overlapMins = Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60));
                console.log(`[#${overlapCount}] Stand: ${stand} | Çakışma: ${overlapMins} dk`);
                console.log(`     Uçuş 1 (Satır ${f1.row}): ${f1.flightNo} (${f1.rawSTA} -> ${f1.rawSTD}) Gate: ${f1.gate}`);
                console.log(`     Uçuş 2 (Satır ${f2.row}): ${f2.flightNo} (${f2.rawSTA} -> ${f2.rawSTD}) Gate: ${f2.gate}`);
            }
        }
    }
});
