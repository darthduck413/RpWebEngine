// ---------------------------------------------------------------------------
// Proxy preset ↔ code sync (API Settings → Proxy tab toolbar)
// ---------------------------------------------------------------------------
// The load-time merge in settingsSlice.ts (mergeMissingDefaultPresets +
// withProxyPresetDefaults, gated on a revision bump) does the same thing on
// startup. These helpers expose the operation on demand and, unlike the slice,
// report exactly what changed so the UI can toast it.
//
// Semantics, matched to the slice:
//   • A preset is "from code" when its id matches a DEFAULT_PROXY_PRESETS id.
//   • Sync = append any code preset missing by id, and — for presets that are
//     from code — reset customPrompt to the code version when it has drifted.
//     Other fields (model/url/key/extraParams) on existing presets are left as
//     the user has them; only the prompt is authoritative from code.

import { ProxyPreset } from '../../types';
import { DEFAULT_PROXY_PRESETS } from '../../constants';
import { customPromptOrDefault } from './systemPrompt';

const CODE_PRESETS = DEFAULT_PROXY_PRESETS as ProxyPreset[];
const CODE_BY_ID = new Map(CODE_PRESETS.map(p => [p.id, p]));
const CODE_ORDER = new Map(CODE_PRESETS.map((p, i) => [p.id, i]));

export interface ProxyPresetSyncResult {
    presets: ProxyPreset[];
    /** Names of code presets that were missing and got appended. */
    added: string[];
    /** Names of existing presets whose prompt was refreshed from code. */
    updated: string[];
}

export const isCodeProxyPreset = (preset: ProxyPreset): boolean => CODE_BY_ID.has(preset.id);

/** Append missing code presets and refresh drifted built-in prompts to code. */
export const syncProxyPresetsWithCode = (current: ProxyPreset[]): ProxyPresetSyncResult => {
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
export const reorderProxyPresetsToCode = (current: ProxyPreset[]): ProxyPreset[] => {
    const fromCode: ProxyPreset[] = [];
    const userDefined: ProxyPreset[] = [];
    for (const preset of current) {
        (CODE_ORDER.has(preset.id) ? fromCode : userDefined).push(preset);
    }
    fromCode.sort((a, b) => (CODE_ORDER.get(a.id) ?? 0) - (CODE_ORDER.get(b.id) ?? 0));
    return [...fromCode, ...userDefined];
};

/** True when order already equals code-order-first (used to no-op the toast). */
export const isProxyPresetOrderCanonical = (current: ProxyPreset[]): boolean => {
    const target = reorderProxyPresetsToCode(current);
    return current.every((p, i) => p.id === target[i].id);
};
