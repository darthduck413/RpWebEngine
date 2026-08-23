
import React, { useState, useEffect } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { SparklesIcon } from './icons/SparklesIcon';

interface EditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (content: string) => void;
  initialContent: string;
  title: string;
  helpText: string;
  themeColor: string;
  showSmartContext?: boolean;
  onAnalyzeContext?: () => Promise<string | undefined>;
}

const EditorModal: React.FC<EditorModalProps> = ({ isOpen, onClose, onSave, initialContent, title, helpText, themeColor, showSmartContext = false, onAnalyzeContext }) => {
  const [content, setContent] = useState(initialContent);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent, isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(content);
  };

  const handleAnalyzeClick = async () => {
    if(!onAnalyzeContext) return;
    setIsAnalyzing(true);
    const result = await onAnalyzeContext();
    setIsAnalyzing(false);
    
    if (result) {
        setContent(prev => (prev.trim() ? prev + '\n\n' : '') + result);
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
    >
      <div 
        className={`bg-gray-900 max-w-4xl w-full h-[90vh] flex flex-col p-6 sm:p-8 rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20 relative`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0">
            <h2 className={`text-2xl sm:text-3xl font-bold text-primary-500 pb-2 mb-1`} style={{fontFamily: 'serif'}}>
                {title}
            </h2>
            <p className={`text-primary-200/70 mb-4`}>{helpText}</p>
        </div>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className={`flex-grow w-full bg-gray-800/80 rounded-md border border-primary-900/70 text-primary-200 placeholder-primary-400/50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 p-4 resize-none`}
          aria-label={title}
        />
        
        <div className="mt-6 flex justify-between items-center flex-shrink-0">
          <div>
            {showSmartContext && onAnalyzeContext && (
              <button 
                onClick={handleAnalyzeClick}
                disabled={isAnalyzing}
                className={`flex items-center gap-2 px-4 py-2 bg-primary-900/60 text-primary-300 font-semibold rounded-md border border-primary-800 hover:bg-primary-800/80 hover:text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-wait`}
              >
                <SparklesIcon className="w-5 h-5"/>
                {isAnalyzing ? 'Generating...' : 'Auto-Generate Notes'}
              </button>
            )}
          </div>
          <div className="flex gap-4">
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

export default EditorModal;
