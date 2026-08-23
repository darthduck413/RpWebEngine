import React, { useState, useEffect } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { DocumentTextIcon } from './icons/DocumentTextIcon';
import { GeminiApiKey, GeminiPreset, GeminiSettings, ProxySettings, ProxyPreset } from '../types';
import { DEFAULT_PROXY_MODEL, DEFAULT_PROXY_URL, DEFAULT_PROXY_API_KEY, DEFAULT_GEMINI_API_MODEL } from '../constants';
import { testProxyConnection } from '../services/proxy/testConnection';
import { testGeminiConnection } from '../services/gemini/testConnection';
import { DEFAULT_CUSTOM_PROMPT, customPromptOrDefault } from '../services/common/systemPrompt';

interface GenerationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: { 
    provider: 'gemini' | 'proxy'; 
    proxyConfig: ProxySettings;
    geminiConfig: GeminiSettings; 
    replaceModels: boolean;
    historyContextTurns: number;
    includeAllAgentResponsesInContext: boolean;
    keepNonExistentAgentResponses: boolean;
    deleteUnfinishedGeminiSentencesOnError: boolean;
  }) => void;
  initialProvider: 'gemini' | 'proxy';
  initialProxySettings?: ProxySettings;
  initialProxyPresets?: ProxyPreset[];
  initialGeminiSettings?: GeminiSettings;
  initialGeminiPresets?: GeminiPreset[];
  initialGeminiApiKeys?: GeminiApiKey[];
  initialReplaceAgentModels: boolean;
  initialHistoryContextTurns: number;
  initialIncludeAllAgentResponsesInContext: boolean;
  initialKeepNonExistentAgentResponses: boolean;
  initialDeleteUnfinishedGeminiSentencesOnError: boolean;
  themeColor: string;
  onLogViewerToggle: () => void;
  onWorldInfoToggle: () => void;
}

