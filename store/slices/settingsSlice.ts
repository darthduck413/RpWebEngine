
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { AgentSettings, GeminiApiKey, GeminiPreset, GeminiSettings, GeminiThinkingLevel, ProxySettings, ProxyPreset } from '../../types';
import {
    DEFAULT_AGENT_SETTINGS,
    DEFAULT_PROXY_MODEL,
    DEFAULT_PROXY_URL,
    DEFAULT_PROXY_API_KEY,
    DEFAULT_PROXY_PRESETS,
    DEFAULT_GEMINI_API_KEYS,
    DEFAULT_GEMINI_PRESETS,
    DEFAULT_GEMINI_API_MODEL,
    DEFAULT_GEMINI_THINKING_LEVEL,
} from '../../constants';

// Legacy ids for the removed "Environment" Gemini key/presets (backed by
// process.env.GEMINI_API_KEY). Stripped from any persisted settings so they no
// longer surface in the UI for users who saved them before the env option was dropped.
const LEGACY_GEMINI_ENV_KEY_ID = 'gemini-env-key';
const LEGACY_GEMINI_ENV_PRESET_IDS = ['gemini-env-pro', 'gemini-env-flash'];
const BUILT_IN_PRESET_PROMPT_REVISION = 3;
import { storageService } from '../../services/storage';
import { customPromptOrDefault } from '../../services/common/systemPrompt';
import { normalizeChatTextPresetId } from '../../services/common/chatTextPresets';

interface SettingsState {
  theme: string;
  isWorldModelEnabled: boolean;
  // World Model request throttle. The multi-agent pipeline fans out many
  // provider calls per turn; some providers cap requests-per-minute, so this
  // limits World Model calls to `worldModelRpm` per rolling 60s window (with a
  // reactive cooldown on detected 429s). On by default; ignored in light mode.
  worldModelRpmEnabled: boolean;
  worldModelRpm: number;
  agentSettings: AgentSettings[];
  historyContextTurns: number;
  autosaveInterval: number;
  isIntelligentPresetAnalyzerEnabled: boolean;
  includeAllAgentResponsesInContext: boolean;
  keepNonExistentAgentResponses: boolean;
  apiProvider: 'gemini' | 'proxy';
  proxySettings: ProxySettings;
  proxyPresets: ProxyPreset[];
  geminiSettings: GeminiSettings;
  geminiApiKeys: GeminiApiKey[];
  geminiPresets: GeminiPreset[];
  builtInPresetPromptRevision: number;
  replaceAgentModels: boolean;
  // Session specific settings that persist
  playerNotes: string;
  // Explicit, chat-scoped text appended after light-mode history. Empty by default.
  postHistoryInstruction: string;
  systemInstruction: string;
  characterSetting: string | null;
  characterScenario: string | null;
  characterPersonality: string;
  // Avatar settings
  sendUserAvatar: boolean;
  sendCharacterAvatar: boolean;
  ignoreImages: boolean;
  editFullMessage: boolean;
  deleteUnfinishedGeminiSentencesOnError: boolean;
  // Anthropic prompt caching (cache_control breakpoints). Off by default because
  // cache-write tokens cost +25 % on Anthropic — only worthwhile for very long
  // conversations where reads outweigh the initial write penalty.
  enableAnthropicCaching: boolean;
  // Max width of the conversation column, in rem (scales with root font-size).
  // Default 80 == full (Tailwind max-w-7xl == 80rem). Lower values give a
  // narrower, centered chat column (Janitor-style). Applied via a CSS variable
  // consumed by the `max-w-[var(--chat-max-w)]` utility in ChatPage.
  chatMaxWidthRem: number;
  // Chat text preset id — how narration / *emphasis* / "speech" are colored in
  // the transcript. Ids come from services/common/chatTextPresets.ts.
  chatTextPresetId: string;
  // Font size of message text in the transcript, in px.
  chatFontSizePx: number;
  // Show the image-attach button in the message bar. Off by default — most
  // users rarely attach and the button is visual clutter. Pasting an image
  // into the input still works regardless of this setting.
  showImageAttachButton: boolean;
}

