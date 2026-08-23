
import { Content, Type } from "@google/genai";
import { StoryTurn, AgentSettings, AgentResponse, Character, TrackedCharacter, CharacterUpdate, GeminiSettings, WorldSnapshot, StoryBible, StoryBibleUniverse } from '../../types';
import { SYSTEM_INSTRUCTION_PLACEHOLDER } from "../../presets";
import { getGeminiClient, getModelName } from './client';
import { buildGeminiConfig } from './config';
import { buildContentHistory } from './prompts';
import {
    buildSystemInstruction, CHARACTER_UPDATE_SCHEMA_PROMPT, buildHistoryTurns,
    UNIVERSE_DETECTION_SCHEMA_PROMPT, STORY_BIBLE_PLOT_SCHEMA_PROMPT, STORY_BIBLE_LORE_SCHEMA_PROMPT,
    STORY_BIBLE_ROSTER_SCHEMA_PROMPT, STORY_BIBLE_LOCATIONS_SCHEMA_PROMPT,
    WORLD_STATE_SCHEMA_PROMPT, CHARACTER_CANDIDATE_SCHEMA_PROMPT, GM_CONTEXT_TEMPLATE, TURN_ROUTER_SCHEMA_PROMPT,
    INNER_STATE_SCHEMA_PROMPT, DRIFT_DIRECTIVE_SCHEMA_PROMPT, POST_CHECK_SCHEMA_PROMPT, PLOT_TRACKER_SCHEMA_PROMPT,
    buildWorldModelAgentContext, getCharacterContext
} from '../common/prompts';
import { PerCharacterState } from '../../types';
import { AgentApiExecutor, AgentOutput, executeHeavyMode, HeavyModeParams, tryParseJSON, ExecuteResult, resolveOutputType, TurnRoutingDecision, normalizePlotProgress } from "../common/gameplay";
import { composeWorldInfo } from '../common/worldInfo';
import { buildWorldModelBlocks, flattenWorldModelBlocks, resolveAgentHistoryWindow } from '../common/worldModelPrompt';
import { GEMINI_MODEL_PRO, DEFAULT_GEMINI_API_MODEL } from "../../constants";
import { geminiUsageCacheKey, usageTracker } from "../common/usage";
import { cleanModelOutputForPrompt } from '../common/promptText';

// Surface the real failure reason instead of a generic "API communication failed".
// The genai SDK packs the useful text into error.message, sometimes with an embedded
// JSON {"error":{"message":...}} (quota, key, model-overloaded, etc.) — pull it out.
const humanizeGeminiError = (error: unknown): string => {
    const detail = (error instanceof Error ? error.message : String(error)).trim();
    const jsonMatch = detail.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const json = JSON.parse(jsonMatch[0]);
            const msg = json?.error?.message ?? json?.message;
            if (typeof msg === 'string' && msg.trim()) return msg.trim();
        } catch {
            // fall through to the raw message
        }
    }
    return detail || 'Gemini request failed.';
};

const providerGeminiSettings = (params: HeavyModeParams): GeminiSettings | undefined =>
    params.providerSettings as GeminiSettings | undefined;

const providerGeminiClient = (params: HeavyModeParams, agentName?: string) =>
    getGeminiClient(providerGeminiSettings(params), agentName ? `wm:${agentName}` : 'wm');

/**
 * Builds the request config for one World Model agent.
 *
 * The `systemInstruction` handed in is the agent's ROLE only. It gets layered
 * behind the shared background blocks (character card and story bible)
 * so every agent that sees the same background produces the same system prefix —
 * which is what Gemini's implicit cache matches on. Player notes stay after
 * history so editing them cannot invalidate that shared prefix.
 */
const providerGeminiConfig = (
    params: HeavyModeParams,
    agent: AgentSettings | null,
    overrides: Record<string, unknown> = {},
    sharedBlockOptions: { cardInRole?: boolean; includeBible?: boolean } = {}
) => {
    const { systemInstruction, ...rest } = overrides;
    const layeredSystemInstruction = (agent && typeof systemInstruction === 'string')
        ? flattenWorldModelBlocks(buildWorldModelBlocks({
            character: params.character,
            storyBible: sharedBlockOptions.includeBible === false ? null : params.storyBible,
            roleInstruction: systemInstruction,
            agent,
            cardInRole: sharedBlockOptions.cardInRole,
        }))
        : systemInstruction;

    return buildGeminiConfig(providerGeminiSettings(params), {
        ...(params.signal ? { abortSignal: params.signal } : {}),
        ...(layeredSystemInstruction !== undefined ? { systemInstruction: layeredSystemInstruction } : {}),
        ...rest,
    });
};

