import React from 'react';

interface ExcelErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  errors: { rowIndex: number; reason: string; rowData: any }[];
}

const ExcelErrorModal: React.FC<ExcelErrorModalProps> = ({ isOpen, onClose, errors }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[85] p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <header className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white text-yellow-400">Excel Yükleme Raporu</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </header>

        <main className="p-6 flex-grow overflow-y-auto">
          <p className="text-gray-300 mb-4">
            Dosya yüklendi ancak aşağıdaki <strong className="text-yellow-400">{errors.length} satır</strong> hatalı veya eksik veri nedeniyle işlenemedi. Lütfen Excel dosyanızı kontrol edip tekrar deneyin.
          </p>
          <div className="overflow-x-auto border border-gray-700 rounded-lg">
            <table className="w-full text-sm text-left text-gray-300">
              <thead className="text-xs text-gray-400 uppercase bg-gray-700/50">
                <tr>
                  <th scope="col" className="px-4 py-2 w-24">Satır No</th>
                  <th scope="col" className="px-4 py-2 w-1/3">Hata Sebebi</th>
                  <th scope="col" className="px-4 py-2">Hatalı Veri</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((error, index) => (
                  <tr key={index} className="bg-gray-800 border-b border-gray-700 hover:bg-gray-700/50">
                    <td className="px-4 py-2 font-mono text-center">{error.rowIndex}</td>
                    <td className="px-4 py-2 text-red-400">{error.reason}</td>
                    <td className="px-4 py-2 font-mono text-gray-400 whitespace-pre-wrap break-all">
                      {JSON.stringify(error.rowData, null, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
        
        <footer className="p-4 bg-gray-900/50 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
          >
            Anladım
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ExcelErrorModal;