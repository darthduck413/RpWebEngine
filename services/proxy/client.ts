import { ProxySettings } from '../../types';
import { ProxyMessage, prepareWireMessages, appendJsonModeInstruction } from './prompts';
import { normalizeTextPart, withThinkingMarkup } from '../common/thinking';
import { fetchChatCompletion, needsServerProxy, formatUpstreamError, wantsUsageAccounting, wantsStreamUsageOptions, openRouterSessionFields } from './proxyHelper';
import { usageTracker, normalizeOpenAiUsage, proxyUsageCacheKey } from '../common/usage';

const stripJsonFences = (text: string): string => text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const extractJsonCandidate = (text: string): string => {
    const clean = stripJsonFences(text);
    const objectStart = clean.indexOf('{');
    const arrayStart = clean.indexOf('[');
    const starts = [objectStart, arrayStart].filter(i => i >= 0).sort((a, b) => a - b);
    if (starts.length === 0) return clean;

    const start = starts[0];
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = start; i < clean.length; i += 1) {
        const ch = clean[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            stack.push('}');
        } else if (ch === '[') {
            stack.push(']');
        } else if (ch === '}' || ch === ']') {
            if (stack[stack.length - 1] === ch) {
                stack.pop();
                if (stack.length === 0) {
                    return clean.slice(start, i + 1);
                }
            }
        }
    }

    return clean.slice(start).trimEnd() + stack.reverse().join('');
};

// Aggregates an OpenAI-compatible SSE stream into a single response.
// Used for server-proxied hosts: the Vercel edge proxy must start responding
// within 25s, so long generations have to stream even for one-shot calls.
const readSseResponse = async (
    response: Response,
    signal?: AbortSignal
): Promise<{ content: string; reasoning: string; usage: any }> => {
    if (!response.body) throw new Error('Response body is null');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';
    let usage: any = null;

    const consume = (chunk: string) => {
        const trimmed = chunk.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
            const parsed = JSON.parse(payload);
            // Usage arrives in the final chunk (an empty-choices frame when
            // stream_options.include_usage is on).
            if (parsed.usage) usage = parsed.usage;
            const choice = parsed.choices?.[0] ?? {};
            const delta = choice.delta ?? {};
            content += normalizeTextPart(delta.content ?? delta.text ?? choice.text);
            reasoning += normalizeTextPart(delta.reasoning_content ?? delta.reasoning);
        } catch {
            // Ignore malformed/keep-alive chunks
        }
    };

    while (true) {
        if (signal?.aborted) {
            await reader.cancel();
            throw new DOMException('The operation was aborted.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(consume);
    }
    consume(buffer);

    return { content, reasoning, usage };
};

const parseProxyJson = (text: string): any => {
    try {
        return JSON.parse(stripJsonFences(text));
    } catch {
        return JSON.parse(extractJsonCandidate(text));
    }
};

export const parseProxyExtraParams = (extraParams?: string): Record<string, unknown> => {
    if (!extraParams || extraParams.trim() === '') return {};
    try {
        const parsed = JSON.parse(extraParams);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        console.warn("Proxy extra params must be a JSON object. Ignoring invalid format.");
    } catch (e) {
        console.warn("Invalid JSON in Proxy extra parameters, ignoring.", e);
    }
    return {};
};

export async function callProxy(
    settings: ProxySettings,
    model: string,
    messages: ProxyMessage[],
    jsonMode: boolean = false,
    signal?: AbortSignal,
    /** Shown in the per-turn cache report so a bad hit rate can be traced to a caller. */
    usageLabel: string = 'proxy-call',
    cacheSessionId?: string
): Promise<any> {
    const extraParams = parseProxyExtraParams(settings.extraParams);

    const requestMessages = jsonMode
        ? appendJsonModeInstruction(messages)
        : messages.map(m => ({ ...m }));

    const effectiveModel = model || settings.model;
    const useStreaming = needsServerProxy(settings.proxyUrl);
    const body: any = {
        model: effectiveModel,
        messages: prepareWireMessages(requestMessages, effectiveModel, settings.enableAnthropicCaching),
        // Non-streamed OpenAI-compatible responses carry `usage` by default; the
        // streamed ones only do when asked.
        ...(useStreaming
            ? {
                stream: true,
                ...(wantsStreamUsageOptions(settings.proxyUrl) ? { stream_options: { include_usage: true } } : {}),
            }
            : {}),
        ...(wantsUsageAccounting(settings.proxyUrl) ? { usage: { include: true } } : {}),
        ...openRouterSessionFields(settings.proxyUrl, cacheSessionId),
        ...extraParams,
    };

    const response = await fetchChatCompletion(settings.proxyUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(body),
        signal
    });

    if (!response.ok) {
        throw new Error(formatUpstreamError(response.status, response.statusText, await response.text()));
    }

    let text: string;
    let reasoning: unknown;

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/event-stream')) {
        const aggregated = await readSseResponse(response, signal);
        text = aggregated.content;
        reasoning = aggregated.reasoning || undefined;
        usageTracker.record(
            usageLabel,
            effectiveModel,
            normalizeOpenAiUsage(aggregated.usage),
            proxyUsageCacheKey(settings.proxyUrl, effectiveModel)
        );
    } else {
        const data = await response.json();
        usageTracker.record(
            usageLabel,
            effectiveModel,
            normalizeOpenAiUsage(data.usage),
            proxyUsageCacheKey(settings.proxyUrl, effectiveModel)
        );
        const choice = data.choices?.[0] ?? {};
        const message = choice.message ?? {};
        text = normalizeTextPart(message.content ?? choice.text ?? '');

        // If standard content is empty, try looking for 'text' property (legacy/text-completion proxies)
        if (!text && choice.text) {
            text = normalizeTextPart(choice.text);
        }
        reasoning = message.reasoning_content ?? message.reasoning ?? choice.reasoning_content ?? choice.reasoning;
    }

    text = stripJsonFences(text);

    if (jsonMode) {
        try {
            return parseProxyJson(text);
        } catch (e) {
            console.error("Failed to parse JSON response from Proxy", text);
            throw new Error("Proxy returned invalid JSON in JSON mode.");
        }
    }
    return withThinkingMarkup(reasoning, text);
}
