import React from 'react';
import { MaintenanceBlock } from '../types.ts';

interface MaintenanceManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  maintenanceBlocks: MaintenanceBlock[];
  onEdit: (block: MaintenanceBlock) => void;
  onDelete: (blockId: string) => void;
}

const MaintenanceManagementModal: React.FC<MaintenanceManagementModalProps> = ({ isOpen, onClose, maintenanceBlocks, onEdit, onDelete }) => {
  if (!isOpen) return null;
  
  const sortedBlocks = [...maintenanceBlocks].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[70] p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Bakım Yönetimi</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </header>

        <main className="p-6 flex-grow overflow-y-auto">
          {sortedBlocks.length > 0 ? (
            <div className="overflow-x-auto border border-gray-700 rounded-lg">
              <table className="w-full text-sm text-left text-gray-300">
                <thead className="text-xs text-gray-400 uppercase bg-gray-700/50">
                  <tr>
                    <th scope="col" className="px-4 py-2">Park Pozisyonu</th>
                    <th scope="col" className="px-4 py-2">Başlangıç</th>
                    <th scope="col" className="px-4 py-2">Bitiş</th>
                    <th scope="col" className="px-4 py-2">Sebep</th>
                    <th scope="col" className="px-4 py-2 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedBlocks.map(block => (
                    <tr key={block.id} className="bg-gray-800 border-b border-gray-700 hover:bg-gray-700/50">
                      <td className="px-4 py-2 font-semibold">{block.parkingPosition}</td>
                      <td className="px-4 py-2">{block.startTime.toLocaleString('tr-TR')}</td>
                      <td className="px-4 py-2">{block.endTime.toLocaleString('tr-TR')}</td>
                      <td className="px-4 py-2">{block.reason}</td>
                      <td className="px-4 py-2 text-right space-x-2">
                        <button onClick={() => onEdit(block)} className="text-blue-400 hover:text-blue-300 font-medium">Düzenle</button>
                        <button onClick={() => onDelete(block.id)} className="text-red-500 hover:text-red-400 font-medium">Sil</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-400 text-center">Planlanmış bakım bulunmuyor.</p>
          )}
        </main>
        
        <footer className="p-4 bg-gray-900/50 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
          >
            Kapat
          </button>
        </footer>
      </div>
    </div>
  );
};

export default MaintenanceManagementModal;