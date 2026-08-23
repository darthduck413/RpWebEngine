

import { createAsyncThunk } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { 
    setTrackedCharacters,
    setError
} from '../slices/gameSlice';
import { 
    showToast
} from '../slices/uiSlice';
import { 
    addLog 
} from '../slices/logSlice';
import { 
    setGameSettings
} from '../slices/settingsSlice';
import { 
  summarizeText,
  analyzeCharactersFromHistory,
  analyzeAndSuggestContext,
  generatePlayerNotes
} from '../../services/geminiService';
import {
  summarizeText as summarizeTextProxy,
  analyzeCharactersFromHistory as analyzeCharactersFromHistoryProxy,
  analyzeAndSuggestContext as analyzeAndSuggestContextProxy,
  generatePlayerNotes as generatePlayerNotesProxy
} from '../../services/proxyService';

export const analyzeCharacters = createAsyncThunk(
    'game/analyzeCharacters',
    async (_, { dispatch, getState }) => {
        const state = getState() as RootState;
        const { storyHistory, userPersonaDetails } = state.game;
        const { selectedCharacter } = state.ui;
        const { apiProvider, proxySettings, geminiSettings } = state.settings;
        
        const personaName = userPersonaDetails?.name || 'User';
        
        if (!selectedCharacter) return;

        dispatch(addLog({ message: 'Analyzing story history to identify characters...' }));
        dispatch(showToast({ message: 'Analyzing characters with AI...', type: 'info' }));

        try {
             let analyzedCharacters;
             if (apiProvider === 'proxy') {
                 analyzedCharacters = await analyzeCharactersFromHistoryProxy(storyHistory, personaName, selectedCharacter.name, proxySettings);
             } else {
                 analyzedCharacters = await analyzeCharactersFromHistory(storyHistory, personaName, selectedCharacter.name, geminiSettings);
             }
            
             dispatch(setTrackedCharacters(analyzedCharacters));
             dispatch(addLog({ message: 'Character analysis complete.', data: analyzedCharacters }));
             dispatch(showToast({ message: 'Character analysis complete!', type: 'success' }));
             return true;
        } catch (e) {
             const msg = e instanceof Error ? e.message : "Unknown error";
             dispatch(setError(`Character analysis failed: ${msg}`));
             dispatch(showToast({ message: 'Character analysis failed.', type: 'error' }));
             return false;
        }
    }
);

export const analyzeContext = createAsyncThunk(
    'game/analyzeContext',
    async (_, { dispatch, getState }) => {
        const state = getState() as RootState;
        const { storyHistory } = state.game;
        const { apiProvider, proxySettings, geminiSettings, autosaveInterval, isIntelligentPresetAnalyzerEnabled, includeAllAgentResponsesInContext, keepNonExistentAgentResponses, sendUserAvatar, sendCharacterAvatar, ignoreImages, editFullMessage, deleteUnfinishedGeminiSentencesOnError, enableAnthropicCaching } = state.settings;

        dispatch(addLog({ message: 'Analyzing history for context length...' }));

        try {
            let suggestedTurns;
            if (apiProvider === 'proxy') {
                suggestedTurns = await analyzeAndSuggestContextProxy(storyHistory, proxySettings);
            } else {
                suggestedTurns = await analyzeAndSuggestContext(storyHistory, geminiSettings);
            }
            
            dispatch(setGameSettings({
                turns: suggestedTurns,
                interval: autosaveInterval,
                intelligentAnalyzer: isIntelligentPresetAnalyzerEnabled,
                includeAllAgentResponsesInContext,
                keepNonExistentAgentResponses,
                sendUserAvatar,
                sendCharacterAvatar,
                ignoreImages,
                editFullMessage,
                deleteUnfinishedGeminiSentencesOnError,
                enableAnthropicCaching
            }));
            
            dispatch(addLog({ message: `Smart Context: Set to ${suggestedTurns} turns.` }));
            dispatch(showToast({ message: `Context set to ${suggestedTurns} turns.`, type: 'success' }));
            return true;
        } catch (e) {
             dispatch(setError('Smart context failed.'));
             return false;
        }
    }
);

export const generateSmartPlayerNotes = createAsyncThunk(
    'game/generateSmartPlayerNotes',
    async (_, { dispatch, getState }) => {
        const state = getState() as RootState;
        const { storyHistory, userPersonaDetails } = state.game;
        const { apiProvider, proxySettings, geminiSettings } = state.settings;
        
        const personaName = userPersonaDetails?.name || 'User';

        dispatch(showToast({ message: 'Generating Smart Notes...', type: 'info' }));
        try {
            let notes;
            if (apiProvider === 'proxy') {
                notes = await generatePlayerNotesProxy(storyHistory, personaName, proxySettings);
            } else {
                notes = await generatePlayerNotes(storyHistory, personaName, geminiSettings);
            }
            
             dispatch(showToast({ message: `Smart Notes Generated.`, type: 'success' }));
             return notes;
        } catch (e) {
            console.error(e);
            dispatch(showToast({ message: 'Failed to generate notes.', type: 'error' }));
            return undefined;
        }
    }
);

export const summarizeResponse = createAsyncThunk(
    'game/summarize',
    async ({ agentName, text }: { agentName: string; text: string }, { dispatch, getState }) => {
        const state = getState() as RootState;
        const { apiProvider, proxySettings, geminiSettings, playerNotes } = state.settings;

        dispatch(showToast({ message: `Summarizing ${agentName}...`, type: 'info' }));
        try {
            let summary;
            if (apiProvider === 'proxy') {
                summary = await summarizeTextProxy(text, proxySettings);
            } else {
                summary = await summarizeText(text, geminiSettings);
            }
            
            const note = `\n\n--- Summary from ${agentName} ---\n${summary}`;
             const newNotes = playerNotes + note;
             dispatch({ type: 'settings/setPlayerNotes', payload: newNotes });
             dispatch(showToast({ message: `Added summary from ${agentName} to notes.`, type: 'success' }));
        } catch (e) {
            dispatch(showToast({ message: 'Summarization failed.', type: 'error' }));
        }
    }
);
