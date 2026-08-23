import { describe, it, expect } from 'vitest';
import { buildProxyMessages, prepareWireMessages, ProxyMessage } from '../../services/proxy/prompts';
import { StoryTurn } from '../../types';

// Light mode is the primary path — these tests pin its current prompt shape so
// World Model caching work can't quietly change it.

const turn = (i: number, isPlayer: boolean): StoryTurn => ({
    id: `t${i}`,
    text: isPlayer ? `player line ${i}` : `narrator line ${i}`,
    isPlayer,
});

const makeHistory = (count: number): StoryTurn[] =>
    Array.from({ length: count }, (_, i) => turn(i, i % 2 === 0));

const build = (history: StoryTurn[], contextTurns: number, options = {}) =>
    buildProxyMessages(history, contextTurns, 'Char', 'Player', 'SYSTEM', undefined, undefined, options);

const marked = (messages: ProxyMessage[]): number[] =>
    messages.map((m, i) => (m.cache ? i : -1)).filter(i => i >= 0);

describe('buildProxyMessages — prompt order', () => {
    it('puts the system instruction first and marks it for caching', () => {
        const messages = build(makeHistory(2), 0);
        expect(messages[0].role).toBe('system');
        expect(messages[0].content).toBe('SYSTEM');
        expect(messages[0].cache).toBe(true);
    });

    it('places avatars in the stable prefix, before the history', () => {
        const messages = build(makeHistory(2), 0, {
            userAvatarUrl: 'data:image/png;base64,USER',
            charAvatarUrl: 'data:image/png;base64,CHAR',
            userName: 'Player',
            charName: 'Char',
        });
        expect(messages[1].content).toEqual([
            { type: 'text', text: "Player's appearance:" },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,USER' } },
        ]);
        expect(messages[2].content).toEqual([
            { type: 'text', text: "Char's appearance:" },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,CHAR' } },
        ]);
        expect(messages[3].content).toBe('player line 0');
    });

    it('drops avatars and inline images when ignoreImages is set', () => {
        const history = [{ ...turn(0, true), image: 'data:image/png;base64,INLINE' }];
        const messages = build(history, 0, {
            userAvatarUrl: 'data:image/png;base64,USER',
            ignoreImages: true,
        });
        expect(messages).toHaveLength(2);
        expect(messages[1].content).toBe('player line 0');
    });

    it('keeps the volatile tail in one trailing user message', () => {
        const messages = build(makeHistory(4), 0, {
            keywordWorldInfo: 'KEYWORD_LORE',
            manualScenarios: 'MANUAL_SCENARIO',
            playerNotes: 'MY NOTES',
            postHistoryInstruction: 'POST HISTORY',
        });
        const tail = messages[messages.length - 1];

        expect(tail.role).toBe('user');
        expect(tail.cache).toBeUndefined();
        expect(tail.content).toBe(
            '<Notes>\nMY NOTES\n</Notes>\n\nKEYWORD_LORE\n\nPOST HISTORY'
        );
        // Only one tail message — a second one would buy no cache and cost a turn.
        expect(messages.filter(m => m.role === 'user' && String(m.content).includes('POST HISTORY')))
            .toHaveLength(1);
    });

    it('never marks the tail for caching', () => {
        // The tail follows the history, which grows every turn, so a breakpoint here
        // could only ever be written — never read.
        const messages = build(makeHistory(4), 0, {
            keywordWorldInfo: 'KEYWORD_LORE',
            playerNotes: 'MY NOTES',
            postHistoryInstruction: 'POST HISTORY',
        });
        expect(messages[messages.length - 1].cache).toBeUndefined();
    });

    it('puts manual scenarios in the prefix but keeps volatile blocks out', () => {
        const messages = build(makeHistory(4), 0, {
            keywordWorldInfo: 'KEYWORD_LORE',
            playerNotes: 'MY NOTES',
            manualScenarios: 'MANUAL_SCENARIO',
            postHistoryInstruction: 'POST HISTORY',
        });
        const prefix = messages.slice(0, -1).map(m => String(m.content)).join('\n');
        expect(prefix).not.toContain('KEYWORD_LORE');
        expect(prefix).not.toContain('MY NOTES');
        expect(prefix).toContain('MANUAL_SCENARIO');
        expect(messages[1].content).toBe('MANUAL_SCENARIO');
        expect(messages[2].content).toBe('player line 0');
    });

    it('keeps unchanged manual scenarios byte-identical ahead of growing history', () => {
        const before = build(makeHistory(4), 0, { manualScenarios: 'SCENARIO' });
        const after = build(makeHistory(6), 0, { manualScenarios: 'SCENARIO' });
        expect(after.slice(0, 2).map(m => m.content))
            .toEqual(before.slice(0, 2).map(m => m.content));
        expect(before[1].cache).toBe(true);
    });

    it('leaves the cached prefix untouched when notes are edited', () => {
        const base = { keywordWorldInfo: 'LORE', postHistoryInstruction: 'POST HISTORY' };
        const before = build(makeHistory(6), 0, { ...base, playerNotes: 'NOTES A' });
        const after = build(makeHistory(6), 0, { ...base, playerNotes: 'NOTES B' });

        // System + history are byte-identical — an edit costs only the tail.
        expect(after.slice(0, -1).map(m => m.content)).toEqual(before.slice(0, -1).map(m => m.content));
        expect(after[after.length - 1].content).not.toBe(before[before.length - 1].content);
    });

    it('resolves {{user}}/{{char}} placeholders in both history and tail', () => {
        const history: StoryTurn[] = [{ id: 'a', text: '{{user}} greets {{char}}', isPlayer: true }];
        const messages = build(history, 0, { keywordWorldInfo: '{{char}} lore for {{user}}' });
        expect(messages[1].content).toBe('Player greets Char');
        expect(messages[messages.length - 1].content).toBe('Char lore for Player');
    });
});

