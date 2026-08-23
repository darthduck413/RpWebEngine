import { describe, it, expect } from 'vitest';
import {
    normalizeOpenAiUsage,
    normalizeGeminiUsage,
    createUsageTracker,
    formatUsageSummary,
} from '../../services/common/usage';

describe('normalizeOpenAiUsage', () => {
    it('reads OpenAI / OpenRouter cached_tokens', () => {
        const usage = normalizeOpenAiUsage({
            prompt_tokens: 10000,
            completion_tokens: 500,
            prompt_tokens_details: { cached_tokens: 8000 },
        })!;
        expect(usage.promptTokens).toBe(10000);
        expect(usage.cacheReadTokens).toBe(8000);
        expect(usage.cacheWriteTokens).toBe(0);
        expect(usage.uncachedTokens).toBe(2000);
    });

    it('reads Anthropic cache_creation / cache_read fields', () => {
        const usage = normalizeOpenAiUsage({
            prompt_tokens: 12000,
            completion_tokens: 300,
            cache_read_input_tokens: 9000,
            cache_creation_input_tokens: 2000,
        })!;
        expect(usage.cacheReadTokens).toBe(9000);
        expect(usage.cacheWriteTokens).toBe(2000);
        expect(usage.uncachedTokens).toBe(1000);
    });

    it('reads DeepSeek prompt_cache_hit_tokens', () => {
        const usage = normalizeOpenAiUsage({
            prompt_tokens: 5000,
            completion_tokens: 100,
            prompt_cache_hit_tokens: 4096,
            prompt_cache_miss_tokens: 904,
        })!;
        expect(usage.cacheReadTokens).toBe(4096);
        expect(usage.uncachedTokens).toBe(904);
    });

    it('reads the cache_write_tokens spelling inside prompt_tokens_details', () => {
        const usage = normalizeOpenAiUsage({
            prompt_tokens: 4000,
            completion_tokens: 10,
            prompt_tokens_details: { cached_tokens: 1000, cache_write_tokens: 3000 },
        })!;
        expect(usage.cacheReadTokens).toBe(1000);
        expect(usage.cacheWriteTokens).toBe(3000);
        expect(usage.uncachedTokens).toBe(0);
    });

    it('handles a provider that reports no cache fields at all', () => {
        const usage = normalizeOpenAiUsage({ prompt_tokens: 700, completion_tokens: 120 })!;
        expect(usage.cacheReadTokens).toBe(0);
        expect(usage.cacheWriteTokens).toBe(0);
        expect(usage.uncachedTokens).toBe(700);
    });

    it('never returns negative uncached tokens when the numbers disagree', () => {
        const usage = normalizeOpenAiUsage({
            prompt_tokens: 1000,
            prompt_tokens_details: { cached_tokens: 900, cache_write_tokens: 400 },
        })!;
        expect(usage.uncachedTokens).toBe(0);
    });

    it.each([null, undefined, {}, 'nope', { prompt_tokens: 'many' }])('returns null for %s', (raw) => {
        expect(normalizeOpenAiUsage(raw as any)).toBeNull();
    });
});

describe('normalizeGeminiUsage', () => {
    it('reads cachedContentTokenCount from usageMetadata', () => {
        const usage = normalizeGeminiUsage({
            promptTokenCount: 20000,
            candidatesTokenCount: 800,
            cachedContentTokenCount: 15000,
            totalTokenCount: 20800,
        })!;
        expect(usage.promptTokens).toBe(20000);
        expect(usage.cacheReadTokens).toBe(15000);
        expect(usage.uncachedTokens).toBe(5000);
        // Implicit caching has no write line item.
        expect(usage.cacheWriteTokens).toBe(0);
    });

    it('counts thinking tokens as output', () => {
        const usage = normalizeGeminiUsage({
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            thoughtsTokenCount: 200,
        })!;
        expect(usage.completionTokens).toBe(250);
    });

    it('treats a missing cache count as a full miss', () => {
        const usage = normalizeGeminiUsage({ promptTokenCount: 3000, candidatesTokenCount: 10 })!;
        expect(usage.cacheReadTokens).toBe(0);
        expect(usage.uncachedTokens).toBe(3000);
    });

    it.each([null, undefined, {}])('returns null for %s', (raw) => {
        expect(normalizeGeminiUsage(raw as any)).toBeNull();
    });
});

describe('usage tracker', () => {
    it('aggregates a World Model turn across agents', () => {
        const tracker = createUsageTracker();
        tracker.record('wm:Curator', 'claude', normalizeOpenAiUsage({
            prompt_tokens: 10000, completion_tokens: 200,
            cache_read_input_tokens: 0, cache_creation_input_tokens: 10000,
        }));
        tracker.record('wm:Candidate', 'claude', normalizeOpenAiUsage({
            prompt_tokens: 10500, completion_tokens: 150,
            cache_read_input_tokens: 10000,
        }));
        tracker.record('wm:GM', 'claude', normalizeOpenAiUsage({
            prompt_tokens: 11000, completion_tokens: 900,
            cache_read_input_tokens: 10000,
        }));

        const summary = tracker.summary();
        expect(summary.calls).toBe(3);
        expect(summary.promptTokens).toBe(31500);
        expect(summary.cacheReadTokens).toBe(20000);
        expect(summary.cacheWriteTokens).toBe(10000);
        expect(summary.hitRate).toBeCloseTo(20000 / 31500, 5);
        expect(summary.entries.map(e => e.label)).toEqual(['wm:Curator', 'wm:Candidate', 'wm:GM']);
    });

    it('counts calls where the provider sent no usage block', () => {
        const tracker = createUsageTracker();
        tracker.record('light-stream', 'minimax', null);
        tracker.record('light-stream', 'minimax', null);
        const summary = tracker.summary();
        expect(summary.calls).toBe(0);
        expect(summary.callsWithoutUsage).toBe(2);
        expect(summary.hitRate).toBe(0);
    });

    it('resets between turns', () => {
        const tracker = createUsageTracker();
        tracker.record('a', 'm', normalizeOpenAiUsage({ prompt_tokens: 100, completion_tokens: 1 }));
        tracker.record('b', 'm', null);
        tracker.reset();
        const summary = tracker.summary();
        expect(summary.calls).toBe(0);
        expect(summary.callsWithoutUsage).toBe(0);
        expect(summary.promptTokens).toBe(0);
    });

    it('keeps only the most recent entries when flooded', () => {
        const tracker = createUsageTracker(3);
        for (let i = 0; i < 10; i += 1) {
            tracker.record(`call${i}`, 'm', normalizeOpenAiUsage({ prompt_tokens: 10, completion_tokens: 1 }));
        }
        const summary = tracker.summary();
        expect(summary.entries.map(e => e.label)).toEqual(['call7', 'call8', 'call9']);
    });

    it('formats a readable one-liner', () => {
        const tracker = createUsageTracker();
        tracker.record('wm:GM', 'claude', normalizeOpenAiUsage({
            prompt_tokens: 12300, completion_tokens: 800,
            cache_read_input_tokens: 8118, cache_creation_input_tokens: 1200,
        }));
        expect(formatUsageSummary(tracker.summary()))
            .toBe('1 calls · 12.3k prompt · 8.1k cached (66%) · 1.2k written · 800 out');
    });
});
