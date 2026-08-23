import { z } from 'zod';
import { StoryTurn, AgentSettings, TrackedCharacter, ProxySettings } from '../../types';
import { PRESETS } from "../../presets";
import { AI_NAME } from '../../constants';
import { getPowerScalingExample } from '../common/powerScaling';
import {
    AGENT_SETTINGS_SCHEMA_PROMPT,
    CHARACTER_ANALYSIS_SCHEMA_PROMPT,
    SUMMARIZE_TEXT_PROMPT,
    getSelectPresetSystemPrompt,
    GENERATE_PRESET_SYSTEM_PROMPT,
    ADAPT_PRESET_SYSTEM_PROMPT,
    ANALYZE_CHARACTERS_SYSTEM_PROMPT,
    ANALYZE_CONTEXT_SYSTEM_PROMPT,
    GENERATE_PLAYER_NOTES_SYSTEM_PROMPT,
    buildShortHistoryText,
} from '../common/prompts';
import { callProxy } from './client';
import { ProxyMessage } from './prompts';

const agentSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  systemInstruction: z.string(),
  contextMessages: z.number().int(),
  model: z.string(),
  order: z.number().int(),
  connections: z.array(z.string()),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  type: z.enum(['default', 'switch', 'spy']).optional(),
  spyMode: z.enum(['morph', 'preset']).optional(),
  spyMorphSkip: z.boolean().optional(),
  defaultSkip: z.boolean().optional(),
  canUpdateCharacters: z.boolean().optional(),
});
const agentSettingsArraySchema = z.array(agentSettingsSchema);

const characterVariableSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['slider', 'text']),
  value: z.union([z.number(), z.string()]),
  description: z.string(),
  targetId: z.string().optional(),
});

const characterTopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().default(''),
  variables: z.array(characterVariableSchema),
});

const characterHealthSchema = z.object({
  value: z.union([z.number(), z.string()]),
  description: z.string(),
});

const trackedCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  health: characterHealthSchema,
  topics: z.array(characterTopicSchema),
});

const trackedCharactersResponseSchema = z.union([
  z.array(trackedCharacterSchema),
  z.object({}).catchall(z.array(trackedCharacterSchema))
]);

export const generatePlayerNotes = async (
    storyHistory: StoryTurn[],
    playerName: string,
    settings: ProxySettings
): Promise<string> => {
    const historyText = buildShortHistoryText(storyHistory, playerName, AI_NAME);
    const systemInstruction = GENERATE_PLAYER_NOTES_SYSTEM_PROMPT(playerName);
    
    const messages: ProxyMessage[] = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `Here is the full story history:\n\n${historyText}` }
    ];

    try {
        const response = await callProxy(settings, settings.model, messages, false);
        return response || "Failed to generate notes.";
    } catch (error) {
        console.error("Error generating player notes with Proxy:", error);
        throw new Error("Failed to generate player notes due to an API error.");
    }
};

export const selectPreset = async (
  storyHistory: StoryTurn[],
  model: string,
  playerName: string,
  settings: ProxySettings
): Promise<{ agents: AgentSettings[], name: string }> => {
    const presetsSummary = PRESETS.map(p => `- ${p.name}: ${p.detailedDescription || p.description}`).join('\n');
    const presetNames = PRESETS.map(p => p.name);

    const historyText = buildShortHistoryText(storyHistory.slice(-5), playerName, 'Assistant');

    const systemInstruction = `${getSelectPresetSystemPrompt(presetNames, presetsSummary)}
Example: {"presetName": "Baseline"}`;

    const messages: ProxyMessage[] = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `Here is the recent history:\n\n${historyText}` }
    ];

    try {
        const parsedJson = await callProxy(settings, model, messages, true);
        const validationResult = z.object({ presetName: z.string() }).safeParse(parsedJson);
        
        if (!validationResult.success) {
            console.error("Zod validation failed for preset selection:", validationResult.error.issues);
            throw new Error("AI returned data in an unexpected format for preset selection.");
        }

        const chosenPresetName = validationResult.data.presetName;
        const chosenPreset = PRESETS.find(p => p.name.toLowerCase() === chosenPresetName.toLowerCase());

        if (!chosenPreset) {
            return { agents: PRESETS[0].agents, name: PRESETS[0].name };
        }

        return { agents: chosenPreset.agents, name: chosenPreset.name };
    } catch (error) {
        console.error("Error during Proxy preset selection:", error);
        return { agents: PRESETS[0].agents, name: PRESETS[0].name };
    }
};

export const generatePreset = async (
  storyHistory: StoryTurn[],
  model: string,
  playerName: string,
  settings: ProxySettings
): Promise<AgentSettings[]> => {
    const historyText = buildShortHistoryText(storyHistory.slice(-15), playerName, AI_NAME);

    const systemInstruction = `${GENERATE_PRESET_SYSTEM_PROMPT}\n${AGENT_SETTINGS_SCHEMA_PROMPT}`;

    const messages: ProxyMessage[] = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `Here is the recent history:\n\n${historyText}` }
    ];
  
    try {
        const newAgentSettingsJson = await callProxy(settings, model, messages, true);
        const validationResult = agentSettingsArraySchema.safeParse(newAgentSettingsJson);

        if (!validationResult.success) {
            console.error("Zod validation failed for preset generation:", validationResult.error.issues);
            throw new Error("AI returned invalid data for preset generation.");
        }
        
        return validationResult.data as AgentSettings[];
    } catch (error) {
        console.error("Error during Proxy preset generation:", error);
        throw new Error("The AI failed to generate a valid agent preset.");
    }
};

