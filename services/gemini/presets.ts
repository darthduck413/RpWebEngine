
import { Type } from "@google/genai";
import { AI_NAME, GEMINI_MODEL_PRO, GEMINI_MODEL_FLASH } from '../../constants';
import { PRESETS } from '../../presets';
import { StoryTurn, AgentSettings, GeminiSettings, TrackedCharacter } from '../../types';
import { getGeminiClient, getModelName } from './client';
import { buildGeminiConfig } from './config';
import { getPowerScalingExample } from '../common/powerScaling';
// Import tryParseJSON utility for robust response parsing
import { tryParseJSON } from "../common/gameplay";
import {
    SUMMARIZE_TEXT_PROMPT,
    getSelectPresetSystemPrompt,
    GENERATE_PRESET_SYSTEM_PROMPT,
    ADAPT_PRESET_SYSTEM_PROMPT,
    ANALYZE_CHARACTERS_SYSTEM_PROMPT,
    ANALYZE_CONTEXT_SYSTEM_PROMPT,
    GENERATE_PLAYER_NOTES_SYSTEM_PROMPT,
    buildShortHistoryText
} from '../common/prompts';


export const summarizeText = async (textToSummarize: string, geminiSettings?: GeminiSettings): Promise<string> => {
    if (!textToSummarize.trim()) return "No text.";
    const ai = getGeminiClient(geminiSettings);
    try {
        const response = await ai.models.generateContent({
            model: getModelName('flash'),
            contents: [{ role: 'user', parts: [{ text: SUMMARIZE_TEXT_PROMPT(textToSummarize) }] }],
            config: buildGeminiConfig(geminiSettings),
        });
        return response.text;
    } catch (error) {
        console.error("Summarize Error:", error);
        throw new Error("Failed to summarize text.");
    }
};

export const generatePlayerNotes = async (
    storyHistory: StoryTurn[],
    playerName: string,
    geminiSettings?: GeminiSettings
): Promise<string> => {
    const ai = getGeminiClient(geminiSettings);
    const historyText = buildShortHistoryText(storyHistory, playerName, AI_NAME);
    try {
        const response = await ai.models.generateContent({
            model: GEMINI_MODEL_FLASH,
            contents: [{ role: 'user', parts: [{ text: `History:\n\n${historyText}` }] }],
            config: buildGeminiConfig(geminiSettings, {
                systemInstruction: GENERATE_PLAYER_NOTES_SYSTEM_PROMPT(playerName),
            }),
        });
        return response.text || "Failed to generate notes.";
    } catch (error) {
        console.error("Notes Generation Error:", error);
        throw new Error("Failed to generate notes.");
    }
};

export const selectPreset = async (
  storyHistory: StoryTurn[],
  modelSelection: 'pro' | 'flash' | 'flash-lite',
  playerName: string,
  geminiSettings?: GeminiSettings
): Promise<{ agents: AgentSettings[], name: string }> => {
    const ai = getGeminiClient(geminiSettings);
    const presetNames = PRESETS.map(p => p.name);
    const presetsSummary = PRESETS.map(p => `- ${p.name}: ${p.description}`).join('\n');
    const historyText = buildShortHistoryText(storyHistory.slice(-5), playerName, AI_NAME);
    const isPro = getModelName(modelSelection) === GEMINI_MODEL_PRO;

    try {
        const response = await ai.models.generateContent({
            model: getModelName(modelSelection),
            contents: [{ role: 'user', parts: [{ text: `Context:\n\n${historyText}` }] }],
            config: buildGeminiConfig(geminiSettings, {
                systemInstruction: getSelectPresetSystemPrompt(presetNames, presetsSummary),
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { presetName: { type: Type.STRING } },
                    required: ['presetName'],
                },
                ...(isPro && { }),
            }),
        });
        
        // Use imported tryParseJSON
        const parsed = tryParseJSON<{presetName: string}>(response.text);
        const chosenPreset = PRESETS.find(p => p.name.toLowerCase() === parsed?.presetName?.toLowerCase());
        return chosenPreset ? { agents: chosenPreset.agents, name: chosenPreset.name } : { agents: PRESETS[0].agents, name: PRESETS[0].name };
    } catch (error) {
        console.error("Preset Selection Error:", error);
        return { agents: PRESETS[0].agents, name: PRESETS[0].name };
    }
};

