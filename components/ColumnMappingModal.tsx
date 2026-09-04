import React, { useState, useEffect, useMemo } from 'react';

export type ImportMode = 'leg' | 'turnaround';

export type Mapping = {
    [key: string]: string | null | undefined;
    // Leg fields
    flightNumber?: string | null;
    date?: string | null;
    time?: string | null;
    flightMode?: string | null;
    // Turnaround fields
    arrivalFlightNumber?: string | null;
    departureFlightNumber?: string | null;
    arrivalDateTime?: string | null;
    departureDateTime?: string | null;
    arrivalMode?: string | null;
    departureMode?: string | null;
    // Common fields
    aircraftType?: string | null;
    regNo?: string | null;
    origin?: string | null;
    destination?: string | null;
    parkingPosition?: string | null;
    arrivalParkingPosition?: string | null;
    departureParkingPosition?: string | null;
    gate?: string | null;
    arrivalGate?: string | null;
    departureGate?: string | null;
    mtow?: string | null;
};

// For "Her Satır Tek Bir Uçuş Bacağı (Leg)"
const LEG_FIELDS = [
  { id: 'flightNumber', label: 'Uçuş Numarası', required: false, guesses: ['flight', 'uçuş no', 'flight no', 'fltnum', 'flightnumber'] },
  { id: 'date', label: 'Tarih (Opsiyonel)', required: false, guesses: ['tarih', 'date'] },
  { id: 'time', label: 'Saat', required: true, guesses: ['eta', 'etd', 'sta', 'std', 'saat', 'time', 'arrtime', 'deptime'] },
  { id: 'aircraftType', label: 'Uçak Tipi (AC)', required: false, guesses: ['a/c type', 'actype', 'ac', 'uçak tipi', 'aircraft type'] },
  { id: 'regNo', label: 'Tescil / Kuyruk Kodu (RegNo)', required: false, guesses: ['regno', 'reg no', 'reg', 'tescil', 'kuyruk no', 'tail', 'registration'] },
  { id: 'origin', label: 'Kalkış (Origin)', required: false, guesses: ['from statition', 'from station', 'from', 'origin', 'kalkış'] },
  { id: 'destination', label: 'Varış (Dest)', required: false, guesses: ['to station', 'dep to statition', 'dep to station', 'gh', 'dest', 'varış', 'to', 'destination'] },
  { id: 'flightMode', label: 'Uçuş Modu I/D (Opsiyonel)', required: false, guesses: ['i/d', 'mode', 'mod'] },
  { id: 'mtow', label: 'MTOW (Azami Kalkış Ağırlığı)', required: false, guesses: ['mtow', 'max weight', 'kalkış ağırlığı', 'weight'] },
  { id: 'parkingPosition', label: 'Park Pozisyonu (Opsiyonel)', required: false, guesses: ['arrstand', 'depstand', 'park', 'stand', 'pos', 'pozisyon', 'parking'] },
  { id: 'gate', label: 'Gate (Opsiyonel)', required: false, guesses: ['gate', 'arrgate', 'körük'] },
];

// For "Her Satır Bir Uçuş Görevi (Turnaround)"
const TURNAROUND_FIELDS = [
    { id: 'arrivalFlightNumber', label: 'Geliş Uçuş Numarası', required: false, guesses: ['arr flight', 'arrflight', 'arrnum', 'arrival flight', 'geliş no'] },
    { id: 'departureFlightNumber', label: 'Gidiş Uçuş Numarası', required: false, guesses: ['dep flight', 'depflight', 'depnum', 'departure flight', 'gidiş no'] },
    { id: 'arrivalDateTime', label: 'Geliş Tarihi ve Saati (ETA/STA)', required: false, guesses: ['eta', 'sta', 'arrival', 'arrtime', 'arrivaldatetime', 'geliş saati'] },
    { id: 'departureDateTime', label: 'Gidiş Tarihi ve Saati (ETD/STD)', required: false, guesses: ['etd', 'std', 'departure', 'deptime', 'departuredatetime', 'gidiş saati'] },
    { id: 'aircraftType', label: 'Uçak Tipi (AC)', required: false, guesses: ['a/c type', 'actype', 'ac', 'uçak tipi', 'aircraft type'] },
    { id: 'regNo', label: 'Tescil / Kuyruk Kodu (RegNo)', required: false, guesses: ['regno', 'reg no', 'reg', 'tescil', 'kuyruk no', 'tail', 'registration'] },
    { id: 'mtow', label: 'MTOW (Azami Kalkış Ağırlığı)', required: false, guesses: ['mtow', 'max weight', 'kalkış ağırlığı', 'weight'] },
    { id: 'origin', label: 'Geliş Havalimanı (Origin)', required: false, guesses: ['from statition', 'from station', 'from', 'origin', 'nereden'] },
    { id: 'destination', label: 'Gidiş Havalimanı (Destination)', required: false, guesses: ['to station', 'dep to statition', 'dep to station', 'gh', 'dest', 'nereye', 'to', 'destination'] },
    { id: 'arrivalMode', label: 'Geliş Modu I/D (Opsiyonel)', required: false, guesses: ['i/d', 'arr i/d', 'arr id', 'geliş mod'] },
    { id: 'departureMode', label: 'Gidiş Modu I/D (Opsiyonel)', required: false, guesses: ['i/d_1', 'dep i/d', 'dep id', 'gidiş mod', 'i/d'] },
    { id: 'arrivalParkingPosition', label: 'Geliş Park Pozisyonu (Arr Stand)', required: false, guesses: ['stand', 'arrstand', 'arr stand', 'arr park', 'geliş park'] },
    { id: 'departureParkingPosition', label: 'Gidiş Park Pozisyonu (Dep Stand)', required: false, guesses: ['depstand', 'dep stand', 'dep park', 'gidiş park'] },
    { id: 'arrivalGate', label: 'Geliş Gate (Arr Gate)', required: false, guesses: ['arr gate', 'arrgate', 'arrival gate'] },
    { id: 'departureGate', label: 'Gidiş Gate (Dep Gate)', required: false, guesses: ['gate', 'dep gate', 'depgate', 'closegate', 'departure gate'] },
];


