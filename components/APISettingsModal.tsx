import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { TrashIcon } from './icons/TrashIcon';
import { PlusIcon } from './icons/PlusIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { ClipboardDocumentCheckIcon } from './icons/ClipboardDocumentCheckIcon';
import { ArrowPathIcon } from './icons/ArrowPathIcon';
import { GeminiApiKey, GeminiKeyTier, GeminiPreset, GeminiSettings, GeminiThinkingLevel, ProxySettings, ProxyPreset } from '../types';
import { DEFAULT_PROXY_MODEL, DEFAULT_PROXY_URL, DEFAULT_PROXY_API_KEY, DEFAULT_GEMINI_API_MODEL, DEFAULT_GEMINI_THINKING_LEVEL, GEMINI_MODEL_FLASH, GEMINI_MODEL_FLASH_37, GEMINI_MODEL_FLASH_LITE, GEMINI_MODEL_PRO } from '../constants';
import { testProxyConnection } from '../services/proxy/testConnection';
import { testGeminiConnection } from '../services/gemini/testConnection';
import { DEFAULT_CUSTOM_PROMPT, customPromptOrDefault } from '../services/common/systemPrompt';
import { buildGeminiConfigFromPreset } from '../services/common/geminiPreset';
import PromptEditorOverlay from './PromptEditorOverlay';
import { CodeBracketIcon } from './icons/CodeBracketIcon';
import { ArrowsPointingOutIcon } from './icons/ArrowsPointingOutIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { MODEL_BLOCKS, MODEL_BLOCK_GROUPS, PROMPT_BLOCKS, buildPresetFromBlocks, modelPresetBaseName } from '../builderBlocks';
import { syncProxyPresetsWithCode, reorderProxyPresetsToCode, isProxyPresetOrderCanonical } from '../services/common/proxyPresetSync';
import { syncGeminiPresetsWithCode, reorderGeminiPresetsToCode, isGeminiPresetOrderCanonical } from '../services/common/geminiPresetSync';

interface APISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: { provider: 'gemini' | 'proxy'; proxyConfig: ProxySettings; geminiConfig: GeminiSettings; replaceModels: boolean; }) => void;
  initialProvider: 'gemini' | 'proxy';
  initialProxySettings?: ProxySettings;
  initialProxyPresets?: ProxyPreset[];
  onSavePresets?: (presets: ProxyPreset[]) => void;
  initialGeminiSettings?: GeminiSettings;
  initialGeminiApiKeys?: GeminiApiKey[];
  initialGeminiPresets?: GeminiPreset[];
  onSaveGeminiApiKeys?: (keys: GeminiApiKey[]) => void;
  onSaveGeminiPresets?: (presets: GeminiPreset[]) => void;
  initialReplaceAgentModels: boolean;
  defaultCustomPrompt?: string;
  themeColor: string;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface JsonParam {
    id: string;
    key: string;
    value: string | JsonParam[];
    type: 'string' | 'number' | 'boolean' | 'object';
}

type CardMode = 'view' | 'edit' | 'json';

const emptyPreset = (customPrompt: string = DEFAULT_CUSTOM_PROMPT): ProxyPreset => ({
    id: crypto.randomUUID(),
    name: '',
    model: '',
    proxyUrl: '',
    apiKey: '',
    extraParams: '',
    customPrompt,
    includeThinkingInHistory: false,
});

const emptyGeminiKey = (): GeminiApiKey => ({
    id: crypto.randomUUID(),
    name: '',
    apiKey: '',
    tier: 'paid'
});

const emptyGeminiPreset = (apiKeyId: string, customPrompt: string = DEFAULT_CUSTOM_PROMPT): GeminiPreset => ({
    id: crypto.randomUUID(),
    name: '',
    model: GEMINI_MODEL_FLASH,
    apiKeyId,
    thinkingLevel: DEFAULT_GEMINI_THINKING_LEVEL,
    extraParams: '',
    customPrompt,
});

const THINKING_LEVEL_OPTIONS: { value: GeminiThinkingLevel; label: string; hint: string }[] = [
    { value: 'minimal', label: 'Minimal', hint: 'Almost no thinking. Lowest latency. Not supported on Gemini 3.1 Pro.' },
    { value: 'low',     label: 'Low',     hint: 'Cheap & fast. Simple instructions, chat.' },
    { value: 'medium',  label: 'Medium',  hint: 'Balanced. Default for 3.5 Flash.' },
    { value: 'high',    label: 'High',    hint: 'Max reasoning depth. Default for 3.1 Pro & 3 Flash.' },
];

const geminiSettingsMatchPreset = (settings: GeminiSettings | undefined, preset: GeminiPreset, keys: GeminiApiKey[]): boolean => {
    if (!settings) return false;
    const presetKey = keys.find(k => k.id === preset.apiKeyId);
    return settings.presetId === preset.id || (
        settings.model === preset.model &&
        (settings.apiKeyId === preset.apiKeyId || (!!presetKey?.apiKey && settings.apiKey === presetKey.apiKey)) &&
        (settings.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL) === (preset.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL) &&
        (settings.extraParams ?? '') === (preset.extraParams ?? '') &&
        customPromptOrDefault(settings.customPrompt) === customPromptOrDefault(preset.customPrompt)
    );
};

const parseParams = (jsonStr: string): JsonParam[] => {
    try {
        if (!jsonStr || jsonStr.trim() === '') return [];
        const obj = JSON.parse(jsonStr);
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [];

        const mapValue = (v: any): { value: string | JsonParam[], type: 'string' | 'number' | 'boolean' | 'object' } => {
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                return {
                    type: 'object',
                    value: Object.entries(v).map(([k, subV]) => ({
                        id: crypto.randomUUID(),
                        key: k,
                        ...mapValue(subV)
                    }))
                };
            }
            if (typeof v === 'number') return { type: 'number', value: String(v) };
            if (typeof v === 'boolean') return { type: 'boolean', value: String(v) };
            return { type: 'string', value: String(v) };
        };

        return Object.entries(obj).map(([key, val]) => ({
            id: crypto.randomUUID(),
            key,
            ...mapValue(val)
        }));
    } catch {
        return [];
    }
};

const buildJson = (params: JsonParam[]): string => {
    const buildObj = (items: JsonParam[]): any => {
        const obj: any = {};
        items.forEach(item => {
            if (!item.key.trim()) return;
            if (item.type === 'object') {
                const childObj = buildObj(item.value as JsonParam[]);
                if (Object.keys(childObj).length > 0) obj[item.key] = childObj;
            } else if (item.type === 'number') {
                const num = Number(item.value);
                if (!isNaN(num)) obj[item.key] = num;
            } else if (item.type === 'boolean') {
                obj[item.key] = item.value === 'true';
            } else {
                obj[item.key] = item.value;
            }
        });
        return obj;
    };
    return JSON.stringify(buildObj(params), null, 2);
};

const ParameterBuilder: React.FC<{ items: JsonParam[], onChange: (items: JsonParam[]) => void, themeColor: string, depth?: number }> = ({ items, onChange, themeColor, depth = 0 }) => {
    const handleAdd = () => {
        onChange([...items, { id: crypto.randomUUID(), key: '', value: '', type: 'string' }]);
    };

    const handleChange = (id: string, field: keyof JsonParam, val: any) => {
        onChange(items.map(item => {
            if (item.id === id) {
                const updated = { ...item, [field]: val };
                if (field === 'type') {
                    if (val === 'object') updated.value = [];
                    else if (val === 'boolean') updated.value = 'true';
                    else updated.value = '';
                }
                return updated;
            }
            return item;
        }));
    };

    const handleDelete = (id: string) => {
        onChange(items.filter(item => item.id !== id));
    };

    return (
        <div className={`flex flex-col gap-2 w-full ${depth > 0 ? `pl-3 border-l-2 border-primary-800/50 mt-2` : ''}`}>
            {items.map(item => (
                <div key={item.id} className="flex flex-col gap-2 bg-black/20 p-2 rounded-md border border-gray-700/50">
                    <div className="flex flex-wrap items-start gap-2">
                        <input
                            type="text"
                            placeholder="Key"
                            value={item.key}
                            onChange={e => handleChange(item.id, 'key', e.target.value)}
                            className={`flex-1 min-w-[120px] bg-gray-800 rounded border border-gray-600 text-white px-2 py-1 text-sm focus:border-primary-500 focus:outline-none`}
                        />
                        <select
                            value={item.type}
                            onChange={e => handleChange(item.id, 'type', e.target.value)}
                            className={`bg-gray-800 rounded border border-gray-600 text-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none`}
                        >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Bool</option>
                            <option value="object">Object</option>
                        </select>
                        <button
                            onClick={() => handleDelete(item.id)}
                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-700/50 rounded transition-colors"
                            aria-label="Delete parameter"
                        >
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>

                    {item.type === 'object' ? (
                        <ParameterBuilder
                            items={item.value as JsonParam[]}
                            onChange={(newVal) => handleChange(item.id, 'value', newVal)}
                            themeColor={themeColor}
                            depth={depth + 1}
                        />
                    ) : (
                        <div className="w-full">
                            {item.type === 'boolean' ? (
                                <select
                                    value={String(item.value)}
                                    onChange={e => handleChange(item.id, 'value', e.target.value)}
                                    className={`w-full bg-gray-900 rounded border border-gray-700 text-white px-2 py-1 text-sm focus:border-primary-500 focus:outline-none`}
                                >
                                    <option value="true">True</option>
                                    <option value="false">False</option>
                                </select>
                            ) : (
                                <input
                                    type={item.type === 'number' ? 'number' : 'text'}
                                    placeholder="Value"
                                    value={String(item.value)}
                                    onChange={e => handleChange(item.id, 'value', e.target.value)}
                                    className={`w-full bg-gray-900 rounded border border-gray-700 text-white px-2 py-1 text-sm focus:border-primary-500 focus:outline-none`}
                                />
                            )}
                        </div>
                    )}
                </div>
            ))}
            <button
                onClick={handleAdd}
                className={`flex items-center justify-center gap-2 w-full py-1.5 rounded-md border border-dashed border-gray-600 text-gray-400 hover:text-primary-300 hover:border-primary-500/50 hover:bg-primary-900/20 text-sm transition-all`}
            >
                <PlusIcon className="w-4 h-4" />
                Add Parameter
            </button>
        </div>
    );
};

