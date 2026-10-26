import React, { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { MaintenanceBlock } from '../types.ts';

interface ParsedMaintenanceCandidate {
    tempId: string;
    parkingPosition: string;
    startTime: Date;
    endTime: Date;
    reason: string;
    dateKey: string; // YYYY-MM-DD
    dateDisplay: string;
    isDuplicateInFile: boolean;
    isAlreadyInSystem: boolean;
}

interface MaintenanceImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    existingBlocks: MaintenanceBlock[];
    onImport: (newBlocks: MaintenanceBlock[]) => void;
}

// Flexible helper to parse dates and times from Excel (string or serial)
function parseExcelDateTime(dateVal: any, timeVal: any): Date | null {
    if (dateVal === undefined || dateVal === null || dateVal === '') return null;

    let year = 0;
    let month = 0; // 0-indexed
    let day = 0;

    if (dateVal instanceof Date) {
        year = dateVal.getFullYear();
        month = dateVal.getMonth();
        day = dateVal.getDate();
    } else if (typeof dateVal === 'number') {
        const d = XLSX.SSF.parse_date_code(dateVal);
        if (d) {
            year = d.y;
            month = d.m - 1;
            day = d.d;
        }
    } else {
        const s = String(dateVal).trim();
        // Check for YYYY-MM-DD
        if (s.includes('-')) {
            const parts = s.split(' ')[0].split('-');
            if (parts.length === 3) {
                if (parts[0].length === 4) {
                    year = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    day = parseInt(parts[2], 10);
                } else {
                    day = parseInt(parts[0], 10);
                    month = parseInt(parts[1], 10) - 1;
                    year = parseInt(parts[2], 10);
                }
            }
        } else if (s.includes('.')) {
            // DD.MM.YYYY
            const parts = s.split(' ')[0].split('.');
            if (parts.length === 3) {
                day = parseInt(parts[0], 10);
                month = parseInt(parts[1], 10) - 1;
                year = parseInt(parts[2], 10);
            }
        } else if (s.includes('/')) {
            // M/D/YYYY or D/M/YYYY
            const parts = s.split(' ')[0].split('/');
            if (parts.length === 3) {
                const p0 = parseInt(parts[0], 10);
                const p1 = parseInt(parts[1], 10);
                let p2 = parseInt(parts[2], 10);
                if (p2 < 100) p2 += 2000;
                year = p2;

                if (p0 > 12) {
                    day = p0;
                    month = p1 - 1;
                } else {
                    month = p0 - 1;
                    day = p1;
                }
            }
        }
    }

    if (!year || month === undefined || !day || isNaN(year) || isNaN(month) || isNaN(day)) {
        return null;
    }

    let hour = 0;
    let minute = 0;
    let second = 0;

    if (timeVal !== undefined && timeVal !== null && timeVal !== '') {
        if (typeof timeVal === 'number') {
            const t = XLSX.SSF.parse_date_code(timeVal);
            if (t) {
                hour = t.H || 0;
                minute = t.M || 0;
                second = t.S || 0;
            }
        } else {
            const tStr = String(timeVal).trim();
            const parts = tStr.split(':');
            if (parts.length >= 2) {
                hour = parseInt(parts[0], 10) || 0;
                minute = parseInt(parts[1], 10) || 0;
                second = parts[2] ? (parseInt(parts[2], 10) || 0) : 0;
            }
        }
    }

    const res = new Date(year, month, day, hour, minute, second);
    return isNaN(res.getTime()) ? null : res;
}

