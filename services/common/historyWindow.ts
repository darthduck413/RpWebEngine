/**
 * History window shared by both providers' prompt builders.
 *
 * A naive sliding window drops one message from the front every time a new one
 * arrives, which changes the prompt from its very first history token — the one
 * thing prompt caches cannot survive. So the window start only advances in
 * chunks of `step`: between advances the history prefix is byte-identical and
 * the cache keeps hitting, and the window holds between N and N+step-1 messages.
 *
 * Choosing `step` is a trade: a larger step carries more messages than asked for
 * (each read from cache at a fraction of the price), a smaller step resets the
 * whole history segment more often (paid at full price, every time). A turn adds
 * TWO messages — the player's and the model's — so a step of 4 means a reset
 * every second turn, which is what the original value did. The current value
 * keeps resets at roughly one every four-plus turns.
 */

export const MIN_HISTORY_WINDOW_STEP = 8;

/**
 * The pre-caching step. A turn appends two messages, so this resets the history
 * prefix every second turn — bad when a cache is there to lose, harmless when
 * there isn't one, since the only cost of a small step is a tighter window.
 */
export const UNCACHED_HISTORY_WINDOW_STEP = 4;

/**
 * How many messages the window start advances by at a time.
 *
 * The larger step is a trade: it carries up to `step - 1` messages more than asked
 * for, in exchange for resetting the cacheable prefix far less often. That trade is
 * only worth making when a prompt cache is actually in play — with no cache the
 * extra messages are billed at full price every turn and buy nothing, so the
 * original, tighter step is kept.
 */
export const resolveHistoryWindowStep = (contextTurns: number, cachingActive: boolean = false): number =>
    cachingActive
        ? Math.max(MIN_HISTORY_WINDOW_STEP, Math.ceil(contextTurns / 2))
        : Math.max(UNCACHED_HISTORY_WINDOW_STEP, Math.ceil(contextTurns / 5));

/**
 * Index of the first message to send. Stays put between step advances so the
 * prefix stays cacheable; 0 when the whole history fits.
 */
export const resolveHistoryWindowStart = (
    historyLength: number,
    contextTurns: number,
    cachingActive: boolean = false
): number => {
    if (contextTurns <= 0 || historyLength <= contextTurns) return 0;
    const step = resolveHistoryWindowStep(contextTurns, cachingActive);
    return Math.floor((historyLength - contextTurns) / step) * step;
};

/** Slices a history array down to the stepped window. */
export const applyHistoryWindow = <T>(
    history: T[],
    contextTurns: number,
    cachingActive: boolean = false
): T[] => {
    const start = resolveHistoryWindowStart(history.length, contextTurns, cachingActive);
    return start > 0 ? history.slice(start) : history;
};