const buildWorldModelContextBlock = (params: HeavyModeParams): string => {
    const blocks: string[] = [];
    if (params.turnNumber !== undefined || params.plotPhase) {
        blocks.push(`[POSITION] turn=${params.turnNumber ?? '?'} · plotPhase=${params.plotPhase ?? '?'}[/POSITION]`);
    }
    if (params.storyBible) {
        blocks.push(`[STORY BIBLE]\n${JSON.stringify(params.storyBible, null, 2)}\n[/STORY BIBLE]`);
    }
    if (params.previousWorldSnapshot) {
        blocks.push(`[PREVIOUS WORLD SNAPSHOT]\n${JSON.stringify(params.previousWorldSnapshot, null, 2)}\n[/PREVIOUS WORLD SNAPSHOT]`);
    }
    return blocks.join('\n\n');
};

const buildWorldModelVisibleContextBlock = (
    params: HeavyModeParams,
    agent: AgentSettings,
    options: { perCharacterState?: PerCharacterState | null; previousResponse?: string } = {}
): string => buildWorldModelAgentContext({
    agent,
    character: params.character,
    playerNotes: params.playerNotes,
    storyBible: params.storyBible,
    previousWorldSnapshot: params.previousWorldSnapshot,
    currentWorldSnapshot: params.currentWorldSnapshot,
    perCharacterState: options.perCharacterState,
    turnNumber: params.turnNumber,
    plotPhase: params.plotPhase,
    playerChoice: params.playerChoice,
    previousResponse: options.previousResponse,
    // Card + bible now lead the systemInstruction as cacheable blocks.
    omitSharedBlocks: true,
});

const pickStoryBibleSchemaPrompt = (field: string | undefined): string => {
    switch (field) {
        case 'plot': return STORY_BIBLE_PLOT_SCHEMA_PROMPT;
        case 'lore': return STORY_BIBLE_LORE_SCHEMA_PROMPT;
        case 'charactersRoster': return STORY_BIBLE_ROSTER_SCHEMA_PROMPT;
        case 'locations': return STORY_BIBLE_LOCATIONS_SCHEMA_PROMPT;
        default: return STORY_BIBLE_PLOT_SCHEMA_PROMPT;
    }
};

