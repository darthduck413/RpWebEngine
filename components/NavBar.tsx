
import React, { useState, useRef, useEffect } from 'react';
import { HomeIcon } from './icons/HomeIcon';
import { ChatBubbleLeftRightIcon } from './icons/ChatBubbleLeftRightIcon';
import { UserCircleIcon } from './icons/UserCircleIcon';
import { ThemeSelector } from './ThemeSelector';
import { ServerIcon } from './icons/ServerIcon';
import { PencilSquareIcon } from './icons/PencilSquareIcon';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';
import { ArrowUpTrayIcon } from './icons/ArrowUpTrayIcon';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { CogIcon } from './icons/CogIcon';
import { PaintBrushIcon } from './icons/PaintBrushIcon';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setPage, setEditingCharacterId, showToast, setSearchQuery } from '../store/slices/uiSlice';
import { loadSettings } from '../store/slices/settingsSlice';
import { setPersonas } from '../store/slices/personaSlice';
import { setCharacters } from '../store/slices/charactersSlice';
import { storageService } from '../services/storage';
import ConfirmationModal from './ConfirmationModal';
import { Character } from '../types';

interface NavBarProps {
    onNavigate: (page: 'selection' | 'my-chats' | 'personas') => void;
    currentPage: string;
    theme: string;
    themeColor: string;
    onThemeChange: (theme: string) => void;
    onOpenApiSettings: () => void;
    onOpenGenerationSettings: () => void;
    onOpenUISettings: () => void;
}

