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
    const day = parseInt(dParts[0], 10);
    const month = parseInt(dParts[1], 10) - 1;
    const year = parseInt(dParts[2], 10);
    const hour = parseInt(tParts[0], 10);
    const minute = parseInt(tParts[1], 10);
    const d = new Date(year, month, day, hour, minute);
    return isNaN(d.getTime()) ? null : d;
}

const BRIDGE_PREFIXES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
function isBridgeStand(stand) {
    if (!stand || stand === 'Atanmadı') return false;
    const s = stand.toUpperCase().trim();
    if (s.startsWith('D19') || s.startsWith('D20')) return false;
    return BRIDGE_PREFIXES.includes(s[0]);
}

const flights = rawRows.map((r, i) => {
    const sta = parseDate(r.STA);
    const std = parseDate(r.STD);
    const stand = (r.Stand || 'Atanmadı').trim();
    const gate = (r.Gate || 'Atanmadı').trim();
    const arrFlight = (r['Arrival Flight No'] || '').trim();
    const depFlight = (r['Departure Flight No'] || '').trim();
    const flightNo = arrFlight || depFlight || `ROW-${i+1}`;
    const durationMin = (sta && std) ? (std.getTime() - sta.getTime()) / (1000 * 60) : 0;

    return {
        row: i + 2,
        arrFlight,
        depFlight,
        flightNo,
        sta,
        std,
        stand,
        gate,
        isBridge: isBridgeStand(stand),
        durationMin,
        raw: r
    };
});

console.log('====================================================');
console.log('🔍 DETAYLI OPERASYONEL DENETİM & KALİTE ANALİZİ');
console.log('====================================================');

// 1. AYNI STAND ÜZERİNDE ÇAKIŞMALAR (DIRECT OVERLAPS)
const flightsByStand = {};
flights.forEach(f => {
    if (f.stand === 'Atanmadı') return;
    if (!flightsByStand[f.stand]) flightsByStand[f.stand] = [];
    flightsByStand[f.stand].push(f);
});

let directOverlaps = [];
let tightBuffers = []; // < 15 dk

Object.entries(flightsByStand).forEach(([stand, fList]) => {
    // Sort by arrival
    fList.sort((a, b) => (a.sta ? a.sta.getTime() : 0) - (b.sta ? b.sta.getTime() : 0));
    for (let i = 0; i < fList.length; i++) {
        for (let j = i + 1; j < fList.length; j++) {
            const f1 = fList[i];
            const f2 = fList[j];
            if (!f1.sta || !f1.std || !f2.sta || !f2.std) continue;

            // Check overlap: f1.sta < f2.std && f1.std > f2.sta
            if (f1.sta < f2.std && f1.std > f2.sta) {
                directOverlaps.push({ stand, f1, f2 });
            } else {
                // Buffer check (if f1 departs before f2 arrives)
                const bufferMin = (f2.sta.getTime() - f1.std.getTime()) / (1000 * 60);
                if (bufferMin >= 0 && bufferMin < 15) {
                    tightBuffers.push({ stand, f1, f2, bufferMin });
                }
            }
        }
    }
});

console.log(`\n1. AYNI STANDDA ZAMAN ÇAKIŞMASI (Direct Overlap): ${directOverlaps.length}`);
if (directOverlaps.length > 0) {
    console.log('⚠️ ÇAKIŞAN UÇUŞ ÖRNEKLERİ:');
    directOverlaps.slice(0, 10).forEach(o => {
        console.log(`  • Stand ${o.stand}: ${o.f1.flightNo} (${o.f1.raw.STA}-${o.f1.raw.STD}) <-> ${o.f2.flightNo} (${o.f2.raw.STA}-${o.f2.raw.STD})`);
    });
} else {
    console.log('✅ Harika! Aynı stant üzerinde zaman çakışması (çifte rezervasyon) bulunmuyor.');
}

