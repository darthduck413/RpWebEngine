import { GeminiSettings } from '../../types';
import { buildGeminiConfig, resolveGeminiApiKey } from './config';
import { getGeminiClient, getModelName } from './client';

export interface TestGeminiConnectionResult {
    ok: boolean;
    message: string;
}

export async function testGeminiConnection(
    settings: GeminiSettings,
    signal?: AbortSignal
): Promise<TestGeminiConnectionResult> {
    if (!resolveGeminiApiKey(settings)) return { ok: false, message: 'No Gemini API key configured' };

    try {
        const ai = getGeminiClient(settings);
        const response = await ai.models.generateContent({
            model: getModelName(settings.model),
            contents: 'ping',
            config: buildGeminiConfig(
                settings,
                signal ? { abortSignal: signal } : {}
            ),
        });
        return { ok: true, message: response.text?.trim() || 'OK' };
    } catch (e: any) {
        if (e?.name === 'AbortError') return { ok: false, message: 'Aborted' };
        return { ok: false, message: (e?.message || 'Network error').slice(0, 200) };
    }
}