const maskKey = (key: string): string => {
    if (!key) return '';
    if (key.length <= 8) return '•'.repeat(key.length);
    return '•'.repeat(7);
};

interface ActionButtonProps {
    onClick: (e: React.MouseEvent) => void;
    icon: React.ReactNode;
    label: string;
    danger?: boolean;
    active?: boolean;
    disabled?: boolean;
    themeColor: string;
}
const ActionButton: React.FC<ActionButtonProps> = ({ onClick, icon, label, danger, active, disabled, themeColor }) => {
    const base = "flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors min-w-[72px] flex-1 sm:flex-initial";
    let cls: string;
    if (disabled) {
        cls = `${base} bg-gray-800/50 text-gray-600 border-gray-700/50 cursor-not-allowed`;
    } else if (danger) {
        cls = `${base} bg-gray-800 text-gray-300 border-gray-700 hover:bg-red-900/40 hover:text-red-300 hover:border-red-700/60`;
    } else if (active) {
        cls = `${base} bg-primary-700/40 text-primary-200 border-primary-500/60`;
    } else {
        cls = `${base} bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 hover:text-white`;
    }
    return (
        <button onClick={onClick} disabled={disabled} className={cls} aria-label={label}>
            {icon}
            <span>{label}</span>
        </button>
    );
};

interface TestResult { status: 'idle' | 'loading' | 'ok' | 'error'; message?: string; }

const runProxyTest = async (preset: ProxyPreset, signal: AbortSignal): Promise<TestResult> => {
    const result = await testProxyConnection(
        {
            model: preset.model,
            proxyUrl: preset.proxyUrl,
            apiKey: preset.apiKey,
            extraParams: preset.extraParams,
        },
        signal,
    );
    if (signal.aborted) return { status: 'idle' };
    return result.ok
        ? { status: 'ok', message: 'OK' }
        : { status: 'error', message: result.message };
};

const runGeminiTest = async (preset: GeminiPreset, keys: GeminiApiKey[], signal: AbortSignal): Promise<TestResult> => {
    const result = await testGeminiConnection(buildGeminiConfigFromPreset(preset, keys), signal);
    if (signal.aborted) return { status: 'idle' };
    return result.ok
        ? { status: 'ok', message: 'OK' }
        : { status: 'error', message: result.message };
};

const inputCls = (themeColor: string) =>
    `w-full bg-gray-800 rounded-md border border-primary-900/70 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 px-2 py-1.5 text-sm`;

const Field: React.FC<{ label: string; themeColor: string; children: React.ReactNode }> = ({ label, themeColor, children }) => (
    <div>
        <label className={`block text-xs font-medium text-primary-200/80 mb-1 uppercase tracking-wide`}>{label}</label>
        {children}
    </div>
);

