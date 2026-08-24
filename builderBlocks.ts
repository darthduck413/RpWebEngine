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
  MIMO25_TRY,
  UNIVERSAL_TRY,
  NARRATIVE_TEMPLATE_PART,
  NARRATIVE_SFW_TEMPLATE_PART,
  NEW_DSSPECIAL_NARRATIVE_TEMPLATE_PART,
  // Endpoints
  DEFAULT_PROXY_URL,
} from './constants';

// OpenRouter provider pinning: flex tier, no silent fallback to another host.
const OR_GOOGLE_FLEX = '{"service_tier": "flex", "provider": {"order": ["google-ai-studio"], "allow_fallbacks": false}}';

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
  glm46:       promptBlock('GLM 4.6',          'Uncensored third-person frame. Explicit NSFW + gore encouraged.',        GLM46_TRY),
  glm52:       promptBlock('GLM 5.2',          'Character-driven: autonomous, adversarial NPCs that push back.',         GLM52_TRY),
  gemma4:      promptBlock('Gemma 4',          'Natural, anti-purple-prose. Graphic NSFW, consent granted.',             GEMMA4_TRY),
  mimo25:      promptBlock('Mimo 2.5',         'Anti-cliche, NPCs disagree and correct {{user}}. For Mimo.',             MIMO25_TRY),
  gemini:      promptBlock('Gemini',           'Tuned for Gemini: NSFW allowed, no-rush intimacy pacing.',               GEMINI_TRY),
  universal:   promptBlock('Universal',        'Safe default for any model (Kimi, Grok, local, 70B tunes).',             UNIVERSAL_TRY),
  narrative:   promptBlock('Narrative (NSFW)', 'Minimal classic uncensored frame.',                                      NARRATIVE_TEMPLATE_PART),
  narrativeSfw:promptBlock('Narrative (SFW)',  'Minimal SFW frame.',                                                     NARRATIVE_SFW_TEMPLATE_PART),
  dsThink:     promptBlock('DeepSeek think',   'In-character inner monologue for reasoning models.',                     NEW_DSSPECIAL_NARRATIVE_TEMPLATE_PART),
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
  // ── OpenRouter ──────────────────────────────────────────────────────────
  // Deliberately short: these are starting points, not a catalog to maintain.
  // Any other model is one paste away on the Proxy tab.
  { group: 'OpenRouter', label: 'Nemotron Ultra (free)', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', proxyUrl: DEFAULT_PROXY_URL, suggestedPrompt: PROMPTS.glm46 },
  { group: 'OpenRouter', label: 'Gemini 3.1 Pro',        model: 'google/gemini-3.1-pro-preview',          proxyUrl: DEFAULT_PROXY_URL, extraParams: OR_GOOGLE_FLEX, suggestedPrompt: PROMPTS.gemini },
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
  OpenRouter: 'OR',
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
