
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { setPage, setSearchQuery, setEditingCharacterId, showToast } from '../store/slices/uiSlice';
import { addCharacter, updateCharacter, deleteCharacter } from '../store/slices/charactersSlice';
import { Character, Setting, FirstMessage } from '../types';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { BookOpenIcon } from './icons/BookOpenIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { TrashIcon } from './icons/TrashIcon';
import { ArrowUpTrayIcon } from './icons/ArrowUpTrayIcon';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';
import { ChatBubbleLeftRightIcon } from './icons/ChatBubbleLeftRightIcon';
import { deleteChatsForCharacter } from '../store/thunks/gameThunks';
import { storageService } from '../services/storage';
import { SHARED_SYSTEM_INSTRUCTION_TEMPLATE, SHARED_USER_DESCRIPTION } from '../constants';
import ConfirmationModal from './ConfirmationModal';
import ChoiceModal, { ChoiceOption } from './ChoiceModal';
import { readCardFromPng, writeCardToPng, cardToCharacter, characterToCard, characterImageToPngBytes, compressAvatarDataUrl } from '../services/common/characterCard';

interface CharacterCardProps {
    character: Character;
    onSelect: () => void;
    onToggleExpand: (e: React.MouseEvent) => void;
    onExport: (e: React.MouseEvent) => void;
    onDeleteChats: (e: React.MouseEvent) => void;
    chatCount: number;
    isExpanded: boolean;
    themeColor: string;
}

