import React, { useState } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { ActiveWorldInfoEntry } from '../services/common/worldInfo';

interface WorldInfoModalProps {
  isVisible: boolean;
  onClose: () => void;
  active: ActiveWorldInfoEntry[];
  scanDepth: number;
  themeColor: string;
}

const approxTokens = (s: string) => Math.round((s?.length ?? 0) / 4);

const typeLabel: Record<string, string> = {
  character: 'character',
  scenario: 'lore',
  setting: 'location',
};

const EntryRow: React.FC<{ item: ActiveWorldInfoEntry }> = ({ item }) => {
  const [open, setOpen] = useState(false);
  const { entry, reason, matchedKeys } = item;
  return (
    <div className="border-b border-gray-800/60">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left p-3 flex items-start gap-2 hover:bg-gray-800/40 transition-colors"
      >
        <span className="text-gray-500 mt-0.5 flex-shrink-0 w-4">{open ? '▾' : '▸'}</span>
        <div className="flex-grow min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-100 break-words">{entry.name || entry.id}</span>
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
              {typeLabel[entry.type] ?? entry.type}
            </span>
            <span className="text-[11px] text-gray-500">~{approxTokens(entry.content)} tok</span>
          </div>
          {reason === 'keyword' && matchedKeys.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {matchedKeys.map(k => (
                <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-900/40 text-primary-300 border border-primary-800/60">
                  “{k}”
                </span>
              ))}
            </div>
          )}
        </div>
      </button>
      {open && (
        <pre className="mx-3 mb-3 p-3 bg-gray-800 rounded-md text-xs text-gray-300 whitespace-pre-wrap break-words custom-scrollbar">
          {entry.content}
        </pre>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; hint: string; items: ActiveWorldInfoEntry[] }> = ({ title, hint, items }) => {
  if (items.length === 0) return null;
  const tokens = items.reduce((s, i) => s + approxTokens(i.entry.content), 0);
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between px-1 mb-1">
        <h3 className="text-sm font-bold text-primary-400">{title} <span className="text-gray-500 font-normal">({items.length})</span></h3>
        <span className="text-[11px] text-gray-500">~{tokens} tok</span>
      </div>
      <p className="px-1 text-[11px] text-gray-500 mb-2">{hint}</p>
      <div className="rounded-lg border border-gray-800 overflow-hidden bg-gray-900/40">
        {items.map(i => <EntryRow key={i.entry.id} item={i} />)}
      </div>
    </div>
  );
};

const WorldInfoModal: React.FC<WorldInfoModalProps> = ({ isVisible, onClose, active, scanDepth, themeColor }) => {
  if (!isVisible) return null;

  const always = active.filter(a => a.reason === 'always');
  const keyword = active.filter(a => a.reason === 'keyword');
  const totalTokens = active.reduce((s, i) => s + approxTokens(i.entry.content), 0);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4">
      <div
        className="bg-gray-900 max-w-3xl w-full h-[92vh] sm:h-[90vh] flex flex-col rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-primary-800/50 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-primary-500" style={{ fontFamily: 'serif' }}>Active World Info</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {active.length} entries · ~{totalTokens} tokens · scanning last {scanDepth} turns
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="Close">
            <XMarkIcon className="h-7 w-7" />
          </button>
        </div>

        <div className="flex-grow p-3 sm:p-4 overflow-y-auto custom-scrollbar">
          {active.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center text-gray-500 px-6">
              Nothing is active yet. Mention a character or place by name and it will appear here on the next turn.
            </div>
          ) : (
            <>
              <Section
                title="Always on"
                hint="Sent every turn regardless of the scene."
                items={always}
              />
              <Section
                title="Triggered by recent text"
                hint={`Loaded because their keyword appeared in the last ${scanDepth} turns. Drops out when no longer mentioned.`}
                items={keyword}
              />
            </>
          )}
        </div>

        <div className="flex justify-end p-4 border-t border-primary-800/50 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-primary-800 text-white font-semibold rounded-md border border-primary-600 hover:bg-primary-700 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default WorldInfoModal;
