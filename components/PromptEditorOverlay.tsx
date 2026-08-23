import React, { useState, useEffect, useRef } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ArrowPathIcon } from './icons/ArrowPathIcon';

interface PromptEditorOverlayProps {
  isOpen: boolean;
  /** e.g. "Custom Prompt — TR-Sonnet 4.6" */
  title: string;
  value: string;
  /** Built-in default the Reset button restores. */
  defaultValue: string;
  onSave: (next: string) => void;
  onClose: () => void;
}

// Full-screen prompt editor, modeled on the in-chat message editor (sticky
// toolbar, Ctrl/Cmd+Shift+Enter to save, Esc to cancel) but tuned for long
// prompt editing: the textarea owns the whole screen and scrolls natively, so
// there is no nested-scroll fighting like in the old inline card textarea.
const PromptEditorOverlay: React.FC<PromptEditorOverlayProps> = ({ isOpen, title, value, defaultValue, onSave, onClose }) => {
  const [text, setText] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setText(value);
      // Focus with the cursor at the start so a long prompt opens at its top.
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(0, 0);
        ta.scrollTop = 0;
      });
    }
  }, [isOpen, value]);

  if (!isOpen) return null;

  const isDirty = text !== value;
  const isDefault = text === defaultValue;
  const lineCount = text.length === 0 ? 0 : text.split('\n').length;

  const handleCancel = () => {
    if (isDirty && !window.confirm('Discard unsaved prompt changes?')) return;
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Same save chord as the chat message editor, plus the editor-native Ctrl+S.
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key === 'Enter') || e.key.toLowerCase() === 's')) {
      e.preventDefault();
      onSave(text);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center sm:p-4">
      <div className="bg-gray-900 w-full h-full sm:max-w-3xl sm:h-[92vh] sm:rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20 flex flex-col overflow-hidden">
        {/* Toolbar — always visible; actions never scroll away like in the old inline form. */}
        <div className="flex-shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-gray-700/70 bg-gray-900/95">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm sm:text-base font-bold text-white truncate">{title}</h2>
            <p className="text-[11px] text-gray-500 font-mono">{lineCount} lines · {text.length} chars{isDirty ? ' · unsaved' : ''}</p>
          </div>
          <button
            type="button"
            onClick={() => setText(defaultValue)}
            disabled={isDefault}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-2 text-xs sm:text-sm text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Restore the built-in default prompt (not saved until you press Save)"
          >
            <ArrowPathIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Default</span>
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2.5 py-2 text-xs sm:text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
            title="Cancel (Esc)"
          >
            <XMarkIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Cancel</span>
          </button>
          <button
            type="button"
            onClick={() => onSave(text)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-primary-500 transition-colors"
            title="Save (Ctrl/Cmd+S or Ctrl/Cmd+Shift+Enter)"
          >
            <CheckCircleIcon className="w-4 h-4" />
            <span>Save</span>
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="flex-grow w-full resize-none bg-transparent px-4 sm:px-6 py-4 text-base leading-relaxed text-gray-200 outline-none focus:outline-none custom-scrollbar"
          placeholder={defaultValue}
          aria-label="Prompt text"
        />

        <div className="flex-shrink-0 hidden sm:flex items-center justify-end px-4 py-1.5 border-t border-gray-800 text-[11px] text-gray-600">
          Ctrl+S / Ctrl+Shift+Enter — save · Esc — cancel
        </div>
      </div>
    </div>
  );
};

export default PromptEditorOverlay;
