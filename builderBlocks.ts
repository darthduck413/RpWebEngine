// ---------------------------------------------------------------------------
// Preset Builder catalog (API Settings → Builder tab)
// ---------------------------------------------------------------------------
// Prefab building blocks the Builder stitches into a ProxyPreset:
//   MODEL_BLOCKS  = a model + endpoint (+ extraParams) combo, grouped by router.
//   PROMPT_BLOCKS = a named custom-prompt const with a one-line blurb.
// Both are derived from the raw consts in constants.ts, so endpoints live in
// exactly one place. Blocks deliberately carry no API key: the built preset
// starts with an empty key and the user fills it in on the Proxy tab. To
// surface a new model/prompt in the Builder, add an entry here — the UI picks
// it up automatically.

import { ProxyPreset } from './types';
import {
  // Prompts
  GLM46_TRY,
  GLM52_TRY,
  GEMMA4_TRY,
  GEMINI_TRY,
  GEMINI_SPICY_TRY,
  CLAUDE_TRY,
  GPT55_TRY,
  MIMO25_TRY,
  UNIVERSAL_TRY,
  NARRATIVE_TEMPLATE_PART,
  NARRATIVE_SFW_TEMPLATE_PART,
  NEW_DSSPECIAL_NARRATIVE_TEMPLATE_PART,
    QWEN_PROMPT,
  // Endpoints
  DEFAULT_PROXY_URL,
  FREETHEAI_PROXY_URL,
  MEGANOVA_PROXY_URL,
  REQUESTY_PROXY_URL,
  ROUTEWAY_PROXY_URL,
  SWIFTROUTER_PROXY_URL,
  TOKENREPLY_PROXY_URL,
  VERCEL_PROXY_URL,
  LOCAL_PROXY_URL,
  NARA_PROXY_URL,
} from './constants';

// OpenRouter provider-pinning extras (flex tier + no silent fallbacks).
const OR_OPENAI_FLEX = '{"service_tier": "flex", "provider": {"order": ["openai"], "allow_fallbacks": false}}';
const OR_GOOGLE_FLEX = '{"service_tier": "flex", "provider": {"order": ["google-ai-studio"], "allow_fallbacks": false}}';
const VERCEL_ZAI_ONLY = '{"providerOptions": {"gateway": {"only": ["zai"]}}}';
const TR_REASONING_HIGH = '{"reasoning_effort": "high"}';

// Block ids are auto-assigned and never written by hand. Nothing outside this
// module reads their value and nothing persists them — they exist purely as
// React keys and as the Builder's local selection state, so a running counter is
// enough to guarantee uniqueness. The upside of not hand-writing them: a model
// block references its suggested prompt as an OBJECT (`PROMPTS.glm46`), which
// the compiler checks, instead of a stringly-typed id that a typo turns into a
// silently dead chip.
let nextBlockId = 0;
const autoId = (kind: string): string => `${kind}-${nextBlockId++}`;

export interface PromptBlock {
  id: string;
  name: string;
  /** One-line description of what this prompt does / when to use it. */
  blurb: string;
  text: string;
}

const promptBlock = (name: string, blurb: string, text: string): PromptBlock =>
  ({ id: autoId('prompt'), name, blurb, text });

// Keys here are plain TS identifiers, not ids — referencing a missing one
// (`PROMPTS.gemin`) is a compile error, and renaming a key updates every use.
const PROMPTS = {
  glm46:       promptBlock('GLM 4.6 (Spicy)',  'Uncensored third-person frame. Explicit NSFW + gore encouraged.',        GLM46_TRY),
  glm52:       promptBlock('GLM 5.2',          'Character-driven: autonomous, adversarial NPCs that push back.',         GLM52_TRY),
  gemma4:      promptBlock('Gemma 4',          'Natural, anti-purple-prose. Graphic NSFW, consent granted.',             GEMMA4_TRY),
  gemini:      promptBlock('Gemini',           'Tuned for Gemini: NSFW allowed, no-rush intimacy pacing.',               GEMINI_TRY),
  geminiSpicy: promptBlock('Gemini (Spicy)',   'Same as Gemini but NSFW is actively encouraged, not just allowed.',      GEMINI_SPICY_TRY),
  claude:      promptBlock('Claude',           'Targets alignment-bleed: dialogue realism, yields the turn.',            CLAUDE_TRY),
  gpt55:       promptBlock('GPT 5.x',          'Anti-drift re-anchoring, one beat per reply. For GPT-5 family.',         GPT55_TRY),
  mimo25:      promptBlock('Mimo 2.5',         'Anti-cliche, NPCs disagree and correct {{user}}. For Mimo.',             MIMO25_TRY),
  universal:   promptBlock('Universal',        'Safe default for any model (Kimi, Grok, local, 70B tunes).',             UNIVERSAL_TRY),
  narrative:   promptBlock('Narrative (NSFW)', 'Minimal classic uncensored frame.',                                      NARRATIVE_TEMPLATE_PART),
  narrativeSfw:promptBlock('Narrative (SFW)',  'Minimal SFW frame — Mythos / Fable path.',                               NARRATIVE_SFW_TEMPLATE_PART),
  dsThink:     promptBlock('DeepSeek think', 'In-character inner monologue for reasoning models.',                     NEW_DSSPECIAL_NARRATIVE_TEMPLATE_PART),
  qwen: promptBlock('Qwen Jailbreak', 'modified prompt to prevent safety checks.',                     QWEN_PROMPT),
};

