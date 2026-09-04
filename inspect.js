const XLSX = require('xlsx');
const fs = require('fs');

const filePath = "C:\\Users\\gurka\\OneDrive\\Desktop\\IHK_ Report_Hourly_Flights (1).xlsx";
const workbook = XLSX.readFile(filePath, { cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rawData = XLSX.utils.sheet_to_json(sheet);

// Load CONCOURSE_LAYOUT from constants
const CONCOURSE_LAYOUT = {
    'Concourse A': ['A2L', 'A2', 'A2R', 'A3L', 'A3', 'A3R', 'A5L', 'A5', 'A5R', 'A6L', 'A6', 'A6R', 'A7L', 'A7', 'A7R', 'A8L', 'A8', 'A8R', 'A9', 'A10L', 'A10', 'A10R', 'A11L', 'A11', 'A11R'],
    'Concourse B': ['B1L','B1','B1R', 'B2', 'B3L','B3','B3R', 'B4', 'B5L','B5','B5R', 'B6L','B6','B6R', 'B7L','B7','B7R', 'B8L','B8','B8R', 'B9L','B9','B9R', 'B10L','B10','B10R', 'B12L','B12','B12R', 'B13', 'B14', 'B15', 'B16', 'B17', 'B18L','B18','B18R'],
    'Concourse C': ['C1', 'C2', 'C3', 'C4'],
    'Concourse D': ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17'],
    'Concourse E': ['E1', 'E2', 'E3', 'E4'],
    'Concourse F': ['F1L', 'F1', 'F1R', 'F2', 'F3L', 'F3', 'F3R', 'F4L', 'F4', 'F4R', 'F5L', 'F5', 'F5R', 'F6L', 'F6', 'F6R', 'F7L', 'F7', 'F7R', 'F8L', 'F8', 'F8R', 'F9L', 'F9', 'F9R', 'F12L', 'F12', 'F12R', 'F13L', 'F13', 'F13R', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19'],
    'Concourse G': ['G2L', 'G2', 'G2R', 'G4L', 'G4', 'G4R', 'G5L', 'G5', 'G5R', 'G6L', 'G6', 'G6R', 'G7L', 'G7', 'G7R', 'G8L', 'G8', 'G8R', 'G9L', 'G9', 'G9R', 'G10L', 'G10', 'G10R', 'G11L', 'G11', 'G11R'],
    'APRON 1': ['100', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113', '114', '115', '116', '117', '118', '119', '120', '121', '122', '123', '124', '125', '126', '127', '128', '129', '130', '131', '132', '133L', '133', '133R', '134L', '134', '134R', '135L', '135', '135R', '136L', '136', '136R', '137L', '137', '137R', '138L', '138', '138R', '139L', '139', '139R', '140L', '140', '140R', '141L', '141', '141R', '142L', '142', '142R', '143L', '143', '143R', '144L', '144', '144R', '145L', '145', '145R', '146L', '146', '146R', '147L', '147', '147R', '148L', '148', '148R', '149'],
    'APRON 2': ['200', '201', '202', '203', '204', '205', '206', '207', '208', '209', '210', '211', '212', '213', '214', '215L', '215', '215R', '216L', '216', '216R', '217L', '217', '217R', '219L', '219', '219R', '220L', '220', '220R', '221L', '221', '221R', '222L', '222', '222R', '223L', '223', '223R', '224L', '224', '224R', 'D19', 'D20'],
    'APRON 3': ['300', '301', '302', '303', '304', '305', '306', '307', '308', '309', '310', '311', '312', '313L', '313', '313R', '314L', '314', '314R', '315L', '315', '315R'],
    'VIP APRON': ['316L', '316', '316R', '317L', '317', '317R', '318L', '318', '318R', '319L', '319', '319R'],
    'CARGO APRON': ['K1L', 'K1', 'K1R', 'K2L', 'K2', 'K2R', 'K3L', 'K3', 'K3R', 'K4L', 'K4', 'K4R', 'K5L', 'K5', 'K5R', 'K6L', 'K6', 'K6R', 'K7L', 'K7', 'K7R', 'K8L', 'K8', 'K8R', 'K9L', 'K9', 'K9R', 'K10', 'K11', 'K12', 'K13', 'K14', 'K15', 'K16', 'K17', 'K18', 'K25', 'K26', 'K27', 'K50', 'K51', 'K52', 'K53', 'K54', 'K55', 'K56', 'K57'],
    'APRON 4': ['400', '401', '403', '404', '405L', '405', '405R', '406', '407', '408', '409'],
    'APRON 5': ['500', '501', '502', '503', '504', '505', '506', '507', '508', '509'],
    'APRON 6': ['601', '602', '603', '604'],
    'GHH CNG': ['CNGL', 'CNGC', 'CNGR'],
    'GHH KLY': ['KLYL', 'KLYC', 'KLYR'],
    'APRON 7': ['701', '702', '703', '704'],
    'LIMAK': ['LIMAK1', 'LIMAK2'],
    'MAPA': ['MAPA1', 'MAPA2'],
    'THY HANGAR1': ['THY1L', 'THY1', 'THY1R', 'THY2L', 'THY2', 'THY2R', 'THY3', 'THY4', 'THY5', 'THY6', 'THY7'],
    'THY HANGAR2': ['THY8L', 'THY8', 'THY8R', 'THY9'],
    'THY HANGAR3': ['THY10L', 'THY10', 'THY10R', 'THY11L', 'THY11', 'THY11R', 'THY12L', 'THY12', 'THY12R', 'THY13', 'THY14', 'THY15', 'THY16', 'THY17', 'THY18', 'THY19', 'THY20'],
    'DEICING 1 APRON': ['H11L', 'H11', 'H11R', 'H12L', 'H12', 'H12R'],
    'DEICING 2 APRON': ['H20L', 'H20', 'H20R', 'H21L', 'H21', 'H21R', 'H22L', 'H22', 'H22R', 'H23L', 'H23', 'H23R', 'H24L', 'H24', 'H24R', 'H25L', 'H25', 'H25R'],
    'DEICING 3 APRON': ['H30L', 'H30', 'H30R', 'H31L', 'H31', 'H31R', 'H32L', 'H32', 'H32R', 'H33L', 'H33', 'H33R', 'H35L', 'H35', 'H35R', 'H36L', 'H36', 'H36R'],
    'DEICING 4 APRON': ['H40L', 'H40', 'H40R', 'H41L', 'H41', 'H41R', 'H42L', 'H42', 'H42R', 'H43L', 'H43', 'H43R', 'H44L', 'H44', 'H44R', 'H45L', 'H45', 'H45R', 'H46L', 'H46', 'H46R'],
    'DEICING 5 APRON': ['H50L', 'H50', 'H50R', 'H51', 'SA1'],
    'V Apronu': ['DKE', 'V3L', 'V3', 'V3R', 'V4L', 'V4', 'V4R'],
    'MOTOR TEST AREA': ['H13', 'H14', 'H15'],
    'CCPAD': ['CCP'],
    'HELIKOPTER': ['H'],
};

const PARKING_POSITIONS = Object.values(CONCOURSE_LAYOUT).flat();
const SORTED_PARKING_POSITIONS = [...PARKING_POSITIONS].sort((a, b) => b.length - a.length);

const extractValidParkingPosition = (rawPosition) => {
    if (rawPosition === null || rawPosition === undefined || rawPosition === '') return null;
    const rawStr = String(rawPosition).toUpperCase().trim();
    if (!rawStr || rawStr === 'NULL' || rawStr === 'NONE' || rawStr === '-' || rawStr === 'BUS') return null;

    const cleanPos = rawStr.replace(/[^A-Z0-9]/g, '');
    if (PARKING_POSITIONS.includes(cleanPos)) {
        return cleanPos;
    }

    const unpaddedPos = cleanPos.replace(/^([A-Z]+)0+(\d+)/, '$1$2').replace(/^0+(\d+)/, '$1');
    if (PARKING_POSITIONS.includes(unpaddedPos)) {
        return unpaddedPos;
    }

    for (const validPos of SORTED_PARKING_POSITIONS) {
        if (cleanPos === validPos || cleanPos.startsWith(validPos) || cleanPos.endsWith(validPos)) {
            return validPos;
        }
    }
    return null;
};

const standCountsByConcourse = {};
let unassignedCount = 0;
const unassignedSamples = [];

rawData.forEach((row, i) => {
    const rawArrStand = row['ArrStand'];
    const rawDepStand = row['Dep Stand'] || row['DepStand'];

    const arrPos = extractValidParkingPosition(rawArrStand);
    const depPos = extractValidParkingPosition(rawDepStand);
    const pos = arrPos || depPos;

    if (pos) {
        let foundConcourse = null;
        for (const [cName, pList] of Object.entries(CONCOURSE_LAYOUT)) {
            if (pList.includes(pos)) {
                foundConcourse = cName;
                break;
            }
        }
        if (foundConcourse) {
            standCountsByConcourse[foundConcourse] = (standCountsByConcourse[foundConcourse] || 0) + 1;
        }
    } else {
        unassignedCount++;
        if (unassignedSamples.length < 5) {
            unassignedSamples.push({ rowIndex: i + 2, rawArrStand, rawDepStand, arrFlight: row['Arr Flight'], depFlight: row['Dep Flight'] });
        }
    }
});

console.log('--- CONCOURSE FLIGHT COUNTS ---');
console.table(standCountsByConcourse);

console.log('\n--- UNASSIGNED FLIGHTS ---');
console.log('Total Unassigned Rows:', unassignedCount);
console.log('Sample Unassigned Rows:', unassignedSamples);
