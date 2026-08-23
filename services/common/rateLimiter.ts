/**
 * World Model RPM limiter — proactive fixed-window throttle.
 *
 * The World Model pipeline fans out many provider requests per turn (agents in
 * the same order run in parallel; several phases each fire their own batch).
 * Providers like the Vercel AI Gateway free tier cap requests on a fixed window
 * (~"N requests, then wait a minute, then N more"). The goal here is to PROACTIVELY
 * stay under that cap so we never trip a 429 in the first place.
 *
 * Model: allow up to `rpm` requests as fast as they're asked, then force a full
 * `windowMs` rest before the next batch. `windowMs` defaults to 120s — двойной
 * запас над провайдерским ~60s окном, so a batch that started near the provider's
 * window boundary (e.g. at second 59) can't bleed into the next provider window.
 *
 * It is purely a scheduler — it NEVER inspects, mutates, or augments prompts /
 * messages / tokens. The only thing it changes is *when* a first request runs;
 * a failed task is never called again automatically.
 */

export interface RateLimiterConfig {
    /** When false the limiter is a no-op pass-through (no throttling at all). */
    enabled: boolean;
    /** Max requests permitted per fixed window (>= 1). */
    rpm: number;
    /**
     * Length of one window / rest period in ms. Default 120_000 (2 min): a safety
     * margin over the typical ~60s provider window so batch boundaries never collide.
     * Injectable mainly so the behaviour can be unit-tested without real 2-min waits.
     */
    windowMs?: number;
}

// 2-minute rest between batches (safety margin over a provider's ~60s window).
const DEFAULT_WINDOW_MS = 120_000;
export interface RateLimiter {
    /** Run `task` once a slot is available. Pass-through when disabled. */
    schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    /** Update enabled/rpm/windowMs at runtime (e.g. after a settings change). */
    configure(next: Partial<RateLimiterConfig>): void;
    getConfig(): Required<RateLimiterConfig>;
    /** Drop the current window so the next request starts a fresh batch. */
    reset(): void;
}

const clampRpm = (rpm: number): number =>
    Number.isFinite(rpm) ? Math.max(1, Math.min(1000, Math.floor(rpm))) : 1;

const normalizeWindowMs = (windowMs: number | undefined): number =>
    Number.isFinite(windowMs) && (windowMs as number) > 0 ? (windowMs as number) : DEFAULT_WINDOW_MS;

const abortAwareSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        const onAbort = () => {
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
        };
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };
        signal?.addEventListener('abort', onAbort);
    });

export const createRateLimiter = (initial: RateLimiterConfig): RateLimiter => {
    let config: Required<RateLimiterConfig> = {
        enabled: initial.enabled,
        rpm: clampRpm(initial.rpm),
        windowMs: normalizeWindowMs(initial.windowMs),
    };
    let windowStart = 0; // start time of the current batch's window (0 = no active window)
    let count = 0;       // requests granted in the current window
    // Serialises slot acquisition so parallel callers can't all read the same
    // window state and overshoot the batch. Tasks still run concurrently once granted.
    let gate: Promise<void> = Promise.resolve();

    const acquireSlot = (signal?: AbortSignal): Promise<void> => {
        const run = async (): Promise<void> => {
            for (;;) {
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                const now = Date.now();

                // Fresh window: grant immediately and start the clock.
                if (count === 0) {
                    windowStart = now;
                    count = 1;
                    return;
                }
                // Still room in the current batch: grant immediately.
                if (count < config.rpm) {
                    count += 1;
                    return;
                }
                // Window full: wait out the rest period, then reset and re-evaluate.
                const waitMs = windowStart + config.windowMs - now;
                if (waitMs <= 0) {
                    count = 0;
                    windowStart = 0;
                    continue;
                }
                await abortAwareSleep(waitMs, signal);
            }
        };

        // Chain onto the gate (regardless of how the previous link settled) so
        // acquisitions are strictly serialised, then keep the gate from being
        // poisoned by a rejection.
        const next = gate.then(run, run);
        gate = next.then(() => undefined, () => undefined);
        return next;
    };

    return {
        schedule: async <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
            if (!config.enabled) return task();
            await acquireSlot(signal);
            return task();
        },
        configure: (nextConfig) => {
            if (nextConfig.enabled !== undefined) config.enabled = nextConfig.enabled;
            if (nextConfig.rpm !== undefined) config.rpm = clampRpm(nextConfig.rpm);
            if (nextConfig.windowMs !== undefined) config.windowMs = normalizeWindowMs(nextConfig.windowMs);
        },
        getConfig: () => ({ ...config }),
        reset: () => {
            count = 0;
            windowStart = 0;
            gate = Promise.resolve();
        },
    };
};

// Shared singleton used by the World Model pipeline. Defaults mirror the UI
// defaults (enabled, 5 RPM) with a 2-minute window; the active turn reconfigures
// enabled/rpm from settings.
export const worldModelRateLimiter = createRateLimiter({ enabled: true, rpm: 5 });
