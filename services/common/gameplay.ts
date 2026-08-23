
import {
    AgentSettings, AgentResponse, Character, TrackedCharacter, StoryTurn, CharacterUpdate,
    AgentPhase, AgentOutputType, WorldSnapshot, StoryBible, StoryBibleUniverse, PerCharacterState, PlotPhase, PlotProgress
} from '../../types';
import { isExplicitCachingActive } from './cache';
import { stripThinkTags } from './thinking';

export interface HeavyModeParams {
  storyHistory: StoryTurn[];
  playerNotes: string;
  character: Character;
  historyContextTurns: number;
  playerChoice: string;
  agentSettings: AgentSettings[];
  updateStatus: (status: string, data?: any) => void;
  logContext: (data: any) => void;
  includeAllAgentResponsesInContext?: boolean;
  keepNonExistentAgentResponses?: boolean;
  trackedCharacters: TrackedCharacter[];
  providerSettings: any;
  /** Stable per-chat key for provider sticky routing (currently OpenRouter). */
  cacheSessionId?: string;
  signal?: AbortSignal;
  ignoreImages?: boolean;
  // World Model additions
  previousWorldSnapshot?: WorldSnapshot | null;
  currentWorldSnapshot?: WorldSnapshot | null;
  storyBible?: StoryBible | null;
  perCharacterStates?: Record<string, PerCharacterState>;
  agentCache?: AgentResultCache;
  phasesToRun?: AgentPhase[]; // when set, only agents whose phase is in this list run
  // Position encoding — gives every agent a sense of "where we are" in the arc
  turnNumber?: number;
  plotPhase?: PlotPhase;
  // Residual scratchpad — accumulated outputs from all agents that ran earlier in this turn,
  // available to downstream agents (in particular the synthesis layer) so they aren't limited
  // to their direct parent chain. Filled in by executeHeavyMode between orders; do not pass in.
  scratchpad?: AgentOutput[];
  // Streaming callback - when set and the agent is the final narrative output, provider
  // executors must stream chunks through this callback and still return the full accumulated
  // text. Setup / curator / candidate agents ignore this (JSON-mode, no streaming).
  onFinalChunk?: (chunk: string) => void;
  // The just-generated narrative — passed to post-output checkers so they can audit it.
  previousResponse?: string;
}

// Heuristic plot phase derived from turn count. The Plotter writes the arc up-front,
// but without a hard-coded "expected total turns" we can't know where we are. The
// breakpoints below are conservative defaults for typical RP sessions (~20-30 turns).
// Curator or a future PlotTracker agent can override by writing into bible/snapshot later.
export const inferPlotPhase = (turnNumber: number): PlotPhase => {
    if (turnNumber <= 3) return 'intro';
    if (turnNumber <= 12) return 'rising';
    if (turnNumber <= 20) return 'climax';
    if (turnNumber <= 28) return 'falling';
    return 'epilogue';
};

export type AgentOutput = AgentResponse & {
    agentId: string,
    chosenAgentId?: string,
    passedThroughContext?: AgentOutput[],
    characterUpdates?: CharacterUpdate[],
    worldSnapshot?: WorldSnapshot,
    storyBibleFragment?: { field: keyof StoryBible; value: any },
    characterCandidate?: { characterId: string; candidate: string },
    universeDetection?: StoryBibleUniverse,
    turnRouting?: TurnRoutingDecision,
    perCharacterStateUpdate?: PerCharacterState,
    driftDirective?: { driftDetected: boolean; driftType?: string; directive: string },
    postCheck?: { needsRegen: boolean; reason?: string; correction?: string },
    plotProgress?: PlotProgress,
    /** Served from the in-app result cache — no provider call, so no prompt cache warmed. */
    fromResultCache?: boolean,
};
export interface AgentResultCache {
    get(key: string): AgentOutput | undefined;
    set(key: string, value: AgentOutput): void;
}

export const createAgentResultCache = (maxEntries: number = 200): AgentResultCache => {
    const entries = new Map<string, AgentOutput>();
    return {
        get(key) {
            const value = entries.get(key);
            if (!value) return undefined;
            entries.delete(key);
            entries.set(key, value);
            return JSON.parse(JSON.stringify(value)) as AgentOutput;
        },
        set(key, value) {
            if (entries.has(key)) entries.delete(key);
            entries.set(key, JSON.parse(JSON.stringify(value)) as AgentOutput);
            while (entries.size > maxEntries) {
                const oldest = entries.keys().next().value;
                if (oldest === undefined) break;
                entries.delete(oldest);
            }
        },
    };
};

