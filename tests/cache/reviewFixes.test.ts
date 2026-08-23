import { describe, it, expect } from 'vitest';
import { canPossiblyMeetCacheMinimum, minCacheableTokens } from '../../services/common/cache';
import { normalizeOpenAiUsage, createUsageTracker, proxyUsageCacheKey } from '../../services/common/usage';
import { prepareWireMessages, ProxyMessage, CACHE_PRIORITY } from '../../services/proxy/prompts';
import { openRouterSessionFields } from '../../services/proxy/proxyHelper';

const big = (label: string) => `${label} `.repeat(3000);

const breakpointCount = (wire: any[]): number =>
    wire.reduce((sum, m) => {
        if (typeof m.content === 'string') return sum;
        return sum + (m.content as any[]).filter((p: any) => p.cache_control).length;
    }, 0);

/** Labels of the marked blocks — each fixture's text is its label repeated. */
const markedTexts = (wire: any[]): string[] => {
    const out: string[] = [];
    wire.forEach(m => {
        if (typeof m.content === 'string') return;
        (m.content as any[]).forEach((p: any) => {
            if (p.cache_control) out.push(String(p.text).split(' ')[0]);
        });
    });
    return out;
};

describe('model-aware minimum cacheable prefix', () => {
    it('uses the documented minimum per model family', () => {
        expect(minCacheableTokens('claude-opus-5')).toBe(512);
        expect(minCacheableTokens('anthropic/claude-fable-5')).toBe(512);
        expect(minCacheableTokens('claude-opus-4-8')).toBe(1024);
        expect(minCacheableTokens('claude-sonnet-4-5')).toBe(1024);
        expect(minCacheableTokens('claude-opus-4-7')).toBe(2048);
        expect(minCacheableTokens('claude-haiku-4-5')).toBe(4096);
        expect(minCacheableTokens('claude-opus-4-6')).toBe(4096);
    });

    it('is not monotonic across generations — 4.6 needs 8x what 5 needs', () => {
        expect(minCacheableTokens('claude-opus-4-6'))
            .toBeGreaterThan(minCacheableTokens('claude-opus-5'));
    });

    it('falls back to the most common minimum for an unknown model', () => {
        expect(minCacheableTokens('some-future-claude')).toBe(1024);
        expect(minCacheableTokens('')).toBe(1024);
    });

    it('does not mistake character count for token count', () => {
        const russianBytes = new TextEncoder().encode('я'.repeat(500)).byteLength;
        expect(canPossiblyMeetCacheMinimum('claude-sonnet-4-5', russianBytes, 2)).toBe(true);
    });

    it('keeps a breakpoint on Opus 5 that Haiku 4.5 would reject', () => {
        // The byte upper bound is enough for 512 tokens, but cannot reach 4096.
        const messages: ProxyMessage[] = [
            { role: 'system', content: 'x'.repeat(1000), cache: true },
            { role: 'user', content: 'hi' },
        ];
        expect(breakpointCount(prepareWireMessages(messages, 'claude-opus-5', true))).toBe(1);
        expect(breakpointCount(prepareWireMessages(messages, 'claude-haiku-4-5', true))).toBe(0);
    });

    it('never estimates image tokens from base64 length or drops an unknown image prefix', () => {
        const messages: ProxyMessage[] = [{
            role: 'system',
            content: [
                { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
                { type: 'text', text: 'caption', cache: true },
            ],
        }];
        expect(breakpointCount(prepareWireMessages(messages, 'claude-haiku-4-5', true))).toBe(1);
    });
});

describe('history-head slot reservation', () => {
    // Four stable system blocks + a history head: without a reservation the stable
    // blocks (priority 0) take all four slots and the history head is evicted.
    const messages: ProxyMessage[] = [
        {
            role: 'system',
            content: [
                { type: 'text', text: big('WORLD'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
                { type: 'text', text: big('BIBLE'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
                { type: 'text', text: big('DESCR'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
                { type: 'text', text: big('NOTES'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
                { type: 'text', text: 'ROLE' },
            ],
        },
        { role: 'user', content: big('OLDER'), cache: true, cachePriority: CACHE_PRIORITY.HISTORY_DEPTH },
        { role: 'assistant', content: big('HEAD'), cache: true, cachePriority: CACHE_PRIORITY.HISTORY_HEAD },
    ];

    it('never drops the history head, even when stable blocks fill the budget', () => {
        const wire = prepareWireMessages(messages, 'claude-sonnet-4-5', true);
        expect(markedTexts(wire)).toContain('HEAD');
    });

    it('still respects the 4-breakpoint limit', () => {
        expect(breakpointCount(prepareWireMessages(messages, 'claude-sonnet-4-5', true))).toBe(4);
    });

    it('drops the lowest-value stable block instead', () => {
        const marks = markedTexts(prepareWireMessages(messages, 'claude-sonnet-4-5', true));
        expect(marks).toContain('WORLD');
        expect(marks).not.toContain('NOTES');
    });

    it('keeps the newest history head when several are marked', () => {
        const twoHeads: ProxyMessage[] = [
            { role: 'system', content: big('SYS'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
            { role: 'user', content: big('OLDHEAD'), cache: true, cachePriority: CACHE_PRIORITY.HISTORY_HEAD },
            { role: 'assistant', content: big('NEWHEAD'), cache: true, cachePriority: CACHE_PRIORITY.HISTORY_HEAD },
        ];
        expect(markedTexts(prepareWireMessages(twoHeads, 'claude-sonnet-4-5', true))).toContain('NEWHEAD');
    });

    it('does nothing when there is no history head to protect', () => {
        const stableOnly: ProxyMessage[] = [
            { role: 'system', content: big('SYS'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
        ];
        expect(breakpointCount(prepareWireMessages(stableOnly, 'claude-sonnet-4-5', true))).toBe(1);
    });
});

describe('Anthropic-native usage math', () => {
    it('reconstructs the total prompt from input + cache fields', () => {
        // Anthropic reports input_tokens as the UNCACHED remainder only.
        const usage = normalizeOpenAiUsage({
            input_tokens: 1000,
            output_tokens: 300,
            cache_read_input_tokens: 8000,
            cache_creation_input_tokens: 1000,
        })!;
        expect(usage.promptTokens).toBe(10000);
        expect(usage.cacheReadTokens).toBe(8000);
        expect(usage.uncachedTokens).toBe(1000);
    });

    it('never reports a hit rate above 100%', () => {
        const tracker = createUsageTracker();
        tracker.record('anthropic', 'claude-opus-5', normalizeOpenAiUsage({
            input_tokens: 200,
            output_tokens: 50,
            cache_read_input_tokens: 9000,
        }));
        expect(tracker.summary().hitRate).toBeLessThanOrEqual(1);
    });

    it('leaves the OpenAI dialect alone — prompt_tokens is already the total', () => {
        const usage = normalizeOpenAiUsage({
            prompt_tokens: 10000,
            completion_tokens: 300,
            prompt_tokens_details: { cached_tokens: 8000 },
        })!;
        expect(usage.promptTokens).toBe(10000);
        expect(usage.uncachedTokens).toBe(2000);
    });

    it('prefers prompt_tokens when a provider sends both spellings', () => {
        const usage = normalizeOpenAiUsage({
            prompt_tokens: 10000,
            input_tokens: 2000,
            cache_read_input_tokens: 8000,
        })!;
        expect(usage.promptTokens).toBe(10000);
    });
});

describe('observed cache hits', () => {
    const keyA = proxyUsageCacheKey('https://openrouter.ai/api/v1/chat/completions', 'claude-opus-5');
    const keyB = proxyUsageCacheKey('https://other.example/v1/chat/completions', 'claude-opus-5');

    it('starts false and latches once a read is seen', () => {
        const tracker = createUsageTracker();
        expect(tracker.hasObservedCacheHits(keyA)).toBe(false);

        tracker.record('a', 'm', normalizeOpenAiUsage({ prompt_tokens: 100, completion_tokens: 1 }), keyA);
        expect(tracker.hasObservedCacheHits(keyA)).toBe(false);

        tracker.record('b', 'm', normalizeOpenAiUsage({
            prompt_tokens: 100, completion_tokens: 1,
            prompt_tokens_details: { cached_tokens: 90 },
        }), keyA);
        expect(tracker.hasObservedCacheHits(keyA)).toBe(true);
        expect(tracker.hasObservedCacheHits(keyB)).toBe(false);
    });

    it('survives reset — it answers "does this provider cache at all"', () => {
        const tracker = createUsageTracker();
        tracker.record('a', 'm', normalizeOpenAiUsage({
            prompt_tokens: 100, completion_tokens: 1,
            prompt_tokens_details: { cached_tokens: 90 },
        }), keyA);
        tracker.reset();
        expect(tracker.hasObservedCacheHits(keyA)).toBe(true);
        expect(tracker.hasObservedCacheHits(keyB)).toBe(false);
        expect(tracker.summary().calls).toBe(0);
    });

    it('stays false for a provider that never reports a hit', () => {
        const tracker = createUsageTracker();
        for (let i = 0; i < 5; i += 1) {
            tracker.record('gemini-free', 'g', normalizeOpenAiUsage({
                prompt_tokens: 9000, completion_tokens: 100,
            }));
        }
        expect(tracker.hasObservedCacheHits()).toBe(false);
    });
});

describe('OpenRouter sticky routing', () => {
    it('adds a bounded session id only for OpenRouter', () => {
        expect(openRouterSessionFields('https://openrouter.ai/api/v1/chat/completions', 'chat-1'))
            .toEqual({ session_id: 'chat-1' });
        expect(openRouterSessionFields('https://proxy.example/v1/chat/completions', 'chat-1'))
            .toEqual({});
        expect(openRouterSessionFields(
            'https://openrouter.ai/api/v1/chat/completions',
            'x'.repeat(300)
        ).session_id).toHaveLength(256);
    });
});
