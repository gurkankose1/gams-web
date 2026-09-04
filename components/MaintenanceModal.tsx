import React, { useState, useEffect } from 'react';
import { MaintenanceBlock } from '../types.ts';
import { PARKING_POSITIONS } from '../constants.ts';

interface MaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (block: Omit<MaintenanceBlock, 'id'>, id_to_update?: string) => void;
  blockToEdit?: MaintenanceBlock | null;
}

const formatDateForInput = (date: Date): string => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
};

const MaintenanceModal: React.FC<MaintenanceModalProps> = ({ isOpen, onClose, onSave, blockToEdit }) => {
  const [parkingPosition, setParkingPosition] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [reason, setReason] = useState<string>('Bakım');

  useEffect(() => {
    if (isOpen) {
      if (blockToEdit) {
        setParkingPosition(blockToEdit.parkingPosition);
        setStartTime(formatDateForInput(blockToEdit.startTime));
        setEndTime(formatDateForInput(blockToEdit.endTime));
        setReason(blockToEdit.reason);
      } else {
        const now = new Date();
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
        setParkingPosition('');
        setStartTime(formatDateForInput(now));
        setEndTime(formatDateForInput(oneHourLater));
        setReason('Bakım');
      }
    }
  }, [isOpen, blockToEdit]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parkingPosition || !startTime || !endTime) {
      alert('Lütfen tüm zorunlu alanları doldurun.');
      return;
    }
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    if (startDate >= endDate) {
      alert('Başlangıç saati, bitiş saatinden önce olmalıdır.');
      return;
    }

    onSave({
      parkingPosition,
      startTime: startDate,
      endTime: endDate,
      reason,
    }, blockToEdit?.id);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[70] p-4">
      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md">
        <header className="p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">{blockToEdit ? 'Bakımı Düzenle' : 'Park Pozisyonu Bakım Planla'}</h2>
        </header>

        <main className="p-6 space-y-4">
          <div>
            <label htmlFor="parkingPosition" className="block text-sm font-medium text-gray-300 mb-1">
              Park Pozisyonu <span className="text-red-500">*</span>
            </label>
            <select
              id="parkingPosition"
              value={parkingPosition}
              onChange={(e) => setParkingPosition(e.target.value)}
              required
              className="w-full p-2 bg-gray-700 border rounded-md text-white border-gray-600"
            >
              <option value="">-- Pozisyon Seçin --</option>
              {PARKING_POSITIONS.map(pos => (
                <option key={pos} value={pos}>{pos}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="startTime" className="block text-sm font-medium text-gray-300 mb-1">
              Başlangıç Zamanı <span className="text-red-500">*</span>
            </label>
            <input
              id="startTime"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="w-full p-2 bg-gray-700 border rounded-md text-white border-gray-600"
            />
          </div>
          <div>
            <label htmlFor="endTime" className="block text-sm font-medium text-gray-300 mb-1">
              Bitiş Zamanı <span className="text-red-500">*</span>
            </label>
            <input
              id="endTime"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className="w-full p-2 bg-gray-700 border rounded-md text-white border-gray-600"
            />
          </div>
          <div>
            <label htmlFor="reason" className="block text-sm font-medium text-gray-300 mb-1">
              Sebep
            </label>
            <input
              id="reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full p-2 bg-gray-700 border rounded-md text-white border-gray-600"
            />
          </div>
        </main>

        <footer className="p-4 bg-gray-900/50 border-t border-gray-700 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
          >
            İptal
          </button>
          <button
            type="submit"
            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
          >
            Kaydet
          </button>
        </footer>
      </form>
    </div>
  );
};

export default MaintenanceModal;