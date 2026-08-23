

import { createAsyncThunk } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { storageService } from '../../services/storage';
import {
    setStoryHistory,
    setChatTree,
    setTrackedCharacters,
    setUserPersonaDetails,
    setAutosaveStatus,
    setStoryBible,
    setPerCharacterStates,
    setWorldModelStatesByNodeId,
    setLockedFirstMessageIndex,
    setBaseCharacterSetting,
    setBaseCharacterScenario,
    setActiveManualScenarioIds,
    resetGame,
    setError
} from '../slices/gameSlice';
import { setCurrentChatId } from '../slices/uiSlice';
import { loadSettings } from '../slices/settingsSlice';
import { addLog } from '../slices/logSlice';
import { GameState } from '../../types';
import { migrateHistoryToTree } from '../utils/treeUtils';
import { migrateCharacters } from '../utils/characterUtils';
import { getActiveApiPresetRef, resolveApiPresetRef } from '../../services/common/apiPresetRef';
import { SHARED_USER_DESCRIPTION, DEFAULT_PERSONA_AVATAR } from '../../constants';

// The World Model agent graph (agentSettings) is a global tool config, persisted
// in global settings — not story data. It is never written into chat saves
// (a full copy is ~17KB and was the dominant per-chat bloat), and any copy found
// in an older save is ignored on load so a stale graph can't clobber the live
// global one (loadSettings ignores `undefined`).

export const loadGameSession = createAsyncThunk(
    'game/loadSession',
    async (chatId: string, { dispatch, getState }) => {
        try {
            const gameState = storageService.loadChatSession(chatId);
            if (!gameState) throw new Error("Session not found");

            dispatch(resetGame());
            dispatch(setCurrentChatId(chatId));
            
            let tree = gameState.chatTree;
            if (!tree && gameState.storyHistory) {
                tree = migrateHistoryToTree(gameState.storyHistory);
            }
            
            dispatch(setWorldModelStatesByNodeId(gameState.worldModelStatesByNodeId ?? {}));
            if (tree) {
                dispatch(setChatTree(tree));
            } else {
                dispatch(setStoryHistory(gameState.storyHistory || []));
            }
            
            const migratedCharacters = migrateCharacters(gameState.trackedCharacters, dispatch);
            dispatch(setTrackedCharacters(migratedCharacters));

            if (gameState.userPersonaDetails) {
                dispatch(setUserPersonaDetails(gameState.userPersonaDetails));
            } else {
                const state = getState() as RootState;
                const { personas, activePersonaId } = state.personas;
                const activePersona = personas.find(p => p.id === activePersonaId) || personas[0];
                dispatch(setUserPersonaDetails({
                    name: activePersona?.name || 'User',
                    description: activePersona?.description || SHARED_USER_DESCRIPTION,
                    avatar: activePersona?.avatar || DEFAULT_PERSONA_AVATAR
                }));
            }

            const wasLegacyHeavyMode = (gameState as any).isHeavyMode === true;
            dispatch(loadSettings({
                playerNotes: gameState.playerNotes ?? '',
                postHistoryInstruction: gameState.postHistoryInstruction ?? '',
                systemInstruction: gameState.systemInstruction ?? '',
                characterSetting: gameState.characterSetting ?? null,
                characterScenario: gameState.characterScenario ?? null,
                characterPersonality: gameState.characterPersonality || '',
                historyContextTurns: gameState.historyContextTurns,
                isWorldModelEnabled: gameState.isWorldModelEnabled ?? wasLegacyHeavyMode,
                // gameState.agentSettings (present in older saves) is intentionally
                // NOT loaded — the agent graph is global config, and a stale chat
                // copy must not overwrite it.
                isIntelligentPresetAnalyzerEnabled: gameState.isIntelligentPresetAnalyzerEnabled,
                includeAllAgentResponsesInContext: gameState.includeAllAgentResponsesInContext,
                keepNonExistentAgentResponses: gameState.keepNonExistentAgentResponses,
                // apiProvider / proxySettings / geminiSettings are intentionally NOT
                // loaded from the chat — API/connection config is global, not story
                // data. Loading a chat keeps whatever provider/preset is active
                // globally; a stale per-chat copy used to clobber the live config here
                // (Object.assign in the loadSettings reducer), making presets "go crazy".
                replaceAgentModels: gameState.replaceAgentModels,
                sendUserAvatar: gameState.sendUserAvatar,
                sendCharacterAvatar: gameState.sendCharacterAvatar,
                ignoreImages: gameState.ignoreImages,
                editFullMessage: gameState.editFullMessage,
                deleteUnfinishedGeminiSentencesOnError: gameState.deleteUnfinishedGeminiSentencesOnError,
            }));

            dispatch(setStoryBible(gameState.storyBible ?? null));
            dispatch(setPerCharacterStates(gameState.perCharacterStates ?? {}));
            dispatch(setLockedFirstMessageIndex(gameState.lockedFirstMessageIndex ?? null));
            // Legacy fallback: if baseCharacterSetting was not stored (older saves),
            // fall back to the already-loaded characterSetting so the lore reconciler
            // still has a base to compose against.
            dispatch(setBaseCharacterSetting(gameState.baseCharacterSetting ?? gameState.characterSetting ?? null));
            dispatch(setBaseCharacterScenario(gameState.baseCharacterScenario ?? gameState.characterScenario ?? null));
            dispatch(setActiveManualScenarioIds(gameState.activeManualScenarioIds ?? []));

            // Re-select the chat's API preset by id if it still exists; otherwise
            // leave the globally-active provider/preset untouched.
            const sessionSettings = (getState() as RootState).settings;
            const sessionPresetPatch = resolveApiPresetRef(gameState.apiPresetRef, {
                proxyPresets: sessionSettings.proxyPresets,
                geminiPresets: sessionSettings.geminiPresets,
                geminiApiKeys: sessionSettings.geminiApiKeys,
            });
            if (sessionPresetPatch) dispatch(loadSettings(sessionPresetPatch));

            dispatch(addLog({ message: `Game loaded session: ${chatId}` }));
            return true;
        } catch (err) {
            console.error("Failed to load game session:", err);
            dispatch(setError("Failed to load saved chat."));
            return false;
        }
    }
);

