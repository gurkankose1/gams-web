import React from 'react';
import { Flight } from '../types.ts';

interface FlightHistoryModalProps {
  flight: Flight | null;
  onClose: () => void;
}

const FlightHistoryModal: React.FC<FlightHistoryModalProps> = ({ flight, onClose }) => {
  if (!flight) return null;

  const getFlightIdentifier = (f: Flight) => {
    return f.arrivalFlightNumber && f.departureFlightNumber
      ? `${f.arrivalFlightNumber}/${f.departureFlightNumber}`
      : f.arrivalFlightNumber || f.departureFlightNumber || f.id;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[70] p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <header className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Uçuş Kayıtları: {getFlightIdentifier(flight)}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </header>

        <main className="p-6 flex-grow overflow-y-auto">
          {flight.history && flight.history.length > 0 ? (
            <div className="overflow-x-auto border border-gray-700 rounded-lg">
              <table className="w-full text-sm text-left text-gray-300">
                <thead className="text-xs text-gray-400 uppercase bg-gray-700/50">
                  <tr>
                    <th scope="col" className="px-4 py-2">Tarih / Saat</th>
                    <th scope="col" className="px-4 py-2">Kullanıcı</th>
                    <th scope="col" className="px-4 py-2">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {[...flight.history].reverse().map((entry, index) => (
                    <tr key={index} className="bg-gray-800 border-b border-gray-700 hover:bg-gray-700/50">
                      <td className="px-4 py-2 whitespace-nowrap">{entry.timestamp.toLocaleString('tr-TR')}</td>
                      <td className="px-4 py-2">{entry.user}</td>
                      <td className="px-4 py-2">{entry.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-400 text-center">Bu uçuş için kayıt bulunamadı.</p>
          )}
        </main>
      </div>
    </div>
  );
};

export default FlightHistoryModal;