import { describe, it, expect } from 'vitest';
import {
    prepareWireMessages,
    ProxyMessage,
    CACHE_PRIORITY,
    MAX_CACHE_BREAKPOINTS,
} from '../../services/proxy/prompts';

/** Comfortably above the ~1024-token minimum a breakpoint needs to be worth placing. */
const big = (label: string) => `${label} `.repeat(2000);

const cacheControlOf = (message: any): any => {
    if (typeof message.content === 'string') return undefined;
    return message.content.find((part: any) => part.cache_control)?.cache_control;
};

const breakpointIndices = (messages: any[]): number[] =>
    messages.map((m, i) => (cacheControlOf(m) ? i : -1)).filter(i => i >= 0);

describe('prepareWireMessages', () => {
    it('strips the internal cache fields from every message on the wire', () => {
        const messages: ProxyMessage[] = [
            { role: 'system', content: big('sys'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
            { role: 'user', content: 'hi' },
        ];
        const wire = prepareWireMessages(messages, 'claude-sonnet-4-5', true);
        expect(wire.every(m => !('cache' in m) && !('cachePriority' in m))).toBe(true);
    });

    it('converts a marked string message into a cache_control text part', () => {
        const wire = prepareWireMessages(
            [{ role: 'system', content: big('sys'), cache: true }],
            'claude-sonnet-4-5',
            true
        );
        const parts = wire[0].content as any[];
        expect(parts).toHaveLength(1);
        expect(parts[0].type).toBe('text');
        expect(parts[0].text).toBe(big('sys'));
        expect(parts[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('marks the LAST text part when content is an array, leaving images untouched', () => {
        const wire = prepareWireMessages(
            [{
                role: 'user',
                cache: true,
                content: [
                    { type: 'text', text: big('first') },
                    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
                    { type: 'text', text: 'last' },
                ],
            }],
            'anthropic/claude-opus-4',
            true
        );
        const parts = wire[0].content as any[];
        expect(parts[0].cache_control).toBeUndefined();
        expect(parts[1].cache_control).toBeUndefined();
        expect(parts[2].cache_control).toEqual({ type: 'ephemeral' });
        expect(parts[1].image_url).toEqual({ url: 'data:image/png;base64,AAA' });
    });

    it('does not mutate the input messages', () => {
        const input: ProxyMessage[] = [{ role: 'system', content: big('sys'), cache: true }];
        prepareWireMessages(input, 'claude-sonnet-4-5', true);
        expect(input[0].content).toBe(big('sys'));
        expect(input[0].cache).toBe(true);
    });

    describe('provider gating', () => {
        it.each([
            ['claude-sonnet-4-5', true],
            ['anthropic/claude-opus-4.1', true],
            ['CLAUDE-HAIKU', true],
            ['minimax/minimax-m3', false],
            ['gemini-3.1-pro-preview', false],
            ['deepseek-ai/deepseek-v4-pro', false],
            ['', false],
        ])('model %s → breakpoints emitted: %s', (model, expected) => {
            const wire = prepareWireMessages(
                [{ role: 'system', content: big('sys'), cache: true }],
                model as string,
                true
            );
            expect(breakpointIndices(wire).length > 0).toBe(expected);
        });

        it('emits nothing when caching is disabled, even on Anthropic', () => {
            const wire = prepareWireMessages(
                [{ role: 'system', content: big('sys'), cache: true }],
                'claude-sonnet-4-5',
                false
            );
            expect(breakpointIndices(wire)).toEqual([]);
            expect(wire[0].content).toBe(big('sys'));
        });

        it('treats an omitted flag as disabled', () => {
            const wire = prepareWireMessages(
                [{ role: 'system', content: big('sys'), cache: true }],
                'claude-sonnet-4-5'
            );
            expect(breakpointIndices(wire)).toEqual([]);
        });
    });

    describe('minimum cacheable prefix', () => {
        it('drops a mark whose prefix is too short to be cached at all', () => {
            const wire = prepareWireMessages(
                [{ role: 'system', content: 'short system prompt', cache: true }],
                'claude-sonnet-4-5',
                true
            );
            expect(breakpointIndices(wire)).toEqual([]);
            expect(wire[0].content).toBe('short system prompt');
        });

        it('keeps a later mark once the accumulated prefix is large enough', () => {
            const wire = prepareWireMessages(
                [
                    { role: 'system', content: 'short system prompt', cache: true },
                    { role: 'user', content: big('history') },
                    { role: 'assistant', content: 'reply', cache: true },
                ],
                'claude-sonnet-4-5',
                true
            );
            expect(breakpointIndices(wire)).toEqual([2]);
        });

        it('counts inline image payloads toward the prefix size', () => {
            // The image precedes the marked text part, so it is inside the segment
            // the breakpoint covers and must count toward the size test.
            const wire = prepareWireMessages(
                [{
                    role: 'user',
                    cache: true,
                    content: [
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(8000)}` } },
                        { type: 'text', text: 'avatar' },
                    ],
                }],
                'claude-sonnet-4-5',
                true
            );
            expect(breakpointIndices(wire)).toEqual([0]);
        });

        it('ignores payload that sits after the marked part', () => {
            // cache_control covers everything up to and including its own block, so
            // a trailing image is outside the segment and cannot rescue a tiny prefix.
            const wire = prepareWireMessages(
                [{
                    role: 'user',
                    cache: true,
                    content: [
                        { type: 'text', text: 'avatar' },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${'A'.repeat(8000)}` } },
                    ],
                }],
                'claude-sonnet-4-5',
                true
            );
            expect(breakpointIndices(wire)).toEqual([]);
        });
    });

    describe('breakpoint budget', () => {
        it('never emits more than the provider limit', () => {
            const messages: ProxyMessage[] = Array.from({ length: 7 }, (_, i) => ({
                role: 'user' as const,
                content: big(`msg${i}`),
                cache: true,
            }));
            const wire = prepareWireMessages(messages, 'claude-sonnet-4-5', true);
            expect(breakpointIndices(wire)).toHaveLength(MAX_CACHE_BREAKPOINTS);
        });

        it('keeps stable-prefix marks over rotating history marks when over budget', () => {
            const messages: ProxyMessage[] = [
                { role: 'system', content: big('card'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
                { role: 'system', content: big('bible'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
                { role: 'system', content: big('notes'), cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX },
                { role: 'user', content: big('older'), cache: true, cachePriority: CACHE_PRIORITY.HISTORY_DEPTH },
                { role: 'assistant', content: big('newest'), cache: true, cachePriority: CACHE_PRIORITY.HISTORY_HEAD },
            ];
            const wire = prepareWireMessages(messages, 'claude-sonnet-4-5', true);
            // 3 stable blocks + the history head; the depth-2 mark is the one dropped.
            expect(breakpointIndices(wire)).toEqual([0, 1, 2, 4]);
        });
    });
});