console.log(`\n2. KRİTİK STAND BOŞALMA TAMPONU (< 15 dk buffer): ${tightBuffers.length} adet`);
if (tightBuffers.length > 0) {
    console.log('⚠️ Çok dar tamponlu (< 15 dk) geçiş örnekleri:');
    tightBuffers.slice(0, 5).forEach(b => {
        console.log(`  • Stand ${b.stand}: ${b.f1.flightNo} kalkış ${b.f1.raw.STD} -> ${b.f2.flightNo} geliş ${b.f2.raw.STA} (Tampon: ${b.bufferMin} dk)`);
    });
}

// 3. MARS ÇAKIŞMALARI (Center vs Left/Right)
// Helper to get MARS relatives
function getMarsRelatives(pos) {
    if (pos.endsWith('L') || pos.endsWith('R')) {
        return [pos.slice(0, -1)];
    } else {
        return [pos + 'L', pos + 'R'];
    }
}

let marsOverlaps = [];
Object.entries(flightsByStand).forEach(([stand, fList]) => {
    const relatives = getMarsRelatives(stand);
    relatives.forEach(relStand => {
        const relList = flightsByStand[relStand];
        if (!relList) return;
        fList.forEach(f1 => {
            relList.forEach(f2 => {
                if (!f1.sta || !f1.std || !f2.sta || !f2.std) return;
                if (f1.sta < f2.std && f1.std > f2.sta) {
                    // Prevent duplicate reporting
                    if (stand < relStand) {
                        marsOverlaps.push({ stand1: stand, stand2: relStand, f1, f2 });
                    }
                }
            });
        });
    });
});

console.log(`\n3. MARS ÇAKIŞMASI (Center ve L/R aynı anda dolu): ${marsOverlaps.length}`);
if (marsOverlaps.length > 0) {
    console.log('⚠️ MARS ÇAKIŞMA ÖRNEKLERİ:');
    marsOverlaps.slice(0, 10).forEach(m => {
        console.log(`  • ${m.stand1} (${m.f1.flightNo}: ${m.f1.raw.STA}-${m.f1.raw.STD}) <-> ${m.stand2} (${m.f2.flightNo}: ${m.f2.raw.STA}-${m.f2.raw.STD})`);
    });
} else {
    console.log('✅ Mükemmel! MARS Center ve Sub-stand pozisyonları arasında hiçbir çakışma yok.');
}

// 4. KÖRÜKTE UZUN YATAN UÇAKLAR (LONG STAY ON BRIDGES)
const bridgeFlights = flights.filter(f => f.isBridge && f.durationMin > 0);
const bridgeOver4h = bridgeFlights.filter(f => f.durationMin > 240);
const bridgeOver6h = bridgeFlights.filter(f => f.durationMin > 360);
const bridgeOver10h = bridgeFlights.filter(f => f.durationMin > 600);

console.log('\n4. KÖRÜKTE YATIŞ SÜRESİ DAĞILIMI (BRIDGE GROUND TIMES):');
console.log(`  • Toplam Körük Uçuşu: ${bridgeFlights.length}`);
console.log(`  • 0 - 2 Saat (Hızlı Dönüş / İdeal): ${bridgeFlights.filter(f => f.durationMin <= 120).length} (%${((bridgeFlights.filter(f => f.durationMin <= 120).length / bridgeFlights.length) * 100).toFixed(1)})`);
console.log(`  • 2 - 4 Saat (Normal Dönüş): ${bridgeFlights.filter(f => f.durationMin > 120 && f.durationMin <= 240).length} (%${((bridgeFlights.filter(f => f.durationMin > 120 && f.durationMin <= 240).length / bridgeFlights.length) * 100).toFixed(1)})`);
console.log(`  • 4 - 6 Saat (Uzun Yatış / Potansiyel Risk): ${bridgeFlights.filter(f => f.durationMin > 240 && f.durationMin <= 360).length} (%${((bridgeFlights.filter(f => f.durationMin > 240 && f.durationMin <= 360).length / bridgeFlights.length) * 100).toFixed(1)})`);
console.log(`  • > 6 Saat (Körüğü Kilitleyen Çok Uzun Yatış): ${bridgeOver6h.length} (%${((bridgeOver6h.length / bridgeFlights.length) * 100).toFixed(1)})`);
console.log(`  • > 10 Saat (Gündüz/Gece Blokajı): ${bridgeOver10h.length} (%${((bridgeOver10h.length / bridgeFlights.length) * 100).toFixed(1)})`);

