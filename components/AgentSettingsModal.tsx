

import React, { useState, useEffect, useRef, ChangeEvent, FC, useCallback } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { CogIcon } from './icons/CogIcon';
import { AgentSettings, InstructionVisibility, ProxySettings } from '../types';
import { PRESETS } from '../presets';
import { DEFAULT_PROXY_MODEL } from '../constants';

const AGENT_NODE_WIDTH = 320;
const AGENT_NODE_FALLBACK_HEIGHT = 450;
const GRAPH_CANVAS_SIZE = 4000;

const FormIcon: FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor" {...props}><path d="M0 0h24v24H0V0z" fill="none"/><path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"/></svg>
);
const GraphIcon: FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor" {...props}><path d="M0 0h24v24H0V0z" fill="none"/><path d="M17 7H9.41l2.3 2.3c.78.78.78 2.05 0 2.83l-2.3 2.3H17v-2h-4v-2h4V7zM3 3v2h4V3H3zm0 16v2h4v-2H3zm0-8v2h4v-2H3zm16 8v2h4v-2h-4zm0-16v2h4V3h-4zm0 8v2h4v-2h-4z"/></svg>
);

interface AgentConfigFormProps {
    agent: AgentSettings;
    onUpdate: (updatedAgent: AgentSettings) => void;
    onRemove?: (id: string) => void;
    isFinalAgent: boolean;
    themeColor: string;
    globalProxySettings: ProxySettings;
}

