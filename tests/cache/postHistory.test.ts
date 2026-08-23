import { describe, expect, it } from 'vitest';
import { buildContentHistory } from '../../services/gemini/prompts';
import { buildProxyMessages } from '../../services/proxy/prompts';
import { StoryTurn } from '../../types';

const history: StoryTurn[] = [
    { id: 't0', text: 'Player walks in', isPlayer: true },
    { id: 't1', text: 'Char looks up', isPlayer: false },
    { id: 't2', text: 'Player sits down', isPlayer: true },
];

const proxy = (options: Record<string, unknown> = {}) =>
    buildProxyMessages(history, 0, 'Char', 'Player', 'SYSTEM', undefined, undefined, options as any);

const gemini = (options: Record<string, unknown> = {}) =>
    buildContentHistory(history, 0, 'Char', 'Player', undefined, options as any);

const proxyLast = (options: Record<string, unknown> = {}): string =>
    String(proxy(options).at(-1)?.content ?? '');

const geminiLast = (options: Record<string, unknown> = {}): string =>
    String(gemini(options).at(-1)?.parts?.[0]?.text ?? '');

describe('Post History', () => {
    it('sends no hidden tail when the setting is empty', () => {
        expect(proxyLast()).toBe('Player sits down');
        expect(geminiLast()).toBe('Player sits down');
        expect(JSON.stringify(proxy())).not.toContain('Context only. Continue.');
        expect(JSON.stringify(gemini())).not.toContain('Context only. Continue.');
    });

    it('appends the exact opt-in text for both providers', () => {
        const options = { postHistoryInstruction: 'Continue with tighter pacing.' };
        expect(proxyLast(options)).toBe('Continue with tighter pacing.');
        expect(geminiLast(options)).toBe('Continue with tighter pacing.');
    });

    it('can stand alone without notes, lore, or character sheets', () => {
        const proxyMessages = buildProxyMessages([], 0, 'Char', 'Player', 'SYSTEM', undefined, undefined, {
            postHistoryInstruction: 'POST',
        });
        const geminiContents = buildContentHistory([], 0, 'Char', 'Player', undefined, {
            postHistoryInstruction: 'POST',
        });
        expect(proxyMessages.map(message => message.content)).toEqual(['SYSTEM', 'POST']);
        expect(geminiContents[0].parts?.[0]?.text).toBe('POST');
    });

    it('is the final tail block and appears exactly once', () => {
        const tail = proxyLast({
            playerNotes: 'NOTES',
            keywordWorldInfo: 'LORE',
            postHistoryInstruction: 'POST',
        });
        expect(tail).toBe('<Notes>\nNOTES\n</Notes>\n\nLORE\n\nPOST');
        expect(tail.split('POST')).toHaveLength(2);
    });

    it('resolves character placeholders in explicit text', () => {
        const options = { postHistoryInstruction: '{{user}} waits for {{char}}.' };
        expect(proxyLast(options)).toBe('Player waits for Char.');
        expect(geminiLast(options)).toBe('Player waits for Char.');
    });

    it('treats whitespace-only text as disabled', () => {
        expect(proxyLast({ postHistoryInstruction: '   ' })).toBe('Player sits down');
        expect(geminiLast({ postHistoryInstruction: '\n\t' })).toBe('Player sits down');
    });
});
