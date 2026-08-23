import React, { useState, useEffect } from 'react';
import { XMarkIcon } from './icons/XMarkIcon';
import { TrashIcon } from './icons/TrashIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { TrackedCharacter, CharacterTopic, CharacterVariable } from '../types';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';

interface CharacterTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  characters: TrackedCharacter[];
  onSave: (characters: TrackedCharacter[]) => void;
  onAnalyze: () => Promise<boolean>;
  themeColor: string;
  playerName: string;
}

const CharacterTrackerModal: React.FC<CharacterTrackerModalProps> = ({ isOpen, onClose, characters, onSave, onAnalyze, themeColor, playerName }) => {
  const [localCharacters, setLocalCharacters] = useState<TrackedCharacter[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [openTopics, setOpenTopics] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      setLocalCharacters(JSON.parse(JSON.stringify(characters)));
      const initialOpenState: Record<string, boolean> = {};
      characters.forEach(c => {
        c.topics.forEach(t => initialOpenState[t.id] = true);
      });
      setOpenTopics(initialOpenState);
    }
  }, [characters, isOpen]);

  if (!isOpen) return null;

  const handleAnalyzeClick = async () => {
    setIsAnalyzing(true);
    await onAnalyze();
    setIsAnalyzing(false);
    // The modal now remains open for the user to see the results.
  };
  
  const handleSave = () => { onSave(localCharacters); onClose(); };

  const handleAddCharacter = () => {
    const newChar: TrackedCharacter = { 
        id: crypto.randomUUID(), 
        name: 'New Character', 
        description: '', 
        health: { value: 75, description: 'Healthy and in good condition.' },
        topics: [] 
    };
    setLocalCharacters(prev => [...prev, newChar]);
  };
  
  const handleRemoveCharacter = (id: string) => {
    setLocalCharacters(prev => prev.filter(c => c.id !== id).map(char => ({
        ...char,
        topics: char.topics.map(topic => ({
            ...topic,
            variables: topic.variables.filter(v => v.targetId !== id)
        }))
    })));
  };
  
  const handleCharacterChange = (id: string, field: 'name' | 'description', value: string) => {
    setLocalCharacters(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };
  
  const handleHealthChange = (charId: string, field: 'value' | 'description', value: string | number) => {
    setLocalCharacters(prev => prev.map(c => {
        if (c.id === charId) {
            return {
                ...c,
                health: {
                    ...c.health,
                    [field]: value
                }
            };
        }
        return c;
    }));
  };

  const handleAddTopic = (charId: string) => {
    const newTopic: CharacterTopic = { id: crypto.randomUUID(), name: 'New Topic', description: '', variables: [] };
    setLocalCharacters(prev => prev.map(c => c.id === charId ? { ...c, topics: [...c.topics, newTopic] } : c));
    setOpenTopics(prev => ({...prev, [newTopic.id]: true}));
  };

  const handleRemoveTopic = (charId: string, topicId: string) => {
     setLocalCharacters(prev => prev.map(c => c.id === charId ? { ...c, topics: c.topics.filter(t => t.id !== topicId) } : c));
  };

   const handleTopicChange = (charId: string, topicId: string, field: 'name' | 'description', value: string) => {
    setLocalCharacters(prev => prev.map(c => {
      if (c.id === charId) {
        return { ...c, topics: c.topics.map(t => t.id === topicId ? { ...t, [field]: value } : t) };
      }
      return c;
    }));
  };

  const handleAddVariable = (charId: string, topicId: string) => {
    const newVar: CharacterVariable = { id: crypto.randomUUID(), name: 'New Variable', type: 'slider', value: 50, description: '' };
    setLocalCharacters(prev => prev.map(c => {
        if (c.id === charId) {
            return { ...c, topics: c.topics.map(t => t.id === topicId ? { ...t, variables: [...t.variables, newVar] } : t) };
        }
        return c;
    }));
  };

  const handleRemoveVariable = (charId: string, topicId: string, varId: string) => {
     setLocalCharacters(prev => prev.map(c => {
        if (c.id === charId) {
            return { ...c, topics: c.topics.map(t => t.id === topicId ? { ...t, variables: t.variables.filter(v => v.id !== varId)} : t) };
        }
        return c;
    }));
  };

  const handleVariableChange = (charId: string, topicId: string, varId: string, field: keyof Omit<CharacterVariable, 'id'>, value: string | number) => {
     setLocalCharacters(prev => prev.map(c => {
        if (c.id === charId) {
            return { ...c, topics: c.topics.map(t => {
                if (t.id === topicId) {
                    return { ...t, variables: t.variables.map(v => {
                        if (v.id === varId) {
                            const updatedVar = { ...v, [field]: value };
                            if(field === 'type' && value === 'slider') updatedVar.value = 50;
                            if(field === 'type' && value === 'text') updatedVar.value = '';
                            return updatedVar;
                        }
                        return v;
                    })};
                }
                return t;
            })};
        }
        return c;
    }));
  }

  const getScoreColor = (score: number) => {
    if (score < 25) return 'bg-red-500';
    if (score < 50) return 'bg-yellow-500';
    if (score < 75) return 'bg-blue-500';
    return 'bg-green-500';
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className={`text-xl font-bold text-primary-500`} style={{ fontFamily: 'serif' }}>Character Sheet Tracker</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white" aria-label="Close settings"><XMarkIcon className="h-8 w-8" /></button>
        </div>
        <div className="modal-body custom-scrollbar p-6">
            <div className={`p-4 mb-6 border border-primary-800 rounded-lg bg-gray-800/30`}>
                <h3 className={`text-lg font-semibold text-primary-300 mb-3`}>Slider Score Key</h3>
                <div className="grid grid-cols-4 gap-2 text-center text-xs text-white">
                    <div className="flex flex-col items-center"><span className="w-4 h-4 rounded-full bg-red-500 mb-1"></span>0<br/>Impossible Bad</div>
                    <div className="flex flex-col items-center"><span className="w-4 h-4 rounded-full bg-yellow-500 mb-1"></span>25-49<br/>Slightly Negative</div>
                    <div className="flex flex-col items-center"><span className="w-4 h-4 rounded-full bg-blue-500 mb-1"></span>50-74<br/>Neutral / Positive</div>
                    <div className="flex flex-col items-center"><span className="w-4 h-4 rounded-full bg-green-500 mb-1"></span>100<br/>Perfect</div>
                </div>
            </div>
            
            {(localCharacters || []).filter(c => c.id !== 'player').map(char => {
                const isNumericHealth = typeof char.health.value === 'number' || (typeof char.health.value === 'string' && !isNaN(parseFloat(char.health.value)));
                const healthValue = isNumericHealth ? Number(char.health.value) : 0;
                
                return (
                    <div key={char.id} className={`bg-gray-800/80 border border-primary-900/70 rounded-lg p-4 mb-4`}>
                        <div className="flex justify-between items-center mb-3">
                            <input type="text" value={char.name} onChange={e => handleCharacterChange(char.id, 'name', e.target.value)} className={`font-bold text-lg text-primary-400 bg-transparent border-b border-gray-700 focus:border-primary-500 focus:outline-none w-1/2`}/>
                            <button onClick={() => handleRemoveCharacter(char.id)} className={`text-primary-500 hover:text-primary-300`} aria-label={`Remove ${char.name}`}><TrashIcon className="w-5 h-5"/></button>
                        </div>
                        
                        <div className={`p-3 my-3 border border-primary-900 rounded-lg bg-gray-900/40`}>
                            <div className="grid grid-cols-5 gap-4 items-center">
                                <div className="col-span-2">
                                    <label className={`block text-sm font-medium text-primary-300 mb-1`}>Overall State</label>
                                    <input 
                                        type="text" 
                                        value={char.health.value}
                                        onChange={e => handleHealthChange(char.id, 'value', e.target.value)}
                                        placeholder="75 or 'Undead'"
                                        className={`w-full bg-gray-800 rounded border border-gray-700 text-white p-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500`}
                                    />
                                </div>
                                <div className="col-span-3">
                                    <label className={`block text-sm font-medium text-gray-400 mb-1`}>&nbsp;</label>
                                    {isNumericHealth && (
                                        <div className="w-full bg-gray-700 rounded-full h-2.5">
                                            <div className={`${getScoreColor(healthValue)} h-2.5 rounded-full`} style={{ width: `${healthValue}%` }}></div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="mt-2">
                                <label className={`block text-sm font-medium text-primary-300 mb-1`}>Overall State Description</label>
                                <textarea 
                                    value={char.health.description} 
                                    onChange={e => handleHealthChange(char.id, 'description', e.target.value)} 
                                    rows={2} 
                                    placeholder="Description of overall state, buffs, debuffs, and what's causing them..." 
                                    className={`w-full bg-gray-800 rounded border border-gray-700 text-white p-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 resize-y`}
                                />
                            </div>
                        </div>

                        <textarea value={char.description} onChange={e => handleCharacterChange(char.id, 'description', e.target.value)} rows={2} placeholder="Character description..." className={`w-full bg-gray-900/80 rounded border border-primary-900/70 text-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-500 p-2 text-sm resize-y mb-3`}></textarea>
                        
                        <div className="space-y-2">
                            {char.topics.map(topic => (
                            <div key={topic.id} className={`bg-gray-900/40 rounded-md border border-gray-700/50`}>
                                    <button onClick={() => setOpenTopics(prev => ({...prev, [topic.id]: !prev[topic.id]}))} className="w-full flex justify-between items-center p-2 bg-gray-900/50 hover:bg-gray-900/80 rounded-t-md">
                                        <input value={topic.name} onChange={(e) => { e.stopPropagation(); handleTopicChange(char.id, topic.id, 'name', e.target.value)}} onClick={e => e.stopPropagation()} className={`font-semibold text-base text-primary-300 bg-transparent focus:outline-none focus:border-b focus:border-primary-500 w-1/2`}/>
                                        <div className='flex items-center gap-2'>
                                            <button onClick={(e) => { e.stopPropagation(); handleRemoveTopic(char.id, topic.id); }} className="text-red-500 hover:text-red-400"><TrashIcon className="w-4 h-4"/></button>
                                            {openTopics[topic.id] ? <ChevronUpIcon className="w-5 h-5 text-gray-400"/> : <ChevronDownIcon className="w-5 h-5 text-gray-400"/>}
                                        </div>
                                    </button>
                                    {openTopics[topic.id] && (
                                        <div className="p-2 space-y-2">
                                            <textarea 
                                                value={topic.description} 
                                                onChange={e => handleTopicChange(char.id, topic.id, 'description', e.target.value)}
                                                placeholder="Topic description..." 
                                                rows={2}
                                                className={`w-full bg-gray-800 rounded border border-gray-700 text-white p-1 text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-y`}
                                            />
                                            {topic.variables.map(variable => (
                                                <div key={variable.id} className="grid grid-cols-12 gap-2 items-center">
                                                    <input type="text" value={variable.name} onChange={e => handleVariableChange(char.id, topic.id, variable.id, 'name', e.target.value)} placeholder="Variable Name" className={`col-span-2 bg-gray-800 rounded border border-gray-700 text-white p-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500`}/>
                                                    <select value={variable.type} onChange={e => handleVariableChange(char.id, topic.id, variable.id, 'type', e.target.value)} className={`col-span-2 bg-gray-800 rounded border border-gray-700 text-white p-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500`}>
                                                        <option value="slider">Slider</option>
                                                        <option value="text">Text</option>
                                                    </select>
                                                    <div className="col-span-3 flex items-center gap-2">
                                                        {variable.type === 'slider' ? (
                                                            <>
                                                                <input type="range" min="0" max="100" value={variable.value} onChange={e => handleVariableChange(char.id, topic.id, variable.id, 'value', Number(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"/>
                                                                <span className={`text-xs font-mono p-1 rounded w-10 text-center ${getScoreColor(Number(variable.value))}`}>{variable.value}</span>
                                                            </>
                                                        ) : (
                                                            <input type="text" value={variable.value} onChange={e => handleVariableChange(char.id, topic.id, variable.id, 'value', e.target.value)} placeholder="Value" className={`w-full bg-gray-800 rounded border border-gray-700 text-white p-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500`}/>
                                                        )}
                                                    </div>
                                                    <textarea value={variable.description} onChange={e => handleVariableChange(char.id, topic.id, variable.id, 'description', e.target.value)} placeholder="Description of impact..." rows={1} className={`col-span-4 bg-gray-800 rounded border border-gray-700 text-white p-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 resize-y`}/>
                                                    <button onClick={() => handleRemoveVariable(char.id, topic.id, variable.id)} className="col-span-1 text-red-500 hover:text-red-400 justify-self-end"><XMarkIcon className="w-4 h-4"/></button>
                                                </div>
                                            ))}
                                            <button onClick={() => handleAddVariable(char.id, topic.id)} className={`w-full text-xs py-1 mt-2 bg-gray-700/80 hover:bg-gray-700 text-primary-300 rounded`}>+ Add Variable</button>
                                        </div>
                                    )}
                            </div>
                            ))}
                            <button onClick={() => handleAddTopic(char.id)} className={`w-full text-sm py-1 mt-2 bg-gray-700/80 hover:bg-gray-700 text-primary-300 rounded`}>+ Add Topic</button>
                        </div>
                    </div>
                );
            })}
        </div>
        <div className="modal-footer">
          <div className="flex items-center gap-2">
            <button onClick={handleAnalyzeClick} disabled={isAnalyzing} className={`flex items-center gap-2 px-4 py-2 bg-gray-700 text-sm text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600 disabled:opacity-50`}>
                <SparklesIcon className="w-5 h-5"/>
                {isAnalyzing ? 'Analyzing...' : 'Analyze with AI'}
            </button>
            <button onClick={handleAddCharacter} className="px-4 py-2 bg-gray-700 text-sm text-white font-semibold rounded-md border border-gray-600 hover:bg-gray-600">Add Character</button>
          </div>
          <button onClick={handleSave} className={`px-5 py-2 bg-primary-800 text-white font-semibold rounded-md border border-primary-600 hover:bg-primary-700`}>Save Changes</button>
        </div>
      </div>
    </div>
  );
};

export default CharacterTrackerModal;