import { describe, it, expect } from 'vitest';
import { buildProxyMessages } from '../../services/proxy/prompts';
import { buildContentHistory } from '../../services/gemini/prompts';
import { buildSystemInstruction } from '../../services/common/prompts';
import { CONTEXT_TEMPLATE_PART } from '../../constants';
import { StoryTurn } from '../../types';

// Player notes moved out of the system instruction into the prompt tail.
// Two things must hold forever: they are still sent, and they are sent exactly once.

const history: StoryTurn[] = [
    { id: 't0', text: 'player line', isPlayer: true },
    { id: 't1', text: 'narrator line', isPlayer: false },
];

const NOTES = 'Alex distrusts the envoy and is protecting Mira.';

const proxyMessages = (notes: string, systemInstruction = 'SYSTEM') =>
    buildProxyMessages(history, 0, 'Char', 'Player', systemInstruction, undefined, undefined, {
        playerNotes: notes,
        keywordWorldInfo: 'LORE',
        postHistoryInstruction: 'POST HISTORY',
    });

const geminiContents = (notes: string) =>
    buildContentHistory(history, 0, 'Char', 'Player', undefined, {
        playerNotes: notes,
        keywordWorldInfo: 'LORE',
        postHistoryInstruction: 'POST HISTORY',
    });

const textOf = (content: unknown): string =>
    typeof content === 'string' ? content : JSON.stringify(content);

describe('player notes placement', () => {
    it('are still sent on the proxy path', () => {
        const serialized = JSON.stringify(proxyMessages(NOTES));
        expect(serialized).toContain(NOTES);
    });

    it('are still sent on the gemini path', () => {
        const serialized = JSON.stringify(geminiContents(NOTES));
        expect(serialized).toContain(NOTES);
    });

    it('appear exactly once', () => {
        const occurrences = JSON.stringify(proxyMessages(NOTES)).split(NOTES).length - 1;
        expect(occurrences).toBe(1);
    });

    it('are not in the system message any more', () => {
        const messages = proxyMessages(NOTES);
        expect(messages[0].role).toBe('system');
        expect(textOf(messages[0].content)).not.toContain(NOTES);
    });

    it('sit in the tail, ordered ahead of keyword lore and explicit Post History', () => {
        const tail = textOf(proxyMessages(NOTES).at(-1)!.content);
        expect(tail).toContain(NOTES);
        expect(tail.indexOf(NOTES)).toBeLessThan(tail.indexOf('LORE'));
        expect(tail.indexOf(NOTES)).toBeLessThan(tail.indexOf('POST HISTORY'));
    });

    it('keep their <Notes> wrapper so the model still sees a labelled block', () => {
        const messages = proxyMessages(NOTES);
        expect(textOf(messages[messages.length - 1].content)).toContain(`<Notes>\n${NOTES}\n</Notes>`);
    });

    it('are omitted entirely when empty', () => {
        const serialized = JSON.stringify(proxyMessages('   '));
        expect(serialized).not.toContain('<Notes>');
    });

    it('ignore a {{PLAYER_NOTES}} placeholder in a legacy or hand-edited template', () => {
        // There is exactly one placement and it is not configurable: anywhere in
        // the system instruction, an edit to the notes invalidates the card and
        // the whole history behind it. The placeholder resolves to nothing.
        const legacyTemplate = 'ROLE\n\n<Notes>\n{{PLAYER_NOTES}}\n</Notes>';
        const system = buildSystemInstruction(
            legacyTemplate, '', 'SETTING', 'PERSONALITY', 'DESC', 'Char', 'Player', '', ''
        );
        expect(system).not.toContain('{{PLAYER_NOTES}}');
        expect(system).not.toContain(NOTES);
    });

    it('are sent once — and from the tail — even under such a template', () => {
        const legacySystem = buildSystemInstruction(
            'ROLE\n\n<Notes>\n{{PLAYER_NOTES}}\n</Notes>', '',
            'SETTING', 'PERSONALITY', 'DESC', 'Char', 'Player', '', ''
        );
        const messages = proxyMessages(NOTES, legacySystem);
        expect(JSON.stringify(messages).split(NOTES).length - 1).toBe(1);
        expect(textOf(messages[0].content)).not.toContain(NOTES);
        expect(textOf(messages[messages.length - 1].content)).toContain(NOTES);
    });

    it('no longer has a notes block in the shipped template', () => {
        expect(CONTEXT_TEMPLATE_PART).not.toContain('{{PLAYER_NOTES}}');
        expect(CONTEXT_TEMPLATE_PART).toContain('{{PLAYER_DESCRIPTION}}');
    });
});

describe('player notes and the cache', () => {
    it('editing them leaves the system message untouched', () => {
        const before = proxyMessages('NOTES A');
        const after = proxyMessages('NOTES B');
        expect(textOf(after[0].content)).toBe(textOf(before[0].content));
    });

    it('editing them leaves the history untouched', () => {
        const before = proxyMessages('NOTES A');
        const after = proxyMessages('NOTES B');
        expect(after.slice(1, -1).map(m => textOf(m.content)))
            .toEqual(before.slice(1, -1).map(m => textOf(m.content)));
    });

    it('produces the same layout on both providers', () => {
        const proxyTail = textOf(proxyMessages(NOTES).at(-1)!.content);
        const geminiTail = geminiContents(NOTES).at(-1)!.parts![0].text;
        expect(geminiTail).toBe(proxyTail);
    });
});
