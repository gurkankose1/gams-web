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

const flights = rawRows.map(r => ({
    arr: r['Arrival Flight No'] || '',
    dep: r['Departure Flight No'] || '',
    flightNo: r['Arrival Flight No'] || r['Departure Flight No'] || '',
    sta: parseDate(r.STA),
    std: parseDate(r.STD),
    stand: (r.Stand || 'Atanmadı').trim(),
    gate: (r.Gate || 'Atanmadı').trim(),
    isBridge: isBridgeStand(r.Stand),
}));

// Remote flights breakdown
const remoteFlights = flights.filter(f => f.stand !== 'Atanmadı' && !f.isBridge);
console.log('Toplam Remote Uçuş:', remoteFlights.length);

const cargoStands = remoteFlights.filter(f => f.stand.startsWith('K'));
console.log('Kargo Stantlarındaki Uçuşlar (K):', cargoStands.length);

const apron1 = remoteFlights.filter(f => f.stand.startsWith('1'));
console.log('Apron 1 (100 serisi):', apron1.length);

const apron2 = remoteFlights.filter(f => f.stand.startsWith('2') || f.stand === 'D19' || f.stand === 'D20');
console.log('Apron 2 (200 serisi):', apron2.length);

const apron3 = remoteFlights.filter(f => f.stand.startsWith('3'));
console.log('Apron 3 (300 serisi):', apron3.length);

const otherAprons = remoteFlights.length - cargoStands.length - apron1.length - apron2.length - apron3.length;
console.log('Diğer Açık Stantlar (H, T, 600, 700):', otherAprons);

// Passenger flights on remote aprons (excluding Kargo K stands)
const nonCargoRemote = remoteFlights.filter(f => !f.stand.startsWith('K'));
console.log('Kargo Olmayan Açık Pozisyondaki Yolcu Uçuşları:', nonCargoRemote.length);
console.log('Bunların süre dağılımı:');
const nonCargoDurations = nonCargoRemote.map(f => (f.std && f.sta) ? (f.std.getTime() - f.sta.getTime()) / (1000 * 60) : 0);
console.log('  • <= 90 dk (Hızlı Dönüşlü Yolcu Uçağı Açıkta):', nonCargoDurations.filter(d => d > 0 && d <= 90).length);
console.log('  • 90-180 dk (Normal Yolcu Uçağı Açıkta):', nonCargoDurations.filter(d => d > 90 && d <= 180).length);
console.log('  • > 180 dk (Uzun Yatış Açıkta):', nonCargoDurations.filter(d => d > 180).length);
