import React, { useState } from 'react';

export interface ImportReport {
    totalExcelRows: number;
    totalParsedFlights: number;
    assignedFlightsCount: number;
    unassignedFlightsCount: number;
    errors: { rowIndex: number; reason: string; rowData: any }[];
    concourseCounts: Record<string, number>;
    minDate?: Date;
    maxDate?: Date;
    unassignedList: { rowIndex: number; flightNumber: string; timeStr: string; originDest: string; aircraftType: string }[];
}

interface ExcelImportReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    report: ImportReport | null;
}

const ExcelImportReportModal: React.FC<ExcelImportReportModalProps> = ({ isOpen, onClose, report }) => {
    const [activeTab, setActiveTab] = useState<'summary' | 'unassigned' | 'errors' | 'concourses'>('summary');

    if (!isOpen || !report) return null;

    const timeOptions: Intl.DateTimeFormatOptions = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[90] p-4">
            <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-white">
                
                {/* Header */}
                <header className="p-5 bg-gray-900 border-b border-gray-700 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-bold text-amber-400 flex items-center gap-2">
                            <span>📊</span> Excel Yükleme ve Raporlama Sonucu
                        </h2>
                        <p className="text-xs text-gray-400 mt-1">
                            Yüklenen Excel dosyasının GAMS sistemine aktarım detayları ve istatistikleri
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl font-bold leading-none px-2 py-1 rounded hover:bg-gray-800">&times;</button>
                </header>

                {/* Main Content */}
                <main className="p-6 flex-grow overflow-y-auto space-y-6">

                    {/* KPI Stat Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                        <div className="bg-gray-700/60 p-3 rounded-lg border border-gray-600/80 text-center">
                            <span className="text-xs text-gray-400 font-semibold block uppercase">Excel Satır</span>
                            <span className="text-2xl font-black text-white">{report.totalExcelRows}</span>
                        </div>
                        <div className="bg-blue-900/40 p-3 rounded-lg border border-blue-600/60 text-center">
                            <span className="text-xs text-blue-300 font-semibold block uppercase">Aktarılan Uçuş</span>
                            <span className="text-2xl font-black text-blue-400">{report.totalParsedFlights}</span>
                        </div>
                        <div className="bg-emerald-900/40 p-3 rounded-lg border border-emerald-600/60 text-center">
                            <span className="text-xs text-emerald-300 font-semibold block uppercase">Pozisyona Atanan</span>
                            <span className="text-2xl font-black text-emerald-400">{report.assignedFlightsCount}</span>
                        </div>
                        <div className="bg-amber-900/40 p-3 rounded-lg border border-amber-600/60 text-center">
                            <span className="text-xs text-amber-300 font-semibold block uppercase">Atanmamış Havuz</span>
                            <span className="text-2xl font-black text-amber-400">{report.unassignedFlightsCount}</span>
                        </div>
                        <div className="bg-rose-900/40 p-3 rounded-lg border border-rose-600/60 text-center">
                            <span className="text-xs text-rose-300 font-semibold block uppercase">Hatalı Satır</span>
                            <span className="text-2xl font-black text-rose-400">{report.errors.length}</span>
                        </div>
                    </div>

                    {/* Date Range Summary Banner */}
                    {report.minDate && report.maxDate && (
                        <div className="bg-gray-900/80 p-3 rounded-lg border border-gray-700 flex flex-col md:flex-row md:items-center justify-between text-xs gap-2">
                            <div className="flex items-center gap-2">
                                <span className="text-amber-400 font-bold">🗓️ Dosyadaki Zaman Aralığı:</span>
                                <span className="font-mono bg-gray-800 px-2 py-0.5 rounded text-gray-200">
                                    {report.minDate.toLocaleString('tr-TR', timeOptions)} — {report.maxDate.toLocaleString('tr-TR', timeOptions)}
                                </span>
                            </div>
                            <div className="text-gray-400">
                                Zaman çizgisi otomatik olarak bu aralığa göre ayarlanmıştır.
                            </div>
                        </div>
                    )}

                    {/* Navigation Tabs */}
                    <div className="flex border-b border-gray-700 space-x-2">
                        <button
                            onClick={() => setActiveTab('summary')}
                            className={`py-2 px-4 font-semibold text-sm rounded-t-lg transition ${activeTab === 'summary' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
                        >
                            📌 Özet
                        </button>
                        <button
                            onClick={() => setActiveTab('unassigned')}
                            className={`py-2 px-4 font-semibold text-sm rounded-t-lg transition ${activeTab === 'unassigned' ? 'bg-amber-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
                        >
                            📋 Atanmamış Uçuşlar ({report.unassignedFlightsCount})
                        </button>
                        <button
                            onClick={() => setActiveTab('concourses')}
                            className={`py-2 px-4 font-semibold text-sm rounded-t-lg transition ${activeTab === 'concourses' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
                        >
                            🅿️ Concourse Dağılımı ({Object.keys(report.concourseCounts).length})
                        </button>
                        <button
                            onClick={() => setActiveTab('errors')}
                            className={`py-2 px-4 font-semibold text-sm rounded-t-lg transition ${activeTab === 'errors' ? 'bg-rose-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
                        >
                            ⚠️ Hatalı Satırlar ({report.errors.length})
                        </button>
                    </div>

                    {/* Tab 1: Summary */}
                    {activeTab === 'summary' && (
                        <div className="space-y-4 text-sm text-gray-300">
                            <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                                <h3 className="font-bold text-amber-400 mb-2">✅ Aktarım Durum Bilgisi</h3>
                                <p className="leading-relaxed">
                                    Excel dosyasındaki <strong className="text-white">{report.totalExcelRows} satırdan</strong> toplam <strong className="text-emerald-400">{report.totalParsedFlights} uçuş</strong> başarıyla okunarak GAMS sistemine yüklendi.
                                </p>
                                <ul className="list-disc list-inside mt-2 space-y-1 text-gray-300">
                                    <li><strong className="text-emerald-400">{report.assignedFlightsCount} uçuş</strong> doğrudan Excel'deki park pozisyonu koduna (ArrStand/DepStand) otomatik atandı.</li>
                                    <li><strong className="text-amber-400">{report.unassignedFlightsCount} uçuş</strong> Excel kaynağında stand bilgisi boş olduğu için <strong>Atanmamış Havuzu</strong>'na alındı.</li>
                                    {report.errors.length > 0 ? (
                                        <li className="text-rose-400 font-bold">{report.errors.length} satır geçersiz zaman veya format hatası nedeniyle atlandı.</li>
                                    ) : (
                                        <li className="text-emerald-400">Hiçbir satırda veri okuma hatası oluşmadı (%100 Başarılı aktarım).</li>
                                    )}
                                </ul>
                            </div>
                        </div>
                    )}

                    {/* Tab 2: Unassigned Flights */}
                    {activeTab === 'unassigned' && (
                        <div className="space-y-3">
                            <p className="text-xs text-gray-400">
                                Excel dosyasında <code className="text-amber-300">ArrStand</code> ve <code className="text-amber-300">Dep Stand</code> hücreleri boş olan uçuşlar aşağıda listelenmiştir:
                            </p>
                            <div className="overflow-x-auto border border-gray-700 rounded-lg max-h-80 overflow-y-auto">
                                <table className="w-full text-xs text-left text-gray-300">
                                    <thead className="text-gray-400 uppercase bg-gray-900 sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2">Satır</th>
                                            <th className="px-3 py-2">Uçuş No</th>
                                            <th className="px-3 py-2">Tarih / Saat</th>
                                            <th className="px-3 py-2">Nereden / Nereye</th>
                                            <th className="px-3 py-2">Uçak Tipi</th>
                                            <th className="px-3 py-2">Durum</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.unassignedList.map((item, idx) => (
                                            <tr key={idx} className="bg-gray-800/80 border-b border-gray-700 hover:bg-gray-700/50">
                                                <td className="px-3 py-2 font-mono">{item.rowIndex}</td>
                                                <td className="px-3 py-2 font-bold text-amber-300">{item.flightNumber}</td>
                                                <td className="px-3 py-2 font-mono">{item.timeStr}</td>
                                                <td className="px-3 py-2">{item.originDest}</td>
                                                <td className="px-3 py-2 font-mono">{item.aircraftType}</td>
                                                <td className="px-3 py-2 text-amber-400 font-semibold">Atanmamış Havuzda</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Tab 3: Concourse Distribution */}
                    {activeTab === 'concourses' && (
                        <div className="space-y-3">
                            <p className="text-xs text-gray-400">
                                Pozisyona atanan <strong className="text-emerald-400">{report.assignedFlightsCount} uçuşun</strong> concourse / apron alanlarına göre dağılımı:
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                {Object.entries(report.concourseCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                                    <div key={name} className="bg-gray-900/80 p-3 rounded-lg border border-gray-700 flex justify-between items-center">
                                        <span className="font-bold text-amber-400 text-xs">{name}</span>
                                        <span className="font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded text-xs">
                                            {count} Uçuş
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tab 4: Errors */}
                    {activeTab === 'errors' && (
                        <div className="space-y-3">
                            {report.errors.length === 0 ? (
                                <div className="p-8 text-center bg-emerald-950/30 border border-emerald-700/50 rounded-xl text-emerald-400">
                                    <span className="text-3xl block mb-2">🎉</span>
                                    <h4 className="font-bold text-base">Hatalı Satır Bulunmamaktadır!</h4>
                                    <p className="text-xs text-gray-300 mt-1">Excel dosyasındaki tüm veriler sıfır kayıpla başarıyla okundu.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto border border-gray-700 rounded-lg max-h-80 overflow-y-auto">
                                    <table className="w-full text-xs text-left text-gray-300">
                                        <thead className="text-gray-400 uppercase bg-gray-900 sticky top-0">
                                            <tr>
                                                <th className="px-3 py-2 w-20">Satır</th>
                                                <th className="px-3 py-2 w-1/3">Hata Nedeni</th>
                                                <th className="px-3 py-2">Ham Satır Verisi</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {report.errors.map((err, idx) => (
                                                <tr key={idx} className="bg-gray-800/80 border-b border-gray-700 hover:bg-gray-700/50">
                                                    <td className="px-3 py-2 font-mono text-amber-400 font-bold">{err.rowIndex}</td>
                                                    <td className="px-3 py-2 text-rose-400 font-semibold">{err.reason}</td>
                                                    <td className="px-3 py-2 font-mono text-gray-400 text-[11px] whitespace-pre-wrap break-all">
                                                        {JSON.stringify(err.rowData, null, 2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                </main>

                {/* Footer */}
                <footer className="p-4 bg-gray-900 border-t border-gray-700 flex justify-end">
                    <button
                        onClick={onClose}
                        className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-6 rounded-lg transition duration-300 shadow-md"
                    >
                        Tamam, Planlamaya Geç
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default ExcelImportReportModal;