export const generatePreset = async (
  storyHistory: StoryTurn[],
  modelSelection: 'pro' | 'flash' | 'flash-lite',
  playerName: string,
  geminiSettings?: GeminiSettings
): Promise<AgentSettings[]> => {
  const ai = getGeminiClient(geminiSettings);
  const historyText = buildShortHistoryText(storyHistory.slice(-15), playerName, AI_NAME);
  const isPro = getModelName(modelSelection) === GEMINI_MODEL_PRO;

  try {
    const response = await ai.models.generateContent({
      model: getModelName(modelSelection),
      contents: [{ role: 'user', parts: [{ text: `History:\n\n${historyText}` }] }],
      config: buildGeminiConfig(geminiSettings, {
        systemInstruction: GENERATE_PRESET_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        ...(isPro && { }),
      }),
    });

    // Use imported tryParseJSON
    const settings = tryParseJSON<AgentSettings[]>(response.text);
    if (Array.isArray(settings) && settings.length > 0) return settings;
    throw new Error("Invalid preset generated.");
  } catch (error) {
    console.error("Preset Generation Error:", error);
    throw new Error("Failed to generate custom preset.");
  }
};

export const adaptPresetToIntelligentAgents = async (
  storyHistory: StoryTurn[],
  currentAgentSettings: AgentSettings[],
  playerName: string,
  geminiSettings?: GeminiSettings
): Promise<AgentSettings[]> => {
  const ai = getGeminiClient(geminiSettings);
  const storyContextText = buildShortHistoryText(storyHistory.slice(-15), playerName, AI_NAME);
  const userPrompt = `Context:\n${storyContextText}\n\nPreset:\n${JSON.stringify(currentAgentSettings, null, 2)}`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL_PRO,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: buildGeminiConfig(geminiSettings, {
        systemInstruction: ADAPT_PRESET_SYSTEM_PROMPT(playerName),
        responseMimeType: "application/json",
      }),
    });

    // Use imported tryParseJSON
    const settings = tryParseJSON<AgentSettings[]>(response.text);
    return (Array.isArray(settings) && settings.length > 0) ? settings : currentAgentSettings;
  } catch (error) {
    console.error("Adaptation Error:", error);
    return currentAgentSettings;
  }
};

export const analyzeCharactersFromHistory = async (
  storyHistory: StoryTurn[],
  playerName: string,
  characterName: string,
  geminiSettings?: GeminiSettings,
): Promise<TrackedCharacter[]> => {
  const ai = getGeminiClient(geminiSettings);
  const historyText = buildShortHistoryText(storyHistory, playerName, AI_NAME);
  const powerScalingExample = getPowerScalingExample(characterName);

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL_PRO,
      contents: [{ role: 'user', parts: [{ text: `Analyze:\n\n${historyText}` }] }],
      config: buildGeminiConfig(geminiSettings, {
        systemInstruction: ANALYZE_CHARACTERS_SYSTEM_PROMPT(playerName, powerScalingExample),
        responseMimeType: "application/json",
      }),
    });

    // Use imported tryParseJSON
    const analyzed = tryParseJSON<any[]>(response.text);
    if (!Array.isArray(analyzed)) throw new Error("Invalid analysis.");

    return analyzed.map(char => {
        const id = char.name === playerName ? 'player' : crypto.randomUUID();
        return { 
            ...char, 
            id, 
            health: char.health || { value: 75, description: 'Normal.' }, 
            topics: (char.topics || []).map((t:any) => ({
                ...t, 
                id: crypto.randomUUID(), 
                variables: (t.variables || []).map((v:any) => ({...v, id: crypto.randomUUID()}))
            })) 
        };
    });
  } catch (error) {
    console.error("Character Analysis Error:", error);
    throw new Error("Character analysis failed.");
  }
};

export const analyzeAndSuggestContext = async (
  storyHistory: StoryTurn[],
  geminiSettings?: GeminiSettings
): Promise<number> => {
    const ai = getGeminiClient(geminiSettings);
    const historyText = buildShortHistoryText(storyHistory, 'Player', 'Narrator', 200);

    try {
        const response = await ai.models.generateContent({
            model: GEMINI_MODEL_FLASH,
            contents: [{ role: 'user', parts: [{ text: `Analyze History:\n\n${historyText}` }] }],
            config: buildGeminiConfig(geminiSettings, {
                systemInstruction: ANALYZE_CONTEXT_SYSTEM_PROMPT,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { contextTurns: { type: Type.NUMBER } },
                    required: ['contextTurns'],
                },
            }),
        });
        
        // Use imported tryParseJSON
        const parsed = tryParseJSON<{contextTurns: number}>(response.text);
        return Math.max(10, Math.floor(parsed?.contextTurns || 10));
    } catch (error) {
        console.error("Smart Context Error:", error);
        return 10;
    }
};