export const deleteGameSession = createAsyncThunk(
    'game/deleteSession',
    async (chatId: string, { dispatch }) => {
        storageService.deleteChatSession(chatId);
        dispatch(addLog({ message: `Deleted session: ${chatId}` }));
    }
);

export const deleteChatsForCharacter = createAsyncThunk(
    'game/deleteChatsForCharacter',
    async (characterId: string, { dispatch }) => {
        const count = storageService.deleteChatsForCharacter(characterId);
        dispatch(addLog({ message: `Deleted ${count} chats for character: ${characterId}` }));
        return count;
    }
);

export const autoSaveGame = createAsyncThunk(
    'game/autoSave',
    async (_, { getState, dispatch }) => {
        const state = getState() as RootState;
        const { selectedCharacter, currentChatId } = state.ui;
        if (!selectedCharacter || !currentChatId) return;

        try {
            const gameState: GameState = {
                storyHistory: state.game.storyHistory,
                chatTree: state.game.chatTree || undefined,
                playerNotes: state.settings.playerNotes,
                postHistoryInstruction: state.settings.postHistoryInstruction,
                systemInstruction: state.settings.systemInstruction,
                characterSetting: state.settings.characterSetting,
                characterPersonality: state.settings.characterPersonality,
                historyContextTurns: state.settings.historyContextTurns,
                theme: state.settings.theme,
                autosaveInterval: state.settings.autosaveInterval,
                isWorldModelEnabled: state.settings.isWorldModelEnabled,
                isIntelligentPresetAnalyzerEnabled: state.settings.isIntelligentPresetAnalyzerEnabled,
                includeAllAgentResponsesInContext: state.settings.includeAllAgentResponsesInContext,
                keepNonExistentAgentResponses: state.settings.keepNonExistentAgentResponses,
                trackedCharacters: state.game.trackedCharacters,
                // The full API config (apiProvider / proxySettings / geminiSettings) is
                // NOT persisted per-chat — it's global connection config (~9KB of dead
                // weight per save). Instead we store just a pointer to the active preset
                // by id; on load the chat re-selects it if it still exists, else keeps
                // whatever is active globally. (agentSettings is likewise global-only.)
                apiPresetRef: getActiveApiPresetRef({
                    apiProvider: state.settings.apiProvider,
                    proxySettings: state.settings.proxySettings,
                    geminiSettings: state.settings.geminiSettings,
                    proxyPresets: state.settings.proxyPresets,
                    geminiPresets: state.settings.geminiPresets,
                }),
                replaceAgentModels: state.settings.replaceAgentModels,
                userPersonaDetails: state.game.userPersonaDetails,
                sendUserAvatar: state.settings.sendUserAvatar,
                sendCharacterAvatar: state.settings.sendCharacterAvatar,
                ignoreImages: state.settings.ignoreImages,
                editFullMessage: state.settings.editFullMessage,
                deleteUnfinishedGeminiSentencesOnError: state.settings.deleteUnfinishedGeminiSentencesOnError,
                storyBible: state.game.storyBible,
                perCharacterStates: state.game.perCharacterStates,
                worldModelStatesByNodeId: state.game.worldModelStatesByNodeId,
                lockedFirstMessageIndex: state.game.lockedFirstMessageIndex,
                baseCharacterSetting: state.game.baseCharacterSetting,
                baseCharacterScenario: state.game.baseCharacterScenario,
                activeManualScenarioIds: state.game.activeManualScenarioIds,
                characterScenario: state.settings.characterScenario,
            };

            storageService.saveChatSession(currentChatId, gameState, selectedCharacter);

            dispatch(setAutosaveStatus('Game autosaved!'));
            setTimeout(() => dispatch(setAutosaveStatus('')), 2500);
        } catch (error: any) {
             console.error("Failed to autosave game:", error);
             let errorMessage = 'Autosave failed.';
             if (error && (error.name === 'QuotaExceededError' || (error.message && error.message.includes('exceeded the quota')))) {
                 errorMessage = 'Autosave failed: Storage is full. Please delete some old chats.';
             }
             dispatch(setAutosaveStatus(errorMessage));
             setTimeout(() => dispatch(setAutosaveStatus('')), 5000);
        }
    }
);

