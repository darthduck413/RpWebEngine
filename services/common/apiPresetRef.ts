import {
    ApiPresetRef, GeminiApiKey, GeminiPreset, GeminiSettings, ProxyPreset, ProxySettings,
} from '../../types';
import { buildGeminiConfigFromPreset } from './geminiPreset';
import { customPromptOrDefault } from './systemPrompt';

// Does a ProxySettings blob correspond to this preset by content? Fallback for
// settings saved before ProxySettings carried a presetId.
const proxySettingsMatchPreset = (settings: ProxySettings, preset: ProxyPreset): boolean =>
    settings.model === preset.model &&
    settings.proxyUrl === preset.proxyUrl &&
    settings.apiKey === preset.apiKey &&
    (settings.extraParams || '') === (preset.extraParams || '') &&
    (settings.includeThinkingInHistory === true) === (preset.includeThinkingInHistory === true);

// Derive the id-only reference for the currently active provider/preset, used
// when saving a chat. Prefers the stored preset id; falls back to content match
// so even legacy settings resolve to an id. Returns undefined when the active
// config matches no known preset (nothing to point at).
export const getActiveApiPresetRef = (args: {
    apiProvider: 'gemini' | 'proxy';
    proxySettings: ProxySettings;
    geminiSettings: GeminiSettings;
    proxyPresets: ProxyPreset[];
    geminiPresets: GeminiPreset[];
}): ApiPresetRef | undefined => {
    const { apiProvider, proxySettings, geminiSettings, proxyPresets, geminiPresets } = args;

    if (apiProvider === 'gemini') {
        const id = geminiSettings?.presetId;
        return id && geminiPresets.some(p => p.id === id)
            ? { provider: 'gemini', presetId: id }
            : undefined;
    }

    const byId = proxySettings?.presetId && proxyPresets.some(p => p.id === proxySettings.presetId)
        ? proxySettings.presetId
        : undefined;
    const id = byId ?? proxyPresets.find(p => proxySettingsMatchPreset(proxySettings, p))?.id;
    return id ? { provider: 'proxy', presetId: id } : undefined;
};

// Resolve a chat's stored reference into a settings patch to dispatch on load.
// Returns null when the referenced preset no longer exists — the caller then
// leaves the globally-active config untouched (current behavior).
export const resolveApiPresetRef = (
    ref: ApiPresetRef | undefined,
    args: { proxyPresets: ProxyPreset[]; geminiPresets: GeminiPreset[]; geminiApiKeys: GeminiApiKey[] },
): { apiProvider: 'gemini' | 'proxy'; proxySettings?: ProxySettings; geminiSettings?: GeminiSettings } | null => {
    if (!ref) return null;

    if (ref.provider === 'gemini') {
        const preset = args.geminiPresets.find(p => p.id === ref.presetId);
        if (!preset) return null;
        return { apiProvider: 'gemini', geminiSettings: buildGeminiConfigFromPreset(preset, args.geminiApiKeys) };
    }

    const preset = args.proxyPresets.find(p => p.id === ref.presetId);
    if (!preset) return null;
    const { id: _id, name: _name, ...rest } = preset;
    return {
        apiProvider: 'proxy',
        proxySettings: {
            ...rest,
            presetId: preset.id,
            extraParams: preset.extraParams ?? '',
            customPrompt: customPromptOrDefault(preset.customPrompt),
            includeThinkingInHistory: preset.includeThinkingInHistory === true,
        },
    };
};