// Conversation column width bounds, in rem. Default matches Tailwind max-w-7xl.
export const DEFAULT_CHAT_WIDTH_REM = 80;
export const MIN_CHAT_WIDTH_REM = 30;

// Chat font size bounds, in px. Default matches the browser/Tailwind base size.
export const DEFAULT_CHAT_FONT_SIZE_PX = 16;
export const MIN_CHAT_FONT_SIZE_PX = 12;
export const MAX_CHAT_FONT_SIZE_PX = 22;
export const clampChatFontSize = (px: number): number =>
    Number.isFinite(px)
        ? Math.max(MIN_CHAT_FONT_SIZE_PX, Math.min(MAX_CHAT_FONT_SIZE_PX, Math.round(px)))
        : DEFAULT_CHAT_FONT_SIZE_PX;

// World Model RPM throttle defaults + bounds. On by default at a conservative
// 5 requests/min so a freshly enabled World Model can't trip provider limits.
export const DEFAULT_WORLD_MODEL_RPM = 5;
export const MIN_WORLD_MODEL_RPM = 1;
export const MAX_WORLD_MODEL_RPM = 1000;
export const clampWorldModelRpm = (rpm: number): number =>
    Number.isFinite(rpm)
        ? Math.max(MIN_WORLD_MODEL_RPM, Math.min(MAX_WORLD_MODEL_RPM, Math.floor(rpm)))
        : DEFAULT_WORLD_MODEL_RPM;

const DEFAULT_GEMINI_PRESET = DEFAULT_GEMINI_PRESETS[0];
const DEFAULT_GEMINI_KEY =
    DEFAULT_GEMINI_API_KEYS.find(k => k.id === DEFAULT_GEMINI_PRESET?.apiKeyId)
    ?? DEFAULT_GEMINI_API_KEYS[0];

const DEFAULT_GEMINI_SETTINGS: GeminiSettings = {
    model: DEFAULT_GEMINI_PRESET?.model ?? DEFAULT_GEMINI_API_MODEL,
    presetId: DEFAULT_GEMINI_PRESET?.id,
    apiKeyId: DEFAULT_GEMINI_KEY?.id,
    apiKey: DEFAULT_GEMINI_KEY?.apiKey ?? '',
    apiKeyName: DEFAULT_GEMINI_KEY?.name ?? '',
    apiKeyTier: DEFAULT_GEMINI_KEY?.tier ?? 'paid',
    thinkingLevel: DEFAULT_GEMINI_THINKING_LEVEL,
    extraParams: DEFAULT_GEMINI_PRESET?.extraParams ?? '',
    customPrompt: customPromptOrDefault(DEFAULT_GEMINI_PRESET?.customPrompt),
};

const isGeminiThinkingLevel = (level: unknown): level is GeminiThinkingLevel =>
    level === 'minimal' || level === 'low' || level === 'medium' || level === 'high';

const findDefaultProxyPresetForSettings = (settings: ProxySettings): ProxyPreset | undefined => {
    return DEFAULT_PROXY_PRESETS.find(def =>
        def.model === settings.model &&
        def.proxyUrl === settings.proxyUrl &&
        def.apiKey === settings.apiKey &&
        (def.extraParams ?? '') === (settings.extraParams ?? '') &&
        (def.includeThinkingInHistory === true) === (settings.includeThinkingInHistory === true)
    );
};

const withProxySettingsDefaults = (
    settings?: Partial<ProxySettings> | null,
    refreshBuiltInPrompt = false
): ProxySettings => {
    const merged: ProxySettings = {
        presetId: settings?.presetId,
        model: settings?.model ?? DEFAULT_PROXY_MODEL,
        proxyUrl: settings?.proxyUrl ?? DEFAULT_PROXY_URL,
        apiKey: settings?.apiKey ?? DEFAULT_PROXY_API_KEY,
        extraParams: settings?.extraParams ?? '',
        customPrompt: customPromptOrDefault(settings?.customPrompt),
        includeThinkingInHistory: settings?.includeThinkingInHistory === true,
    };
    const defaultPreset = refreshBuiltInPrompt ? findDefaultProxyPresetForSettings(merged) : undefined;
    return defaultPreset
        ? { ...merged, presetId: merged.presetId ?? defaultPreset.id, customPrompt: customPromptOrDefault(defaultPreset.customPrompt) }
        : merged;
};

