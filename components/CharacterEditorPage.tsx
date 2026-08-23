
import React, { useState, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setPage, showToast } from '../store/slices/uiSlice';
import { addCharacter, updateCharacter } from '../store/slices/charactersSlice';
import { Character, Setting, FirstMessage, LoreEntry, LoreEntryType } from '../types';
import { ArrowLeftIcon } from './icons/ArrowLeftIcon';
import { ArrowUpTrayIcon } from './icons/ArrowUpTrayIcon';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';
import { TrashIcon } from './icons/TrashIcon';
import { SHARED_SYSTEM_INSTRUCTION_TEMPLATE, SHARED_USER_DESCRIPTION } from '../constants';
import { readCardFromPng, cardToCharacter, characterToCard, compressAvatarDataUrl } from '../services/common/characterCard';

interface CharacterEditorPageProps {
    themeColor: string;
    characterIdToEdit?: string | null;
}

const CharacterEditorPage: React.FC<CharacterEditorPageProps> = ({ themeColor, characterIdToEdit }) => {
    const dispatch = useAppDispatch();
    const characters = useAppSelector(state => state.characters.characters);
    
    // Form State
    const [name, setName] = useState('');
    const [description, setDescription] = useState(''); // Personality/Description
    const [image, setImage] = useState('');
    // firstMessages[0] is the primary greeting; rest are alternatives. We keep the
    // full FirstMessage objects (incl. loreIds) in state so loreIds aren't lost
    // on save just because the editor doesn't surface them yet.
    const [firstMessages, setFirstMessages] = useState<FirstMessage[]>([{ text: '' }]);
    const [settingsList, setSettingsList] = useState<Setting[]>([]);
    const [scenario, setScenario] = useState('');
    const [loreBook, setLoreBook] = useState<LoreEntry[]>([]);
    const [tags, setTags] = useState('');
    // Raw text of each entry's keys field, so typing commas/spaces isn't
    // normalized away mid-edit. Parsed keys are kept in sync on every change.
    const [keysDrafts, setKeysDrafts] = useState<Record<string, string>>({});
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const jsonInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (characterIdToEdit) {
            const char = characters.find(c => c.id === characterIdToEdit);
            if (char) {
                setName(char.name);
                setDescription(char.personality);
                setFirstMessages(char.firstMessages.length > 0 ? char.firstMessages : [{ text: '' }]);
                setImage(char.image);
                setScenario(char.scenario || '');
                setLoreBook(char.loreBook ?? []);
                setTags((char.tags ?? []).join(', '));
                setKeysDrafts({});

                // Initialize Settings List
                if (char.availableSettings && char.availableSettings.length > 0) {
                    setSettingsList(char.availableSettings);
                } else {
                    // Fallback for legacy
                    setSettingsList([{ name: 'Default Setting', content: char.setting }]);
                }
            }
        } else {
            // Defaults for new character
            setSettingsList([{ name: 'Default Setting', content: '' }]);
            setScenario('');
            setFirstMessages([{ text: '' }]);
            setLoreBook([]);
            setTags('');
            setKeysDrafts({});
        }
    }, [characterIdToEdit, characters]);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = async () => {
                setImage(await compressAvatarDataUrl(reader.result as string));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSave = () => {
        if (!name.trim() || !description.trim() || !firstMessages[0]?.text.trim()) {
            dispatch(showToast({ message: 'Name, Personality, and First Message are required.', type: 'error' }));
            return;
        }

        // Ensure at least one setting exists (even if empty)
        const finalSettings = settingsList.length > 0 ? settingsList : [{ name: 'Default', content: '' }];
        // The active 'setting' property is legacy/default, taking the first one
        const primarySettingContent = finalSettings[0].content;

        const finalLoreBook = loreBook
            .map(e => ({ ...e, name: e.name.trim(), content: e.content.trim() }))
            .filter(e => e.content !== '');

        const characterData: Character = {
            id: characterIdToEdit || crypto.randomUUID(),
            name: name.trim(),
            image: image || 'https://via.placeholder.com/400x600?text=No+Image',
            personality: description,
            firstMessages: firstMessages.filter(m => m.text.trim() !== '' || (m.loreIds && m.loreIds.length > 0)),
            systemInstructionTemplate: SHARED_SYSTEM_INSTRUCTION_TEMPLATE, // Use standard template
            playerDescription: SHARED_USER_DESCRIPTION, // Default placeholder
            setting: primarySettingContent,
            scenario: scenario.trim() || undefined,
            availableSettings: finalSettings,
            loreBook: finalLoreBook.length > 0 ? finalLoreBook : undefined,
            playerName: 'User', // Default placeholder
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
            lastModified: Date.now()
        };

        if (characterIdToEdit) {
            dispatch(updateCharacter(characterData));
            dispatch(showToast({ message: 'Character updated!', type: 'success' }));
        } else {
            dispatch(addCharacter(characterData));
            dispatch(showToast({ message: 'Character created!', type: 'success' }));
        }

        dispatch(setPage('selection'));
    };

    const countTokens = (text: string) => text.split(/\s+/).filter(Boolean).length;
    // Calculate totals for primary
    const primarySetting = settingsList[0]?.content || '';
    const primaryFirstMessage = firstMessages[0]?.text || '';
    const totalTokens = countTokens(description) + countTokens(primarySetting) + countTokens(primaryFirstMessage);

    const updateFirstMessageText = (index: number, val: string) => {
        setFirstMessages(firstMessages.map((m, i) => i === index ? { ...m, text: val } : m));
    };
    const addGreeting = () => setFirstMessages([...firstMessages, { text: '' }]);
    const removeGreeting = (index: number) => {
        // Index 0 is the primary greeting and stays — only alternatives can be removed.
        if (index === 0) return;
        setFirstMessages(firstMessages.filter((_, i) => i !== index));
    };

    const addSetting = () => setSettingsList([...settingsList, { name: `Setting Variant ${settingsList.length + 1}`, content: '' }]);
    const updateSetting = (index: number, field: keyof Setting, val: string) => {
        const newSettings = [...settingsList];
        newSettings[index] = { ...newSettings[index], [field]: val };
        setSettingsList(newSettings);
    };
    const removeSetting = (index: number) => {
        if (settingsList.length <= 1) {
             dispatch(showToast({ message: 'Must have at least one setting.', type: 'error' }));
             return;
        }
        setSettingsList(settingsList.filter((_, i) => i !== index));
    };

    const addLoreEntry = () => setLoreBook([
        ...loreBook,
        { id: crypto.randomUUID(), name: '', content: '', type: 'setting', keys: [] },
    ]);
    const updateLoreEntry = (id: string, patch: Partial<LoreEntry>) => {
        setLoreBook(loreBook.map(e => e.id === id ? { ...e, ...patch } : e));
    };
    const removeLoreEntry = (id: string) => setLoreBook(loreBook.filter(e => e.id !== id));
    const loreKeysValue = (entry: LoreEntry) => keysDrafts[entry.id] ?? (entry.keys ?? []).join(', ');
    const onLoreKeysChange = (id: string, raw: string) => {
        setKeysDrafts(prev => ({ ...prev, [id]: raw }));
        updateLoreEntry(id, { keys: raw.split(',').map(s => s.trim()).filter(Boolean) });
    };

    const formAsCharacter = (): Character => ({
        id: characterIdToEdit || crypto.randomUUID(),
        name,
        image,
        personality: description,
        firstMessages,
        systemInstructionTemplate: SHARED_SYSTEM_INSTRUCTION_TEMPLATE,
        playerDescription: SHARED_USER_DESCRIPTION,
        setting: settingsList[0]?.content ?? '',
        scenario: scenario.trim() || undefined,
        availableSettings: settingsList,
        loreBook: loreBook.length > 0 ? loreBook : undefined,
        playerName: 'User',
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
    });

    const handleExport = () => {
         const blob = new Blob([JSON.stringify(characterToCard(formAsCharacter()), null, 2)], { type: 'application/json' });
         const url = URL.createObjectURL(blob);
         const link = document.createElement('a');
         link.href = url;
         link.download = `${name.replace(/\s+/g, '_')}.json`;
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
         URL.revokeObjectURL(url);
    };

    // Fills the form from a card file: PNG cards (SillyTavern/JanitorAI/chub.ai)
    // or card JSON (V1/V2/V3, including cards this app exported).
    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        try {
            let json: any;
            let imageDataUrl: string | undefined;

            if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
                const bytes = new Uint8Array(await file.arrayBuffer());
                json = readCardFromPng(bytes);
                if (!json) {
                    dispatch(showToast({ message: 'No character card found in this PNG.', type: 'error' }));
                    return;
                }
                imageDataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = () => reject(new Error('Failed to read image'));
                    reader.readAsDataURL(file);
                });
                imageDataUrl = await compressAvatarDataUrl(imageDataUrl);
            } else {
                json = JSON.parse(await file.text());
            }

            const { character } = cardToCharacter(json, SHARED_SYSTEM_INSTRUCTION_TEMPLATE, SHARED_USER_DESCRIPTION, imageDataUrl);
            setName(character.name === 'Unknown' ? '' : character.name);
            setDescription(character.personality);
            setImage(character.image.startsWith('http') && character.image.includes('placeholder') ? '' : character.image);
            setFirstMessages(character.firstMessages.length > 0 ? character.firstMessages : [{ text: '' }]);
            setScenario(character.scenario ?? '');
            setSettingsList(character.availableSettings && character.availableSettings.length > 0
                ? character.availableSettings
                : [{ name: 'Default Setting', content: character.setting }]);
            setLoreBook(character.loreBook ?? []);
            setTags((character.tags ?? []).join(', '));
            setKeysDrafts({});

            dispatch(showToast({ message: 'Character data imported.', type: 'success' }));
        } catch (err) {
            console.error(err);
            dispatch(showToast({ message: 'Failed to import character file.', type: 'error' }));
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6">
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                        <button onClick={() => dispatch(setPage('selection'))} className="text-gray-400 hover:text-white transition-colors">
                            <ArrowLeftIcon className="w-6 h-6" />
                        </button>
                        <h1 className={`text-3xl font-bold text-primary-400`}>
                            {characterIdToEdit ? 'Edit Character' : 'Create a Character'}
                        </h1>
                    </div>
                    <div className="flex gap-3">
                        <input type="file" ref={jsonInputRef} onChange={handleImport} className="hidden" accept=".json,.png,image/png,application/json" />
                        <button onClick={() => jsonInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-300 rounded-md hover:bg-gray-700">
                            <ArrowUpTrayIcon className="w-4 h-4" /> Import Card
                        </button>
                         <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-300 rounded-md hover:bg-gray-700">
                            <ArrowDownTrayIcon className="w-4 h-4" /> Export JSON
                        </button>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-8">
                    {/* Left Column: Image */}
                    <div className="w-full lg:w-1/3 flex flex-col gap-4">
                        <div 
                            className={`aspect-[3/4] w-full bg-gray-800 rounded-xl border-2 border-dashed border-gray-600 hover:border-primary-500 flex flex-col items-center justify-center cursor-pointer relative overflow-hidden group transition-colors`}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            {image ? (
                                <img src={image} alt="Character Preview" className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-center p-6">
                                    <ArrowUpTrayIcon className="w-12 h-12 text-gray-500 mx-auto mb-2" />
                                    <span className="text-gray-400 font-medium">Click to upload Avatar</span>
                                </div>
                            )}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <span className="text-white font-bold">Change Image</span>
                            </div>
                            <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                        </div>
                         <div className="text-xs text-gray-500 text-center">
                            Supported: JPG, PNG, WEBP. (Images are stored locally)
                        </div>
                    </div>

                    {/* Right Column: Fields */}
                    <div className="w-full lg:w-2/3 space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Character Name *</label>
                            <input 
                                type="text" 
                                value={name} 
                                onChange={e => setName(e.target.value)}
                                className={`w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none`}
                                placeholder="e.g., Alastor"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between mb-1">
                                <label className="block text-sm font-medium text-gray-400">Description / Personality *</label>
                            </div>
                            <p className="text-xs text-gray-500 mb-2">Defines <b>WHO</b> the character is: their internal logic, speech patterns, traits, and behavior.</p>
                            <textarea 
                                value={description} 
                                onChange={e => setDescription(e.target.value)}
                                rows={6}
                                className={`w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-y font-mono text-sm`}
                                placeholder="Describe the character's personality, appearance, and behavior..."
                            />
                        </div>

                         <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Setting (World / Location)</label>
                            <p className="text-xs text-gray-500 mb-3">Defines <b>WHERE</b> they are: world rules and the location. You can create multiple variants to choose from when starting a chat. Scene-specific framing (the "what is happening right now") lives in <b>Scenario</b> below.</p>
                            
                            <div className="space-y-4">
                                {settingsList.map((setting, idx) => (
                                    <div key={idx} className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                        <div className="flex justify-between items-center mb-2">
                                            <input 
                                                type="text" 
                                                value={setting.name} 
                                                onChange={e => updateSetting(idx, 'name', e.target.value)}
                                                className={`bg-transparent border-b border-gray-600 text-primary-300 font-semibold text-sm focus:outline-none focus:border-primary-500 w-2/3`}
                                                placeholder="Setting Variant Name"
                                            />
                                            <button onClick={() => removeSetting(idx)} className="text-red-400 hover:bg-red-900/30 p-1.5 rounded transition-colors" title="Delete Setting Variant">
                                                <TrashIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <textarea
                                            value={setting.content}
                                            onChange={e => updateSetting(idx, 'content', e.target.value)}
                                            rows={4}
                                            className={`w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-y font-mono text-sm`}
                                            placeholder="Write the setting/world/location details..."
                                        />
                                    </div>
                                ))}
                                <button onClick={addSetting} className={`flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300 hover:underline px-2`}>
                                    <span>+ Add New Setting Variant</span>
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Scenario</label>
                            <p className="text-xs text-gray-500 mb-2">Defines <b>WHAT IS HAPPENING</b> in this scene: situations, mechanics, framing. Optional — leave empty if the first message alone is enough context. Independent from Setting.</p>
                            <textarea
                                value={scenario}
                                onChange={e => setScenario(e.target.value)}
                                rows={4}
                                className={`w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-y font-mono text-sm`}
                                placeholder="e.g., {{char}} and {{user}} are riding a crowded train; {{char}} is silently hoping to be groped."
                            />
                        </div>

                         <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="block text-sm font-medium text-gray-400">First Message *</label>
                                {firstMessages[0]?.loreIds && firstMessages[0].loreIds.length > 0 && (
                                    <span className="text-xs text-primary-400/80" title="Lore book entries attached to this greeting">
                                        {firstMessages[0].loreIds.length} lore {firstMessages[0].loreIds.length === 1 ? 'entry' : 'entries'} attached
                                    </span>
                                )}
                            </div>
                            <textarea
                                value={firstMessages[0]?.text ?? ''}
                                onChange={e => updateFirstMessageText(0, e.target.value)}
                                rows={4}
                                className={`w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-y font-mono text-sm`}
                                placeholder="The starting message sent by the character."
                            />
                        </div>

                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                            <label className="block text-sm font-medium text-gray-400 mb-3">Alternative Greetings</label>
                            {firstMessages.slice(1).map((greeting, i) => {
                                const idx = i + 1;
                                const loreCount = greeting.loreIds?.length ?? 0;
                                return (
                                    <div key={idx} className="flex gap-2 mb-2">
                                        <div className="flex-grow flex flex-col gap-1">
                                            <textarea
                                                value={greeting.text}
                                                onChange={e => updateFirstMessageText(idx, e.target.value)}
                                                rows={2}
                                                className={`w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm focus:border-primary-500 outline-none resize-y`}
                                            />
                                            {loreCount > 0 && (
                                                <span className="text-[10px] text-primary-400/70 px-1">
                                                    {loreCount} lore {loreCount === 1 ? 'entry' : 'entries'} attached
                                                </span>
                                            )}
                                        </div>
                                        <button onClick={() => removeGreeting(idx)} className="text-red-400 hover:bg-red-900/30 p-2 rounded self-start">
                                            <TrashIcon className="w-5 h-5" />
                                        </button>
                                    </div>
                                );
                            })}
                            <button onClick={addGreeting} className={`text-sm text-primary-400 hover:underline`}>+ Add Greeting</button>
                        </div>

                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                            <label className="block text-sm font-medium text-gray-400 mb-1">Lore Book (World Info)</label>
                            <p className="text-xs text-gray-500 mb-3">
                                Entries with <b>trigger keys</b> are injected into the prompt only when a key appears in the recent story (keeps big lorebooks cheap).
                                <b> Always</b> entries are injected every turn. Entries without keys can be attached to specific greetings.
                            </p>
                            <div className="space-y-3">
                                {loreBook.map(entry => (
                                    <div key={entry.id} className="bg-gray-900 border border-gray-700 rounded-lg p-3 space-y-2">
                                        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                            <input
                                                type="text"
                                                value={entry.name}
                                                onChange={e => updateLoreEntry(entry.id, { name: e.target.value })}
                                                className={`flex-grow min-w-0 bg-transparent border-b border-gray-600 text-primary-300 font-semibold text-sm focus:outline-none focus:border-primary-500 py-1`}
                                                placeholder="Entry name (e.g. Dragons)"
                                            />
                                            <div className="flex items-center gap-3 flex-shrink-0">
                                                <select
                                                    value={entry.type}
                                                    onChange={e => updateLoreEntry(entry.id, { type: e.target.value as LoreEntryType })}
                                                    className="bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-300 p-1.5 focus:border-primary-500 outline-none"
                                                    title="Where greeting-bound composition places this entry. Keyword-triggered injection works for any type."
                                                >
                                                    <option value="setting">Setting</option>
                                                    <option value="scenario">Scenario</option>
                                                    <option value="character">Character</option>
                                                </select>
                                                <label className="flex items-center gap-1.5 text-xs text-gray-400 select-none cursor-pointer" title="Inject every turn, regardless of keys">
                                                    <input
                                                        type="checkbox"
                                                        checked={entry.alwaysActive === true}
                                                        onChange={e => updateLoreEntry(entry.id, { alwaysActive: e.target.checked })}
                                                        className="accent-primary-500"
                                                    />
                                                    Always
                                                </label>
                                                <label className="flex items-center gap-1.5 text-xs text-gray-400 select-none cursor-pointer" title="Keep the entry but never inject it">
                                                    <input
                                                        type="checkbox"
                                                        checked={entry.disabled === true}
                                                        onChange={e => updateLoreEntry(entry.id, { disabled: e.target.checked })}
                                                        className="accent-primary-500"
                                                    />
                                                    Off
                                                </label>
                                                <button onClick={() => removeLoreEntry(entry.id)} className="text-red-400 hover:bg-red-900/30 p-1.5 rounded transition-colors" title="Delete entry">
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                        <input
                                            type="text"
                                            value={loreKeysValue(entry)}
                                            onChange={e => onLoreKeysChange(entry.id, e.target.value)}
                                            className={`w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-white text-sm focus:border-primary-500 outline-none`}
                                            placeholder="Trigger keys, comma-separated (e.g. dragon, wyrm, Dragonspire)"
                                        />
                                        <textarea
                                            value={entry.content}
                                            onChange={e => updateLoreEntry(entry.id, { content: e.target.value })}
                                            rows={3}
                                            className={`w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-white text-sm focus:border-primary-500 outline-none resize-y font-mono`}
                                            placeholder="The lore content injected into the prompt. Supports {{char}} and {{user}}."
                                        />
                                    </div>
                                ))}
                            </div>
                            <button onClick={addLoreEntry} className={`text-sm text-primary-400 hover:underline mt-3`}>+ Add Lore Entry</button>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Tags</label>
                            <input
                                type="text"
                                value={tags}
                                onChange={e => setTags(e.target.value)}
                                className={`w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none`}
                                placeholder="Comma-separated, used by search (e.g. fantasy, OC, romance)"
                            />
                        </div>

                        <div className="flex justify-between items-center pt-4 border-t border-gray-800">
                            <div className="text-sm text-gray-500">
                                Total Token Estimate: <span className={`font-mono text-primary-400`}>{totalTokens}</span>
                            </div>
                            <div className="flex gap-4">
                                <button onClick={() => dispatch(setPage('selection'))} className="px-6 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors">Cancel</button>
                                <button onClick={handleSave} className={`px-8 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-500 transition-colors shadow-lg shadow-primary-900/20`}>
                                    {characterIdToEdit ? 'Update Character' : 'Create Character'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CharacterEditorPage;
