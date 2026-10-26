import React, { useState } from 'react';
import { MaintenanceBlock } from '../types.ts';

interface MaintenanceManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  maintenanceBlocks: MaintenanceBlock[];
  onEdit: (block: MaintenanceBlock) => void;
  onDelete: (blockId: string) => void;
  onOpenImport?: () => void;
  onClearAll?: () => void;
}

const MaintenanceManagementModal: React.FC<MaintenanceManagementModalProps> = ({
  isOpen,
  onClose,
  maintenanceBlocks,
  onEdit,
  onDelete,
  onOpenImport,
  onClearAll
}) => {
  const [filterQuery, setFilterQuery] = useState('');

  if (!isOpen) return null;

  const sortedBlocks = [...maintenanceBlocks].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const filteredBlocks = filterQuery.trim()
    ? sortedBlocks.filter(b =>
        b.parkingPosition.toLowerCase().includes(filterQuery.toLowerCase()) ||
        b.reason.toLowerCase().includes(filterQuery.toLowerCase())
      )
    : sortedBlocks;

  const handleClearAllConfirm = () => {
    if (!onClearAll) return;
    if (window.confirm(`Toplam ${maintenanceBlocks.length} adet bakımı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) {
      onClearAll();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[70] p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden text-white">
        
        {/* Header */}
        <header className="p-4 bg-gray-900 border-b border-gray-700 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-xl">🛠️</span>
            <div>
              <h2 className="text-lg font-bold text-white">Bakım / Downgrade Yönetimi</h2>
              <p className="text-xs text-gray-400">
                Sistemde tanımlı toplam {maintenanceBlocks.length} aktif bakım kaydı
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onOpenImport && (
              <button
                onClick={() => {
                  onClose();
                  onOpenImport();
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 shadow"
              >
                <span>📥</span> Excel'den Yükle
              </button>
            )}
            {onClearAll && maintenanceBlocks.length > 0 && (
              <button
                onClick={handleClearAllConfirm}
                className="bg-red-700/80 hover:bg-red-600 text-white font-semibold text-xs px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
              >
                <span>🗑️</span> Tümünü Sil
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl font-bold ml-2">&times;</button>
          </div>
        </header>

        {/* Filter Input */}
        {sortedBlocks.length > 0 && (
          <div className="p-3 bg-gray-850 border-b border-gray-700/80 flex items-center gap-2">
            <span className="text-gray-400 text-sm">🔍</span>
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Park pozisyonu veya bakım sebebi ile filtrele (örn: A2, FLB, PBB)..."
              className="w-full bg-gray-700 text-sm text-gray-200 placeholder-gray-400 px-3 py-1.5 rounded border border-gray-600 focus:outline-none focus:border-indigo-500"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="text-xs text-gray-400 hover:text-white px-2 py-1"
              >
                Temizle
              </button>
            )}
          </div>
        )}

        {/* Main Table */}
        <main className="p-4 flex-grow overflow-y-auto">
          {filteredBlocks.length > 0 ? (
            <div className="overflow-x-auto border border-gray-700 rounded-lg">
              <table className="w-full text-xs text-left text-gray-300">
                <thead className="text-[11px] text-gray-400 uppercase bg-gray-900 sticky top-0 z-10">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Park Pozisyonu</th>
                    <th scope="col" className="px-4 py-2.5">Başlangıç</th>
                    <th scope="col" className="px-4 py-2.5">Bitiş</th>
                    <th scope="col" className="px-4 py-2.5">Süre</th>
                    <th scope="col" className="px-4 py-2.5">Bakım Sebebi / Kategori</th>
                    <th scope="col" className="px-4 py-2.5 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {filteredBlocks.map(block => {
                    const durHours = ((block.endTime.getTime() - block.startTime.getTime()) / (1000 * 60 * 60)).toFixed(1);
                    return (
                      <tr key={block.id} className="bg-gray-800/80 hover:bg-gray-700/50">
                        <td className="px-4 py-2 font-bold text-amber-400">{block.parkingPosition}</td>
                        <td className="px-4 py-2">{block.startTime.toLocaleString('tr-TR')}</td>
                        <td className="px-4 py-2">{block.endTime.toLocaleString('tr-TR')}</td>
                        <td className="px-4 py-2 text-cyan-400 font-medium">{durHours} saat</td>
                        <td className="px-4 py-2 font-medium text-white">{block.reason}</td>
                        <td className="px-4 py-2 text-right space-x-2">
                          <button
                            onClick={() => onEdit(block)}
                            className="text-blue-400 hover:text-blue-300 font-medium px-2 py-1 rounded hover:bg-blue-900/30 transition"
                          >
                            Düzenle
                          </button>
                          <button
                            onClick={() => onDelete(block.id)}
                            className="text-red-400 hover:text-red-300 font-medium px-2 py-1 rounded hover:bg-red-900/30 transition"
                          >
                            Sil
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-gray-400 space-y-2">
              <span className="text-4xl block">📋</span>
              <p>{filterQuery ? "Aramaya uygun bakım kaydı bulunamadı." : "Planlanmış bakım bulunmuyor."}</p>
            </div>
          )}
        </main>
        
        {/* Footer */}
        <footer className="p-4 bg-gray-900 border-t border-gray-700 flex justify-between items-center text-xs text-gray-400">
          <div>
            Gösterilen: <span className="text-white font-semibold">{filteredBlocks.length}</span> / {maintenanceBlocks.length}
          </div>
          <button
            onClick={onClose}
            className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-1.5 px-4 rounded-lg transition"
          >
            Kapat
          </button>
        </footer>
      </div>
    </div>
  );
};

export default MaintenanceManagementModal;
