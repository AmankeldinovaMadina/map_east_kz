import React from "react";
import { X } from "lucide-react";
import { MapViewProps } from "./MapView"; // Import the type for MapView props
import MapView from "./MapView"; // Import your MapView component

interface MapModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapViewProps: MapViewProps; // Pass all necessary MapView props
}

const MapModal: React.FC<MapModalProps> = ({
  isOpen,
  onClose,
  mapViewProps,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4">
      <div className="flex flex-col gap-2 items-end w-full max-w-[90vw] h-[90vh] rounded-xl shadow-xl overflow-hidden">
        <button
          onClick={onClose}
          className="flex items-center gap-1 w-fit p-3 py-2 rounded-xl text-white bg-gray-600 hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Закрыть карту"
        >
          <X size={20} />
          <p className="text-sm">Закрыть карту</p>
        </button>
        <MapView {...mapViewProps} />
      </div>
    </div>
  );
};

export default MapModal;