const NavBar: React.FC<NavBarProps> = ({ onNavigate, currentPage, theme, themeColor, onThemeChange, onOpenApiSettings, onOpenGenerationSettings, onOpenUISettings }) => {
    const dispatch = useAppDispatch();
    const searchQuery = useAppSelector(state => state.ui.searchQuery);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const profileRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
    }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
                setIsProfileOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleCreateClick = () => {
        dispatch(setEditingCharacterId(null)); // Clear editing state
        dispatch(setPage('create-character'));
    }

    const handleExportAll = () => {
        try {
            const backup = storageService.exportAllData();
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `rwe-full-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            dispatch(showToast({ message: 'Full backup exported successfully.', type: 'success' }));
            setIsProfileOpen(false);
        } catch (e) {
            console.error("Export failed", e);
            dispatch(showToast({ message: 'Failed to export data.', type: 'error' }));
        }
    };

    const triggerImport = () => {
        setIsProfileOpen(false);
        setConfirmModal({
            isOpen: true,
            title: 'Import Full Backup',
            message: 'Warning: Importing a full backup will overwrite ALL current data (characters, chats, personas, settings). This action cannot be undone. Do you want to proceed?',
            onConfirm: () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                fileInputRef.current?.click();
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
                
                // Reset view to selection to ensure clean state
                dispatch(setPage('selection')); 

            } catch (err) {
                console.error(err);
                dispatch(showToast({ message: 'Failed to import backup. File may be invalid.', type: 'error' }));
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const dropdownItemClass = `w-full text-left flex items-center gap-3 px-4 py-2 text-sm text-gray-200 hover:bg-primary-900/50 hover:text-white transition-colors`;

    return (
        <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40 shadow-md">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center h-16 gap-4">
                    {/* Left: Logo */}
                    <div className="flex-shrink-0 cursor-pointer mr-4" onClick={() => onNavigate('selection')}>
                        <div className="flex items-center gap-2">
                             <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-primary-500/20`}>
                                R
                            </div>
                            <span className={`hidden sm:block text-xl font-bold text-primary-400 tracking-tight`}>
                                RWE
                            </span>
                        </div>
                    </div>

                    {/* Center: Search Bar (Visible only on Selection Page) */}
                    <div className="flex-1 flex justify-center">
                        {currentPage === 'selection' && (
                            <div className="w-full max-w-2xl mx-4 hidden md:block">
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <MagnifyingGlassIcon className="h-5 w-5 text-gray-500 group-focus-within:text-gray-300 transition-colors" />
                                    </div>
                                    <input
                                        type="text"
                                        className={`block w-full pl-10 pr-10 py-2 border border-gray-700 rounded-xl leading-5 bg-gray-800 text-gray-200 placeholder-gray-500 focus:outline-none focus:bg-gray-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 sm:text-sm transition-all duration-200 shadow-inner`}
                                        placeholder="Search characters, tags..."
                                        value={searchQuery}
                                        onChange={(e) => dispatch(setSearchQuery(e.target.value))}
                                    />
                                    {searchQuery && (
                                        <button 
                                            onClick={() => dispatch(setSearchQuery(''))}
                                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300 transition-colors"
                                        >
                                            <XMarkIcon className="h-5 w-5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right: Navigation Items */}
                    <div className="flex items-center gap-2 sm:gap-4 ml-auto flex-shrink-0">
                        <div className="hidden sm:block">
                            <ThemeSelector currentTheme={theme} onThemeChange={onThemeChange} />
                        </div>

                        {/* Profile Dropdown */}
                        <div className="relative ml-1" ref={profileRef}>
                            <button
                                onClick={() => setIsProfileOpen(!isProfileOpen)}
                                className={`flex items-center gap-2 p-1 rounded-full text-gray-400 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-primary-500`}
                            >
                                <span className="sr-only">Open user menu</span>
                                <UserCircleIcon className="h-8 w-8" />
                            </button>
                             {isProfileOpen && (
                                <div 
                                    className={`absolute right-0 mt-2 w-56 origin-top-right bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden`}
                                >
                                    <div className="py-1">
                                        <button onClick={() => { onNavigate('selection'); setIsProfileOpen(false); }} className={dropdownItemClass}>
                                            <HomeIcon className="h-5 w-5 text-gray-400" /> Home
                                        </button>
                                        <button onClick={() => { handleCreateClick(); setIsProfileOpen(false); }} className={dropdownItemClass}>
                                            <PencilSquareIcon className="h-5 w-5 text-gray-400" /> Create Character
                                        </button>
                                        <button onClick={() => { onNavigate('personas'); setIsProfileOpen(false); }} className={dropdownItemClass}>
                                            <UserCircleIcon className="h-5 w-5 text-gray-400" /> My Personas
                                        </button>
                                        <button onClick={() => { onNavigate('my-chats'); setIsProfileOpen(false); }} className={dropdownItemClass}>
                                            <ChatBubbleLeftRightIcon className="h-5 w-5 text-gray-400" /> My Chats
                                        </button>
                                        <button onClick={() => { onOpenApiSettings(); setIsProfileOpen(false); }} className={dropdownItemClass}>
                                            <ServerIcon className="h-5 w-5 text-gray-400" /> API Settings
                                        </button>
                                        <button onClick={() => { onOpenGenerationSettings(); setIsProfileOpen(false); }} className={dropdownItemClass}>
                                            <CogIcon className="h-5 w-5 text-gray-400" /> Generation Settings
                                        </button>
                                        <button onClick={() => { onOpenUISettings(); setIsProfileOpen(false); }} className={dropdownItemClass}>
                                            <PaintBrushIcon className="h-5 w-5 text-gray-400" /> UI Settings
                                        </button>
                                        <div className="border-t border-gray-700/50 my-1"></div>
                                        <button onClick={triggerImport} className={dropdownItemClass}>
                                            <ArrowUpTrayIcon className="h-5 w-5 text-gray-400" /> Import All Data
                                        </button>
                                        <button onClick={handleExportAll} className={dropdownItemClass}>
                                            <ArrowDownTrayIcon className="h-5 w-5 text-gray-400" /> Export All Data
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            
            {/* Hidden File Input for Global Import */}
            <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImportAll} 
                className="hidden" 
                accept=".json" 
            />

            <ConfirmationModal 
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                themeColor={themeColor}
                confirmText="Import & Overwrite"
            />
        </nav>
    );
};

export default NavBar;
