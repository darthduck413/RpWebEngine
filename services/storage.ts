
import { GameState, Character, Persona, FirstMessage } from '../types';
import { stripThinkTags } from './common/thinking';

const STORAGE_PREFIX = 'hv_';
const SETTINGS_KEY = `${STORAGE_PREFIX}global_settings`;
const CHAT_INDEX_KEY = `${STORAGE_PREFIX}chat_index`;
const CHAT_KEY_PREFIX = `${STORAGE_PREFIX}chat_`;
const PERSONAS_KEY = `${STORAGE_PREFIX}personas`;
const CHARACTERS_KEY = `${STORAGE_PREFIX}characters`;

type StoredCharacter = string | Character;
type StoredPersona = string | Persona;
type StoredPersonaData = {
    personas: StoredPersona[];
    activePersonaId: string;
};
type PersistedGameState = Omit<GameState, 'storyHistory'> & {
    storyHistory?: GameState['storyHistory'];
};

export interface ChatSummary {
    id: string;
    characterId: string;
    characterName: string;
    summary: string;
    timestamp: number;
    turnCount: number;
    startPreview?: string; // First message or greeting used
}

// Helper to get safe JSON
const safeParse = <T>(json: string | null, fallback: T): T => {
    if (!json) return fallback;
    try {
        return JSON.parse(json);
    } catch (e) {
        console.error("Storage parse error", e);
        return fallback;
    }
};

const getChatKey = (chatId: string) => `${CHAT_KEY_PREFIX}${chatId}`;

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const migrateLegacyCharacter = (value: unknown): Character | null => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
    const character = value as unknown as Character & {
        firstMessage?: string;
        alternativeFirstMessages?: string[];
        firstMessageLoreIds?: string[][];
    };
    if (Array.isArray(character.firstMessages) && character.firstMessages.length > 0) {
        return character;
    }

    const primary = character.firstMessage ?? '';
    const alternatives = Array.isArray(character.alternativeFirstMessages)
        ? character.alternativeFirstMessages
        : [];
    const loreIdsByIndex = Array.isArray(character.firstMessageLoreIds)
        ? character.firstMessageLoreIds
        : [];
    const firstMessages: FirstMessage[] = [primary, ...alternatives].map((text, index) => {
        const loreIds = loreIdsByIndex[index];
        return loreIds?.length ? { text, loreIds } : { text };
    });
    const {
        firstMessage: _legacyFirstMessage,
        alternativeFirstMessages: _legacyAlternatives,
        firstMessageLoreIds: _legacyLoreIds,
        ...rest
    } = character;
    return { ...rest, firstMessages } as Character;
};

const compactCharacters = (value: unknown): StoredCharacter[] => {
    if (!Array.isArray(value)) return [];
    const compact = new Map<string, StoredCharacter>();
    value.forEach(entry => {
        // Legacy record: built-in characters used to be stored as a bare id.
        // The engine ships none now, so such an id resolves to nothing.
        if (typeof entry === 'string') return;
        const character = migrateLegacyCharacter(entry);
        if (!character) return;
        compact.set(character.id, character);
    });
    return Array.from(compact.values());
};

const hydrateCharacters = (records: StoredCharacter[]): Character[] => {
    const characters = new Map<string, Character>();
    records.forEach(record => {
        if (typeof record === 'string') return; // legacy built-in id
        const character = migrateLegacyCharacter(record);
        if (character) characters.set(character.id, character);
    });
    return Array.from(characters.values());
};

const normalizePersona = (value: unknown): Persona | null => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
    if (typeof value.name !== 'string' || typeof value.description !== 'string') return null;
    return value as unknown as Persona;
};

const compactPersonaData = (value: unknown): StoredPersonaData => {
    const data = isRecord(value) ? value : {};
    const entries = Array.isArray(data.personas) ? data.personas : [];
    const personas = new Map<string, StoredPersona>();
    entries.forEach(entry => {
        if (typeof entry === 'string') return; // legacy built-in id
        const persona = normalizePersona(entry);
        if (!persona) return;
        personas.set(persona.id, persona);
    });
    return {
        personas: Array.from(personas.values()),
        activePersonaId: typeof data.activePersonaId === 'string' ? data.activePersonaId : '',
    };
};

