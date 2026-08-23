
export interface AgentResponse {
  agentName: string;
  text: string;
}

export interface BranchInfo {
    nodeId: string;
    parentId: string | null;
    current: number; // 1-based index for UI
    total: number;
}

export interface StoryTurn {
  id: string; // Use a unique ID for keys
  text: string;
  image?: string; // Base64 Data URL
  isPlayer: boolean;
  agentResponses?: AgentResponse[];
  isExpanded?: boolean;
  branchInfo?: BranchInfo;
  worldSnapshot?: WorldSnapshot;
}

export interface StoryNode {
    id: string;
    parentId: string | null;
    childrenIds: string[];
    selectedChildIndex: number | null;
    content: Omit<StoryTurn, 'branchInfo'>;
    createdAt: number;
}

export interface ChatTree {
    nodes: Record<string, StoryNode>;
    rootNodeId: string;
}

export interface InstructionVisibility {
    playerNotes: boolean;
    setting: boolean;
    personality: boolean;
    playerDescription: boolean;
}

export type AgentPhase = 'setup' | 'routing' | 'pre-turn' | 'per-actor' | 'synthesis' | 'post-output';
export type PlotPhase = 'intro' | 'rising' | 'climax' | 'falling' | 'epilogue';
export type AgentOutputType =
  | 'narrative'
  | 'worldSnapshot'
  | 'storyBibleFragment'
  | 'characterCandidate'
  | 'universeDetection'
  | 'characterUpdate'
  | 'turnRouter'
  | 'innerStateUpdate'
  | 'driftDirective'
  | 'postCheck'
  | 'plotProgress';

export interface AgentSettings {
  id:string;
  name: string;
  systemInstruction: string;
  contextMessages: number; // 0 for all
  model: string;
  order: number;
  connections: string[];
  position: { x: number; y: number };
  type?: 'default' | 'switch' | 'spy';
  spyMode?: 'morph' | 'preset';
  spyMorphSkip?: boolean;
  defaultSkip?: boolean;
  canUpdateCharacters?: boolean;
  provider?: 'gemini' | 'proxy';
  instructionVisibility?: InstructionVisibility;
  // Summary-First Context Settings
  useSummary?: boolean;
  summaryPrompt?: string;
  summaryModel?: string;
  summaryContextLimit?: number;
  proxyParams?: string;
  // World Model fields
  phase?: AgentPhase;
  outputType?: AgentOutputType;
  storyBibleField?: keyof StoryBible;
  templateForEachCharacter?: boolean;
  scope?: 'global' | 'character';
  targetCharacterId?: string;
  enabled?: boolean; // default true — when false, the agent is skipped and its connections
                     // are re-routed to its downstream targets (modular bypass).
}

// World Model — semantic plot position, derived from story content by the
// PlotTracker agent (not from turn count). Lives on the snapshot so it persists
// per-node and feeds the next turn's POSITION marker + GM pacing.
export interface PlotProgress {
  phase: PlotPhase;
  currentBeat: string;     // human-readable "where we are in the arc"
  tension: number;         // 0-100, escalates toward the climax
  nextBeatHint?: string;   // what the story is building toward
}

// World Model — per-node snapshot of the current scene
export interface WorldSnapshot {
  location: string;
  timeOfDay: string;       // e.g. "morning", "Day 3 / 14:00"
  weather: string;
  sceneSummary: string;
  charactersInScene: string[];
  worldFacts: string[];
  plotProgress?: PlotProgress;
  updatedAt: number;
}

// World Model — per-chat persistent "story bible"
export interface StoryBibleUniverse {
  isKnown: boolean;
  name?: string;
  originalStorylineHint?: string;
}

export interface StoryBiblePlot {
  intro: string;
  conflict: string;
  climax: string;
  epilogue: string;
  themes: string[];
}

export interface StoryBibleLore {
  rules: string[];
  keyFacts: string[];
}

export interface StoryBibleRosterEntry {
  id: string;
  name: string;
  role: string;
  relations?: string;
}

export interface StoryBibleLocation {
  id: string;
  name: string;
  description: string;
}

export interface StoryBible {
  universe: StoryBibleUniverse;
  plot: StoryBiblePlot;
  lore: StoryBibleLore;
  charactersRoster: StoryBibleRosterEntry[];
  locations: StoryBibleLocation[];
  createdAt: number;
  lastEdited: number;
}

export interface WorldModelBranchState {
  storyBible: StoryBible | null;
  perCharacterStates: Record<string, PerCharacterState>;
}

// Per-character ongoing state. Updated each turn by the Inner State Tracker expert
// (when enabled). GM reads these to layer subtext on character actions/dialogue.
export interface PerCharacterState {
  characterId: string;
  goals?: string[];
  mood?: string;
  spatial?: string;
  // Inner State Tracker fields — theory-of-mind layer
  emotionalState?: string;             // e.g. "anxious, hiding grief"
  beliefsAboutOthers?: Record<string, string>; // characterId -> what THIS character believes about them
  hiddenAgenda?: string;               // what character won't say aloud
  currentPriority?: string;            // top-of-mind goal this scene
  updatedAt?: number;
}

