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

function getStandGroup(stand) {
    if (!stand || stand === 'Atanmadı') return 'ATANMADI';
    const s = stand.toUpperCase().trim();
    if (s.startsWith('D19') || s.startsWith('D20')) return 'APRON 2 (Remote D)';
    const firstChar = s[0];
    if (['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(firstChar)) return `KÖPRÜ (Pier ${firstChar})`;
    if (s.startsWith('K')) return 'KARGO (K)';
    if (s.startsWith('T')) return 'TEKNİK / HANGAR';
    if (s.startsWith('1')) return 'APRON 1 (100s)';
    if (s.startsWith('2')) return 'APRON 2 (200s)';
    if (s.startsWith('3')) return 'APRON 3 (300s)';
    if (s.startsWith('4')) return 'APRON 4 (400s)';
    if (s.startsWith('6')) return 'APRON 6 (600s)';
    if (s.startsWith('7')) return 'APRON 7 (700s)';
    return `DİĞER (${stand})`;
}

// Filter flights that operate on 19 October 2026:
// Either STD is on 19 Oct, or STA is on 19 Oct, or flight spans across 19 Oct!
const oct19Start = new Date(2026, 9, 19, 0, 0, 0); // Month is 9 (0-indexed October)
const oct19End = new Date(2026, 9, 19, 23, 59, 59, 999);

const allFlights = rawRows.map((r, i) => {
    const sta = parseDate(r.STA);
    const std = parseDate(r.STD);
    const stand = (r.Stand || 'Atanmadı').trim();
    const gate = (r.Gate || 'Atanmadı').trim();
    const arrFlight = (r['Arrival Flight No'] || '').trim();
    const depFlight = (r['Departure Flight No'] || '').trim();
    const flightNo = arrFlight || depFlight || `ROW-${i+1}`;
    const durationMin = (sta && std) ? (std.getTime() - sta.getTime()) / (1000 * 60) : 0;

    const isOnOct19Departure = std && std >= oct19Start && std <= oct19End;
    const isOnOct19Arrival = sta && sta >= oct19Start && sta <= oct19End;
    const isSpanningOct19 = sta && std && sta < oct19Start && std > oct19End;
    const isOct19Flight = isOnOct19Departure || isOnOct19Arrival || isSpanningOct19;

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
        group: getStandGroup(stand),
        durationMin,
        isOnOct19Departure,
        isOnOct19Arrival,
        isOct19Flight,
        raw: r
    };
});

const oct19Flights = allFlights.filter(f => f.isOct19Flight);
const oct19DepFlights = allFlights.filter(f => f.isOnOct19Departure);

console.log('========================================================');
console.log('🛫 19 EKİM 2026 AI PLANLAMA DERİNLEMESİNE ANALİZİ');
console.log('========================================================');
console.log(`19 Ekim İle İlgili Toplam Uçuş Sayısı: ${oct19Flights.length}`);
console.log(`19 Ekim Günü Kalkışı Olan (STD) Uçuş Sayısı: ${oct19DepFlights.length}`);

// 1. Standa Atama ve Köprü Oranları
const unassigned = oct19Flights.filter(f => f.stand === 'Atanmadı');
const assigned = oct19Flights.filter(f => f.stand !== 'Atanmadı');
const bridge = oct19Flights.filter(f => f.isBridge);
const remote = oct19Flights.filter(f => f.stand !== 'Atanmadı' && !f.isBridge);

console.log('\n--- 1. STAND YERLEŞİM BAŞARISI ---');
console.log(`• Standa Atanan: ${assigned.length} (%${((assigned.length / oct19Flights.length) * 100).toFixed(1)})`);
console.log(`• Atanmamış (Havuzda): ${unassigned.length} (%${((unassigned.length / oct19Flights.length) * 100).toFixed(1)})`);
console.log(`• Körükteki Uçuş: ${bridge.length} (%${((bridge.length / assigned.length) * 100).toFixed(1)})`);
console.log(`• Açık / Remote Uçuş: ${remote.length} (%${((remote.length / assigned.length) * 100).toFixed(1)})`);

// ATD (Kalkış Bazlı) Köprü Kullanım Oranı (GAMS Metriği)
const depBridge = oct19DepFlights.filter(f => f.isBridge).length;
const depRemote = oct19DepFlights.filter(f => f.stand !== 'Atanmadı' && !f.isBridge).length;
const depUnassigned = oct19DepFlights.filter(f => f.stand === 'Atanmadı').length;
const depRate = ((depBridge / (depBridge + depRemote + depUnassigned)) * 100).toFixed(1);
const depAssignedRate = ((depBridge / (depBridge + depRemote)) * 100).toFixed(1);

console.log('\n--- 2. RESMİ ATD (KALKIŞ BAZLI) KÖPRÜ KULLANIM ORANI ---');
console.log(`• 19 Ekim Kalkışlı Toplam: ${oct19DepFlights.length}`);
console.log(`• Körükten Kalkan: ${depBridge}`);
console.log(`• Açıktan Kalkan: ${depRemote}`);
console.log(`• Havuzda Kalan: ${depUnassigned}`);
console.log(`🌟 19 EKİM KÖPRÜ KULLANIM ORANI: %${depRate} (Atananlar içinde: %${depAssignedRate})`);

// 3. Çakışma Denetimi (Overlaps on Oct 19)
const flightsByStand = {};
oct19Flights.forEach(f => {
    if (f.stand === 'Atanmadı') return;
    if (!flightsByStand[f.stand]) flightsByStand[f.stand] = [];
    flightsByStand[f.stand].push(f);
});

let directOverlaps = [];
let tightBuffers = [];
Object.entries(flightsByStand).forEach(([stand, fList]) => {
    fList.sort((a, b) => (a.sta ? a.sta.getTime() : 0) - (b.sta ? b.sta.getTime() : 0));
    for (let i = 0; i < fList.length; i++) {
        for (let j = i + 1; j < fList.length; j++) {
            const f1 = fList[i];
            const f2 = fList[j];
            if (!f1.sta || !f1.std || !f2.sta || !f2.std) continue;
            if (f1.sta < f2.std && f1.std > f2.sta) {
                directOverlaps.push({ stand, f1, f2 });
            } else {
                const bufferMin = (f2.sta.getTime() - f1.std.getTime()) / (1000 * 60);
                if (bufferMin >= 0 && bufferMin < 15) {
                    tightBuffers.push({ stand, f1, f2, bufferMin });
                }
            }
        }
    }
});

console.log('\n--- 3. 19 EKİM GÜVENLİK & KURAL ÇAKIŞMA DENETİMİ ---');
console.log(`• Doğrudan Zaman Çakışması (Overlap): ${directOverlaps.length}`);
if (directOverlaps.length > 0) {
    directOverlaps.forEach(o => {
        console.log(`  🚨 ÇAKIŞMA: Stand ${o.stand} | ${o.f1.flightNo} (${o.f1.raw.STA}-${o.f1.raw.STD}) <-> ${o.f2.flightNo} (${o.f2.raw.STA}-${o.f2.raw.STD})`);
    });
} else {
    console.log('  ✅ SIFIR HATA: 19 Ekim AI yerleşiminde hiçbir doğrudan stant çakışması YOKTUR!');
}
console.log(`• Dar Tamponlu Geçiş (<15 dk buffer): ${tightBuffers.length} adet`);

// 4. Havuzda Kalan 3 Uçuşun İncelemesi
console.log(`\n--- 4. HAVUZDA KALAN (ATANMAMIŞ) UÇUŞLAR (${unassigned.length} Adet) ---`);
unassigned.forEach(u => {
    console.log(`• Satır ${u.row}: ${u.flightNo} | STA: ${u.raw.STA} | STD: ${u.raw.STD} | Süre: ${(u.durationMin/60).toFixed(1)} saat | Gidiş: ${u.depFlight} | Geliş: ${u.arrFlight}`);
});

// 5. İskele (Concourse) Dağılımı
console.log('\n--- 5. İSKELE DAĞILIMI (PIER LOAD BALANCING) ---');
const groupCounts = {};
oct19Flights.forEach(f => {
    groupCounts[f.group] = (groupCounts[f.group] || 0) + 1;
});
Object.entries(groupCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([grp, count]) => {
        console.log(`• ${grp}: ${count} uçuş (%${((count / oct19Flights.length) * 100).toFixed(1)})`);
    });

// 6. Açık Pozisyondaki Uçuşların Analizi (Kimler açıkta?)
console.log('\n--- 6. AÇIK POZİSYONDAKİ (REMOTE) 112 UÇUŞUN ANALİZİ ---');
const remoteKargo = remote.filter(f => f.stand.startsWith('K'));
const remoteApron = remote.filter(f => !f.stand.startsWith('K'));
console.log(`• Kargo Stantlarındaki Uçuşlar (K): ${remoteKargo.length} (Kargoların açıkta olması %100 doğrudur)`);
console.log(`• Yolcu Apronlarındaki Uçuşlar (Apron 1/2/3/4): ${remoteApron.length}`);

const remoteApronShort = remoteApron.filter(f => f.durationMin <= 90);
const remoteApronMedium = remoteApron.filter(f => f.durationMin > 90 && f.durationMin <= 180);
const remoteApronLong = remoteApron.filter(f => f.durationMin > 180);

console.log(`  - 0 - 90 dk (Hızlı Dönüşlü Yolcu Uçağı Açıkta): ${remoteApronShort.length} adet`);
console.log(`  - 90 - 180 dk (Normal Yolcu Uçağı Açıkta): ${remoteApronMedium.length} adet`);
console.log(`  - > 180 dk (Uzun Kalışlı Uçak Açıkta): ${remoteApronLong.length} adet`);

if (remoteApronShort.length > 0) {
    console.log('\n⚠️ Körüğe Çekilebilecek Hızlı Dönüşlü Açık Uçuş Örnekleri (Körük Fırsatı):');
    remoteApronShort.slice(0, 8).forEach(f => {
        console.log(`  • Stand ${f.stand}: ${f.flightNo} (${(f.durationMin).toFixed(0)} dk | ${f.raw.STA} - ${f.raw.STD})`);
    });
}

// 7. Körükte Uzun Yatanlar (19 Ekim)
console.log('\n--- 7. KÖRÜKTE YATIŞ SÜRESİ DAĞILIMI (19 EKİM) ---');
const bridgeOct19 = bridge.filter(f => f.durationMin > 0);
console.log(`• 0 - 2 Saat (İdeal Turnaround): ${bridgeOct19.filter(f => f.durationMin <= 120).length} (%${((bridgeOct19.filter(f => f.durationMin <= 120).length / bridgeOct19.length) * 100).toFixed(1)})`);
console.log(`• 2 - 4 Saat: ${bridgeOct19.filter(f => f.durationMin > 120 && f.durationMin <= 240).length} (%${((bridgeOct19.filter(f => f.durationMin > 120 && f.durationMin <= 240).length / bridgeOct19.length) * 100).toFixed(1)})`);
console.log(`• 4 - 6 Saat: ${bridgeOct19.filter(f => f.durationMin > 240 && f.durationMin <= 360).length} (%${((bridgeOct19.filter(f => f.durationMin > 240 && f.durationMin <= 360).length / bridgeOct19.length) * 100).toFixed(1)})`);
console.log(`• > 6 Saat (Uzun Yatış): ${bridgeOct19.filter(f => f.durationMin > 360).length} (%${((bridgeOct19.filter(f => f.durationMin > 360).length / bridgeOct19.length) * 100).toFixed(1)})`);

// 8. Gate Durumu (19 Ekim)
const gateUnassignedOct19 = oct19Flights.filter(f => f.gate === 'Atanmadı').length;
const gateAssignedOct19 = oct19Flights.length - gateUnassignedOct19;
let gateMatches = 0;
let gateMismatches = 0;
oct19Flights.forEach(f => {
    if (f.gate !== 'Atanmadı' && f.stand !== 'Atanmadı') {
        if (f.stand[0].toUpperCase() === f.gate[0].toUpperCase()) gateMatches++;
        else gateMismatches++;
    }
});
console.log('\n--- 8. GATE EŞLEŞME DURUMU (19 EKİM) ---');
console.log(`• Gate Atanan: ${gateAssignedOct19} | Gate Atanmamış: ${gateUnassignedOct19}`);
console.log(`• İskele Harfi Eşleşen: ${gateMatches} (%${((gateMatches / (gateMatches + gateMismatches)) * 100).toFixed(1)})`);
console.log(`• İskele Harfi Farklı: ${gateMismatches} (%${((gateMismatches / (gateMatches + gateMismatches)) * 100).toFixed(1)})`);
