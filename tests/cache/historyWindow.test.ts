import { describe, it, expect } from 'vitest';
import {
    applyHistoryWindow,
    resolveHistoryWindowStart,
    resolveHistoryWindowStep,
    MIN_HISTORY_WINDOW_STEP,
} from '../../services/common/historyWindow';

const messages = (count: number) => Array.from({ length: count }, (_, i) => `m${i}`);

describe('history window', () => {
    it('returns the whole history when it fits', () => {
        expect(applyHistoryWindow(messages(8), 10)).toHaveLength(8);
        expect(applyHistoryWindow(messages(10), 10)).toHaveLength(10);
    });

    it('treats contextTurns <= 0 as "send everything"', () => {
        expect(applyHistoryWindow(messages(50), 0)).toHaveLength(50);
        expect(applyHistoryWindow(messages(50), -1)).toHaveLength(50);
    });

    it('never sends fewer messages than requested', () => {
        for (let length = 1; length <= 200; length += 1) {
            const windowed = applyHistoryWindow(messages(length), 20, true);
            expect(windowed.length).toBeGreaterThanOrEqual(Math.min(length, 20));
        }
    });

    it('caps the overshoot at one step', () => {
        const step = resolveHistoryWindowStep(20, true);
        for (let length = 20; length <= 200; length += 1) {
            expect(applyHistoryWindow(messages(length), 20, true).length).toBeLessThan(20 + step);
        }
    });

    it('advances the start only in whole steps', () => {
        const step = resolveHistoryWindowStep(20, true);
        for (let length = 20; length <= 200; length += 1) {
            expect(resolveHistoryWindowStart(length, 20, true) % step).toBe(0);
        }
    });

    it('never moves the start backwards as history grows', () => {
        let previous = 0;
        for (let length = 1; length <= 300; length += 1) {
            const start = resolveHistoryWindowStart(length, 20, true);
            expect(start).toBeGreaterThanOrEqual(previous);
            previous = start;
        }
    });

    it('keeps the prefix byte-identical between advances', () => {
        const step = resolveHistoryWindowStep(20, true);
        const first = applyHistoryWindow(messages(30), 20, true)[0];
        for (let length = 30; length < 30 + step; length += 1) {
            const start = resolveHistoryWindowStart(length, 20, true);
            const prevStart = resolveHistoryWindowStart(30, 20, true);
            if (start === prevStart) {
                expect(applyHistoryWindow(messages(length), 20, true)[0]).toBe(first);
            }
        }
    });

    describe('step sizing with caching active', () => {
        it('never goes below the floor', () => {
            expect(resolveHistoryWindowStep(1, true)).toBe(MIN_HISTORY_WINDOW_STEP);
            expect(resolveHistoryWindowStep(10, true)).toBe(MIN_HISTORY_WINDOW_STEP);
        });

        it('scales with the window so long chats reset proportionally rarely', () => {
            expect(resolveHistoryWindowStep(20, true)).toBe(10);
            expect(resolveHistoryWindowStep(40, true)).toBe(20);
            expect(resolveHistoryWindowStep(100, true)).toBe(50);
        });

        it('resets no more than once every four turns at any window size', () => {
            // Two messages per turn; a reset costs the whole history segment.
            for (const contextTurns of [10, 20, 30, 40, 60]) {
                const turnsBetweenResets = resolveHistoryWindowStep(contextTurns, true) / 2;
                expect(turnsBetweenResets).toBeGreaterThanOrEqual(4);
            }
        });
    });

    describe('step sizing without caching', () => {
        it('keeps the tighter pre-caching step', () => {
            // Widening the window only pays for itself when a cache preserves it;
            // with no cache the extra messages are billed in full every turn.
            expect(resolveHistoryWindowStep(10, false)).toBe(4);
            expect(resolveHistoryWindowStep(20, false)).toBe(4);
            expect(resolveHistoryWindowStep(40, false)).toBe(8);
            expect(resolveHistoryWindowStep(100, false)).toBe(20);
        });

        it('defaults to the uncached step when the flag is omitted', () => {
            expect(resolveHistoryWindowStep(20)).toBe(resolveHistoryWindowStep(20, false));
        });

        it('never carries more surplus than the cached mode', () => {
            for (const contextTurns of [10, 20, 40, 100]) {
                expect(resolveHistoryWindowStep(contextTurns, false))
                    .toBeLessThanOrEqual(resolveHistoryWindowStep(contextTurns, true));
            }
        });

        it('sends fewer messages than cached mode for the same history', () => {
            const uncached = applyHistoryWindow(messages(60), 20, false);
            const cached = applyHistoryWindow(messages(60), 20, true);
            expect(uncached.length).toBeLessThanOrEqual(cached.length);
            expect(uncached.length).toBeGreaterThanOrEqual(20);
        });
    });
});
