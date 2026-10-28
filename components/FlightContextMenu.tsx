import React from 'react';

interface ContextMenuProps {
  menu: { x: number; y: number; flightId: string } | null;
  onClose: () => void;
  onToggleOverride: (flightId: string) => void;
  onToggleSuperSet?: (flightId: string) => void;
  ruleOverrides: Set<string>;
  onShowHistory: (flightId: string) => void;
  onShowMap: (flightId: string) => void;
  onShowRadar?: (flightId: string) => void;
  onAssignGate: (flightId: string) => void;
}

const FlightContextMenu: React.FC<ContextMenuProps> = ({ menu, onClose, onToggleOverride, onToggleSuperSet, ruleOverrides, onShowHistory, onShowMap, onShowRadar, onAssignGate }) => {
  if (!menu) return null;

  const isOverridden = ruleOverrides.has(menu.flightId);

  const handleToggle = () => {
    onToggleOverride(menu.flightId);
    onClose();
  };

  const handleToggleSuperSet = () => {
    if (onToggleSuperSet) {
      onToggleSuperSet(menu.flightId);
    }
    onClose();
  };

  const handleShowHistory = () => {
    onShowHistory(menu.flightId);
    onClose();
  };

  const handleShowMap = () => {
    onShowMap(menu.flightId);
    onClose();
  };

  const handleShowRadar = () => {
    if (onShowRadar) {
      onShowRadar(menu.flightId);
    }
    onClose();
  };

  const handleAssignGate = () => {
    onAssignGate(menu.flightId);
    onClose();
  };


  return (
    <div
      className="context-menu-class fixed bg-gray-800 border border-cyan-500/40 rounded-xl shadow-2xl z-[60] text-white text-xs overflow-hidden backdrop-blur-md"
      style={{ top: menu.y, left: menu.x }}
    >
      <ul className="py-1">
        <li>
          <button
            onClick={handleShowRadar}
            className="w-full text-left px-4 py-2 hover:bg-cyan-600/90 text-cyan-300 font-bold flex items-center gap-2 transition"
          >
            <span className="text-sm animate-pulse">📡</span>
            <span>Radar Verisine Götür (Flightradar24)</span>
          </button>
        </li>
        <div className="my-1 h-px bg-gray-700"></div>
        <li>
          <button
            onClick={handleToggle}
            className="w-full text-left px-4 py-2 hover:bg-purple-600 transition"
          >
            {isOverridden ? "Kuralı Etkinleştir" : "Yerleşim Kuralını Esnet"}
          </button>
        </li>
        <li>
          <button
            onClick={handleToggleSuperSet}
            className="w-full text-left px-4 py-2 hover:bg-amber-600 text-amber-300 font-semibold transition"
          >
            ⚡ Super Set (Destinasyon Kurallarını Askıya Al)
          </button>
        </li>
        <li>
          <button
            onClick={handleAssignGate}
            className="w-full text-left px-4 py-2 hover:bg-purple-600 transition"
          >
            Gate Ata
          </button>
        </li>
        <div className="my-1 h-px bg-gray-700"></div>
        <li>
          <button
            onClick={handleShowHistory}
            className="w-full text-left px-4 py-2 hover:bg-purple-600 transition"
          >
            Kayıtları Gör
          </button>
        </li>
        <li>
          <button
            onClick={handleShowMap}
            className="w-full text-left px-4 py-2 hover:bg-purple-600 transition"
          >
            Harita Göster
          </button>
        </li>
      </ul>
    </div>
  );
};

export default FlightContextMenu;