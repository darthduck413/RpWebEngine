import { describe, it, expect } from 'vitest';
import { composeWorldInfo } from '../../services/common/worldInfo';
import { buildSystemInstruction } from '../../services/common/prompts';
import { buildProxyMessages, buildBlockSystemMessage, prepareWireMessages } from '../../services/proxy/prompts';
import { LoreEntry, StoryTurn } from '../../types';

// Everything the cache does rests on one property: identical inputs must produce
// byte-identical prompt text. These tests guard that property directly, because a
// single non-deterministic join or ordering would silently zero out the hit rate.

const turn = (i: number, text: string, isPlayer = i % 2 === 0): StoryTurn =>
    ({ id: `t${i}`, text, isPlayer });

const loreBook: LoreEntry[] = [
    { id: 'ashe', name: 'Ashe', type: 'character', content: 'Ashe profile '.repeat(20), keys: ['Ashe'] },
    { id: 'rey', name: 'Rey', type: 'character', content: 'Rey profile '.repeat(20), keys: ['Rey'] },
    { id: 'lihan', name: 'Lihan', type: 'character', content: 'Lihan profile '.repeat(20), keys: ['Lihan'] },
    { id: 'index', name: 'Cast', type: 'setting', content: 'Always-on cast index '.repeat(20) },
];

describe('World Info determinism', () => {
    it('produces identical text for the same active set', () => {
        const history = [turn(0, 'Ashe and Rey enter the hall.'), turn(1, 'Rey nods at Ashe.')];
        const a = composeWorldInfo(loreBook, history, undefined, [], undefined, 'keyword');
        const b = composeWorldInfo(loreBook, history, undefined, [], undefined, 'keyword');
        expect(a).toBe(b);
        expect(a).toContain('Ashe');
        expect(a).toContain('Rey');
    });

    it('keeps entry order stable regardless of who was mentioned most recently', () => {
        const reyFirst = composeWorldInfo(
            loreBook, [turn(0, 'Rey speaks.'), turn(1, 'Ashe answers.')], undefined, [], undefined, 'keyword'
        );
        const asheFirst = composeWorldInfo(
            loreBook, [turn(0, 'Ashe speaks.'), turn(1, 'Rey answers.')], undefined, [], undefined, 'keyword'
        );
        // Same two entries active → same bytes, whatever order they were named in.
        expect(reyFirst).toBe(asheFirst);
    });

    it('keeps the always-on tier independent of the conversation', () => {
        const early = composeWorldInfo(loreBook, [turn(0, 'nothing')], undefined, [], undefined, 'always');
        const later = composeWorldInfo(
            loreBook,
            Array.from({ length: 20 }, (_, i) => turn(i, `Ashe Rey Lihan line ${i}`)),
            undefined, [], undefined, 'always'
        );
        expect(early).toBe(later);
    });
});

describe('system instruction determinism', () => {
    const build = (notes: string) => buildSystemInstruction(
        '<Persona>{{PERSONALITY}}</Persona>\n<Setting>{{SETTING}}</Setting>\n<Notes>{{PLAYER_NOTES}}</Notes>',
        notes, 'SETTING', 'PERSONALITY', 'DESC', 'Char', 'Player', '', ''
    );

    it('is stable across calls', () => {
        expect(build('NOTES')).toBe(build('NOTES'));
    });

    it('changes only where the notes are', () => {
        const before = build('NOTES A');
        const after = build('NOTES B');
        const prefixLength = [...before].findIndex((ch, i) => ch !== after[i]);
        // Everything before the notes block is untouched — that is the part worth caching.
        expect(before.slice(0, prefixLength)).toBe(after.slice(0, prefixLength));
        expect(before.slice(0, prefixLength)).toContain('PERSONALITY');
        expect(before.slice(0, prefixLength)).toContain('SETTING');
    });
});

describe('light-mode prompt determinism', () => {
    const history = Array.from({ length: 12 }, (_, i) => turn(i, `line ${i} `.repeat(30)));

    const build = (extra = {}) => buildProxyMessages(
        history, 0, 'Char', 'Player', 'SYSTEM '.repeat(600), undefined, undefined,
        { keywordWorldInfo: 'LORE', postHistoryInstruction: 'POST HISTORY', ...extra }
    );

    it('is byte-identical across repeated builds', () => {
        expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    });

    it('sends exactly one system message and one trailing user message', () => {
        const messages = build();
        expect(messages.filter(m => m.role === 'system')).toHaveLength(1);
        expect(messages[0].role).toBe('system');
        expect(messages.at(-1)!.role).toBe('user');
    });

    it('emits no internal fields on the wire for a non-Anthropic provider', () => {
        const wire = prepareWireMessages(build(), 'minimax/minimax-m3', true);
        const serialized = JSON.stringify(wire);
        expect(serialized).not.toContain('cachePriority');
        expect(serialized).not.toContain('"cache"');
        expect(serialized).not.toContain('cache_control');
        // System stays a plain string, exactly as before the block work.
        expect(typeof wire[0].content).toBe('string');
    });
});

describe('block system message edge cases', () => {
    it('degrades to an empty string rather than an empty content array', () => {
        const message = buildBlockSystemMessage([]);
        expect(message.content).toBe('');
    });

    it('survives a blocks list where only the role has text', () => {
        const message = buildBlockSystemMessage([
            { id: 'world', text: '', cacheable: true },
            { id: 'role', text: 'ROLE', cacheable: false },
        ]);
        const wire = prepareWireMessages([message], 'claude-sonnet-4-5', true);
        expect(wire[0].content).toBe('ROLE');
    });
});
