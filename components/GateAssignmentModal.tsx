import React, { useState, useEffect } from 'react';
import { Flight } from '../types.ts';

interface GateAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (gate: string | null) => void;
  flight: Flight | null;
  gateList: string[];
}

const GateAssignmentModal: React.FC<GateAssignmentModalProps> = ({ isOpen, onClose, onSave, flight, gateList }) => {
  const [selectedGate, setSelectedGate] = useState<string>('');

  useEffect(() => {
    if (flight) {
      setSelectedGate(flight.gate || '');
    }
  }, [flight]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(selectedGate === '' ? null : selectedGate);
  };
  
  if (!isOpen || !flight) return null;

  const flightIdentifier = flight.arrivalFlightNumber && flight.departureFlightNumber
      ? `${flight.arrivalFlightNumber}/${flight.departureFlightNumber}`
      : flight.arrivalFlightNumber || flight.departureFlightNumber || flight.id;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[70] p-4">
      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md">
        <header className="p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Gate Ata: {flightIdentifier}</h2>
        </header>

        <main className="p-6 space-y-4">
          <div>
            <label htmlFor="gateSelect" className="block text-sm font-medium text-gray-300 mb-1">
              Gate
            </label>
            <select
              id="gateSelect"
              value={selectedGate}
              onChange={(e) => setSelectedGate(e.target.value)}
              className="w-full p-2 bg-gray-700 border rounded-md text-white border-gray-600"
            >
              <option value="">-- Gate Atamasını Kaldır --</option>
              {gateList.map(gate => (
                <option key={gate} value={gate}>{gate}</option>
              ))}
            </select>
          </div>
        </main>

        <footer className="p-4 bg-gray-900/50 border-t border-gray-700 flex justify-end space-x-3">
          <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300">
            İptal
          </button>
          <button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300">
            Kaydet
          </button>
        </footer>
      </form>
    </div>
  );
};

export default GateAssignmentModal;