/**
 * Cache telemetry.
 *
 * Every provider reports prompt-cache accounting under a different name, so the
 * raw `usage` blob is normalized into one shape here and collected in a small
 * in-memory tracker. Nothing in this module touches prompts or requests — it only
 * reads what came back, so it can never change what the model sees.
 */

export interface NormalizedUsage {
    promptTokens: number;
    completionTokens: number;
    /** Prompt tokens served from the provider's cache (billed at a discount). */
    cacheReadTokens: number;
    /** Prompt tokens written into the cache on this call (billed at a premium). */
    cacheWriteTokens: number;
    /** Prompt tokens that were neither read from nor written to the cache. */
    uncachedTokens: number;
    raw: unknown;
}

const num = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const finish = (
    promptTokens: number,
    completionTokens: number,
    cacheReadTokens: number,
    cacheWriteTokens: number,
    raw: unknown
): NormalizedUsage => ({
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    // Providers count cache reads inside prompt_tokens; writes may or may not be
    // included, so clamp instead of trusting the arithmetic.
    uncachedTokens: Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens),
    raw,
});

/**
 * OpenAI-compatible `usage` (OpenRouter, Vercel AI Gateway, TokenReply, DeepSeek,
 * Anthropic-behind-a-proxy). Field names differ per provider; all known spellings
 * are checked.
 */
export const normalizeOpenAiUsage = (raw: any): NormalizedUsage | null => {
    if (!raw || typeof raw !== 'object') return null;

    const details = raw.prompt_tokens_details ?? raw.promptTokensDetails ?? {};
    const cacheRead =
        num(details.cached_tokens)
        || num(details.cache_read_tokens)
        || num(raw.cache_read_input_tokens)
        || num(raw.prompt_cache_hit_tokens);
    const cacheWrite =
        num(details.cache_write_tokens)
        || num(details.cache_creation_tokens)
        || num(raw.cache_creation_input_tokens)
        || num(raw.cache_write_input_tokens);

    const completionTokens = num(raw.completion_tokens) || num(raw.output_tokens);

    // The two dialects disagree on what the prompt counter means:
    //  - OpenAI-compatible `prompt_tokens` is the TOTAL prompt, cached part included.
    //  - Anthropic-native `input_tokens` is only the UNCACHED remainder; the total is
    //    input + cache_read + cache_creation.
    // Treating the Anthropic number as a total reports hit rates above 100% and
    // understates real spend, so the two are handled separately.
    const openAiPromptTokens = num(raw.prompt_tokens);
    const promptTokens = openAiPromptTokens || (num(raw.input_tokens) + cacheRead + cacheWrite);

    if (!promptTokens && !completionTokens && !cacheRead && !cacheWrite) return null;
    return finish(promptTokens, completionTokens, cacheRead, cacheWrite, raw);
};

/** Native Gemini `usageMetadata`. Implicit caching reports cachedContentTokenCount. */
export const normalizeGeminiUsage = (raw: any): NormalizedUsage | null => {
    if (!raw || typeof raw !== 'object') return null;

    const promptTokens = num(raw.promptTokenCount);
    const completionTokens = num(raw.candidatesTokenCount) + num(raw.thoughtsTokenCount);
    const cacheRead = num(raw.cachedContentTokenCount);

    if (!promptTokens && !completionTokens && !cacheRead) return null;
    // Gemini has no "cache write" line item: implicit caching is free to create.
    return finish(promptTokens, completionTokens, cacheRead, 0, raw);
};

export interface UsageEntry {
    /** Where the call came from, e.g. "light-stream" or "wm:World Curator". */
    label: string;
    model: string;
    usage: NormalizedUsage;
    at: number;
}

export interface UsageSummary {
    calls: number;
    /** Calls that reported no usage block at all — provider didn't send one. */
    callsWithoutUsage: number;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    uncachedTokens: number;
    /** cacheReadTokens / promptTokens, 0..1. */
    hitRate: number;
    entries: UsageEntry[];
}

const emptySummary = (): UsageSummary => ({
    calls: 0,
    callsWithoutUsage: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    uncachedTokens: 0,
    hitRate: 0,
    entries: [],
});

export interface UsageTracker {
    record(label: string, model: string, usage: NormalizedUsage | null, cacheKey?: string): void;
    /** Everything recorded since the last reset. */
    summary(): UsageSummary;
    /** Evidence for this exact provider/model key; survives per-turn reset(). */
    hasObservedCacheHits(cacheKey?: string): boolean;
    reset(): void;
}

export const createUsageTracker = (maxEntries: number = 200): UsageTracker => {
    let entries: UsageEntry[] = [];
    let callsWithoutUsage = 0;
    const observedCacheHitKeys = new Set<string>();
    const UNSCOPED_CACHE_KEY = '__unscoped__';

    return {
        record(label, model, usage, cacheKey) {
            if (!usage) {
                callsWithoutUsage += 1;
                return;
            }
            if (usage.cacheReadTokens > 0) {
                observedCacheHitKeys.add(cacheKey || UNSCOPED_CACHE_KEY);
            }
            entries.push({ label, model, usage, at: Date.now() });
            if (entries.length > maxEntries) entries = entries.slice(-maxEntries);
        },

        hasObservedCacheHits(cacheKey) {
            return cacheKey
                ? observedCacheHitKeys.has(cacheKey)
                : observedCacheHitKeys.size > 0;
        },
        summary() {
            const summary = entries.reduce<UsageSummary>((acc, entry) => {
                acc.calls += 1;
                acc.promptTokens += entry.usage.promptTokens;
                acc.completionTokens += entry.usage.completionTokens;
                acc.cacheReadTokens += entry.usage.cacheReadTokens;
                acc.cacheWriteTokens += entry.usage.cacheWriteTokens;
                acc.uncachedTokens += entry.usage.uncachedTokens;
                return acc;
            }, emptySummary());

            summary.callsWithoutUsage = callsWithoutUsage;
            summary.entries = entries.slice();
            summary.hitRate = summary.promptTokens > 0
                ? summary.cacheReadTokens / summary.promptTokens
                : 0;
            return summary;
        },
        reset() {
            entries = [];
            callsWithoutUsage = 0;
        },
    };
};

/**
 * Process-wide tracker. Provider clients record into it without having to thread
 * a handle through every call site; the gameplay thunks snapshot and reset it
 * around a turn to produce the per-turn cache report.
 */
export const usageTracker = createUsageTracker();

const normalizeModel = (model: string): string => (model ?? '').trim().toLowerCase();

const normalizeEndpoint = (url: string): string => {
    const raw = (url ?? '').trim();
    try {
        const parsed = new URL(raw);
        return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
    } catch {
        return raw.replace(/\/+$/, '').toLowerCase();
    }
};

/** Stable identities for cache capability evidence. API keys are never included. */
export const proxyUsageCacheKey = (url: string, model: string): string =>
    `proxy:${normalizeEndpoint(url)}:${normalizeModel(model)}`;

export const geminiUsageCacheKey = (model: string): string =>
    `gemini:${normalizeModel(model)}`;

/** Compact one-line form for logs: "12.3k prompt · 8.1k cached (66%) · 1.2k written". */
export const formatUsageSummary = (summary: UsageSummary): string => {
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    return [
        `${summary.calls} calls`,
        `${k(summary.promptTokens)} prompt`,
        `${k(summary.cacheReadTokens)} cached (${Math.round(summary.hitRate * 100)}%)`,
        `${k(summary.cacheWriteTokens)} written`,
        `${k(summary.completionTokens)} out`,
    ].join(' · ');
};
