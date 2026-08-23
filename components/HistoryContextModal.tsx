import React, { useState, useEffect } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';

interface HistoryContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (turns: number) => void;
  initialTurns: number;
  themeColor: string;
}

const HistoryContextModal: React.FC<HistoryContextModalProps> = ({ isOpen, onClose, onSave, initialTurns, themeColor }) => {
  const [turns, setTurns] = useState(initialTurns);

  useEffect(() => {
    setTurns(initialTurns);
  }, [initialTurns, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(turns);
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
    >
      <div 
        className={`bg-gray-900 max-w-lg w-full p-6 sm:p-8 rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20 relative`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0">
            <h2 className={`text-2xl sm:text-3xl font-bold text-primary-500 pb-2 mb-1`} style={{fontFamily: 'serif'}}>
                Set Conversation Context
            </h2>
            <p className={`text-primary-200/70 mb-6`}>
                Set the number of recent turns to send to the AI. More turns provide better context but may increase response time. 
                <br />
                <strong className={`text-primary-300`}>Set to 0 to send all turns.</strong>
            </p>
        </div>

        <input
          type="number"
          value={turns}
          onChange={(e) => setTurns(Math.max(0, parseInt(e.target.value, 10) || 0))}
          min="0"
          className={`w-full bg-gray-800/80 rounded-md border border-primary-900/70 text-primary-200 placeholder-primary-400/50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 p-3 text-center text-xl`}
          aria-label="Number of turns for context"
        />

        <div className="h-6 mt-2 text-center">
            {turns === 0 && (
                <p className={`text-sm text-primary-300/80 animate-pulse`}>(All conversation history will be sent)</p>
            )}
        </div>
        
        <div className="mt-6 flex justify-end gap-4 flex-shrink-0">
          <button 
            onClick={onClose}
            className="px-5 py-2 bg-gray-700 text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600 transition-all duration-200"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className={`px-5 py-2 bg-primary-800 text-white font-semibold rounded-md border border-primary-600 hover:bg-primary-700 transition-all duration-200`}
          >
            Save
          </button>
        </div>
        <button 
          onClick={onClose} 
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
          aria-label="Close modal"
        >
          <XMarkIcon className="h-8 w-8" />
        </button>
      </div>
    </div>
  );
};

export default HistoryContextModal;