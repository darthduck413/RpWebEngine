

import { configureStore } from '@reduxjs/toolkit';
import uiReducer from './slices/uiSlice';
import settingsReducer from './slices/settingsSlice';
import gameReducer from './slices/gameSlice';
import logReducer from './slices/logSlice';
import personaReducer from './slices/personaSlice';
import charactersReducer from './slices/charactersSlice';
import { showToast } from './slices/uiSlice';
import { storageService } from '../services/storage';

// Middleware to handle local storage persistence for settings via storageService
// Using broad typing for store/next/action to prevent TypeScript from narrowing the AppDispatch type 
// which causes issues with AsyncThunks.
const persistenceMiddleware = (store: any) => (next: any) => (action: any) => {
  const result = next(action);
  const state = store.getState();

  if (action && action.type && typeof action.type === 'string') {
    if (action.type.startsWith('settings/')) {
        try {
        const settingsToSave = {
            theme: state.settings.theme,
            isWorldModelEnabled: state.settings.isWorldModelEnabled,
            worldModelRpmEnabled: state.settings.worldModelRpmEnabled,
            worldModelRpm: state.settings.worldModelRpm,
            agentSettings: state.settings.agentSettings,
            historyContextTurns: state.settings.historyContextTurns,
            autosaveInterval: state.settings.autosaveInterval,
            isIntelligentPresetAnalyzerEnabled: state.settings.isIntelligentPresetAnalyzerEnabled,
            includeAllAgentResponsesInContext: state.settings.includeAllAgentResponsesInContext,
            keepNonExistentAgentResponses: state.settings.keepNonExistentAgentResponses,
            apiProvider: state.settings.apiProvider,
            openRouterSettings: state.settings.openRouterSettings,
            proxySettings: state.settings.proxySettings,
            proxyPresets: state.settings.proxyPresets,
            geminiSettings: state.settings.geminiSettings,
            geminiApiKeys: state.settings.geminiApiKeys,
            geminiPresets: state.settings.geminiPresets,
            builtInPresetPromptRevision: state.settings.builtInPresetPromptRevision,
            replaceAgentModels: state.settings.replaceAgentModels,
            sendUserAvatar: state.settings.sendUserAvatar,
            sendCharacterAvatar: state.settings.sendCharacterAvatar,
            ignoreImages: state.settings.ignoreImages,
            editFullMessage: state.settings.editFullMessage,
            deleteUnfinishedGeminiSentencesOnError: state.settings.deleteUnfinishedGeminiSentencesOnError,
            enableAnthropicCaching: state.settings.enableAnthropicCaching,
            chatMaxWidthRem: state.settings.chatMaxWidthRem,
            chatTextPresetId: state.settings.chatTextPresetId,
            chatFontSizePx: state.settings.chatFontSizePx,
            showImageAttachButton: state.settings.showImageAttachButton,
        };
        
        storageService.saveSettings(settingsToSave);
        
        // Sync theme to DOM
        document.documentElement.setAttribute('data-theme', state.settings.theme);
        localStorage.setItem('rwe-theme', state.settings.theme);
        
        } catch (e) {
        console.error("Failed to save settings to storage", e);
        }
    }

    if (action.type.startsWith('personas/')) {
        try {
            storageService.savePersonas({
                personas: state.personas.personas,
                activePersonaId: state.personas.activePersonaId
            });
        } catch (e) {
            console.error("Failed to save personas to storage", e);
        }
    }

    if (action.type.startsWith('characters/')) {
        try {
            // storageService writes built-ins as ids and full objects only for
            // custom characters. A code-defined id is authoritative on reload.
            storageService.saveCharacters(state.characters.characters);
        } catch (e) {
            console.error("Failed to save characters to storage", e);
            // Without this the change looks saved but vanishes on reload
            // (typically a localStorage quota error from large avatars).
            store.dispatch(showToast({ message: 'Storage full — character changes could not be saved. Free up space in Settings.', type: 'error' }));
        }
    }
  }
  
  return result;
};

export const store = configureStore({
  reducer: {
    ui: uiReducer,
    settings: settingsReducer,
    game: gameReducer,
    logs: logReducer,
    personas: personaReducer,
    characters: charactersReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(persistenceMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