const withProxyPresetDefaults = (
    preset: ProxyPreset & { temperature?: unknown },
    refreshBuiltInPrompt = false
): ProxyPreset => {
    const { temperature: _legacyTemperature, ...rest } = preset;
    const defaultPreset = refreshBuiltInPrompt
        ? DEFAULT_PROXY_PRESETS.find(def => def.id === rest.id)
        : undefined;
    return {
        ...rest,
        extraParams: rest.extraParams ?? '',
        customPrompt: customPromptOrDefault(defaultPreset?.customPrompt ?? rest.customPrompt),
        includeThinkingInHistory: rest.includeThinkingInHistory === true,
    };
};

const isGeminiKeyTier = (tier: unknown): tier is GeminiApiKey['tier'] => tier === 'free' || tier === 'paid';

const withGeminiApiKeyDefaults = (key: Partial<GeminiApiKey>): GeminiApiKey => ({
    id: key.id || crypto.randomUUID(),
    name: key.name || 'Untitled Key',
    apiKey: key.apiKey ?? '',
    tier: isGeminiKeyTier(key.tier) ? key.tier : 'paid',
});

const mergeMissingDefaultGeminiKeys = (saved: GeminiApiKey[] | undefined): GeminiApiKey[] => {
    const list = saved
        ? saved.filter(k => k.id !== LEGACY_GEMINI_ENV_KEY_ID).map(withGeminiApiKeyDefaults)
        : [];
    const known = new Set(list.map(k => k.id));
    for (const def of DEFAULT_GEMINI_API_KEYS) {
        if (!known.has(def.id)) list.push(withGeminiApiKeyDefaults(def));
    }
    return list;
};

const resolveGeminiKey = (keys: GeminiApiKey[], settings?: Partial<GeminiSettings> | null): GeminiApiKey | undefined => {
    return keys.find(k => k.id === settings?.apiKeyId)
        ?? keys.find(k => k.apiKey && k.apiKey === settings?.apiKey)
        ?? keys[0];
};

const withGeminiPresetDefaults = (
    preset: Partial<GeminiPreset>,
    keys: GeminiApiKey[],
    refreshBuiltInPrompt = false
): GeminiPreset => {
    const defaultPreset = preset.id ? DEFAULT_GEMINI_PRESETS.find(p => p.id === preset.id) : undefined;
    // On a revision bump, built-in presets are fully restored to their constants
    // definition (model, key, thinking, extra params, prompt) so pushed default
    // changes — e.g. repointing the Pro preset to the paid Flex key — actually
    // reach existing installs instead of being masked by stale saved values.
    if (refreshBuiltInPrompt && defaultPreset) {
        return {
            id: defaultPreset.id,
            name: defaultPreset.name,
            model: defaultPreset.model,
            apiKeyId: defaultPreset.apiKeyId,
            thinkingLevel: defaultPreset.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL,
            extraParams: defaultPreset.extraParams ?? '',
            customPrompt: customPromptOrDefault(defaultPreset.customPrompt),
        };
    }
    return {
        id: preset.id || crypto.randomUUID(),
        name: preset.name || defaultPreset?.name || 'Untitled Gemini',
        model: preset.model || defaultPreset?.model || DEFAULT_GEMINI_SETTINGS.model,
        apiKeyId: preset.apiKeyId || defaultPreset?.apiKeyId || resolveGeminiKey(keys, undefined)?.id || DEFAULT_GEMINI_API_KEYS[0]?.id || '',
        thinkingLevel: isGeminiThinkingLevel(preset.thinkingLevel) ? preset.thinkingLevel : (defaultPreset?.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL),
        extraParams: preset.extraParams ?? defaultPreset?.extraParams ?? '',
        customPrompt: customPromptOrDefault(preset.customPrompt ?? defaultPreset?.customPrompt),
    };
};

