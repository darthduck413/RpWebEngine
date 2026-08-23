
import { StoryTurn, AgentSettings, AgentResponse, Character, TrackedCharacter, ProxySettings, CharacterUpdate, WorldSnapshot, StoryBible, StoryBibleUniverse } from '../../types';
import { SYSTEM_INSTRUCTION_PLACEHOLDER } from "../../presets";
import {
    buildSystemInstruction, AGENT_SETTINGS_SCHEMA_PROMPT, CHARACTER_UPDATE_SCHEMA_PROMPT, buildHistoryTurns,
    UNIVERSE_DETECTION_SCHEMA_PROMPT, STORY_BIBLE_PLOT_SCHEMA_PROMPT, STORY_BIBLE_LORE_SCHEMA_PROMPT,
    STORY_BIBLE_ROSTER_SCHEMA_PROMPT, STORY_BIBLE_LOCATIONS_SCHEMA_PROMPT,
    WORLD_STATE_SCHEMA_PROMPT, CHARACTER_CANDIDATE_SCHEMA_PROMPT, GM_CONTEXT_TEMPLATE, TURN_ROUTER_SCHEMA_PROMPT,
    INNER_STATE_SCHEMA_PROMPT, DRIFT_DIRECTIVE_SCHEMA_PROMPT, POST_CHECK_SCHEMA_PROMPT, PLOT_TRACKER_SCHEMA_PROMPT,
    buildWorldModelAgentContext, getCharacterContext
} from '../common/prompts';
import { PerCharacterState } from '../../types';
import { AgentApiExecutor, AgentOutput, executeHeavyMode, HeavyModeParams, ExecuteResult, resolveOutputType, TurnRoutingDecision, normalizePlotProgress } from "../common/gameplay";
import { callProxy, parseProxyExtraParams } from './client';
import { buildProxyMessages, prepareWireMessages, ProxyMessage, buildBlockSystemMessage, isCacheCapableModel } from './prompts';
import { isExplicitCachingActive } from '../common/cache';
import {
    buildWorldModelBlocks,
    resolveAgentHistoryWindow as resolveWorldModelHistoryWindow,
} from '../common/worldModelPrompt';
import { buildAgentContext } from '../common/prompts';
import { normalizeTextPart, stripThinkTags } from '../common/thinking';
import { stripInlineImages } from '../common/inlineImages';
import { cleanModelOutputForPrompt } from '../common/promptText';
import { composeWorldInfo } from '../common/worldInfo';
import { fetchChatCompletion, formatUpstreamError, wantsUsageAccounting, wantsStreamUsageOptions, openRouterSessionFields } from './proxyHelper';
import { usageTracker, normalizeOpenAiUsage, proxyUsageCacheKey } from '../common/usage';

/**
 * Explicit prompt caching only actually happens for Anthropic models with the
 * toggle on; several World Model decisions (unified history windows) are only
 * worth their extra tokens in that case.
 */
const isCachingActive = (params: HeavyModeParams, agent: AgentSettings): boolean =>
    !!params.providerSettings?.enableAnthropicCaching
    && isCacheCapableModel(agent.model || params.providerSettings?.model || '');

const resolveAgentHistoryWindow = (params: HeavyModeParams, agent: AgentSettings): number =>
    resolveWorldModelHistoryWindow(
        agent,
        params.agentSettings,
        params.historyContextTurns,
        isCachingActive(params, agent)
    );

const extractProxyChoiceText = (choice: any): { content: string; reasoning: string } => {
    const delta = choice?.delta ?? {};
    return {
        content: normalizeTextPart(delta.content ?? delta.text ?? choice?.text),
        reasoning: normalizeTextPart(
            delta.reasoning_content
            ?? delta.reasoning
            ?? delta.reasoning_details
            ?? choice?.reasoning_content
            ?? choice?.reasoning
        ),
    };
};

