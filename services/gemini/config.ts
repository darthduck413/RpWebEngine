import { GeminiSettings } from '../../types';
import { parseExtraParams } from '../common/extraParams';

export const resolveGeminiApiKey = (settings?: Partial<GeminiSettings> | null): string => {
    return settings?.apiKey || '';
};

export const buildGeminiConfig = (
    settings?: Partial<GeminiSettings> | null,
    overrides: Record<string, unknown> = {}
): Record<string, unknown> => {
    const config: Record<string, unknown> = {};
    const model = settings?.model ? String(settings.model).trim().toLowerCase().replace(/^models\//, '') : '';
    const isGemini25Flash = model === 'gemini-2.5-flash';

    if (settings?.thinkingLevel && !isGemini25Flash) {
        config.thinkingConfig = { thinkingLevel: settings.thinkingLevel };
    }
    // Preset-level extra params (e.g. serviceTier "flex" for cheaper inference)
    // are merged in next; call-specific overrides still win so JSON-mode schemas
    // and abort signals are never clobbered.
    const extraParams = parseExtraParams(settings?.extraParams);
    return { ...config, ...extraParams, ...overrides };
};
