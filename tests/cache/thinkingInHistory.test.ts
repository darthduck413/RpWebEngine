import { describe, it, expect } from 'vitest';
import { buildProxyMessages, ProxyMessage } from '../../services/proxy/prompts';
import { StoryTurn } from '../../types';

// The active proxy API preset decides whether the model's own
// reasoning is echoed back to it. Default OFF: a leak here would put raw
// chain-of-thought into every prompt, so the off-path is pinned as hard as the on-path.

const history: StoryTurn[] = [
    { id: '1', isPlayer: true, text: 'player one' },
    { id: '2', isPlayer: false, text: '<think>SECRET ONE</think>\n\nnarrator one' },
    { id: '3', isPlayer: true, text: 'player two' },
    { id: '4', isPlayer: false, text: '<think>SECRET TWO</think>\n\nnarrator two' },
    { id: '5', isPlayer: true, text: 'player three' },
];

const build = (turns: StoryTurn[], options = {}) =>
    buildProxyMessages(turns, 0, 'Char', 'Player', 'SYSTEM', undefined, undefined, options);

const dump = (messages: ProxyMessage[]): string =>
    messages.map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n---\n');

describe('buildProxyMessages — thinking off (default)', () => {
    it('strips every <think> block when the option is absent', () => {
        const text = dump(build(history));
        expect(text).not.toContain('<think');
        expect(text).not.toContain('SECRET');
        expect(text).toContain('narrator one');
        expect(text).toContain('narrator two');
    });

    it('strips every <think> block when the option is explicitly false', () => {
        const text = dump(build(history, { includeThinkingInHistory: false }));
        expect(text).not.toContain('<think');
        expect(text).not.toContain('SECRET');
    });
});

describe('buildProxyMessages — thinking on', () => {
    const on = { includeThinkingInHistory: true };

    it('keeps the reasoning of every model turn in the window, not just the newest', () => {
        const text = dump(build(history, on));
        expect(text).toContain('SECRET ONE');
        expect(text).toContain('SECRET TWO');
        expect((text.match(/<think>/g) ?? []).length).toBe(2);
    });

    it('leaves the visible narration intact alongside the reasoning', () => {
        const messages = build(history, on);
        expect(messages[2].content).toBe('<think>SECRET ONE</think>\n\nnarrator one');
    });

    it('never keeps a <think> block written by the player', () => {
        // Defence in depth: only the model's own reasoning is ever echoed back, so a
        // <think> the user typed (or pasted into an edit) is still stripped.
        const withPlayerThink: StoryTurn[] = [
            { id: '1', isPlayer: true, text: '<think>USER SECRET</think>\n\nplayer one' },
            { id: '2', isPlayer: false, text: '<think>MODEL SECRET</think>\n\nnarrator one' },
        ];
        const text = dump(build(withPlayerThink, on));
        expect(text).not.toContain('USER SECRET');
        expect(text).toContain('MODEL SECRET');
    });

    it('still strips inline story images from the kept turn', () => {
        const withImage: StoryTurn[] = [
            { id: '1', isPlayer: false, text: '<think>SECRET</think>\n\nnarrator ![alt](https://example.com/a.png) line' },
        ];
        const text = dump(build(withImage, on));
        expect(text).toContain('SECRET');
        expect(text).not.toContain('example.com');
    });
});

describe('buildProxyMessages — thinking on, prompt cache', () => {
    // Keeping the reasoning on ALL model turns (rather than only the newest) is what
    // makes the history append-only: last-turn-only would rewrite the previous turn's
    // bytes and miss the cached prefix on every single turn.
    it('leaves the previous turn byte-identical as the history grows', () => {
        const on = { includeThinkingInHistory: true };
        const before = build(history, on);
        const after = build(
            [...history, { id: '6', isPlayer: false, text: '<think>SECRET THREE</think>\n\nnarrator three' }],
            on
        );
        expect(after.slice(0, before.length).map(m => m.content))
            .toEqual(before.map(m => m.content));
    });
});