const hydratePersonaData = (stored: StoredPersonaData): { personas: Persona[], activePersonaId: string } => {
    const personas = new Map<string, Persona>();
    stored.personas.forEach(record => {
        if (typeof record === 'string') return; // legacy built-in id
        const persona = normalizePersona(record);
        if (persona) personas.set(persona.id, persona);
    });
    const hydrated = Array.from(personas.values());
    const activePersonaId = hydrated.some(persona => persona.id === stored.activePersonaId)
        ? stored.activePersonaId
        : hydrated[0]?.id ?? '';
    return { personas: hydrated, activePersonaId };
};

const compactChat = (value: unknown): PersistedGameState | null => {
    if (!isRecord(value)) return null;
    const {
        agentSettings: _legacyAgentSettings,
        apiProvider: _legacyApiProvider,
        proxySettings: _legacyProxySettings,
        geminiSettings: _legacyGeminiSettings,
        ...compact
    } = value;

    // chatTree is the source of truth for branched chats. storyHistory is only a
    // derived view of its selected path, so persisting both duplicates messages.
    if (isRecord(compact.chatTree)) delete compact.storyHistory;

    // These base snapshots already have an explicit load-time fallback.
    if (compact.baseCharacterSetting === compact.characterSetting) delete compact.baseCharacterSetting;
    if (compact.baseCharacterScenario === compact.characterScenario) delete compact.baseCharacterScenario;

    return compact as PersistedGameState;
};

const previewText = (text: string | undefined, fallback: string, maxLength: number): string => {
    const clean = stripThinkTags(text ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) return fallback;
    return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
};

// One-time storage migration: older builds embedded global config and also
// duplicated the selected message branch beside chatTree in every chat save.
// Compact both forms to reclaim localStorage space; new saves are slimmed too.
const CHAT_STORAGE_REVISION_KEY = `${STORAGE_PREFIX}chat_storage_revision`;
const CHAT_STORAGE_REVISION = 2;
const compactStoredChats = () => {
    if (Number(localStorage.getItem(CHAT_STORAGE_REVISION_KEY) ?? 0) >= CHAT_STORAGE_REVISION) return;
    try {
        const chatKeys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(CHAT_KEY_PREFIX) && key !== CHAT_INDEX_KEY && key !== CHAT_STORAGE_REVISION_KEY) {
                chatKeys.push(key);
            }
        }
        for (const key of chatKeys) {
            const raw = localStorage.getItem(key);
            const compact = compactChat(safeParse<unknown>(raw, null));
            if (!compact) continue;
            const serialized = JSON.stringify(compact);
            if (serialized !== raw) localStorage.setItem(key, serialized);
        }
        localStorage.removeItem(`${STORAGE_PREFIX}chat_agent_settings_stripped`);
        localStorage.setItem(CHAT_STORAGE_REVISION_KEY, String(CHAT_STORAGE_REVISION));
    } catch (e) {
        // Non-fatal: chats stay readable, just un-slimmed; retried next launch.
        console.error('Failed to compact stored chats', e);
    }
};
compactStoredChats();

const removeAllChatSessions = () => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CHAT_KEY_PREFIX) && key !== CHAT_INDEX_KEY && key !== CHAT_STORAGE_REVISION_KEY) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
};