export async function* getGameTurnStream(
    storyHistory: StoryTurn[],
    playerNotes: string,
    character: Character,
    historyContextTurns: number,
    includeAllAgentResponsesInContext: boolean,
    trackedCharacters: TrackedCharacter[] | undefined,
    proxySettings: ProxySettings,
    logContext?: (data: any) => void,
    signal?: AbortSignal,
    avatarContext?: { userAvatar?: string | null, charAvatar?: string | null },
    ignoreImages?: boolean,
    manualScenarios?: string,
    postHistoryInstruction?: string,
    cacheSessionId?: string
): AsyncGenerator<string, void, undefined> {
    // World Info split across cache regions: static always-on lore stays in the
    // (cached) system instruction; per-character keyword profiles go to the volatile
    // tail (buildProxyMessages) so they never invalidate the cached system prefix.
    const worldInfoAlreadyComposed = [character.personality, character.setting, character.scenario ?? ''];
    const alwaysWorldInfo = composeWorldInfo(character.loreBook, storyHistory, undefined, worldInfoAlreadyComposed, undefined, 'always');
    const keywordWorldInfo = composeWorldInfo(character.loreBook, storyHistory, undefined, worldInfoAlreadyComposed, undefined, 'keyword');

    // Notes never go in here. There is no placement worth honouring: up in the
    // system instruction a single edit invalidates the card and the whole history
    // behind it, so the tail is the only position that does not cost a re-read.
    // A {{PLAYER_NOTES}} placeholder anywhere resolves to nothing.
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

    const agentContext = buildAgentContext(storyHistory, historyContextTurns, { includeAllAgentResponses: includeAllAgentResponsesInContext }) ?? undefined;

    const messages = buildProxyMessages(
        storyHistory, 
        historyContextTurns, 
        character.name, 
        character.playerName, 
        finalSystemInstruction, 
        trackedCharacters, 
        agentContext,
        {
            userAvatarUrl: avatarContext?.userAvatar,
            charAvatarUrl: avatarContext?.charAvatar,
            charName: character.name,
            userName: character.playerName,
            ignoreImages,
            keywordWorldInfo,
            manualScenarios,
            playerNotes,
            includeThinkingInHistory: proxySettings.includeThinkingInHistory === true,
            postHistoryInstruction,
            // Explicit breakpoints are knowable up front; implicit caching is not —
            // so fall back to what the telemetry has actually seen this session
            // rather than assuming. Costs one narrow-window turn before it adapts.
            cachingActive: isExplicitCachingActive(proxySettings)
                || usageTracker.hasObservedCacheHits(
                    proxyUsageCacheKey(proxySettings.proxyUrl, proxySettings.model)
                ),
        }
    );

    if (messages.length === 1 && messages[0].role === 'system') {
        messages.push({ role: 'user', content: 'Continue the story.' });
    }

    const extraParams = parseProxyExtraParams(proxySettings.extraParams);
    // OpenRouter returns usage (incl. cache read/write token details) in the
    // final stream chunk when asked — used to verify prompt cache hits.
    const isOpenRouter = proxySettings.proxyUrl.includes('openrouter.ai');

    if (logContext) {
        logContext({
            type: 'proxy-stream',
            model: proxySettings.model,
            config: extraParams,
            messages: messages
        });
    }

    try {
        const response = await fetchChatCompletion(proxySettings.proxyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${proxySettings.apiKey}`,
            },
            body: JSON.stringify({
                model: proxySettings.model,
                messages: prepareWireMessages(messages, proxySettings.model, proxySettings.enableAnthropicCaching),
                stream: true,
                ...(wantsStreamUsageOptions(proxySettings.proxyUrl) ? { stream_options: { include_usage: true } } : {}),
                ...(isOpenRouter ? { usage: { include: true } } : {}),
                ...openRouterSessionFields(proxySettings.proxyUrl, cacheSessionId),
                ...extraParams
            }),
            signal
        });

        if (!response.ok) {
            throw new Error(formatUpstreamError(response.status, response.statusText, await response.text()));
        }

        if (!response.body) {
            throw new Error("Response body is null");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let isThinking = false;
        let hasContent = false;
        let hasReasoning = false;
        let streamUsage: any = null;

        while (true) {
            if (signal?.aborted) {
                reader.cancel();
                break;
            }
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                
                let jsonStr = trimmed;
                if (trimmed.startsWith('data:')) {
                    jsonStr = trimmed.slice(5).trim();
                }
                
                if (!jsonStr || jsonStr === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(jsonStr);
                    if (parsed.usage) {
                        streamUsage = parsed.usage;
                    }
                    const choice = parsed.choices?.[0] ?? {};
                    const { content, reasoning } = extractProxyChoiceText(choice);

                    if (reasoning) {
                        hasReasoning = true;
                        if (!isThinking) {
                            yield '<think>\n';
                            isThinking = true;
                        }
                        yield reasoning;
                    }

                    if (isThinking && content) {
                        yield '\n</think>\n\n';
                        isThinking = false;
                    }
                    
                    if (content) {
                        hasContent = true;
                        yield content;
                    }
                } catch (e) {
                    // Ignore
                }
            }
        }

        if (isThinking) {
            yield '\n</think>';
        }

        const normalizedUsage = normalizeOpenAiUsage(streamUsage);
        usageTracker.record(
            'light-stream',
            proxySettings.model,
            normalizedUsage,
            proxyUsageCacheKey(proxySettings.proxyUrl, proxySettings.model)
        );
        if (normalizedUsage) {
            logContext?.({
                type: 'proxy-usage',
                model: proxySettings.model,
                usage: streamUsage,
                cachedTokens: normalizedUsage.cacheReadTokens,
                cacheWriteTokens: normalizedUsage.cacheWriteTokens,
                uncachedTokens: normalizedUsage.uncachedTokens,
            });
        }

        if (!hasContent && !signal?.aborted) {
            throw new Error(hasReasoning
                ? 'Provider returned reasoning but no story text. Use Retry or Regenerate manually.'
                : 'Provider returned an empty response. Use Retry or Regenerate manually.');
        }

    } catch (error) {
        if (error instanceof Error) {
            if (error.name === 'AbortError') throw error;
            console.error("Error in Proxy stream:", error);
            // The message is already specific (formatUpstreamError / network message);
            // rethrow as-is instead of burying it under a generic wrapper.
            throw error;
        }
        console.error("Error in Proxy stream:", error);
        throw new Error('Unknown error while contacting the proxy.');
    }
}

export const buildAgentMessages = (
    params: HeavyModeParams,
    agent: AgentSettings,
    parentResults: AgentOutput[],
    systemInstruction: string,
    additionalUserContext?: string,
    sharedBlockOptions: { cardInRole?: boolean; includeBible?: boolean } = {}
): ProxyMessage[] => {
    const { storyHistory, character, agentSettings, trackedCharacters, historyContextTurns, includeAllAgentResponsesInContext, keepNonExistentAgentResponses, ignoreImages } = params;
    const historyBeforePlayerChoice = storyHistory.slice(0, -1);
    const isFinalAgent = agent.connections.length === 0;
    const finalAgentNames = agentSettings.filter(a => a.connections.length === 0).map(a => a.name);
    const allCurrentAgentNames = agentSettings.map(a => a.name);
    const historyWindow = resolveAgentHistoryWindow(params, agent);
    const showNotes = agent.instructionVisibility?.playerNotes ?? true;

    const agentHistoryContext = buildAgentContext(historyBeforePlayerChoice, historyWindow, {
        includeAllAgentResponses: includeAllAgentResponsesInContext,
        finalAgentNames: finalAgentNames,
        agentForContext: isFinalAgent ? undefined : agent.name,
        keepNonExistentAgentResponses: keepNonExistentAgentResponses,
        allCurrentAgentNames: allCurrentAgentNames
    });

    const parentContext = parentResults.length > 0
        ? `Based on the following input from previous agents, perform your analysis:\n\n${parentResults.map(o => `--- Input from ${o.agentName} ---\n${cleanModelOutputForPrompt(o.text)}`).join('\n\n')}`
        : `Perform your analysis based on the conversation context and the last user action: "${params.playerChoice}"`;

    const playerNotesContext = showNotes && params.playerNotes.trim()
        ? `<Notes>\n${params.playerNotes.trim()}\n</Notes>`
        : '';
    let fullContext = [playerNotesContext, agentHistoryContext, parentContext]
        .filter(Boolean)
        .join('\n\n');
    if (additionalUserContext) {
        fullContext += `\n\n${additionalUserContext}`;
    }

    // Stable shared background (card and bible) leads the system message so every
    // agent that sees the same material shares one cached prefix; volatile player
    // notes stay after history, while the agent's unique role remains uncached.
    const systemMessage = buildBlockSystemMessage(buildWorldModelBlocks({
        character,
        storyBible: sharedBlockOptions.includeBible === false ? null : params.storyBible,
        roleInstruction: systemInstruction,
        agent,
        cardInRole: sharedBlockOptions.cardInRole,
    }));

    const messages = buildProxyMessages(
        historyBeforePlayerChoice,
        historyWindow,
        character.name,
        character.playerName,
        systemMessage,
        trackedCharacters,
        fullContext,
        {
            ignoreImages,
            cachingActive: isCachingActive(params, agent),
            includeCharacterSheets: false,
        }
    );

    return messages;
}

const buildWorldModelContextBlock = (params: HeavyModeParams): string | undefined => {
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
    return blocks.length > 0 ? blocks.join('\n\n') : undefined;
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
    // Card + bible now ride the cached system blocks built in buildAgentMessages.
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

// Streaming variant of callProxy used only for the final synthesis agent in World Model.
// Forwards each text chunk to params.onFinalChunk and returns the full accumulated text.
const callProxyStreamingForFinalGM = async (
    settings: ProxySettings,
    model: string,
    messages: ProxyMessage[],
    _systemInstructionForLog: string,
    params: HeavyModeParams,
): Promise<string> => {
    const extraParams = parseProxyExtraParams(settings.extraParams);

    const response = await fetchChatCompletion(settings.proxyUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: prepareWireMessages(messages, model, settings.enableAnthropicCaching),
            stream: true,
            ...(wantsStreamUsageOptions(settings.proxyUrl) ? { stream_options: { include_usage: true } } : {}),
            ...(wantsUsageAccounting(settings.proxyUrl) ? { usage: { include: true } } : {}),
            ...openRouterSessionFields(settings.proxyUrl, params.cacheSessionId),
            ...extraParams,
        }),
        signal: params.signal,
    });

    if (!response.ok) {
        throw new Error(formatUpstreamError(response.status, response.statusText, await response.text()));
    }
    if (!response.body) throw new Error('Response body is null');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let isThinking = false;
    let full = '';
    let hasContent = false;
    let hasReasoning = false;
    let streamUsage: any = null;

    const emit = (chunk: string) => {
        full += chunk;
        params.onFinalChunk?.(chunk);
    };

    while (true) {
        if (params.signal?.aborted) {
            reader.cancel();
            break;
        }
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            let jsonStr = trimmed;
            if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.usage) streamUsage = parsed.usage;
                const choice = parsed.choices?.[0] ?? {};
                const { content, reasoning } = extractProxyChoiceText(choice);

                if (reasoning) {
                    hasReasoning = true;
                    if (!isThinking) {
                        emit('<think>\n');
                        isThinking = true;
                    }
                    emit(reasoning);
                }
                if (isThinking && content) {
                    emit('\n</think>\n\n');
                    isThinking = false;
                }
                if (content) emit(content);
                if (content) hasContent = true;
            } catch {
                // skip malformed chunk
            }
        }
    }
    if (isThinking) emit('\n</think>');
    usageTracker.record(
        'wm:final-stream',
        model,
        normalizeOpenAiUsage(streamUsage),
        proxyUsageCacheKey(settings.proxyUrl, model)
    );
    if (!hasContent && !params.signal?.aborted) {
        throw new Error(hasReasoning
            ? 'Provider returned reasoning but no story text. Use Retry or Regenerate manually.'
            : 'Provider returned an empty response. Use Retry or Regenerate manually.');
    }
    return full;
};

const generateAgentSummary = async (
    params: HeavyModeParams,
    agent: AgentSettings
): Promise<string> => {
    const historyLimit = agent.summaryContextLimit || 0;
    const summaryModel = agent.summaryModel || agent.model;
    const summaryPrompt = agent.summaryPrompt || "Summarize the story so far, focusing on key events, character relationships, and the current immediate situation. Keep it concise.";

    const historyTurns = buildHistoryTurns(
        params.storyHistory.slice(0, -1),
        historyLimit,
        params.character.name,
        params.character.playerName
    );

    const messages: ProxyMessage[] = [
        { role: 'system', content: summaryPrompt },
        ...historyTurns.map((turn): ProxyMessage => ({
            role: turn.role === 'model' ? 'assistant' : 'user',
            content: turn.content
        }))
    ];

    const effectiveSettings = {
        ...params.providerSettings,
        extraParams: ''
    };

    params.logContext({
        type: 'proxy-heavy-summarizer',
        agent: `${agent.name} (Summarizer)`,
        model: summaryModel,
        messages
    });

    return await callProxy(effectiveSettings, summaryModel, messages, false, params.signal, `wm:${agent.name} (summary)`, params.cacheSessionId);
};

export const proxyApiExecutor: AgentApiExecutor = {
    async getCharacterUpdate(params, agent, parentResults) {
        const systemInstruction = `${agent.systemInstruction}\n${CHARACTER_UPDATE_SCHEMA_PROMPT}`;
        const messages = buildAgentMessages(
            params,
            agent,
            parentResults,
            systemInstruction,
            getCharacterContext(params.trackedCharacters) ?? undefined
        );
        
        params.logContext({
            type: 'proxy-heavy-character-update',
            agent: agent.name,
            model: agent.model,
            messages
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams
        };

        const response = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
        
        if (response && response.characterUpdates && !Array.isArray(response.characterUpdates)) {
            console.warn("Proxy returned invalid characterUpdates format, treating as empty.");
            response.characterUpdates = [];
        }
        
        return response as { analysis: string; characterUpdates?: CharacterUpdate[] };
    },

    async getSkipDecision(params, agent, parentResults) {
        const skipPrompt = "Your response MUST be a JSON object with a 'skip' property (boolean). Example: {\"skip\": true}";
        const systemInstruction = `${agent.systemInstruction}\n${skipPrompt}`;
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction);
        
        params.logContext({
            type: 'proxy-heavy-skip-decision',
            agent: agent.name,
            model: agent.model,
            messages
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams
        };

        return await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
    },

    async getSwitchDecision(params, agent, parentResults) {
        const connectedAgents = params.agentSettings.filter(a => agent.connections.includes(a.id));
        const optionsText = "Choose one of the following agents to proceed by returning its ID in the `chosenAgentId` field.\n\n" + connectedAgents.map(c => `ID: "${c.id}"\nName: "${c.name}"\nInstruction: ${c.systemInstruction}`).join('\n---\n');
        const switchPrompt = `Your response MUST be a valid JSON object with a 'chosenAgentId' property. Example: {"chosenAgentId": "${connectedAgents[0]?.id || 'agent-id-example'}"}`;
        
        const systemInstruction = `${agent.systemInstruction}\n${switchPrompt}`;
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, optionsText);

        params.logContext({
            type: 'proxy-heavy-switch-decision',
            agent: agent.name,
            model: agent.model,
            messages
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams
        };

        return await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
    },

    async getSpyPreset(params, agent, parentResults) {
        const subGraphPrompt = `Based on the situation, generate a temporary list of agents to execute. The first agents in your list will receive this context:\n\n${parentResults.map(o => `--- Input from ${o.agentName} ---\n${cleanModelOutputForPrompt(o.text)}`).join('\n\n')}\n\nThe final agent(s) in your list must connect to the agents this Spy agent was connected to.`;
        const systemInstruction = `${agent.systemInstruction}\n${AGENT_SETTINGS_SCHEMA_PROMPT}`;
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, subGraphPrompt);
        
        params.logContext({
            type: 'proxy-heavy-spy-preset',
            agent: agent.name,
            model: agent.model,
            messages
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams
        };

        return await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
    },
    
    async getSpyMorph(params, agent, parentResults) {
        const morphPrompt = "Your response MUST be a JSON object with a single property 'newSystemInstruction' (string). Example: {\"newSystemInstruction\": \"You are now a cheerful narrator...\"}";
        const systemInstruction = `${agent.systemInstruction}\n${morphPrompt}`;
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction);
        
        params.logContext({
            type: 'proxy-heavy-spy-morph',
            agent: agent.name,
            model: agent.model,
            messages
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams
        };

        return await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
    },

    async getSpyMorphWithSkip(params, agent, parentResults) {
        const skipPrompt = "Your response MUST be a JSON object with a 'skip' property (boolean) and an optional 'newSystemInstruction' (string). Example: {\"skip\": true} or {\"skip\": false, \"newSystemInstruction\": \"...\"}";
        const systemInstruction = `${agent.systemInstruction}\n${skipPrompt}`;
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction);
        
        params.logContext({
            type: 'proxy-heavy-spy-morph-skip',
            agent: agent.name,
            model: agent.model,
            messages
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams
        };

        return await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
    },
    
    async getDefaultResponse(params, agent, parentResults) {
        const visibility = agent.instructionVisibility;
        const showNotes = visibility ? visibility.playerNotes : true;
        const showSetting = visibility ? visibility.setting : true;
        const showPersonality = visibility ? visibility.personality : true;
        const showDescription = visibility ? visibility.playerDescription : true;

        // Cache parity with light mode: ONLY the static character card + always-on
        // lore live in the (cached) system prefix. Keyword-triggered lore and all
        // per-turn World Model context (snapshot, candidates, position, scratchpad)
        // moves to the volatile tail, so the GM's prompt prefix
        // stays byte-identical across turns and the provider's prompt cache hits.
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

        // Volatile per-turn blocks — appended to the tail (after the cache
        // breakpoints), never baked into the cached system prefix.
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
            // The bible is emitted as a cached system block below, not here.
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
        const tailContext = tailBlocks.length > 0 ? tailBlocks.join('\n\n') : undefined;

        let messages: ProxyMessage[] = [];

        // This path serves the GM and any other default agent. Both historically get
        // the character card only by substituting SYSTEM_INSTRUCTION_PLACEHOLDER into
        // their own role text, and the bible only when they produce narrative — so the
        // shared blocks reproduce exactly that, no more.
        const sharedBlockOptions = {
            cardInRole: true,
            includeBible: resolveOutputType(agent) === 'narrative',
        };

        if (agent.useSummary) {
            params.updateStatus(`Generating summary for ${agent.name}...`);
            const summaryText = await generateAgentSummary(params, agent);

            messages = [buildBlockSystemMessage(buildWorldModelBlocks({
                character: params.character,
                storyBible: sharedBlockOptions.includeBible ? params.storyBible : null,
                roleInstruction: agentSystemInstruction,
                agent,
                cardInRole: true,
            }))];
            messages.push({ role: 'user', content: `Here is a summary of the story so far:\n\n${summaryText}` });

            const historyBeforeUser = params.storyHistory.slice(0, -1);
            const lastAiTurn = [...historyBeforeUser].reverse().find(t => !t.isPlayer);
            if (lastAiTurn) {
                // Same treatment every other history path gives a turn: resolve the
                // placeholders, drop the UI-only <think> block and the display-only
                // inline images. Sending `.text` raw leaked all three.
                messages.push({
                    role: 'assistant',
                    content: stripInlineImages(stripThinkTags(
                        (lastAiTurn.text ?? '')
                            .replace(/{{user}}/g, params.character.playerName)
                            .replace(/{{char}}/g, params.character.name)
                    )),
                });
            }

            let contextInput = parentResults.length > 0
                ? `The user's action was: "${params.playerChoice}".\n\nBased on your specific role, analyze the following inputs from other agents and then perform your task:\n\n${parentResults.map(o => `--- ${o.agentName}'s Analysis ---\n${cleanModelOutputForPrompt(o.text)}`).join('\n\n')}`
                : params.playerChoice;
            if (showNotes && params.playerNotes.trim()) {
                contextInput = `<Notes>\n${params.playerNotes.trim()}\n</Notes>\n\n${contextInput}`;
            }
            if (tailContext) contextInput += `\n\n${tailContext}`;

            messages.push({ role: 'user', content: contextInput });

        } else {
            messages = buildAgentMessages(params, agent, parentResults, agentSystemInstruction, tailContext, sharedBlockOptions);
        }
        
        params.logContext({
            type: 'proxy-heavy-default',
            agent: agent.name,
            model: agent.model,
            messages
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams
        };

        // Streaming path — only for the final narrative agent when caller wired a chunk handler.
        const isFinal = agent.connections.length === 0;
        if (params.onFinalChunk && isFinal && resolveOutputType(agent) === 'narrative') {
            return await callProxyStreamingForFinalGM(
                effectiveSettings,
                agent.model,
                messages,
                agentSystemInstruction,
                params,
            );
        }

        return await callProxy(effectiveSettings, agent.model, messages, false, params.signal, `wm:${agent.name}`, params.cacheSessionId);
    },
    
    async runSubGraph(params, tempAgents, parentResults, depth) {
         return await getGameTurnHeavyMode({
           ...params,
           storyHistory: [],
           playerChoice: parentResults.map(r => cleanModelOutputForPrompt(r.text)).join('\n'),
           agentSettings: tempAgents,
           updateStatus: (status, data) => params.updateStatus(`  - Sub-agent: ${status}`, data),
        }, depth);
    },

    async getUniverseDetection(params, agent, parentResults) {
        const systemInstruction = `${agent.systemInstruction}\n\n${UNIVERSE_DETECTION_SCHEMA_PROMPT}`;
        const additional = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, additional);

        params.logContext({
            type: 'proxy-heavy-universe-detection',
            agent: agent.name,
            model: agent.model,
            messages,
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams,
        };

        const raw = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
        const detection: StoryBibleUniverse = {
            isKnown: !!raw?.is_known_universe,
            name: raw?.universe_name ?? undefined,
            originalStorylineHint: raw?.original_storyline_hint ?? undefined,
        };
        return { detection };
    },

    async getStoryBibleFragment(params, agent, parentResults) {
        const fieldName = agent.storyBibleField as keyof StoryBible | undefined;
        const schemaPrompt = pickStoryBibleSchemaPrompt(fieldName as string | undefined);
        const systemInstruction = `${agent.systemInstruction}\n\n${schemaPrompt}`;
        const additional = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, additional);

        params.logContext({
            type: 'proxy-heavy-story-bible-fragment',
            agent: agent.name,
            model: agent.model,
            field: fieldName,
            messages,
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams,
        };

        const raw = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
        const resolvedField = (raw?.field as keyof StoryBible) || (fieldName as keyof StoryBible) || 'plot';
        return { field: resolvedField, value: raw?.value };
    },

    async getWorldSnapshotUpdate(params, agent, parentResults) {
        const systemInstruction = `${agent.systemInstruction}\n\n${WORLD_STATE_SCHEMA_PROMPT}`;
        const additional = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, additional);

        params.logContext({
            type: 'proxy-heavy-world-snapshot',
            agent: agent.name,
            model: agent.model,
            messages,
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams,
        };

        const raw = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
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
            // Fallback to the previous snapshot on parse failure — never crash the graph.
            worldSnapshot = { ...params.previousWorldSnapshot, updatedAt: Date.now() };
        }
        return { analysis: String(raw?.analysis ?? ''), worldSnapshot };
    },

    async getInnerStateUpdate(params, agent, parentResults) {
        const targetId = agent.targetCharacterId ?? 'unknown';
        const rosterEntry = params.storyBible?.charactersRoster?.find(e => e.id === targetId);
        const name = rosterEntry?.name ?? targetId;
        const previousState = params.perCharacterStates?.[targetId];
        const additional = buildWorldModelVisibleContextBlock(params, agent, { perCharacterState: previousState ?? null });
        const systemInstruction = `${agent.systemInstruction}\n\n${INNER_STATE_SCHEMA_PROMPT(targetId, name)}`;
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, additional);

        params.logContext({
            type: 'proxy-heavy-inner-state',
            agent: agent.name,
            model: agent.model,
            targetCharacterId: targetId,
            messages,
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams,
        };

        const raw = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
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
        const systemInstruction = `${agent.systemInstruction}\n\n${DRIFT_DIRECTIVE_SCHEMA_PROMPT}`;
        const additional = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, additional);

        params.logContext({
            type: 'proxy-heavy-drift-director',
            agent: agent.name,
            model: agent.model,
            messages,
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams,
        };

        const raw = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
        return {
            driftDetected: !!raw?.driftDetected,
            driftType: raw?.driftType ? String(raw.driftType) : undefined,
            directive: String(raw?.directive ?? ''),
        };
    },

    async getPostCheck(params, agent, parentResults) {
        const systemInstruction = `${agent.systemInstruction}\n\n${POST_CHECK_SCHEMA_PROMPT}`;
        const additional = buildWorldModelVisibleContextBlock(params, agent, { previousResponse: params.previousResponse });
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, additional || undefined);

        params.logContext({
            type: 'proxy-heavy-post-check',
            agent: agent.name,
            model: agent.model,
            messages,
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams,
        };

        const raw = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
        return {
            needsRegen: !!raw?.needsRegen,
            reason: raw?.reason ? String(raw.reason) : undefined,
            correction: raw?.correction ? String(raw.correction) : undefined,
        };
    },

    async getTurnRouting(params, agent, parentResults) {
        const systemInstruction = `${agent.systemInstruction}\n\n${TURN_ROUTER_SCHEMA_PROMPT}`;
        const additional = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, additional);

        params.logContext({
            type: 'proxy-heavy-turn-router',
            agent: agent.name,
            model: agent.model,
            messages,
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams,
        };

        const raw = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
        const routing: TurnRoutingDecision = {
            skipPhases: Array.isArray(raw?.skipPhases) ? raw.skipPhases.filter((p: any) => p !== 'synthesis') : [],
            skipAgentIds: Array.isArray(raw?.skipAgentIds) ? raw.skipAgentIds.map(String) : [],
            reason: typeof raw?.reason === 'string' ? raw.reason : undefined,
        };
        return { routing };
    },

    async getCharacterCandidate(params, agent, parentResults) {
        const targetId = agent.targetCharacterId ?? 'unknown';
        const rosterEntry = params.storyBible?.charactersRoster?.find(e => e.id === targetId);
        const name = rosterEntry?.name ?? targetId;
        const schemaPrompt = CHARACTER_CANDIDATE_SCHEMA_PROMPT(targetId, name);
        const systemInstruction = `${agent.systemInstruction}\n\n${schemaPrompt}`;
        const additional = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, additional);

        params.logContext({
            type: 'proxy-heavy-character-candidate',
            agent: agent.name,
            model: agent.model,
            targetCharacterId: targetId,
            messages,
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams,
        };

        const raw = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
        return {
            characterId: String(raw?.characterId ?? targetId),
            candidate: String(raw?.candidate ?? ''),
        };
    },

    async getPlotProgress(params, agent, parentResults) {
        const systemInstruction = `${agent.systemInstruction}\n\n${PLOT_TRACKER_SCHEMA_PROMPT}`;
        const additional = buildWorldModelVisibleContextBlock(params, agent);
        const messages = buildAgentMessages(params, agent, parentResults, systemInstruction, additional);

        params.logContext({
            type: 'proxy-heavy-plot-tracker',
            agent: agent.name,
            model: agent.model,
            messages,
        });

        const effectiveSettings = {
            ...params.providerSettings,
            extraParams: agent.proxyParams || params.providerSettings.extraParams,
        };

        const raw = await callProxy(effectiveSettings, agent.model, messages, true, params.signal, `wm:${agent.name}`, params.cacheSessionId);
        return { plotProgress: normalizePlotProgress(raw?.plotProgress, params.previousWorldSnapshot?.plotProgress) };
    },
};


export const getGameTurnHeavyMode = async (
  params: HeavyModeParams,
  depth: number = 0
): Promise<ExecuteResult> => {
    return executeHeavyMode(params, proxyApiExecutor, depth);
};
