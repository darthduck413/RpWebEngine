import { describe, expect, it } from 'vitest';
import { buildContinuationRequest, continuationJoinSeparator, CONTINUE_STORY_CUE } from '../../services/common/continuation';
import { StoryTurn } from '../../types';

describe('Continue request', () => {
    const previous = 'A unique assistant response that must not be duplicated.';
    const history: StoryTurn[] = [
        { id: 'u1', text: 'Start.', isPlayer: true },
        { id: 'a1', text: previous, isPlayer: false },
    ];

    it('adds only the short visible cue', () => {
        const request = buildContinuationRequest(history, 'a1', 20);
        expect(request.history.at(-1)?.text).toBe(CONTINUE_STORY_CUE);
        expect(request.playerChoice).toBe(CONTINUE_STORY_CUE);
        expect(JSON.stringify(request)).not.toContain('Do not repeat');
        expect(JSON.stringify(request)).not.toContain('Previous assistant response');
    });

    it('keeps the previous response exactly once', () => {
        const request = buildContinuationRequest(history, 'a1', 1);
        expect(JSON.stringify(request.history).split(previous)).toHaveLength(2);
        expect(request.historyContextTurns).toBe(2);
    });

    it('does not impose a window when unlimited history is selected', () => {
        expect(buildContinuationRequest(history, 'a1', 0).historyContextTurns).toBe(0);
    });
});

describe('Continue join seam', () => {
    // The short cue invites a fresh sentence, so the one combination that is always
    // wrong — interrupted word + start of new text — must not be fused.
    it('separates a new sentence from an interrupted word', () => {
        expect(continuationJoinSeparator('он ша', 'Иван шагнул')).toBe(' ');
        expect(continuationJoinSeparator('he wal', 'Ivan walked')).toBe(' ');
        expect(continuationJoinSeparator('она сказала сло', '"Хватит"')).toBe(' ');
        expect(continuationJoinSeparator('и тут', '— резко')).toBe(' ');
        expect(continuationJoinSeparator('он зам', '*вздрогнул*')).toBe(' ');
    });

    it('never touches a genuine mid-word completion', () => {
        expect(continuationJoinSeparator('он ша', 'гнул к двери')).toBe('');
        expect(continuationJoinSeparator('he wal', 'ked to the door')).toBe('');
        expect(continuationJoinSeparator('счёт 12', '345')).toBe('');
    });

    it('stays out of the way once the base already ends cleanly', () => {
        // joinContinuationBase has already added its newline in these cases.
        expect(continuationJoinSeparator('Он ушёл.\n', 'Иван шагнул')).toBe('');
        expect(continuationJoinSeparator('Он ушёл.', 'Иван шагнул')).toBe('');
        expect(continuationJoinSeparator('', 'Иван шагнул')).toBe('');
        expect(continuationJoinSeparator('он ша', '')).toBe('');
    });

    it('leaves a reasoning model alone — the think block is its own separator', () => {
        // A reasoning stream opens with '<think>\n'; the '\n\n' after '</think>' already
        // separates the prose once splitThinkingContent removes the block.
        expect(continuationJoinSeparator('он ша', '<think>\n')).toBe('');
    });
});
