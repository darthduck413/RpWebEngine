import React, { useEffect, useState } from 'react';
import { storageService, ChatSummary } from '../services/storage';
import { Character } from '../types';
import { useAppDispatch } from '../store/hooks';
import { deleteGameSession } from '../store/thunks/gameThunks';
import { showToast } from '../store/slices/uiSlice';
import { TrashIcon } from './icons/TrashIcon';
import { EyeIcon } from './icons/EyeIcon';
import { XMarkIcon } from './icons/XMarkIcon';
import { LockClosedIcon } from './icons/LockClosedIcon';
import { ChatBubbleLeftRightIcon } from './icons/ChatBubbleLeftRightIcon';
import ConfirmationModal from './ConfirmationModal';

interface CharacterChatsModalProps {
    isOpen: boolean;
    onClose: () => void;
    character: Character;
    currentChatId: string | null;
    onContinue: (chatId: string) => void;
    themeColor: string;
}

const getRelativeTime = (timestamp: number): string => {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const diffInSeconds = (timestamp - Date.now()) / 1000;
    if (Math.abs(diffInSeconds) < 60) return rtf.format(Math.round(diffInSeconds), 'second');
    if (Math.abs(diffInSeconds) < 3600) return rtf.format(Math.round(diffInSeconds / 60), 'minute');
    if (Math.abs(diffInSeconds) < 86400) return rtf.format(Math.round(diffInSeconds / 3600), 'hour');
    return rtf.format(Math.round(diffInSeconds / 86400), 'day');
};

const CharacterChatsModal: React.FC<CharacterChatsModalProps> = ({
    isOpen, onClose, character, currentChatId, onContinue, themeColor,
}) => {
    const dispatch = useAppDispatch();
    const [chats, setChats] = useState<ChatSummary[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const refresh = () => {
        const index = storageService.getChatIndex();
        const list = Object.values(index)
            .filter(c => c.characterId === character.id)
            .sort((a, b) => b.timestamp - a.timestamp);
        setChats(list);
    };

    useEffect(() => {
        if (isOpen) {
            refresh();
            setExpandedId(null);
        }
    }, [isOpen, character.id]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    const handleDelete = (chatId: string) => setConfirmDeleteId(chatId);

    const performDelete = () => {
        if (!confirmDeleteId) return;
        const id = confirmDeleteId;
        void dispatch(deleteGameSession(id)).then(() => {
            refresh();
            dispatch(showToast({ message: 'Chat deleted.', type: 'success' }));
            setConfirmDeleteId(null);
        });
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-start sm:items-center justify-center z-[55] p-2 sm:p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-gray-900 w-full max-w-2xl max-h-[92vh] sm:max-h-[85vh] rounded-2xl ring-1 ring-primary-700 shadow-2xl shadow-primary-500/10 flex flex-col my-2 sm:my-0"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="character-chats-modal-title"
            >
                <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-primary-800/60 flex-shrink-0">
                    <h2 id="character-chats-modal-title" className="text-base sm:text-lg font-bold text-white leading-snug">
                        Your chats with <span className="text-primary-400">{character.name}</span>
                    </h2>
                    <button
                        onClick={onClose}
                        className="flex-shrink-0 p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                        aria-label="Close"
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-grow overflow-y-auto custom-scrollbar p-3 sm:p-5 space-y-3 sm:space-y-4">
                    {chats.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                            <ChatBubbleLeftRightIcon className="w-12 h-12 mb-3 opacity-50" />
                            <p className="text-sm">No chats with this character yet.</p>
                        </div>
                    ) : chats.map(chat => {
                        const isCurrent = chat.id === currentChatId;
                        const isExpanded = expandedId === chat.id;
                        const startPreview = chat.startPreview || '';
                        const lastMessage = chat.summary || '';
                        return (
                            <div
                                key={chat.id}
                                className={`rounded-xl border bg-primary-950/30 transition-colors ${isCurrent ? 'border-primary-500' : 'border-primary-900/70 hover:border-primary-700'}`}
                            >
                                <div className="p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:gap-4">
                                    <div className="flex-shrink-0 mx-auto sm:mx-0">
                                        <img
                                            src={character.image || 'https://via.placeholder.com/120x120?text=?'}
                                            alt={character.name}
                                            className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg object-cover"
                                        />
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <LockClosedIcon className="w-4 h-4 text-yellow-500/80 flex-shrink-0" />
                                            <h3 className="text-sm sm:text-base font-bold text-white truncate">{character.name}</h3>
                                            {isCurrent && (
                                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary-700/60 text-primary-100 font-semibold flex-shrink-0">Current</span>
                                            )}
                                        </div>
                                        {startPreview && (
                                            <p className={`text-xs sm:text-sm text-gray-300 italic ${isExpanded ? '' : 'line-clamp-3'}`}>
                                                {startPreview}
                                            </p>
                                        )}
                                        {isExpanded && lastMessage && lastMessage !== startPreview && (
                                            <div className="mt-2 pt-2 border-t border-primary-900/50">
                                                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Last message</p>
                                                <p className="text-xs text-gray-300 italic">"{lastMessage}"</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-2 px-3 sm:px-4 pb-3 sm:pb-4 flex-wrap">
                                    <div className="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-xs text-gray-400 flex-wrap">
                                        <span className="inline-flex items-center gap-1">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                            </svg>
                                            {getRelativeTime(chat.timestamp)}
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5" />
                                            {chat.turnCount} {chat.turnCount === 1 ? 'message' : 'messages'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
                                        <button
                                            onClick={() => handleDelete(chat.id)}
                                            className="p-2 rounded-md text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors"
                                            title="Delete chat"
                                            aria-label="Delete chat"
                                        >
                                            <TrashIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                                        </button>
                                        <button
                                            onClick={() => setExpandedId(prev => prev === chat.id ? null : chat.id)}
                                            className={`p-2 rounded-md transition-colors ${isExpanded ? 'text-primary-200 bg-primary-900/40' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                                            title={isExpanded ? 'Hide preview' : 'Show preview'}
                                            aria-label={isExpanded ? 'Hide preview' : 'Show preview'}
                                            aria-pressed={isExpanded}
                                        >
                                            <EyeIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                                        </button>
                                        <button
                                            onClick={() => { onContinue(chat.id); onClose(); }}
                                            disabled={isCurrent}
                                            className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-md bg-primary-700 hover:bg-primary-600 text-white text-xs sm:text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Continue
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <ConfirmationModal
                isOpen={confirmDeleteId !== null}
                title="Delete Conversation"
                message="Are you sure you want to delete this chat? This action cannot be undone."
                onConfirm={performDelete}
                onCancel={() => setConfirmDeleteId(null)}
                themeColor={themeColor}
                confirmText="Delete"
            />
        </div>
    );
};

export default CharacterChatsModal;