const GenerationSettingsModal: React.FC<GenerationSettingsModalProps> = ({ 
    isOpen, onClose, onSave, 
    initialProvider, initialProxySettings, initialProxyPresets = [], initialGeminiSettings, initialReplaceAgentModels, 
    initialGeminiPresets = [], initialGeminiApiKeys = [],
    initialHistoryContextTurns, initialIncludeAllAgentResponsesInContext, initialKeepNonExistentAgentResponses,
    initialDeleteUnfinishedGeminiSentencesOnError,
    themeColor,
    onLogViewerToggle,
    onWorldInfoToggle
}) => {
  const [provider, setProvider] = useState(initialProvider);
  const [proxyConfig, setProxyConfig] = useState<ProxySettings>(initialProxySettings || {
      model: DEFAULT_PROXY_MODEL, proxyUrl: DEFAULT_PROXY_URL, apiKey: DEFAULT_PROXY_API_KEY, extraParams: '', customPrompt: DEFAULT_CUSTOM_PROMPT, includeThinkingInHistory: false
  });
  const [geminiConfig, setGeminiConfig] = useState<GeminiSettings>(initialGeminiSettings || { model: DEFAULT_GEMINI_API_MODEL });
  const [turns, setTurns] = useState(initialHistoryContextTurns);
  const [includeAllAgentResponses, setIncludeAllAgentResponses] = useState(initialIncludeAllAgentResponsesInContext);
  const [keepNonExistent, setKeepNonExistent] = useState(initialKeepNonExistentAgentResponses);
  const [deleteUnfinishedGeminiSentencesOnError, setDeleteUnfinishedGeminiSentencesOnError] = useState(initialDeleteUnfinishedGeminiSentencesOnError);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState('');

  useEffect(() => {
    if (isOpen) {
      setProvider(initialProvider);
      setProxyConfig(initialProxySettings || { model: DEFAULT_PROXY_MODEL, proxyUrl: DEFAULT_PROXY_URL, apiKey: DEFAULT_PROXY_API_KEY, extraParams: '', customPrompt: DEFAULT_CUSTOM_PROMPT, includeThinkingInHistory: false });
      setGeminiConfig(initialGeminiSettings || { model: DEFAULT_GEMINI_API_MODEL });
      setTurns(initialHistoryContextTurns);
      setIncludeAllAgentResponses(initialIncludeAllAgentResponsesInContext);
      setKeepNonExistent(initialKeepNonExistentAgentResponses);
      setDeleteUnfinishedGeminiSentencesOnError(initialDeleteUnfinishedGeminiSentencesOnError);
      setTestStatus('idle');
      setTestResult('');
    }
  }, [initialProvider, initialProxySettings, initialGeminiSettings, initialReplaceAgentModels, initialHistoryContextTurns, initialIncludeAllAgentResponsesInContext, initialKeepNonExistentAgentResponses, initialDeleteUnfinishedGeminiSentencesOnError, isOpen]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTestStatus('loading');
    setTestResult('');
    try {
      if (provider === 'gemini') {
        const result = await testGeminiConnection(geminiConfig);
        setTestResult(result.message);
        setTestStatus(result.ok ? 'success' : 'error');
      } else {
        const result = await testProxyConnection(proxyConfig);
        setTestResult(result.message);
        setTestStatus(result.ok ? 'success' : 'error');
      }
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err));
      setTestStatus('error');
    }
  };

  const handleSave = () => {
    onSave({ 
        provider, 
        proxyConfig, 
        geminiConfig,
        replaceModels: initialReplaceAgentModels,
        historyContextTurns: turns,
        includeAllAgentResponsesInContext: includeAllAgentResponses,
        keepNonExistentAgentResponses: keepNonExistent,
        deleteUnfinishedGeminiSentencesOnError
    });
  };

  const handlePresetChange = (presetId: string) => {
      const preset = initialProxyPresets.find(p => p.id === presetId);
      if (preset) {
          setProxyConfig({
              presetId: preset.id,
              model: preset.model,
              proxyUrl: preset.proxyUrl,
              apiKey: preset.apiKey,
              extraParams: preset.extraParams,
              customPrompt: preset.customPrompt,
              includeThinkingInHistory: preset.includeThinkingInHistory === true,
          });
          setProvider('proxy');
      }
  };

  const handleGeminiPresetChange = (presetId: string) => {
      const preset = initialGeminiPresets.find(p => p.id === presetId);
      if (!preset) return;
      const key = initialGeminiApiKeys.find(k => k.id === preset.apiKeyId);
      setGeminiConfig({
          presetId: preset.id,
          model: preset.model,
          apiKeyId: key?.id ?? preset.apiKeyId,
          apiKey: key?.apiKey ?? '',
          apiKeyName: key?.name ?? '',
          apiKeyTier: key?.tier ?? 'paid',
          thinkingLevel: preset.thinkingLevel,
          extraParams: preset.extraParams ?? '',
          customPrompt: customPromptOrDefault(preset.customPrompt),
      });
      setProvider('gemini');
  };
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div 
        className={`bg-gray-800/90 max-w-lg w-full max-h-[90vh] rounded-2xl ring-2 ring-primary-700 shadow-2xl shadow-primary-500/20 relative flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 sm:p-8 pb-4 flex-shrink-0 border-b border-gray-700/50">
            <h2 className={`text-2xl sm:text-3xl font-bold text-white mb-4`} style={{fontFamily: 'serif'}}>
                Generation Settings
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
                <button
                    onClick={() => { onClose(); onLogViewerToggle(); }}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 text-primary-300 rounded-lg border border-primary-800 hover:bg-primary-900/30 hover:text-white transition-all`}
                >
                    <DocumentTextIcon className="h-5 w-5" />
                    <span className="font-semibold text-sm">View System Logs</span>
                </button>
                <button
                    onClick={() => { onClose(); onWorldInfoToggle(); }}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-800 text-primary-300 rounded-lg border border-primary-800 hover:bg-primary-900/30 hover:text-white transition-all`}
                >
                    <DocumentTextIcon className="h-5 w-5" />
                    <span className="font-semibold text-sm">Active World Info</span>
                </button>
            </div>
        </div>

        <div className="px-6 sm:px-8 py-6 flex-grow overflow-y-auto custom-scrollbar">
            <div className="space-y-6">
                {/* Provider Selection */}
                <div className={`p-4 border border-primary-800 rounded-lg bg-gray-900/50 space-y-4`}>
                    <h3 className={`text-lg font-semibold text-primary-300`}>API Provider</h3>
                    <div className="flex gap-2 rounded-lg bg-gray-900 p-2">
                        <button onClick={() => setProvider('gemini')} className={`flex-1 text-center py-2 rounded-md transition-colors text-sm ${provider === 'gemini' ? `bg-primary-700 text-white font-semibold` : `bg-gray-800 hover:bg-gray-700 text-gray-300`}`}>
                            Gemini
                        </button>
                        <button onClick={() => setProvider('proxy')} className={`flex-1 text-center py-2 rounded-md transition-colors text-sm ${provider === 'proxy' ? `bg-primary-700 text-white font-semibold` : `bg-gray-800 hover:bg-gray-700 text-gray-300`}`}>
                            Proxy
                        </button>
                    </div>

                    {provider === 'proxy' && initialProxyPresets.length > 0 && (
                        <div>
                            <label className={`block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider`}>Saved Configurations</label>
                            <select
                                onChange={(e) => handlePresetChange(e.target.value)}
                                className={`w-full bg-gray-800 rounded-md border border-gray-700 text-white p-2 text-sm focus:outline-none focus:border-primary-500`}
                                value={initialProxyPresets.find(p =>
                                    p.model === proxyConfig.model &&
                                    p.proxyUrl === proxyConfig.proxyUrl &&
                                    p.apiKey === proxyConfig.apiKey &&
                                    (p.extraParams || '') === (proxyConfig.extraParams || '') &&
                                    customPromptOrDefault(p.customPrompt) === customPromptOrDefault(proxyConfig.customPrompt) &&
                                    (p.includeThinkingInHistory === true) === (proxyConfig.includeThinkingInHistory === true)
                                )?.id || ''}
                            >
                                <option value="" disabled>Select a configuration...</option>
                                {initialProxyPresets.map(preset => (
                                    <option key={preset.id} value={preset.id}>
                                        {preset.name}{preset.includeThinkingInHistory ? ' · Thinking history ON' : ''}
                                    </option>
                                ))}
                            </select>
                            {proxyConfig.includeThinkingInHistory && (
                                <div className="mt-3 rounded-md border border-amber-600/40 bg-amber-900/20 px-3 py-2 text-xs leading-snug text-amber-200">
                                    Thinking history is ON for this API preset. Previous assistant &lt;think&gt; blocks will be sent back on light-mode story calls.
                                </div>
                            )}
                        </div>
                    )}

                    {provider === 'gemini' && initialGeminiPresets.length > 0 && (
                        <div>
                            <label className={`block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider`}>Saved Gemini Configurations</label>
                            <select
                                onChange={(e) => handleGeminiPresetChange(e.target.value)}
                                className={`w-full bg-gray-800 rounded-md border border-gray-700 text-white p-2 text-sm focus:outline-none focus:border-primary-500`}
                                value={initialGeminiPresets.find(p =>
                                    p.id === geminiConfig.presetId ||
                                    (
                                        p.model === geminiConfig.model &&
                                        p.apiKeyId === geminiConfig.apiKeyId &&
                                        customPromptOrDefault(p.customPrompt) === customPromptOrDefault(geminiConfig.customPrompt)
                                    )
                                )?.id || ''}
                            >
                                <option value="" disabled>Select a Gemini configuration...</option>
                                {initialGeminiPresets.map(preset => {
                                    const key = initialGeminiApiKeys.find(k => k.id === preset.apiKeyId);
                                    return (
                                        <option key={preset.id} value={preset.id}>
                                            {preset.name}{key ? ` - ${key.name} (${key.tier})` : ''}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                    )}
                </div>

                {provider === 'gemini' && (
                    <div className={`p-4 border border-primary-800 rounded-lg bg-gray-900/50 space-y-4`}>
                        <h3 className={`text-lg font-semibold text-primary-300`}>Gemini Error Handling</h3>
                        <div className="flex items-center justify-between">
                            <label htmlFor="gemini-delete-unfinished-switch" className="flex-grow pr-4">
                                <span className="text-sm font-semibold text-white">Delete unfinished sentences if API error</span>
                                <p className={`text-[10px] text-gray-500 leading-tight mt-0.5`}>
                                    Off keeps partial Gemini text and deletes only empty generated messages.
                                </p>
                            </label>
                            <label className="toggle-switch flex-shrink-0 scale-90">
                                <input
                                    id="gemini-delete-unfinished-switch"
                                    type="checkbox"
                                    checked={deleteUnfinishedGeminiSentencesOnError}
                                    onChange={() => setDeleteUnfinishedGeminiSentencesOnError(!deleteUnfinishedGeminiSentencesOnError)}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                    </div>
                )}

                {/* Context Section */}
                <div className={`p-4 border border-primary-800 rounded-lg bg-gray-900/50 space-y-4`}>
                    <h3 className={`text-lg font-semibold text-primary-300`}>Context Settings</h3>
                    
                    <div>
                        <label htmlFor="context-turns" className={`block font-semibold text-sm text-white mb-2`}>Conversation History Length</label>
                        <p className={`text-xs text-gray-400 mb-3`}>
                            Number of recent turns to send to the AI. <strong className={`text-primary-400`}>Set to 0 for unlimited.</strong>
                        </p>
                        <input 
                            id="context-turns" 
                            type="number" 
                            value={turns} 
                            onChange={(e) => setTurns(Math.max(0, parseInt(e.target.value, 10) || 0))} 
                            min="0" 
                            className={`w-full bg-gray-800 rounded-md border border-gray-700 text-white p-2 text-center text-lg font-mono focus:outline-none focus:border-primary-500`} 
                        />
                    </div>

                    <div className="pt-4 border-t border-gray-700/50 space-y-4">
                        <div className="flex items-center justify-between">
                            <label htmlFor="include-agents-switch" className="flex-grow pr-4">
                                <span className="text-sm font-semibold text-white">Include Agent History</span>
                                <p className={`text-[10px] text-gray-500 leading-tight mt-0.5`}>
                                    Send previous agent analysis in context for better coherence.
                                </p>
                            </label>
                            <label className="toggle-switch flex-shrink-0 scale-90">
                                <input
                                id="include-agents-switch"
                                type="checkbox"
                                checked={includeAllAgentResponses}
                                onChange={() => setIncludeAllAgentResponses(!includeAllAgentResponses)}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>

                        <div className={`flex items-center justify-between transition-opacity duration-300 ${!includeAllAgentResponses ? 'opacity-50' : ''}`}>
                            <label htmlFor="keep-non-existent-switch" className="flex-grow pr-4">
                                <span className="text-sm font-semibold text-white">Legacy Agent Context</span>
                                <p className={`text-[10px] text-gray-500 leading-tight mt-0.5`}>
                                    Keep context from agents that are no longer in the current preset.
                                </p>
                            </label>
                            <label className="toggle-switch flex-shrink-0 scale-90">
                                <input
                                id="keep-non-existent-switch"
                                type="checkbox"
                                checked={keepNonExistent}
                                onChange={() => setKeepNonExistent(!keepNonExistent)}
                                disabled={!includeAllAgentResponses}
                                />
                                <span className="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            {/* Connection Test Section */}
            <div className="mt-6 pt-6 border-t border-gray-700/50">
                <div className={`p-4 border border-primary-800 rounded-lg bg-gray-900/50 space-y-4`}>
                    <div className="flex items-center justify-between">
                        <h3 className={`text-lg font-semibold text-primary-300`}>Connection Test</h3>
                        <button 
                            onClick={handleTest}
                            disabled={testStatus === 'loading'}
                            className={`px-4 py-1.5 bg-primary-700 text-white text-sm font-bold rounded-md hover:bg-primary-600 disabled:opacity-50 transition-all`}
                        >
                            {testStatus === 'loading' ? 'Testing...' : 'Run Test'}
                        </button>
                    </div>
                    <p className="text-xs text-gray-400 italic">
                        Sends a simple "Hello" to the selected provider to verify API keys and connectivity.
                    </p>
                    {testStatus !== 'idle' && (
                        <div className={`p-3 rounded-md text-xs font-mono break-words ${
                            testStatus === 'success' ? 'bg-green-900/30 text-green-400 border border-green-800' : 
                            testStatus === 'error' ? 'bg-red-900/30 text-red-400 border border-red-800' : 
                            'bg-gray-900 text-gray-400 border border-gray-700'
                        }`}>
                            <div className="font-bold mb-1 uppercase">
                                {testStatus === 'success' ? '✓ Success' : testStatus === 'error' ? '✗ Error' : '... Testing'}
                            </div>
                            {testResult}
                        </div>
                    )}
                </div>
            </div>
        </div>

        <div className="p-6 sm:p-8 pt-6 border-t border-gray-700 flex justify-end gap-4 flex-shrink-0">
          <button onClick={onClose} className="px-5 py-2 bg-gray-700 text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600 transition-all duration-200">Cancel</button>
          <button onClick={handleSave} className={`px-5 py-2 bg-primary-800 text-white font-semibold rounded-md border border-primary-600 hover:bg-primary-700 transition-all duration-200`}>Save Changes</button>
        </div>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors" aria-label="Close modal"><XMarkIcon className="h-8 w-8" /></button>
      </div>
    </div>
  );
};

export default GenerationSettingsModal;