const mergeMissingDefaultGeminiPresets = (
    saved: GeminiPreset[] | undefined,
    keys: GeminiApiKey[],
    refreshBuiltInPrompts = false
): GeminiPreset[] => {
    const list = saved
        ? saved.filter(p => !LEGACY_GEMINI_ENV_PRESET_IDS.includes(p.id)).map(p => withGeminiPresetDefaults(p, keys, refreshBuiltInPrompts))
        : [];
    const known = new Set(list.map(p => p.id));
    for (const def of DEFAULT_GEMINI_PRESETS) {
        if (!known.has(def.id)) list.push(withGeminiPresetDefaults(def, keys, refreshBuiltInPrompts));
    }
    return list;
};

const withGeminiSettingsDefaults = (
    settings: Partial<GeminiSettings> | undefined | null,
    keys: GeminiApiKey[],
    presets: GeminiPreset[],
    refreshBuiltInPrompt = false
): GeminiSettings => {
    const preset = presets.find(p => p.id === settings?.presetId)
        ?? presets.find(p =>
            p.model === settings?.model &&
            p.apiKeyId === settings?.apiKeyId
        )
        ?? presets[0];
    const merged = {
        ...DEFAULT_GEMINI_SETTINGS,
        ...(preset ? {
            presetId: preset.id,
            model: preset.model,
            apiKeyId: preset.apiKeyId,
            thinkingLevel: preset.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL,
            extraParams: preset.extraParams ?? '',
            customPrompt: customPromptOrDefault(preset.customPrompt),
        } : {}),
        ...(settings?.presetId ? { presetId: settings.presetId } : {}),
        ...(settings?.model ? { model: settings.model } : {}),
        ...(settings?.apiKeyId ? { apiKeyId: settings.apiKeyId } : {}),
        ...(settings?.apiKey ? { apiKey: settings.apiKey } : {}),
        ...(settings?.apiKeyName ? { apiKeyName: settings.apiKeyName } : {}),
        ...(settings?.apiKeyTier ? { apiKeyTier: settings.apiKeyTier } : {}),
        ...(settings?.extraParams !== undefined ? { extraParams: settings.extraParams } : {}),
        ...(isGeminiThinkingLevel(settings?.thinkingLevel) ? { thinkingLevel: settings!.thinkingLevel } : {}),
        ...(
            settings?.customPrompt !== undefined &&
            !(refreshBuiltInPrompt && preset && DEFAULT_GEMINI_PRESETS.some(def => def.id === preset.id))
                ? { customPrompt: customPromptOrDefault(settings.customPrompt) }
                : {}
        ),
    };
    const key = resolveGeminiKey(keys, merged);
    return {
        ...merged,
        apiKeyId: key?.id ?? merged.apiKeyId,
        apiKey: merged.apiKey || key?.apiKey || '',
        apiKeyName: key?.name ?? merged.apiKeyName,
        apiKeyTier: key?.tier ?? merged.apiKeyTier,
    };
};

// Ids of built-in proxy presets that were removed and must be stripped from any saved
// settings (mergeMissingDefaultPresets only adds defaults, never removes).
const REMOVED_PROXY_PRESET_IDS: string[] = [];

// Adds any DEFAULT_PROXY_PRESETS missing by id, preserving custom preset order.
// Built-in prompt text can be refreshed by revision so deployed defaults track constants.ts.
const mergeMissingDefaultPresets = (
    saved: ProxyPreset[] | undefined,
    refreshBuiltInPrompts = false
): ProxyPreset[] => {
    const list = saved
        ? saved.filter(p => !REMOVED_PROXY_PRESET_IDS.includes(p.id)).map(p => withProxyPresetDefaults(p, refreshBuiltInPrompts))
        : [];
    const known = new Set(list.map(p => p.id));
    for (const def of DEFAULT_PROXY_PRESETS) {
        if (!known.has(def.id)) list.push(withProxyPresetDefaults(def, refreshBuiltInPrompts));
    }
    return list;
};

