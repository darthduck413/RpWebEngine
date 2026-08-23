import { GeminiApiKey, GeminiPreset, GeminiSettings } from '../../types';
import { DEFAULT_GEMINI_API_MODEL, DEFAULT_GEMINI_THINKING_LEVEL } from '../../constants';
import { customPromptOrDefault } from './systemPrompt';

// Build the active GeminiSettings from a saved preset, resolving its API key from
// the key list. Shared between the API settings modal (selecting a preset) and
// the chat loader (re-selecting a preset stored by id on a chat).
export const buildGeminiConfigFromPreset = (preset: GeminiPreset, keys: GeminiApiKey[]): GeminiSettings => {
    const key = keys.find(k => k.id === preset.apiKeyId);
    return {
        presetId: preset.id,
        model: preset.model || DEFAULT_GEMINI_API_MODEL,
        apiKeyId: key?.id ?? preset.apiKeyId,
        apiKey: key?.apiKey ?? '',
        apiKeyName: key?.name ?? '',
        apiKeyTier: key?.tier ?? 'paid',
        thinkingLevel: preset.thinkingLevel ?? DEFAULT_GEMINI_THINKING_LEVEL,
        extraParams: preset.extraParams ?? '',
        customPrompt: customPromptOrDefault(preset.customPrompt),
    };
};
