/**
 * Where "is prompt caching actually happening?" is decided.
 *
 * Two different regimes exist:
 *  - explicit: Anthropic-family models honour cache_control breakpoints, charge a
 *    premium for the write and a discount for the read. Costs money to get wrong,
 *    so several behaviours (unified history windows, prefix warm-up) only switch on
 *    here.
 *  - implicit: Gemini, OpenAI and DeepSeek cache prefixes automatically with no
 *    request-side opt-in. Nothing to enable, nothing to budget — a stable prefix is
 *    all they need, which the prompt builders already produce.
 */

const EXPLICIT_CACHE_MODEL_RE = /claude|anthropic/i;

/** True for models where explicit cache_control breakpoints are honoured. */
export const isCacheCapableModel = (model: string): boolean =>
    EXPLICIT_CACHE_MODEL_RE.test(model ?? '');

/**
 * Minimum cacheable prefix, in tokens, per Anthropic model family.
 *
 * A breakpoint placed on a shorter prefix is silently ignored — no error, just no
 * cache — so it burns one of the 4 slots for nothing. The value is NOT monotonic
 * across generations (512 on the newest, 4096 on Opus 4.6/4.5 and Haiku 4.5), so a
 * single constant is wrong in both directions: too low wastes slots on Haiku 4.5,
 * too high discards usable breakpoints on Opus 5.
 *
 * Ordered longest-match-first — "opus-4-5" must be tested before "opus-4".
 */
const MIN_CACHEABLE_TOKENS_BY_MODEL: [RegExp, number][] = [
    [/opus-5|fable-5|mythos-5/i, 512],
    [/opus-4-6|opus-4\.6|opus-4-5|opus-4\.5|haiku-4-5|haiku-4\.5/i, 4096],
    [/opus-4-7|opus-4\.7|mythos-preview|haiku-3-5|haiku-3\.5/i, 2048],
    [/opus-4-8|opus-4\.8|sonnet-5|sonnet-4-6|sonnet-4\.6|sonnet-4-5|sonnet-4\.5|opus-4-1|opus-4\.1/i, 1024],
];

/** The most common minimum; used when the model string matches nothing known. */
const DEFAULT_MIN_CACHEABLE_TOKENS = 1024;

export const minCacheableTokens = (model: string): number => {
    const match = MIN_CACHEABLE_TOKENS_BY_MODEL.find(([pattern]) => pattern.test(model ?? ''));
    return match ? match[1] : DEFAULT_MIN_CACHEABLE_TOKENS;
};

/**
 * Prompt builders do not have Anthropic's tokenizer, so they cannot prove that a
 * prefix meets a token minimum from its character count. In particular:
 *  - Cyrillic/CJK can use several tokens per visible character;
 *  - highly compressible ASCII can use far fewer than one token per 4 characters;
 *  - image token cost depends on dimensions, not the base64 string length.
 *
 * We therefore use UTF-8 bytes only as a conservative upper bound: a byte-level
 * tokenizer cannot emit more text tokens than bytes, and the small allowance
 * covers message/part framing added by the provider. `true` means "possibly
 * cacheable", not "guaranteed cacheable". Media is always kept as a candidate
 * because its token cost cannot be inferred here.
 */
const TOKEN_UPPER_BOUND_PER_STRUCTURAL_UNIT = 32;

export const canPossiblyMeetCacheMinimum = (
    model: string,
    prefixUtf8Bytes: number,
    structuralUnits: number = 0,
    hasMedia: boolean = false
): boolean =>
    hasMedia
    || prefixUtf8Bytes + (structuralUnits * TOKEN_UPPER_BOUND_PER_STRUCTURAL_UNIT)
        >= minCacheableTokens(model);

/**
 * True when this request will really carry breakpoints: the user enabled caching
 * AND the model understands them.
 */
export const isExplicitCachingActive = (
    settings: { enableAnthropicCaching?: boolean; model?: string } | null | undefined,
    modelOverride?: string
): boolean => {
    if (!settings?.enableAnthropicCaching) return false;
    return isCacheCapableModel(modelOverride || settings.model || '');
};