// Brings a saved agent graph up to date with new World Model defaults:
//  1) appends any DEFAULT_AGENT_SETTINGS agents missing by id (e.g. the new
//     world-plot-tracker / world-bible-reconciler), preserving user customization and
//     order. Existing entries are never removed. Brand-new ids can't have been deleted
//     by the user, so adding them is safe — same philosophy as mergeMissingDefaultPresets.
//  2) a one-time enable normalization flips the two high-value agents — Anti-Drift +
//     Inner State — on for users who saved them while they were disabled-by-default.
//
// The "one time" is gated on a DATA marker (are the new agents already present?) rather
// than a separate persisted flag. This keeps both steps atomic with the same saved data:
// if the migrated graph is never persisted (app closed before an autosave), BOTH simply
// re-run on the next load; once persisted, both stop — so a later deliberate disable of
// these agents is respected. A separate flag could desync from the data and silently lose
// the flip.
const NEW_WM_AGENT_IDS = ['world-plot-tracker', 'world-bible-reconciler'];
const WM_DEFAULT_ENABLE_IDS = ['world-drift-director', 'world-inner-state'];

const mergeWorldModelAgentDefaults = (saved: AgentSettings[] | undefined): AgentSettings[] => {
    if (!saved) return DEFAULT_AGENT_SETTINGS;

    const known = new Set(saved.map(a => a.id));
    const alreadyMigrated = NEW_WM_AGENT_IDS.every(id => known.has(id));

    let list = [...saved];
    if (!alreadyMigrated) {
        const enableSet = new Set(WM_DEFAULT_ENABLE_IDS);
        list = list.map(a => (enableSet.has(a.id) ? { ...a, enabled: true } : a));
    }

    // Always append any missing default agents (additive; never removes existing entries).
    for (const def of DEFAULT_AGENT_SETTINGS) {
        if (!known.has(def.id)) list.push(def);
    }
    return list;
};