// Textarea that grows with its content and never scrolls internally, so the
// mouse wheel / touch drag over it always scrolls the modal body instead of
// getting trapped in a nested scroll area.
const AutoGrowTextarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className, value, ...rest }) => {
    const ref = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const ta = ref.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight}px`;
    }, [value]);
    return (
        <textarea
            ref={ref}
            rows={1}
            value={value}
            {...rest}
            className={`${className ?? ''} overflow-hidden resize-none`}
        />
    );
};

// Inline, immediately-editable prompt field. The full-screen editor stays one
// small link away in the label row so it never clutters the form itself.
const PromptField: React.FC<{
    value: string;
    placeholder: string;
    themeColor: string;
    onChange: (next: string) => void;
    onOpenEditor: () => void;
}> = ({ value, placeholder, themeColor, onChange, onOpenEditor }) => (
    <div>
        <div className="flex items-center justify-between gap-2 mb-1">
            <label className="block text-xs font-medium text-primary-200/80 uppercase tracking-wide">Custom Prompt</label>
            <button
                type="button"
                onClick={onOpenEditor}
                className="flex items-center gap-1 text-[11px] font-semibold text-primary-300 hover:text-primary-200 transition-colors"
                title="Open the full-screen prompt editor"
            >
                <ArrowsPointingOutIcon className="w-3.5 h-3.5" />
                Fullscreen
            </button>
        </div>
        <AutoGrowTextarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`${inputCls(themeColor)} min-h-[120px] leading-relaxed`}
        />
    </div>
);

interface PresetCardProps {
    preset: ProxyPreset;
    isActive: boolean;
    isOpen: boolean;
    mode: CardMode;
    canDelete: boolean;
    themeColor: string;
    testResult: TestResult;
    onSelect: () => void;
    onChange: (next: ProxyPreset) => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onSetMode: (m: CardMode) => void;
    onTest: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
    defaultCustomPrompt: string;
}

const PresetCard: React.FC<PresetCardProps> = ({
    preset, isActive, isOpen, mode, canDelete, themeColor, testResult,
    onSelect, onChange, onDelete, onDuplicate, onSetMode, onTest,
    onMoveUp, onMoveDown, canMoveUp, canMoveDown, defaultCustomPrompt,
}) => {
    const [jsonParams, setJsonParams] = useState<JsonParam[]>(() => parseParams(preset.extraParams || ''));
    const [rawJson, setRawJson] = useState<string>(preset.extraParams || '');
    const [jsonTab, setJsonTab] = useState<'builder' | 'raw'>('builder');
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);

    // Resync JSON editors when opening JSON mode or switching to a different preset's data.
    useEffect(() => {
        if (mode === 'json') {
            setRawJson(preset.extraParams || '');
            setJsonParams(parseParams(preset.extraParams || ''));
            setJsonError(null);
        }
    }, [mode, preset.id]);

    const updateField = (patch: Partial<ProxyPreset>) => onChange({ ...preset, ...patch });

    const handleJsonParamsChange = (next: JsonParam[]) => {
        setJsonParams(next);
        const built = buildJson(next);
        updateField({ extraParams: built === '{}' ? '' : built });
    };

    const handleRawJsonChange = (next: string) => {
        setRawJson(next);
        setJsonError(null);
        if (!next.trim()) {
            updateField({ extraParams: '' });
            return;
        }
        try {
            const parsed = JSON.parse(next);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                setJsonError("JSON must be an object.");
                return;
            }
            updateField({ extraParams: next });
        } catch {
            setJsonError("Invalid JSON syntax.");
        }
    };

    const switchJsonTab = (tab: 'builder' | 'raw') => {
        if (tab === 'raw') {
            const built = buildJson(jsonParams);
            setRawJson(built === '{}' ? '' : built);
        } else {
            setJsonParams(parseParams(rawJson));
        }
        setJsonTab(tab);
        setJsonError(null);
    };

    const borderCls = isActive ? `border-primary-500` : 'border-gray-700';
    const bgCls = isActive ? `bg-primary-900/10` : 'bg-gray-900/50';

    return (
        <div className={`border ${borderCls} ${bgCls} rounded-lg overflow-hidden transition-all`}>
            {/* Header — click name to select+open; reorder arrows sit alongside (kept
                as sibling buttons, not nested, so the row stays valid markup). */}
            <div className="w-full flex items-center gap-1.5 p-3 sm:p-4 hover:bg-gray-800/40 transition-colors">
                <button
                    type="button"
                    onClick={onSelect}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                    {isActive && <span className={`w-2 h-2 rounded-full bg-primary-400 flex-shrink-0`} aria-label="Active" />}
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className="flex items-center gap-2 min-w-0">
                            <span className="font-semibold text-white truncate">{preset.name || <span className="italic text-gray-500">Untitled</span>}</span>
                            {preset.includeThinkingInHistory && (
                                <span className="flex-shrink-0 rounded border border-amber-500/50 bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                                    Thinking history ON
                                </span>
                            )}
                        </span>
                        {preset.model && (
                            <span className="text-xs text-gray-400 truncate mt-0.5 font-mono">{preset.model}</span>
                        )}
                    </div>
                </button>
                <div className="flex items-center flex-shrink-0">
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
                        disabled={!canMoveUp}
                        aria-label="Move up"
                        className="p-1 text-gray-500 hover:text-primary-300 disabled:opacity-25 disabled:hover:text-gray-500 rounded transition-colors"
                    >
                        <ChevronUpIcon className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
                        disabled={!canMoveDown}
                        aria-label="Move down"
                        className="p-1 text-gray-500 hover:text-primary-300 disabled:opacity-25 disabled:hover:text-gray-500 rounded transition-colors"
                    >
                        <ChevronDownIcon className="w-4 h-4" />
                    </button>
                </div>
                <button
                    type="button"
                    onClick={onSelect}
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                    className="flex-shrink-0 p-0.5"
                >
                    <svg className={`w-5 h-5 text-gray-500 transform transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
            </div>

            {isOpen && (
                <div className="px-3 sm:px-4 pb-4 border-t border-gray-700/60 bg-gray-800/20">
                    {mode === 'view' && (
                        <div className="space-y-3 pt-3">
                            <div className="flex items-baseline gap-2 text-sm">
                                <span className={`text-primary-300/80 font-medium w-12 flex-shrink-0`}>URL</span>
                                <span className="text-gray-300 font-mono text-xs sm:text-sm truncate" title={preset.proxyUrl}>
                                    {preset.proxyUrl || <span className="italic text-gray-500">not set</span>}
                                </span>
                            </div>
                            <div className="flex items-baseline gap-2 text-sm">
                                <span className={`text-primary-300/80 font-medium w-12 flex-shrink-0`}>Key</span>
                                <span className="text-gray-300 font-mono text-xs sm:text-sm tracking-wider">
                                    {preset.apiKey ? maskKey(preset.apiKey) : <span className="italic text-gray-500">not set</span>}
                                </span>
                            </div>
                            <div className="flex items-baseline gap-2 text-sm">
                                <span className={`text-primary-300/80 font-medium w-12 flex-shrink-0`}>Think</span>
                                <span className={preset.includeThinkingInHistory ? 'text-amber-300 font-semibold' : 'text-gray-500'}>
                                    {preset.includeThinkingInHistory ? 'Included in story history' : 'Stripped from story history'}
                                </span>
                            </div>
                            {testResult.status !== 'idle' && (
                                <div className={`text-xs px-2 py-1.5 rounded ${
                                    testResult.status === 'ok' ? 'bg-green-900/40 text-green-300 border border-green-700/40' :
                                    testResult.status === 'error' ? 'bg-red-900/40 text-red-300 border border-red-700/40' :
                                    'bg-gray-800 text-gray-400 border border-gray-700'
                                }`}>
                                    {testResult.status === 'loading' && 'Testing…'}
                                    {testResult.status === 'ok' && '✓ Connection OK'}
                                    {testResult.status === 'error' && `✗ ${testResult.message}`}
                                </div>
                            )}

                            <div className="flex flex-wrap gap-2 pt-2">
                                <ActionButton
                                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                                    icon={<TrashIcon className="w-3.5 h-3.5" />}
                                    label="Delete"
                                    danger
                                    disabled={!canDelete}
                                    themeColor={themeColor}
                                />
                                <ActionButton
                                    onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
                                    icon={<ClipboardDocumentCheckIcon className="w-3.5 h-3.5" />}
                                    label="Duplicate"
                                    themeColor={themeColor}
                                />
                                <ActionButton
                                    onClick={(e) => { e.stopPropagation(); onSetMode('edit'); }}
                                    icon={<PencilSquareIcon className="w-3.5 h-3.5" />}
                                    label="Edit"
                                    themeColor={themeColor}
                                />
                                <ActionButton
                                    onClick={(e) => { e.stopPropagation(); onTest(); }}
                                    icon={<ArrowPathIcon className={`w-3.5 h-3.5 ${testResult.status === 'loading' ? 'animate-spin' : ''}`} />}
                                    label="Test"
                                    themeColor={themeColor}
                                    disabled={testResult.status === 'loading'}
                                />
                                <ActionButton
                                    onClick={(e) => { e.stopPropagation(); onSetMode('json'); }}
                                    icon={<CodeBracketIcon className="w-3.5 h-3.5" />}
                                    label="JSON"
                                    themeColor={themeColor}
                                />
                            </div>
                        </div>
                    )}

                    {mode === 'edit' && (
                        <div className="pt-3" onClick={(e) => e.stopPropagation()}>
                            {/* No nested scroll area here: an inner scroller + overscroll-contain used to
                                swallow wheel/touch scrolling ("locked" feeling). The form flows in the
                                modal's own scroll body, and the prompt textarea auto-grows so nothing
                                inside traps scroll events. */}
                            <div className="space-y-3">
                                <Field label="Name" themeColor={themeColor}>
                                    <input
                                        type="text"
                                        value={preset.name}
                                        onChange={(e) => updateField({ name: e.target.value })}
                                        className={inputCls(themeColor)}
                                    />
                                </Field>
                                <Field label="Model" themeColor={themeColor}>
                                    <input
                                        type="text"
                                        value={preset.model}
                                        onChange={(e) => updateField({ model: e.target.value })}
                                        placeholder={DEFAULT_PROXY_MODEL}
                                        className={inputCls(themeColor)}
                                    />
                                </Field>
                                <Field label="Proxy URL" themeColor={themeColor}>
                                    <input
                                        type="text"
                                        inputMode="url"
                                        value={preset.proxyUrl}
                                        onChange={(e) => updateField({ proxyUrl: e.target.value })}
                                        placeholder={DEFAULT_PROXY_URL}
                                        className={inputCls(themeColor)}
                                    />
                                </Field>
                                <Field label="API Key" themeColor={themeColor}>
                                    <input
                                        type="text"
                                        value={preset.apiKey}
                                        onChange={(e) => updateField({ apiKey: e.target.value })}
                                        placeholder="sk-..."
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck={false}
                                        className={`${inputCls(themeColor)} font-mono`}
                                    />
                                </Field>
                                <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
                                    <div className="flex items-center justify-between gap-4">
                                        <label htmlFor={`include-thinking-${preset.id}`} className="min-w-0 flex-1">
                                            <span className="font-semibold text-white">Include thinking in story history</span>
                                            <p className="mt-1 text-xs leading-snug text-gray-400">
                                                Sends previous assistant &lt;think&gt; blocks back to this preset. Keep off unless the selected model requires interleaved thinking (typically Kimi or MiniMax).
                                            </p>
                                        </label>
                                        <label className="toggle-switch flex-shrink-0">
                                            <input
                                                id={`include-thinking-${preset.id}`}
                                                type="checkbox"
                                                checked={preset.includeThinkingInHistory === true}
                                                onChange={(event) => updateField({ includeThinkingInHistory: event.target.checked })}
                                            />
                                            <span className="slider"></span>
                                        </label>
                                    </div>
                                    {preset.includeThinkingInHistory && (
                                        <p className="mt-2 text-xs leading-snug text-amber-300/90">
                                            ON for this preset: reasoning uses extra context tokens and may expose hidden model output to later story calls.
                                        </p>
                                    )}
                                </div>
                                <PromptField
                                    value={preset.customPrompt ?? defaultCustomPrompt}
                                    placeholder={defaultCustomPrompt}
                                    themeColor={themeColor}
                                    onChange={(next) => updateField({ customPrompt: next })}
                                    onOpenEditor={() => setIsPromptEditorOpen(true)}
                                />
                            </div>
                            <div className="flex justify-end pt-3 mt-1 border-t border-gray-700/40">
                                <button
                                    onClick={() => onSetMode('view')}
                                    className={`px-4 py-2 text-sm bg-primary-800/60 text-white rounded-md border border-primary-600/60 hover:bg-primary-700 transition-colors`}
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}

                    {mode === 'json' && (
                        <div className="space-y-2 pt-3" onClick={(e) => e.stopPropagation()}>
                            <label className={`block text-sm font-medium text-primary-200/80`}>Extra Parameters (merged into request body)</label>
                            <div className="flex gap-1 bg-gray-800 p-1 rounded-t-md border-b border-gray-700">
                                <button
                                    onClick={() => switchJsonTab('builder')}
                                    className={`flex-1 py-1.5 text-xs font-semibold rounded ${jsonTab === 'builder' ? `bg-primary-700 text-white` : 'text-gray-400 hover:bg-gray-700'}`}
                                >
                                    Builder
                                </button>
                                <button
                                    onClick={() => switchJsonTab('raw')}
                                    className={`flex-1 py-1.5 text-xs font-semibold rounded ${jsonTab === 'raw' ? `bg-primary-700 text-white` : 'text-gray-400 hover:bg-gray-700'}`}
                                >
                                    Raw JSON
                                </button>
                            </div>
                            <div className="bg-gray-900 rounded-b-md border border-t-0 border-gray-700 p-3">
                                {jsonTab === 'builder' ? (
                                    <ParameterBuilder items={jsonParams} onChange={handleJsonParamsChange} themeColor={themeColor} />
                                ) : (
                                    <AutoGrowTextarea
                                        value={rawJson}
                                        onChange={(e) => handleRawJsonChange(e.target.value)}
                                        placeholder={'{\n  "key": "value"\n}'}
                                        className={`w-full min-h-[10rem] bg-gray-900 text-gray-300 font-mono text-sm p-2 focus:outline-none focus:ring-1 focus:ring-primary-500 rounded`}
                                    />
                                )}
                            </div>
                            {jsonError && <p className="text-red-400 text-xs">{jsonError}</p>}
                            <div className="flex justify-end pt-1">
                                <button
                                    onClick={() => onSetMode('view')}
                                    className={`px-4 py-1.5 text-sm bg-primary-800/60 text-white rounded-md border border-primary-600/60 hover:bg-primary-700 transition-colors`}
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <PromptEditorOverlay
                isOpen={isPromptEditorOpen}
                title={`Custom Prompt — ${preset.name || 'Untitled'}`}
                value={preset.customPrompt ?? defaultCustomPrompt}
                defaultValue={defaultCustomPrompt}
                onSave={(next) => { updateField({ customPrompt: next }); setIsPromptEditorOpen(false); }}
                onClose={() => setIsPromptEditorOpen(false)}
            />
        </div>
    );
};

interface GeminiKeyRowProps {
    apiKey: GeminiApiKey;
    canDelete: boolean;
    themeColor: string;
    onChange: (next: GeminiApiKey) => void;
    onDelete: () => void;
}

const GeminiKeyRow: React.FC<GeminiKeyRowProps> = ({ apiKey, canDelete, themeColor, onChange, onDelete }) => {
    const [isOpen, setIsOpen] = useState(false);
    const updateField = (patch: Partial<GeminiApiKey>) => onChange({ ...apiKey, ...patch });

    return (
        <div className="border border-gray-700 rounded-lg bg-gray-900/50 overflow-hidden">
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-800/40 transition-colors"
            >
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-white truncate">{apiKey.name || <span className="italic text-gray-500">Untitled key</span>}</span>
                        <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${apiKey.tier === 'free' ? 'text-green-300 border-green-800 bg-green-950/30' : 'text-sky-300 border-sky-800 bg-sky-950/30'}`}>
                            {apiKey.tier}
                        </span>
                    </div>
                    <span className="text-xs text-gray-400 font-mono tracking-wider">{apiKey.apiKey ? maskKey(apiKey.apiKey) : 'not set'}</span>
                </div>
                <svg className={`w-4 h-4 text-gray-500 transform transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="px-3 pb-3 border-t border-gray-700/60 space-y-3 pt-3" onClick={(e) => e.stopPropagation()}>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                        <Field label="Key Name" themeColor={themeColor}>
                            <input
                                type="text"
                                value={apiKey.name}
                                onChange={(e) => updateField({ name: e.target.value })}
                                placeholder="RPFree"
                                className={inputCls(themeColor)}
                            />
                        </Field>
                        <Field label="Tier" themeColor={themeColor}>
                            <select
                                value={apiKey.tier}
                                onChange={(e) => updateField({ tier: e.target.value as GeminiKeyTier })}
                                className={`${inputCls(themeColor)} sm:w-28`}
                            >
                                <option value="free">Free</option>
                                <option value="paid">Paid</option>
                            </select>
                        </Field>
                    </div>
                    <Field label="API Key" themeColor={themeColor}>
                        <input
                            type="text"
                            value={apiKey.apiKey}
                            onChange={(e) => updateField({ apiKey: e.target.value })}
                            placeholder="AIza..."
                            className={inputCls(themeColor)}
                        />
                    </Field>
                    <div className="flex justify-end">
                        <button
                            onClick={onDelete}
                            disabled={!canDelete}
                            className="px-3 py-1.5 text-xs font-semibold rounded-md border bg-gray-800 text-gray-300 border-gray-700 hover:bg-red-900/40 hover:text-red-300 hover:border-red-700/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Delete Key
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

interface GeminiPresetCardProps {
    preset: GeminiPreset;
    keys: GeminiApiKey[];
    isActive: boolean;
    isOpen: boolean;
    canDelete: boolean;
    themeColor: string;
    testResult: TestResult;
    onSelect: () => void;
    onChange: (next: GeminiPreset) => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onTest: () => void;
    defaultCustomPrompt: string;
}

const GeminiPresetCard: React.FC<GeminiPresetCardProps> = ({
    preset, keys, isActive, isOpen, canDelete, themeColor, testResult,
    onSelect, onChange, onDelete, onDuplicate, onTest, defaultCustomPrompt,
}) => {
    const selectedKey = keys.find(k => k.id === preset.apiKeyId);
    const [isEditing, setIsEditing] = useState(false);
    const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
    const [rawExtraParams, setRawExtraParams] = useState<string>(preset.extraParams || '');
    const [extraParamsError, setExtraParamsError] = useState<string | null>(null);

    // Resync the raw editor when opening edit mode or switching to another preset.
    useEffect(() => {
        setRawExtraParams(preset.extraParams || '');
        setExtraParamsError(null);
    }, [isEditing, preset.id]);

    const updateField = (patch: Partial<GeminiPreset>) => onChange({ ...preset, ...patch });

    // Only commit valid JSON objects (or empty) to the preset; keep invalid text
    // visible in the textarea with an inline error, matching the proxy editor.
    const handleExtraParamsChange = (next: string) => {
        setRawExtraParams(next);
        if (!next.trim()) {
            setExtraParamsError(null);
            updateField({ extraParams: '' });
            return;
        }
        try {
            const parsed = JSON.parse(next);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                setExtraParamsError('Must be a JSON object.');
                return;
            }
            setExtraParamsError(null);
            updateField({ extraParams: next });
        } catch {
            setExtraParamsError('Invalid JSON syntax.');
        }
    };

    const borderCls = isActive ? `border-primary-500` : 'border-gray-700';
    const bgCls = isActive ? `bg-primary-900/10` : 'bg-gray-900/50';

    return (
        <div className={`border ${borderCls} ${bgCls} rounded-lg overflow-hidden transition-all`}>
            <button
                type="button"
                onClick={onSelect}
                className="w-full flex items-center gap-3 p-3 sm:p-4 text-left hover:bg-gray-800/40 transition-colors"
            >
                {isActive && <span className="w-2 h-2 rounded-full bg-primary-400 flex-shrink-0" aria-label="Active" />}
                <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-semibold text-white truncate">{preset.name || <span className="italic text-gray-500">Untitled</span>}</span>
                    <span className="text-xs text-gray-400 truncate mt-0.5 font-mono">{preset.model || 'model not set'}</span>
                </div>
                <svg className={`w-5 h-5 text-gray-500 transform transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="px-3 sm:px-4 pb-4 border-t border-gray-700/60 bg-gray-800/20">
                    {!isEditing && (
                        <div className="space-y-3 pt-3">
                            <div className="flex items-baseline gap-2 text-sm">
                                <span className="text-primary-300/80 font-medium w-16 flex-shrink-0">Key</span>
                                <span className="text-gray-300 text-xs sm:text-sm truncate">
                                    {selectedKey?.name || <span className="italic text-gray-500">missing key</span>}
                                    {selectedKey && <span className="text-gray-500"> ({selectedKey.tier})</span>}
                                </span>
                            </div>
                            <div className="flex items-baseline gap-2 text-sm">
                                <span className="text-primary-300/80 font-medium w-16 flex-shrink-0">Thinking</span>
                                <span className="text-gray-300 text-xs sm:text-sm capitalize">
                                    {preset.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL}
                                </span>
                            </div>
                            <div className="flex items-baseline gap-2 text-sm">
                                <span className="text-primary-300/80 font-medium w-16 flex-shrink-0">Params</span>
                                <span className="text-gray-300 font-mono text-xs sm:text-sm truncate" title={preset.extraParams}>
                                    {preset.extraParams?.trim() || <span className="italic text-gray-500 font-sans">none</span>}
                                </span>
                            </div>
                            <div className="flex items-baseline gap-2 text-sm">
                                <span className="text-primary-300/80 font-medium w-16 flex-shrink-0">Prompt</span>
                                <span className="text-gray-300 text-xs sm:text-sm truncate">
                                    {customPromptOrDefault(preset.customPrompt).split('\n')[0] || <span className="italic text-gray-500">empty</span>}
                                </span>
                            </div>
                            {testResult.status !== 'idle' && (
                                <div className={`text-xs px-2 py-1.5 rounded ${
                                    testResult.status === 'ok' ? 'bg-green-900/40 text-green-300 border border-green-700/40' :
                                    testResult.status === 'error' ? 'bg-red-900/40 text-red-300 border border-red-700/40' :
                                    'bg-gray-800 text-gray-400 border border-gray-700'
                                }`}>
                                    {testResult.status === 'loading' && 'Testing...'}
                                    {testResult.status === 'ok' && 'Connection OK'}
                                    {testResult.status === 'error' && testResult.message}
                                </div>
                            )}
                            <div className="flex flex-wrap gap-2 pt-2">
                                <ActionButton onClick={(e) => { e.stopPropagation(); onDelete(); }} icon={<TrashIcon className="w-3.5 h-3.5" />} label="Delete" danger disabled={!canDelete} themeColor={themeColor} />
                                <ActionButton onClick={(e) => { e.stopPropagation(); onDuplicate(); }} icon={<ClipboardDocumentCheckIcon className="w-3.5 h-3.5" />} label="Duplicate" themeColor={themeColor} />
                                <ActionButton onClick={(e) => { e.stopPropagation(); setIsEditing(true); }} icon={<PencilSquareIcon className="w-3.5 h-3.5" />} label="Edit" themeColor={themeColor} />
                                <ActionButton onClick={(e) => { e.stopPropagation(); onTest(); }} icon={<ArrowPathIcon className={`w-3.5 h-3.5 ${testResult.status === 'loading' ? 'animate-spin' : ''}`} />} label="Test" themeColor={themeColor} disabled={testResult.status === 'loading'} />
                            </div>
                        </div>
                    )}

                    {isEditing && (
                        <div className="space-y-3 pt-3" onClick={(e) => e.stopPropagation()}>
                            <Field label="Name" themeColor={themeColor}>
                                <input type="text" value={preset.name} onChange={(e) => updateField({ name: e.target.value })} className={inputCls(themeColor)} />
                            </Field>
                            <Field label="Model" themeColor={themeColor}>
                                <input
                                    list="gemini-model-options"
                                    type="text"
                                    value={preset.model}
                                    onChange={(e) => updateField({ model: e.target.value })}
                                    placeholder={GEMINI_MODEL_FLASH}
                                    className={inputCls(themeColor)}
                                />
                                <datalist id="gemini-model-options">
                                    <option value={GEMINI_MODEL_PRO} />
                                    <option value={GEMINI_MODEL_FLASH_37} />
                                    <option value={GEMINI_MODEL_FLASH} />
                                    <option value={GEMINI_MODEL_FLASH_LITE} />
                                </datalist>
                            </Field>
                            <Field label="API Key" themeColor={themeColor}>
                                <select value={preset.apiKeyId} onChange={(e) => updateField({ apiKeyId: e.target.value })} className={inputCls(themeColor)}>
                                    {keys.map(key => (
                                        <option key={key.id} value={key.id}>{key.name || 'Untitled key'} ({key.tier})</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Thinking Level" themeColor={themeColor}>
                                <select
                                    value={preset.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL}
                                    onChange={(e) => updateField({ thinkingLevel: e.target.value as GeminiThinkingLevel })}
                                    className={inputCls(themeColor)}
                                >
                                    {THINKING_LEVEL_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                                    {THINKING_LEVEL_OPTIONS.find(o => o.value === (preset.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL))?.hint}
                                </p>
                            </Field>
                            <Field label="Extra Params (JSON)" themeColor={themeColor}>
                                <AutoGrowTextarea
                                    value={rawExtraParams}
                                    onChange={(e) => handleExtraParamsChange(e.target.value)}
                                    placeholder='{"serviceTier":"flex"}'
                                    spellCheck={false}
                                    className={`${inputCls(themeColor)} min-h-[3.5rem] font-mono text-xs leading-relaxed`}
                                />
                                {extraParamsError
                                    ? <p className="text-[11px] text-red-400 mt-1 leading-snug">{extraParamsError}</p>
                                    : <p className="text-[11px] text-gray-500 mt-1 leading-snug">Merged into every request config for this preset. <code>{'{"serviceTier":"flex"}'}</code> = ~50% cheaper inference (paid keys only).</p>
                                }
                            </Field>
                            <PromptField
                                value={preset.customPrompt ?? defaultCustomPrompt}
                                placeholder={defaultCustomPrompt}
                                themeColor={themeColor}
                                onChange={(next) => updateField({ customPrompt: next })}
                                onOpenEditor={() => setIsPromptEditorOpen(true)}
                            />
                            <div className="flex justify-end pt-1">
                                <button onClick={() => setIsEditing(false)} className="px-4 py-1.5 text-sm bg-primary-800/60 text-white rounded-md border border-primary-600/60 hover:bg-primary-700 transition-colors">
                                    Done
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <PromptEditorOverlay
                isOpen={isPromptEditorOpen}
                title={`Custom Prompt — ${preset.name || 'Untitled'}`}
                value={preset.customPrompt ?? defaultCustomPrompt}
                defaultValue={defaultCustomPrompt}
                onSave={(next) => { updateField({ customPrompt: next }); setIsPromptEditorOpen(false); }}
                onClose={() => setIsPromptEditorOpen(false)}
            />
        </div>
    );
};

const hostOf = (url: string): string => {
    try { return new URL(url).host; } catch { return url; }
};

interface PresetBuilderProps {
    themeColor: string;
    onCreate: (preset: ProxyPreset) => void;
    onGoToProxy: () => void;
}

// Compose a fresh proxy preset from prefab blocks: pick a model+endpoint combo,
// pick a prompt, tweak the name, drop it into the Proxy tab. No typing of URLs,
// keys or model ids by hand — everything comes from the catalog in builderBlocks.ts.
const PresetBuilder: React.FC<PresetBuilderProps> = ({ themeColor, onCreate, onGoToProxy }) => {
    const [modelId, setModelId] = useState<string | null>(null);
    const [promptId, setPromptId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [nameDirty, setNameDirty] = useState(false);
    const [lastCreated, setLastCreated] = useState<string | null>(null);
    const [includeThinkingInHistory, setIncludeThinkingInHistory] = useState(false);

    const model = MODEL_BLOCKS.find(m => m.id === modelId) ?? null;
    const prompt = PROMPT_BLOCKS.find(p => p.id === promptId) ?? null;

    // House style: "<ShortProvider>-<Model>" (matches DEFAULT_PROXY_PRESETS, e.g.
    // "TR-Gemini 3.1 Pro"), plus the picked prompt — the Builder can mix a model
    // with any prompt, so unlike the static presets it's worth naming which one.
    const autoName = model ? `${modelPresetBaseName(model)} · ${prompt?.name ?? '…'}` : '';
    const effectiveName = nameDirty ? name : autoName;
    const canCreate = !!model && !!prompt;

    const handlePickModel = (id: string) => {
        const picked = MODEL_BLOCKS.find(m => m.id === id);
        setModelId(id);
        setLastCreated(null);
        // Pre-select the model's suggested prompt unless the user already chose one.
        if (picked && !promptId) setPromptId(picked.suggestedPrompt.id);
    };

    const handleCreate = () => {
        if (!model || !prompt) return;
        const preset = buildPresetFromBlocks(model, prompt, effectiveName, includeThinkingInHistory);
        onCreate(preset);
        setLastCreated(preset.name);
    };

    const chipBase = 'px-3 py-1.5 rounded-lg border text-sm text-left transition-colors';

    return (
        <div className="space-y-5 animate-fadeIn">
            <p className="text-xs text-gray-400 leading-relaxed">
                Assemble a proxy preset from prefabs: pick a <span className="text-primary-300">model</span> (model id + endpoint),
                pick a <span className="text-primary-300">prompt</span>, then add it to the Proxy tab and paste your key there.
            </p>

            {/* Step 1 — model */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-primary-300 flex items-center gap-2">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary-800/60 text-primary-200 text-[11px] font-bold">1</span>
                    Model
                </h3>
                {MODEL_BLOCK_GROUPS.map(group => (
                    <div key={group} className="space-y-1.5">
                        <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{group}</p>
                        <div className="flex flex-wrap gap-2">
                            {MODEL_BLOCKS.filter(m => m.group === group).map(m => {
                                const active = modelId === m.id;
                                return (
                                    <button
                                        key={m.id}
                                        onClick={() => handlePickModel(m.id)}
                                        className={`${chipBase} ${active
                                            ? 'bg-primary-700/40 border-primary-500 text-white'
                                            : 'bg-gray-900/60 border-gray-700 text-gray-300 hover:border-primary-600/60 hover:bg-gray-800'}`}
                                        title={m.model}
                                    >
                                        {m.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Step 2 — prompt */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-primary-300 flex items-center gap-2">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary-800/60 text-primary-200 text-[11px] font-bold">2</span>
                    Prompt
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PROMPT_BLOCKS.map(p => {
                        const active = promptId === p.id;
                        return (
                            <button
                                key={p.id}
                                onClick={() => { setPromptId(p.id); setLastCreated(null); }}
                                className={`flex flex-col gap-0.5 p-2.5 rounded-lg border text-left transition-colors ${active
                                    ? 'bg-primary-700/30 border-primary-500'
                                    : 'bg-gray-900/60 border-gray-700 hover:border-primary-600/60 hover:bg-gray-800'}`}
                            >
                                <span className={`text-sm font-semibold ${active ? 'text-white' : 'text-gray-200'}`}>{p.name}</span>
                                <span className="text-[11px] text-gray-400 leading-snug">{p.blurb}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Step 3 — preview + create */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-primary-300 flex items-center gap-2">
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary-800/60 text-primary-200 text-[11px] font-bold">3</span>
                    Review
                </h3>

                <Field label="Preset Name" themeColor={themeColor}>
                    <input
                        type="text"
                        value={effectiveName}
                        onChange={(e) => { setName(e.target.value); setNameDirty(true); }}
                        placeholder="Pick a model & prompt…"
                        className={inputCls(themeColor)}
                    />
                </Field>

                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                    <div className="flex items-center justify-between gap-4">
                        <label htmlFor="builder-include-thinking" className="min-w-0 flex-1">
                            <span className="text-sm font-semibold text-white">Include thinking in story history</span>
                            <p className="mt-1 text-xs leading-snug text-gray-400">
                                Off by default. Enable only for interleaved-thinking models that require their previous reasoning, such as some Kimi or MiniMax endpoints.
                            </p>
                        </label>
                        <label className="toggle-switch flex-shrink-0">
                            <input
                                id="builder-include-thinking"
                                type="checkbox"
                                checked={includeThinkingInHistory}
                                onChange={(event) => { setIncludeThinkingInHistory(event.target.checked); setLastCreated(null); }}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>

                <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 space-y-2 text-sm">
                    {model ? (
                        <>
                            <div className="flex items-baseline gap-2">
                                <span className="text-primary-300/80 font-medium w-16 flex-shrink-0 text-xs uppercase">Model</span>
                                <span className="text-gray-200 font-mono text-xs sm:text-sm truncate" title={model.model}>{model.model}</span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-primary-300/80 font-medium w-16 flex-shrink-0 text-xs uppercase">Think</span>
                                <span className={includeThinkingInHistory ? 'text-xs font-semibold text-amber-300' : 'text-xs text-gray-500'}>
                                    {includeThinkingInHistory ? 'Included in history' : 'Stripped (default)'}
                                </span>
                            </div>
                            <div className="flex items-baseline gap-2">
                                <span className="text-primary-300/80 font-medium w-16 flex-shrink-0 text-xs uppercase">Endpoint</span>
                                <span className="text-gray-300 font-mono text-xs truncate" title={model.proxyUrl}>{hostOf(model.proxyUrl)}</span>
                            </div>
                            {model.extraParams && (
                                <div className="flex items-baseline gap-2">
                                    <span className="text-primary-300/80 font-medium w-16 flex-shrink-0 text-xs uppercase">Params</span>
                                    <span className="text-gray-300 font-mono text-[11px] truncate" title={model.extraParams}>{model.extraParams}</span>
                                </div>
                            )}
                            <div className="flex items-baseline gap-2">
                                <span className="text-primary-300/80 font-medium w-16 flex-shrink-0 text-xs uppercase">Prompt</span>
                                <span className="text-gray-300 text-xs truncate">
                                    {prompt ? prompt.name : <span className="italic text-gray-500">not picked</span>}
                                </span>
                            </div>
                        </>
                    ) : (
                        <p className="text-gray-500 italic text-xs text-center py-2">Pick a model to see the assembled preset.</p>
                    )}
                </div>

                {lastCreated ? (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2 rounded-lg bg-green-900/30 border border-green-700/40 text-green-300 text-sm">
                        <span className="flex-1">✓ Added <span className="font-semibold">{lastCreated}</span> to Proxy presets.</span>
                        <button onClick={onGoToProxy} className="px-3 py-1.5 rounded-md bg-green-800/50 border border-green-600/50 text-green-100 text-xs font-semibold hover:bg-green-700/50 transition-colors">
                            View in Proxy →
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={handleCreate}
                        disabled={!canCreate}
                        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border transition-colors ${canCreate
                            ? 'bg-primary-800 text-white border-primary-600 hover:bg-primary-700'
                            : 'bg-gray-800/50 text-gray-600 border-gray-700/50 cursor-not-allowed'}`}
                    >
                        <SparklesIcon className="w-4 h-4" />
                        Add to Proxy presets
                    </button>
                )}
            </div>
        </div>
    );
};

const APISettingsModal: React.FC<APISettingsModalProps> = ({
    isOpen, onClose, onSave,
    initialProvider, initialProxySettings, initialProxyPresets = [], onSavePresets,
    initialGeminiSettings, initialGeminiApiKeys = [], initialGeminiPresets = [], onSaveGeminiApiKeys, onSaveGeminiPresets,
    initialReplaceAgentModels, defaultCustomPrompt = DEFAULT_CUSTOM_PROMPT, themeColor, onNotify,
}) => {
  const [provider, setProvider] = useState(initialProvider);
  // Top-level tab. 'gemini'/'proxy' mirror the saved provider; 'builder' is a
  // tool view that composes proxy presets and never changes the saved provider.
  const [view, setView] = useState<'gemini' | 'proxy' | 'builder'>(initialProvider);
  const [presets, setPresets] = useState<ProxyPreset[]>(initialProxyPresets || []);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [openPresetId, setOpenPresetId] = useState<string | null>(null);
  const [geminiApiKeys, setGeminiApiKeys] = useState<GeminiApiKey[]>(initialGeminiApiKeys || []);
  const [geminiPresets, setGeminiPresets] = useState<GeminiPreset[]>(initialGeminiPresets || []);
  const [activeGeminiPresetId, setActiveGeminiPresetId] = useState<string | null>(null);
  const [openGeminiPresetId, setOpenGeminiPresetId] = useState<string | null>(null);
  const [cardMode, setCardMode] = useState<CardMode>('view');
  const [geminiConfig, setGeminiConfig] = useState<GeminiSettings>(initialGeminiSettings || { model: DEFAULT_GEMINI_API_MODEL });
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    if (!isOpen) return;
    setProvider(initialProvider);
    setView(initialProvider);

    const currentPresets = [...(initialProxyPresets || [])];
    let activeId: string | null = null;

    if (initialProxySettings) {
        // Prefer the stored preset id; fall back to content match for settings
        // saved before ProxySettings carried a presetId.
        const byId = initialProxySettings.presetId
            ? currentPresets.find(p => p.id === initialProxySettings.presetId)
            : undefined;
        const match = byId ?? currentPresets.find(p =>
            p.model === initialProxySettings.model &&
            p.proxyUrl === initialProxySettings.proxyUrl &&
            p.apiKey === initialProxySettings.apiKey &&
            (p.extraParams || '') === (initialProxySettings.extraParams || '') &&
            customPromptOrDefault(p.customPrompt) === customPromptOrDefault(initialProxySettings.customPrompt) &&
            (p.includeThinkingInHistory === true) === (initialProxySettings.includeThinkingInHistory === true)
        );
        activeId = match?.id ?? currentPresets[0]?.id ?? null;
    } else if (currentPresets.length > 0) {
        activeId = currentPresets[0].id;
    }

    setPresets(currentPresets);
    setActivePresetId(activeId);
    setOpenPresetId(activeId);

    const currentGeminiKeys = [...(initialGeminiApiKeys || [])];
    const currentGeminiPresets = [...(initialGeminiPresets || [])];
    let activeGeminiId: string | null = null;
    if (initialGeminiSettings) {
        const match = currentGeminiPresets.find(p => geminiSettingsMatchPreset(initialGeminiSettings, p, currentGeminiKeys));
        activeGeminiId = match?.id ?? currentGeminiPresets[0]?.id ?? null;
    } else if (currentGeminiPresets.length > 0) {
        activeGeminiId = currentGeminiPresets[0].id;
    }
    setGeminiApiKeys(currentGeminiKeys);
    setGeminiPresets(currentGeminiPresets);
    setActiveGeminiPresetId(activeGeminiId);
    setOpenGeminiPresetId(null);

    setCardMode('view');
    setGeminiConfig(initialGeminiSettings || { model: DEFAULT_GEMINI_API_MODEL });
    setTestResults({});
  }, [initialProvider, initialProxySettings, initialProxyPresets, initialGeminiSettings, initialGeminiApiKeys, initialGeminiPresets, isOpen]);

  const handleSelectCard = (id: string) => {
      if (openPresetId === id) {
          setOpenPresetId(null);
      } else {
          setOpenPresetId(id);
          setActivePresetId(id);
          setCardMode('view');
      }
  };

  const handleChangePreset = (next: ProxyPreset) => {
      setPresets(prev => prev.map(p => p.id === next.id ? next : p));
  };

  const handleAddPreset = () => {
      const fresh = emptyPreset(defaultCustomPrompt);
      setPresets(prev => [...prev, fresh]);
      setOpenPresetId(fresh.id);
      setActivePresetId(fresh.id);
      setCardMode('edit');
  };

  const handleDeletePreset = (id: string) => {
      if (presets.length <= 1) return;
      const idx = presets.findIndex(p => p.id === id);
      const next = presets.filter(p => p.id !== id);
      setPresets(next);
      if (activePresetId === id) {
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          setActivePresetId(fallback?.id ?? null);
      }
      if (openPresetId === id) setOpenPresetId(null);
      setTestResults(prev => { const { [id]: _, ...rest } = prev; return rest; });
  };

  const handleDuplicatePreset = (id: string) => {
      const src = presets.find(p => p.id === id);
      if (!src) return;
      const copy: ProxyPreset = { ...src, id: crypto.randomUUID(), name: `${src.name || 'Untitled'} (Copy)` };
      const idx = presets.findIndex(p => p.id === id);
      const next = [...presets.slice(0, idx + 1), copy, ...presets.slice(idx + 1)];
      setPresets(next);
      setOpenPresetId(copy.id);
      setActivePresetId(copy.id);
      setCardMode('edit');
  };

  const handleTestPreset = async (id: string) => {
      const preset = presets.find(p => p.id === id);
      if (!preset) return;
      setTestResults(prev => ({ ...prev, [id]: { status: 'loading' } }));
      const controller = new AbortController();
      const result = await runProxyTest(preset, controller.signal);
      setTestResults(prev => ({ ...prev, [id]: result }));
  };

  const handleChangeGeminiKey = (next: GeminiApiKey) => {
      setGeminiApiKeys(prev => prev.map(k => k.id === next.id ? next : k));
  };

  const handleAddGeminiKey = () => {
      const fresh = emptyGeminiKey();
      setGeminiApiKeys(prev => [...prev, fresh]);
  };

  const handleDeleteGeminiKey = (id: string) => {
      if (geminiApiKeys.length <= 1) return;
      const fallbackId = geminiApiKeys.find(k => k.id !== id)?.id ?? '';
      setGeminiApiKeys(prev => prev.filter(k => k.id !== id));
      setGeminiPresets(prev => prev.map(p => p.apiKeyId === id ? { ...p, apiKeyId: fallbackId } : p));
  };

  const handleSelectGeminiCard = (id: string) => {
      if (openGeminiPresetId === id) {
          setOpenGeminiPresetId(null);
      } else {
          setOpenGeminiPresetId(id);
          setActiveGeminiPresetId(id);
          setCardMode('view');
      }
  };

  const handleChangeGeminiPreset = (next: GeminiPreset) => {
      setGeminiPresets(prev => prev.map(p => p.id === next.id ? next : p));
  };

  const handleAddGeminiPreset = () => {
      const keyId = geminiApiKeys[0]?.id ?? '';
      const fresh = emptyGeminiPreset(keyId, defaultCustomPrompt);
      setGeminiPresets(prev => [...prev, fresh]);
      setOpenGeminiPresetId(fresh.id);
      setActiveGeminiPresetId(fresh.id);
      setCardMode('edit');
  };

  const handleDeleteGeminiPreset = (id: string) => {
      if (geminiPresets.length <= 1) return;
      const idx = geminiPresets.findIndex(p => p.id === id);
      const next = geminiPresets.filter(p => p.id !== id);
      setGeminiPresets(next);
      if (activeGeminiPresetId === id) {
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          setActiveGeminiPresetId(fallback?.id ?? null);
      }
      if (openGeminiPresetId === id) setOpenGeminiPresetId(null);
      setTestResults(prev => { const { [id]: _, ...rest } = prev; return rest; });
  };

  const handleDuplicateGeminiPreset = (id: string) => {
      const src = geminiPresets.find(p => p.id === id);
      if (!src) return;
      const copy: GeminiPreset = { ...src, id: crypto.randomUUID(), name: `${src.name || 'Untitled'} (Copy)` };
      const idx = geminiPresets.findIndex(p => p.id === id);
      const next = [...geminiPresets.slice(0, idx + 1), copy, ...geminiPresets.slice(idx + 1)];
      setGeminiPresets(next);
      setOpenGeminiPresetId(copy.id);
      setActiveGeminiPresetId(copy.id);
      setCardMode('edit');
  };

  const handleTestGeminiPreset = async (id: string) => {
      const preset = geminiPresets.find(p => p.id === id);
      if (!preset) return;
      setTestResults(prev => ({ ...prev, [id]: { status: 'loading' } }));
      const controller = new AbortController();
      const result = await runGeminiTest(preset, geminiApiKeys, controller.signal);
      setTestResults(prev => ({ ...prev, [id]: result }));
  };

  // Builder → drop the composed preset into the Proxy list and make it active,
  // but stay on the Builder tab so the user can keep composing more.
  const handleBuilderCreate = (preset: ProxyPreset) => {
      setPresets(prev => [...prev, preset]);
      setActivePresetId(preset.id);
      setOpenPresetId(preset.id);
      setCardMode('view');
  };

  const handleGoToProxy = () => {
      setProvider('proxy');
      setView('proxy');
  };

  const handleMovePreset = (id: string, dir: -1 | 1) => {
      setPresets(prev => {
          const idx = prev.findIndex(p => p.id === id);
          const target = idx + dir;
          if (idx < 0 || target < 0 || target >= prev.length) return prev;
          const next = [...prev];
          [next[idx], next[target]] = [next[target], next[idx]];
          return next;
      });
  };

  // Resync the saved Gemini presets with the code catalog — same semantics as
  // the proxy Resync below: append missing built-ins, restore drifted built-in
  // prompts from constants.ts, never touch user-made presets.
  const handleResyncGeminiPresets = () => {
      const { presets: synced, added, updated } = syncGeminiPresetsWithCode(geminiPresets);
      if (added.length === 0 && updated.length === 0) {
          onNotify?.('Gemini presets already match code.', 'info');
          return;
      }
      setGeminiPresets(synced);
      const parts: string[] = [];
      if (added.length) parts.push(`added ${added.length}`);
      if (updated.length) parts.push(`updated ${updated.length} prompt${updated.length > 1 ? 's' : ''}`);
      onNotify?.(`Synced with code: ${parts.join(', ')}. Save to keep.`, 'success');
  };

  const handleAutoOrderGeminiPresets = () => {
      if (isGeminiPresetOrderCanonical(geminiPresets)) {
          onNotify?.('Presets are already in code order.', 'info');
          return;
      }
      setGeminiPresets(reorderGeminiPresetsToCode(geminiPresets));
      onNotify?.('Reordered to match code. Custom presets moved to the bottom. Save to keep.', 'success');
  };

  // Resync the saved proxy presets with the code catalog: append any missing
  // built-ins and restore drifted built-in prompts to their constants.ts version.
  // User-made presets (Builder output, duplicates) are never touched.
  const handleResyncPresets = () => {
      const { presets: synced, added, updated } = syncProxyPresetsWithCode(presets);
      if (added.length === 0 && updated.length === 0) {
          onNotify?.('Proxy presets already match code.', 'info');
          return;
      }
      setPresets(synced);
      const parts: string[] = [];
      if (added.length) parts.push(`added ${added.length}`);
      if (updated.length) parts.push(`updated ${updated.length} prompt${updated.length > 1 ? 's' : ''}`);
      onNotify?.(`Synced with code: ${parts.join(', ')}. Save to keep.`, 'success');
  };

  const handleAutoOrderPresets = () => {
      if (isProxyPresetOrderCanonical(presets)) {
          onNotify?.('Presets are already in code order.', 'info');
          return;
      }
      setPresets(reorderProxyPresetsToCode(presets));
      onNotify?.('Reordered to match code. Custom presets moved to the bottom. Save to keep.', 'success');
  };

  if (!isOpen) return null;

  const handleSave = () => {
    const activePreset = presets.find(p => p.id === activePresetId);
    const proxyConfigToSave = activePreset ? {
        presetId: activePreset.id,
        model: activePreset.model,
        proxyUrl: activePreset.proxyUrl,
        apiKey: activePreset.apiKey,
        extraParams: activePreset.extraParams,
        customPrompt: activePreset.customPrompt ?? defaultCustomPrompt,
        includeThinkingInHistory: activePreset.includeThinkingInHistory === true,
    } : {
        model: DEFAULT_PROXY_MODEL,
        proxyUrl: DEFAULT_PROXY_URL,
        apiKey: DEFAULT_PROXY_API_KEY,
        extraParams: '',
        customPrompt: defaultCustomPrompt,
        includeThinkingInHistory: false,
    };
    const activeGeminiPreset = geminiPresets.find(p => p.id === activeGeminiPresetId);
    const geminiConfigToSave = activeGeminiPreset
        ? buildGeminiConfigFromPreset(activeGeminiPreset, geminiApiKeys)
        : geminiConfig;

    if (onSavePresets) onSavePresets(presets);
    if (onSaveGeminiApiKeys) onSaveGeminiApiKeys(geminiApiKeys);
    if (onSaveGeminiPresets) onSaveGeminiPresets(geminiPresets);

    onSave({
        provider,
        proxyConfig: proxyConfigToSave,
        geminiConfig: geminiConfigToSave,
        replaceModels: initialReplaceAgentModels
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4">
      <div
        className={`bg-gray-800/90 max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] rounded-xl sm:rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20 relative flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-6 pb-3 flex-shrink-0 border-b border-gray-700/50 flex items-center justify-between gap-3">
            <h2 className="text-xl sm:text-2xl font-bold text-white" style={{ fontFamily: 'serif' }}>
                API Settings
            </h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors" aria-label="Close modal">
                <XMarkIcon className="h-7 w-7" />
            </button>
        </div>

        <div className="px-4 sm:px-6 py-4 sm:py-5 flex-grow overflow-y-auto custom-scrollbar">
            <div className="space-y-5">
                <div>
                    <label className={`block text-sm sm:text-base font-semibold text-primary-300 mb-2`}>Provider</label>
                    <div className="flex gap-2 rounded-lg bg-gray-900 p-1.5">
                        <button onClick={() => { setProvider('gemini'); setView('gemini'); }} className={`flex-1 text-center py-2 rounded-md transition-colors text-sm ${view === 'gemini' ? `bg-primary-700 text-white font-semibold` : `bg-gray-800 hover:bg-gray-700 text-gray-300`}`}>
                            Gemini
                        </button>
                        <button onClick={() => { setProvider('proxy'); setView('proxy'); }} className={`flex-1 text-center py-2 rounded-md transition-colors text-sm ${view === 'proxy' ? `bg-primary-700 text-white font-semibold` : `bg-gray-800 hover:bg-gray-700 text-gray-300`}`}>
                            Proxy
                        </button>
                        <button onClick={() => setView('builder')} className={`flex-1 flex items-center justify-center gap-1.5 text-center py-2 rounded-md transition-colors text-sm ${view === 'builder' ? `bg-primary-700 text-white font-semibold` : `bg-gray-800 hover:bg-gray-700 text-gray-300`}`}>
                            <SparklesIcon className="w-4 h-4" />
                            Builder
                        </button>
                    </div>
                    {view === 'builder' && (
                        <p className="text-[11px] text-gray-500 mt-1.5">
                            Composing a <span className="text-primary-300/80">Proxy</span> preset. Saved provider stays <span className="text-primary-300/80">{provider === 'gemini' ? 'Gemini' : 'Proxy'}</span>.
                        </p>
                    )}
                </div>

                {view === 'builder' && (
                    <PresetBuilder
                        themeColor={themeColor}
                        onCreate={handleBuilderCreate}
                        onGoToProxy={handleGoToProxy}
                    />
                )}

                {view === 'gemini' && (
                    <div className="space-y-4 animate-fadeIn">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-base sm:text-lg font-semibold text-primary-300">
                                    Gemini API Keys
                                </h3>
                                <button
                                    onClick={handleAddGeminiKey}
                                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-800 text-primary-300 rounded-md border border-primary-800 hover:bg-primary-900/30 transition-colors"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                    <span className="hidden sm:inline">Add Key</span>
                                    <span className="sm:hidden">Add</span>
                                </button>
                            </div>
                            <div className="space-y-2">
                                {geminiApiKeys.map(key => (
                                    <GeminiKeyRow
                                        key={key.id}
                                        apiKey={key}
                                        canDelete={geminiApiKeys.length > 1}
                                        themeColor={themeColor}
                                        onChange={handleChangeGeminiKey}
                                        onDelete={() => handleDeleteGeminiKey(key.id)}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <h3 className="text-base sm:text-lg font-semibold text-primary-300">
                                    Gemini Configurations
                                </h3>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <button
                                        onClick={handleResyncGeminiPresets}
                                        title="Add missing built-in presets and restore their prompts from code"
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-gray-800 text-gray-300 rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                                    >
                                        <ArrowPathIcon className="w-4 h-4" />
                                        <span>Resync</span>
                                    </button>
                                    <button
                                        onClick={handleAutoOrderGeminiPresets}
                                        title="Reorder to match code; custom presets go to the bottom"
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-gray-800 text-gray-300 rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                                    >
                                        <ChevronDownIcon className="w-4 h-4" />
                                        <span>Auto-order</span>
                                    </button>
                                    <button
                                        onClick={handleAddGeminiPreset}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-gray-800 text-primary-300 rounded-md border border-primary-800 hover:bg-primary-900/30 transition-colors"
                                    >
                                        <PlusIcon className="w-4 h-4" />
                                        <span>Add</span>
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {geminiPresets.map(preset => (
                                    <GeminiPresetCard
                                        key={preset.id}
                                        preset={preset}
                                        keys={geminiApiKeys}
                                        isActive={activeGeminiPresetId === preset.id}
                                        isOpen={openGeminiPresetId === preset.id}
                                        canDelete={geminiPresets.length > 1}
                                        themeColor={themeColor}
                                        testResult={testResults[preset.id] ?? { status: 'idle' }}
                                        onSelect={() => handleSelectGeminiCard(preset.id)}
                                        onChange={handleChangeGeminiPreset}
                                        onDelete={() => handleDeleteGeminiPreset(preset.id)}
                                        onDuplicate={() => handleDuplicateGeminiPreset(preset.id)}
                                        onTest={() => handleTestGeminiPreset(preset.id)}
                                        defaultCustomPrompt={defaultCustomPrompt}
                                    />
                                ))}
                                {geminiPresets.length === 0 && (
                                    <p className="text-sm text-gray-500 italic text-center py-6">No Gemini configurations yet - click Add to create one.</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {view === 'proxy' && (
                    <div className="space-y-3 animate-fadeIn">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <h3 className={`text-base sm:text-lg font-semibold text-primary-300`}>
                                Proxy Configurations
                            </h3>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={handleResyncPresets}
                                    title="Add missing built-in presets and restore their prompts from code"
                                    className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-gray-800 text-gray-300 rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                                >
                                    <ArrowPathIcon className="w-4 h-4" />
                                    <span>Resync</span>
                                </button>
                                <button
                                    onClick={handleAutoOrderPresets}
                                    title="Reorder to match code; custom presets go to the bottom"
                                    className="flex items-center gap-1 px-2.5 py-1.5 text-sm bg-gray-800 text-gray-300 rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                                >
                                    <ChevronDownIcon className="w-4 h-4" />
                                    <span>Auto-order</span>
                                </button>
                                <button
                                    onClick={handleAddPreset}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 text-sm bg-gray-800 text-primary-300 rounded-md border border-primary-800 hover:bg-primary-900/30 transition-colors`}
                                >
                                    <PlusIcon className="w-4 h-4" />
                                    <span>Add</span>
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {presets.map((preset, index) => (
                                <PresetCard
                                    key={preset.id}
                                    preset={preset}
                                    isActive={activePresetId === preset.id}
                                    isOpen={openPresetId === preset.id}
                                    mode={openPresetId === preset.id ? cardMode : 'view'}
                                    canDelete={presets.length > 1}
                                    themeColor={themeColor}
                                    testResult={testResults[preset.id] ?? { status: 'idle' }}
                                    onSelect={() => handleSelectCard(preset.id)}
                                    onChange={handleChangePreset}
                                    onDelete={() => handleDeletePreset(preset.id)}
                                    onDuplicate={() => handleDuplicatePreset(preset.id)}
                                    onSetMode={setCardMode}
                                    onTest={() => handleTestPreset(preset.id)}
                                    onMoveUp={() => handleMovePreset(preset.id, -1)}
                                    onMoveDown={() => handleMovePreset(preset.id, 1)}
                                    canMoveUp={index > 0}
                                    canMoveDown={index < presets.length - 1}
                                    defaultCustomPrompt={defaultCustomPrompt}
                                />
                            ))}
                            {presets.length === 0 && (
                                <p className="text-sm text-gray-500 italic text-center py-6">No configurations yet — click Add to create one.</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>

        <div className="p-4 sm:p-6 pt-4 border-t border-gray-700 flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 bg-gray-700 text-white text-sm font-semibold rounded-md border border-gray-600 hover:bg-gray-600 transition-colors">Cancel</button>
          <button onClick={handleSave} className={`px-4 py-2 bg-primary-800 text-white text-sm font-semibold rounded-md border border-primary-600 hover:bg-primary-700 transition-colors`}>Save Settings</button>
        </div>
      </div>
    </div>
  );
};

export default APISettingsModal;
