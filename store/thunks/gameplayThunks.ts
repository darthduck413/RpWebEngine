
import { createAsyncThunk } from '@reduxjs/toolkit';
import { RootState } from '../store';
import {
    setStoryHistory,
    setChatTree,
    addNodeToTree,
    updateNode,
    navigateBranch,
    setLoading,
    setLoadingStatus,
    setError,
    setStreamingNodeId,
    setTrackedCharacters,
    setUserPersonaDetails,
    setStoryBible,
    setPerCharacterStates,
    setWorldModelStateForNode,
    resetGame,
    setBaseCharacterSetting,
    setBaseCharacterScenario,
    deriveHistoryFromTree,
    deleteTurn
} from '../slices/gameSlice';
import { 
    setCurrentChatId,
    showToast
} from '../slices/uiSlice';
import { 
    addLog 
} from '../slices/logSlice';
import { 
    setAgentSettings
} from '../slices/settingsSlice';
import { 
  selectPreset, 
  generatePreset, 
  adaptPresetToIntelligentAgents, 
  getGameTurnHeavyMode as getGameTurnHeavyModeGemini,
  geminiApiExecutor,
  getGameTurnStream
} from '../../services/geminiService';
import {
  selectPreset as selectPresetProxy,
  generatePreset as generatePresetProxy,
  adaptPresetToIntelligentAgents as adaptPresetToIntelligentAgentsProxy,
  proxyApiExecutor,
  getGameTurnStream as getGameTurnStreamProxy
} from '../../services/proxyService';
import { StoryTurn, Character, GameState, ChatTree, StoryNode, UserPersonaDetails, WorldSnapshot, StoryBible, AgentSettings, AgentPhase, WorldModelBranchState } from '../../types';
import { HeavyModeParams, executeHeavyMode, AgentApiExecutor, ExecuteResult, inferPlotPhase, TurnRoutingDecision, createAgentResultCache } from '../../services/common/gameplay';
import { worldModelRateLimiter } from '../../services/common/rateLimiter';
import { SHARED_USER_DESCRIPTION, DEFAULT_PERSONA_AVATAR, SHARED_SYSTEM_INSTRUCTION_TEMPLATE } from '../../constants';
import { createInitialTree } from '../utils/treeUtils';
import { mergeCharacterUpdates } from '../utils/characterUtils';
import { autoSaveGame } from './storageThunks';
import { fetchImageAsBase64 } from '../../services/common/imageUtils';
import { cleanModelOutputForPrompt } from '../../services/common/promptText';
import { applyProviderCustomPromptToSystemInstruction } from '../../services/common/effectiveSystemInstruction';
import { isDynamicSystemInstructionTemplate } from '../../services/common/systemPrompt';
import { composeManualScenarios } from '../../services/common/manualScenarios';
import { usageTracker, formatUsageSummary } from '../../services/common/usage';
import { buildContinuationRequest, continuationJoinSeparator } from '../../services/common/continuation';

const worldModelAgentCache = createAgentResultCache(250);
const STREAM_UPDATE_INTERVAL_MS = 150;

