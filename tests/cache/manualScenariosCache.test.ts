import { describe, expect, it } from 'vitest';
import { buildContentHistory } from '../../services/gemini/prompts';
import { buildProxyMessages } from '../../services/proxy/prompts';
import { StoryTurn } from '../../types';

const history = (count: number): StoryTurn[] =>
    Array.from({ length: count }, (_, index) => ({
        id: `t${index}`,
        text: index % 2 === 0 ? `Player ${index}` : `Char ${index}`,
        isPlayer: index % 2 === 0,
    }));

describe('manual scenario cache placement', () => {
    it('places scenarios before history for both providers', () => {
        const options = { manualScenarios: 'SCENARIO FOR {{user}}' };
        const proxy = buildProxyMessages(
            history(2), 0, 'Char', 'Player', 'SYSTEM', undefined, undefined, options
        );
        const gemini = buildContentHistory(
            history(2), 0, 'Char', 'Player', undefined, options
        );

        expect(proxy[1].content).toBe('SCENARIO FOR Player');
        expect(proxy[1].cache).toBe(true);
        expect(proxy[2].content).toBe('Player 0');
        expect(gemini[0].parts![0].text).toBe('SCENARIO FOR Player');
        expect(gemini[1].parts![0].text).toBe('Player 0');
    });

    it('keeps the scenario prefix stable as history grows and needs no tail anchor', () => {
        const options = { manualScenarios: 'STABLE SCENARIO' };
        const before = buildProxyMessages(
            history(2), 0, 'Char', 'Player', 'SYSTEM', undefined, undefined, options
        );
        const after = buildProxyMessages(
            history(4), 0, 'Char', 'Player', 'SYSTEM', undefined, undefined, options
        );
        expect(after.slice(0, 2).map(message => message.content))
            .toEqual(before.slice(0, 2).map(message => message.content));
        expect(JSON.stringify(after)).not.toContain('Context only. Continue.');
    });
});
