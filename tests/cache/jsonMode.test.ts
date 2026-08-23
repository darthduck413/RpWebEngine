import { describe, it, expect } from 'vitest';
import {
    appendJsonModeInstruction,
    JSON_MODE_INSTRUCTION,
    ProxyMessage,
} from '../../services/proxy/prompts';

describe('appendJsonModeInstruction', () => {
    it('concatenates onto a plain trailing user string (unchanged legacy behaviour)', () => {
        const out = appendJsonModeInstruction([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'analyse this' },
        ]);
        expect(out).toHaveLength(2);
        expect(out[1].content).toBe(`analyse this\n\n${JSON_MODE_INSTRUCTION}`);
    });

    it('appends a text part instead of stringifying array content', () => {
        const out = appendJsonModeInstruction([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'look at this' },
                    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
                ],
            },
        ]);
        const parts = out[0].content as any[];
        expect(parts).toHaveLength(3);
        expect(parts[1].image_url).toEqual({ url: 'data:image/png;base64,AAA' });
        expect(parts[2]).toEqual({ type: 'text', text: JSON_MODE_INSTRUCTION });
        expect(JSON.stringify(out)).not.toContain('[object Object]');
    });

    it('adds a new turn rather than rewriting a cache-marked last message', () => {
        const messages: ProxyMessage[] = [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'last history turn', cache: true },
        ];
        const out = appendJsonModeInstruction(messages);
        expect(out).toHaveLength(3);
        expect(out[1].content).toBe('last history turn');
        expect(out[1].cache).toBe(true);
        expect(out[2]).toEqual({ role: 'user', content: JSON_MODE_INSTRUCTION });
    });

    it('never puts the instruction into an assistant turn', () => {
        const out = appendJsonModeInstruction([
            { role: 'system', content: 'sys' },
            { role: 'assistant', content: 'model reply' },
        ]);
        expect(out[1].content).toBe('model reply');
        expect(out[2]).toEqual({ role: 'user', content: JSON_MODE_INSTRUCTION });
    });

    it('does not mutate the caller-owned messages', () => {
        const messages: ProxyMessage[] = [{ role: 'user', content: 'original' }];
        appendJsonModeInstruction(messages);
        expect(messages[0].content).toBe('original');
        expect(messages).toHaveLength(1);
    });

    it('handles an empty message list', () => {
        expect(appendJsonModeInstruction([])).toEqual([
            { role: 'user', content: JSON_MODE_INSTRUCTION },
        ]);
    });
});