export const loadGameFromStorage = createAsyncThunk(
    'game/loadFromStorage',
    async (jsonString: string, { dispatch, getState }) => {
         try {
            const gameState: GameState = JSON.parse(jsonString);
            if (!gameState || !Array.isArray(gameState.storyHistory)) {
                throw new Error("Invalid save file format.");
            }
            
            let tree = gameState.chatTree;
            if (!tree && gameState.storyHistory) {
                tree = migrateHistoryToTree(gameState.storyHistory);
            }

            dispatch(setWorldModelStatesByNodeId(gameState.worldModelStatesByNodeId ?? {}));
            if (tree) {
                dispatch(setChatTree(tree));
            } else {
                dispatch(setStoryHistory(gameState.storyHistory));
            }
            
            const migratedCharacters = migrateCharacters(gameState.trackedCharacters, dispatch);
            dispatch(setTrackedCharacters(migratedCharacters));

            if (gameState.userPersonaDetails) {
                dispatch(setUserPersonaDetails(gameState.userPersonaDetails));
            } else {
                const state = getState() as RootState;
                const { personas, activePersonaId } = state.personas;
                const activePersona = personas.find(p => p.id === activePersonaId) || personas[0];
                dispatch(setUserPersonaDetails({
                    name: activePersona?.name || 'User',
                    description: activePersona?.description || SHARED_USER_DESCRIPTION,
                    avatar: activePersona?.avatar || DEFAULT_PERSONA_AVATAR
                }));
            }

            const wasLegacyHeavyMode = (gameState as any).isHeavyMode === true;
            dispatch(loadSettings({
                playerNotes: gameState.playerNotes ?? '',
                postHistoryInstruction: gameState.postHistoryInstruction ?? '',
                systemInstruction: gameState.systemInstruction ?? '',
                characterSetting: gameState.characterSetting ?? null,
                characterScenario: gameState.characterScenario ?? null,
                characterPersonality: gameState.characterPersonality || '',
                historyContextTurns: gameState.historyContextTurns,
                theme: gameState.theme,
                autosaveInterval: gameState.autosaveInterval,
                isWorldModelEnabled: gameState.isWorldModelEnabled ?? wasLegacyHeavyMode,
                // agentSettings from the save file are ignored — global config only.
                isIntelligentPresetAnalyzerEnabled: gameState.isIntelligentPresetAnalyzerEnabled,
                includeAllAgentResponsesInContext: gameState.includeAllAgentResponsesInContext,
                keepNonExistentAgentResponses: gameState.keepNonExistentAgentResponses,
                // apiProvider / proxySettings / geminiSettings are intentionally NOT
                // loaded from the chat — API/connection config is global, not story
                // data. Loading a chat keeps whatever provider/preset is active
                // globally; a stale per-chat copy used to clobber the live config here
                // (Object.assign in the loadSettings reducer), making presets "go crazy".
                replaceAgentModels: gameState.replaceAgentModels,
                sendUserAvatar: gameState.sendUserAvatar,
                sendCharacterAvatar: gameState.sendCharacterAvatar,
                ignoreImages: gameState.ignoreImages,
                editFullMessage: gameState.editFullMessage,
                deleteUnfinishedGeminiSentencesOnError: gameState.deleteUnfinishedGeminiSentencesOnError,
            }));

            dispatch(setStoryBible(gameState.storyBible ?? null));
            dispatch(setPerCharacterStates(gameState.perCharacterStates ?? {}));
            dispatch(setLockedFirstMessageIndex(gameState.lockedFirstMessageIndex ?? null));
            dispatch(setBaseCharacterSetting(gameState.baseCharacterSetting ?? gameState.characterSetting ?? null));
            dispatch(setBaseCharacterScenario(gameState.baseCharacterScenario ?? gameState.characterScenario ?? null));
            dispatch(setActiveManualScenarioIds(gameState.activeManualScenarioIds ?? []));

            // Re-select the chat's API preset by id if it still exists; otherwise
            // leave the globally-active provider/preset untouched.
            const fileSettings = (getState() as RootState).settings;
            const filePresetPatch = resolveApiPresetRef(gameState.apiPresetRef, {
                proxyPresets: fileSettings.proxyPresets,
                geminiPresets: fileSettings.geminiPresets,
                geminiApiKeys: fileSettings.geminiApiKeys,
            });
            if (filePresetPatch) dispatch(loadSettings(filePresetPatch));

            const newId = crypto.randomUUID();
            dispatch(setCurrentChatId(newId));

            dispatch(addLog({ message: 'Game loaded from file.' }));
            return true;
        } catch (err) {
            console.error("Failed to load game state:", err);
            dispatch(setError(err instanceof Error ? err.message : "Unknown error loading game"));
            return false;
        }
    }
);