const stableHash = (input: string): string => {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

const imageFingerprint = (image?: string): string | undefined => {
    if (!image) return undefined;
    return `${image.length}:${image.slice(0, 64)}:${image.slice(-64)}`;
};

const buildAgentCacheKey = (
    params: HeavyModeParams,
    agent: AgentSettings,
    parentResults: AgentOutput[],
    outputType: AgentOutputType
): string => {
    const providerSettings = params.providerSettings ?? {};
    const providerFingerprint = {
        model: providerSettings.model,
        extraParams: providerSettings.extraParams,
        proxyUrl: providerSettings.proxyUrl,
        apiKeyId: providerSettings.apiKeyId,
        customPrompt: providerSettings.customPrompt,
    };
    const payload = {
        agent: {
            id: agent.id,
            name: agent.name,
            model: agent.model,
            provider: agent.provider,
            outputType,
            systemInstruction: agent.systemInstruction,
            contextMessages: agent.contextMessages,
            instructionVisibility: agent.instructionVisibility,
            targetCharacterId: agent.targetCharacterId,
            storyBibleField: agent.storyBibleField,
        },
        provider: providerFingerprint,
        playerChoice: params.playerChoice,
        storyHistory: params.storyHistory.map(t => ({
            isPlayer: t.isPlayer,
            text: t.text,
            image: imageFingerprint(t.image),
            worldSnapshot: t.worldSnapshot,
        })),
        storyBible: params.storyBible,
        previousWorldSnapshot: params.previousWorldSnapshot,
        currentWorldSnapshot: params.currentWorldSnapshot,
        perCharacterState: agent.targetCharacterId ? params.perCharacterStates?.[agent.targetCharacterId] : undefined,
        trackedCharacters: outputType === 'characterUpdate' ? params.trackedCharacters : undefined,
        parentResults: parentResults.map(r => ({
            agentId: r.agentId,
            text: r.text,
            worldSnapshot: r.worldSnapshot,
            storyBibleFragment: r.storyBibleFragment,
            characterCandidate: r.characterCandidate,
            universeDetection: r.universeDetection,
            perCharacterStateUpdate: r.perCharacterStateUpdate,
            driftDirective: r.driftDirective,
            postCheck: r.postCheck,
        })),
        scratchpad: params.scratchpad?.map(r => ({ agentId: r.agentId, text: r.text })),
        previousResponse: params.previousResponse,
        turnNumber: params.turnNumber,
        plotPhase: params.plotPhase,
    };
    return stableHash(JSON.stringify(payload));
};

export interface TurnRoutingDecision {
    skipPhases: AgentPhase[];
    skipAgentIds: string[];
    reason?: string;
}

export const resolveOutputType = (agent: AgentSettings): AgentOutputType => {
    if (agent.outputType) return agent.outputType;
    if (agent.canUpdateCharacters) return 'characterUpdate' as AgentOutputType;
    return 'narrative';
};

/**
 * Robust JSON extraction from LLM responses.
 * Handles cases where the model includes text before or after the JSON block.
 */
export const tryParseJSON = <T>(text: string, fallback?: T): T | undefined => {
    try {
        // Find the first '{' or '[' and the last '}' or ']'
        const firstBrace = text.indexOf('{');
        const firstBracket = text.indexOf('[');
        const lastBrace = text.lastIndexOf('}');
        const lastBracket = text.lastIndexOf(']');

        let start = -1;
        let end = -1;

        if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
            start = firstBrace;
            end = lastBrace;
        } else if (firstBracket !== -1) {
            start = firstBracket;
            end = lastBracket;
        }

        if (start !== -1 && end !== -1 && end > start) {
            const cleanText = text.substring(start, end + 1);
            return JSON.parse(cleanText) as T;
        }
        
        return JSON.parse(text) as T;
    } catch (error) {
        console.warn("Resilient JSON parser failed. Text preview:", text.substring(0, 100));
        return fallback;
    }
};

const VALID_PLOT_PHASES: PlotPhase[] = ['intro', 'rising', 'climax', 'falling', 'epilogue'];

// Coerce a raw LLM plotProgress object into a valid PlotProgress, falling back to
// the previous snapshot's values for any missing/invalid field. Shared by both
// provider executors so PlotTracker output is validated identically.
export const normalizePlotProgress = (raw: any, previous?: PlotProgress | null): PlotProgress => {
    const pp = raw && typeof raw === 'object' ? raw : {};
    const phase: PlotPhase = VALID_PLOT_PHASES.includes(pp.phase) ? pp.phase : (previous?.phase ?? 'intro');
    const tensionRaw = Number(pp.tension);
    const tension = Number.isFinite(tensionRaw)
        ? Math.max(0, Math.min(100, Math.round(tensionRaw)))
        : (previous?.tension ?? 0);
    return {
        phase,
        currentBeat: String(pp.currentBeat ?? previous?.currentBeat ?? ''),
        tension,
        nextBeatHint: pp.nextBeatHint ? String(pp.nextBeatHint) : previous?.nextBeatHint,
    };
};