export async function* getGameTurnStream(
    storyHistory: StoryTurn[],
    playerNotes: string,
    character: Character,
    historyContextTurns: number,
    includeAllAgentResponsesInContext: boolean | undefined,
    trackedCharacters: TrackedCharacter[] | undefined,
    geminiSettings: GeminiSettings | undefined,
    logContext?: (data: any) => void,
    signal?: AbortSignal,
    avatarContext?: { userAvatar?: string | null, charAvatar?: string | null },
    ignoreImages?: boolean,
    manualScenarios?: string,
    postHistoryInstruction?: string
): AsyncGenerator<string, void, undefined> {
  const ai = getGeminiClient(geminiSettings, 'light-stream');

  // World Info split across cache regions: static always-on lore stays in the
  // (cached) systemInstruction; per-character keyword profiles ride the volatile
  // tail inside buildContentHistory so they don't invalidate the cached prefix.
  const worldInfoAlreadyComposed = [character.personality, character.setting, character.scenario ?? ''];
  const alwaysWorldInfo = composeWorldInfo(character.loreBook, storyHistory, undefined, worldInfoAlreadyComposed, undefined, 'always');
  const keywordWorldInfo = composeWorldInfo(character.loreBook, storyHistory, undefined, worldInfoAlreadyComposed, undefined, 'keyword');
  const selectedModel = geminiSettings?.model || DEFAULT_GEMINI_API_MODEL;
  const modelName = getModelName(selectedModel);

  const contents = buildContentHistory(
    storyHistory,
    historyContextTurns,
    character.name,
    character.playerName,
    trackedCharacters, {
      includeAllAgentResponses: includeAllAgentResponsesInContext,
      userAvatarBase64: avatarContext?.userAvatar,
      charAvatarBase64: avatarContext?.charAvatar,
      charName: character.name,
      userName: character.playerName,
      ignoreImages,
      keywordWorldInfo,
      manualScenarios,
      playerNotes,
      postHistoryInstruction,
      cachingActive: usageTracker.hasObservedCacheHits(geminiUsageCacheKey(modelName))
    });

  if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Continue the story.' }] });
  }

  // Notes never go in here — see buildProxyMessages for why the tail is the only
  // position that does not cost a full re-read of the card and the history.
  const finalSystemInstruction = buildSystemInstruction(
      character.systemInstructionTemplate,
      '',
      character.setting,
      character.personality,
      character.playerDescription,
      character.name,
      character.playerName,
      character.scenario ?? '',
      alwaysWorldInfo
  );

  const loggedConfig = buildGeminiConfig(geminiSettings, {
    systemInstruction: finalSystemInstruction,
  });
  const requestConfig = buildGeminiConfig(geminiSettings, {
    systemInstruction: finalSystemInstruction,
    ...(signal ? { abortSignal: signal } : {}),
  });

  if (logContext) {
      logContext({
          type: 'gemini-stream',
          model: modelName,
          config: loggedConfig,
          contents: contents
      });
  }
  
  try {
    const result = await ai.models.generateContentStream({
      model: modelName, 
      contents: contents,
      config: requestConfig,
    });
    
    for await (const chunk of result) {
        if (signal?.aborted) {
            return;
        }
        const text = chunk.text;
        if (text) yield text;
    }
  } catch (error) {
    if (signal?.aborted) return;
    console.error("Gemini Stream Error:", error);
    if (error instanceof Error && error.message.includes('SAFETY')) {
        throw new Error("Response blocked by safety filters.");
    }
    throw new Error(humanizeGeminiError(error));
  }
};

const characterUpdateSchema = {
  type: Type.ARRAY,
  items: {
      type: Type.OBJECT,
      properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          health: {
              type: Type.OBJECT,
              properties: {
                  value: { type: Type.STRING },
                  description: { type: Type.STRING }
              },
              required: ['value', 'description']
          },
          topics: {
              type: Type.ARRAY,
              items: {
                  type: Type.OBJECT,
                  properties: {
                      name: { type: Type.STRING },
                      variables: {
                          type: Type.ARRAY,
                          items: {
                              type: Type.OBJECT,
                              properties: {
                                  name: { type: Type.STRING },
                                  type: { type: Type.STRING, enum: ['slider', 'text'] },
                                  value: { type: Type.STRING },
                                  description: { type: Type.STRING },
                              },
                              required: ['name', 'type', 'value'],
                          },
                      },
                  },
                  required: ['name', 'variables'],
              },
          },
      },
      required: ['name'],
  },
};

export const buildAgentMessages = (params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[], context: string): Content[] => {
    const { storyHistory, character, agentSettings, trackedCharacters, historyContextTurns, includeAllAgentResponsesInContext, keepNonExistentAgentResponses, ignoreImages } = params;
    const historyBeforePlayerChoice = storyHistory.slice(0, -1);
    const finalAgentNames = agentSettings.filter(a => a.connections.length === 0).map(a => a.name);
    const allCurrentAgentNames = agentSettings.map(a => a.name);
    const modelName = getModelName(agent.model);
    const cachingActive = usageTracker.hasObservedCacheHits(geminiUsageCacheKey(modelName));
    const showNotes = agent.instructionVisibility?.playerNotes ?? true;

    const agentHistory = buildContentHistory(
        historyBeforePlayerChoice,
        // Gemini's implicit cache is prefix-matched, so agents that share the same
        // window share the same cacheable history; see resolveAgentHistoryWindow.
        resolveAgentHistoryWindow(agent, agentSettings, historyContextTurns, cachingActive),
        character.name,
        character.playerName,
        trackedCharacters,
        {
          includeAllAgentResponses: includeAllAgentResponsesInContext,
          finalAgentNames: finalAgentNames,
          agentForContext: agent.connections.length === 0 ? undefined : agent.name,
          keepNonExistentAgentResponses: keepNonExistentAgentResponses,
          allCurrentAgentNames: allCurrentAgentNames,
          ignoreImages: ignoreImages,
          cachingActive,
          includeCharacterSheets: false,
        }
    );

    const playerNotesContext = showNotes && params.playerNotes.trim()
        ? `<Notes>\n${params.playerNotes.trim()}\n</Notes>`
        : '';
    agentHistory.push({
        role: 'user',
        parts: [{ text: [playerNotesContext, cleanModelOutputForPrompt(context)].filter(Boolean).join('\n\n') }],
    });
    return agentHistory;
}

