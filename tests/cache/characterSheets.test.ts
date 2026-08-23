import { describe, expect, it } from 'vitest';
import { buildProxyMessages } from '../../services/proxy/prompts';
import { buildContentHistory } from '../../services/gemini/prompts';
import { StoryTurn, TrackedCharacter } from '../../types';

const history: StoryTurn[] = [
    { id: 'u1', text: 'Hello', isPlayer: true },
];

const sheets: TrackedCharacter[] = [{
    id: 'tracked-1',
    name: 'SHEET SENTINEL',
    description: 'A deliberately recognizable state sheet.',
    health: { value: 75, description: 'Tired' },
    topics: [],
}];

describe('Character Tracker sheet routing', () => {
    it('keeps non-empty sheets available in opt-in light mode', () => {
        const proxy = buildProxyMessages(history, 0, 'Char', 'Player', 'SYSTEM', sheets);
        const gemini = buildContentHistory(history, 0, 'Char', 'Player', sheets);
        expect(JSON.stringify(proxy)).toContain('SHEET SENTINEL');
        expect(JSON.stringify(gemini)).toContain('SHEET SENTINEL');
    });

    it('sends nothing when the tracker has no characters', () => {
        const proxy = buildProxyMessages(history, 0, 'Char', 'Player', 'SYSTEM', []);
        const gemini = buildContentHistory(history, 0, 'Char', 'Player', []);
        expect(JSON.stringify(proxy)).not.toContain('CURRENT CHARACTER STATES');
        expect(JSON.stringify(gemini)).not.toContain('CURRENT CHARACTER STATES');
    });

    it('can suppress sheets for World Model agents that do not need them', () => {
        const proxy = buildProxyMessages(
            history, 0, 'Char', 'Player', 'SYSTEM', sheets, undefined,
            { includeCharacterSheets: false }
        );
        const gemini = buildContentHistory(
            history, 0, 'Char', 'Player', sheets,
            { includeCharacterSheets: false }
        );
        expect(JSON.stringify(proxy)).not.toContain('SHEET SENTINEL');
        expect(JSON.stringify(gemini)).not.toContain('SHEET SENTINEL');
    });
});