export interface AgentApiExecutor {
    getCharacterUpdate(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ analysis: string; characterUpdates?: CharacterUpdate[] }>;
    getSkipDecision(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ skip: boolean }>;
    getSwitchDecision(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ chosenAgentId: string }>;
    getSpyPreset(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<AgentSettings[]>;
    getSpyMorph(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ newSystemInstruction: string }>;
    getSpyMorphWithSkip(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ newSystemInstruction?: string; skip: boolean }>;
    getDefaultResponse(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<string>;
    runSubGraph(params: HeavyModeParams, tempAgents: AgentSettings[], parentResults: AgentOutput[], depth: number): Promise<{ finalResponse: string, agentResponses: AgentResponse[] }>;
    // World Model methods
    getUniverseDetection(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ detection: StoryBibleUniverse }>;
    getStoryBibleFragment(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ field: keyof StoryBible; value: any }>;
    getWorldSnapshotUpdate(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ analysis: string; worldSnapshot?: WorldSnapshot }>;
    getCharacterCandidate(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ characterId: string; candidate: string }>;
    getTurnRouting(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ routing: TurnRoutingDecision }>;
    getInnerStateUpdate(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ state: PerCharacterState }>;
    getDriftDirective(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ driftDetected: boolean; driftType?: string; directive: string }>;
    getPostCheck(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ needsRegen: boolean; reason?: string; correction?: string }>;
    getPlotProgress(params: HeavyModeParams, agent: AgentSettings, parentResults: AgentOutput[]): Promise<{ plotProgress: PlotProgress }>;
}

// Remove agents flagged as disabled and re-route any inbound connections
// directly to their downstream targets. Cyclic refs are guarded by a visited set.
// This is the "modular bypass" — a disabled agent transparently passes its
// upstream parents to its kids, so the rest of the graph keeps working.
export const filterDisabledAgents = (agents: AgentSettings[]): AgentSettings[] => {
    const byId = new Map(agents.map(a => [a.id, a]));
    const disabled = new Set(agents.filter(a => a.enabled === false).map(a => a.id));
    if (disabled.size === 0) return agents;

    const resolveDownstream = (id: string, seen = new Set<string>()): string[] => {
        if (seen.has(id)) return [];
        seen.add(id);
        if (!disabled.has(id)) return [id];
        const agent = byId.get(id);
        if (!agent) return [];
        return agent.connections.flatMap(c => resolveDownstream(c, seen));
    };

    return agents
        .filter(a => !disabled.has(a.id))
        .map(a => ({
            ...a,
            connections: Array.from(new Set(a.connections.flatMap(c => resolveDownstream(c)))),
        }));
};

// Expand templateForEachCharacter agents into N clones, one per character id.
// If characterIds is empty, the template is bypassed: parents that pointed at it
// are re-routed directly to the template's downstream connections.
export const expandTemplateAgents = (
    agents: AgentSettings[],
    characterIds: string[]
): AgentSettings[] => {
    const templates = agents.filter(a => a.templateForEachCharacter);
    if (templates.length === 0) return agents;

    const redirectMap: Record<string, string[]> = {};
    const clones: AgentSettings[] = [];

    for (const tpl of templates) {
        if (characterIds.length === 0) {
            // Bypass: anyone pointing at tpl now connects directly to tpl's downstream.
            redirectMap[tpl.id] = tpl.connections;
            continue;
        }
        const cloneIds: string[] = [];
        for (const charId of characterIds) {
            const cloneId = `${tpl.id}__${charId}`;
            cloneIds.push(cloneId);
            clones.push({
                ...tpl,
                id: cloneId,
                name: `${tpl.name} (${charId})`,
                targetCharacterId: charId,
                templateForEachCharacter: false,
            });
        }
        redirectMap[tpl.id] = cloneIds;
    }

    const rewire = (a: AgentSettings): AgentSettings => ({
        ...a,
        connections: a.connections.flatMap(connId =>
            redirectMap[connId] !== undefined ? redirectMap[connId] : [connId]
        ),
    });

    const nonTemplates = agents.filter(a => !a.templateForEachCharacter).map(rewire);
    // Clones must ALSO be re-routed: e.g. Inner State Tracker clones point at the
    // Character Candidate template id, which is itself expanded into N clones. Without
    // this second pass, inter-template references break and inner state never reaches
    // the downstream candidate or GM.
    const rewiredClones = clones.map(rewire);

    return [...nonTemplates, ...rewiredClones];
};

export interface ExecuteResult {
    finalResponse: string;
    agentResponses: AgentResponse[];
    characterUpdates: any[] | null;
    worldSnapshot: WorldSnapshot | null;
    storyBibleFragments: Array<{ field: keyof StoryBible; value: any }>;
    universeDetection: StoryBibleUniverse | null;
    turnRouting: TurnRoutingDecision | null;
    perCharacterStateUpdates: PerCharacterState[];
    postChecks: Array<{ needsRegen: boolean; reason?: string; correction?: string; agentName: string }>;
    driftDirectives: Array<{ driftDetected: boolean; directive: string }>;
    plotProgress: PlotProgress | null;
}

export const executeHeavyMode = async (
  params: HeavyModeParams,
  api: AgentApiExecutor,
  depth: number = 0
): Promise<ExecuteResult> => {
    const { updateStatus, signal, phasesToRun } = params;
    let runningWorldSnapshot = params.currentWorldSnapshot ?? params.previousWorldSnapshot ?? null;

    if (depth > 5) {
        throw new Error("Maximum agent recursion depth reached. Possible infinite loop in agent graph.");
    }

    if (signal?.aborted) throw new Error("Aborted");

    // Step 1: drop disabled agents and re-route their connections (modular bypass).
    // Step 2: filter by phase.
    // Step 3: expand templateForEachCharacter agents into per-character clones.
    let workingAgents = filterDisabledAgents(params.agentSettings);
    workingAgents = phasesToRun
        ? workingAgents.filter(a => phasesToRun.includes(a.phase ?? 'pre-turn'))
        : workingAgents;

    if (workingAgents.some(a => a.templateForEachCharacter)) {
        const roster = params.storyBible?.charactersRoster ?? [];
        const rosterById = new Map(roster.map(e => [e.id, e]));
        const playerName = (params.character.playerName ?? '').trim().toLowerCase();
        const isPlayerId = (id: string): boolean => {
            const entry = rosterById.get(id);
            const name = (entry?.name ?? id).trim().toLowerCase();
            return !!playerName && (name === playerName || id.trim().toLowerCase() === playerName);
        };

        let characterIds: string[];
        if (runningWorldSnapshot?.charactersInScene && runningWorldSnapshot.charactersInScene.length > 0) {
            characterIds = runningWorldSnapshot.charactersInScene;
        } else if (roster.length > 0) {
            // No snapshot yet (e.g. first turn): the curator hasn't established who's in the scene,
            // so fanning out to the WHOLE roster is wasteful — N inner-state + N candidate calls,
            // most returning "absent". Limit to roster NPCs actually named in the recent story text;
            // if none are named yet, fan out to nobody and let the GM introduce them.
            // Visible prose only: a name the model merely *considered* inside <think>
            // used to pass this gate and fan agents out to a character who was never in
            // the scene. Same fix the World Info keyword scan already carries.
            const recentText = [
                params.playerChoice ?? '',
                ...params.storyHistory.slice(-4).map(t => stripThinkTags(t.text ?? '')),
            ].join(' ').toLowerCase();
            characterIds = roster
                .filter(e => e.name && recentText.includes(e.name.trim().toLowerCase()))
                .map(e => e.id);
        } else {
            characterIds = params.trackedCharacters.map(c => c.id);
        }

        // The player ({{user}}) is never a world-model actor — no inner state, no candidate
        // proposals are generated for them, even if a roster/snapshot mistakenly includes them.
        characterIds = characterIds.filter(id => !isPlayerId(id));

        workingAgents = expandTemplateAgents(workingAgents, characterIds);
    }

    const agentSettings = workingAgents;

    const agentsByOrder = agentSettings.reduce<Record<number, AgentSettings[]>>((acc, agent) => {
        const order = agent.order;
        if (!acc[order]) acc[order] = [];
        acc[order].push(agent);
        return acc;
    }, {});

    const sortedOrders = Object.keys(agentsByOrder).map(Number).sort((a, b) => a - b);
    const agentOutputs: Record<string, AgentOutput> = {};
    const allAgentResponses: AgentResponse[] = [];
    const scratchpad: AgentOutput[] = []; // grows between orders, read by downstream agents
    let allCharacterUpdates: CharacterUpdate[] = [];
    const finalAgentIds = new Set(agentSettings.filter(a => a.connections.length === 0).map(a => a.id));

    // GM presence validation — the output layer is the only mandatory element.
    // If the user disabled the final agent (or there's no narrative-output agent at all),
    // we warn early so the failure mode is obvious rather than "[Critical: no final output]".
    const expectsNarrativeOutput = !phasesToRun || phasesToRun.includes('synthesis');
    if (expectsNarrativeOutput && agentSettings.length > 0) {
        const hasNarrativeFinal = agentSettings.some(a =>
            a.connections.length === 0 && resolveOutputType(a) === 'narrative'
        );
        if (!hasNarrativeFinal) {
            console.warn(
                '[World Model] No final narrative agent in this phase set. ' +
                'The output layer (an agent with empty connections and outputType=narrative) is required. ' +
                `Active agents: ${agentSettings.map(a => a.name).join(', ') || '(none)'}`
            );
        }
    }
    
    console.log('[WM][executor] start', {
        depth,
        totalAgents: agentSettings.length,
        phasesToRun: phasesToRun ?? 'all',
        agentNames: agentSettings.map(a => `${a.name}(${a.phase ?? 'pre-turn'})`),
        turnNumber: params.turnNumber,
        plotPhase: params.plotPhase,
    });

    // Warm-up is tracked per genuinely shared prefix. Agents with different
    // visibility settings do not share all system blocks; narrative agents place
    // their unique role before the bible, so each has its own group.
    const explicitCaching = isExplicitCachingActive(params.providerSettings);
    const warmedCacheGroups = new Set<string>();

    const cacheWarmGroupKey = (agent: AgentSettings): string => {
        if (resolveOutputType(agent) === 'narrative') return `narrative:${agent.id}`;
        const visibility = agent.instructionVisibility;
        return `shared:${[
            visibility?.setting ?? true,
            visibility?.personality ?? true,
            visibility?.playerDescription ?? true,
        ].map(Boolean).map(Number).join('')}`;
    };

    /** Did this result come from a real provider call — i.e. did it warm the cache? */
    const didCallProvider = (result: AgentOutput | null): boolean =>
        !!result
        && !result.text.startsWith('[ERROR')
        && !result.fromResultCache;

    for (const order of sortedOrders) {
        if (signal?.aborted) throw new Error("Aborted");

        const orderStartedAt = Date.now();
        const currentOrderAgents = agentsByOrder[order];
        updateStatus(`Order ${order}: ${currentOrderAgents.map(a => a.name).join(', ')}`);
        console.log(`[WM][order ${order}] running`, currentOrderAgents.map(a => `${a.name} (${resolveOutputType(a)})`));

        // Each agent in this order sees the scratchpad as it stood when the order started.
        // Outputs from this order land in the scratchpad *after* the order completes, so peers
        // in the same order don't accidentally race-read each other.
        const paramsForThisOrder: HeavyModeParams = {
            ...params,
            previousWorldSnapshot: runningWorldSnapshot,
            currentWorldSnapshot: runningWorldSnapshot,
            scratchpad: [...scratchpad],
        };

        const runAgent = async (agent: AgentSettings): Promise<AgentOutput | null> => {
            if (signal?.aborted) return null;

            const parentAgents = agentSettings.filter(parent => parent.connections.includes(agent.id));
            const parentOutputs = parentAgents.map(p => agentOutputs[p.id]).filter((o): o is AgentOutput => !!o);

            if (parentAgents.length > 0 && parentOutputs.length === 0) return null;

            const hasActiveDefaultParent = parentAgents.some(p => (p.type ?? 'default') === 'default' && agentOutputs[p.id]);
            const hasActiveSpyParent = parentAgents.some(p => p.type === 'spy' && agentOutputs[p.id]);
            const wasChosenBySwitch = parentAgents.some(p => p.type === 'switch' && agentOutputs[p.id]?.chosenAgentId === agent.id);
            const canRun = parentAgents.length === 0 || hasActiveDefaultParent || wasChosenBySwitch || hasActiveSpyParent;
            
            if (!canRun) return null;
            
            const inputsForThisAgent: AgentOutput[] = [];
            parentAgents.forEach(parent => {
                const parentOutput = agentOutputs[parent.id];
                if (parentOutput) {
                     if (parent.type === 'switch') {
                        const switchsParentAgents = agentSettings.filter(p => p.connections.includes(parent.id));
                        inputsForThisAgent.push(...switchsParentAgents.map(p => agentOutputs[p.id]).filter((o): o is AgentOutput => !!o));
                    } else if (((parent.type === 'spy' && parent.spyMode === 'morph') || (parent.type === 'default' && parent.defaultSkip)) && parentOutput.passedThroughContext) {
                        inputsForThisAgent.push(...parentOutput.passedThroughContext);
                    } else {
                        inputsForThisAgent.push(parentOutput);
                    }
                }
            });

            const parentResults = [...new Map(inputsForThisAgent.map(item => [item.agentName, item])).values()];
            const isFinalAgent = agent.connections.length === 0;

            try {
                if ((agent.type === 'default' && agent.defaultSkip && !isFinalAgent) || (agent.type === 'spy' && agent.spyMode === 'morph' && agent.spyMorphSkip && !isFinalAgent)) {
                    const { skip, newSystemInstruction } = await api.getSpyMorphWithSkip(paramsForThisOrder, agent, parentResults);
                    if (skip) return { agentId: agent.id, agentName: agent.name, text: `[SKIPPED]`, passedThroughContext: parentResults };
                    if (agent.type === 'spy' && newSystemInstruction) {
                        const responseText = await api.getDefaultResponse(paramsForThisOrder, { ...agent, systemInstruction: newSystemInstruction }, parentResults);
                        return { agentId: agent.id, agentName: agent.name, text: responseText };
                    }
                }

                if (agent.type === 'spy') {
                    if (agent.spyMode === 'preset') {
                        const tempAgents = await api.getSpyPreset(paramsForThisOrder, agent, parentResults);
                        const subGraphResult = await api.runSubGraph(paramsForThisOrder, tempAgents, parentResults, depth + 1);
                        allAgentResponses.push(...subGraphResult.agentResponses);
                        return { agentId: agent.id, agentName: agent.name, text: subGraphResult.finalResponse };
                    } else {
                        const { newSystemInstruction } = await api.getSpyMorph(paramsForThisOrder, agent, parentResults);
                        const responseText = await api.getDefaultResponse(paramsForThisOrder, { ...agent, systemInstruction: newSystemInstruction }, parentResults);
                        return { agentId: agent.id, agentName: agent.name, text: responseText };
                    }
                }

                if (agent.type === 'switch') {
                    const { chosenAgentId } = await api.getSwitchDecision(paramsForThisOrder, agent, parentResults);
                    return { agentId: agent.id, agentName: agent.name, text: `[BRANCHED]`, chosenAgentId };
                }

                // Dispatch by outputType. Non-narrative agent calls are cacheable because
                // their key includes the visible prompt inputs, parent outputs, model config,
                // Story Bible, and current branch snapshot.
                const outputType = resolveOutputType(agent);
                const cacheKey = outputType !== 'narrative'
                    ? buildAgentCacheKey(paramsForThisOrder, agent, parentResults, outputType)
                    : null;
                const cached = cacheKey ? paramsForThisOrder.agentCache?.get(cacheKey) : undefined;
                if (cached) {
                    paramsForThisOrder.updateStatus(`Cache hit: ${agent.name}`, {
                        agentId: agent.id,
                        outputType,
                    });
                    return {
                        ...cached,
                        agentId: agent.id,
                        agentName: agent.name,
                        // No provider call happened, so this warmed no prompt cache.
                        fromResultCache: true,
                    };
                }

                let result: AgentOutput;
                switch (outputType) {
                    case 'characterUpdate': {
                        const { analysis, characterUpdates } = await api.getCharacterUpdate(paramsForThisOrder, agent, parentResults);
                        result = { agentId: agent.id, agentName: agent.name, text: analysis, characterUpdates };
                        break;
                    }
                    case 'universeDetection': {
                        const { detection } = await api.getUniverseDetection(paramsForThisOrder, agent, parentResults);
                        result = {
                            agentId: agent.id,
                            agentName: agent.name,
                            text: JSON.stringify(detection, null, 2),
                            universeDetection: detection,
                        };
                        break;
                    }
                    case 'storyBibleFragment': {
                        const fragment = await api.getStoryBibleFragment(paramsForThisOrder, agent, parentResults);
                        result = {
                            agentId: agent.id,
                            agentName: agent.name,
                            text: `[${String(fragment.field)}] ${JSON.stringify(fragment.value, null, 2)}`,
                            storyBibleFragment: fragment,
                        };
                        break;
                    }
                    case 'worldSnapshot': {
                        const { analysis, worldSnapshot } = await api.getWorldSnapshotUpdate(paramsForThisOrder, agent, parentResults);
                        result = {
                            agentId: agent.id,
                            agentName: agent.name,
                            text: analysis || (worldSnapshot ? JSON.stringify(worldSnapshot, null, 2) : '[No snapshot]'),
                            worldSnapshot,
                        };
                        break;
                    }
                    case 'characterCandidate': {
                        const { characterId, candidate } = await api.getCharacterCandidate(paramsForThisOrder, agent, parentResults);
                        result = {
                            agentId: agent.id,
                            agentName: agent.name,
                            text: candidate || '[empty]',
                            characterCandidate: { characterId, candidate },
                        };
                        break;
                    }
                    case 'turnRouter': {
                        const { routing } = await api.getTurnRouting(paramsForThisOrder, agent, parentResults);
                        result = {
                            agentId: agent.id,
                            agentName: agent.name,
                            text: `[skipPhases=${routing.skipPhases.join(',')}] [skipAgentIds=${routing.skipAgentIds.join(',')}] ${routing.reason ?? ''}`,
                            turnRouting: routing,
                        };
                        break;
                    }
                    case 'innerStateUpdate': {
                        const { state } = await api.getInnerStateUpdate(paramsForThisOrder, agent, parentResults);
                        result = {
                            agentId: agent.id,
                            agentName: agent.name,
                            text: `[inner: ${state.characterId}] ${state.emotionalState ?? ''} | priority: ${state.currentPriority ?? ''}${state.hiddenAgenda ? ' | hidden: ' + state.hiddenAgenda : ''}`,
                            perCharacterStateUpdate: state,
                        };
                        break;
                    }
                    case 'driftDirective': {
                        const drift = await api.getDriftDirective(paramsForThisOrder, agent, parentResults);
                        result = {
                            agentId: agent.id,
                            agentName: agent.name,
                            text: drift.driftDetected
                                ? `[DRIFT DETECTED: ${drift.driftType ?? 'generic'}] DIRECTIVE: ${drift.directive}`
                                : `[no drift] ${drift.directive}`,
                            driftDirective: drift,
                        };
                        break;
                    }
                    case 'postCheck': {
                        const check = await api.getPostCheck(paramsForThisOrder, agent, parentResults);
                        result = {
                            agentId: agent.id,
                            agentName: agent.name,
                            text: check.needsRegen
                                ? `[POST-CHECK FAIL] ${check.reason ?? ''} → ${check.correction ?? ''}`
                                : `[post-check ok] ${check.reason ?? ''}`,
                            postCheck: check,
                        };
                        break;
                    }
                    case 'plotProgress': {
                        const { plotProgress } = await api.getPlotProgress(paramsForThisOrder, agent, parentResults);
                        result = {
                            agentId: agent.id,
                            agentName: agent.name,
                            text: `[plot: ${plotProgress.phase} · tension ${plotProgress.tension}] ${plotProgress.currentBeat}`,
                            plotProgress,
                        };
                        break;
                    }
                    case 'narrative':
                    default: {
                        const responseText = await api.getDefaultResponse(paramsForThisOrder, agent, parentResults);
                        result = { agentId: agent.id, agentName: agent.name, text: responseText };
                        break;
                    }
                }
                if (cacheKey && result.text && !result.text.startsWith('[ERROR')) {
                    paramsForThisOrder.agentCache?.set(cacheKey, result);
                }
                return result;
            } catch (error) {
                if (signal?.aborted) return null;
                console.error(`Heavy Mode Error [Agent: ${agent.name}]:`, error);
                const msg = error instanceof Error ? error.message : "Internal Error";
                return { agentId: agent.id, agentName: agent.name, text: `[ERROR: ${msg.includes('SAFETY') ? 'Content Filtered' : msg}]` };
            }
        };

        const abortPromise = new Promise<never>((_, reject) => {
            if (signal?.aborted) reject(new Error('Aborted by user.'));
            signal?.addEventListener('abort', () => reject(new Error('Aborted by user.')));
        });

        const runOrder = async (): Promise<(AgentOutput | null)[]> => {
            if (!explicitCaching) return Promise.all(currentOrderAgents.map(runAgent));

            const groups = new Map<string, Array<{ agent: AgentSettings; index: number }>>();
            currentOrderAgents.forEach((agent, index) => {
                const key = cacheWarmGroupKey(agent);
                const group = groups.get(key) ?? [];
                group.push({ agent, index });
                groups.set(key, group);
            });

            const groupedResults = await Promise.all([...groups.entries()].map(async ([key, group]) => {
                if (warmedCacheGroups.has(key) || group.length === 1) {
                    return Promise.all(group.map(async item => ({
                        index: item.index,
                        result: await runAgent(item.agent),
                    })));
                }

                const results: Array<{ index: number; result: AgentOutput | null }> = [];
                let cursor = 0;
                // A local result-cache hit, a dependency skip, or an error does not
                // warm the provider cache. Walk forward until a real call succeeds;
                // only then is it safe to fan out the remaining siblings.
                while (cursor < group.length) {
                    const item = group[cursor];
                    const result = await runAgent(item.agent);
                    results.push({ index: item.index, result });
                    cursor += 1;
                    if (!didCallProvider(result)) continue;

                    warmedCacheGroups.add(key);
                    const rest = await Promise.all(group.slice(cursor).map(async remaining => ({
                        index: remaining.index,
                        result: await runAgent(remaining.agent),
                    })));
                    return [...results, ...rest];
                }
                return results;
            }));

            return groupedResults
                .flat()
                .sort((a, b) => a.index - b.index)
                .map(item => item.result);
        };

        const currentOrderResults = (await Promise.race([runOrder(), abortPromise])).filter((r): r is AgentOutput => r !== null);
        currentOrderResults.forEach(result => {
            if (!didCallProvider(result)) return;
            const agent = currentOrderAgents.find(candidate => candidate.id === result.agentId);
            if (agent) warmedCacheGroups.add(cacheWarmGroupKey(agent));
        });
        currentOrderResults.forEach(r => {
            agentOutputs[r.agentId] = r;
            allAgentResponses.push({ agentName: r.agentName, text: r.text });
            scratchpad.push(r); // residual stream — visible to all downstream agents
            if (r.characterUpdates) allCharacterUpdates.push(...r.characterUpdates);
            if (r.worldSnapshot) runningWorldSnapshot = r.worldSnapshot;
        });
        console.log(`[WM][order ${order}] done in ${Date.now() - orderStartedAt}ms`, {
            outputs: currentOrderResults.map(r => ({ agent: r.agentName, textPreview: r.text?.slice(0, 80) })),
        });
    }

    console.log('[WM][executor] done', {
        finalAgents: [...finalAgentIds],
        totalResponses: allAgentResponses.length,
    });
    
    if (signal?.aborted) throw new Error("Aborted");

    updateStatus('Finalizing Narrative...');
    const finalOutputs = Object.values(agentOutputs).filter(o => finalAgentIds.has(o.agentId));
    const finalResponseText = finalOutputs.length > 0
        ? (finalOutputs.length > 1 ? finalOutputs.map(o => `--- ${o.agentName} ---\n${o.text}`).join('\n\n') : finalOutputs[0].text)
        : "[Critical: Agent graph resulted in no final output.]";

    // Aggregate World Model outputs across all agents.
    let aggregatedWorldSnapshot: WorldSnapshot | null = null;
    const storyBibleFragments: Array<{ field: keyof StoryBible; value: any }> = [];
    let universeDetection: StoryBibleUniverse | null = null;
    let turnRouting: TurnRoutingDecision | null = null;
    const perCharacterStateUpdates: PerCharacterState[] = [];
    const postChecks: Array<{ needsRegen: boolean; reason?: string; correction?: string; agentName: string }> = [];
    const driftDirectives: Array<{ driftDetected: boolean; directive: string }> = [];
    let aggregatedPlotProgress: PlotProgress | null = null;
    for (const out of Object.values(agentOutputs)) {
        if (out.worldSnapshot) aggregatedWorldSnapshot = out.worldSnapshot;
        if (out.storyBibleFragment) storyBibleFragments.push(out.storyBibleFragment);
        if (out.universeDetection) universeDetection = out.universeDetection;
        if (out.turnRouting) turnRouting = out.turnRouting;
        if (out.perCharacterStateUpdate) perCharacterStateUpdates.push(out.perCharacterStateUpdate);
        if (out.postCheck) postChecks.push({ ...out.postCheck, agentName: out.agentName });
        if (out.driftDirective) driftDirectives.push({ driftDetected: out.driftDirective.driftDetected, directive: out.driftDirective.directive });
        if (out.plotProgress) aggregatedPlotProgress = out.plotProgress;
    }

    return {
        finalResponse: finalResponseText,
        agentResponses: allAgentResponses,
        characterUpdates: allCharacterUpdates.length > 0 ? allCharacterUpdates : null,
        worldSnapshot: aggregatedWorldSnapshot,
        storyBibleFragments,
        universeDetection,
        turnRouting,
        perCharacterStateUpdates,
        postChecks,
        driftDirectives,
        plotProgress: aggregatedPlotProgress,
    };
};