const formatDateKey = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const formatDateDisplay = (d: Date): string => {
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const MaintenanceImportModal: React.FC<MaintenanceImportModalProps> = ({
    isOpen,
    onClose,
    existingBlocks,
    onImport
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [fileName, setFileName] = useState<string>('');
    const [isParsing, setIsParsing] = useState<boolean>(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [allParsedCandidates, setAllParsedCandidates] = useState<ParsedMaintenanceCandidate[]>([]);
    const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
    const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
    const [searchCategory, setSearchCategory] = useState<string>('');

    // Reset when modal closes
    const handleClose = () => {
        setFileName('');
        setIsParsing(false);
        setErrorMessage(null);
        setAllParsedCandidates([]);
        setSelectedDates(new Set());
        setSelectedCategories(new Set());
        setSearchCategory('');
        onClose();
    };

    if (!isOpen) return null;

    // Build deduplication key for existing blocks
    const existingKeys = new Set(
        existingBlocks.map(b =>
            `${b.parkingPosition.trim().toUpperCase()}|${new Date(b.startTime).getTime()}|${new Date(b.endTime).getTime()}|${b.reason.trim().toUpperCase()}`
        )
    );

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        processFile(file);
    };

    const processFile = (file: File) => {
        setFileName(file.name);
        setIsParsing(true);
        setErrorMessage(null);

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });

                if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                    throw new Error("Excel dosyasında sayfa bulunamadı.");
                }

                // Look for Sheet2 first, or search for a sheet containing 'stand' header
                let targetSheet = workbook.Sheets['Sheet2'];
                if (!targetSheet) {
                    for (const sName of workbook.SheetNames) {
                        const ws = workbook.Sheets[sName];
                        const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
                        for (let r = 0; r < Math.min(10, rows.length); r++) {
                            const rowStr = JSON.stringify(rows[r] || '').toLowerCase();
                            if (rowStr.includes('stand') && (rowStr.includes('reason') || rowStr.includes('start'))) {
                                targetSheet = ws;
                                break;
                            }
                        }
                        if (targetSheet) break;
                    }
                }
                if (!targetSheet) {
                    targetSheet = workbook.Sheets[workbook.SheetNames[0]];
                }

                const rawRows = XLSX.utils.sheet_to_json<any[]>(targetSheet, { header: 1 });
                if (!rawRows || rawRows.length < 2) {
                    throw new Error("Seçilen sayfada veri bulunamadı.");
                }

                // Detect header row index and column positions
                let headerRowIndex = -1;
                let colStand = -1;
                let colReason = -1;
                let colStartDate = -1;
                let colStartTime = -1;
                let colEndDate = -1;
                let colEndTime = -1;

                for (let r = 0; r < Math.min(15, rawRows.length); r++) {
                    const row = rawRows[r];
                    if (!row || !Array.isArray(row)) continue;

                    for (let c = 0; c < row.length; c++) {
                        const val = String(row[c] || '').trim().toLowerCase();
                        if (colStand === -1 && (val === 'stand name' || val === 'stand' || val === 'park' || val === 'park pozisyonu')) {
                            colStand = c;
                        }
                        if (colReason === -1 && (val === 'reason' || val === 'kategori' || val === 'sebep' || val === 'bakım' || val === 'downgrade')) {
                            colReason = c;
                        }
                        if (colStartDate === -1 && (val === 'start_date' || val === 'start date' || val === 'başlangıç tarihi' || val === 'baslangic tarihi')) {
                            colStartDate = c;
                        }
                        if (colStartTime === -1 && (val === 'start_time' || val === 'start time' || val === 'başlangıç saati' || val === 'baslangic saati')) {
                            colStartTime = c;
                        }
                        if (colEndDate === -1 && (val === 'end_date' || val === 'end date' || val === 'bitiş tarihi' || val === 'bitis tarihi')) {
                            colEndDate = c;
                        }
                        if (colEndTime === -1 && (val === 'end_time' || val === 'end time' || val === 'bitiş saati' || val === 'bitis saati')) {
                            colEndTime = c;
                        }
                    }

                    if (colStand !== -1 && (colStartDate !== -1 || colReason !== -1)) {
                        headerRowIndex = r;
                        break;
                    }
                }

                // Fallback column positions if standard Sheet2 layout
                if (headerRowIndex === -1) {
                    headerRowIndex = 1;
                    colStand = 0;
                    colReason = 2;
                    colStartDate = 3;
                    colStartTime = 4;
                    colEndDate = 5;
                    colEndTime = 6;
                }

                const candidates: ParsedMaintenanceCandidate[] = [];
                const seenFileKeys = new Set<string>();
                const dateSet = new Set<string>();
                const categorySet = new Set<string>();

                for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
                    const row = rawRows[i];
                    if (!row || row.length === 0) continue;

                    const rawStand = String(row[colStand] ?? '').trim().toUpperCase();
                    if (!rawStand || rawStand === 'NONE' || rawStand === 'STAND NAME' || rawStand === 'NULL') continue;

                    let rawReason = colReason !== -1 ? String(row[colReason] ?? '').trim() : 'Bakım';
                    if (!rawReason || rawReason.startsWith('---') || rawReason.startsWith('___')) continue;

                    const rawStartDate = colStartDate !== -1 ? row[colStartDate] : null;
                    const rawStartTime = colStartTime !== -1 ? row[colStartTime] : null;
                    const rawEndDate = colEndDate !== -1 ? row[colEndDate] : null;
                    const rawEndTime = colEndTime !== -1 ? row[colEndTime] : null;

                    const startDate = parseExcelDateTime(rawStartDate, rawStartTime);
                    const endDate = parseExcelDateTime(rawEndDate || rawStartDate, rawEndTime);

                    if (!startDate || !endDate || startDate >= endDate) continue;

                    const dedupeKey = `${rawStand}|${startDate.getTime()}|${endDate.getTime()}|${rawReason.toUpperCase()}`;
                    const isDupInFile = seenFileKeys.has(dedupeKey);
                    seenFileKeys.add(dedupeKey);

                    const isAlreadyInSys = existingKeys.has(dedupeKey);

                    const dateKey = formatDateKey(startDate);
                    const dateDisplay = formatDateDisplay(startDate);

                    if (!isDupInFile) {
                        dateSet.add(dateKey);
                        categorySet.add(rawReason);
                    }

                    candidates.push({
                        tempId: `cand-${i}-${Math.random().toString(36).substr(2, 5)}`,
                        parkingPosition: rawStand,
                        startTime: startDate,
                        endTime: endDate,
                        reason: rawReason,
                        dateKey,
                        dateDisplay,
                        isDuplicateInFile: isDupInFile,
                        isAlreadyInSystem: isAlreadyInSys
                    });
                }

                if (candidates.length === 0) {
                    throw new Error("Dosyada geçerli park pozisyonu ve bakım tarih/saat verisi bulunamadı.");
                }

                setAllParsedCandidates(candidates);
                // By default, select all detected dates and categories
                setSelectedDates(new Set(dateSet));
                setSelectedCategories(new Set(categorySet));
                setIsParsing(false);
            } catch (err: any) {
                console.error("Excel import hatası:", err);
                setErrorMessage(err.message || "Excel dosyası okunurken hata oluştu.");
                setIsParsing(false);
            }
        };

        reader.readAsArrayBuffer(file);
    };

    // Calculate unique dates with counts
    const dateOptions = useMemo(() => {
        const counts: Record<string, { display: string; count: number; dateObj: Date }> = {};
        allParsedCandidates.forEach(c => {
            if (c.isDuplicateInFile) return;
            if (!counts[c.dateKey]) {
                counts[c.dateKey] = {
                    display: c.dateDisplay,
                    count: 0,
                    dateObj: c.startTime
                };
            }
            counts[c.dateKey].count++;
        });

        return Object.entries(counts)
            .map(([key, data]) => ({
                key,
                display: data.display,
                count: data.count,
                dateObj: data.dateObj
            }))
            .sort((a, b) => a.key.localeCompare(b.key));
    }, [allParsedCandidates]);

    // Calculate unique categories with counts
    const categoryOptions = useMemo(() => {
        const counts: Record<string, number> = {};
        allParsedCandidates.forEach(c => {
            if (c.isDuplicateInFile) return;
            counts[c.reason] = (counts[c.reason] || 0) + 1;
        });

        return Object.entries(counts)
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count);
    }, [allParsedCandidates]);

    // Filter categories by search
    const filteredCategoryOptions = useMemo(() => {
        if (!searchCategory.trim()) return categoryOptions;
        const q = searchCategory.toLowerCase();
        return categoryOptions.filter(c => c.category.toLowerCase().includes(q));
    }, [categoryOptions, searchCategory]);

    // Filtered candidates ready to be imported
    const importableCandidates = useMemo(() => {
        return allParsedCandidates.filter(c =>
            !c.isDuplicateInFile &&
            !c.isAlreadyInSystem &&
            selectedDates.has(c.dateKey) &&
            selectedCategories.has(c.reason)
        );
    }, [allParsedCandidates, selectedDates, selectedCategories]);

    const duplicateCount = useMemo(() => {
        return allParsedCandidates.filter(c => c.isDuplicateInFile).length;
    }, [allParsedCandidates]);

    const alreadyInSystemCount = useMemo(() => {
        return allParsedCandidates.filter(c => !c.isDuplicateInFile && c.isAlreadyInSystem).length;
    }, [allParsedCandidates]);

    // Date toggles
    const handleSelectAllDates = () => {
        setSelectedDates(new Set(dateOptions.map(d => d.key)));
    };
    const handleDeselectAllDates = () => {
        setSelectedDates(new Set());
    };
    const toggleDate = (key: string) => {
        setSelectedDates(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    // Category toggles
    const handleSelectAllCategories = () => {
        setSelectedCategories(new Set(categoryOptions.map(c => c.category)));
    };
    const handleDeselectAllCategories = () => {
        setSelectedCategories(new Set());
    };
    const toggleCategory = (cat: string) => {
        setSelectedCategories(prev => {
            const next = new Set(prev);
            if (next.has(cat)) next.delete(cat);
            else next.add(cat);
            return next;
        });
    };

    // Confirm Import
    const handleConfirmImport = () => {
        if (importableCandidates.length === 0) {
            alert("Seçilen filtrelere uyan yüklenecek bakım kaydı bulunmuyor.");
            return;
        }

        const newMaintenanceBlocks: MaintenanceBlock[] = importableCandidates.map(c => ({
            id: `maint-${Date.now()}-${Math.random().toString(36).substr(2, 7)}`,
            parkingPosition: c.parkingPosition,
            startTime: c.startTime,
            endTime: c.endTime,
            reason: c.reason
        }));

        onImport(newMaintenanceBlocks);
        handleClose();
    };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[80] p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-white">

                {/* Header */}
                <header className="p-4 bg-gray-900 border-b border-gray-700 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <span className="text-2xl">📥</span>
                        <div>
                            <h2 className="text-lg font-bold text-white">Excel'den Bakım / Downgrade İçe Aktar</h2>
                            <p className="text-xs text-gray-400">
                                IST Ekipman Durum Dosyası (Equipment Status) formatındaki bakımları filtreleyerek yükleyin
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-white text-2xl font-bold transition"
                    >
                        &times;
                    </button>
                </header>

                {/* Body */}
                <main className="p-6 flex-grow overflow-y-auto space-y-6">

                    {/* Step 1: File Upload Box */}
                    <div className="bg-gray-900/60 border-2 border-dashed border-gray-600 hover:border-indigo-500 rounded-xl p-5 text-center transition">
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".xlsx, .xls"
                            className="hidden"
                            id="maintenance-excel-file-input"
                        />
                        <label
                            htmlFor="maintenance-excel-file-input"
                            className="cursor-pointer flex flex-col items-center justify-center gap-2"
                        >
                            <span className="text-3xl text-indigo-400">📊</span>
                            <span className="text-sm font-semibold text-gray-200">
                                {fileName ? `Seçilen Dosya: ${fileName}` : "Bakım Excel Dosyasını (.xlsx) Seçin veya Buraya Sürükleyin"}
                            </span>
                            <span className="text-xs text-gray-400">
                                {fileName ? "Farklı bir dosya yüklemek için tıklayın" : "Equipment Status_v2, Downgrades listesi vb."}
                            </span>
                        </label>
                    </div>

                    {isParsing && (
                        <div className="flex items-center justify-center gap-3 py-8 text-indigo-400">
                            <svg className="animate-spin h-6 w-6 text-indigo-400" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                            </svg>
                            <span className="font-semibold text-sm">Excel dosyası analiz ediliyor ve mükerrer kayıtlar filtreleniyor...</span>
                        </div>
                    )}

                    {errorMessage && (
                        <div className="bg-rose-900/40 border border-rose-500/60 rounded-lg p-4 text-rose-200 text-sm">
                            ⚠️ <strong>Hata:</strong> {errorMessage}
                        </div>
                    )}

                    {/* Step 2: Interactive Filtering (Tarih ve Kategori Seçimi) */}
                    {allParsedCandidates.length > 0 && !isParsing && (
                        <div className="space-y-6">

                            {/* Summary Bar */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-gray-900/80 p-4 rounded-xl border border-gray-700">
                                <div className="text-center p-2 rounded-lg bg-gray-800">
                                    <div className="text-xs text-gray-400">Dosyadaki Toplam Kayıt</div>
                                    <div className="text-lg font-bold text-gray-100">{allParsedCandidates.length}</div>
                                </div>
                                <div className="text-center p-2 rounded-lg bg-gray-800">
                                    <div className="text-xs text-amber-400">Mükerrer (Elenen)</div>
                                    <div className="text-lg font-bold text-amber-400">-{duplicateCount}</div>
                                </div>
                                <div className="text-center p-2 rounded-lg bg-gray-800">
                                    <div className="text-xs text-cyan-400">Sistemde Mevcut</div>
                                    <div className="text-lg font-bold text-cyan-400">{alreadyInSystemCount}</div>
                                </div>
                                <div className="text-center p-2 rounded-lg bg-indigo-950/60 border border-indigo-500/50">
                                    <div className="text-xs text-indigo-300 font-medium">Yüklenecek Kayıt</div>
                                    <div className="text-lg font-bold text-emerald-400">
                                        {importableCandidates.length}
                                    </div>
                                </div>
                            </div>

                            {/* Date & Category Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                                {/* Section 1: Tarih Seçimi */}
                                <div className="bg-gray-900/70 border border-gray-700 rounded-xl p-4 flex flex-col">
                                    <div className="flex justify-between items-center mb-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-indigo-400 font-bold">📅</span>
                                            <h3 className="font-bold text-sm text-white">
                                                Tarih Seçimi ({selectedDates.size}/{dateOptions.length})
                                            </h3>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handleSelectAllDates}
                                                className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium"
                                            >
                                                Tümünü Seç
                                            </button>
                                            <span className="text-gray-600">|</span>
                                            <button
                                                type="button"
                                                onClick={handleDeselectAllDates}
                                                className="text-xs text-gray-400 hover:text-gray-300 underline font-medium"
                                            >
                                                Temizle
                                            </button>
                                        </div>
                                    </div>

                                    <div className="max-h-60 overflow-y-auto pr-2 space-y-1.5 border border-gray-700/60 rounded-lg p-2 bg-gray-800/50">
                                        {dateOptions.map(d => {
                                            const isChecked = selectedDates.has(d.key);
                                            return (
                                                <label
                                                    key={d.key}
                                                    className={`flex items-center justify-between p-2 rounded cursor-pointer text-xs transition ${
                                                        isChecked
                                                            ? 'bg-indigo-900/30 text-white font-medium border border-indigo-700/50'
                                                            : 'hover:bg-gray-700/50 text-gray-400'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => toggleDate(d.key)}
                                                            className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 w-4 h-4 bg-gray-700"
                                                        />
                                                        <span>{d.display}</span>
                                                    </div>
                                                    <span className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full text-[10px]">
                                                        {d.count} bakım
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Section 2: Bakım Kategorileri Seçimi */}
                                <div className="bg-gray-900/70 border border-gray-700 rounded-xl p-4 flex flex-col">
                                    <div className="flex justify-between items-center mb-3">
                                        <div className="flex items-center gap-2">
                                            <span className="text-purple-400 font-bold">🛠️</span>
                                            <h3 className="font-bold text-sm text-white">
                                                Kategori Seçimi ({selectedCategories.size}/{categoryOptions.length})
                                            </h3>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handleSelectAllCategories}
                                                className="text-xs text-purple-400 hover:text-purple-300 underline font-medium"
                                            >
                                                Tümünü Seç
                                            </button>
                                            <span className="text-gray-600">|</span>
                                            <button
                                                type="button"
                                                onClick={handleDeselectAllCategories}
                                                className="text-xs text-gray-400 hover:text-gray-300 underline font-medium"
                                            >
                                                Temizle
                                            </button>
                                        </div>
                                    </div>

                                    {/* Category Search Input */}
                                    <div className="mb-2">
                                        <input
                                            type="text"
                                            value={searchCategory}
                                            onChange={(e) => setSearchCategory(e.target.value)}
                                            placeholder="Kategori filtrele..."
                                            className="w-full px-2.5 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500"
                                        />
                                    </div>

                                    <div className="max-h-52 overflow-y-auto pr-2 space-y-1.5 border border-gray-700/60 rounded-lg p-2 bg-gray-800/50">
                                        {filteredCategoryOptions.map(c => {
                                            const isChecked = selectedCategories.has(c.category);
                                            return (
                                                <label
                                                    key={c.category}
                                                    className={`flex items-center justify-between p-2 rounded cursor-pointer text-xs transition ${
                                                        isChecked
                                                            ? 'bg-purple-900/30 text-white font-medium border border-purple-700/50'
                                                            : 'hover:bg-gray-700/50 text-gray-400'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2.5">
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => toggleCategory(c.category)}
                                                            className="rounded border-gray-600 text-purple-600 focus:ring-purple-500 w-4 h-4 bg-gray-700"
                                                        />
                                                        <span className="truncate max-w-[220px]" title={c.category}>
                                                            {c.category}
                                                        </span>
                                                    </div>
                                                    <span className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full text-[10px]">
                                                        {c.count} adet
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {/* Preview Table of First 6 Items */}
                            {importableCandidates.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                                            Yüklenecek Kayıtlardan Önizleme (İlk {Math.min(6, importableCandidates.length)} / {importableCandidates.length}):
                                        </h4>
                                    </div>
                                    <div className="overflow-x-auto border border-gray-700 rounded-lg">
                                        <table className="w-full text-xs text-left text-gray-300">
                                            <thead className="bg-gray-900 text-gray-400 uppercase">
                                                <tr>
                                                    <th className="px-3 py-2">Stand</th>
                                                    <th className="px-3 py-2">Kategori</th>
                                                    <th className="px-3 py-2">Başlangıç</th>
                                                    <th className="px-3 py-2">Bitiş</th>
                                                    <th className="px-3 py-2">Süre (Saat)</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-700">
                                                {importableCandidates.slice(0, 6).map((c, idx) => {
                                                    const durationHrs = ((c.endTime.getTime() - c.startTime.getTime()) / (1000 * 60 * 60)).toFixed(1);
                                                    return (
                                                        <tr key={c.tempId || idx} className="hover:bg-gray-700/40">
                                                            <td className="px-3 py-2 font-bold text-amber-400">{c.parkingPosition}</td>
                                                            <td className="px-3 py-2 text-white">{c.reason}</td>
                                                            <td className="px-3 py-2">{c.startTime.toLocaleString('tr-TR')}</td>
                                                            <td className="px-3 py-2">{c.endTime.toLocaleString('tr-TR')}</td>
                                                            <td className="px-3 py-2 text-cyan-400">{durationHrs} saat</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                        </div>
                    )}
                </main>

                {/* Footer */}
                <footer className="p-4 bg-gray-900 border-t border-gray-700 flex justify-between items-center">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2 px-4 rounded-lg text-sm transition"
                    >
                        İptal
                    </button>

                    {allParsedCandidates.length > 0 && (
                        <button
                            type="button"
                            onClick={handleConfirmImport}
                            disabled={importableCandidates.length === 0}
                            className={`font-bold py-2 px-5 rounded-lg text-sm transition flex items-center gap-2 shadow-lg ${
                                importableCandidates.length > 0
                                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white cursor-pointer'
                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                            }`}
                        >
                            <span>📥</span>
                            <span>{importableCandidates.length} Adet Bakımı İçe Aktar</span>
                        </button>
                    )}
                </footer>
            </div>
        </div>
    );
};

export default MaintenanceImportModal;
