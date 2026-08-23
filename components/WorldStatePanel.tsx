
import React, { useState } from 'react';
import { WorldSnapshot, PerCharacterState } from '../types';

interface WorldStatePanelProps {
  snapshot: WorldSnapshot | null | undefined;
  perCharacterStates?: Record<string, PerCharacterState>;
}

const WorldStatePanel: React.FC<WorldStatePanelProps> = ({ snapshot, perCharacterStates }) => {
  const [expanded, setExpanded] = useState(false);
  const [innerExpanded, setInnerExpanded] = useState(false);

  const innerStateEntries: PerCharacterState[] = perCharacterStates
    ? (Object.values(perCharacterStates) as PerCharacterState[]).filter(s => s.emotionalState && s.emotionalState !== 'absent')
    : [];

  if (!snapshot && innerStateEntries.length === 0) return null;

  return (
    <div className="bg-gray-800/40 border border-primary-900/60 rounded-md p-2 sm:p-3 text-sm text-gray-200 mt-2 space-y-2">
      {snapshot && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-between gap-2 text-left"
            aria-expanded={expanded}
          >
            <span className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-semibold text-primary-300">World</span>
              <span className="text-gray-400 truncate">
                <span title="Location">📍 {snapshot.location}</span>
                <span className="mx-2">·</span>
                <span title="Time">🕐 {snapshot.timeOfDay}</span>
                {snapshot.weather && (<><span className="mx-2">·</span><span title="Weather">⛅ {snapshot.weather}</span></>)}
              </span>
            </span>
            <span className="text-primary-300 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
          </button>

          {expanded && (
            <div className="pt-2 border-t border-primary-900/40 space-y-2">
              {snapshot.sceneSummary && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-primary-400/80 mb-0.5">Scene</div>
                  <div className="text-gray-200">{snapshot.sceneSummary}</div>
                </div>
              )}
              {snapshot.plotProgress && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-primary-400/80 mb-0.5">Plot</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 bg-primary-900/50 border border-primary-800/60 rounded-full text-xs text-primary-100 capitalize">{snapshot.plotProgress.phase}</span>
                    <span className="flex items-center gap-1 text-xs text-gray-400" title="Narrative tension">
                      <span>tension</span>
                      <span className="inline-block w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                        <span className="block h-full bg-primary-500" style={{ width: `${Math.max(0, Math.min(100, snapshot.plotProgress.tension))}%` }} />
                      </span>
                      <span>{snapshot.plotProgress.tension}</span>
                    </span>
                  </div>
                  {snapshot.plotProgress.currentBeat && (
                    <div className="text-gray-300 mt-0.5">{snapshot.plotProgress.currentBeat}</div>
                  )}
                </div>
              )}
              {snapshot.charactersInScene && snapshot.charactersInScene.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-primary-400/80 mb-0.5">Present</div>
                  <div className="flex flex-wrap gap-1">
                    {snapshot.charactersInScene.map(c => (
                      <span key={c} className="px-2 py-0.5 bg-primary-900/50 border border-primary-800/60 rounded-full text-xs text-primary-100">{c}</span>
                    ))}
                  </div>
                </div>
              )}
              {snapshot.worldFacts && snapshot.worldFacts.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-primary-400/80 mb-0.5">World facts</div>
                  <ul className="list-disc list-inside text-gray-300 space-y-0.5">
                    {snapshot.worldFacts.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {innerStateEntries.length > 0 && (
        <>
          <button
            onClick={() => setInnerExpanded(e => !e)}
            className="w-full flex items-center justify-between gap-2 text-left pt-2 border-t border-primary-900/40"
            aria-expanded={innerExpanded}
          >
            <span className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-semibold text-primary-300">Inner states</span>
              <span className="text-gray-400 text-xs">({innerStateEntries.length})</span>
            </span>
            <span className="text-primary-300 text-xs flex-shrink-0">{innerExpanded ? '▲' : '▼'}</span>
          </button>

          {innerExpanded && (
            <div className="space-y-2">
              {innerStateEntries.map(s => (
                <div key={s.characterId} className="p-2 border border-primary-900/40 rounded bg-gray-900/30">
                  <div className="text-xs font-semibold text-primary-200 mb-1">{s.characterId}</div>
                  {s.emotionalState && (
                    <div className="text-xs text-gray-300"><span className="text-primary-400/80">mood:</span> {s.emotionalState}</div>
                  )}
                  {s.currentPriority && (
                    <div className="text-xs text-gray-300"><span className="text-primary-400/80">priority:</span> {s.currentPriority}</div>
                  )}
                  {s.hiddenAgenda && (
                    <div className="text-xs text-gray-300"><span className="text-primary-400/80">hidden:</span> {s.hiddenAgenda}</div>
                  )}
                  {s.beliefsAboutOthers && Object.keys(s.beliefsAboutOthers).length > 0 && (
                    <details className="text-xs text-gray-400 mt-1">
                      <summary className="cursor-pointer hover:text-primary-300">beliefs ({Object.keys(s.beliefsAboutOthers).length})</summary>
                      <ul className="ml-3 mt-1 space-y-0.5">
                        {Object.entries(s.beliefsAboutOthers).map(([k, v]) => (
                          <li key={k}><span className="text-primary-400/80">{k}:</span> {v}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default WorldStatePanel;
