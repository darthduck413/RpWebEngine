

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { addPersona, updatePersona, deletePersona, setActivePersona, setPersonas } from '../store/slices/personaSlice';
import { showToast } from '../store/slices/uiSlice';
import { Persona } from '../types';
import { UserCircleIcon } from './icons/UserCircleIcon';
import { TrashIcon } from './icons/TrashIcon';
import { CheckCircleIcon } from './icons/CheckCircleIcon';
import { ArrowDownTrayIcon } from './icons/ArrowDownTrayIcon';
import { ArrowUpTrayIcon } from './icons/ArrowUpTrayIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChevronUpIcon } from './icons/ChevronUpIcon';
import { PlusIcon } from './icons/PlusIcon';
import { MagnifyingGlassIcon } from './icons/MagnifyingGlassIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import ConfirmationModal from './ConfirmationModal';

interface PersonaCardProps {
    persona: Persona;
    isActive: boolean;
    isExpanded: boolean;
    onToggle: () => void;
    onSelect: () => void;
    onDelete: () => void;
    onSave: (updated: Persona) => void;
    themeColor: string;
}

const PersonaCard: React.FC<PersonaCardProps> = ({ persona, isActive, isExpanded, onToggle, onSelect, onDelete, onSave, themeColor }) => {
    const [name, setName] = useState(persona.name);
    const [description, setDescription] = useState(persona.description);
    const [avatar, setAvatar] = useState(persona.avatar || '');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Sync state when persona updates externally
    useEffect(() => {
        setName(persona.name);
        setDescription(persona.description);
        setAvatar(persona.avatar || '');
    }, [persona]);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setAvatar(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleSaveClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onSave({ ...persona, name, description, avatar });
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete();
    };

    const handleSelectClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect();
    };

    return (
        <div className={`bg-gray-800 rounded-xl border transition-all duration-300 overflow-hidden ${isExpanded ? `border-primary-500 shadow-lg shadow-primary-900/20` : 'border-gray-700 hover:border-gray-600'}`}>
            {/* Header / Collapsed View */}
            <div 
                onClick={onToggle}
                className="p-4 cursor-pointer flex items-center gap-4 group"
            >
                {/* Avatar Thumbnail */}
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gray-700 overflow-hidden border border-gray-600">
                    {avatar ? (
                        <img src={avatar} alt={name} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500"><UserCircleIcon className="w-6 h-6"/></div>
                    )}
                </div>

                {/* Info */}
                <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold text-gray-200 truncate">{name}</h3>
                        {isActive && (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-600 text-white shadow-sm`}>Active</span>
                        )}
                    </div>
                    {!isExpanded && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                            {description || <span className="italic opacity-50">No description provided...</span>}
                        </p>
                    )}
                </div>

                {/* Actions (Visible in header) */}
                <div className="flex items-center gap-2">
                    {!isActive && (
                        <button 
                            onClick={handleSelectClick}
                            className={`px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-700 text-gray-300 hover:bg-primary-700 hover:text-white transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100`}
                        >
                            Select
                        </button>
                    )}
                    <div className={`p-2 text-gray-500 group-hover:text-primary-400 transition-colors`}>
                        {isExpanded ? <ChevronUpIcon className="w-5 h-5" /> : <ChevronDownIcon className="w-5 h-5" />}
                    </div>
                </div>
            </div>

            {/* Expanded Editor Body */}
            {isExpanded && (
                <div className="px-6 pb-6 pt-2 border-t border-gray-700/50 bg-gray-900/30 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex flex-col md:flex-row gap-6">
                        {/* Avatar Editor */}
                        <div className="flex-shrink-0 flex flex-col gap-3 items-center md:items-start">
                            <div 
                                className={`w-32 h-40 rounded-lg bg-gray-800 flex flex-col items-center justify-center overflow-hidden border-2 border-dashed border-gray-600 cursor-pointer hover:border-primary-500 hover:bg-gray-800/80 transition-all group/avatar relative`}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {avatar ? (
                                    <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="text-center p-2">
                                        <UserCircleIcon className="w-10 h-10 text-gray-600 mx-auto mb-1 group-hover/avatar:text-gray-400" />
                                        <span className="text-[10px] text-gray-500 uppercase font-bold">Upload</span>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity">
                                    <span className="text-xs font-bold text-white">Change</span>
                                </div>
                            </div>
                            <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                            {avatar && (
                                <button onClick={() => setAvatar('')} className="text-xs text-red-400 hover:text-red-300 hover:underline">Remove Image</button>
                            )}
                        </div>

                        {/* Text Fields */}
                        <div className="flex-grow space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label>
                                <input 
                                    type="text" 
                                    value={name} 
                                    onChange={e => setName(e.target.value)} 
                                    className={`w-full bg-gray-900 rounded-md border border-gray-700 text-white p-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all`}
                                    placeholder="Character Name"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description</label>
                                <textarea 
                                    value={description} 
                                    onChange={e => setDescription(e.target.value)} 
                                    rows={6} 
                                    className={`w-full bg-gray-900 rounded-md border border-gray-700 text-white p-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-y custom-scrollbar transition-all`}
                                    placeholder="Describe appearance, personality, background, quirks..."
                                />
                                <p className="text-[10px] text-gray-600 mt-1.5">
                                    * This description acts as the {'{{user}}'} persona in chat.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-700/50">
                        <button 
                            onClick={handleDeleteClick}
                            className="flex items-center gap-2 px-3 py-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md transition-colors text-sm font-medium"
                        >
                            <TrashIcon className="w-4 h-4" />
                            <span className="hidden sm:inline">Delete</span>
                        </button>
                        <div className="flex gap-3">
                            {/* Save Button */}
                            <button 
                                onClick={handleSaveClick}
                                className={`flex items-center gap-2 px-6 py-2 bg-primary-700 hover:bg-primary-600 text-white rounded-md text-sm font-bold transition-all shadow-lg shadow-primary-900/30`}
                            >
                                <CheckCircleIcon className="w-4 h-4" />
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Sort Options
const sortOptions = [
    { id: 'oldest', label: 'Oldest' },
    { id: 'newest', label: 'Newest' },
    { id: 'last-edited', label: 'Last Edited' },
    { id: 'a-z', label: 'Name (A-Z)' },
    { id: 'z-a', label: 'Name (Z-A)' },
];

const PersonasPage: React.FC<{ themeColor: string }> = ({ themeColor }) => {
    const dispatch = useAppDispatch();
    const { personas, activePersonaId } = useAppSelector(state => state.personas);
    
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const sortDropdownRef = useRef<HTMLDivElement>(null);

    // Filter & Sort State
    const [searchQuery, setSearchQuery] = useState('');
    const [currentSort, setCurrentSort] = useState('oldest');
    const [isSortOpen, setIsSortOpen] = useState(false);

    // Confirmation Modal State
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
    }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
                setIsSortOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const filteredAndSortedPersonas = useMemo(() => {
        let result = [...personas];

        // Filter
        if (searchQuery.trim()) {
            const lowerQuery = searchQuery.toLowerCase();
            result = result.filter(p => 
                p.name.toLowerCase().includes(lowerQuery) || 
                p.description.toLowerCase().includes(lowerQuery)
            );
        }

        // Sort
        switch (currentSort) {
            case 'newest':
                result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                break;
            case 'last-edited':
                result.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
                break;
            case 'a-z':
                result.sort((a, b) => a.name.localeCompare(b.name));
                break;
            case 'z-a':
                result.sort((a, b) => b.name.localeCompare(a.name));
                break;
            case 'oldest':
            default:
                // Default to oldest (using createdAt or array index implicitly if createdAt is missing/equal)
                result.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
                break;
        }

        return result;
    }, [personas, searchQuery, currentSort]);

    const handleCreateNew = () => {
        const newId = crypto.randomUUID();
        const newPersona: Persona = {
            id: newId,
            name: 'New Persona',
            description: '',
            avatar: '',
            createdAt: Date.now(),
            lastModified: Date.now()
        };
        dispatch(addPersona(newPersona));
        setExpandedId(newId);
        dispatch(showToast({ message: 'New persona created.', type: 'success' }));
        
        // Optional: Scroll to bottom if list is long
        setTimeout(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }, 100);
    };

    const handleSavePersona = (updated: Persona) => {
        if (!updated.name.trim()) {
            dispatch(showToast({ message: 'Persona name cannot be empty.', type: 'error' }));
            return;
        }
        dispatch(updatePersona(updated));
        dispatch(showToast({ message: 'Persona updated successfully.', type: 'success' }));
    };

    const handleDeletePersona = (id: string, name: string) => {
        if (personas.length <= 1) {
            dispatch(showToast({ message: 'Cannot delete the last persona.', type: 'error' }));
            return;
        }
        setConfirmModal({
            isOpen: true,
            title: 'Delete Persona',
            message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
            onConfirm: () => {
                dispatch(deletePersona(id));
                dispatch(showToast({ message: 'Persona deleted.', type: 'success' }));
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleExportPersonas = () => {
        const dataStr = JSON.stringify({ personas, activePersonaId }, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `personas_export_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        dispatch(showToast({ message: 'Personas exported successfully.', type: 'success' }));
    };

    const handleImportPersonas = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                if (data.personas && Array.isArray(data.personas)) {
                    const activeId = data.activePersonaId && data.personas.some((p: Persona) => p.id === data.activePersonaId) 
                        ? data.activePersonaId 
                        : data.personas[0].id;

                    dispatch(setPersonas({ personas: data.personas, activeId }));
                    dispatch(showToast({ message: 'Personas imported successfully.', type: 'success' }));
                } else {
                    throw new Error("Invalid format");
                }
            } catch (err) {
                dispatch(showToast({ message: 'Failed to import personas.', type: 'error' }));
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
            <div className="max-w-4xl mx-auto">
                {/* Page Header */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-6">
                    <div>
                        <h1 className={`text-3xl font-bold text-primary-400 flex items-center gap-3`}>
                            <UserCircleIcon className="w-8 h-8" />
                            My Personas
                        </h1>
                        <p className="text-gray-400 mt-1 text-sm">Manage your user profiles and alter-egos.</p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-3">
                        <input type="file" ref={fileInputRef} onChange={handleImportPersonas} className="hidden" accept=".json" />
                        <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-2 bg-gray-800 text-xs text-gray-300 font-semibold rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors">
                            <ArrowUpTrayIcon className="w-4 h-4" /> Import
                        </button>
                        <button onClick={handleExportPersonas} className="flex items-center gap-2 px-3 py-2 bg-gray-800 text-xs text-gray-300 font-semibold rounded-md border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors">
                            <ArrowDownTrayIcon className="w-4 h-4" /> Export
                        </button>
                        <button onClick={handleCreateNew} className={`flex items-center gap-2 px-4 py-2 bg-primary-700 text-sm text-white font-semibold rounded-md hover:bg-primary-600 transition-colors shadow-lg shadow-primary-900/20`}>
                            <PlusIcon className="w-4 h-4" /> Create Persona
                        </button>
                    </div>
                </div>

                {/* Filter & Sort Toolbar */}
                <div className="flex gap-4 mb-6">
                    {/* Search Bar */}
                    <div className="relative flex-grow">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <MagnifyingGlassIcon className="h-5 w-5 text-gray-500" />
                        </div>
                        <input
                            type="text"
                            className={`block w-full pl-10 pr-10 py-2.5 border border-gray-700 rounded-lg bg-gray-800 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 text-sm transition-all`}
                            placeholder="Search personas..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button 
                                onClick={() => setSearchQuery('')}
                                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300 transition-colors"
                            >
                                <XMarkIcon className="h-5 w-5" />
                            </button>
                        )}
                    </div>

                    {/* Sort Dropdown */}
                    <div className="relative flex-shrink-0" ref={sortDropdownRef}>
                        <button
                            onClick={() => setIsSortOpen(!isSortOpen)}
                            className={`flex items-center justify-between gap-3 w-40 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 text-sm font-medium hover:bg-gray-700 transition-colors focus:outline-none focus:border-primary-500`}
                        >
                            <span>{sortOptions.find(opt => opt.id === currentSort)?.label}</span>
                            <ChevronDownIcon className={`w-4 h-4 transition-transform duration-200 ${isSortOpen ? 'rotate-180' : ''}`} />
                        </button>
                        
                        {isSortOpen && (
                            <div className="absolute right-0 mt-2 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
                                {sortOptions.map(opt => (
                                    <button
                                        key={opt.id}
                                        onClick={() => { setCurrentSort(opt.id); setIsSortOpen(false); }}
                                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-700 transition-colors ${currentSort === opt.id ? `text-primary-400 font-bold bg-gray-700/50` : 'text-gray-300'}`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Persona List */}
                <div className="space-y-4">
                    {filteredAndSortedPersonas.length > 0 ? (
                        filteredAndSortedPersonas.map(persona => (
                            <PersonaCard 
                                key={persona.id} 
                                persona={persona}
                                isActive={persona.id === activePersonaId}
                                isExpanded={expandedId === persona.id}
                                onToggle={() => setExpandedId(prev => prev === persona.id ? null : persona.id)}
                                onSelect={() => dispatch(setActivePersona(persona.id))}
                                onDelete={() => handleDeletePersona(persona.id, persona.name)}
                                onSave={handleSavePersona}
                                themeColor={themeColor}
                            />
                        ))
                    ) : (
                        <div className="text-center py-12 px-6 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl">
                            {/* An empty list is the first-run state, not a failed search. */}
                            {personas.length === 0 ? (
                                <>
                                    <p className="text-lg font-medium text-gray-400">No personas yet</p>
                                    <p className="mt-1 text-sm max-w-md mx-auto">
                                        A persona is who <span className="font-mono">{'{{user}}'}</span> is — name, appearance,
                                        anything the characters should know about you. Without one, each character falls back
                                        to its own default player description.
                                    </p>
                                </>
                            ) : (
                                <p>No personas found matching "{searchQuery}"</p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <ConfirmationModal 
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                themeColor={themeColor}
                confirmText="Delete"
            />
        </div>
    );
};

export default PersonasPage;