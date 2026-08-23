import { ProxySettings } from '../../types';
import { callProxy } from './client';

export interface TestConnectionResult {
    ok: boolean;
    message: string;
}

// Sends a minimal one-message request through callProxy to verify the
// endpoint, API key, and model are usable. Captures errors instead of
// throwing so callers can render them directly.
export async function testProxyConnection(
    settings: ProxySettings,
    signal?: AbortSignal,
): Promise<TestConnectionResult> {
    if (!settings.proxyUrl) return { ok: false, message: 'No URL configured' };

    try {
        const reply = await callProxy(
            settings,
            settings.model || '',
            [{ role: 'user', content: 'ping' }],
            false,
            signal,
        );
        const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
        return { ok: true, message: text.trim() || 'OK' };
    } catch (e: any) {
        if (e?.name === 'AbortError') return { ok: false, message: 'Aborted' };
        return { ok: false, message: (e?.message || 'Network error').slice(0, 200) };
    }
}