/** Prompt chips in display order. */
export const PROMPT_BLOCKS: PromptBlock[] = Object.values(PROMPTS);

export interface ModelBlock {
  id: string;
  /** Router / provider group used to cluster the chips. */
  group: string;
  /** Short display label, e.g. "GPT 5.6 sol". */
  label: string;
  model: string;
  proxyUrl: string;
  extraParams?: string;
  /** Prompt block pre-selected when this model is picked (user can override). */
  suggestedPrompt: PromptBlock;
}

/** A model block as authored — the id is filled in below. */
type ModelBlockDef = Omit<ModelBlock, 'id'>;

const MODEL_BLOCK_DEFS: ModelBlockDef[] = [
  // ── TokenReply ──────────────────────────────────────────────────────────
  { group: 'TokenReply', label: 'GPT 5.6 sol',    model: 'gpt-5.6-sol-plus',            proxyUrl: TOKENREPLY_PROXY_URL, extraParams: TR_REASONING_HIGH, suggestedPrompt: PROMPTS.gpt55 },
  { group: 'TokenReply', label: 'Gemini 3.7 Flash',model: 'gemini-3.7-flash',       proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.gemini },
  { group: 'TokenReply', label: 'Gemini 3.1 Pro', model: 'gemini-3.1-pro-preview', proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.gemini },
  { group: 'TokenReply', label: 'Gemini 3 Pro',   model: 'gemini-3-pro-preview',   proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.geminiSpicy },
  { group: 'TokenReply', label: 'Grok 4.5 Plus',  model: 'grok-4.5-plus',          proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'TokenReply', label: 'Sonnet 4.6',     model: 'claude-sonnet-4-6', proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.gemini },
  { group: 'TokenReply', label: 'Opus 4.6',       model: 'claude-opus-4-6-thinking', proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.gemini },
  { group: 'TokenReply', label: 'Sonnet 5',       model: 'claude-sonnet-5-thinking', proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.gemini },
  { group: 'TokenReply', label: 'Opus 5',         model: 'claude-opus-5', proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.gemini },
  { group: 'TokenReply', label: 'Fable 5',        model: 'claude-fable-5',         proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.gemini },
  { group: 'TokenReply', label: 'DeepSeek V4 Pro',model: 'deepseek-v4-pro-thinking', proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.dsThink },
  { group: 'TokenReply', label: 'Kimi 2.6',       model: 'kimi-k2.6',   proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'TokenReply', label: 'Kimi K3',        model: 'kimi-k3',              proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'TokenReply', label: 'Qwen 3.8 Max',   model: 'qwen3.8-max',          proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.qwen },
  { group: 'TokenReply', label: 'DS V4 Flash Free',model: 'deepseek-v4-flash-0731-plus-free', proxyUrl: TOKENREPLY_PROXY_URL, suggestedPrompt: PROMPTS.dsThink },

  // ── FreeTheAI ───────────────────────────────────────────────────────────
  { group: 'FreeTheAI',  label: 'GLM 4.6',        model: 'glm/glm-4.6',            proxyUrl: FREETHEAI_PROXY_URL, suggestedPrompt: PROMPTS.glm46 },
  { group: 'FreeTheAI',  label: 'GLM 5.2',        model: 'glm/glm-5.2',            proxyUrl: FREETHEAI_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'FreeTheAI',  label: 'Mimo v2.5 Pro',  model: 'mim/mimo-v2.5-pro',      proxyUrl: FREETHEAI_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'FreeTheAI',  label: 'Gemini 3.5 Flash',model: 'bbl/gemini-3.5-flash',  proxyUrl: FREETHEAI_PROXY_URL, suggestedPrompt: PROMPTS.gemini },
  { group: 'FreeTheAI',  label: 'DeepSeek V4 Pro',model: 'olm/deepseek-v4-pro',    proxyUrl: FREETHEAI_PROXY_URL, suggestedPrompt: PROMPTS.dsThink },
  { group: 'FreeTheAI',  label: 'Kimi K3',        model: 'yap/kimi-k3',            proxyUrl: FREETHEAI_PROXY_URL, suggestedPrompt: PROMPTS.universal },

  // ── OpenRouter ──────────────────────────────────────────────────────────
  { group: 'OpenRouter', label: 'Nemotron Ultra (free)', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', proxyUrl: DEFAULT_PROXY_URL, suggestedPrompt: PROMPTS.glm46 },
  { group: 'OpenRouter', label: 'Sol GPT 5.6',    model: 'openai/gpt-5.6-sol',     proxyUrl: DEFAULT_PROXY_URL, extraParams: OR_OPENAI_FLEX, suggestedPrompt: PROMPTS.universal },
  { group: 'OpenRouter', label: 'Luna GPT 5.6',   model: 'openai/gpt-5.6-luna',    proxyUrl: DEFAULT_PROXY_URL, extraParams: OR_OPENAI_FLEX, suggestedPrompt: PROMPTS.universal },
  { group: 'OpenRouter', label: 'Terra GPT 5.6',  model: 'openai/gpt-5.6-terra',   proxyUrl: DEFAULT_PROXY_URL, extraParams: OR_OPENAI_FLEX, suggestedPrompt: PROMPTS.universal },
  { group: 'OpenRouter', label: 'Gemini 3.1 Pro', model: 'google/gemini-3.1-pro-preview', proxyUrl: DEFAULT_PROXY_URL, extraParams: OR_GOOGLE_FLEX, suggestedPrompt: PROMPTS.gemini },
  { group: 'OpenRouter', label: 'Gemini 3.5 Flash',model: 'google/gemini-3.5-flash', proxyUrl: DEFAULT_PROXY_URL, extraParams: OR_GOOGLE_FLEX, suggestedPrompt: PROMPTS.geminiSpicy },
  { group: 'OpenRouter', label: 'Fable 5',model: 'anthropic/claude-fable-5', proxyUrl: DEFAULT_PROXY_URL, suggestedPrompt: PROMPTS.narrative },
  
  // ── Vercel AI Gateway ───────────────────────────────────────────────────
  { group: 'Vercel',     label: 'GLM 4.6',        model: 'zai/glm-4.6',            proxyUrl: VERCEL_PROXY_URL, extraParams: VERCEL_ZAI_ONLY, suggestedPrompt: PROMPTS.glm46 },
  { group: 'Vercel',     label: 'Mimo v2.5 Pro',  model: 'xiaomi/mimo-v2.5-pro',   proxyUrl: VERCEL_PROXY_URL, suggestedPrompt: PROMPTS.mimo25 },
  { group: 'Vercel',     label: 'Kimi 2.5',       model: 'moonshotai/kimi-k2.5',   proxyUrl: VERCEL_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'Vercel',     label: 'MiniMax M3',     model: 'minimax/minimax-m3',     proxyUrl: VERCEL_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'Vercel',     label: 'Qwen 3.8 Max',  model: 'alibaba/qwen3.8-max',    proxyUrl: VERCEL_PROXY_URL, suggestedPrompt: PROMPTS.qwen },
  { group: 'Vercel',     label: 'DS V4 Pro 0813',model: 'deepseek/deepseek-v4-pro-0813', proxyUrl: VERCEL_PROXY_URL, suggestedPrompt: PROMPTS.dsThink },
  { group: 'Vercel',     label: 'Grok 4.6',      model: 'xai/grok-4.6',           proxyUrl: VERCEL_PROXY_URL, suggestedPrompt: PROMPTS.universal },

  // ── Requesty ────────────────────────────────────────────────────────────
  { group: 'Requesty',   label: 'Kimi K2.6',      model: 'inceptron/kimi-k2.6',    proxyUrl: REQUESTY_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'Requesty',   label: 'DeepSeek V4 Pro',model: 'deepseek/deepseek-v4-pro',proxyUrl: REQUESTY_PROXY_URL, suggestedPrompt: PROMPTS.dsThink },
  { group: 'Requesty',   label: 'GLM 4.6',        model: 'zai/GLM-4.6',            proxyUrl: REQUESTY_PROXY_URL, suggestedPrompt: PROMPTS.glm46 },

  // ── SwiftRouter ─────────────────────────────────────────────────────────
  { group: 'SwiftRouter',label: 'GLM 4.7',        model: 'glm-4.7',                proxyUrl: SWIFTROUTER_PROXY_URL, suggestedPrompt: PROMPTS.glm46 },

  // ── MegaNova ────────────────────────────────────────────────────────────
  { group: 'MegaNova',   label: 'Manta Pro 1.0',  model: 'meganova-ai/manta-pro-1.0',       proxyUrl: MEGANOVA_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'MegaNova',   label: 'DeepSeek V3',    model: 'deepseek-ai/DeepSeek-V3-0324-Free', proxyUrl: MEGANOVA_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'MegaNova',   label: 'Nevoria 70B',    model: 'Steelskull/L3.3-MS-Nevoria-70b',  proxyUrl: MEGANOVA_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'MegaNova',   label: 'Sapphira 70B',   model: 'BruhzWater/Sapphira-L3.3-70b-0.1', proxyUrl: MEGANOVA_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  { group: 'MegaNova',   label: 'Euryale v2.1',   model: 'Sao10K/L3-70B-Euryale-v2.1',     proxyUrl: MEGANOVA_PROXY_URL, suggestedPrompt: PROMPTS.universal },
  
  // ── Routeway ─────────────────────────────────────────────────────────────
  { group: 'Routeway',   label: 'Llama 3.3 70B',  model: 'llama-3.3-70b-instruct:free',     proxyUrl: ROUTEWAY_PROXY_URL, suggestedPrompt: PROMPTS.universal },

  // ── Nara Router ─────────────────────────────────────────────────────────
  { group: 'Nara',       label: 'Grok 4.5 Free',       model: 'grok-4.5-free',          proxyUrl: NARA_PROXY_URL, suggestedPrompt: PROMPTS.universal },

  // ── Local ────────────────────────────────────────────────────────────────
  // Blank model id: a local server serves whatever is currently loaded, so the
  // field is left for the user to fill in on the Proxy tab if it needs one.
  { group: 'Local',      label: 'LM Studio',      model: '',                       proxyUrl: LOCAL_PROXY_URL, suggestedPrompt: PROMPTS.glm46 },
];

/** Model chips, with ids stamped on. */
export const MODEL_BLOCKS: ModelBlock[] = MODEL_BLOCK_DEFS.map(def => ({ ...def, id: autoId('model') }));

/** Router groups in display order, derived from MODEL_BLOCKS. */
export const MODEL_BLOCK_GROUPS: string[] = MODEL_BLOCKS.reduce<string[]>((groups, block) => {
  if (!groups.includes(block.group)) groups.push(block.group);
  return groups;
}, []);

// House naming convention (see DEFAULT_PROXY_PRESETS in constants.ts): every
// hand-named preset is "<ShortProvider>-<Specific Model Name>" — e.g.
// "TR-Gemini 3.1 Pro", "FAI-GLM 4.6", "OR-Sol GPT 5.6", "MN-Manta Pro 1.0".
// Vercel/Local keep their full group name; every other router gets abbreviated.
const GROUP_ABBREV: Record<string, string> = {
  TokenReply: 'TR',
  FreeTheAI: 'FAI',
  OpenRouter: 'OR',
  Vercel: 'Vercel',
  Requesty: 'RQ',
  MegaNova: 'MN',
  Routeway: 'RW',
  SwiftRouter: 'Swift',
  Nara: 'Nara',
  Local: 'Local',
};

/** "<ShortProvider>-<Model label>" — the base name for a preset built from this model. */
export const modelPresetBaseName = (model: ModelBlock): string =>
  `${GROUP_ABBREV[model.group] ?? model.group}-${model.label}`;

/** Stitch a chosen model block + prompt block into a ready-to-save ProxyPreset. */
export const buildPresetFromBlocks = (
  model: ModelBlock,
  prompt: PromptBlock,
  name: string,
  includeThinkingInHistory = false,
): ProxyPreset => ({
  id: crypto.randomUUID(),
  name: name.trim() || modelPresetBaseName(model),
  model: model.model,
  proxyUrl: model.proxyUrl,
  // Blocks ship no credentials — the user pastes their key on the Proxy tab.
  apiKey: '',
  extraParams: model.extraParams ?? '',
  customPrompt: prompt.text,
  includeThinkingInHistory,
});
