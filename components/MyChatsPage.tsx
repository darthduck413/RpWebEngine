
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { storageService, ChatSummary, StorageUsage } from '../services/storage';
import { TrashIcon } from './icons/TrashIcon';
import { ChatBubbleLeftRightIcon } from './icons/ChatBubbleLeftRightIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';
import { ArrowUpTrayIcon } from './icons/ArrowUpTrayIcon';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { deleteGameSession, deleteChatsForCharacter, loadGameSession } from '../store/thunks/gameThunks';
import { setPage, setSelectedCharacter, showToast } from '../store/slices/uiSlice';
import { loadSettings } from '../store/slices/settingsSlice';
import { setPersonas } from '../store/slices/personaSlice';
import { setCharacters } from '../store/slices/charactersSlice';
import { Character } from '../types';
import ConfirmationModal from './ConfirmationModal';

interface MyChatsPageProps {
    themeColor: string;
}

const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const StorageUsageBar: React.FC<{ usage: StorageUsage }> = ({ usage }) => {
    const pct = Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100);
    const chatPct = Math.min(100, (usage.chatsBytes / usage.quotaBytes) * 100);
    const tone =
        pct >= 85 ? { bar: 'bg-red-500', text: 'text-red-300', border: 'border-red-700/50', bg: 'bg-red-900/20' } :
        pct >= 65 ? { bar: 'bg-amber-500', text: 'text-amber-300', border: 'border-amber-700/50', bg: 'bg-amber-900/20' } :
        { bar: 'bg-primary-500', text: 'text-primary-300', border: 'border-primary-800/50', bg: 'bg-primary-900/10' };

    return (
        <div className={`mb-6 p-3 sm:p-4 rounded-lg border ${tone.border} ${tone.bg}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <div className="flex items-baseline gap-2">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${tone.text}`}>Local storage</span>
                    {pct >= 85 && (
                        <span className="text-xs text-red-300 italic">— close to quota, export & prune to avoid losing chats</span>
                    )}
                </div>
                <span className="text-xs text-gray-400 font-mono">
                    {formatBytes(usage.usedBytes)} / {formatBytes(usage.quotaBytes)} ({pct.toFixed(1)}%)
                </span>
            </div>
            <div className="relative w-full h-2 bg-gray-800 rounded-full overflow-hidden" title={`Chats: ${formatBytes(usage.chatsBytes)} · Other: ${formatBytes(usage.usedBytes - usage.chatsBytes)}`}>
                {/* Total used */}
                <div className={`absolute inset-y-0 left-0 ${tone.bar} opacity-60`} style={{ width: `${pct}%` }} />
                {/* Chats sub-segment (darker) */}
                <div className={`absolute inset-y-0 left-0 ${tone.bar}`} style={{ width: `${chatPct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-gray-500 mt-1.5">
                <span>Chats {formatBytes(usage.chatsBytes)}</span>
                <span>Other {formatBytes(usage.usedBytes - usage.chatsBytes)}</span>
            </div>
        </div>
    );
};

interface CharacterGroup {
    characterId: string;
    characterName: string;
    chats: ChatSummary[];
    lastActive: number;
}

type SortMode = 'recent' | 'name' | 'count';

const SORT_STORAGE_KEY = 'hv_mychats_sort';

const SORT_LABELS: Record<SortMode, string> = {
    recent: 'Recently active',
    name: 'Name (A–Z)',
    count: 'Most chats',
};

const loadSortMode = (): SortMode => {
    const stored = localStorage.getItem(SORT_STORAGE_KEY);
    return stored === 'recent' || stored === 'name' || stored === 'count' ? stored : 'name';
};

const MyChatsPage: React.FC<MyChatsPageProps> = ({ themeColor }) => {
    const dispatch = useAppDispatch();
    const storedCharacters = useAppSelector(state => state.characters.characters);
    const [chatGroups, setChatGroups] = useState<CharacterGroup[]>([]);
    const [usage, setUsage] = useState<StorageUsage | null>(null);
    const [expandedCharacterId, setExpandedCharacterId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);
    
    // Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
    }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });


    useEffect(() => {
        loadChats();
    }, []);

    const loadChats = () => {
        const index = storageService.getChatIndex();
        const allChats = Object.values(index).sort((a, b) => b.timestamp - a.timestamp);

        // Group by Character ID
        const groups: Record<string, CharacterGroup> = {};

        allChats.forEach(chat => {
            if (!groups[chat.characterId]) {
                groups[chat.characterId] = {
                    characterId: chat.characterId,
                    characterName: chat.characterName,
                    chats: [],
                    lastActive: 0,
                };
            }
            groups[chat.characterId].chats.push(chat);
            groups[chat.characterId].lastActive = Math.max(groups[chat.characterId].lastActive, chat.timestamp);
        });

        setChatGroups(Object.values(groups));
        setUsage(storageService.getStorageUsage());
    };

    // Search + sort are applied here (not baked into stored order), so the raw
    // list never mutates under the user. Sorting is an explicit, persisted choice
    // — the default is alphabetical so cards keep a stable position between visits
    // instead of leaping around by recency every time a chat is touched.
    const displayGroups = useMemo(() => {
        const query = search.toLowerCase().trim();
        const filtered = query
            ? chatGroups.filter(g => g.characterName.toLowerCase().includes(query))
            : chatGroups;
        const sorted = [...filtered];
        if (sortMode === 'name') {
            sorted.sort((a, b) => a.characterName.localeCompare(b.characterName));
        } else if (sortMode === 'count') {
            sorted.sort((a, b) => b.chats.length - a.chats.length || a.characterName.localeCompare(b.characterName));
        } else {
            sorted.sort((a, b) => b.lastActive - a.lastActive);
        }
        return sorted;
    }, [chatGroups, search, sortMode]);

    const totalChats = useMemo(() => chatGroups.reduce((sum, g) => sum + g.chats.length, 0), [chatGroups]);

    const handleSortChange = (mode: SortMode) => {
        setSortMode(mode);
        localStorage.setItem(SORT_STORAGE_KEY, mode);
    };

    const handleDeleteGroupClick = (e: React.MouseEvent, group: CharacterGroup) => {
        e.stopPropagation();
        setConfirmModal({
            isOpen: true,
            title: 'Delete All Chats',
            message: `Delete all ${group.chats.length} ${group.chats.length === 1 ? 'chat' : 'chats'} with ${group.characterName}? This action cannot be undone.`,
            onConfirm: () => performDeleteGroup(group.characterId),
        });
    };

    const performDeleteGroup = (characterId: string) => {
        void dispatch(deleteChatsForCharacter(characterId)).then(() => {
            loadChats();
            setExpandedCharacterId(prev => (prev === characterId ? null : prev));
            dispatch(showToast({ message: 'All chats deleted.', type: 'success' }));
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
        });
    };

    const handleDeleteChatClick = (e: React.MouseEvent, chatId: string) => {
        e.stopPropagation();
        setConfirmModal({
            isOpen: true,
            title: 'Delete Conversation',
            message: 'Are you sure you want to delete this chat? This action cannot be undone.',
            onConfirm: () => performDeleteChat(chatId)
        });
    };

    const performDeleteChat = (chatId: string) => {
        void dispatch(deleteGameSession(chatId)).then(() => {
            loadChats();
            dispatch(showToast({ message: 'Chat deleted successfully.', type: 'success' }));
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
        });
    };

    const handleContinueChat = (chat: ChatSummary) => {
        const character = storedCharacters.find(c => c.id === chat.characterId);
        
        if (character) {
            dispatch(loadGameSession(chat.id));
            dispatch(setSelectedCharacter(character));
            dispatch(setPage('chat'));
        } else {
             dispatch(showToast({ message: "The character for this chat no longer exists in the registry.", type: 'error' }));
        }
    };

    const getRelativeTime = (timestamp: number) => {
        const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        const diffInSeconds = (timestamp - Date.now()) / 1000;
        if (Math.abs(diffInSeconds) < 60) return rtf.format(Math.round(diffInSeconds), 'second');
        if (Math.abs(diffInSeconds) < 3600) return rtf.format(Math.round(diffInSeconds / 60), 'minute');
        if (Math.abs(diffInSeconds) < 86400) return rtf.format(Math.round(diffInSeconds / 3600), 'hour');
        return rtf.format(Math.round(diffInSeconds / 86400), 'day');
    };

    const toggleExpand = (characterId: string) => {
        setExpandedCharacterId(prev => prev === characterId ? null : characterId);
    };

    const handleExportAll = () => {
        try {
            const backup = storageService.exportAllData();
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `rwe-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            dispatch(showToast({ message: 'Backup exported successfully.', type: 'success' }));
        } catch (e) {
            console.error("Export failed", e);
            dispatch(showToast({ message: 'Failed to export data.', type: 'error' }));
        }
    };

    const handleExportChats = () => {
        try {
            const backup = storageService.exportChatsOnly();
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `rwe-chats-only-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            dispatch(showToast({ message: 'Chats exported successfully.', type: 'success' }));
        } catch (e) {
            console.error("Chat export failed", e);
            dispatch(showToast({ message: 'Failed to export chats.', type: 'error' }));
        }
    };

    const triggerImport = () => {
        setConfirmModal({
            isOpen: true,
            title: 'Import Full Backup',
            message: 'Warning: Importing a full backup will overwrite ALL current settings, characters, and chats. Do you want to proceed?',
            onConfirm: () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                fileInputRef.current?.click();
            }
        });
    };

    const triggerChatImport = () => {
        setConfirmModal({
            isOpen: true,
            title: 'Import Chats Only',
            message: 'This will add chats from the file to your current list. Existing chats with the same ID will be overwritten. Do you want to proceed?',
            onConfirm: () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                chatInputRef.current?.click();
            }
        });
    };

    const handleImportAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                storageService.importAllData(data);
                loadChats();

                // Rehydrate Redux State
                const settings = storageService.loadSettings();
                if (settings) dispatch(loadSettings(settings));

                const personasData = storageService.loadPersonas();
                if (personasData) {
                    dispatch(setPersonas({
                        personas: personasData.personas,
                        activeId: personasData.activePersonaId
                    }));
                }

                const customCharacters = storageService.loadCharacters();
                const characterMap = new Map<string, Character>();
                customCharacters.forEach(c => characterMap.set(c.id, c));
                dispatch(setCharacters(Array.from(characterMap.values())));

                dispatch(showToast({ message: 'Backup imported successfully.', type: 'success' }));
            } catch (err) {
                console.error(err);
                dispatch(showToast({ message: 'Failed to import backup. File may be invalid.', type: 'error' }));
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleImportChats = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                storageService.importChatsOnly(data);
                loadChats();
                dispatch(showToast({ message: 'Chats imported successfully.', type: 'success' }));
            } catch (err) {
                console.error(err);
                dispatch(showToast({ message: 'Failed to import chats. File may be invalid.', type: 'error' }));
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
             <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <h1 className={`text-3xl font-bold text-primary-400 flex items-center gap-3`}>
                            <ChatBubbleLeftRightIcon className="w-8 h-8" />
                            My Chats
                        </h1>
                        <p className="text-gray-400 mt-1 text-sm">
                            {chatGroups.length > 0
                                ? `${totalChats} ${totalChats === 1 ? 'chat' : 'chats'} across ${chatGroups.length} ${chatGroups.length === 1 ? 'character' : 'characters'}.`
                                : 'Resume your adventures or manage your history.'}
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                         {/* Inputs */}
                         <input type="file" ref={fileInputRef} onChange={handleImportAll} className="hidden" accept=".json" />
                         <input type="file" ref={chatInputRef} onChange={handleImportChats} className="hidden" accept=".json" />
                        
                        <div className="flex gap-2">
                            <button 
                                onClick={triggerChatImport}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-800 text-xs text-gray-300 font-semibold rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                            >
                                <ArrowUpTrayIcon className="w-4 h-4" />
                                Import Chats
                            </button>
                            <button 
                                onClick={handleExportChats}
                                className={`flex items-center gap-2 px-3 py-2 bg-gray-800 text-xs text-gray-300 font-semibold rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors`}
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" />
                                Export Chats
                            </button>
                        </div>
                        
                        <div className="w-px bg-gray-700 mx-1 hidden sm:block"></div>

                        <div className="flex gap-2">
                            <button 
                                onClick={triggerImport}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-800 text-xs text-gray-300 font-semibold rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                            >
                                <ArrowUpTrayIcon className="w-4 h-4" />
                                Import Full
                            </button>
                            <button 
                                onClick={handleExportAll}
                                className={`flex items-center gap-2 px-3 py-2 bg-primary-900/40 text-xs text-primary-300 font-semibold rounded-md border border-primary-800 hover:bg-primary-900/60 hover:text-white transition-colors`}
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" />
                                Export Full
                            </button>
                        </div>
                    </div>
                </div>

                {usage && <StorageUsageBar usage={usage} />}

                {chatGroups.length > 0 && (
                    <div className="flex flex-col sm:flex-row gap-3 mb-6">
                        <div className="relative flex-grow">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <MagnifyingGlassIcon className="h-5 w-5 text-gray-500" />
                            </div>
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search by character name..."
                                className="block w-full pl-10 pr-10 py-2.5 border border-gray-700 rounded-xl bg-gray-800 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-sm"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch('')}
                                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300"
                                    aria-label="Clear search"
                                >
                                    <XMarkIcon className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <label htmlFor="chat-sort" className="text-xs text-gray-500 uppercase tracking-wider font-semibold hidden sm:block">Sort</label>
                            <select
                                id="chat-sort"
                                value={sortMode}
                                onChange={(e) => handleSortChange(e.target.value as SortMode)}
                                className="w-full sm:w-auto bg-gray-800 border border-gray-700 rounded-xl text-gray-200 text-sm py-2.5 pl-3 pr-8 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 cursor-pointer"
                            >
                                {(Object.keys(SORT_LABELS) as SortMode[]).map(mode => (
                                    <option key={mode} value={mode}>{SORT_LABELS[mode]}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}

                {chatGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl bg-gray-800/20">
                        <ChatBubbleLeftRightIcon className="w-16 h-16 mb-4 opacity-50" />
                        <p className="text-lg font-medium">No active chats found.</p>
                        <p className="text-sm">Start a new conversation from the Home page.</p>
                    </div>
                ) : displayGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl bg-gray-800/20">
                        <MagnifyingGlassIcon className="w-16 h-16 mb-4 opacity-50" />
                        <p className="text-lg font-medium">No characters match "{search}"</p>
                        <button onClick={() => setSearch('')} className="mt-4 px-4 py-2 text-sm font-medium text-primary-400 hover:text-primary-300 hover:underline">
                            Clear search
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                        {displayGroups.map(group => {
                            const character = storedCharacters.find(c => c.id === group.characterId);
                            const imageUrl = character?.image || 'https://via.placeholder.com/400x300?text=Unknown';
                            const isExpanded = expandedCharacterId === group.characterId;

                            return (
                                <div 
                                    key={group.characterId} 
                                    className={`bg-gray-800 rounded-xl overflow-hidden border transition-all duration-300 shadow-lg flex flex-col ${isExpanded ? `border-primary-500 col-span-1 lg:col-span-2 xl:col-span-3` : 'border-gray-700 hover:border-gray-600'}`}
                                >
                                    {/* Character Header / Card Face */}
                                    <div 
                                        className="relative cursor-pointer h-[200px] flex-shrink-0"
                                        onClick={() => toggleExpand(group.characterId)}
                                    >
                                         <div className="absolute inset-0">
                                            <img 
                                                src={imageUrl} 
                                                alt={group.characterName} 
                                                className="w-full h-full object-cover opacity-50 transition-opacity duration-500"
                                            />
                                            <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent"></div>
                                            <div className="absolute inset-0 bg-gradient-to-r from-gray-900/90 via-transparent to-transparent"></div>
                                        </div>
                                        
                                        <div className="relative z-10 p-6 flex flex-col justify-between h-full">
                                             <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <LockClosedIcon className="w-5 h-5 text-yellow-500/80 flex-shrink-0" title="Private" />
                                                    <h3 className="font-bold text-2xl text-white shadow-sm truncate">{group.characterName}</h3>
                                                </div>
                                                <button
                                                    onClick={(e) => handleDeleteGroupClick(e, group)}
                                                    className="flex-shrink-0 p-2 rounded-full bg-black/40 text-gray-300 backdrop-blur-sm hover:bg-red-900/70 hover:text-red-100 transition-colors"
                                                    title={`Delete all chats with ${group.characterName}`}
                                                    aria-label={`Delete all chats with ${group.characterName}`}
                                                >
                                                    <TrashIcon className="w-5 h-5" />
                                                </button>
                                            </div>

                                            <div className="flex justify-between items-end">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary-900/80 text-primary-200 border border-primary-700/50 backdrop-blur-sm`}>
                                                        {group.chats.length} saved {group.chats.length === 1 ? 'chat' : 'chats'}
                                                    </span>
                                                    <span className="text-xs text-gray-300/90 bg-black/40 px-2 py-1 rounded-full backdrop-blur-sm">
                                                        {getRelativeTime(group.lastActive)}
                                                    </span>
                                                </div>
                                                <div className={`p-2 rounded-full bg-black/40 text-white backdrop-blur-sm transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                                    <ChevronDownIcon className="w-6 h-6" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Chat List */}
                                    {isExpanded && (
                                        <div className="p-4 bg-gray-900/50 border-t border-gray-700 animate-fadeIn">
                                            <div className="space-y-3">
                                                {group.chats.map(chat => (
                                                    <div key={chat.id} className="flex flex-col sm:flex-row gap-4 p-4 bg-gray-800 border border-gray-700 rounded-lg hover:border-gray-600 transition-colors">
                                                        <div className="flex-grow min-w-0">
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <span className={`text-xs font-mono text-primary-400 bg-primary-900/30 px-2 py-0.5 rounded`}>
                                                                    {getRelativeTime(chat.timestamp)}
                                                                </span>
                                                                <span className="text-xs text-gray-500">• {chat.turnCount} turns</span>
                                                            </div>
                                                            
                                                            <div className="mb-3">
                                                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Scenario / Greeting</h4>
                                                                <p className="text-sm text-gray-200 line-clamp-2 italic bg-black/20 p-2 rounded border-l-2 border-gray-600">
                                                                    "{chat.startPreview || 'No preview available.'}"
                                                                </p>
                                                            </div>

                                                            <div>
                                                                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Last Message</h4>
                                                                <p className="text-sm text-gray-400 line-clamp-1">
                                                                    {chat.summary}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        <div className="flex sm:flex-col justify-between sm:justify-center gap-2 sm:border-l sm:border-gray-700 sm:pl-4 sm:w-32 flex-shrink-0">
                                                            <button 
                                                                onClick={() => handleContinueChat(chat)}
                                                                className={`w-full py-2 px-3 bg-primary-700 hover:bg-primary-600 text-white text-sm font-bold rounded transition-colors shadow-sm`}
                                                            >
                                                                Resume
                                                            </button>
                                                            <button 
                                                                onClick={(e) => handleDeleteChatClick(e, chat.id)}
                                                                className="w-full py-2 px-3 bg-gray-700 hover:bg-red-900/50 text-gray-300 hover:text-red-200 text-sm font-medium rounded transition-colors flex items-center justify-center gap-2"
                                                            >
                                                                <TrashIcon className="w-4 h-4" />
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
             </div>
             
             <ConfirmationModal 
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                themeColor={themeColor}
                confirmText={confirmModal.title.includes('Delete') ? 'Delete' : 'Confirm'}
            />
        </div>
    );
};

export default MyChatsPage;
