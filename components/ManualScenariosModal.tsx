import React, { useState } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { ArrowPathIcon } from './icons/ArrowPathIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import PromptEditorOverlay from './PromptEditorOverlay';
import { ManualScenario } from '../types';
import {
  codeManualScenariosFor,
  syncManualScenariosWithCode,
  reorderManualScenariosToCode,
  isManualScenarioOrderCanonical,
} from '../services/common/manualScenarioSync';

interface ManualScenariosModalProps {
  isVisible: boolean;
  onClose: () => void;
  characterId: string;
  scenarios: ManualScenario[];
  activeIds: string[];
  onToggle: (id: string) => void;
  /** Persist a changed scenario list (create/edit/delete/reorder/resync). */
  onChangeScenarios: (next: ManualScenario[]) => void;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
  themeColor: string;
}

const approxTokens = (s: string) => Math.round((s?.length ?? 0) / 4);

const ScenarioRow: React.FC<{
  scenario: ManualScenario;
  isActive: boolean;
  isFromCode: boolean;
  isEditing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onRename: (name: string) => void;
  onEditContent: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}> = ({
  scenario, isActive, isFromCode, isEditing, canMoveUp, canMoveDown,
  onToggle, onStartEdit, onStopEdit, onRename, onEditContent, onDelete, onMove,
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-800/60 last:border-b-0">
      <div className="w-full p-3 flex items-center gap-1.5">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex-grow min-w-0 text-left flex items-start gap-2 hover:bg-gray-800/40 transition-colors rounded-md -m-1 p-1"
          aria-expanded={open}
        >
          <span className="text-gray-500 mt-0.5 flex-shrink-0 w-4">{open ? '▾' : '▸'}</span>
          <div className="flex-grow min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`font-semibold break-words ${isActive ? 'text-primary-300' : 'text-gray-100'}`}>
                {scenario.name || scenario.id}
              </span>
              <span className="text-[11px] text-gray-500">~{approxTokens(scenario.content)} tok</span>
              {!isFromCode && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                  custom
                </span>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => onMove(-1)}
            disabled={!canMoveUp}
            className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 disabled:hover:text-gray-500 transition-colors"
            aria-label="Move up"
          >
            <ChevronUpIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={!canMoveDown}
            className="p-1.5 text-gray-500 hover:text-white disabled:opacity-30 disabled:hover:text-gray-500 transition-colors"
            aria-label="Move down"
          >
            <ChevronDownIcon className="w-4 h-4" />
          </button>
          <button
            onClick={isEditing ? onStopEdit : onStartEdit}
            className={`p-1.5 transition-colors ${isEditing ? 'text-primary-300' : 'text-gray-500 hover:text-white'}`}
            aria-label={`Edit scenario: ${scenario.name || scenario.id}`}
          >
            <PencilSquareIcon className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
            aria-label={`Delete scenario: ${scenario.name || scenario.id}`}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
          <label className="toggle-switch ml-1">
            <input
              type="checkbox"
              checked={isActive}
              onChange={onToggle}
              aria-label={`Toggle scenario: ${scenario.name || scenario.id}`}
            />
            <span className="slider"></span>
          </label>
        </div>
      </div>
      {isEditing && (
        <div className="mx-3 mb-3 p-3 bg-gray-800/60 rounded-md border border-gray-700 space-y-2">
          <label className="block text-[11px] uppercase tracking-wide text-gray-500">Name</label>
          <input
            type="text"
            value={scenario.name}
            onChange={(e) => onRename(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
            placeholder="Scenario name"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onEditContent}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-800 text-primary-300 rounded-md border border-primary-800 hover:bg-primary-900/30 transition-colors"
            >
              <PencilSquareIcon className="w-4 h-4" /> Edit Content
            </button>
            <button
              onClick={onStopEdit}
              className="px-3 py-1.5 text-sm bg-gray-800 text-gray-300 rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
      {open && !isEditing && (
        <pre className="mx-3 mb-3 p-3 bg-gray-800 rounded-md text-xs text-gray-300 whitespace-pre-wrap break-words custom-scrollbar">
          {scenario.content || '(empty)'}
        </pre>
      )}
    </div>
  );
};

const ManualScenariosModal: React.FC<ManualScenariosModalProps> = ({
  isVisible, onClose, characterId, scenarios, activeIds, onToggle, onChangeScenarios, onNotify, themeColor,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contentEditorId, setContentEditorId] = useState<string | null>(null);

  if (!isVisible) return null;

  const activeSet = new Set(activeIds);
  const activeTokens = scenarios
    .filter(s => activeSet.has(s.id))
    .reduce((sum, s) => sum + approxTokens(s.content), 0);
  const codeIds = new Set(codeManualScenariosFor(characterId).map(s => s.id));
  const contentEditorScenario = contentEditorId ? scenarios.find(s => s.id === contentEditorId) : undefined;

  const updateScenario = (id: string, patch: Partial<ManualScenario>) => {
    onChangeScenarios(scenarios.map(s => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleAdd = () => {
    const fresh: ManualScenario = { id: crypto.randomUUID(), name: 'New Scenario', content: '' };
    onChangeScenarios([...scenarios, fresh]);
    setEditingId(fresh.id);
  };

  const handleDelete = (scenario: ManualScenario) => {
    if (scenario.content.trim() && !window.confirm(`Delete scenario "${scenario.name || scenario.id}"?`)) return;
    onChangeScenarios(scenarios.filter(s => s.id !== scenario.id));
    if (editingId === scenario.id) setEditingId(null);
  };

  // Resync with the code catalog (manualScenarioCatalog.ts) — same semantics as
  // API preset Resync: append missing code scenarios, restore drifted ones,
  // never touch user-created scenarios.
  const handleResync = () => {
    const { scenarios: synced, added, updated } = syncManualScenariosWithCode(characterId, scenarios);
    if (added.length === 0 && updated.length === 0) {
      onNotify?.('Scenarios already match code.', 'info');
      return;
    }
    onChangeScenarios(synced);
    const parts: string[] = [];
    if (added.length) parts.push(`added ${added.length}`);
    if (updated.length) parts.push(`restored ${updated.length}`);
    onNotify?.(`Synced with code: ${parts.join(', ')}.`, 'success');
  };

  const handleAutoOrder = () => {
    if (isManualScenarioOrderCanonical(characterId, scenarios)) {
      onNotify?.('Scenarios are already in code order.', 'info');
      return;
    }
    onChangeScenarios(reorderManualScenariosToCode(characterId, scenarios));
    onNotify?.('Reordered to match code. Custom scenarios moved to the bottom.', 'success');
  };

  const handleMove = (id: string, dir: -1 | 1) => {
    const idx = scenarios.findIndex(s => s.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= scenarios.length) return;
    const next = [...scenarios];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChangeScenarios(next);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4">
      <div
        className="bg-gray-900 max-w-3xl w-full h-[92vh] sm:h-[90vh] flex flex-col rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center gap-2 p-4 border-b border-primary-800/50 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-primary-500" style={{ fontFamily: 'serif' }}>Scenarios</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {activeSet.size} of {scenarios.length} active · ~{activeTokens} tokens
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            <button
              onClick={handleResync}
              title="Add scenarios declared in manualScenarioCatalog.ts and restore their text from code"
              className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-gray-800 text-gray-300 rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
            >
              <ArrowPathIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Resync</span>
            </button>
            <button
              onClick={handleAutoOrder}
              title="Reorder to match code; custom scenarios go to the bottom"
              className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-gray-800 text-gray-300 rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
            >
              <ChevronDownIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Auto-order</span>
            </button>
            <button
              onClick={handleAdd}
              className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-gray-800 text-primary-300 rounded-md border border-primary-800 hover:bg-primary-900/30 transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Add</span>
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="Close">
              <XMarkIcon className="h-7 w-7" />
            </button>
          </div>
        </div>

        <div className="flex-grow p-3 sm:p-4 overflow-y-auto custom-scrollbar">
          <p className="px-1 text-[11px] text-gray-500 mb-2">
            Hand-picked story hooks. Toggled scenarios are appended to the end of the prompt every
            turn (cache-safe) until you switch them off. They never trigger on their own.
          </p>
          {scenarios.length === 0 ? (
            <div className="flex items-center justify-center h-[60%] text-center text-gray-500 px-6">
              No scenarios yet — click Add to create one for this character.
            </div>
          ) : (
            <div className="rounded-lg border border-gray-800 overflow-hidden bg-gray-900/40">
              {scenarios.map((s, index) => (
                <ScenarioRow
                  key={s.id}
                  scenario={s}
                  isActive={activeSet.has(s.id)}
                  isFromCode={codeIds.has(s.id)}
                  isEditing={editingId === s.id}
                  canMoveUp={index > 0}
                  canMoveDown={index < scenarios.length - 1}
                  onToggle={() => onToggle(s.id)}
                  onStartEdit={() => setEditingId(s.id)}
                  onStopEdit={() => setEditingId(null)}
                  onRename={(name) => updateScenario(s.id, { name })}
                  onEditContent={() => setContentEditorId(s.id)}
                  onDelete={() => handleDelete(s)}
                  onMove={(dir) => handleMove(s.id, dir)}
                />
              ))}
            </div>
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

      <PromptEditorOverlay
        isOpen={!!contentEditorScenario}
        title={`Scenario — ${contentEditorScenario?.name || contentEditorScenario?.id || ''}`}
        value={contentEditorScenario?.content ?? ''}
        defaultValue={
          (contentEditorScenario &&
            codeManualScenariosFor(characterId).find(s => s.id === contentEditorScenario.id)?.content) ||
          ''
        }
        onSave={(next) => {
          if (contentEditorScenario) updateScenario(contentEditorScenario.id, { content: next });
          setContentEditorId(null);
        }}
        onClose={() => setContentEditorId(null)}
      />
    </div>
  );
};

export default ManualScenariosModal;
