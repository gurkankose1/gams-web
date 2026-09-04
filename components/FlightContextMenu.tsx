import React from 'react';

interface ContextMenuProps {
  menu: { x: number; y: number; flightId: string } | null;
  onClose: () => void;
  onToggleOverride: (flightId: string) => void;
  ruleOverrides: Set<string>;
  onShowHistory: (flightId: string) => void;
  onShowMap: (flightId: string) => void;
  onAssignGate: (flightId: string) => void;
}

const FlightContextMenu: React.FC<ContextMenuProps> = ({ menu, onClose, onToggleOverride, ruleOverrides, onShowHistory, onShowMap, onAssignGate }) => {
  if (!menu) return null;

  const isOverridden = ruleOverrides.has(menu.flightId);

  const handleToggle = () => {
    onToggleOverride(menu.flightId);
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

  const handleAssignGate = () => {
    onAssignGate(menu.flightId);
    onClose();
  };


  return (
    <div
      className="context-menu-class fixed bg-gray-700 border border-gray-600 rounded-md shadow-lg z-[60] text-white text-sm"
      style={{ top: menu.y, left: menu.x }}
    >
      <ul className="py-1">
        <li>
          <button
            onClick={handleToggle}
            className="w-full text-left px-4 py-2 hover:bg-purple-600"
          >
            {isOverridden ? "Kuralı Etkinleştir" : "Yerleşim Kuralını Esnet"}
          </button>
        </li>
        <li>
          <button
            onClick={handleAssignGate}
            className="w-full text-left px-4 py-2 hover:bg-purple-600"
          >
            Gate Ata
          </button>
        </li>
        <div className="my-1 h-px bg-gray-600"></div>
        <li>
          <button
            onClick={handleShowHistory}
            className="w-full text-left px-4 py-2 hover:bg-purple-600"
          >
            Kayıtları Gör
          </button>
        </li>
        <li>
          <button
            onClick={handleShowMap}
            className="w-full text-left px-4 py-2 hover:bg-purple-600"
          >
            Harita Göster
          </button>
        </li>
      </ul>
    </div>
  );
};

export default FlightContextMenu;