interface ColumnMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  headers: string[];
  dataPreview: any[];
  onConfirm: (mapping: Mapping, importMode: ImportMode) => void;
}

const ColumnMappingModal: React.FC<ColumnMappingModalProps> = ({ isOpen, onClose, headers, dataPreview, onConfirm }) => {
  const [mapping, setMapping] = useState<Mapping>({});
  const [importMode, setImportMode] = useState<ImportMode>('turnaround');

  const currentFields = useMemo(() => importMode === 'turnaround' ? TURNAROUND_FIELDS : LEG_FIELDS, [importMode]);

  useEffect(() => {
    if (isOpen && headers.length > 0) {
      const initialMapping: Mapping = {};
      const lowerCaseHeaders = headers.map(h => String(h).toLowerCase().trim().replace(/[^a-z0-9/_]/gi, ''));

      currentFields.forEach(field => {
        initialMapping[field.id] = null;
        for (const guess of field.guesses) {
          const cleanGuess = guess.toLowerCase().trim().replace(/[^a-z0-9/_]/gi, '');
          // Priority 1: Exact string match
          let matchedHeader = headers.find((_header, index) => {
            return lowerCaseHeaders[index] === cleanGuess;
          });
          // Priority 2: Partial substring match
          if (!matchedHeader) {
            matchedHeader = headers.find((_header, index) => {
              return lowerCaseHeaders[index].includes(cleanGuess);
            });
          }
          if (matchedHeader) {
            initialMapping[field.id] = matchedHeader;
            break; // Highest priority guess matched!
          }
        }
      });
      setMapping(initialMapping);
    }
  }, [isOpen, headers, importMode, currentFields]);

  const handleMappingChange = (fieldId: string, selectedHeader: string) => {
    setMapping(prev => ({ ...prev, [fieldId]: selectedHeader === '' ? null : selectedHeader }));
  };

  const handleConfirm = () => {
    onConfirm(mapping, importMode);
    onClose();
  };
  
  const isConfirmDisabled = currentFields.some(field => field.required && !mapping[field.id]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[80] p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Excel Sütunlarını Eşleştir</h2>
          <p className="text-sm text-gray-400">Lütfen Excel dosyanızdaki sütunları programın beklediği alanlarla eşleştirin.</p>
        </header>

        <main className="p-6 flex-grow overflow-y-auto">
          <div className="bg-gray-700/50 p-3 rounded-lg mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">1. Adım: Dosya Yapısını Seçin</label>
            <div className="flex items-center space-x-6">
                <div className="flex items-center">
                    <input type="radio" id="mode-turnaround" name="importMode" value="turnaround" checked={importMode === 'turnaround'} onChange={() => setImportMode('turnaround')} className="h-4 w-4 text-purple-600 border-gray-500 focus:ring-purple-500"/>
                    <label htmlFor="mode-turnaround" className="ml-2 block text-sm text-gray-200">Her Satır Bir Uçuş Görevi (Geliş/Gidiş)</label>
                </div>
                <div className="flex items-center">
                    <input type="radio" id="mode-leg" name="importMode" value="leg" checked={importMode === 'leg'} onChange={() => setImportMode('leg')} className="h-4 w-4 text-purple-600 border-gray-500 focus:ring-purple-500"/>
                    <label htmlFor="mode-leg" className="ml-2 block text-sm text-gray-200">Her Satır Tek Bir Uçuş Bacağı</label>
                </div>
            </div>
          </div>

          <div>
             <label className="block text-sm font-medium text-gray-300 mb-2">2. Adım: Sütunları Eşleştirin</label>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                {currentFields.map(field => (
                <div key={field.id}>
                    <label htmlFor={`select-${field.id}`} className="block text-sm font-medium text-gray-300 mb-1">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    <select
                    id={`select-${field.id}`}
                    value={mapping[field.id] || ''}
                    onChange={(e) => handleMappingChange(field.id, e.target.value)}
                    className={`w-full p-2 bg-gray-700 border rounded-md text-white ${mapping[field.id] ? 'border-gray-600' : 'border-yellow-500'}`}
                    >
                    <option value="">-- Sütun Seçin --</option>
                    {headers.map(header => (
                        <option key={header} value={header}>{header}</option>
                    ))}
                    </select>
                </div>
                ))}
            </div>
          </div>
          
          <h3 className="text-lg font-semibold text-white mt-6 mb-2">Veri Önizlemesi</h3>
          <div className="overflow-x-auto border border-gray-700 rounded-lg">
            <table className="w-full text-sm text-left text-gray-300">
              <thead className="text-xs text-gray-400 uppercase bg-gray-700/50">
                <tr>
                  {headers.map(header => (
                    <th key={header} scope="col" className="px-4 py-2 truncate max-w-[150px]">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataPreview.map((row, rowIndex) => (
                  <tr key={rowIndex} className="bg-gray-800 border-b border-gray-700 hover:bg-gray-700/50">
                    {headers.map(header => (
                      <td key={`${rowIndex}-${header}`} className="px-4 py-2 truncate max-w-[150px]">
                        {row[header] instanceof Date ? row[header].toLocaleString('tr-TR') : String(row[header] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
        
        <footer className="p-4 bg-gray-900/50 border-t border-gray-700 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
          >
            İptal
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Onayla ve Yükle
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ColumnMappingModal;