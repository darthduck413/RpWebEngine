
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Header from './Header';
import StoryPanel from './StoryPanel';
import ChoiceList from './ChoiceList';
import LogViewerModal from './LogViewerModal';
import WorldInfoModal from './WorldInfoModal';
import ManualScenariosModal from './ManualScenariosModal';
import { selectActiveWorldInfo, DEFAULT_SCAN_DEPTH } from '../services/common/worldInfo';
import EditorModal from './EditorModal';
import AgentSettingsModal from './AgentSettingsModal';
import SettingsModal from './SettingsModal';
import CharacterTrackerModal from './CharacterTrackerModal';
import APISettingsModal from './APISettingsModal';
import GenerationSettingsModal from './GenerationSettingsModal';
import WorldStatePanel from './WorldStatePanel';
import StoryBibleModal from './StoryBibleModal';
import CharacterChatsModal from './CharacterChatsModal';

import { useAppSelector, useAppDispatch } from '../store/hooks';
import {
    submitPlayerTurn,
    autoSaveGame,
    loadGameFromStorage,
    summarizeResponse,
    generateSmartPlayerNotes,
    regenerateLastTurn,
    continueLastTurn,
    startNewGame,
    loadGameSession,
} from '../store/thunks/gameThunks';
import {
    deleteTurn,
    updateTurn,
    toggleTurnExpansion,
    setTrackedCharacters,
    setUserPersonaDetails,
    setLoading,
    setStoryBible,
    clearStoryBible,
    setLockedFirstMessageIndex,
    setBaseCharacterSetting,
    setBaseCharacterScenario,
    toggleManualScenario,
    setActiveManualScenarioIds,
    resetGame
} from '../store/slices/gameSlice';
import {
    setModalVisibility,
    setSelectedCharacter,
    showToast,
} from '../store/slices/uiSlice';
import { updateCharacter } from '../store/slices/charactersSlice';
import {
    setTheme,
    setWorldModelEnabled,
    setAgentSettings,
    setPlayerNotes,
    setPostHistoryInstruction,
    setSystemInstruction,
    setCharacterSetting,
    setCharacterScenario,
    setCharacterPersonality,
    setGameSettings,
    setApiSettings,
    setWorldModelRateLimit
} from '../store/slices/settingsSlice';
import { 
    clearLogs,
    addLog
} from '../store/slices/logSlice';
import { analyzeCharacters } from '../store/thunks/analysisThunks';

import { Character, GeminiSettings, LoreEntry, ManualScenario, ProxySettings } from '../types';
import { ArrowLeftIcon } from './icons/ArrowLeftIcon';
import { DEFAULT_PERSONA_AVATAR } from '../constants';
import {
  customPromptOrDefault,
} from '../services/common/systemPrompt';
import {
  applyProviderCustomPromptToSystemInstruction,
  buildEffectiveSystemInstructionPayload,
} from '../services/common/effectiveSystemInstruction';

interface ChatPageProps {
  character: Character;
  onExit: () => void;
}

