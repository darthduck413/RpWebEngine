import React from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { LogEntry } from '../types';

interface LogViewerModalProps {
  logs: LogEntry[];
  isVisible: boolean;
  onClose: () => void;
  onClear: () => void;
  themeColor: string;
}

const LogViewerModal: React.FC<LogViewerModalProps> = ({ logs, isVisible, onClose, onClear, themeColor }) => {
  if (!isVisible) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
    >
      <div 
        className={`bg-gray-900 max-w-4xl w-full h-[90vh] flex flex-col rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20 relative`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex justify-between items-center p-4 border-b border-primary-800/50 flex-shrink-0`}>
          <h2 className={`text-xl font-bold text-primary-500`} style={{fontFamily: 'serif'}}>
            Event Log
          </h2>
          <button 
            onClick={onClose} 
            className="text-gray-500 hover:text-white transition-colors"
            aria-label="Close log viewer"
          >
            <XMarkIcon className="h-7 w-7" />
          </button>
        </div>

        <div className="flex-grow p-4 overflow-y-auto custom-scrollbar bg-gray-900/50">
          {logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              No events logged yet.
            </div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className={`p-2 border-b border-gray-800/60 font-mono text-sm`}>
                <span className={`text-primary-400 mr-3`}>[{log.timestamp}]</span>
                <span className="text-gray-200">{log.message}</span>
                {log.data && (
                  <pre className={`mt-2 p-3 bg-gray-800 rounded-md text-xs text-gray-400 overflow-x-auto custom-scrollbar`}>
                    {log.data}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
        
        <div className={`flex justify-end gap-4 p-4 border-t border-primary-800/50 flex-shrink-0`}>
            <button 
                onClick={onClear}
                className="px-5 py-2 bg-gray-700 text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600 transition-all duration-200"
            >
                Clear Logs
            </button>
            <button 
                onClick={onClose}
                className={`px-5 py-2 bg-primary-800 text-white font-semibold rounded-md border border-primary-600 hover:bg-primary-700 transition-all duration-200`}
            >
                Close
            </button>
        </div>
      </div>
    </div>
  );
};

export default LogViewerModal;