const AgentConfigForm: FC<AgentConfigFormProps> = ({ agent, onUpdate, onRemove, isFinalAgent, themeColor, globalProxySettings }) => {
    
    const handleInputChange = (field: keyof Omit<AgentSettings, 'id' | 'connections' | 'position' | 'instructionVisibility'>, value: string | number | boolean) => {
        let updatedAgent = { ...agent };

        if ((field === 'contextMessages' || field === 'order' || field === 'summaryContextLimit') && typeof value === 'string') {
            updatedAgent = { ...updatedAgent, [field]: parseInt(value, 10) || (field === 'order' ? 1 : 0) };
        } else if (field === 'type') {
            const newType = value as 'default' | 'switch' | 'spy';
            const { spyMode, spyMorphSkip, defaultSkip, ...rest } = updatedAgent;
            updatedAgent = { ...rest, type: newType };

            if (newType === 'spy') {
                updatedAgent.spyMode = agent.spyMode ?? 'morph';
                updatedAgent.spyMorphSkip = agent.spyMorphSkip ?? false;
            } else if (newType === 'default') {
                updatedAgent.defaultSkip = agent.defaultSkip ?? false;
            }
        } else if (field === 'provider') {
            const newProvider = value as 'gemini' | 'proxy';
            let newModel = updatedAgent.model;
            
            if (newProvider === 'gemini' && !['flash', 'pro', 'flash-lite'].includes(updatedAgent.model)) {
                newModel = 'flash';
            } else if (newProvider === 'proxy') {
                newModel = DEFAULT_PROXY_MODEL;
            }
            updatedAgent = { ...updatedAgent, provider: newProvider, model: newModel };
        } else {
            updatedAgent = { ...updatedAgent, [field]: value };
        }
        
        onUpdate(updatedAgent);
    };

    const handleVisibilityChange = (field: keyof InstructionVisibility, value: boolean) => {
        const currentVis = agent.instructionVisibility || { playerNotes: false, setting: false, personality: false, playerDescription: false };
        onUpdate({ ...agent, instructionVisibility: { ...currentVis, [field]: value } });
    };

    const toggleSelectAllVisibility = () => {
        const currentVis = agent.instructionVisibility || { playerNotes: false, setting: false, personality: false, playerDescription: false };
        const allSelected = Object.values(currentVis).every(v => v);
        const newValue = !allSelected;
        onUpdate({ ...agent, instructionVisibility: { playerNotes: newValue, setting: newValue, personality: newValue, playerDescription: newValue } });
    };

    const copyGlobalSettings = () => {
        if (agent.provider === 'proxy') {
            onUpdate({ ...agent, model: globalProxySettings.model, proxyParams: globalProxySettings.extraParams });
        }
    };

    const setAppDefaults = () => {
        const defaultModel = DEFAULT_PROXY_MODEL;
        onUpdate({ ...agent, model: defaultModel, proxyParams: '' });
    };

    const provider = agent.provider || 'gemini';
    const visibility = agent.instructionVisibility || { playerNotes: false, setting: false, personality: false, playerDescription: false };
    const defaultSummaryPrompt = "Summarize the story so far, focusing on key events, character relationships, and the current immediate situation. Keep it concise.";

    return (
        <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
                <h3 className={`font-bold text-primary-400`}>Agent Settings: {agent.name}</h3>
                {onRemove && (
                    <button onClick={() => onRemove(agent.id)} className={`text-primary-500 hover:text-primary-300`} aria-label={`Remove ${agent.name} agent`}>
                        <XMarkIcon className="w-5 h-5"/>
                    </button>
                )}
            </div>
            
            <div className="form-group">
                <label className={`text-sm font-medium text-primary-300/80 mb-1 block`}>Agent Name</label>
                <input type="text" value={agent.name} onChange={(e) => handleInputChange('name', e.target.value)} className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2`} />
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="form-group flex items-center justify-between p-2 border border-primary-900/40 rounded-md bg-primary-900/10">
                    <label className={`text-sm font-semibold ${agent.enabled === false ? 'text-gray-500' : 'text-primary-300'}`}>Enabled</label>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            checked={agent.enabled !== false}
                            onChange={(e) => handleInputChange('enabled', e.target.checked)}
                        />
                        <span className="slider"></span>
                    </label>
                </div>
                <div className="form-group">
                    <label className={`text-sm font-medium text-primary-300/80 mb-1 block`}>Phase</label>
                    <select
                        value={agent.phase ?? 'pre-turn'}
                        onChange={(e) => handleInputChange('phase', e.target.value)}
                        className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2`}
                    >
                        <option value="setup">Setup (once)</option>
                        <option value="routing">Routing</option>
                        <option value="pre-turn">Pre-turn</option>
                        <option value="per-actor">Per-actor</option>
                        <option value="synthesis">Synthesis (output)</option>
                        <option value="post-output">Post-output (checker)</option>
                    </select>
                </div>
            </div>

            <div className="form-group">
                <label className={`text-sm font-medium text-primary-300/80 mb-1 block`}>System Prompt</label>
                <textarea value={agent.systemInstruction} onChange={(e) => handleInputChange('systemInstruction', e.target.value)} rows={5} className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2 resize-y`}></textarea>
            </div>
            
            <div className="form-group border border-gray-700/50 rounded-md p-2 bg-gray-900/30">
                <div className="flex justify-between items-center mb-2">
                    <label className={`text-xs font-bold text-primary-300 uppercase tracking-wide`}>Instruction Visibility</label>
                    <button onClick={toggleSelectAllVisibility} className={`text-[10px] bg-gray-700 hover:bg-gray-600 px-2 py-0.5 rounded text-white transition-colors`}>Toggle All</button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={visibility.playerNotes} onChange={(e) => handleVisibilityChange('playerNotes', e.target.checked)} className={`rounded bg-gray-800 border-primary-700 text-primary-500 focus:ring-primary-500`} /><span className="text-gray-300">Player Notes</span></label>
                    <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={visibility.setting} onChange={(e) => handleVisibilityChange('setting', e.target.checked)} className={`rounded bg-gray-800 border-primary-700 text-primary-500 focus:ring-primary-500`} /><span className="text-gray-300">Setting</span></label>
                    <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={visibility.personality} onChange={(e) => handleVisibilityChange('personality', e.target.checked)} className={`rounded bg-gray-800 border-primary-700 text-primary-500 focus:ring-primary-500`} /><span className="text-gray-300">Personality</span></label>
                    <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={visibility.playerDescription} onChange={(e) => handleVisibilityChange('playerDescription', e.target.checked)} className={`rounded bg-gray-800 border-primary-700 text-primary-500 focus:ring-primary-500`} /><span className="text-gray-300">User Desc</span></label>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="form-group">
                    <label className={`text-sm font-medium text-primary-300/80 mb-1 block`}>Agent Type</label>
                    <select value={agent.type ?? 'default'} onChange={(e) => handleInputChange('type', e.target.value)} className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2`}>
                        <option value="default">Default</option>
                        <option value="switch" disabled={isFinalAgent}>Switch</option>
                        <option value="spy">Spy</option>
                    </select>
                </div>
                <div className="form-group">
                    <label className={`text-sm font-medium text-primary-300/80 mb-1 block`}>Provider</label>
                    <select value={provider} onChange={(e) => handleInputChange('provider', e.target.value)} className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2`}>
                        <option value="gemini">Gemini</option>
                        <option value="proxy">Proxy</option>
                    </select>
                </div>
            </div>

            <div className="form-group">
                <label className={`text-sm font-medium text-primary-300/80 mb-1 block`}>Model</label>
                {provider === 'gemini' ? (
                    <select value={agent.model} onChange={(e) => handleInputChange('model', e.target.value)} className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2`}>
                        <option value="flash">Flash</option>
                        <option value="flash-lite">Flash-Lite</option>
                        <option value="pro">Pro</option>
                    </select>
                ) : (
                    <div className="flex flex-col gap-2">
                        <input type="text" value={agent.model} onChange={(e) => handleInputChange('model', e.target.value)} placeholder="e.g. anthropic/claude-3-sonnet" className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2`} />
                        <label className={`text-xs font-medium text-primary-300/80`}>Extra JSON Params</label>
                        <textarea value={agent.proxyParams || ''} onChange={(e) => handleInputChange('proxyParams', e.target.value)} placeholder='{"temperature": 0.7}' rows={2} className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2 text-xs font-mono`} />
                        <div className="flex gap-2">
                            <button onClick={copyGlobalSettings} className={`flex-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-primary-300 hover:text-white transition-colors`}>Use Global</button>
                            <button onClick={setAppDefaults} className={`flex-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-primary-300 hover:text-white transition-colors`}>App Default</button>
                        </div>
                    </div>
                )}
            </div>

            <div className="form-group flex items-center justify-between p-2 border border-gray-700 rounded-md">
                <label className={`text-sm font-medium text-primary-300/80`}>Can Update Characters?</label>
                <label className="toggle-switch">
                    <input type="checkbox" checked={agent.canUpdateCharacters ?? false} onChange={(e) => handleInputChange('canUpdateCharacters', e.target.checked)} />
                    <span className="slider"></span>
                </label>
            </div>

            <div className={`form-group border border-primary-900/50 rounded-md p-3 bg-primary-900/10`}>
                <div className="flex items-center justify-between mb-2">
                    <label className={`text-sm font-bold text-primary-300`}>Context Optimization</label>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">Use Summary-First</span>
                        <label className="toggle-switch scale-90">
                            <input type="checkbox" checked={agent.useSummary ?? false} onChange={(e) => handleInputChange('useSummary', e.target.checked)} />
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>
                
                {agent.useSummary && (
                    <div className="space-y-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div>
                            <label className={`text-xs font-medium text-primary-300/80 block mb-1`}>Summarizer Prompt</label>
                            <textarea 
                                value={agent.summaryPrompt ?? defaultSummaryPrompt} 
                                onChange={(e) => handleInputChange('summaryPrompt', e.target.value)} 
                                rows={3} 
                                className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500 p-2 text-xs`} 
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className={`text-xs font-medium text-primary-300/80 block mb-1`}>Summarizer Model</label>
                                {provider === 'gemini' ? (
                                    <select value={agent.summaryModel ?? 'flash'} onChange={(e) => handleInputChange('summaryModel', e.target.value)} className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500 p-1.5 text-xs`}>
                                        <option value="flash">Flash</option>
                                        <option value="flash-lite">Flash-Lite</option>
                                        <option value="pro">Pro</option>
                                    </select>
                                ) : (
                                    <input 
                                        type="text" 
                                        value={agent.summaryModel ?? ''} 
                                        onChange={(e) => handleInputChange('summaryModel', e.target.value)} 
                                        placeholder={agent.model || "Same as agent"} 
                                        className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500 p-1.5 text-xs`} 
                                    />
                                )}
                            </div>
                            <div>
                                <label className={`text-xs font-medium text-primary-300/80 block mb-1`}>Context Limit (0=All)</label>
                                <input 
                                    type="number" 
                                    value={agent.summaryContextLimit ?? 0} 
                                    onChange={(e) => handleInputChange('summaryContextLimit', e.target.value)} 
                                    min="0" 
                                    className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-500 p-1.5 text-xs`} 
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {(agent.type === 'default') && (
                <div className={`form-group flex items-center justify-between p-2 border border-gray-700 rounded-md ${isFinalAgent ? 'opacity-50' : ''}`}>
                    <label className={`text-sm font-medium text-primary-300/80`}>Enable Skip Condition</label>
                    <label className="toggle-switch">
                        <input type="checkbox" checked={isFinalAgent ? false : (agent.defaultSkip ?? false)} onChange={(e) => handleInputChange('defaultSkip', e.target.checked)} disabled={isFinalAgent} />
                        <span className="slider"></span>
                    </label>
                </div>
            )}

            {agent.type === 'spy' && (
                <div className="grid grid-cols-2 gap-2 p-2 border border-gray-700 rounded-md">
                    <div className="form-group col-span-2">
                        <label className={`text-sm font-medium text-primary-300/80 mb-1 block`}>Spy Mode</label>
                        <select value={agent.spyMode ?? 'morph'} onChange={(e) => handleInputChange('spyMode', e.target.value)} className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2`}>
                            <option value="morph">Morph</option>
                            <option value="preset">Preset</option>
                        </select>
                    </div>
                    {agent.spyMode === 'morph' && (
                        <div className={`form-group col-span-2 flex items-center justify-between ${isFinalAgent ? 'opacity-50' : ''}`}>
                            <label className={`text-sm font-medium text-primary-300/80`}>Enable Skip Condition</label>
                            <label className="toggle-switch">
                                <input type="checkbox" checked={isFinalAgent ? false : (agent.spyMorphSkip ?? false)} onChange={(e) => handleInputChange('spyMorphSkip', e.target.checked)} disabled={isFinalAgent} />
                                <span className="slider"></span>
                            </label>
                        </div>
                    )}
                </div>
            )}

            <div className="grid grid-cols-2 gap-2">
                <div className="form-group">
                    <label className={`text-sm font-medium text-primary-300/80 mb-1 block`}>Context (0 = All)</label>
                    <input type="number" value={agent.contextMessages} onChange={(e) => handleInputChange('contextMessages', e.target.value)} min="0" className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2`} />
                </div>
                <div className="form-group">
                    <label className={`text-sm font-medium text-primary-300/80 mb-1 block`}>Order</label>
                    <input type="number" value={agent.order} onChange={(e) => handleInputChange('order', e.target.value)} min="1" className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2`} />
                </div>
            </div>
        </div>
    );
};

const FastAgentNode: FC<{ 
    agent: AgentSettings;
    onUpdate: (updatedAgent: AgentSettings) => void;
    onRemove: (id: string) => void;
    onEdit: (id: string) => void;
    themeColor: string;
    globalProxySettings: ProxySettings;
}> = ({ agent, onUpdate, onRemove, onEdit, themeColor, globalProxySettings }) => {
    
    const handleInputChange = (field: keyof AgentSettings, value: any) => {
        onUpdate({ ...agent, [field]: value });
    };

    const handleVisibilityChange = (field: keyof InstructionVisibility, value: boolean) => {
        const currentVis = agent.instructionVisibility || { playerNotes: false, setting: false, personality: false, playerDescription: false };
        onUpdate({ ...agent, instructionVisibility: { ...currentVis, [field]: value } });
    };

    const useGlobalModel = () => {
        if (agent.provider === 'proxy') {
            onUpdate({ ...agent, model: globalProxySettings.model, proxyParams: globalProxySettings.extraParams });
        }
    };
    
    const useDefaultModel = () => {
        const defaultModel = DEFAULT_PROXY_MODEL;
        onUpdate({ ...agent, model: defaultModel, proxyParams: '' });
    };

    const provider = agent.provider || 'gemini';
    const visibility = agent.instructionVisibility || { playerNotes: false, setting: false, personality: false, playerDescription: false };

    return (
        <div className={`bg-gray-800 border border-primary-900/70 rounded-lg shadow-lg flex flex-col w-full h-full overflow-hidden`}>
            <div className={`flex justify-between items-center p-2 bg-primary-900/20 border-b border-primary-900/50`}>
                <h3 className={`font-bold text-primary-400 text-sm truncate`}>Agent: {agent.name}</h3>
                <button onMouseDown={(e) => { e.stopPropagation(); onRemove(agent.id); }} className={`text-gray-500 hover:text-red-400`} aria-label="Remove agent">
                    <XMarkIcon className="w-4 h-4"/>
                </button>
            </div>

            <div className="p-3 space-y-3">
                <div className="flex gap-2">
                    <div className="flex-grow">
                        <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Name</label>
                        <input 
                            type="text" 
                            value={agent.name} 
                            onChange={(e) => handleInputChange('name', e.target.value)} 
                            className={`w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-primary-500 outline-none`}
                        />
                    </div>
                    <div className="w-1/3">
                        <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Type</label>
                        <select 
                            value={agent.type ?? 'default'} 
                            onChange={(e) => handleInputChange('type', e.target.value)} 
                            className={`w-full bg-gray-900 border border-gray-700 rounded px-1 py-1 text-xs text-white focus:border-primary-500 outline-none`}
                        >
                            <option value="default">Default</option>
                            <option value="switch">Switch</option>
                            <option value="spy">Spy</option>
                        </select>
                    </div>
                </div>

                {(agent.type === 'default') && (
                    <div className="flex justify-between items-center bg-gray-900/30 p-1.5 rounded border border-gray-700/50">
                        <span className="text-xs text-gray-400">Enable Skip Condition</span>
                        <label className="toggle-switch scale-75 origin-right">
                            <input type="checkbox" checked={agent.defaultSkip ?? false} onChange={(e) => handleInputChange('defaultSkip', e.target.checked)} />
                            <span className="slider"></span>
                        </label>
                    </div>
                )}

                <div>
                    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">System Prompt</label>
                    <textarea 
                        value={agent.systemInstruction} 
                        onChange={(e) => handleInputChange('systemInstruction', e.target.value)} 
                        rows={3} 
                        className={`w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-primary-500 outline-none resize-y custom-scrollbar`}
                        placeholder="Enter instructions..."
                    />
                </div>

                <div className="flex justify-between items-center bg-gray-900/30 p-1.5 rounded border border-gray-700/50">
                    <span className="text-xs text-gray-400">Can Update Characters?</span>
                    <label className="toggle-switch scale-75 origin-right">
                        <input type="checkbox" checked={agent.canUpdateCharacters ?? false} onChange={(e) => handleInputChange('canUpdateCharacters', e.target.checked)} />
                        <span className="slider"></span>
                    </label>
                </div>

                <div className="flex gap-2">
                    <div className="w-1/2">
                        <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Provider</label>
                        <select 
                            value={provider} 
                            onChange={(e) => handleInputChange('provider', e.target.value)} 
                            className={`w-full bg-gray-900 border border-gray-700 rounded px-1 py-1 text-xs text-white focus:border-primary-500 outline-none`}
                        >
                            <option value="gemini">Gemini</option>
                            <option value="proxy">Proxy</option>
                        </select>
                    </div>
                    <div className="w-1/2">
                        <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Context (0=All)</label>
                        <input 
                            type="number" 
                            value={agent.contextMessages} 
                            onChange={(e) => handleInputChange('contextMessages', parseInt(e.target.value) || 0)} 
                            min="0"
                            className={`w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-primary-500 outline-none`}
                        />
                    </div>
                </div>

                <div>
                    <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Model</label>
                    {provider === 'gemini' ? (
                        <select 
                            value={agent.model} 
                            onChange={(e) => handleInputChange('model', e.target.value)} 
                            className={`w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-primary-500 outline-none`}
                        >
                            <option value="flash">Flash</option>
                            <option value="flash-lite">Flash-Lite</option>
                            <option value="pro">Pro</option>
                        </select>
                    ) : (
                        <div className="flex flex-col gap-1">
                            <input 
                                type="text" 
                                value={agent.model} 
                                onChange={(e) => handleInputChange('model', e.target.value)} 
                                className={`w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:border-primary-500 outline-none`}
                                placeholder="Model ID" 
                            />
                            <div className="flex gap-1">
                                <button onClick={useGlobalModel} className="flex-1 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded py-0.5">Global</button>
                                <button onClick={useDefaultModel} className="flex-1 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded py-0.5">Default</button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                         <div className="w-16">
                            <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Order</label>
                            <input 
                                type="number" 
                                value={agent.order} 
                                onChange={(e) => handleInputChange('order', parseInt(e.target.value) || 1)} 
                                min="1"
                                className={`w-full bg-gray-900 border border-gray-700 rounded px-1 py-1 text-xs text-white focus:border-primary-500 outline-none`}
                            />
                        </div>
                        <div className="flex gap-1.5 items-end pb-1">
                            {['playerNotes', 'setting', 'personality', 'playerDescription'].map((key) => (
                                <label key={key} className="flex flex-col items-center cursor-pointer group" title={key}>
                                    <span className="text-[8px] text-gray-500 uppercase mb-0.5 group-hover:text-gray-300">
                                        {key === 'playerNotes' ? 'Note' : key === 'setting' ? 'Set' : key === 'personality' ? 'Pers' : 'Desc'}
                                    </span>
                                    <input 
                                        type="checkbox" 
                                        checked={(visibility as any)[key]} 
                                        onChange={(e) => handleVisibilityChange(key as keyof InstructionVisibility, e.target.checked)} 
                                        className={`w-3 h-3 rounded bg-gray-900 border-gray-600 text-primary-500 focus:ring-0 focus:ring-offset-0`} 
                                    />
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <button 
                    onMouseDown={(e) => { e.stopPropagation(); onEdit(agent.id); }}
                    className={`w-full py-1.5 bg-gray-700 hover:bg-primary-900/50 text-gray-300 hover:text-white text-xs font-semibold rounded transition-colors flex items-center justify-center gap-2`}
                >
                    <CogIcon className="w-3 h-3" />
                    Advanced Settings
                </button>
            </div>
        </div>
    );
}

const AgentFormView: FC<{ 
    settings: AgentSettings[], 
    onUpdateSettings: React.Dispatch<React.SetStateAction<AgentSettings[]>>, 
    onRemoveAgent: (id: string) => void, 
    themeColor: string,
    globalProxySettings: ProxySettings
}> = ({ settings, onUpdateSettings, onRemoveAgent, themeColor, globalProxySettings }) => {
  
  const handleAgentUpdate = (updatedAgent: AgentSettings) => {
      onUpdateSettings(prev => prev.map(a => a.id === updatedAgent.id ? updatedAgent : a));
  };

  return (
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      {settings.map((agent) => (
        <div key={agent.id} className={`bg-gray-800/80 border border-primary-900/70 rounded-lg p-4`}>
            <AgentConfigForm 
                agent={agent} 
                onUpdate={handleAgentUpdate} 
                onRemove={onRemoveAgent} 
                isFinalAgent={agent.connections.length === 0} 
                themeColor={themeColor} 
                globalProxySettings={globalProxySettings}
            />
        </div>
      ))}
    </div>
  );
};


const AgentGraphView: FC<{ 
    settings: AgentSettings[], 
    onUpdateSettings: React.Dispatch<React.SetStateAction<AgentSettings[]>>, 
    onEditAgent: (id: string) => void,
    themeColor: string, 
    globalProxySettings: ProxySettings
}> = ({ settings, onUpdateSettings, onEditAgent, themeColor, globalProxySettings }) => {
    const graphRef = useRef<HTMLDivElement>(null);
    const [draggedNode, setDraggedNode] = useState<{ id: string; startX: number; startY: number; startPosX: number; startPosY: number; } | null>(null);
    const [drawingLine, setDrawingLine] = useState<{ fromId: string; to: { x: number; y: number } } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const graphEl = graphRef.current;
        if (!graphEl) return;

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const zoomFactor = 0.1;
                setScale(prevScale => {
                    const newScale = prevScale - (e.deltaY > 0 ? zoomFactor : -zoomFactor);
                    return Math.max(0.2, Math.min(2, newScale));
                });
            }
        };

        graphEl.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            graphEl.removeEventListener('wheel', handleWheel);
        };
    }, []);

    const handleRemoveAgentInGraph = (idToRemove: string) => {
        onUpdateSettings(currentSettings => {
            const updated = currentSettings
                .filter(agent => agent.id !== idToRemove)
                .map(agent => ({
                    ...agent,
                    connections: agent.connections.filter(connId => connId !== idToRemove)
                }));

            if (updated.length === 0) {
               return updated;
            }
            return updated;
        });
    };

    const handleAgentUpdate = (updatedAgent: AgentSettings) => {
        onUpdateSettings(prev => prev.map(a => a.id === updatedAgent.id ? updatedAgent : a));
    };

    const handleNodeMouseDown = (e: React.MouseEvent<HTMLDivElement>, id: string) => {
        if ((e.target as HTMLElement).closest('button, input, select, textarea, label')) return;
        e.preventDefault();
        const agent = settings.find(a => a.id === id);
        if (!agent) return;
        setDraggedNode({ 
            id, 
            startX: e.clientX, 
            startY: e.clientY,
            startPosX: agent.position.x,
            startPosY: agent.position.y
        });
    };
    
    const getPortPosition = useCallback((agentId: string, port: 'in' | 'out') => {
        const agent = settings.find(a => a.id === agentId);
        if (!agent) return { x: 0, y: 0 };
        
        const nodeEl = document.getElementById(`agent-node-${agentId}`);
        const width = nodeEl ? nodeEl.offsetWidth : AGENT_NODE_WIDTH;
        const height = nodeEl ? nodeEl.offsetHeight : AGENT_NODE_FALLBACK_HEIGHT;

        return {
            x: agent.position.x + (port === 'out' ? width : 0),
            y: agent.position.y + height / 2
        };
    }, [settings]);

    const handlePortMouseDown = (e: React.MouseEvent<HTMLDivElement>, fromId: string) => {
        e.stopPropagation();
        const startPos = getPortPosition(fromId, 'out');
        setDrawingLine({ fromId, to: startPos });
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!graphRef.current) return;
        
        if (draggedNode) {
            const deltaX = (e.clientX - draggedNode.startX) / scale;
            const deltaY = (e.clientY - draggedNode.startY) / scale;
            const newPosX = draggedNode.startPosX + deltaX;
            const newPosY = draggedNode.startPosY + deltaY;

            onUpdateSettings(prevSettings => prevSettings.map(agent =>
                agent.id === draggedNode.id ? { ...agent, position: { x: Math.max(0, newPosX), y: Math.max(0, newPosY) } } : agent
            ));
        }
        if (drawingLine) {
            const graphRect = graphRef.current.getBoundingClientRect();
            const mouseXInWorld = (e.clientX - graphRect.left + graphRef.current.scrollLeft) / scale;
            const mouseYInWorld = (e.clientY - graphRect.top + graphRef.current.scrollTop) / scale;
            setDrawingLine({ ...drawingLine, to: { x: mouseXInWorld, y: mouseYInWorld } });
        }
    };
    
    const handleMouseUp = () => { setDraggedNode(null); setDrawingLine(null); };

    const handleNodeMouseUp = (toId: string) => {
        if (drawingLine && drawingLine.fromId !== toId) {
            onUpdateSettings(prevSettings => {
                const fromAgent = prevSettings.find(a => a.id === drawingLine.fromId);
                const toAgent = prevSettings.find(a => a.id === toId);
                if (fromAgent && toAgent && fromAgent.order < toAgent.order) {
                    return prevSettings.map(agent => 
                        (agent.id === fromAgent.id && !agent.connections.includes(toId))
                        ? { ...agent, connections: [...agent.connections, toId] } : agent
                    );
                }
                return prevSettings;
            });
        }
    };
    
    const handleRemoveConnection = (fromId: string, toId: string) => {
        onUpdateSettings(prevSettings => prevSettings.map(agent => {
            if (agent.id === fromId) {
                return { ...agent, connections: agent.connections.filter(c => c !== toId) };
            }
            return agent;
        }));
    };

    return (
        <div ref={graphRef} className="graph-view-container" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <svg className="connector-svg" style={{ width: GRAPH_CANVAS_SIZE, height: GRAPH_CANVAS_SIZE }}>
                    <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280" /></marker></defs>
                    {settings.flatMap(agent => agent.connections.map(targetId => {
                        const fromPos = getPortPosition(agent.id, 'out'); const toPos = getPortPosition(targetId, 'in');
                        return (
                            <g key={`${agent.id}-${targetId}`} className="connection-line-group">
                                <line x1={fromPos.x} y1={fromPos.y} x2={toPos.x} y2={toPos.y} className="connection-line" markerEnd="url(#arrow)" />
                                <line x1={fromPos.x} y1={fromPos.y} x2={toPos.x} y2={toPos.y} className="connection-line-clickable" onClick={() => handleRemoveConnection(agent.id, targetId)}/>
                            </g>
                        );
                    }))}
                    {drawingLine && <line x1={getPortPosition(drawingLine.fromId, 'out').x} y1={getPortPosition(drawingLine.fromId, 'out').y} x2={drawingLine.to.x} y2={drawingLine.to.y} className="connection-line drawing" markerEnd="url(#arrow)" />}
                </svg>

                {settings.map(agent => {
                    const isHovered = hoveredNodeId === agent.id;
                    let portInClass = 'connection-port port-in';
                    if (drawingLine && isHovered && drawingLine.fromId !== agent.id) {
                        const fromAgent = settings.find(a => a.id === drawingLine.fromId);
                        portInClass += (fromAgent && agent && fromAgent.order < agent.order) ? ' valid' : ' invalid';
                    }

                    return (
                        <div id={`agent-node-${agent.id}`} key={agent.id} className={`agent-node ${draggedNode?.id === agent.id ? 'dragging' : ''} ${agent.enabled === false ? 'agent-node-disabled' : ''}`} style={{ left: agent.position.x, top: agent.position.y, width: `${AGENT_NODE_WIDTH}px` }} onMouseDown={(e) => handleNodeMouseDown(e, agent.id)} onMouseUp={() => handleNodeMouseUp(agent.id)} onMouseEnter={() => setHoveredNodeId(agent.id)} onMouseLeave={() => setHoveredNodeId(null)}>
                            <div className={portInClass}></div>
                            <div className="connection-port port-out" onMouseDown={(e) => handlePortMouseDown(e, agent.id)}></div>
                            
                            <FastAgentNode 
                                agent={agent} 
                                onUpdate={handleAgentUpdate}
                                onRemove={handleRemoveAgentInGraph}
                                onEdit={onEditAgent}
                                themeColor={themeColor}
                                globalProxySettings={globalProxySettings}
                            />
                        </div>
                    )
                })}
            </div>
        </div>
    );
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AgentSettings[];
  onUpdateSettings: (newSettings: AgentSettings[]) => void;
  themeColor: string;
  globalProxySettings: ProxySettings;
}

const AgentSettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, settings, onUpdateSettings, themeColor, globalProxySettings }) => {
  const [localSettings, setLocalSettings] = useState<AgentSettings[]>([]);
  const [view, setView] = useState<'graph' | 'form'>('graph');
  const [isPresetsMenuOpen, setIsPresetsMenuOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(JSON.parse(JSON.stringify(settings)));
    }
  }, [settings, isOpen]);
  
  const handleAddAgent = () => {
    const newAgent: AgentSettings = {
      id: `agent-${Date.now()}`,
      name: 'New Agent',
      systemInstruction: 'Define the role for this agent.',
      contextMessages: 0,
      model: 'flash',
      provider: 'gemini',
      order: 1,
      connections: [],
      position: { x: 20, y: 20 },
      type: 'default',
      spyMode: 'morph',
      spyMorphSkip: false,
      defaultSkip: false,
      canUpdateCharacters: false,
      instructionVisibility: { playerNotes: false, setting: false, personality: false, playerDescription: false }
    };
    setLocalSettings(prev => [...prev, newAgent]);
  };

  const handleRemoveAgent = (idToRemove: string) => {
    setLocalSettings(prev => {
        let updated = prev.filter(agent => agent.id !== idToRemove).map(agent => ({...agent, connections: agent.connections.filter(connId => connId !== idToRemove)}));
        if (updated.length === 0) { 
            const newAgent: AgentSettings = { 
                id: `agent-${Date.now()}`, 
                name: 'New Agent', 
                systemInstruction: 'Define role.', 
                contextMessages: 0, 
                model: 'flash',
                provider: 'gemini',
                order: 1, 
                connections: [], 
                position: {x: 20, y: 20}, 
                type: 'default'
            };
            return [newAgent];
        }
        return updated;
    });
  };
  
  const handleLoadPreset = (presetAgents: AgentSettings[]) => {
    setLocalSettings(JSON.parse(JSON.stringify(presetAgents)));
    setIsPresetsMenuOpen(false);
  };

  const handleSave = () => { onUpdateSettings(localSettings); onClose(); };
  const handleSavePreset = () => {
    if (localSettings.length === 0) return;
    const dataStr = JSON.stringify(localSettings, null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([dataStr], { type: 'application/json' }));
    link.download = 'rwe-agents-custom.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (Array.isArray(parsed) && parsed.every(s => s.id && s.name)) { setLocalSettings(parsed); } 
        else { alert('Invalid preset file format.'); }
      } catch (error) { alert('Failed to load preset.'); }
    };
    reader.readAsText(file);
    event.target.value = '';
  };
  
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
        <div className="modal-content relative" onClick={e => e.stopPropagation()}>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} accept="application/json,.json"/>
            <div className="modal-header">
                <h2 className={`text-xl font-bold text-primary-500`} style={{fontFamily: 'serif'}}>Heavy Mode Agents</h2>
                <div className="flex items-center gap-2">
                  <button onClick={() => setView(view === 'form' ? 'graph' : 'form')} className={`p-2 text-primary-300 hover:bg-gray-700 rounded-full`} aria-label={`Switch to ${view === 'form' ? 'graph' : 'form'} view`}>
                    {view === 'form' ? <GraphIcon className="w-6 h-6"/> : <FormIcon className="w-6 h-6"/>}
                  </button>
                  <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close settings"><XMarkIcon className="h-8 w-8" /></button>
                </div>
            </div>
            <div className="modal-body custom-scrollbar relative">
                {view === 'form' ? (
                  <AgentFormView settings={localSettings} onUpdateSettings={setLocalSettings} onRemoveAgent={handleRemoveAgent} themeColor={themeColor} globalProxySettings={globalProxySettings} />
                ) : ( 
                  <AgentGraphView settings={localSettings} onUpdateSettings={setLocalSettings} onEditAgent={setEditingAgentId} themeColor={themeColor} globalProxySettings={globalProxySettings} /> 
                )}
            </div>
            <div className="modal-footer">
                <div className="flex items-center gap-2">
                  <button onClick={handleAddAgent} className="px-4 py-2 bg-gray-700 text-sm text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600">Add Agent</button>
                  <div className="relative">
                    <button 
                        onClick={() => setIsPresetsMenuOpen(!isPresetsMenuOpen)} 
                        className="px-4 py-2 bg-gray-700 text-sm text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600"
                    >
                        Presets
                    </button>
                    {isPresetsMenuOpen && (
                        <div className={`absolute bottom-full mb-2 w-72 bg-gray-800 border border-primary-900/70 rounded-md shadow-lg z-20`}>
                            <ul className="p-1 max-h-60 overflow-y-auto custom-scrollbar">
                                {PRESETS.map(preset => (
                                    <li key={preset.name}>
                                        <button 
                                            onClick={() => handleLoadPreset(preset.agents)}
                                            className={`w-full text-left px-3 py-2 text-sm text-primary-200 hover:bg-primary-900/50 rounded`}
                                        >
                                            <strong className="font-semibold text-white">{preset.name}</strong>
                                            <p className={`text-xs text-primary-200/70 mt-1`}>{preset.description}</p>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                  </div>
                  <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-gray-700 text-sm text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600">Load Custom</button>
                  <button onClick={handleSavePreset} className="px-4 py-2 bg-gray-700 text-sm text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600">Save Custom</button>
                </div>
                <button onClick={handleSave} className={`px-5 py-2 bg-primary-800 text-white font-semibold rounded-md border border-primary-600 hover:bg-primary-700`}>Save Changes</button>
            </div>

            {editingAgentId && (
                <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-gray-800 w-full max-w-2xl max-h-full rounded-xl shadow-2xl border border-gray-700 flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900">
                            <h3 className={`text-lg font-bold text-primary-400`}>Advanced Agent Configuration</h3>
                            <button onClick={() => setEditingAgentId(null)} className="text-gray-400 hover:text-white"><XMarkIcon className="w-6 h-6"/></button>
                        </div>
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            {localSettings.find(a => a.id === editingAgentId) && (
                                <AgentConfigForm 
                                    agent={localSettings.find(a => a.id === editingAgentId)!}
                                    onUpdate={(updated) => setLocalSettings(prev => prev.map(a => a.id === updated.id ? updated : a))}
                                    isFinalAgent={localSettings.find(a => a.id === editingAgentId)!.connections.length === 0}
                                    themeColor={themeColor}
                                    globalProxySettings={globalProxySettings}
                                />
                            )}
                        </div>
                        <div className="p-4 border-t border-gray-700 bg-gray-900 flex justify-end">
                            <button 
                                onClick={() => setEditingAgentId(null)}
                                className={`px-4 py-2 bg-primary-700 hover:bg-primary-600 text-white font-semibold rounded-md`}
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
};

export default AgentSettingsModal;