export interface CharacterVariable {
  id: string;
  name: string;
  type: 'slider' | 'text';
  value: number | string;
  description: string;
  // targetId is used for relationship-type variables
  targetId?: string;
}

export interface CharacterTopic {
  id: string;
  name: string;
  description?: string;
  variables: CharacterVariable[];
}

export interface CharacterHealth {
  value: number | string;
  description: string;
}

export interface TrackedCharacter {
  id: string;
  name: string;
  description: string;
  health: CharacterHealth;
  topics: CharacterTopic[];
}

export interface CharacterUpdateVariable {
    name: string;
    type: 'slider' | 'text';
    value: number | string;
    description: string;
}

export interface CharacterUpdateTopic {
    name: string;
    description?: string;
    variables?: CharacterUpdateVariable[];
}

export interface CharacterUpdateHealth {
    value: number | string;
    description: string;
}

// New interface for updates received from AI
export interface CharacterUpdate {
    name: string;
    description?: string;
    health?: CharacterUpdateHealth;
    topics?: CharacterUpdateTopic[];
}

export interface ProxySettings {
    /** Id of the ProxyPreset this config was selected from, when known. Lets us
     *  track the active preset by id (mirrors GeminiSettings.presetId) instead of
     *  content-matching, and lets a chat store just the id. Optional/legacy-safe. */
    presetId?: string;
    model: string;
    proxyUrl: string;
    apiKey: string;
    extraParams?: string;
    customPrompt?: string;
    /** Preserve assistant <think> blocks in story history for providers that
     *  explicitly require interleaved reasoning. Preset-scoped and off by default. */
    includeThinkingInHistory?: boolean;
    /** When true, Anthropic cache_control breakpoints are added to messages.
     *  Off by default — cache-write tokens cost +25 % on Anthropic. */
    enableAnthropicCaching?: boolean;
}

export interface ProxyPreset extends ProxySettings {
    id: string;
    name: string;
}

// UI Settings → Text Style preset. Colors are plain CSS color values applied
// as inline styles in the transcript. Defined in constants.ts (CHAT_TEXT_PRESETS).
export interface ChatTextPreset {
    id: string;
    name: string;
    description: string;
    /** Plain (unwrapped) message text. */
    textColor: string;
    /** Text wrapped in *single asterisks*. */
    italicColor: string;
    /** Text wrapped in **double asterisks**. */
    boldColor: string;
    /** Text inside "quotes" — dialogue. */
    quoteColor: string;
}

export type GeminiKeyTier = 'free' | 'paid';

// Maps to Gemini 3 generationConfig.thinkingConfig.thinkingLevel.
// Applied to every Gemini call made under the active preset (same scope as `model`).
export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface GeminiApiKey {
    id: string;
    name: string;
    apiKey: string;
    tier: GeminiKeyTier;
}

export interface GeminiSettings {
    model: string;
    presetId?: string;
    apiKey?: string;
    apiKeyId?: string;
    apiKeyName?: string;
    apiKeyTier?: GeminiKeyTier;
    thinkingLevel?: GeminiThinkingLevel;
    // Raw JSON object string merged into every Gemini request config for this
    // preset (e.g. '{"serviceTier":"flex"}'). Mirrors ProxySettings.extraParams.
    extraParams?: string;
    customPrompt?: string;
}

export interface GeminiPreset {
    id: string;
    name: string;
    model: string;
    apiKeyId: string;
    thinkingLevel?: GeminiThinkingLevel;
    extraParams?: string;
    customPrompt?: string;
}

// Minimal reference to an API preset, stored on a chat so it can be re-selected
// on load without embedding the full config. Resolved against the live preset
// lists; a dangling id (preset deleted) is simply ignored.
export interface ApiPresetRef {
    provider: 'gemini' | 'proxy';
    presetId: string;
}

export interface Persona {
    id: string;
    name: string;
    description: string;
    avatar?: string;
    lastModified?: number;
    createdAt?: number;
}

export interface UserPersonaDetails {
    name: string;
    description: string;
    avatar?: string;
}

