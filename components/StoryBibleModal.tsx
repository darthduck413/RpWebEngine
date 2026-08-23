
import React, { useEffect, useState } from 'react';
import { StoryBible } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';

interface StoryBibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  bible: StoryBible | null;
  onRebuild: () => void;
  onSaveEdit: (next: StoryBible) => void;
}

type Tab = 'universe' | 'plot' | 'lore' | 'roster' | 'locations' | 'raw';

const TabButton: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${active ? 'bg-primary-800 text-white border-primary-600' : 'bg-gray-800/70 text-gray-300 border-gray-700 hover:bg-primary-900/40 hover:text-white'}`}
  >
    {label}
  </button>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-4">
    <h4 className="text-xs uppercase tracking-wider text-primary-400/80 mb-1">{title}</h4>
    <div className="text-gray-200 text-sm whitespace-pre-wrap break-words">{children}</div>
  </div>
);

const StoryBibleModal: React.FC<StoryBibleModalProps> = ({ isOpen, onClose, bible, onRebuild, onSaveEdit }) => {
  const [tab, setTab] = useState<Tab>('plot');
  const [rawDraft, setRawDraft] = useState<string>('');
  const [rawError, setRawError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRawDraft(bible ? JSON.stringify(bible, null, 2) : '');
      setRawError(null);
      setTab('plot');
    }
  }, [isOpen, bible]);

  if (!isOpen) return null;

  const handleSaveRaw = () => {
    try {
      const parsed = JSON.parse(rawDraft) as StoryBible;
      if (!parsed || typeof parsed !== 'object') throw new Error('Bible must be an object.');
      onSaveEdit({ ...parsed, lastEdited: Date.now() });
      setRawError(null);
    } catch (e) {
      setRawError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-gray-900 max-w-3xl w-full max-h-[95vh] overflow-y-auto p-4 sm:p-6 rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20 relative custom-scrollbar" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl sm:text-3xl font-bold text-white pb-2 mb-3" style={{ fontFamily: 'serif' }}>Story Bible</h2>

        {!bible ? (
          <div className="text-gray-300 text-sm">
            <p>No Story Bible yet. It is built automatically on the first generation when World Model is enabled.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              <TabButton active={tab === 'plot'} onClick={() => setTab('plot')} label="Plot" />
              <TabButton active={tab === 'universe'} onClick={() => setTab('universe')} label="Universe" />
              <TabButton active={tab === 'lore'} onClick={() => setTab('lore')} label="Lore" />
              <TabButton active={tab === 'roster'} onClick={() => setTab('roster')} label="Roster" />
              <TabButton active={tab === 'locations'} onClick={() => setTab('locations')} label="Locations" />
              <TabButton active={tab === 'raw'} onClick={() => setTab('raw')} label="Raw JSON" />
            </div>

            {tab === 'universe' && (
              <div>
                <Section title="Known universe">
                  {bible.universe.isKnown ? 'Yes' : 'No'}
                </Section>
                {bible.universe.name && <Section title="Name">{bible.universe.name}</Section>}
                {bible.universe.originalStorylineHint && <Section title="Original storyline hint">{bible.universe.originalStorylineHint}</Section>}
              </div>
            )}

            {tab === 'plot' && (
              <div>
                <Section title="Intro">{bible.plot.intro || '—'}</Section>
                <Section title="Conflict">{bible.plot.conflict || '—'}</Section>
                <Section title="Climax">{bible.plot.climax || '—'}</Section>
                <Section title="Epilogue">{bible.plot.epilogue || '—'}</Section>
                <Section title="Themes">
                  {bible.plot.themes && bible.plot.themes.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {bible.plot.themes.map((t, i) => (
                        <span key={i} className="px-2 py-0.5 bg-primary-900/50 border border-primary-800/60 rounded-full text-xs text-primary-100">{t}</span>
                      ))}
                    </div>
                  ) : '—'}
                </Section>
              </div>
            )}

            {tab === 'lore' && (
              <div>
                <Section title="Rules">
                  {bible.lore.rules && bible.lore.rules.length > 0 ? (
                    <ul className="list-disc list-inside space-y-1">
                      {bible.lore.rules.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  ) : '—'}
                </Section>
                <Section title="Key facts">
                  {bible.lore.keyFacts && bible.lore.keyFacts.length > 0 ? (
                    <ul className="list-disc list-inside space-y-1">
                      {bible.lore.keyFacts.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  ) : '—'}
                </Section>
              </div>
            )}

            {tab === 'roster' && (
              <div>
                {bible.charactersRoster && bible.charactersRoster.length > 0 ? (
                  <div className="space-y-2">
                    {bible.charactersRoster.map(c => (
                      <div key={c.id} className="p-2 border border-primary-900/40 rounded bg-gray-800/40">
                        <div className="font-semibold text-white">{c.name} <span className="text-xs text-primary-300 ml-2">({c.role})</span></div>
                        <div className="text-xs text-gray-400">id: {c.id}</div>
                        {c.relations && <div className="text-sm text-gray-200 mt-1">{c.relations}</div>}
                      </div>
                    ))}
                  </div>
                ) : <div className="text-gray-400 text-sm">—</div>}
              </div>
            )}

            {tab === 'locations' && (
              <div>
                {bible.locations && bible.locations.length > 0 ? (
                  <div className="space-y-2">
                    {bible.locations.map(l => (
                      <div key={l.id} className="p-2 border border-primary-900/40 rounded bg-gray-800/40">
                        <div className="font-semibold text-white">{l.name}</div>
                        <div className="text-xs text-gray-400">id: {l.id}</div>
                        {l.description && <div className="text-sm text-gray-200 mt-1">{l.description}</div>}
                      </div>
                    ))}
                  </div>
                ) : <div className="text-gray-400 text-sm">—</div>}
              </div>
            )}

            {tab === 'raw' && (
              <div className="space-y-2">
                <textarea
                  value={rawDraft}
                  onChange={(e) => setRawDraft(e.target.value)}
                  className="w-full h-72 bg-gray-800 border border-primary-900/60 rounded p-2 text-xs font-mono text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                {rawError && <div className="text-red-400 text-xs">{rawError}</div>}
                <button
                  onClick={handleSaveRaw}
                  className="px-4 py-1.5 bg-primary-800 text-white text-sm font-semibold rounded-md border border-primary-600 hover:bg-primary-700"
                >
                  Save edits
                </button>
              </div>
            )}
          </>
        )}

        <div className="flex justify-between gap-3 flex-wrap mt-6 pt-4 border-t border-gray-700/50">
          <button
            onClick={onRebuild}
            className="px-4 py-2 bg-red-900/40 text-red-200 text-sm font-semibold rounded-md border border-red-700 hover:bg-red-900/70 hover:text-white"
            title="Clears the current bible. A new one will be built on the next generation."
          >
            Rebuild Bible
          </button>
          <button onClick={onClose} className="px-5 py-2 bg-gray-700 text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600">Close</button>
        </div>
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-500 hover:text-white" aria-label="Close"><XMarkIcon className="h-7 w-7" /></button>
      </div>
    </div>
  );
};

export default StoryBibleModal;