export const adaptPresetToIntelligentAgents = async (
  storyHistory: StoryTurn[],
  currentAgentSettings: AgentSettings[],
  playerName: string,
  settings: ProxySettings
): Promise<AgentSettings[]> => {
  const relevantHistory = storyHistory.slice(-15);
  const storyContextText = buildShortHistoryText(relevantHistory, playerName, 'Assistant');

  const systemInstruction = `${ADAPT_PRESET_SYSTEM_PROMPT(playerName)}\n${AGENT_SETTINGS_SCHEMA_PROMPT}`;

  const userPrompt = `Analyze the story scene to identify active NPCs. Then, adapt the provided agent preset by replacing general agents with specialized ones.

**Story Context:**
---
${storyContextText}
---

**Current Agent Preset to Adapt:**
---
${JSON.stringify(currentAgentSettings, null, 2)}
---

Provide the full, updated JSON array of agents.`;

  const messages: ProxyMessage[] = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: userPrompt }
  ];

  try {
    const newAgentSettingsJson = await callProxy(settings, settings.model, messages, true);
    const validationResult = agentSettingsArraySchema.safeParse(newAgentSettingsJson);

    if (!validationResult.success) {
        return currentAgentSettings;
    }

    return validationResult.data as AgentSettings[];
  } catch (error) {
    console.error("Error during Proxy intelligent agent adaptation:", error);
    throw error;
  }
};

export const summarizeText = async (
    textToSummarize: string,
    settings: ProxySettings
): Promise<string> => {
    if (!textToSummarize.trim()) {
        return "No text to summarize.";
    }
    const messages: ProxyMessage[] = [
        { role: 'system', content: "You are a helpful assistant." },
        { role: 'user', content: SUMMARIZE_TEXT_PROMPT(textToSummarize) }
    ];
    try {
        const summary = await callProxy(settings, settings.model, messages);
        return summary;
    } catch (error) {
        console.error("Error summarizing text with Proxy:", error);
        throw new Error("Failed to summarize text due to an API error.");
    }
};

export const analyzeCharactersFromHistory = async (
  storyHistory: StoryTurn[],
  playerName: string,
  characterName: string,
  settings: ProxySettings
): Promise<TrackedCharacter[]> => {
  const historyText = buildShortHistoryText(storyHistory, playerName, AI_NAME);

  const powerScalingExample = getPowerScalingExample(characterName);
  const systemInstruction = `${ANALYZE_CHARACTERS_SYSTEM_PROMPT(playerName, powerScalingExample)}\n${CHARACTER_ANALYSIS_SCHEMA_PROMPT}`;
  
  const messages: ProxyMessage[] = [
    { role: 'system', content: systemInstruction },
    { role: 'user', content: `Analyze the following story:\n\n${historyText}` }
  ];
  
  try {
    const responseData = await callProxy(settings, settings.model, messages, true);
    const validationResult = trackedCharactersResponseSchema.safeParse(responseData);
    
    if (!validationResult.success) {
        console.error("Zod validation failed for character analysis:", validationResult.error.issues);
        throw new Error("AI returned data in an unexpected format for character analysis.");
    }
    
    const validatedData = validationResult.data;
    let analyzedCharacters: TrackedCharacter[];

    if (Array.isArray(validatedData)) {
      analyzedCharacters = validatedData as unknown as TrackedCharacter[];
    } else {
      const potentialArray = Object.values(validatedData).find(value => Array.isArray(value));
      if (potentialArray) {
        analyzedCharacters = potentialArray as unknown as TrackedCharacter[];
      } else {
        analyzedCharacters = [];
      }
    }

    const finalCharacters: TrackedCharacter[] = [];
    const nameToIdMap: { [key: string]: string } = {};

    analyzedCharacters.forEach(char => {
        const id = char.name === playerName ? 'player' : crypto.randomUUID();
        nameToIdMap[char.name] = id;
        
        finalCharacters.push({
            ...char,
            id,
            topics: (char.topics || []).map((t: any) => ({
                ...t,
                id: crypto.randomUUID(),
                variables: (t.variables || []).map((v: any) => ({
                    ...v,
                    id: crypto.randomUUID(),
                }))
            }))
        });
    });

    finalCharacters.forEach(char => {
      char.topics.forEach(topic => {
        if (topic.name === 'Relationships') {
          topic.variables.forEach(rel => {
            rel.targetId = nameToIdMap[rel.name] || 'unknown';
          });
        }
      });
    });
    
    return finalCharacters;
  } catch (error) {
    console.error("Error during Proxy character analysis:", error);
    throw new Error("The AI failed to analyze the characters from the story.");
  }
};

export const analyzeAndSuggestContext = async (
  storyHistory: StoryTurn[],
  settings: ProxySettings
): Promise<number> => {
    const historyText = buildShortHistoryText(storyHistory, 'Player', 'Narrator', 200);

    const systemInstruction = `${ANALYZE_CONTEXT_SYSTEM_PROMPT}
Example: {"contextTurns": 15}`;

    const messages: ProxyMessage[] = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `Here is the story history:\n\n${historyText}` }
    ];

    try {
        const parsedJson = await callProxy(settings, settings.model, messages, true);
        const validationResult = z.object({ contextTurns: z.number().min(10) }).safeParse(parsedJson);

        if (!validationResult.success) {
            throw new Error("AI returned invalid data for smart context analysis.");
        }
        
        return validationResult.data.contextTurns;
    } catch (error) {
        console.error("Error during Proxy smart context analysis:", error);
        throw new Error("The AI failed to analyze the context.");
    }
};