export const storageService = {
    // Settings
    saveSettings: (settings: any) => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    },
    loadSettings: (): any | null => {
        return safeParse(localStorage.getItem(SETTINGS_KEY), null);
    },

    // Personas
    savePersonas: (data: { personas: StoredPersona[], activePersonaId: string }) => {
        localStorage.setItem(PERSONAS_KEY, JSON.stringify(compactPersonaData(data)));
    },
    loadPersonas: (): { personas: Persona[], activePersonaId: string } | null => {
        const raw = localStorage.getItem(PERSONAS_KEY);
        const fallback = { personas: [], activePersonaId: '' };
        const hydrated = hydratePersonaData(compactPersonaData(safeParse<unknown>(raw, fallback)));
        const serialized = JSON.stringify(compactPersonaData(hydrated));
        if (serialized !== raw) localStorage.setItem(PERSONAS_KEY, serialized);
        return hydrated;
    },

    // Characters
    saveCharacters: (characters: StoredCharacter[]) => {
        localStorage.setItem(CHARACTERS_KEY, JSON.stringify(compactCharacters(characters)));
    },
    loadCharacters: (): Character[] => {
        const raw = localStorage.getItem(CHARACTERS_KEY);
        const hydrated = hydrateCharacters(compactCharacters(safeParse<unknown>(raw, [])));
        const serialized = JSON.stringify(compactCharacters(hydrated));
        if (serialized !== raw) localStorage.setItem(CHARACTERS_KEY, serialized);
        return hydrated;
    },

    // Chat Index Management
    getChatIndex: (): Record<string, ChatSummary> => {
        const index = safeParse<Record<string, ChatSummary>>(localStorage.getItem(CHAT_INDEX_KEY), {});
        const sanitized: Record<string, ChatSummary> = {};
        let changed = false;

        Object.entries(index).forEach(([chatId, summary]) => {
            if (!summary || typeof summary !== 'object' || !localStorage.getItem(getChatKey(chatId))) {
                changed = true;
                return;
            }
            sanitized[chatId] = { ...summary, id: summary.id || chatId };
        });

        if (changed) {
            localStorage.setItem(CHAT_INDEX_KEY, JSON.stringify(sanitized));
        }

        return sanitized;
    },
    
    updateChatIndex: (summary: ChatSummary) => {
        const index = storageService.getChatIndex();
        index[summary.id] = summary;
        localStorage.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
    },

    removeFromIndex: (chatId: string) => {
        const index = storageService.getChatIndex();
        delete index[chatId];
        localStorage.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
    },

    // Chat Sessions
    saveChatSession: (chatId: string, gameState: GameState, character: Character) => {
        const key = getChatKey(chatId);
        const compact = compactChat(gameState);
        if (!compact) throw new Error('Invalid chat state.');
        localStorage.setItem(key, JSON.stringify(compact));

        // Update Index
        const lastTurn = gameState.storyHistory[gameState.storyHistory.length - 1];
        const summaryText = lastTurn ? previewText(lastTurn.text, lastTurn.isPlayer ? 'Player message' : 'Thinking...', 100) : 'New Game';
        const firstTurn = gameState.storyHistory[0];
        const startPreview = firstTurn ? previewText(firstTurn.text, 'Unknown Start', 150) : 'Unknown Start';
        
        const summary: ChatSummary = {
            id: chatId,
            characterId: character.id,
            characterName: character.name,
            summary: summaryText,
            timestamp: Date.now(),
            turnCount: gameState.storyHistory.length,
            startPreview: startPreview
        };
        storageService.updateChatIndex(summary);
    },

    loadChatSession: (chatId: string): PersistedGameState | null => {
        const key = getChatKey(chatId);
        return safeParse(localStorage.getItem(key), null);
    },

    deleteChatSession: (chatId: string) => {
        const key = getChatKey(chatId);
        localStorage.removeItem(key);
        storageService.removeFromIndex(chatId);
    },

    // Bulk-delete every chat belonging to a character. Returns how many were
    // removed so the UI can report it. Writes the pruned index once at the end
    // rather than per-chat to avoid repeated JSON serialization.
    deleteChatsForCharacter: (characterId: string): number => {
        const index = storageService.getChatIndex();
        const ids = Object.values(index)
            .filter(chat => chat.characterId === characterId)
            .map(chat => chat.id);
        ids.forEach(id => {
            localStorage.removeItem(getChatKey(id));
            delete index[id];
        });
        localStorage.setItem(CHAT_INDEX_KEY, JSON.stringify(index));
        return ids.length;
    },

    // Querying
    getChatsForCharacter: (characterId: string): ChatSummary[] => {
        const index = storageService.getChatIndex();
        return Object.values(index)
            .filter(chat => chat.characterId === characterId)
            .sort((a, b) => b.timestamp - a.timestamp); // Newest first
    },

    // Bulk Data Operations
    exportAllData: () => {
        const settings = storageService.loadSettings();
        const chatIndex = storageService.getChatIndex();
        const personas = compactPersonaData(storageService.loadPersonas());
        const characters = compactCharacters(storageService.loadCharacters());
        const chats: Record<string, PersistedGameState> = {};

        Object.keys(chatIndex).forEach(chatId => {
            const chatData = storageService.loadChatSession(chatId);
            if (chatData) {
                chats[chatId] = chatData;
            }
        });

        return {
            meta: {
                version: 4,
                date: new Date().toISOString(),
                app: 'RWE',
                type: 'full'
            },
            settings,
            chatIndex,
            chats,
            personas,
            characters
        };
    },

    importAllData: (data: any) => {
        try {
            if (!data) {
                throw new Error("No data provided for import.");
            }

            // Ensure data is a valid object before checking properties
            if (typeof data !== 'object') {
                 throw new Error("Invalid backup data format.");
            }

            if (!data.chatIndex || !data.chats) {
                throw new Error("Invalid backup file format: Missing index or chats.");
            }

            // Restore settings
            if (data.settings) {
                storageService.saveSettings(data.settings);
            }

            // Restore personas
            if (data.personas) {
                storageService.savePersonas(data.personas);
            }

            // Restore characters
            if (data.characters) {
                storageService.saveCharacters(data.characters);
            }

            const incomingChats = isRecord(data.chats) ? data.chats : {};
            const incomingIndex = isRecord(data.chatIndex) ? data.chatIndex as Record<string, ChatSummary> : {};
            const restoredIndex: Record<string, ChatSummary> = {};

            removeAllChatSessions();

            Object.entries(incomingChats).forEach(([chatId, chatData]) => {
                if (!isRecord(chatData) || !incomingIndex[chatId]) return;
                const compact = compactChat(chatData);
                if (!compact) return;
                localStorage.setItem(getChatKey(chatId), JSON.stringify(compact));
                restoredIndex[chatId] = { ...incomingIndex[chatId], id: chatId };
            });

            localStorage.setItem(CHAT_INDEX_KEY, JSON.stringify(restoredIndex));
        } catch (e) {
            console.error("Error during import:", e);
            throw new Error("Failed to import data. The file might be corrupted or invalid.");
        }
    },

    // Chats Only Operations
    exportChatsOnly: () => {
        const chatIndex = storageService.getChatIndex();
        const chats: Record<string, PersistedGameState> = {};

        Object.keys(chatIndex).forEach(chatId => {
            const chatData = storageService.loadChatSession(chatId);
            if (chatData) {
                chats[chatId] = chatData;
            }
        });

        return {
            meta: {
                version: 4,
                date: new Date().toISOString(),
                app: 'RWE',
                type: 'chats_only'
            },
            chatIndex,
            chats
        };
    },

    importChatsOnly: (data: any) => {
        try {
            if (!data || !data.chats || !data.chatIndex) {
                throw new Error("Invalid chat backup file.");
            }

            const incomingChats = isRecord(data.chats) ? data.chats : {};
            const incomingIndex = isRecord(data.chatIndex) ? data.chatIndex as Record<string, ChatSummary> : {};

            // Merge only index entries that have a matching chat payload.
            const existingIndex = storageService.getChatIndex();
            const importableIndex = Object.fromEntries(
                Object.entries(incomingIndex)
                    .filter(([chatId]) => isRecord(incomingChats[chatId]))
                    .map(([chatId, summary]) => [chatId, { ...summary, id: chatId }])
            ) as Record<string, ChatSummary>;
            const newIndex = { ...existingIndex, ...importableIndex };
            localStorage.setItem(CHAT_INDEX_KEY, JSON.stringify(newIndex));

            // Save chats in the same compact representation as autosave.
            Object.keys(importableIndex).forEach(chatId => {
                const compact = compactChat(incomingChats[chatId]);
                if (compact) localStorage.setItem(getChatKey(chatId), JSON.stringify(compact));
            });

        } catch (e) {
            console.error("Error during chat import:", e);
            throw new Error("Failed to import chats.");
        }
    },

    // Storage usage reporting. localStorage's hard cap is browser-defined and
    // not exposed via any API — most browsers settle near 5MB per origin in
    // practice. Returns a conservative estimate so the UI can warn before
    // quota errors strike.
    getStorageUsage: (): StorageUsage => {
        // Treat 1 char ≈ 2 bytes (localStorage stores UTF-16). Sum keys + values.
        let total = 0;
        let chats = 0;
        const perChat: Record<string, number> = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            const value = localStorage.getItem(key) ?? '';
            const bytes = (key.length + value.length) * 2;
            total += bytes;
            if (key.startsWith(CHAT_KEY_PREFIX) && key !== CHAT_INDEX_KEY && key !== CHAT_STORAGE_REVISION_KEY) {
                const chatId = key.slice(CHAT_KEY_PREFIX.length);
                perChat[chatId] = bytes;
                chats += bytes;
            }
        }
        return {
            usedBytes: total,
            chatsBytes: chats,
            quotaBytes: 5 * 1024 * 1024,
            perChat,
        };
    }
};

export interface StorageUsage {
    usedBytes: number;
    chatsBytes: number;
    quotaBytes: number;
    perChat: Record<string, number>; // chatId → bytes
}