export interface GameState {
  storyHistory: StoryTurn[]; // Now derived from chatTree for UI consumption
  chatTree?: ChatTree; // The source of truth for the branching history
  playerNotes: string;
  /** Optional text appended after light-mode history. Empty means no post-history
   *  instruction is sent. This is chat-scoped so it cannot silently follow a user
   *  into an unrelated conversation. */
  postHistoryInstruction?: string;
  systemInstruction: string;
  characterSetting: string | null; // Mutable setting (world/location) for the current session. Null means use default.
  characterScenario?: string | null; // Mutable scenario (scene context) for the current session. Null means use default.
  characterPersonality?: string; // Snapshot of personality for the current session.
  historyContextTurns: number;
  theme: string;
  autosaveInterval: number;
  isIntelligentPresetAnalyzerEnabled: boolean;
  includeAllAgentResponsesInContext: boolean;
  keepNonExistentAgentResponses: boolean;
  trackedCharacters?: TrackedCharacter[];
  // Legacy: older saves embedded the full active API config per chat. No longer
  // written or read (connection config is global, not story data). Kept on the
  // type so old saves still parse. Superseded by apiPresetRef below.
  apiProvider?: 'gemini' | 'proxy';
  proxySettings?: ProxySettings;
  geminiSettings?: GeminiSettings;
  replaceAgentModels?: boolean;
  // Lightweight pointer to the API preset this chat was last used with — just the
  // provider + preset id, not the full config. On load, if the preset still
  // exists it is re-selected; if not, the chat keeps whatever is active globally.
  apiPresetRef?: ApiPresetRef;
  userPersonaDetails?: UserPersonaDetails; // Local copy of persona for this specific chat
  sendUserAvatar?: boolean;
  sendCharacterAvatar?: boolean;
  ignoreImages?: boolean;
  editFullMessage?: boolean;
  deleteUnfinishedGeminiSentencesOnError?: boolean;
  // World Model state (per-chat)
  storyBible?: StoryBible | null;
  perCharacterStates?: Record<string, PerCharacterState>;
  worldModelStatesByNodeId?: Record<string, WorldModelBranchState>;
  // Lore book lock. When non-null, the active lore set for this chat is frozen
  // to the indicated first-message branch. Set automatically when the user sends
  // their first reply; cleared when the chat becomes fully empty again.
  lockedFirstMessageIndex?: number | null;
  // Snapshot of the setting variant the user picked at chat start (from
  // character.availableSettings). Used by the lore reconciler so that setting-type
  // lore entries can be re-composed on top without losing the original choice.
  baseCharacterSetting?: string | null;
  // Snapshot of the character's base scenario at chat start. Used by the lore
  // reconciler to keep scenario-type lore composable without losing the base.
  baseCharacterScenario?: string | null;
  // Ids of the character's manualScenarios the user switched on for this chat.
  activeManualScenarioIds?: string[];
  // Legacy / optional snapshot fields read by applySettingsFromGameState.
  // Older saves may carry these; new saves derive them from settings slice.
  isWorldModelEnabled?: boolean;
  // Legacy only: old saves embedded the World Model agent graph. Never written
  // anymore and ignored on load (the graph is global config, not story data).
  agentSettings?: AgentSettings[];
  // Legacy Heavy Mode fields — parsed for migration only, never written.
  isHeavyMode?: boolean;
  heavyModeStrategy?: 'manual' | 'auto-select' | 'auto-generate';
  heavyModeAnalysisModel?: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  data?: any;
}

export interface Setting {
  name: string;
  content: string;
}

export type LoreEntryType = 'character' | 'scenario' | 'setting';

export interface LoreEntry {
  id: string;
  name: string;
  content: string;
  // 'character' — composed into characterPersonality (NPC cards).
  // 'scenario'  — composed into characterScenario (scene-specific context: situations, mechanics).
  // 'setting'   — composed into characterSetting (world/location bits, e.g. Heaven vs Hell).
  type: LoreEntryType;
  // World Info (keyword-triggered) fields. An entry with non-empty `keys` is
  // injected into the system prompt for a turn whenever one of its keys appears
  // in the recent story text (SillyTavern-style World Info). Greeting-bound
  // composition via FirstMessage.loreIds is unaffected.
  keys?: string[];
  // Per-entry override of the keyword scan depth (in story turns). Character
  // profiles default to a deeper scan (see lore.character) so they survive
  // pronoun-only stretches of a scene; unset entries use DEFAULT_SCAN_DEPTH.
  scanDepth?: number;
  // Inject on every turn regardless of keyword matches (ST "constant" entries).
  alwaysActive?: boolean;
  // Entry is kept but never injected (imported cards can carry disabled entries).
  disabled?: boolean;
}

// Manually-toggled scenario (experimental). Unlike World Info, these are never
// auto-triggered by keywords — the user flips them on/off in a dedicated modal.
// Active ones ride the volatile prompt tail (after the cache breakpoints, next
// to keyword World Info) so toggling never invalidates the cached prefix.
export interface ManualScenario {
  id: string;
  name: string;
  content: string;
}

// One greeting variant. Index 0 is the primary first message;
// index 1..N are alternative greetings the user can flip through.
// loreIds points into Character.loreBook — those entries get composed
// into personality/scenario/setting while this greeting is active.
export interface FirstMessage {
  text: string;
  loreIds?: string[];
}

export interface Character {
  id: string;
  name: string;
  image: string;
  personality: string;
  firstMessages: FirstMessage[];
  systemInstructionTemplate: string;
  playerDescription: string;
  setting: string;
  scenario?: string;
  availableSettings?: Setting[];
  loreBook?: LoreEntry[];
  // Experimental: user-toggleable scenarios (see ManualScenario).
  manualScenarios?: ManualScenario[];
  playerName: string;
  tags?: string[];
  lastModified?: number;
}