const ChatPage: React.FC<ChatPageProps> = ({ character, onExit }) => {
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [playerInput, setPlayerInput] = useState('');
  const [isAnalyzingContext, setIsAnalyzingContext] = useState(false);
  const [isPersonaEditorOpen, setIsPersonaEditorOpen] = useState(false);
  const [isStoryBibleOpen, setIsStoryBibleOpen] = useState(false);
  const [isChatsModalOpen, setIsChatsModalOpen] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const game = useAppSelector(state => state.game);
  const settings = useAppSelector(state => state.settings);
  const modals = useAppSelector(state => state.ui.modals);
  const logs = useAppSelector(state => state.logs.logs);
  const currentChatId = useAppSelector(state => state.ui.currentChatId);

  // Live character record from the characters slice (the `character` prop is a
  // snapshot in ui.selectedCharacter and can go stale when scenarios are edited).
  const liveCharacter = useAppSelector(state =>
    state.characters.characters.find(c => c.id === character.id)
  ) ?? character;
  const manualScenarios = liveCharacter.manualScenarios ?? [];

  // Persist a scenario-list change: update the characters store (persisted by
  // middleware), refresh the ui snapshot so prompts/thunks see it immediately,
  // and drop active ids that no longer resolve to a scenario.
  const handleChangeManualScenarios = (next: ManualScenario[]) => {
    const updated = { ...liveCharacter, manualScenarios: next, lastModified: Date.now() };
    dispatch(updateCharacter(updated));
    dispatch(setSelectedCharacter(updated));
    const validIds = new Set(next.map(s => s.id));
    if (game.activeManualScenarioIds.some(id => !validIds.has(id))) {
      dispatch(setActiveManualScenarioIds(game.activeManualScenarioIds.filter(id => validIds.has(id))));
      persistCurrentGame();
    }
  };

  const activePersona = game.userPersonaDetails;
  const themeColor = settings.theme === 'yellow' ? 'amber' : settings.theme;
  const streamingNodeText = game.streamingNodeId && game.chatTree
    ? game.chatTree.nodes[game.streamingNodeId]?.content.text ?? ''
    : '';
  const hasStreamingOutput = streamingNodeText.trim().length > 0;

  // Live view of the keyword World Info that would be injected next turn —
  // same selector the prompt builder uses, fed the current branch + draft input,
  // so the viewer can never drift from what's actually sent. Only computed while
  // the World Info modal is open: it scans the whole lore book against the full
  // history and the draft input, so running it on every keystroke/token was a
  // needless cost in long chats.
  const activeWorldInfo = useMemo(
    () => (modals.isWorldInfoVisible
      ? selectActiveWorldInfo(
          character.loreBook,
          game.storyHistory,
          playerInput,
          [
            settings.characterPersonality ?? character.personality,
            settings.characterSetting ?? character.setting,
            settings.characterScenario ?? character.scenario ?? '',
          ],
          DEFAULT_SCAN_DEPTH,
        )
      : []),
    [
      modals.isWorldInfoVisible,
      character,
      game.storyHistory,
      playerInput,
      settings.characterPersonality,
      settings.characterSetting,
      settings.characterScenario,
    ],
  );

  const apiProviderLabel = (() => {
    if (settings.apiProvider !== 'proxy') {
        const gm = settings.geminiSettings;
        const match = settings.geminiPresets?.find(p =>
                p.id === gm?.presetId ||
                (
                    p.model === gm?.model &&
                    p.apiKeyId === gm?.apiKeyId &&
                    customPromptOrDefault(p.customPrompt) === customPromptOrDefault(gm?.customPrompt)
                )
        );
        return match?.name || gm?.apiKeyName || 'gemini';
    }
    const px = settings.proxySettings;
    const match = settings.proxyPresets?.find(p =>
        p.model === px?.model &&
        p.proxyUrl === px?.proxyUrl &&
        p.apiKey === px?.apiKey &&
        (p.extraParams || '') === (px?.extraParams || '') &&
        customPromptOrDefault(p.customPrompt) === customPromptOrDefault(px?.customPrompt)
    );
    return match?.name || 'proxy';
  })();

  const playerName = activePersona?.name || character.playerName;
  const playerDescription = activePersona?.description || character.playerDescription;
  const characterSetting = settings.characterSetting ?? character.setting ?? '';
  const characterScenario = settings.characterScenario ?? character.scenario ?? '';
  const characterPersonality = settings.characterPersonality || character.personality || '';
  const baseSystemInstruction = settings.systemInstruction || character.systemInstructionTemplate;
  // Resolved system prompt shown in the System Prompt editor. It composes World
  // Info over the entire history, so only build it while that modal is open —
  // otherwise it re-ran on every keystroke and every streaming token.
  const effectiveSystemInstruction = useMemo(
    () => (modals.isSystemModalVisible
      ? buildEffectiveSystemInstructionPayload({
          instructionTemplate: baseSystemInstruction,
          provider: settings.apiProvider,
          proxySettings: settings.proxySettings,
          geminiSettings: settings.geminiSettings,
          character,
          characterSetting,
          characterScenario,
          characterPersonality,
          playerDescription,
          playerName,
          storyHistory: game.storyHistory,
          playerChoice: playerInput,
        })
      : ''),
    [
      modals.isSystemModalVisible,
      baseSystemInstruction,
      settings.apiProvider,
      settings.proxySettings,
      settings.geminiSettings,
      settings.playerNotes,
      character,
      characterSetting,
      characterScenario,
      characterPersonality,
      playerDescription,
      playerName,
      game.storyHistory,
      playerInput,
    ],
  );

  useEffect(() => {
    if (settings.autosaveInterval > 0) {
        const intervalId = setInterval(() => {
            dispatch(autoSaveGame());
        }, settings.autosaveInterval * 60 * 1000);
        return () => clearInterval(intervalId);
    }
  }, [settings.autosaveInterval, dispatch]);

  useEffect(() => {
      return () => {
          if (abortControllerRef.current) {
              abortControllerRef.current.abort();
          }
      };
  }, []);

  // Lore book reconciler. For characters with loreBook + firstMessages[].loreIds:
  // - while chat has no user reply, characterPersonality / characterScenario /
  //   characterSetting follow the currently selected first-message branch.
  //   character-type entries land in personality, scenario-type in scenario,
  //   setting-type in setting;
  // - on the first user reply, lock the current branch and freeze all three fields;
  // - if the chat becomes empty again (all replies deleted), unlock and resume
  //   dynamic selection. Toasts fire on real transitions, never on first mount.
  const didInitLoreRef = useRef(false);
  useEffect(() => {
    if (!character.loreBook) return;
    if (!game.chatTree) return;

    const root = game.chatTree.nodes[game.chatTree.rootNodeId];
    if (!root) return;

    const currentRootIdx = root.selectedChildIndex ?? 0;
    const hasAnyUserReply = Object.values(game.chatTree.nodes).some(n => n.content.isPlayer);
    const isLocked = game.lockedFirstMessageIndex !== null;
    const isInitial = !didInitLoreRef.current;
    didInitLoreRef.current = true;

    // Bases for each composable field. These MUST be stable across renders:
    // the effect writes settings.characterScenario / settings.characterSetting,
    // so falling back to those would feed the composed output back in as the
    // base and append lore on every render (infinite re-render loop). Fall back
    // to the character's own immutable base instead.
    const baseSetting = game.baseCharacterSetting ?? character.setting ?? '';
    const baseScenario = game.baseCharacterScenario ?? character.scenario ?? '';

    const composeFor = (idx: number): { personality: string; scenario: string; setting: string } => {
      const ids = character.firstMessages?.[idx]?.loreIds ?? [];
      const entries: LoreEntry[] = ids
        .map(id => character.loreBook?.find(e => e.id === id))
        .filter((e): e is LoreEntry => !!e && e.disabled !== true);
      const charEntries = entries.filter(e => e.type === 'character');
      const scenarioEntries = entries.filter(e => e.type === 'scenario');
      const settingEntries = entries.filter(e => e.type === 'setting');

      const personalityBase = character.personality ? character.personality + '\n\n' : '';
      const personality = (personalityBase + charEntries.map(e => e.content).join('\n\n')).trimEnd();

      const scenarioBase = baseScenario ? baseScenario + '\n\n' : '';
      const scenario = (scenarioBase + scenarioEntries.map(e => e.content).join('\n\n')).trimEnd();

      const settingBase = baseSetting ? baseSetting + '\n\n' : '';
      const setting = (settingBase + settingEntries.map(e => e.content).join('\n\n')).trimEnd();

      return { personality, scenario, setting };
    };

    const applyComposition = (idx: number) => {
      const { personality, scenario, setting } = composeFor(idx);
      if (personality !== settings.characterPersonality) {
        dispatch(setCharacterPersonality(personality));
      }
      if (scenario !== (settings.characterScenario ?? '')) {
        dispatch(setCharacterScenario(scenario));
      }
      if (setting !== settings.characterSetting) {
        dispatch(setCharacterSetting(setting));
      }
    };

    if (hasAnyUserReply && !isLocked) {
      dispatch(setLockedFirstMessageIndex(currentRootIdx));
      if (!isInitial) {
        dispatch(showToast({ message: 'Lore book locked', type: 'info' }));
      }
    } else if (!hasAnyUserReply && isLocked) {
      dispatch(setLockedFirstMessageIndex(null));
      if (!isInitial) {
        dispatch(showToast({ message: 'Lore book unlocked', type: 'info' }));
      }
      applyComposition(currentRootIdx);
    } else if (!hasAnyUserReply && !isLocked) {
      applyComposition(currentRootIdx);
    }
    // (hasAnyUserReply && isLocked) → no-op, all three fields stay frozen
  }, [
    game.chatTree,
    game.lockedFirstMessageIndex,
    game.baseCharacterSetting,
    game.baseCharacterScenario,
    character,
    settings.characterPersonality,
    settings.characterScenario,
    settings.characterSetting,
    dispatch,
  ]);

  const persistCurrentGame = () => {
    void dispatch(autoSaveGame());
  };

  // Stable handlers for the transcript. StoryPanel/Message are memoized, so these
  // must keep their identity across unrelated re-renders (e.g. typing in the
  // composer) or every message would re-render on each keystroke. Latest player
  // notes are read via a ref so onCopyToNotes stays stable while still appending
  // to current notes.
  const playerNotesRef = useRef(settings.playerNotes);
  playerNotesRef.current = settings.playerNotes;

  const handleDeleteTurn = useCallback((id: string) => {
    dispatch(deleteTurn(id));
    void dispatch(autoSaveGame());
  }, [dispatch]);

  const handleEditTurn = useCallback((id: string, text: string) => {
    dispatch(updateTurn({ id, text }));
    void dispatch(autoSaveGame());
  }, [dispatch]);

  const handleToggleResponses = useCallback((id: string) => {
    dispatch(toggleTurnExpansion(id));
    void dispatch(autoSaveGame());
  }, [dispatch]);

  const handleCopyToNotes = useCallback((agent: string, text: string) => {
    dispatch(setPlayerNotes(playerNotesRef.current + `\n\n--- Note from ${agent} ---\n${text}`));
    void dispatch(autoSaveGame());
  }, [dispatch]);

  const handleSummarizeToNotes = useCallback(async (agent: string, text: string) => {
    await dispatch(summarizeResponse({ agentName: agent, text }));
    void dispatch(autoSaveGame());
  }, [dispatch]);

  const buildProviderSystemInstructionTemplate = (
    provider = settings.apiProvider,
    proxySettings = settings.proxySettings,
    geminiSettings = settings.geminiSettings
  ) => applyProviderCustomPromptToSystemInstruction(
      character.systemInstructionTemplate,
      provider,
      proxySettings,
      geminiSettings
    );

  const resetSystemPromptOverrideIfNeeded = (message: string) => {
    const providerTemplate = buildProviderSystemInstructionTemplate();
    if (
      !settings.systemInstruction ||
      settings.systemInstruction === character.systemInstructionTemplate ||
      settings.systemInstruction === providerTemplate
    ) {
      return;
    }
    dispatch(setSystemInstruction(providerTemplate));
    dispatch(showToast({
      message,
      type: 'info',
    }));
  };

  const handleExit = async () => {
    await dispatch(autoSaveGame());
    onExit();
  };

  const handleSwitchChat = async (chatId: string) => {
    if (game.isLoading || chatId === currentChatId) return;
    await dispatch(autoSaveGame());
    dispatch(loadGameSession(chatId));
  };

  // Shared turn runner: aborts any in-flight turn, arms a 5-minute timeout, runs
  // the given thunk, and cleans up. Consolidates the identical AbortController +
  // timeout boilerplate that submit / regenerate / continue all need.
  const TURN_TIMEOUT_MS = 300000; // 5 minutes
  const runCancellableTurn = useCallback(async (
    makeThunk: (signal: AbortSignal) => Parameters<typeof dispatch>[0]
  ) => {
    if (game.isLoading) return;

    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timeoutId = setTimeout(() => {
        if (abortControllerRef.current === controller) {
            controller.abort(new Error('Request timed out after 5 minutes.'));
        }
    }, TURN_TIMEOUT_MS);

    try {
        await (dispatch(makeThunk(controller.signal)) as any).unwrap();
    } catch (e) {
        // Errors are surfaced by the thunk itself.
    } finally {
        clearTimeout(timeoutId);
        if (abortControllerRef.current === controller) {
            abortControllerRef.current = null;
        }
    }
  }, [dispatch, game.isLoading]);

  const handleChoice = useCallback(async (choice: string, image?: string) => {
    if (game.isLoading) return; // don't clear the draft if a turn is already running
    await runCancellableTurn(signal => submitPlayerTurn({ choice, image, signal }));
    setPlayerInput('');
  }, [runCancellableTurn, game.isLoading]);

  const handleStop = () => {
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
      }
  };

  const handleRegenerate = useCallback(
    () => runCancellableTurn(signal => regenerateLastTurn({ signal })),
    [runCancellableTurn]
  );

  const handleContinue = useCallback(
    () => runCancellableTurn(signal => continueLastTurn({ signal })),
    [runCancellableTurn]
  );

  const triggerLoadFile = () => {
    fileInputRef.current?.click();
  };

  const handleSmartNotesGeneration = async (): Promise<string | undefined> => {
    setIsAnalyzingContext(true);
    const action = await dispatch(generateSmartPlayerNotes());
    setIsAnalyzingContext(false);
    
    if (generateSmartPlayerNotes.fulfilled.match(action)) {
        return action.payload;
    }
    return undefined;
  };

  const handleSaveApiSettings = (newSettings: { 
    provider: 'gemini' | 'proxy'; 
    proxyConfig: ProxySettings;
    geminiConfig: GeminiSettings;
    replaceModels: boolean;
    historyContextTurns: number;
    includeAllAgentResponsesInContext: boolean;
    keepNonExistentAgentResponses: boolean;
    deleteUnfinishedGeminiSentencesOnError: boolean;
  }) => {
    const providerConfigChanged =
        settings.apiProvider !== newSettings.provider ||
        JSON.stringify(settings.proxySettings) !== JSON.stringify(newSettings.proxyConfig) ||
        JSON.stringify(settings.geminiSettings) !== JSON.stringify(newSettings.geminiConfig);

    dispatch(setApiSettings({
        provider: newSettings.provider,
        proxyConfig: newSettings.proxyConfig,
        geminiConfig: newSettings.geminiConfig,
        replaceModels: newSettings.replaceModels
    }));
    if (providerConfigChanged) {
        dispatch(setSystemInstruction(buildProviderSystemInstructionTemplate(
            newSettings.provider,
            newSettings.proxyConfig,
            newSettings.geminiConfig
        )));
        dispatch(showToast({
            message: 'System Prompt was rebuilt from the selected generation preset.',
            type: 'info',
        }));
    }
    dispatch(setGameSettings({
        turns: newSettings.historyContextTurns,
        interval: settings.autosaveInterval,
        intelligentAnalyzer: settings.isIntelligentPresetAnalyzerEnabled,
        includeAllAgentResponsesInContext: newSettings.includeAllAgentResponsesInContext,
        keepNonExistentAgentResponses: newSettings.keepNonExistentAgentResponses,
        sendUserAvatar: settings.sendUserAvatar,
        sendCharacterAvatar: settings.sendCharacterAvatar,
        ignoreImages: settings.ignoreImages,
        editFullMessage: settings.editFullMessage,
        deleteUnfinishedGeminiSentencesOnError: newSettings.deleteUnfinishedGeminiSentencesOnError,
        enableAnthropicCaching: settings.enableAnthropicCaching
    }));
    dispatch(setModalVisibility({ modal: 'isApiSettingsModalOpen', visible: false }));
    dispatch(setModalVisibility({ modal: 'isGenerationSettingsModalOpen', visible: false }));
    persistCurrentGame();
  };

  const handleLoadGameFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target?.result as string;
        if (text) {
            void dispatch(loadGameFromStorage(text)).then(() => dispatch(autoSaveGame()));
        }
        if (event.target) event.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleSaveGameFile = () => {
    try {
        const gameState = {
            storyHistory: game.storyHistory,
            chatTree: game.chatTree || undefined,
            playerNotes: settings.playerNotes,
            postHistoryInstruction: settings.postHistoryInstruction,
            systemInstruction: settings.systemInstruction,
            characterSetting: settings.characterSetting,
            characterPersonality: settings.characterPersonality,
            historyContextTurns: settings.historyContextTurns,
            isWorldModelEnabled: settings.isWorldModelEnabled,
            // agentSettings deliberately omitted — the World Model agent graph is
            // global config, not story data, and bloats every save (~17KB).
            theme: settings.theme,
            autosaveInterval: settings.autosaveInterval,
            isIntelligentPresetAnalyzerEnabled: settings.isIntelligentPresetAnalyzerEnabled,
            includeAllAgentResponsesInContext: settings.includeAllAgentResponsesInContext,
            keepNonExistentAgentResponses: settings.keepNonExistentAgentResponses,
            trackedCharacters: game.trackedCharacters,
            apiProvider: settings.apiProvider,
            proxySettings: settings.proxySettings,
            geminiSettings: settings.geminiSettings,
            replaceAgentModels: settings.replaceAgentModels,
            userPersonaDetails: game.userPersonaDetails,
            sendUserAvatar: settings.sendUserAvatar,
            sendCharacterAvatar: settings.sendCharacterAvatar,
            ignoreImages: settings.ignoreImages,
            editFullMessage: settings.editFullMessage,
            deleteUnfinishedGeminiSentencesOnError: settings.deleteUnfinishedGeminiSentencesOnError,
            storyBible: game.storyBible,
            perCharacterStates: game.perCharacterStates,
            worldModelStatesByNodeId: game.worldModelStatesByNodeId,
        };
        const dataStr = JSON.stringify(gameState, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `rwe-save-${character.name.replace(/\s/g, '_')}-${new Date().toISOString().split('T')[0]}.json`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Failed to save game:", error);
    }
  };

  const handleNewChat = async () => {
    await dispatch(autoSaveGame());
    dispatch(setPostHistoryInstruction(''));
    dispatch(startNewGame(character));
    dispatch(showToast({ message: 'Started new chat session with same parameters', type: 'success' }));
  };

  return (
    <div className={`bg-gray-900 h-screen text-primary-200 font-sans flex flex-col`}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleLoadGameFile}
        accept="application/json,.json"
        className="hidden"
        aria-hidden="true"
      />
      <div className="max-w-7xl mx-auto w-full flex flex-col flex-grow p-4 sm:p-6 lg:p-8 overflow-hidden">
        <div className="flex items-center gap-2 sm:gap-4">
            <button 
                onClick={handleExit}
                className={`flex-shrink-0 p-2 bg-gray-800/70 text-primary-300 rounded-full border border-gray-700 hover:bg-primary-900/50 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500`}
                aria-label="Back to Character Details"
            >
                <ArrowLeftIcon className="h-6 w-6" />
            </button>
            <div className="flex-grow min-w-0">
                <Header
                characterName={character.name}
                apiProviderLabel={apiProviderLabel}
                onOpenChatsModal={() => setIsChatsModalOpen(true)}
                onNotesToggle={() => dispatch(setModalVisibility({ modal: 'isNotesModalVisible', visible: true }))}
                onSystemToggle={() => dispatch(setModalVisibility({ modal: 'isSystemModalVisible', visible: true }))}
                onSettingToggle={() => dispatch(setModalVisibility({ modal: 'isSettingModalVisible', visible: true }))}
                onScenarioToggle={() => dispatch(setModalVisibility({ modal: 'isScenarioModalVisible', visible: true }))}
                activeManualScenarioCount={game.activeManualScenarioIds.length}
                onManualScenariosToggle={() => dispatch(setModalVisibility({ modal: 'isManualScenariosVisible', visible: true }))}
                onPersonalityToggle={() => dispatch(setModalVisibility({ modal: 'isPersonalityModalVisible', visible: true }))}
                onGameSettingsToggle={() => dispatch(setModalVisibility({ modal: 'isGameSettingsModalOpen', visible: true }))}
                onUISettingsToggle={() => dispatch(setModalVisibility({ modal: 'isUISettingsModalOpen', visible: true }))}
                onApiSettingsToggle={() => dispatch(setModalVisibility({ modal: 'isApiSettingsModalOpen', visible: true }))}
                onGenerationSettingsToggle={() => dispatch(setModalVisibility({ modal: 'isGenerationSettingsModalOpen', visible: true }))}
                onCharacterTrackerToggle={() => dispatch(setModalVisibility({ modal: 'isCharacterTrackerModalOpen', visible: true }))}
                onPersonaToggle={() => setIsPersonaEditorOpen(true)}
                isWorldModelEnabled={settings.isWorldModelEnabled}
                onWorldModelToggle={() => dispatch(setWorldModelEnabled(!settings.isWorldModelEnabled))}
                onAgentSettingsToggle={() => dispatch(setModalVisibility({ modal: 'isAgentSettingsModalOpen', visible: true }))}
                onStoryBibleToggle={() => setIsStoryBibleOpen(true)}
                storyBibleReady={!!game.storyBible}
                isLoading={game.isLoading || isAnalyzingContext}
                theme={settings.theme}
                themeColor={themeColor}
                onThemeChange={(t) => dispatch(setTheme(t))}
                onSaveGame={handleSaveGameFile}
                onLoadGame={triggerLoadFile}
                onNewChat={handleNewChat}
                />
            </div>
        </div>

        {settings.isWorldModelEnabled && (
          <WorldStatePanel
            snapshot={[...game.storyHistory].reverse().find(t => !!t.worldSnapshot)?.worldSnapshot ?? null}
            perCharacterStates={game.perCharacterStates}
          />
        )}

        <main
          className="flex-grow flex flex-col mt-4 overflow-hidden w-full mx-auto max-w-[var(--chat-max-w)]"
          style={{ '--chat-max-w': `${settings.chatMaxWidthRem}rem` } as React.CSSProperties}
        >
            <StoryPanel
                storyHistory={game.storyHistory}
                isLoading={game.isLoading || isAnalyzingContext}
                loadingStatus={isAnalyzingContext ? 'Analyzing context...' : game.loadingStatus}
                error={game.error}
                onDelete={handleDeleteTurn}
                onEdit={handleEditTurn}
                onRegenerate={handleRegenerate}
                onContinue={handleContinue}
                onToggleResponses={handleToggleResponses}
                onCopyToNotes={handleCopyToNotes}
                onSummarizeToNotes={handleSummarizeToNotes}
                playerName={playerName}
                aiName={character.name}
                characterImage={character.image}
                playerImage={activePersona?.avatar || DEFAULT_PERSONA_AVATAR}
                themeColor={themeColor}
                editFullMessage={settings.editFullMessage}
            />
            <div className="flex-shrink-0 pt-4">
                <ChoiceList 
                  value={playerInput}
                  onChange={setPlayerInput}
                  onSelect={handleChoice} 
                  onStop={handleStop}
                  isLoading={game.isLoading || isAnalyzingContext}
                  hasStreamingOutput={hasStreamingOutput}
                  isWorldModelEnabled={settings.isWorldModelEnabled}
                  showImageAttachButton={settings.showImageAttachButton}
                  themeColor={themeColor}
                />
            </div>
        </main>
      </div>
      {game.autosaveStatus && (
        <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-md shadow-lg transition-opacity duration-500 z-50 ${game.autosaveStatus.includes('failed') ? 'bg-red-900 text-red-100 border border-red-700' : 'bg-gray-800 text-white'}`}>
          {game.autosaveStatus}
        </div>
      )}

      <LogViewerModal
        logs={logs}
        isVisible={modals.isLogViewerVisible}
        onClose={() => dispatch(setModalVisibility({ modal: 'isLogViewerVisible', visible: false }))}
        onClear={() => dispatch(clearLogs())}
        themeColor={themeColor}
      />
      <WorldInfoModal
        isVisible={modals.isWorldInfoVisible}
        onClose={() => dispatch(setModalVisibility({ modal: 'isWorldInfoVisible', visible: false }))}
        active={activeWorldInfo}
        scanDepth={DEFAULT_SCAN_DEPTH}
        themeColor={themeColor}
      />
      <ManualScenariosModal
        isVisible={modals.isManualScenariosVisible}
        onClose={() => dispatch(setModalVisibility({ modal: 'isManualScenariosVisible', visible: false }))}
        characterId={character.id}
        scenarios={manualScenarios}
        activeIds={game.activeManualScenarioIds}
        onToggle={(id) => {
          dispatch(toggleManualScenario(id));
          persistCurrentGame();
        }}
        onChangeScenarios={handleChangeManualScenarios}
        onNotify={(message, type) => dispatch(showToast({ message, type }))}
        themeColor={themeColor}
      />
      <EditorModal 
        isOpen={modals.isNotesModalVisible}
        onClose={() => dispatch(setModalVisibility({ modal: 'isNotesModalVisible', visible: false }))}
        onSave={(notes) => {
          // Keep a hand-edited prompt intact. Notes are injected separately in the
          // volatile tail, so changing them does not invalidate the cached prefix.
          dispatch(setPlayerNotes(notes));
          dispatch(setModalVisibility({ modal: 'isNotesModalVisible', visible: false }));
          persistCurrentGame();
        }}
        initialContent={settings.playerNotes}
        title="Player Notes"
        helpText="Add persistent context for your character (e.g., current goals, important memories, inventory). This will be sent with every action to guide the AI."
        themeColor={themeColor}
        showSmartContext={true}
        onAnalyzeContext={handleSmartNotesGeneration}
      />
      <EditorModal 
        isOpen={modals.isSystemModalVisible}
        onClose={() => dispatch(setModalVisibility({ modal: 'isSystemModalVisible', visible: false }))}
        onSave={(instruction) => {
          dispatch(setSystemInstruction(instruction));
          dispatch(setModalVisibility({ modal: 'isSystemModalVisible', visible: false }));
          persistCurrentGame();
        }}
        initialContent={effectiveSystemInstruction}
        title="System Prompt Editor (Session)"
        helpText="Shows the resolved system instruction that will be sent now. Edits here affect the current session payload until a dedicated block or preset change rebuilds it."
        themeColor={themeColor}
      />
      <EditorModal
        isOpen={modals.isSettingModalVisible}
        onClose={() => dispatch(setModalVisibility({ modal: 'isSettingModalVisible', visible: false }))}
        onSave={(setting) => {
          resetSystemPromptOverrideIfNeeded('System Prompt manual changes were overwritten by Setting changes.');
          dispatch(setBaseCharacterSetting(setting));
          dispatch(setCharacterSetting(setting));
          dispatch(setModalVisibility({ modal: 'isSettingModalVisible', visible: false }));
          persistCurrentGame();
        }}
        initialContent={settings.characterSetting ?? character.setting}
        title="Setting Editor"
        helpText="Modify the world / location (Setting) for this specific session. Scenario lives in its own editor."
        themeColor={themeColor}
      />
      <EditorModal
        isOpen={modals.isScenarioModalVisible}
        onClose={() => dispatch(setModalVisibility({ modal: 'isScenarioModalVisible', visible: false }))}
        onSave={(scenario) => {
          resetSystemPromptOverrideIfNeeded('System Prompt manual changes were overwritten by Scenario changes.');
          dispatch(setBaseCharacterScenario(scenario));
          dispatch(setCharacterScenario(scenario));
          dispatch(setModalVisibility({ modal: 'isScenarioModalVisible', visible: false }));
          persistCurrentGame();
        }}
        initialContent={settings.characterScenario ?? character.scenario ?? ''}
        title="Scenario Editor"
        helpText="Modify the scene-specific scenario (situations, mechanics, framing) for this session. Independent from Setting."
        themeColor={themeColor}
      />
      <EditorModal
        isOpen={modals.isPersonalityModalVisible}
        onClose={() => dispatch(setModalVisibility({ modal: 'isPersonalityModalVisible', visible: false }))}
        onSave={(personality) => {
          resetSystemPromptOverrideIfNeeded('System Prompt manual changes were overwritten by Character Personality changes.');
          dispatch(setCharacterPersonality(personality));
          dispatch(setModalVisibility({ modal: 'isPersonalityModalVisible', visible: false }));
          persistCurrentGame();
        }}
        initialContent={settings.characterPersonality || character.personality}
        title="Character Personality Editor"
        helpText="Modify the character's personality and behavior for this specific session."
        themeColor={themeColor}
      />
      
      <EditorModal
        isOpen={isPersonaEditorOpen}
        onClose={() => setIsPersonaEditorOpen(false)}
        onSave={(description) => {
            resetSystemPromptOverrideIfNeeded('System Prompt manual changes were overwritten by Chat Persona changes.');
            if (activePersona) {
                dispatch(setUserPersonaDetails({ ...activePersona, description }));
            }
            setIsPersonaEditorOpen(false);
            persistCurrentGame();
        }}
        initialContent={activePersona?.description || ''}
        title={`Edit Persona: ${activePersona?.name || 'User'}`}
        helpText="This description is specific to THIS chat session. Changes here will not affect your global persona."
        themeColor={themeColor}
      />

      <SettingsModal
        isOpen={modals.isGameSettingsModalOpen}
        onClose={() => dispatch(setModalVisibility({ modal: 'isGameSettingsModalOpen', visible: false }))}
        onSave={(s) => {
            const { worldModelRpmEnabled, worldModelRpm, postHistoryInstruction, ...gameSettings } = s;
            dispatch(setPostHistoryInstruction(postHistoryInstruction));
            dispatch(setGameSettings({
                ...gameSettings,
                turns: settings.historyContextTurns,
                includeAllAgentResponsesInContext: settings.includeAllAgentResponsesInContext,
                keepNonExistentAgentResponses: settings.keepNonExistentAgentResponses,
            }));
            dispatch(setWorldModelRateLimit({ enabled: worldModelRpmEnabled, rpm: worldModelRpm }));
            dispatch(setModalVisibility({ modal: 'isGameSettingsModalOpen', visible: false }));
            persistCurrentGame();
        }}
        initialInterval={settings.autosaveInterval}
        initialIntelligentPresetAnalyzerEnabled={settings.isIntelligentPresetAnalyzerEnabled}
        initialSendUserAvatar={settings.sendUserAvatar}
        initialSendCharacterAvatar={settings.sendCharacterAvatar}
        initialIgnoreImages={settings.ignoreImages}
        initialEditFullMessage={settings.editFullMessage}
        initialPostHistoryInstruction={settings.postHistoryInstruction}
        initialDeleteUnfinishedGeminiSentencesOnError={settings.deleteUnfinishedGeminiSentencesOnError}
        initialEnableAnthropicCaching={settings.enableAnthropicCaching}
        initialWorldModelRpmEnabled={settings.worldModelRpmEnabled}
        initialWorldModelRpm={settings.worldModelRpm}
        themeColor={themeColor}
        apiProvider={settings.apiProvider}
      />

      <GenerationSettingsModal
        isOpen={modals.isGenerationSettingsModalOpen}
        onClose={() => dispatch(setModalVisibility({ modal: 'isGenerationSettingsModalOpen', visible: false }))}
        onSave={handleSaveApiSettings}
        initialProvider={settings.apiProvider}
        initialProxySettings={settings.proxySettings}
        initialProxyPresets={settings.proxyPresets}
        initialGeminiSettings={settings.geminiSettings}
        initialGeminiPresets={settings.geminiPresets}
        initialGeminiApiKeys={settings.geminiApiKeys}
        initialReplaceAgentModels={settings.replaceAgentModels}
        initialHistoryContextTurns={settings.historyContextTurns}
        initialIncludeAllAgentResponsesInContext={settings.includeAllAgentResponsesInContext}
        initialKeepNonExistentAgentResponses={settings.keepNonExistentAgentResponses}
        initialDeleteUnfinishedGeminiSentencesOnError={settings.deleteUnfinishedGeminiSentencesOnError}
        themeColor={themeColor}
        onLogViewerToggle={() => dispatch(setModalVisibility({ modal: 'isLogViewerVisible', visible: true }))}
        onWorldInfoToggle={() => dispatch(setModalVisibility({ modal: 'isWorldInfoVisible', visible: true }))}
      />

      <AgentSettingsModal
        isOpen={modals.isAgentSettingsModalOpen}
        onClose={() => dispatch(setModalVisibility({ modal: 'isAgentSettingsModalOpen', visible: false }))}
        settings={settings.agentSettings}
        onUpdateSettings={(newSettings) => {
            dispatch(setAgentSettings(newSettings));
            persistCurrentGame();
        }}
        themeColor={themeColor}
        globalProxySettings={settings.proxySettings}
      />
      <CharacterTrackerModal
        isOpen={modals.isCharacterTrackerModalOpen}
        onClose={() => dispatch(setModalVisibility({ modal: 'isCharacterTrackerModalOpen', visible: false }))}
        characters={game.trackedCharacters}
        onSave={(chars) => {
            dispatch(setTrackedCharacters(chars));
            persistCurrentGame();
        }}
        onAnalyze={async () => {
            const result = await dispatch(analyzeCharacters());
            return result.payload as boolean;
        }}
        themeColor={themeColor}
        playerName={activePersona?.name || character.playerName}
      />

      <StoryBibleModal
        isOpen={isStoryBibleOpen}
        onClose={() => setIsStoryBibleOpen(false)}
        bible={game.storyBible}
        onRebuild={() => {
            dispatch(clearStoryBible());
            persistCurrentGame();
            setIsStoryBibleOpen(false);
        }}
        onSaveEdit={(next) => {
            dispatch(setStoryBible(next));
            persistCurrentGame();
        }}
      />

      <CharacterChatsModal
        isOpen={isChatsModalOpen}
        onClose={() => setIsChatsModalOpen(false)}
        character={character}
        currentChatId={currentChatId}
        onContinue={handleSwitchChat}
        themeColor={themeColor}
      />
    </div>
  );
};

export default ChatPage;
