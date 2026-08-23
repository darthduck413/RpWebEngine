// ---------------------------------------------------------------------------
// Gemini preset ↔ code sync (API Settings → Gemini tab toolbar)
// ---------------------------------------------------------------------------
// Mirror of proxyPresetSync.ts for the Gemini configuration catalog. The
// load-time merge in settingsSlice.ts (mergeMissingDefaultGeminiPresets, gated
// on a revision bump) does the same thing on startup; these helpers expose the
// operation on demand and report exactly what changed so the UI can toast it.
//
// Semantics, matched to the proxy helpers:
//   • A preset is "from code" when its id matches a DEFAULT_GEMINI_PRESETS id.
//   • Sync = append any code preset missing by id, and — for presets that are
//     from code — reset customPrompt to the code version when it has drifted.
//     Other fields (model/key/thinking/extraParams) on existing presets are
//     left as the user has them; only the prompt is authoritative from code.

import { GeminiPreset } from '../../types';
import { DEFAULT_GEMINI_PRESETS } from '../../constants';
import { customPromptOrDefault } from './systemPrompt';

const CODE_PRESETS = DEFAULT_GEMINI_PRESETS as GeminiPreset[];
const CODE_BY_ID = new Map(CODE_PRESETS.map(p => [p.id, p]));
const CODE_ORDER = new Map(CODE_PRESETS.map((p, i) => [p.id, i]));

export interface GeminiPresetSyncResult {
    presets: GeminiPreset[];
    /** Names of code presets that were missing and got appended. */
    added: string[];
    /** Names of existing presets whose prompt was refreshed from code. */
    updated: string[];
}

export const isCodeGeminiPreset = (preset: GeminiPreset): boolean => CODE_BY_ID.has(preset.id);

/** Append missing code presets and refresh drifted built-in prompts to code. */
export const syncGeminiPresetsWithCode = (current: GeminiPreset[]): GeminiPresetSyncResult => {
    const added: string[] = [];
    const updated: string[] = [];

    const next = current.map(preset => {
        const codePreset = CODE_BY_ID.get(preset.id);
        if (!codePreset) return preset; // user preset — never touched
        const codePrompt = customPromptOrDefault(codePreset.customPrompt);
        if (customPromptOrDefault(preset.customPrompt) === codePrompt) return preset;
        updated.push(preset.name || codePreset.name);
        return { ...preset, customPrompt: codePreset.customPrompt };
    });

    const known = new Set(next.map(p => p.id));
    for (const codePreset of CODE_PRESETS) {
        if (!known.has(codePreset.id)) {
            next.push({ ...codePreset, extraParams: codePreset.extraParams ?? '' });
            added.push(codePreset.name);
        }
    }

    return { presets: next, added, updated };
};

/** Reorder to code order; presets not defined in code keep their relative order at the bottom. */
export const reorderGeminiPresetsToCode = (current: GeminiPreset[]): GeminiPreset[] => {
    const fromCode: GeminiPreset[] = [];
    const userDefined: GeminiPreset[] = [];
    for (const preset of current) {
        (CODE_ORDER.has(preset.id) ? fromCode : userDefined).push(preset);
    }
    fromCode.sort((a, b) => (CODE_ORDER.get(a.id) ?? 0) - (CODE_ORDER.get(b.id) ?? 0));
    return [...fromCode, ...userDefined];
};

/** True when order already equals code-order-first (used to no-op the toast). */
export const isGeminiPresetOrderCanonical = (current: GeminiPreset[]): boolean => {
    const target = reorderGeminiPresetsToCode(current);
    return current.every((p, i) => p.id === target[i].id);
};