// Load initial settings from local storage or defaults
const loadInitialState = (): SettingsState => {
  const savedSettings = storageService.loadSettings();
  const refreshBuiltInPresetPrompts =
    (savedSettings?.builtInPresetPromptRevision ?? 0) < BUILT_IN_PRESET_PROMPT_REVISION;
  // Legacy migration: old Heavy Mode users (any preset) are flipped to World Model
  // and their agent graph is reset to the new default. We can't preserve old graphs
  // because Marinara / Cognitive Stack / Storywriter presets are removed entirely.
  const wasLegacyHeavyMode = savedSettings?.isHeavyMode === true;
  const geminiApiKeys = mergeMissingDefaultGeminiKeys(savedSettings?.geminiApiKeys);
  const geminiPresets = mergeMissingDefaultGeminiPresets(savedSettings?.geminiPresets, geminiApiKeys, refreshBuiltInPresetPrompts);

  return {
    theme: savedSettings?.theme
        || localStorage.getItem('rwe-theme')
        || 'blue',
    isWorldModelEnabled: savedSettings?.isWorldModelEnabled ?? wasLegacyHeavyMode,
    worldModelRpmEnabled: savedSettings?.worldModelRpmEnabled ?? true,
    worldModelRpm: clampWorldModelRpm(savedSettings?.worldModelRpm ?? DEFAULT_WORLD_MODEL_RPM),
    agentSettings: wasLegacyHeavyMode
        ? DEFAULT_AGENT_SETTINGS
        : mergeWorldModelAgentDefaults(savedSettings?.agentSettings),
    historyContextTurns: savedSettings?.historyContextTurns ?? 0,
    autosaveInterval: savedSettings?.autosaveInterval ?? 120,
    isIntelligentPresetAnalyzerEnabled: savedSettings?.isIntelligentPresetAnalyzerEnabled ?? false,
    includeAllAgentResponsesInContext: savedSettings?.includeAllAgentResponsesInContext ?? false,
    keepNonExistentAgentResponses: savedSettings?.keepNonExistentAgentResponses ?? false,
    apiProvider: savedSettings?.apiProvider ?? 'gemini',
    proxySettings: withProxySettingsDefaults(savedSettings?.proxySettings, refreshBuiltInPresetPrompts),
    proxyPresets: mergeMissingDefaultPresets(savedSettings?.proxyPresets, refreshBuiltInPresetPrompts),
    geminiSettings: withGeminiSettingsDefaults(savedSettings?.geminiSettings, geminiApiKeys, geminiPresets, refreshBuiltInPresetPrompts),
    geminiApiKeys,
    geminiPresets,
    builtInPresetPromptRevision: BUILT_IN_PRESET_PROMPT_REVISION,
    replaceAgentModels: savedSettings?.replaceAgentModels ?? false,
    playerNotes: '', // Always start empty on new load, typically set by character selection logic
    postHistoryInstruction: '', // Explicit opt-in, restored only from a chat save
    systemInstruction: '',
    characterSetting: null, // Start null, populated on chat start
    characterScenario: null, // Start null, populated on chat start (lore-driven)
    characterPersonality: '', // Start empty, populated on chat start
    sendUserAvatar: savedSettings?.sendUserAvatar ?? false,
    sendCharacterAvatar: savedSettings?.sendCharacterAvatar ?? false,
    ignoreImages: savedSettings?.ignoreImages ?? false,
    editFullMessage: savedSettings?.editFullMessage ?? false,
    deleteUnfinishedGeminiSentencesOnError: savedSettings?.deleteUnfinishedGeminiSentencesOnError ?? false,
    enableAnthropicCaching: savedSettings?.enableAnthropicCaching ?? false,
    chatMaxWidthRem: savedSettings?.chatMaxWidthRem ?? DEFAULT_CHAT_WIDTH_REM,
    chatTextPresetId: normalizeChatTextPresetId(savedSettings?.chatTextPresetId),
    chatFontSizePx: clampChatFontSize(savedSettings?.chatFontSizePx ?? DEFAULT_CHAT_FONT_SIZE_PX),
    showImageAttachButton: savedSettings?.showImageAttachButton ?? false,
  };
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState: loadInitialState(),
  reducers: {
    setTheme(state, action: PayloadAction<string>) {
      state.theme = action.payload;
    },
    setWorldModelEnabled(state, action: PayloadAction<boolean>) {
      state.isWorldModelEnabled = action.payload;
    },
    setWorldModelRateLimit(state, action: PayloadAction<{ enabled: boolean; rpm: number }>) {
      state.worldModelRpmEnabled = action.payload.enabled;
      state.worldModelRpm = clampWorldModelRpm(action.payload.rpm);
    },
    setAgentSettings(state, action: PayloadAction<AgentSettings[]>) {
      state.agentSettings = action.payload;
    },
    setPlayerNotes(state, action: PayloadAction<string>) {
      state.playerNotes = action.payload;
    },
    setPostHistoryInstruction(state, action: PayloadAction<string>) {
      state.postHistoryInstruction = action.payload;
    },
    setSystemInstruction(state, action: PayloadAction<string>) {
      state.systemInstruction = action.payload;
    },
    setCharacterSetting(state, action: PayloadAction<string | null>) {
      state.characterSetting = action.payload;
    },
    setCharacterScenario(state, action: PayloadAction<string | null>) {
      state.characterScenario = action.payload;
    },
    setCharacterPersonality(state, action: PayloadAction<string>) {
      state.characterPersonality = action.payload;
    },
    setChatMaxWidthRem(state, action: PayloadAction<number>) {
      const v = action.payload;
      state.chatMaxWidthRem = Number.isFinite(v)
        ? Math.min(DEFAULT_CHAT_WIDTH_REM, Math.max(MIN_CHAT_WIDTH_REM, v))
        : DEFAULT_CHAT_WIDTH_REM;
    },
    setChatTextPreset(state, action: PayloadAction<string>) {
      state.chatTextPresetId = normalizeChatTextPresetId(action.payload);
    },
    setChatFontSize(state, action: PayloadAction<number>) {
      state.chatFontSizePx = clampChatFontSize(action.payload);
    },
    setShowImageAttachButton(state, action: PayloadAction<boolean>) {
      state.showImageAttachButton = action.payload;
    },
    setGameSettings(state, action: PayloadAction<{
      turns: number;
      interval: number;
      intelligentAnalyzer: boolean;
      includeAllAgentResponsesInContext: boolean;
      keepNonExistentAgentResponses: boolean;
      sendUserAvatar: boolean;
      sendCharacterAvatar: boolean;
      ignoreImages: boolean;
      editFullMessage: boolean;
      deleteUnfinishedGeminiSentencesOnError: boolean;
      enableAnthropicCaching: boolean;
    }>) {
      state.historyContextTurns = action.payload.turns;
      state.autosaveInterval = action.payload.interval;
      state.isIntelligentPresetAnalyzerEnabled = action.payload.intelligentAnalyzer;
      state.includeAllAgentResponsesInContext = action.payload.includeAllAgentResponsesInContext;
      state.keepNonExistentAgentResponses = action.payload.keepNonExistentAgentResponses;
      state.sendUserAvatar = action.payload.sendUserAvatar;
      state.sendCharacterAvatar = action.payload.sendCharacterAvatar;
      state.ignoreImages = action.payload.ignoreImages;
      state.editFullMessage = action.payload.editFullMessage;
      state.deleteUnfinishedGeminiSentencesOnError = action.payload.deleteUnfinishedGeminiSentencesOnError;
      state.enableAnthropicCaching = action.payload.enableAnthropicCaching;
    },
    setApiSettings(state, action: PayloadAction<{
      provider: 'gemini' | 'proxy';
      proxyConfig: ProxySettings;
      geminiConfig: GeminiSettings;
      replaceModels: boolean;
    }>) {
      state.apiProvider = action.payload.provider;
      state.proxySettings = withProxySettingsDefaults(action.payload.proxyConfig);
      state.geminiSettings = withGeminiSettingsDefaults(action.payload.geminiConfig, state.geminiApiKeys, state.geminiPresets);
      state.replaceAgentModels = action.payload.replaceModels;
    },
    setProxyPresets(state, action: PayloadAction<ProxyPreset[]>) {
      state.proxyPresets = action.payload.map(preset => withProxyPresetDefaults(preset));
    },
    setGeminiApiKeys(state, action: PayloadAction<GeminiApiKey[]>) {
      state.geminiApiKeys = mergeMissingDefaultGeminiKeys(action.payload);
      state.geminiPresets = mergeMissingDefaultGeminiPresets(state.geminiPresets, state.geminiApiKeys);
      state.geminiSettings = withGeminiSettingsDefaults(state.geminiSettings, state.geminiApiKeys, state.geminiPresets);
    },
    setGeminiPresets(state, action: PayloadAction<GeminiPreset[]>) {
      state.geminiPresets = mergeMissingDefaultGeminiPresets(action.payload, state.geminiApiKeys);
      state.geminiSettings = withGeminiSettingsDefaults(state.geminiSettings, state.geminiApiKeys, state.geminiPresets);
    },
    loadSettings(state, action: PayloadAction<Partial<SettingsState>>) {
        const definedSettings = Object.fromEntries(
            Object.entries(action.payload).filter(([, value]) => value !== undefined)
        ) as Partial<SettingsState>;
        const refreshBuiltInPresetPrompts =
            (definedSettings.builtInPresetPromptRevision ?? 0) < BUILT_IN_PRESET_PROMPT_REVISION;

        Object.assign(state, definedSettings);
        // Ensure defaults if loaded state is missing newer fields
        state.proxyPresets = mergeMissingDefaultPresets(state.proxyPresets, refreshBuiltInPresetPrompts);
        state.geminiApiKeys = mergeMissingDefaultGeminiKeys(state.geminiApiKeys);
        state.geminiPresets = mergeMissingDefaultGeminiPresets(state.geminiPresets, state.geminiApiKeys, refreshBuiltInPresetPrompts);
        state.geminiSettings = withGeminiSettingsDefaults(state.geminiSettings, state.geminiApiKeys, state.geminiPresets, refreshBuiltInPresetPrompts);
        state.proxySettings = withProxySettingsDefaults(state.proxySettings, refreshBuiltInPresetPrompts);
        state.builtInPresetPromptRevision = BUILT_IN_PRESET_PROMPT_REVISION;
    }
  },
});

export const {
  setTheme, setWorldModelEnabled, setWorldModelRateLimit, setAgentSettings, setPlayerNotes, setPostHistoryInstruction,
  setSystemInstruction, setCharacterSetting, setCharacterScenario, setCharacterPersonality, setChatMaxWidthRem, setChatTextPreset, setChatFontSize, setShowImageAttachButton, setGameSettings, setApiSettings, setProxyPresets, setGeminiApiKeys, setGeminiPresets, loadSettings
} = settingsSlice.actions;

export default settingsSlice.reducer;