if (bridgeOver10h.length > 0) {
    console.log('\n⚠️ Körüğü > 10 saat kilitleyen ilk 5 uçak:');
    bridgeOver10h.slice(0, 5).forEach(f => {
        console.log(`  • Stand ${f.stand}: ${f.flightNo} (${(f.durationMin/60).toFixed(1)} saat | ${f.raw.STA} - ${f.raw.STD})`);
    });
}

// 5. ATANMAMIŞ UÇUŞLARIN TEŞHİSİ (UNASSIGNED FLIGHTS)
const unassignedFlights = flights.filter(f => f.stand === 'Atanmadı');
console.log(`\n5. ATANMAMIŞ (HAVUZDA KALAN) UÇUŞLAR (${unassignedFlights.length} Adet):`);
const unassignedByDay = {};
unassignedFlights.forEach(f => {
    const d = f.std || f.sta;
    const day = d ? d.toLocaleDateString('tr-TR') : 'Bilinmeyen';
    unassignedByDay[day] = (unassignedByDay[day] || 0) + 1;
});
console.log('Günlere göre atanmamış sayısı:', unassignedByDay);
if (unassignedFlights.length > 0) {
    console.log('Atanmamış uçuş örnekleri:');
    unassignedFlights.slice(0, 8).forEach(f => {
        console.log(`  • Satır ${f.row}: ${f.flightNo} | STA: ${f.raw.STA} | STD: ${f.raw.STD} | Süre: ${(f.durationMin/60).toFixed(1)} saat`);
    });
}

// 6. CONCOURSE DAĞILIM DENGESİ (PIER LOAD BALANCING)
console.log('\n6. KÖRÜK İSKELELERİ (CONCOURSE A-G) KULLANIM DENGESİ:');
const pierCounts = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
flights.forEach(f => {
    if (f.isBridge) {
        const p = f.stand[0].toUpperCase();
        if (pierCounts[p] !== undefined) pierCounts[p]++;
    }
});
Object.entries(pierCounts).forEach(([pier, count]) => {
    console.log(`  • Concourse ${pier}: ${count} uçuş`);
});

// 7. GATE EŞLEŞME UYUMU (GATE VS STAND ALIGNMENT)
let gateMatches = 0;
let gateMismatches = 0;
let gateUnassignedCount = 0;
flights.forEach(f => {
    if (f.gate === 'Atanmadı') {
        gateUnassignedCount++;
    } else if (f.stand !== 'Atanmadı') {
        const standPrefix = f.stand[0].toUpperCase();
        const gatePrefix = f.gate[0].toUpperCase();
        if (standPrefix === gatePrefix) {
            gateMatches++;
        } else {
            gateMismatches++;
        }
    }
});
console.log('\n7. GATE - STAND İSKELE UYUMU:');
console.log(`  • Gate Atanmış ve İskele Eşleşen (A-A, B-B vb.): ${gateMatches} (%${((gateMatches / (gateMatches + gateMismatches)) * 100).toFixed(1)})`);
console.log(`  • Gate Atanmış ama Farklı İskelede (Örn Stand A, Gate F): ${gateMismatches} (%${((gateMismatches / (gateMatches + gateMismatches)) * 100).toFixed(1)})`);
console.log(`  • Gate Atanmamış: ${gateUnassignedCount}`);