const COMPLETE_SENTENCE_END_RE = /[.!?](?:["')\]\}*_]|\s)*$/;
const COMPLETE_SENTENCE_BOUNDARY_RE = /[.!?](?:["')\]\}*_]|\s)*/g;

const trimUnfinishedTrailingSentence = (text: string): string => {
    const trimmed = text.trimEnd();
    if (!trimmed || COMPLETE_SENTENCE_END_RE.test(trimmed)) return trimmed;

    let lastCompleteSentenceEnd = -1;
    for (const match of trimmed.matchAll(COMPLETE_SENTENCE_BOUNDARY_RE)) {
        lastCompleteSentenceEnd = (match.index ?? 0) + match[0].length;
    }

    return lastCompleteSentenceEnd > 0
        ? trimmed.slice(0, lastCompleteSentenceEnd).trimEnd()
        : '';
};

// Sentence/clause/quote/emphasis boundaries. When the text being continued ends
// on one of these, the previous thought is "complete" and the model's
// continuation is a fresh one — so we drop it onto a new line instead of gluing
// it onto the last character. ASCII punctuation plus a few common unicode marks:
// … (…), curly quotes “ ” ‘ ’ (“-’), guillemet » (»).
const CONTINUE_BOUNDARY_CHARS_RE = /[.,!?;:"'*_)\]}…“”‘’»]/;

// GM output on its way BACK into a prompt as quoted material for the post-check
// audit. The stored node text keeps its <think> block; only the copy handed to
// another agent is reduced to the prose the player will actually see.
// Unrelated to a preset's `includeThinkingInHistory` switch: that governs the
// model's own assistant turns, never a block quoted inside another agent's prompt.
const cleanGmOutputForQuoting = cleanModelOutputForPrompt;

// Decide how the "Continue" feature joins new text onto the existing message.
// If the previous text ends on a completed boundary we append a newline so the
// continuation starts cleanly; if it ends mid-word we join directly so the
// interrupted word/sentence finishes seamlessly. Pure string logic — no model call.
const joinContinuationBase = (previousText: string): string => {
    if (!previousText) return previousText;
    // Already separated by a newline → nothing to add.
    if (/\n[ \t]*$/.test(previousText)) return previousText;
    const withoutTrailingSpaces = previousText.replace(/[ \t]+$/, '');
    const lastChar = withoutTrailingSpaces.slice(-1);
    if (!lastChar) return previousText;
    return CONTINUE_BOUNDARY_CHARS_RE.test(lastChar)
        ? `${withoutTrailingSpaces}\n`
        : previousText;
};

const findNearestWorldModelBranchState = (
    tree: ChatTree | null | undefined,
    statesByNodeId: Record<string, WorldModelBranchState> | undefined,
    fromNodeId: string
): WorldModelBranchState | null => {
    if (!tree || !statesByNodeId) return null;
    let current = tree.nodes[fromNodeId];
    while (current) {
        const branchState = statesByNodeId[current.id];
        if (branchState) return branchState;
        current = current.parentId ? tree.nodes[current.parentId] : undefined;
    }
    return null;
};

// Union two id-keyed lists: keep every existing entry, override matched ids with the
// incoming version, append genuinely new ids. Never shrinks — so a reconciler that
// omits a character can't accidentally erase it from the bible.
const unionById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
    const byId = new Map(existing.map(e => [e.id, e]));
    for (const item of incoming) {
        if (item && typeof item.id === 'string') {
            byId.set(item.id, { ...byId.get(item.id), ...item });
        }
    }
    return Array.from(byId.values());
};

// The player ({{user}}) must never appear in the bible roster — strip any entry whose name or
// id matches the player. Belt-and-suspenders behind the roster prompt's exclusion instruction,
// so the player is never treated as a story character in the persisted end result.
const stripPlayerFromBible = (
    bible: StoryBible | null,
    playerName: string | undefined
): StoryBible | null => {
    if (!bible?.charactersRoster?.length || !playerName?.trim()) return bible;
    const pn = playerName.trim().toLowerCase();
    const filtered = bible.charactersRoster.filter(
        e => e.name?.trim().toLowerCase() !== pn && e.id?.trim().toLowerCase() !== pn
    );
    return filtered.length === bible.charactersRoster.length
        ? bible
        : { ...bible, charactersRoster: filtered };
};

// Apply one mid-story Story Bible fragment from the Bible Reconciler. Roster/locations
// are unioned by id (additive); plot/lore are shallow-merged. Returns the same bible
// reference when nothing applies, so callers can detect "no change".
const mergeBibleFragment = (
    bible: StoryBible,
    frag: { field: keyof StoryBible; value: any }
): StoryBible => {
    if (!frag || frag.value == null) return bible;
    switch (frag.field) {
        case 'charactersRoster':
            return Array.isArray(frag.value)
                ? { ...bible, charactersRoster: unionById(bible.charactersRoster, frag.value) }
                : bible;
        case 'locations':
            return Array.isArray(frag.value)
                ? { ...bible, locations: unionById(bible.locations, frag.value) }
                : bible;
        case 'plot':
            return typeof frag.value === 'object' ? { ...bible, plot: { ...bible.plot, ...frag.value } } : bible;
        case 'lore':
            return typeof frag.value === 'object' ? { ...bible, lore: { ...bible.lore, ...frag.value } } : bible;
        default:
            return bible;
    }
};

export const startNewGame = createAsyncThunk(
  'game/startNewGame',
  async (
    args: Character | { character: Character; initialFirstMessageIndex?: number },
    { dispatch, getState }
  ) => {
    // Backwards-compatible: callers may pass a bare Character or an options object.
    const character = 'character' in args ? args.character : args;
    const initialFirstMessageIndex = 'character' in args ? (args.initialFirstMessageIndex ?? 0) : 0;

    const state = getState() as RootState;
    const { personas, activePersonaId } = state.personas;
    const activePersona = personas.find(p => p.id === activePersonaId) || personas[0];

    dispatch(resetGame());
    dispatch(setBaseCharacterSetting(character.setting));
    dispatch(setBaseCharacterScenario(character.scenario ?? ''));
    const newChatId = crypto.randomUUID();
    dispatch(setCurrentChatId(newChatId));

    const chatTree = createInitialTree(character, initialFirstMessageIndex);
    dispatch(setChatTree(chatTree));
    
    const userPersonaDetails: UserPersonaDetails = {
        name: activePersona?.name || character.playerName || 'User',
        description: activePersona?.description || character.playerDescription || SHARED_USER_DESCRIPTION,
        avatar: activePersona?.avatar || DEFAULT_PERSONA_AVATAR
    };
    dispatch(setUserPersonaDetails(userPersonaDetails));

    dispatch(addLog({ message: `New game started. Session ID: ${newChatId}` }));
    dispatch(autoSaveGame());
  }
);

export const switchBranch = createAsyncThunk(
    'game/switchBranch',
    async ({ nodeId, direction }: { nodeId: string, direction: 'prev' | 'next' }, { dispatch, getState }) => {
        const state = getState() as RootState;
        if (state.game.isLoading) return;

        const tree = state.game.chatTree;
        if (!tree) return;

        const node = tree.nodes[nodeId];
        if (!node || !node.parentId) return;

        const parent = tree.nodes[node.parentId];
        const currentIndex = parent.selectedChildIndex ?? 0;
        const total = parent.childrenIds.length;

        let newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

        if (direction === 'next' && newIndex >= total) {
             if (!node.content.isPlayer) {
                 const currentHistory = deriveHistoryFromTree(tree);
                 const nodeIndex = currentHistory.findIndex(turn => turn.id === node.id);
                 const historyForContext = nodeIndex >= 0 ? currentHistory.slice(0, nodeIndex) : currentHistory;
                 const modelNodeId = crypto.randomUUID();
                 const modelNode: StoryNode = {
                     id: modelNodeId,
                     parentId: parent.id,
                     childrenIds: [],
                     selectedChildIndex: 0,
                     content: { id: modelNodeId, text: '', isPlayer: false },
                     createdAt: Date.now()
                 };

                 dispatch(addNodeToTree({ node: modelNode }));
                 await dispatch(generateAiResponse({ history: historyForContext, targetNodeId: modelNodeId }));
                 return;
             }
        }

        if (newIndex >= 0 && newIndex < total) {
            dispatch(navigateBranch({ parentId: parent.id, newIndex }));
            dispatch(autoSaveGame());
        }
    }
);

export const regenerateLastTurn = createAsyncThunk(
    'game/regenerateLastTurn',
    async (arg: { signal?: AbortSignal } | undefined | void, { dispatch, getState }) => {
        const state = getState() as RootState;
        const signal = arg ? arg.signal : undefined;
        
        if (state.game.isLoading) return;

        const tree = state.game.chatTree;
        if (!tree) return;

        const currentHistory = deriveHistoryFromTree(tree);
        const lastTurn = currentHistory[currentHistory.length - 1];
        
        if (!lastTurn) return;

        if (lastTurn.isPlayer) {
             const parentId = lastTurn.id;
             const modelNodeId = crypto.randomUUID();
             const modelNode: StoryNode = {
                 id: modelNodeId,
                 parentId: parentId,
                 childrenIds: [],
                 selectedChildIndex: 0,
                 content: { id: modelNodeId, text: '', isPlayer: false },
                 createdAt: Date.now()
             };
             dispatch(addNodeToTree({ node: modelNode }));
             
             await dispatch(generateAiResponse({ history: currentHistory, targetNodeId: modelNodeId, signal }));
             return;
        }

        const parentId = lastTurn.branchInfo?.parentId || tree.rootNodeId;
        
        const modelNodeId = crypto.randomUUID();
        const modelNode: StoryNode = {
            id: modelNodeId,
            parentId: parentId,
            childrenIds: [],
            selectedChildIndex: 0,
            content: { id: modelNodeId, text: '', isPlayer: false },
            createdAt: Date.now()
        };
        
        dispatch(addNodeToTree({ node: modelNode }));
        
        const historyForContext = currentHistory.slice(0, -1);

        await dispatch(generateAiResponse({ history: historyForContext, targetNodeId: modelNodeId, signal }));
    }
);

export const continueLastTurn = createAsyncThunk(
    'game/continueLastTurn',
    async (arg: { signal?: AbortSignal } | undefined | void, { dispatch, getState }) => {
        const state = getState() as RootState;
        const signal = arg ? arg.signal : undefined;
        
        if (state.game.isLoading) return;

        const tree = state.game.chatTree;
        if (!tree) return;

        const currentHistory = deriveHistoryFromTree(tree);
        const lastTurn = currentHistory[currentHistory.length - 1];
        
        if (!lastTurn || lastTurn.isPlayer) return;

        await dispatch(generateAiResponse({ 
            history: currentHistory,
            targetNodeId: lastTurn.id, 
            signal,
            isContinuing: true 
        }));
    }
);

export const submitPlayerTurn = createAsyncThunk(
  'game/submitPlayerTurn',
  async ({ choice, image, signal }: { choice: string, image?: string, signal?: AbortSignal }, { dispatch, getState }) => {
    if (!choice.trim() && !image) return;
    
    const state = getState() as RootState;
    if (state.game.isLoading) return;

    const tree = state.game.chatTree;
    if (!tree) return;

    const currentHistory = deriveHistoryFromTree(tree);
    const lastNodeId = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1].id : tree.rootNodeId;
    
    const userNodeId = crypto.randomUUID();
    const userNode: StoryNode = {
        id: userNodeId,
        parentId: lastNodeId,
        childrenIds: [],
        selectedChildIndex: 0,
        content: { id: userNodeId, text: choice, image, isPlayer: true },
        createdAt: Date.now(),
    };
    dispatch(addNodeToTree({ node: userNode }));

    const modelNodeId = crypto.randomUUID();
    const modelNode: StoryNode = {
        id: modelNodeId,
        parentId: userNodeId,
        childrenIds: [],
        selectedChildIndex: 0,
        content: { id: modelNodeId, text: '', isPlayer: false },
        createdAt: Date.now()
    };
    dispatch(addNodeToTree({ node: modelNode }));
    
    const historyForContext = [...currentHistory, { ...userNode.content, branchInfo: { nodeId: userNodeId, parentId: lastNodeId, current: 1, total: 1 } }];
    
    await dispatch(generateAiResponse({ history: historyForContext, targetNodeId: modelNodeId, signal }));
  }
);

export const generateAiResponse = createAsyncThunk(
    'game/generateAiResponse',
    async ({ history, targetNodeId, signal, isContinuing }: { history: StoryTurn[], targetNodeId: string, signal?: AbortSignal, isContinuing?: boolean }, { dispatch, getState }) => {
        const state = getState() as RootState;
        const {
            agentSettings, isWorldModelEnabled,
            worldModelRpmEnabled, worldModelRpm,
            isIntelligentPresetAnalyzerEnabled, playerNotes, historyContextTurns,
            postHistoryInstruction,
            characterSetting, characterScenario, characterPersonality, systemInstruction,
            includeAllAgentResponsesInContext, keepNonExistentAgentResponses,
            apiProvider, proxySettings: rawProxySettings, geminiSettings,
            sendUserAvatar, sendCharacterAvatar, ignoreImages,
            deleteUnfinishedGeminiSentencesOnError, enableAnthropicCaching
        } = state.settings;
        // Inject the global caching toggle into proxySettings so it reaches prepareWireMessages.
        const proxySettings = { ...rawProxySettings, enableAnthropicCaching };
        // One turn = one cache report. World Model fans out to many calls, so the
        // per-turn aggregate is the only number that says whether caching pays off.
        usageTracker.reset();
        const { trackedCharacters, userPersonaDetails } = state.game;
        const { selectedCharacter, currentChatId } = state.ui;

        const activePersonaDetails = userPersonaDetails || {
            name: 'User',
            description: SHARED_USER_DESCRIPTION,
            avatar: DEFAULT_PERSONA_AVATAR
        };
        
        const baseSystemInstructionTemplate = selectedCharacter?.systemInstructionTemplate || SHARED_SYSTEM_INSTRUCTION_TEMPLATE;
        const sessionSystemInstruction = systemInstruction || baseSystemInstructionTemplate;
        const finalSystemInstruction = isDynamicSystemInstructionTemplate(sessionSystemInstruction)
            ? applyProviderCustomPromptToSystemInstruction(
                sessionSystemInstruction,
                apiProvider,
                proxySettings,
                geminiSettings
            )
            : sessionSystemInstruction;
        
        const characterWithPersona = selectedCharacter ? {
            ...selectedCharacter,
            playerName: activePersonaDetails.name,
            playerDescription: activePersonaDetails.description,
            setting: characterSetting ?? selectedCharacter.setting ?? '',
            scenario: characterScenario ?? selectedCharacter.scenario ?? '',
            personality: characterPersonality || selectedCharacter.personality || '',
            systemInstructionTemplate: finalSystemInstruction,
        } : null;
        
        if (!characterWithPersona) return;

        dispatch(setLoading(true));
        dispatch(setStreamingNodeId(targetNodeId));
        dispatch(setError(null));

        let pendingStreamText: string | null = null;
        let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
        let lastStreamFlushAt = 0;

        const flushStreamNow = () => {
            if (streamFlushTimer) {
                clearTimeout(streamFlushTimer);
                streamFlushTimer = null;
            }
            if (pendingStreamText === null) return;

            const text = pendingStreamText;
            pendingStreamText = null;
            lastStreamFlushAt = Date.now();
            dispatch(updateNode({
                nodeId: targetNodeId,
                content: { text },
            }));
        };

        const queueStreamTextUpdate = (text: string) => {
            pendingStreamText = text;
            const elapsed = Date.now() - lastStreamFlushAt;

            if (elapsed >= STREAM_UPDATE_INTERVAL_MS) {
                flushStreamNow();
                return;
            }

            if (!streamFlushTimer) {
                streamFlushTimer = setTimeout(flushStreamNow, STREAM_UPDATE_INTERVAL_MS - elapsed);
            }
        };

        const logContext = (data: any) => {
            dispatch(addLog({ message: 'Request Payload', data }));
        };

        let userAvatarBase64: string | null = null;
        let charAvatarBase64: string | null = null;

        if (!ignoreImages) {
            if (sendUserAvatar && activePersonaDetails.avatar) {
                userAvatarBase64 = await fetchImageAsBase64(activePersonaDetails.avatar);
            }
            if (sendCharacterAvatar && selectedCharacter?.image) {
                charAvatarBase64 = await fetchImageAsBase64(selectedCharacter.image);
            }
        }

        const avatarContext = {
            userAvatar: userAvatarBase64,
            charAvatar: charAvatarBase64
        };

        try {
            const continuation = isContinuing
                ? buildContinuationRequest(history, targetNodeId, historyContextTurns)
                : null;
            const requestHistory = continuation?.history ?? history;
            const requestHistoryContextTurns = continuation?.historyContextTurns ?? historyContextTurns;
            const lastPlayerTurn = requestHistory.slice().reverse().find(t => t.isPlayer);
            const playerChoice = continuation?.playerChoice ?? (lastPlayerTurn ? lastPlayerTurn.text : '');

            if (isWorldModelEnabled) {
                const branchWorldState = findNearestWorldModelBranchState(
                    state.game.chatTree,
                    state.game.worldModelStatesByNodeId,
                    targetNodeId
                );
                const storyBible = branchWorldState?.storyBible ?? state.game.storyBible;
                const perCharacterStates = branchWorldState?.perCharacterStates ?? state.game.perCharacterStates;

                console.log('[WM][thunk] generate start', {
                    apiProvider,
                    model: apiProvider === 'proxy' ? proxySettings.model : geminiSettings.model,
                    hasStoryBible: !!storyBible,
                    isContinuing,
                    enabledAgents: agentSettings.filter(a => a.enabled !== false).map(a => `${a.name}(${a.phase})`),
                });
                const updateStatus = (status: string, data?: any) => {
                    dispatch(setLoadingStatus(status));
                    if (data) dispatch(addLog({ message: status, data }));
                };

                // Hard preset override: when World Model is on, every agent uses the active
                // global provider+model. We clone the agent (never mutate) before delegating.
                const overrideModel = apiProvider === 'proxy' ? proxySettings.model : geminiSettings.model;
                const cloneForHardOverride = (agent: AgentSettings): AgentSettings => ({
                    ...agent,
                    provider: apiProvider,
                    model: overrideModel,
                });
                const pickExecutor = () => apiProvider === 'proxy' ? proxyApiExecutor : geminiApiExecutor;

                // RPM throttle: every provider call below is funnelled through one
                // shared token bucket so the parallel agent fan-out can't exceed the
                // configured requests/min (with a reactive rest on detected 429s).
                // `sched` is a pure pass-through when the limiter is disabled.
                worldModelRateLimiter.configure({ enabled: worldModelRpmEnabled, rpm: worldModelRpm });
                const sched = <T,>(fn: () => Promise<T>): Promise<T> =>
                    worldModelRateLimiter.schedule(fn, signal);

                const hybridApiExecutor: AgentApiExecutor = {
                    getCharacterUpdate: (p, a, pr) => sched(() => pickExecutor().getCharacterUpdate(p, cloneForHardOverride(a), pr)),
                    getSkipDecision: (p, a, pr) => sched(() => pickExecutor().getSkipDecision(p, cloneForHardOverride(a), pr)),
                    getSwitchDecision: (p, a, pr) => sched(() => pickExecutor().getSwitchDecision(p, cloneForHardOverride(a), pr)),
                    getSpyPreset: (p, a, pr) => sched(() => pickExecutor().getSpyPreset(p, cloneForHardOverride(a), pr)),
                    getSpyMorph: (p, a, pr) => sched(() => pickExecutor().getSpyMorph(p, cloneForHardOverride(a), pr)),
                    getSpyMorphWithSkip: (p, a, pr) => sched(() => pickExecutor().getSpyMorphWithSkip(p, cloneForHardOverride(a), pr)),
                    getDefaultResponse: (p, a, pr) => sched(() => pickExecutor().getDefaultResponse(p, cloneForHardOverride(a), pr)),
                    getUniverseDetection: (p, a, pr) => sched(() => pickExecutor().getUniverseDetection(p, cloneForHardOverride(a), pr)),
                    getStoryBibleFragment: (p, a, pr) => sched(() => pickExecutor().getStoryBibleFragment(p, cloneForHardOverride(a), pr)),
                    getWorldSnapshotUpdate: (p, a, pr) => sched(() => pickExecutor().getWorldSnapshotUpdate(p, cloneForHardOverride(a), pr)),
                    getCharacterCandidate: (p, a, pr) => sched(() => pickExecutor().getCharacterCandidate(p, cloneForHardOverride(a), pr)),
                    getTurnRouting: (p, a, pr) => sched(() => pickExecutor().getTurnRouting(p, cloneForHardOverride(a), pr)),
                    getInnerStateUpdate: (p, a, pr) => sched(() => pickExecutor().getInnerStateUpdate(p, cloneForHardOverride(a), pr)),
                    getDriftDirective: (p, a, pr) => sched(() => pickExecutor().getDriftDirective(p, cloneForHardOverride(a), pr)),
                    getPostCheck: (p, a, pr) => sched(() => pickExecutor().getPostCheck(p, cloneForHardOverride(a), pr)),
                    getPlotProgress: (p, a, pr) => sched(() => pickExecutor().getPlotProgress(p, cloneForHardOverride(a), pr)),
                    runSubGraph: (params, tempAgents, parentResults, depth) => {
                        return executeHeavyMode({
                            ...params,
                            storyHistory: [],
                            playerChoice: parentResults.map(r => cleanModelOutputForPrompt(r.text)).join('\n'),
                            agentSettings: tempAgents,
                            updateStatus: (status, data) => params.updateStatus(`  - Sub-agent: ${status}`, data),
                        }, hybridApiExecutor, depth);
                    },
                };

                // Walk parent chain to find the most recent worldSnapshot.
                const findLastSnapshot = (tree: ChatTree | null | undefined, fromNodeId: string): WorldSnapshot | null => {
                    if (!tree) return null;
                    let current = tree.nodes[fromNodeId];
                    while (current?.parentId) {
                        const parent = tree.nodes[current.parentId];
                        if (parent?.content?.worldSnapshot) return parent.content.worldSnapshot;
                        current = parent;
                    }
                    return null;
                };
                const previousWorldSnapshot = findLastSnapshot(state.game.chatTree, targetNodeId);

                // Position encoding — turnNumber counts model turns we've completed.
                // plotPhase prefers the PlotTracker's content-derived phase from the previous
                // snapshot; the turn-count heuristic is only a fallback for turn 1 / before the
                // tracker has run.
                const completedModelTurns = requestHistory.filter(t => !t.isPlayer && t.text && t.text.trim().length > 0).length;
                const turnNumber = completedModelTurns + 1;
                const plotPhase = previousWorldSnapshot?.plotProgress?.phase ?? inferPlotPhase(turnNumber);

                const baseParams: HeavyModeParams = {
                    storyHistory: requestHistory,
                    playerNotes,
                    character: characterWithPersona,
                    historyContextTurns: requestHistoryContextTurns,
                    playerChoice,
                    agentSettings,
                    updateStatus,
                    logContext,
                    includeAllAgentResponsesInContext,
                    keepNonExistentAgentResponses,
                    trackedCharacters,
                    signal,
                    ignoreImages,
                    providerSettings: apiProvider === 'proxy' ? proxySettings : geminiSettings,
                    cacheSessionId: `rwe:${currentChatId ?? characterWithPersona.id}`,
                    perCharacterStates,
                    agentCache: worldModelAgentCache,
                    turnNumber,
                    plotPhase,
                };

                let currentBible: StoryBible | null = stripPlayerFromBible(storyBible, characterWithPersona.playerName);

                // Phase 0: Setup — runs once per chat, on the first generation.
                // Only fires if the active preset actually has setup agents enabled.
                const hasEnabledSetupAgents = agentSettings.some(a =>
                    a.phase === 'setup' && a.enabled !== false
                );
                if (!currentBible && !isContinuing && hasEnabledSetupAgents) {
                    updateStatus('Setup: Building Story Bible…');
                    const setupResult = await executeHeavyMode({
                        ...baseParams,
                        previousWorldSnapshot: null,
                        storyBible: null,
                        phasesToRun: ['setup'],
                    }, hybridApiExecutor);

                    const gotAnything =
                        setupResult.storyBibleFragments.length > 0 ||
                        !!setupResult.universeDetection;

                    if (gotAnything) {
                        const fragmentMap: Partial<StoryBible> = {};
                        for (const f of setupResult.storyBibleFragments) {
                            (fragmentMap as any)[f.field] = f.value;
                        }
                        currentBible = {
                            universe: setupResult.universeDetection ?? { isKnown: false },
                            plot: (fragmentMap as any).plot ?? { intro: '', conflict: '', climax: '', epilogue: '', themes: [] },
                            lore: (fragmentMap as any).lore ?? { rules: [], keyFacts: [] },
                            charactersRoster: (fragmentMap as any).charactersRoster ?? [],
                            locations: (fragmentMap as any).locations ?? [],
                            createdAt: Date.now(),
                            lastEdited: Date.now(),
                        };
                        currentBible = stripPlayerFromBible(currentBible, characterWithPersona.playerName);
                        dispatch(setStoryBible(currentBible));
                    }
                    // If everything failed — leave bible as null. GM still works on null bible.
                }

                // Phase 1+: Turn — pre-turn (curator) → per-actor (candidates) → synthesis (GM).
                // When continuing, skip everything except synthesis.
                //
                // Skip-cache: very short / trivial player inputs ("ok", "продолжай") almost never
                // change the world snapshot or warrant fresh per-character candidates. Bypass the
                // heavy phases on those turns; GM still runs with the previous snapshot + bible.
                const trivialInputRegex = /^(ok|okay|k|yes|yep|no|nope|sure|hmm|continue|next|продолжай|давай|ага|угу|да|нет)\W*$/i;
                const trimmedChoice = playerChoice.trim();
                const trivialInput =
                    !isContinuing &&
                    !!currentBible &&
                    !!previousWorldSnapshot &&
                    (trimmedChoice.length <= 5 || trivialInputRegex.test(trimmedChoice));
                const turnPhases: AgentPhase[] = (isContinuing || trivialInput)
                    ? ['synthesis']
                    : ['pre-turn', 'per-actor', 'synthesis'];
                if (trivialInput) {
                    dispatch(addLog({ message: 'Skip-cache: trivial input, skipping curator/candidates.' }));
                }

                // MoE routing pass — runs an enabled routing agent (if any) to decide which heavy
                // phases/agents to skip this turn. Synthesis is never skippable.
                let routingDecision: TurnRoutingDecision | null = null;
                const enabledRoutingAgent = agentSettings.find(a => a.phase === 'routing' && a.enabled !== false);
                if (enabledRoutingAgent && !isContinuing && !trivialInput) {
                    updateStatus('Routing: deciding which experts to activate…');
                    try {
                        const routingResult = await executeHeavyMode({
                            ...baseParams,
                            previousWorldSnapshot,
                            storyBible: currentBible,
                            phasesToRun: ['routing'],
                        }, hybridApiExecutor);
                        routingDecision = routingResult.turnRouting;
                        if (routingDecision) {
                            dispatch(addLog({
                                message: `Router: skipPhases=[${routingDecision.skipPhases.join(',')}] skipAgents=[${routingDecision.skipAgentIds.join(',')}]`,
                                data: routingDecision,
                            }));
                        }
                    } catch (e) {
                        console.warn('Routing failed, falling back to full pipeline.', e);
                    }
                }

                let effectiveTurnPhases = turnPhases;
                let effectiveAgentSettings = agentSettings;
                if (routingDecision) {
                    if (routingDecision.skipPhases.length > 0) {
                        effectiveTurnPhases = turnPhases.filter(p => !routingDecision!.skipPhases.includes(p));
                    }
                    if (routingDecision.skipAgentIds.length > 0) {
                        const skipSet = new Set(routingDecision.skipAgentIds);
                        effectiveAgentSettings = agentSettings.map(a =>
                            skipSet.has(a.id) ? { ...a, enabled: false } : a
                        );
                    }
                }

                // Bible Reconciler cadence gate — this agent rewrites the roster, so keep it off
                // most turns. Run it only every 4th model turn, OR when a character is on-scene
                // that the bible's roster doesn't yet know about (a freshly-introduced NPC).
                // Disabling it here is bypassed by filterDisabledAgents (its connections re-route).
                const RECONCILER_ID = 'world-bible-reconciler';
                const rosterIds = new Set((currentBible?.charactersRoster ?? []).map(c => c.id));
                const sceneCharIds = previousWorldSnapshot?.charactersInScene ?? [];
                const hasUnknownCharacter = sceneCharIds.some(id => !rosterIds.has(id));
                const runReconciler = !!currentBible && !isContinuing && !trivialInput
                    && (turnNumber % 4 === 0 || hasUnknownCharacter);
                if (!runReconciler) {
                    effectiveAgentSettings = effectiveAgentSettings.map(a =>
                        a.id === RECONCILER_ID ? { ...a, enabled: false } : a
                    );
                } else {
                    dispatch(addLog({ message: `Bible Reconciler: running (turn ${turnNumber}${hasUnknownCharacter ? ', new character on scene' : ''}).` }));
                }

                // Streaming wiring — the final GM streams chunks; we accumulate and push them
                // into the chat tree in real time so the user sees text appear.
                const baseTextForStream = isContinuing
                    ? joinContinuationBase(state.game.chatTree?.nodes[targetNodeId]?.content.text || '')
                    : '';
                let streamedAccumulator = baseTextForStream;
                const onFinalChunk = (chunk: string) => {
                    streamedAccumulator += chunk;
                    queueStreamTextUpdate(streamedAccumulator);
                };

                let turnResult = await executeHeavyMode({
                    ...baseParams,
                    agentSettings: effectiveAgentSettings,
                    previousWorldSnapshot,
                    storyBible: currentBible,
                    phasesToRun: effectiveTurnPhases,
                    onFinalChunk,
                }, hybridApiExecutor);

                // Forward + Backward pass — run post-output checkers and optionally re-generate
                // the synthesis once if any of them flag the response as needing correction.
                const hasPostOutputAgents = effectiveAgentSettings.some(a => a.phase === 'post-output' && a.enabled !== false);
                if (hasPostOutputAgents && !isContinuing && effectiveTurnPhases.includes('synthesis')) {
                    updateStatus('Post-output: auditing GM response…');
                    try {
                        const postResult = await executeHeavyMode({
                            ...baseParams,
                            agentSettings: effectiveAgentSettings,
                            previousWorldSnapshot,
                            storyBible: currentBible,
                            phasesToRun: ['post-output'],
                            // What the post-check audits must be what the player will see.
                            // `finalResponse` still carries the GM's <think> block (the
                            // streaming assembler builds it into the text), and quoting raw
                            // reasoning into a [GM OUTPUT TO CHECK] block both costs tokens
                            // and gives the auditor a scratchpad to flag instead of prose.
                            previousResponse: cleanGmOutputForQuoting(turnResult.finalResponse),
                        }, hybridApiExecutor);

                        const failingChecks = postResult.postChecks.filter(c => c.needsRegen);
                        turnResult = {
                            ...turnResult,
                            agentResponses: [...turnResult.agentResponses, ...postResult.agentResponses],
                            postChecks: postResult.postChecks,
                        };
                        if (failingChecks.length > 0) {
                            const auditDetails = failingChecks
                                .map(c => `[${c.agentName}] ${c.reason ?? ''} → ${c.correction ?? ''}`)
                                .join('\n');
                            dispatch(addLog({
                                message: `Post-check FAIL (${failingChecks.length}). Original response kept; regeneration is manual.`,
                                data: auditDetails,
                            }));
                            updateStatus('Post-check found issues; use Regenerate to retry manually.');
                            dispatch(showToast({
                                message: 'Post-check found issues. The response was kept; use Regenerate if you want another request.',
                                type: 'info',
                            }));
                        } else {
                            dispatch(addLog({ message: 'Post-check OK.' }));
                        }
                    } catch (e) {
                        console.warn('Post-output pass failed, accepting original GM output.', e);
                    }
                }

                const combinedResponse = isContinuing
                    ? (baseTextForStream + turnResult.finalResponse)
                    : turnResult.finalResponse;
                let resolvedSnapshot = turnResult.worldSnapshot ?? previousWorldSnapshot ?? undefined;
                // Fold the PlotTracker's output (or carry the previous one forward) onto the
                // snapshot we persist, so plotProgress rides with the scene state per-node.
                const resolvedPlotProgress = turnResult.plotProgress ?? previousWorldSnapshot?.plotProgress;
                if (resolvedSnapshot && resolvedPlotProgress) {
                    resolvedSnapshot = { ...resolvedSnapshot, plotProgress: resolvedPlotProgress };
                }

                // Final write — agentResponses + worldSnapshot land here; text was already
                // accumulated via streaming but we set it once more to guarantee consistency
                // (text === turnResult.finalResponse regardless of whether streaming fired).
                flushStreamNow();
                dispatch(updateNode({
                    nodeId: targetNodeId,
                    content: {
                        text: combinedResponse,
                        agentResponses: turnResult.agentResponses,
                        worldSnapshot: resolvedSnapshot,
                    },
                }));

                if (turnResult.characterUpdates?.length) {
                    const latestState = getState() as RootState;
                    const mergedCharacters = mergeCharacterUpdates(latestState.game.trackedCharacters, turnResult.characterUpdates, dispatch);
                    dispatch(setTrackedCharacters(mergedCharacters));
                }

                let finalPerCharacterStates = perCharacterStates;
                if (turnResult.perCharacterStateUpdates.length > 0) {
                    const merged: Record<string, typeof turnResult.perCharacterStateUpdates[0]> = { ...perCharacterStates };
                    for (const upd of turnResult.perCharacterStateUpdates) {
                        merged[upd.characterId] = { ...merged[upd.characterId], ...upd };
                    }
                    finalPerCharacterStates = merged;
                    dispatch(setPerCharacterStates(merged));
                }

                // Apply any mid-story Story Bible fragments from the Reconciler so the roster
                // grows with the narrative. currentBible is reassigned, then persisted per-node
                // (and as the global bible) by setWorldModelStateForNode below.
                if (currentBible && turnResult.storyBibleFragments.length > 0) {
                    let mergedBible: StoryBible = currentBible;
                    for (const frag of turnResult.storyBibleFragments) {
                        mergedBible = mergeBibleFragment(mergedBible, frag);
                    }
                    if (mergedBible !== currentBible) {
                        // Re-strip the player in case the reconciler re-introduced them.
                        currentBible = stripPlayerFromBible({ ...mergedBible, lastEdited: Date.now() }, characterWithPersona.playerName);
                        dispatch(addLog({ message: `Bible updated: roster now ${currentBible!.charactersRoster.length} characters.` }));
                    }
                }

                dispatch(setWorldModelStateForNode({
                    nodeId: targetNodeId,
                    state: {
                        storyBible: currentBible,
                        perCharacterStates: finalPerCharacterStates,
                    },
                }));

            } else {
                dispatch(setLoadingStatus(isContinuing ? 'Finishing response...' : 'Generating response...'));
                const lastModelTurn = [...requestHistory].reverse().find(t => !t.isPlayer);
                dispatch(addLog({
                    message: 'Light mode context guard',
                    data: {
                        isWorldModelEnabled: false,
                        requestedIncludeAgentResponses: includeAllAgentResponsesInContext,
                        sentIncludeAgentResponses: false,
                        lastModelTurnHadAgentResponses: !!lastModelTurn?.agentResponses?.length,
                        storyBiblePresentInRedux: !!state.game.storyBible,
                        perCharacterStateCount: Object.keys(state.game.perCharacterStates ?? {}).length,
                        note: 'World Model artifacts are not appended to the light-mode prompt.',
                    },
                }));

                // Manually-toggled scenarios (experimental): composed once here and
                // injected before history as semi-stable cacheable context.
                // Read from the characters slice (live, editable in the Scenarios
                // modal) — ui.selectedCharacter is a snapshot and can lag behind.
                const liveScenarioSource = state.characters.characters
                    .find(c => c.id === selectedCharacter?.id) ?? selectedCharacter;
                const manualScenarios = composeManualScenarios(
                    liveScenarioSource?.manualScenarios,
                    state.game.activeManualScenarioIds
                );

                let stream;
                if (apiProvider === 'proxy') {
                    stream = await getGameTurnStreamProxy(
                        requestHistory,
                        playerNotes,
                        characterWithPersona,
                        requestHistoryContextTurns,
                        false,
                        trackedCharacters,
                        proxySettings,
                        logContext,
                        signal,
                        avatarContext,
                        ignoreImages,
                        manualScenarios,
                        postHistoryInstruction,
                        `rwe:${currentChatId ?? characterWithPersona.id}`
                    );
                } else {
                    stream = await getGameTurnStream(requestHistory, playerNotes, characterWithPersona, requestHistoryContextTurns, false, trackedCharacters, geminiSettings, logContext, signal, avatarContext, ignoreImages, manualScenarios, postHistoryInstruction);
                }

                const startingText = isContinuing ? joinContinuationBase(state.game.chatTree?.nodes[targetNodeId]?.content.text || '') : '';
                let fullScene = startingText;
                
                const abortPromise = new Promise<never>((_, reject) => {
                    if (signal?.aborted) {
                        reject(new Error('Aborted by user.'));
                    }
                    signal?.addEventListener('abort', () => {
                        reject(new Error('Aborted by user.'));
                    });
                });

                const asyncIterable = {
                    [Symbol.asyncIterator]() {
                        const iterator = stream[Symbol.asyncIterator]();
                        return {
                            async next() {
                                return Promise.race([iterator.next(), abortPromise]);
                            },
                            async return() {
                                if (iterator.return) {
                                    return iterator.return();
                                }
                                return { done: true, value: undefined };
                            },
                            async throw(e: any) {
                                if (iterator.throw) {
                                    return iterator.throw(e);
                                }
                                throw e;
                            }
                        };
                    }
                };

                // The Continue cue is deliberately short, so the model often answers with
                // a fresh sentence rather than finishing the interrupted word. Decide the
                // join once the first chunk is actually in hand — joinContinuationBase runs
                // before the response exists and can only see one side of the seam.
                let awaitingFirstChunk = isContinuing;
                for await (const chunk of asyncIterable) {
                    if (awaitingFirstChunk && chunk) {
                        fullScene += continuationJoinSeparator(fullScene, chunk);
                        awaitingFirstChunk = false;
                    }
                    fullScene += chunk;
                    queueStreamTextUpdate(fullScene);
                }
                flushStreamNow();
                
                if (signal?.aborted) throw new Error('Aborted by user.');
            }
        } catch (e) {
            flushStreamNow();
            const isAbort = (e instanceof Error && e.name === 'AbortError') || (e instanceof Error && e.message === 'Aborted by user.') || (signal?.aborted);
            if (isAbort) {
                console.log("Generation caught abort. signal.aborted:", signal?.aborted);
                const currentState = getState() as RootState;
                const node = currentState.game.chatTree?.nodes[targetNodeId];
                if (!isContinuing && node && (!node.content.text || node.content.text.trim().length < 5)) {
                    dispatch(deleteTurn(targetNodeId));
                    dispatch(showToast({ message: 'Generation cancelled.', type: 'info' }));
                } else {
                    dispatch(showToast({ message: 'Generation stopped.', type: 'info' }));
                }
            } else {
                console.error(e);
                const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
                dispatch(setError(errorMessage));
                dispatch(showToast({ message: `Generation failed: ${errorMessage}`, type: 'error' }));

                const currentState = getState() as RootState;
                const node = currentState.game.chatTree?.nodes[targetNodeId];
                if (!isContinuing && node && apiProvider === 'gemini') {
                    const currentText = node.content.text ?? '';
                    if (currentText.length === 0) {
                        dispatch(deleteTurn(targetNodeId));
                    } else if (deleteUnfinishedGeminiSentencesOnError) {
                        const trimmedText = trimUnfinishedTrailingSentence(currentText);
                        if (trimmedText.length === 0) {
                            dispatch(deleteTurn(targetNodeId));
                        } else if (trimmedText !== currentText) {
                            dispatch(updateNode({
                                nodeId: targetNodeId,
                                content: { text: trimmedText },
                            }));
                        }
                    }
                } else if (isContinuing) {
                    // Keep existing text if it was continuing.
                } else if (node && (!node.content.text || node.content.text.trim().length === 0 || node.content.text.includes('[Error:'))) {
                    dispatch(deleteTurn(targetNodeId));
                } else {
                    dispatch(deleteTurn(targetNodeId));
                }
            }
        } finally {
            flushStreamNow();
            const cacheReport = usageTracker.summary();
            if (cacheReport.calls > 0 || cacheReport.callsWithoutUsage > 0) {
                dispatch(addLog({
                    message: `Prompt cache: ${formatUsageSummary(cacheReport)}`,
                    data: {
                        ...cacheReport,
                        entries: cacheReport.entries.map(e => ({
                            label: e.label,
                            model: e.model,
                            prompt: e.usage.promptTokens,
                            cacheRead: e.usage.cacheReadTokens,
                            cacheWrite: e.usage.cacheWriteTokens,
                            uncached: e.usage.uncachedTokens,
                            completion: e.usage.completionTokens,
                        })),
                    },
                }));
            }
            dispatch(autoSaveGame());
            dispatch(setLoading(false));
            dispatch(setLoadingStatus(''));
            dispatch(setStreamingNodeId(null));
        }
    }
);