export const geminiApiExecutor: AgentApiExecutor = {
    async getCharacterUpdate(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const taskContext = parentResults.length > 0
            ? `Inputs from previous agents:\n\n${parentResults.map(o => `[${o.agentName}]: ${cleanModelOutputForPrompt(o.text)}`).join('\n\n')}`
            : `User action: "${params.playerChoice}"`;
        const context = [
            getCharacterContext(params.trackedCharacters),
            taskContext,
        ].filter(Boolean).join('\n\n');

        const messages = buildAgentMessages(params, agent, parentResults, context);
        const systemInstruction = `${agent.systemInstruction}\n\n${CHARACTER_UPDATE_SCHEMA_PROMPT}`;
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        analysis: { type: Type.STRING },
                        characterUpdates: characterUpdateSchema,
                    },
                    required: ['analysis'],
                },
            })
        });
        
        const result = tryParseJSON<{analysis: string, characterUpdates?: any[]}>(res.text);
        if (!result) throw new Error("Agent failed to provide parseable analysis.");
        return result;
    },

    async getSkipDecision(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const messages = buildAgentMessages(params, agent, parentResults, "Determine if you should skip your task.");
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction: agent.systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { skip: { type: Type.BOOLEAN } },
                    required: ['skip']
                },
            })
        });
        const result = tryParseJSON<{skip: boolean}>(res.text);
        if (!result) throw new Error("Agent failed to provide skip decision.");
        return result;
    },

    async getSwitchDecision(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const connectedAgents = params.agentSettings.filter(a => agent.connections.includes(a.id));
        const context = `Pick next agent ID: ${connectedAgents.map(c => `"${c.id}" (${c.name})`).join(', ')}`;
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction: agent.systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { chosenAgentId: { type: Type.STRING } },
                    required: ['chosenAgentId'],
                },
            })
        });
        const result = tryParseJSON<{chosenAgentId: string}>(res.text);
        if (!result) throw new Error("Agent failed to provide branch choice.");
        return result;
    },
    
    async getSpyPreset(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const messages = buildAgentMessages(params, agent, parentResults, "Generate temporary agents for this scene.");
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction: agent.systemInstruction,
                responseMimeType: "application/json",
            })
        });
        const result = tryParseJSON<AgentSettings[]>(res.text);
        if (!result) throw new Error("Spy agent failed to produce a valid preset.");
        return result;
    },

    async getSpyMorph(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const messages = buildAgentMessages(params, agent, parentResults, "Update your system instruction.");
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction: agent.systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { newSystemInstruction: { type: Type.STRING } },
                    required: ['newSystemInstruction']
                },
            })
        });
        const result = tryParseJSON<{newSystemInstruction: string}>(res.text);
        if (!result) throw new Error("Morph agent failed.");
        return result;
    },

    async getSpyMorphWithSkip(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const messages = buildAgentMessages(params, agent, parentResults, "Decide if skip and update instruction.");
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction: agent.systemInstruction,
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { skip: { type: Type.BOOLEAN }, newSystemInstruction: { type: Type.STRING } },
                    required: ['skip']
                },
            })
        });
        const result = tryParseJSON<{newSystemInstruction?: string, skip: boolean}>(res.text);
        if (!result) throw new Error("Morph-skip agent failed.");
        return result;
    },
    
    async getDefaultResponse(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const visibility = agent.instructionVisibility;
        const showSetting = visibility ? visibility.setting : true;
        const showPersonality = visibility ? visibility.personality : true;
        const showDescription = visibility ? visibility.playerDescription : true;
        // Cache parity with light mode: ONLY the static character card + always-on
        // lore live in the (cached) systemInstruction. Keyword-triggered lore and all
        // per-turn World Model context (snapshot, candidates, position, scratchpad)
        // moves to the trailing content item, so the prompt prefix
        // (systemInstruction + history) stays byte-identical across turns and Gemini's
        // implicit context cache hits.
        const worldInfoAlreadyComposed = [params.character.personality, params.character.setting, params.character.scenario ?? ''];
        const alwaysWorldInfo = showSetting
            ? composeWorldInfo(params.character.loreBook, params.storyHistory, params.playerChoice, worldInfoAlreadyComposed, undefined, 'always')
            : '';
        const keywordWorldInfo = showSetting
            ? composeWorldInfo(params.character.loreBook, params.storyHistory, params.playerChoice, worldInfoAlreadyComposed, undefined, 'keyword')
            : '';
        const finalCharacterSystemInstruction = buildSystemInstruction(
            params.character.systemInstructionTemplate,
            '',
            showSetting ? params.character.setting : '',
            showPersonality ? params.character.personality : '',
            showDescription ? params.character.playerDescription : '',
            params.character.name,
            params.character.playerName,
            showSetting ? (params.character.scenario ?? '') : '',
            // Only always-on lore here; keyword lore is volatile and goes to the tail.
            alwaysWorldInfo
        );
        let agentSystemInstruction = agent.systemInstruction.replace(SYSTEM_INSTRUCTION_PLACEHOLDER, finalCharacterSystemInstruction);
        agentSystemInstruction = agentSystemInstruction.replace('{{CHARACTER_SETTING}}', params.character.setting);

        // Volatile per-turn blocks — appended to the trailing user content, never
        // baked into the cached systemInstruction.
        const tailBlocks: string[] = [];
        if (keywordWorldInfo && keywordWorldInfo.trim()) {
            tailBlocks.push(keywordWorldInfo.trim());
        }
        if (
            resolveOutputType(agent) === 'narrative'
            && (
                params.storyBible
                || params.previousWorldSnapshot
                || (params.scratchpad && params.scratchpad.length > 0)
                || params.trackedCharacters.length > 0
            )
        ) {
            // The bible is emitted as a leading systemInstruction block instead, so it
            // stays inside the cacheable prefix rather than the per-turn tail.
            const bibleText = null;
            const effectiveSnapshot = params.currentWorldSnapshot ?? params.previousWorldSnapshot;
            const snapText = effectiveSnapshot ? JSON.stringify(effectiveSnapshot, null, 2) : '(no snapshot yet)';
            const candidates = parentResults
                .filter(p => p.characterCandidate && p.characterCandidate.candidate)
                .map(p => `- ${p.characterCandidate!.characterId}: ${p.characterCandidate!.candidate}`)
                .join('\n') || '(no candidates this turn)';
            const positionStr = (params.turnNumber !== undefined || params.plotPhase)
                ? `turn=${params.turnNumber ?? '?'} · plotPhase=${params.plotPhase ?? '?'}`
                : undefined;
            const scratchpadStr = (params.scratchpad && params.scratchpad.length > 0)
                ? params.scratchpad
                    .filter(o => o.agentId !== agent.id && o.text && !o.text.startsWith('[ERROR'))
                    .map(o => `[${o.agentName}]\n${cleanModelOutputForPrompt(o.text)}`)
                    .join('\n\n')
                : undefined;
            const characterSheets = getCharacterContext(params.trackedCharacters) ?? undefined;
            tailBlocks.push(GM_CONTEXT_TEMPLATE(bibleText, snapText, candidates, positionStr, scratchpadStr, characterSheets));
        }

        let context = parentResults.length > 0
            ? `User action: "${params.playerChoice}"\n\nInputs from other agents:\n\n${parentResults.map(o => `[${o.agentName}]: ${cleanModelOutputForPrompt(o.text)}`).join('\n\n')}`
            : params.playerChoice;
        if (tailBlocks.length > 0) context += `\n\n${tailBlocks.join('\n\n')}`;

        // This path's role text already carries the character card via
        // SYSTEM_INSTRUCTION_PLACEHOLDER, and only narrative agents ever saw the
        // bible — the shared blocks reproduce exactly that.
        const gmSharedBlockOptions = {
            cardInRole: true,
            includeBible: resolveOutputType(agent) === 'narrative',
        };

        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const isFinal = agent.connections.length === 0;
        if (params.onFinalChunk && isFinal && resolveOutputType(agent) === 'narrative') {
            const stream = await ai.models.generateContentStream({
                model: modelName,
                contents: messages,
                config: providerGeminiConfig(params, agent, {
                    systemInstruction: agentSystemInstruction,
                }, gmSharedBlockOptions),
            });
            let full = '';
            for await (const chunk of stream) {
                if (params.signal?.aborted) break;
                const text = chunk.text;
                if (text) {
                    full += text;
                    params.onFinalChunk(text);
                }
            }
            return full;
        }

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction: agentSystemInstruction,
            }, gmSharedBlockOptions),
        });
        return res.text ?? '';
    },
    
    async runSubGraph(params, tempAgents, parentResults, depth) {
        return await executeHeavyMode({
           ...params,
           storyHistory: [],
           playerChoice: parentResults.map(r => cleanModelOutputForPrompt(r.text)).join('\n'),
           agentSettings: tempAgents,
           updateStatus: (status, data) => params.updateStatus(`  - Sub: ${status}`, data),
        }, geminiApiExecutor, depth);
    },

    async getUniverseDetection(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const systemInstruction = `${agent.systemInstruction}\n\n${UNIVERSE_DETECTION_SCHEMA_PROMPT}`;
        const context = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
            }),
        });
        const raw = tryParseJSON<any>(res.text);
        const detection: StoryBibleUniverse = {
            isKnown: !!raw?.is_known_universe,
            name: raw?.universe_name ?? undefined,
            originalStorylineHint: raw?.original_storyline_hint ?? undefined,
        };
        return { detection };
    },

    async getStoryBibleFragment(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const fieldName = agent.storyBibleField as keyof StoryBible | undefined;
        const schemaPrompt = pickStoryBibleSchemaPrompt(fieldName as string | undefined);
        const systemInstruction = `${agent.systemInstruction}\n\n${schemaPrompt}`;
        const parentContext = parentResults.length > 0
            ? `\n\nInputs from earlier agents:\n${parentResults.map(o => `[${o.agentName}]: ${cleanModelOutputForPrompt(o.text)}`).join('\n\n')}`
            : '';
        const context = `${buildWorldModelVisibleContextBlock(params, agent)}${parentContext}`;
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
            }),
        });
        const raw = tryParseJSON<any>(res.text);
        const resolvedField = (raw?.field as keyof StoryBible) || (fieldName as keyof StoryBible) || 'plot';
        return { field: resolvedField, value: raw?.value };
    },

    async getWorldSnapshotUpdate(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const systemInstruction = `${agent.systemInstruction}\n\n${WORLD_STATE_SCHEMA_PROMPT}`;
        const parentContext = parentResults.length > 0
            ? `\n\nInputs from earlier agents:\n${parentResults.map(o => `[${o.agentName}]: ${cleanModelOutputForPrompt(o.text)}`).join('\n\n')}`
            : '';
        const context = `${buildWorldModelVisibleContextBlock(params, agent)}${parentContext}`;
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
            }),
        });
        const raw = tryParseJSON<any>(res.text);
        const snap = raw?.worldSnapshot;
        let worldSnapshot: WorldSnapshot | undefined;
        if (snap && typeof snap === 'object') {
            worldSnapshot = {
                location: String(snap.location ?? params.previousWorldSnapshot?.location ?? 'unknown'),
                timeOfDay: String(snap.timeOfDay ?? params.previousWorldSnapshot?.timeOfDay ?? 'unspecified'),
                weather: String(snap.weather ?? params.previousWorldSnapshot?.weather ?? 'unspecified'),
                sceneSummary: String(snap.sceneSummary ?? params.previousWorldSnapshot?.sceneSummary ?? ''),
                charactersInScene: Array.isArray(snap.charactersInScene) ? snap.charactersInScene.map(String) : (params.previousWorldSnapshot?.charactersInScene ?? []),
                worldFacts: Array.isArray(snap.worldFacts) ? snap.worldFacts.map(String) : (params.previousWorldSnapshot?.worldFacts ?? []),
                updatedAt: Date.now(),
            };
        } else if (params.previousWorldSnapshot) {
            worldSnapshot = { ...params.previousWorldSnapshot, updatedAt: Date.now() };
        }
        return { analysis: String(raw?.analysis ?? ''), worldSnapshot };
    },

    async getInnerStateUpdate(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const targetId = agent.targetCharacterId ?? 'unknown';
        const rosterEntry = params.storyBible?.charactersRoster?.find(e => e.id === targetId);
        const name = rosterEntry?.name ?? targetId;
        const previousState = params.perCharacterStates?.[targetId];
        const systemInstruction = `${agent.systemInstruction}\n\n${INNER_STATE_SCHEMA_PROMPT(targetId, name)}`;
        const context = buildWorldModelVisibleContextBlock(params, agent, { perCharacterState: previousState ?? null });
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
            }),
        });
        const raw = tryParseJSON<any>(res.text);
        const state: PerCharacterState = {
            characterId: String(raw?.characterId ?? targetId),
            emotionalState: raw?.emotionalState ? String(raw.emotionalState) : undefined,
            beliefsAboutOthers: (raw?.beliefsAboutOthers && typeof raw.beliefsAboutOthers === 'object')
                ? Object.fromEntries(Object.entries(raw.beliefsAboutOthers).map(([k, v]) => [k, String(v)]))
                : undefined,
            hiddenAgenda: raw?.hiddenAgenda ? String(raw.hiddenAgenda) : undefined,
            currentPriority: raw?.currentPriority ? String(raw.currentPriority) : undefined,
            updatedAt: Date.now(),
        };
        return { state };
    },

    async getDriftDirective(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const systemInstruction = `${agent.systemInstruction}\n\n${DRIFT_DIRECTIVE_SCHEMA_PROMPT}`;
        const context = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
            }),
        });
        const raw = tryParseJSON<any>(res.text);
        return {
            driftDetected: !!raw?.driftDetected,
            driftType: raw?.driftType ? String(raw.driftType) : undefined,
            directive: String(raw?.directive ?? ''),
        };
    },

    async getPostCheck(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const systemInstruction = `${agent.systemInstruction}\n\n${POST_CHECK_SCHEMA_PROMPT}`;
        const context = buildWorldModelVisibleContextBlock(params, agent, { previousResponse: params.previousResponse });
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
            }),
        });
        const raw = tryParseJSON<any>(res.text);
        return {
            needsRegen: !!raw?.needsRegen,
            reason: raw?.reason ? String(raw.reason) : undefined,
            correction: raw?.correction ? String(raw.correction) : undefined,
        };
    },

    async getTurnRouting(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const systemInstruction = `${agent.systemInstruction}\n\n${TURN_ROUTER_SCHEMA_PROMPT}`;
        const context = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
            }),
        });
        const raw = tryParseJSON<any>(res.text);
        const routing: TurnRoutingDecision = {
            skipPhases: Array.isArray(raw?.skipPhases) ? raw.skipPhases.filter((p: any) => p !== 'synthesis') : [],
            skipAgentIds: Array.isArray(raw?.skipAgentIds) ? raw.skipAgentIds.map(String) : [],
            reason: typeof raw?.reason === 'string' ? raw.reason : undefined,
        };
        return { routing };
    },

    async getCharacterCandidate(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const targetId = agent.targetCharacterId ?? 'unknown';
        const rosterEntry = params.storyBible?.charactersRoster?.find(e => e.id === targetId);
        const name = rosterEntry?.name ?? targetId;
        const schemaPrompt = CHARACTER_CANDIDATE_SCHEMA_PROMPT(targetId, name);
        const systemInstruction = `${agent.systemInstruction}\n\n${schemaPrompt}`;
        const context = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
            }),
        });
        const raw = tryParseJSON<any>(res.text);
        return {
            characterId: String(raw?.characterId ?? targetId),
            candidate: String(raw?.candidate ?? ''),
        };
    },

    async getPlotProgress(params, agent, parentResults) {
        const ai = providerGeminiClient(params, agent.name);
        const systemInstruction = `${agent.systemInstruction}\n\n${PLOT_TRACKER_SCHEMA_PROMPT}`;
        const context = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, context);
        const modelName = getModelName(agent.model);

        const res = await ai.models.generateContent({
            model: modelName,
            contents: messages,
            config: providerGeminiConfig(params, agent, {
                systemInstruction,
                responseMimeType: "application/json",
            }),
        });
        const raw = tryParseJSON<any>(res.text);
        return { plotProgress: normalizePlotProgress(raw?.plotProgress, params.previousWorldSnapshot?.plotProgress) };
    },
};

export const getGameTurnHeavyMode = async (
  params: HeavyModeParams
): Promise<ExecuteResult> => {
    return executeHeavyMode(params, geminiApiExecutor);
};