describe('buildProxyMessages — stepped history window', () => {
    it('returns the whole history when it fits the window', () => {
        const messages = build(makeHistory(5), 10);
        expect(messages).toHaveLength(6); // system + 5 turns
    });

    it('holds the window start still between step advances when caching is active', () => {
        // contextTurns=10, cachingActive → step = max(8, ceil(10/2)) = 8
        const startsFor = (length: number) => {
            const messages = build(makeHistory(length), 10, { cachingActive: true });
            return messages[1].content;
        };
        expect(startsFor(12)).toBe('player line 0');
        expect(startsFor(17)).toBe('player line 0');
        expect(startsFor(18)).toBe('player line 8');
        expect(startsFor(25)).toBe('player line 8');
        expect(startsFor(26)).toBe('player line 16');
    });

    it('resets the history prefix at most once every four turns when caching is active', () => {
        // A turn appends two messages (player + model). Counting resets over a
        // long run is the number that actually decides the cache hit rate.
        let resets = 0;
        let previousStart: unknown = null;
        const turns = 40;
        for (let turn = 1; turn <= turns; turn += 1) {
            const messages = build(makeHistory(turn * 2), 10, { cachingActive: true });
            const start = messages[1].content;
            if (previousStart !== null && start !== previousStart) resets += 1;
            previousStart = start;
        }
        expect(resets).toBeGreaterThan(0);
        expect(resets).toBeLessThanOrEqual(turns / 4);
    });

    it('keeps the tighter window when no cache is in play', () => {
        // Without a cache the wider window would just re-send more messages at
        // full price every turn, so the pre-caching step is kept.
        const cached = build(makeHistory(40), 10, { cachingActive: true });
        const uncached = build(makeHistory(40), 10);
        expect(uncached.length).toBeLessThanOrEqual(cached.length);
        expect(uncached.length - 1).toBeGreaterThanOrEqual(10);
    });

    it('never drops below the requested number of turns', () => {
        for (let length = 10; length <= 40; length += 1) {
            const messages = build(makeHistory(length), 10);
            const historyCount = messages.length - 1;
            expect(historyCount).toBeGreaterThanOrEqual(10);
            expect(historyCount).toBeLessThan(10 + 8);
        }
    });
});

describe('buildProxyMessages — cache breakpoints', () => {
    it('marks the system prompt, the newest turn and the depth-2 turn', () => {
        const messages = build(makeHistory(6), 0);
        // system(0) + 6 turns(1..6): newest = 6, depth-2 = 4
        expect(marked(messages)).toEqual([0, 4, 6]);
    });

    it('marks only what exists on a short history', () => {
        expect(marked(build(makeHistory(1), 0))).toEqual([0, 1]);
        expect(marked(build(makeHistory(2), 0))).toEqual([0, 2]);
        expect(marked(build(makeHistory(3), 0))).toEqual([0, 1, 3]);
    });

    it('marks only the system prompt when there is no history', () => {
        expect(marked(build([], 0))).toEqual([0]);
    });

    it('keeps the breakpoint count within the provider budget', () => {
        const messages = build(makeHistory(40), 20, {
            userAvatarUrl: 'data:image/png;base64,USER',
            charAvatarUrl: 'data:image/png;base64,CHAR',
            keywordWorldInfo: 'LORE',
        });
        expect(marked(messages).length).toBeLessThanOrEqual(4);
    });

    it("today's newest mark becomes tomorrow's readable prefix", () => {
        const history = makeHistory(6);
        const before = build(history, 0);
        const after = build([...history, turn(6, true), turn(7, false)], 0);
        const newestBefore = marked(before).at(-1)!;
        // The message that carried the mark last turn is untouched this turn, so
        // the whole prefix up to and including it is still a cache hit.
        expect(after.slice(0, newestBefore + 1).map(m => m.content))
            .toEqual(before.slice(0, newestBefore + 1).map(m => m.content));
    });
});

describe('buildProxyMessages — wire output', () => {
    // Realistic sizes: breakpoints below the provider's minimum cacheable prefix
    // are deliberately dropped, so a toy-sized prompt would emit none at all.
    const bulkyHistory = (count: number): StoryTurn[] =>
        Array.from({ length: count }, (_, i) => ({
            id: `t${i}`,
            text: `${i % 2 === 0 ? 'player' : 'narrator'} line ${i} `.repeat(60),
            isPlayer: i % 2 === 0,
        }));

    it('produces at most 4 cache_control blocks for Anthropic', () => {
        const messages = build(bulkyHistory(30), 20, { keywordWorldInfo: 'LORE' });
        const wire = prepareWireMessages(messages, 'claude-sonnet-4-5', true);
        const count = wire.filter(m =>
            Array.isArray(m.content) && m.content.some((p: any) => p.cache_control)
        ).length;
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(4);
    });

    it('emits no cache_control for non-Anthropic models', () => {
        const messages = build(bulkyHistory(30), 20);
        const wire = prepareWireMessages(messages, 'minimax/minimax-m3', true);
        expect(JSON.stringify(wire)).not.toContain('cache_control');
    });
});