const CharacterCard: React.FC<CharacterCardProps> = ({ character, onSelect, onToggleExpand, onExport, onDeleteChats, chatCount, isExpanded, themeColor }) => {
    const tags = (character.tags ?? []).filter(Boolean).slice(0, 3);

    return (
        <div
            onClick={onSelect}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
            className="group relative block w-full aspect-[3/4] rounded-xl overflow-hidden cursor-pointer bg-gray-800 ring-1 ring-white/5 shadow-lg transition-all duration-300 hover:ring-2 hover:ring-primary-500/70 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
            <img
                src={character.image}
                alt={character.name}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />

            {/* Bottom scrim for legible name */}
            <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black via-black/70 to-transparent" />

            {/* Hover action icons (top-right) */}
            <div className="absolute top-2 right-2 flex flex-col gap-2 opacity-100 translate-y-0 sm:opacity-0 sm:translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus-within:opacity-100 transition-all duration-200">
                <button
                    onClick={onToggleExpand}
                    className="p-2 bg-black/60 rounded-full backdrop-blur-sm text-gray-100 hover:bg-primary-600 hover:text-white transition-colors"
                    title="Quick edit"
                    aria-label="Quick edit character"
                >
                    <PencilSquareIcon className="w-4 h-4" />
                </button>
                <button
                    onClick={onExport}
                    className="p-2 bg-black/60 rounded-full backdrop-blur-sm text-gray-100 hover:bg-primary-600 hover:text-white transition-colors"
                    title="Export character"
                    aria-label="Export character"
                >
                    <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
                {chatCount > 0 && (
                    <button
                        onClick={onDeleteChats}
                        className="p-2 bg-black/60 rounded-full backdrop-blur-sm text-gray-100 hover:bg-red-600 hover:text-white transition-colors"
                        title={`Delete all chats with ${character.name}`}
                        aria-label={`Delete all chats with ${character.name}`}
                    >
                        <TrashIcon className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Name + tags */}
            <div className="absolute inset-x-0 bottom-0 p-3 z-10">
                <h3 className="font-bold text-lg leading-tight text-white drop-shadow-md line-clamp-2">{character.name}</h3>
                {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                        {tags.map(tag => (
                            <span key={tag} className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-white/10 text-gray-200 backdrop-blur-sm border border-white/10">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* "Chat" affordance on hover */}
            <div className="absolute inset-x-0 top-0 p-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide rounded-full bg-primary-600/90 text-white shadow-lg">
                    Open
                </span>
            </div>

            {/* Persistent chat-count badge (top-left) */}
            {chatCount > 0 && (
                <div className="absolute top-2 left-2 z-10 group-hover:opacity-0 transition-opacity duration-200">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-black/60 text-primary-200 backdrop-blur-sm border border-white/10">
                        <ChatBubbleLeftRightIcon className="w-3 h-3" />
                        {chatCount}
                    </span>
                </div>
            )}
        </div>
    );
};

// Inline Editor Component
const CharacterInlineEditor: React.FC<{ character: Character, themeColor: string, onClose: () => void }> = ({ character, themeColor, onClose }) => {
    const dispatch = useAppDispatch();
    const [name, setName] = useState(character.name);
    const [description, setDescription] = useState(character.personality);
    const [firstMessage, setFirstMessage] = useState(character.firstMessages?.[0]?.text ?? '');
    const [settingsList, setSettingsList] = useState<Setting[]>(
        (character.availableSettings && character.availableSettings.length > 0)
        ? character.availableSettings
        : [{ name: 'Default', content: character.setting }]
    );
    const [image, setImage] = useState(character.image);
    // Inline editor lets the user tweak greeting text; lore attachments are
    // preserved by position from the original character on save.
    const [alternateGreetings, setAlternateGreetings] = useState<string[]>(
        character.firstMessages?.slice(1).map(m => m.text) ?? []
    );
    const [confirmDelete, setConfirmDelete] = useState(false);
    
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSave = () => {
        if (!name.trim()) return;
        
        // Ensure valid settings list
        const finalSettings = settingsList.length > 0 ? settingsList : [{ name: 'Default', content: '' }];

        const existingFirstMessages = character.firstMessages ?? [];
        const updatedFirstMessages: FirstMessage[] = [
            { text: firstMessage, loreIds: existingFirstMessages[0]?.loreIds },
            ...alternateGreetings.map((text, i) => ({
                text,
                loreIds: existingFirstMessages[i + 1]?.loreIds,
            })),
        ];

        const updatedChar: Character = {
            ...character,
            name,
            personality: description,
            firstMessages: updatedFirstMessages,
            setting: finalSettings[0].content,
            availableSettings: finalSettings,
            image,
            lastModified: Date.now()
        };
        
        dispatch(updateCharacter(updatedChar));
        dispatch(showToast({ message: 'Character updated', type: 'success' }));
        onClose();
    };

    const handleDelete = () => {
        dispatch(deleteCharacter(character.id));
        dispatch(showToast({ message: 'Character deleted', type: 'success' }));
        onClose();
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = async () => setImage(await compressAvatarDataUrl(reader.result as string));
            reader.readAsDataURL(file);
        }
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

    return (
        <div className={`bg-gray-800 border-2 border-primary-600 rounded-xl p-6 animate-in fade-in zoom-in-95 duration-200 shadow-2xl relative h-full`}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Avatar Column */}
                <div className="flex flex-col gap-3">
                    <div 
                        className={`aspect-[3/4] w-full rounded-lg overflow-hidden border-2 border-dashed border-gray-600 hover:border-primary-500 cursor-pointer relative group bg-black/20`}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <img src={image} className="w-full h-full object-cover opacity-80 group-hover:opacity-40 transition-opacity" />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="font-bold text-white bg-black/50 px-3 py-1 rounded-full">Change Image</span>
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-400 uppercase">Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-sm focus:outline-none focus:border-blue-500" />
                    </div>
                </div>

                {/* Fields Column */}
                <div className="lg:col-span-2 space-y-4">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">Description / Personality</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={6} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-sm focus:outline-none focus:border-blue-500 resize-y font-mono" />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-400 uppercase">First Message</label>
                        <textarea value={firstMessage} onChange={e => setFirstMessage(e.target.value)} rows={4} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white text-sm focus:outline-none focus:border-blue-500 resize-y font-mono" />
                    </div>
                    
                    {/* Settings List */}
                    <div className="border border-gray-700 rounded-lg bg-gray-900/50 p-3">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-gray-400 uppercase">Settings</span>
                            <button onClick={addSetting} className="text-xs text-blue-400 hover:underline">+ Add</button>
                        </div>
                        <div className="space-y-3 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                            {settingsList.map((setting, i) => (
                                <div key={i} className="bg-gray-800 border border-gray-700 rounded p-2">
                                    <div className="flex justify-between items-center mb-1">
                                        <input 
                                            type="text" 
                                            value={setting.name} 
                                            onChange={(e) => updateSetting(i, 'name', e.target.value)} 
                                            className="bg-transparent border-b border-gray-600 text-xs font-bold text-gray-300 focus:outline-none focus:border-blue-500 w-2/3"
                                            placeholder="Scenario Name"
                                        />
                                        <button onClick={() => removeSetting(i)} className="text-red-500 hover:text-red-400" disabled={settingsList.length <= 1} title="Remove setting">
                                            <TrashIcon className="w-3 h-3"/>
                                        </button>
                                    </div>
                                    <textarea 
                                        value={setting.content} 
                                        onChange={(e) => updateSetting(i, 'content', e.target.value)} 
                                        rows={3} 
                                        className="w-full bg-gray-900 border border-gray-700 rounded p-1 text-xs text-white resize-y focus:outline-none focus:border-blue-500 font-mono"
                                        placeholder="Scenario content..."
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    {/* Alternate Greetings Accordion-ish */}
                    <div className="border border-gray-700 rounded-lg bg-gray-900/50 p-3">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-xs font-bold text-gray-400 uppercase">Alternate Greetings</span>
                            <button onClick={() => setAlternateGreetings([...alternateGreetings, ''])} className="text-xs text-blue-400 hover:underline">+ Add</button>
                        </div>
                        <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                            {alternateGreetings.map((greet, i) => (
                                <div key={i} className="flex gap-2">
                                    <textarea value={greet} onChange={e => {
                                        const newArr = [...alternateGreetings];
                                        newArr[i] = e.target.value;
                                        setAlternateGreetings(newArr);
                                    }} rows={2} className="flex-grow bg-gray-800 border border-gray-700 rounded p-1 text-xs text-white resize-y" />
                                    <button onClick={() => setAlternateGreetings(alternateGreetings.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-400"><TrashIcon className="w-4 h-4"/></button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer Actions */}
            <div className="flex flex-wrap justify-between items-center gap-3 mt-6 pt-4 border-t border-gray-700">
                <div className="flex gap-3">
                    <button
                        onClick={() => setConfirmDelete(true)}
                        className="px-4 py-2 bg-red-900/30 text-red-400 border border-red-900/50 rounded hover:bg-red-900/50 transition-colors text-sm font-semibold flex items-center gap-2"
                    >
                        <TrashIcon className="w-4 h-4" /> Delete
                    </button>
                    <button
                        onClick={() => {
                            dispatch(setEditingCharacterId(character.id));
                            dispatch(setPage('edit-character'));
                        }}
                        className="px-4 py-2 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 transition-colors text-sm font-semibold flex items-center gap-2"
                        title="Open the full editor (lore book, scenario, tags)"
                    >
                        <PencilSquareIcon className="w-4 h-4" /> Full Editor
                    </button>
                </div>
                <div className="flex gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm font-semibold">Cancel</button>
                    <button onClick={handleSave} className={`px-6 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg shadow-lg transition-colors text-sm font-bold`}>Save Changes</button>
                </div>
            </div>

            <ConfirmationModal
                isOpen={confirmDelete}
                title="Delete Character"
                message={`Are you sure you want to delete ${character.name}? This cannot be undone.`}
                onConfirm={handleDelete}
                onCancel={() => setConfirmDelete(false)}
                themeColor="red"
                confirmText="Delete Forever"
            />
        </div>
    );
};

interface CharacterSelectionPageProps {
  onSelectCharacter: (character: Character) => void;
  theme: string;
  onThemeChange: (theme: string) => void;
  themeColor: string;
}

const CharacterSelectionPage: React.FC<CharacterSelectionPageProps> = ({ onSelectCharacter, theme, onThemeChange, themeColor }) => {
  const dispatch = useAppDispatch();
  const characters = useAppSelector(state => state.characters.characters);
  const searchQuery = useAppSelector(state => state.ui.searchQuery);
  
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Saved-chat counts per character, so cards can badge history and offer a
  // "delete all chats" action. Rebuilt from the chat index whenever the roster
  // changes (import/edit/delete) — the index is the source of truth.
  const [chatCounts, setChatCounts] = useState<Record<string, number>>({});
  const refreshChatCounts = () => {
    const counts: Record<string, number> = {};
    Object.values(storageService.getChatIndex()).forEach(chat => {
      counts[chat.characterId] = (counts[chat.characterId] ?? 0) + 1;
    });
    setChatCounts(counts);
  };
  useEffect(() => { refreshChatCounts(); }, [characters]);

  // Delete-all-chats confirmation state
  const [chatsToDelete, setChatsToDelete] = useState<Character | null>(null);

  // Conflict Resolution State
  const [pendingImport, setPendingImport] = useState<Character | null>(null);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');

  const handleDeleteChats = (e: React.MouseEvent, character: Character) => {
    e.stopPropagation();
    setChatsToDelete(character);
  };

  const confirmDeleteChats = () => {
    if (!chatsToDelete) return;
    const character = chatsToDelete;
    void dispatch(deleteChatsForCharacter(character.id)).then(() => {
      refreshChatCounts();
      dispatch(showToast({ message: `Deleted all chats with ${character.name}.`, type: 'success' }));
      setChatsToDelete(null);
    });
  };

  const filteredCharacters = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return characters;
    return characters.filter(char => 
        char.name.toLowerCase().includes(query) || 
        char.tags?.some(tag => tag.toLowerCase().includes(query))
    );
  }, [characters, searchQuery]);

  const handleToggleExpand = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setExpandedId(prev => prev === id ? null : id);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };

  // Exports as a standard PNG character card (SillyTavern / chub.ai compatible);
  // falls back to plain card JSON when the avatar can't be turned into a PNG.
  const handleExportCharacter = async (e: React.MouseEvent, char: Character) => {
      e.stopPropagation();
      const card = characterToCard(char);
      const safeName = char.name.replace(/\s+/g, '_');
      try {
          const pngBytes = await characterImageToPngBytes(char);
          const cardBytes = writeCardToPng(pngBytes, card);
          downloadBlob(new Blob([cardBytes.buffer as ArrayBuffer], { type: 'image/png' }), `${safeName}.card.png`);
          dispatch(showToast({ message: `Exported ${char.name} as PNG card`, type: 'success' }));
      } catch (err) {
          console.error('PNG card export failed, falling back to JSON:', err);
          downloadBlob(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }), `${safeName}.json`);
          dispatch(showToast({ message: `Exported ${char.name} as JSON`, type: 'success' }));
      }
  };

  const importCharacterObject = (newChar: Character) => {
      const existingById = characters.find(c => c.id === newChar.id);
      const existingByName = characters.find(c => c.name.toLowerCase() === newChar.name.toLowerCase());

      if (existingById) {
          setPendingImport(newChar);
          setConflictMessage(`A character with ID "${existingById.id}" (${existingById.name}) already exists. Do you want to replace it (preserves chat history) or create a new copy?`);
          setConflictModalOpen(true);
      } else if (existingByName) {
          // If name matches but ID differs, we can still offer to replace (by taking existing ID)
          setPendingImport({ ...newChar, id: existingByName.id });
          setConflictMessage(`A character named "${existingByName.name}" already exists. Do you want to update it (preserves chat history) or create a new copy?`);
          setConflictModalOpen(true);
      } else {
          dispatch(addCharacter(newChar));
          dispatch(showToast({ message: 'Character imported!', type: 'success' }));
      }
  };

  // Accepts PNG character cards (V1/V2/V3 — SillyTavern, JanitorAI, chub.ai)
  // and card JSON files (same specs, including cards this app exported).
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
          importCharacterObject(character);
      } catch (err) {
          console.error(err);
          dispatch(showToast({ message: 'Failed to import character.', type: 'error' }));
      }
  };

  const resolveConflict = (choice: string) => {
      if (!pendingImport) return;

      if (choice === 'replace') {
          // Update existing character (ID matches pendingImport.id)
          dispatch(updateCharacter(pendingImport));
          dispatch(showToast({ message: 'Character updated successfully.', type: 'success' }));
      } else if (choice === 'new') {
          // Generate fresh ID
          const newCopy = { ...pendingImport, id: crypto.randomUUID(), name: `${pendingImport.name} (Copy)` };
          dispatch(addCharacter(newCopy));
          dispatch(showToast({ message: 'Imported as new character.', type: 'success' }));
      }

      setConflictModalOpen(false);
      setPendingImport(null);
  };

  return (
    <div className="bg-gray-900 text-white p-4 sm:p-6 lg:p-8 min-h-screen">
      <main className="max-w-8xl mx-auto">
        {/* Mobile search — the NavBar search bar is hidden on small screens */}
        <div className="md:hidden mb-4">
            <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <MagnifyingGlassIcon className="h-5 w-5 text-gray-500" />
                </div>
                <input
                    type="text"
                    className="block w-full pl-10 pr-10 py-2.5 border border-gray-700 rounded-xl bg-gray-800 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-sm"
                    placeholder="Search characters, tags..."
                    value={searchQuery}
                    onChange={(e) => dispatch(setSearchQuery(e.target.value))}
                />
                {searchQuery && (
                    <button
                        onClick={() => dispatch(setSearchQuery(''))}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300"
                        aria-label="Clear search"
                    >
                        <TrashIcon className="h-4 w-4" />
                    </button>
                )}
            </div>
        </div>

        <div className="flex justify-between items-center gap-3 mb-6">
            <div className="min-w-0">
                <h2 className="text-xl font-bold text-white">Characters</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                    {searchQuery
                        ? `${filteredCharacters.length} of ${characters.length} shown`
                        : `${characters.length} available`}
                </p>
            </div>
            <button
                onClick={() => fileInputRef.current?.click()}
                className={`flex items-center gap-2 px-4 py-2 bg-primary-900/40 text-sm text-primary-300 font-semibold rounded-md border border-primary-800 hover:bg-primary-900/60 hover:text-white transition-colors flex-shrink-0`}
            >
                <ArrowUpTrayIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Import Character</span>
                <span className="sm:hidden">Import</span>
            </button>
            <input type="file" ref={fileInputRef} onChange={handleImportFile} className="hidden" accept=".json,.png,image/png,application/json" />
        </div>

        {filteredCharacters.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 lg:gap-6">
                {filteredCharacters.map(char => (
                    <div
                        key={char.id}
                        className={`${expandedId === char.id ? 'col-span-2 sm:col-span-3 md:col-span-4 lg:col-span-5' : ''}`}
                    >
                        {expandedId === char.id ? (
                            <CharacterInlineEditor 
                                character={char} 
                                themeColor={themeColor} 
                                onClose={() => setExpandedId(null)} 
                            />
                        ) : (
                            <CharacterCard
                                character={char}
                                onSelect={() => onSelectCharacter(char)}
                                onToggleExpand={(e) => handleToggleExpand(e, char.id)}
                                onExport={(e) => handleExportCharacter(e, char)}
                                onDeleteChats={(e) => handleDeleteChats(e, char)}
                                chatCount={chatCounts[char.id] ?? 0}
                                isExpanded={false}
                                themeColor={themeColor}
                            />
                        )}
                    </div>
                ))}
            </div>
        ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl mt-8 px-6 text-center">
                {/* An empty roster is the first-run state, not a failed search. */}
                {characters.length === 0 ? (
                    <>
                        <ArrowUpTrayIcon className="w-16 h-16 mb-4 opacity-50" />
                        <p className="text-lg font-medium text-gray-400">No characters yet</p>
                        <p className="mt-1 text-sm max-w-md">
                            RWE ships without a roster. Import a character card (<span className="font-mono">.png</span> or{' '}
                            <span className="font-mono">.json</span>) to get started, or create one from scratch.
                            Cards from SillyTavern, chub.ai, and JanitorAI all work.
                        </p>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className={`mt-5 px-4 py-2 text-sm font-medium text-primary-400 hover:text-primary-300 hover:underline`}
                        >
                            Import a character card
                        </button>
                    </>
                ) : (
                    <>
                        <MagnifyingGlassIcon className="w-16 h-16 mb-4 opacity-50" />
                        <p className="text-lg font-medium">No characters found matching "{searchQuery}"</p>
                        <button
                            onClick={() => dispatch(setSearchQuery(''))}
                            className={`mt-4 px-4 py-2 text-sm font-medium text-primary-400 hover:text-primary-300 hover:underline`}
                        >
                            Clear Search
                        </button>
                    </>
                )}
            </div>
        )}
      </main>

      <ChoiceModal 
        isOpen={conflictModalOpen}
        title="Import Conflict"
        message={conflictMessage}
        choices={[
            { label: "Replace Existing (Preserve Chats)", value: 'replace', isPrimary: true },
            { label: "Import as New Copy", value: 'new' },
        ]}
        onChoice={resolveConflict}
        onCancel={() => { setConflictModalOpen(false); setPendingImport(null); }}
        themeColor={themeColor}
      />

      <ConfirmationModal
        isOpen={chatsToDelete !== null}
        title="Delete All Chats"
        message={chatsToDelete
            ? `Delete all ${chatCounts[chatsToDelete.id] ?? 0} ${(chatCounts[chatsToDelete.id] ?? 0) === 1 ? 'chat' : 'chats'} with ${chatsToDelete.name}? This action cannot be undone. The character itself will not be deleted.`
            : ''}
        onConfirm={confirmDeleteChats}
        onCancel={() => setChatsToDelete(null)}
        themeColor="red"
        confirmText="Delete All"
      />
    </div>
  );
};

export default CharacterSelectionPage;
