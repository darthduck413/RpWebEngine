import { StoryTurn } from '../../types';

export const CONTINUE_STORY_CUE = 'Continue the story.';

/** The text being continued was cut mid-word (ends on a letter or digit). */
const ENDS_MID_WORD_RE = /[\p{L}\p{N}]$/u;
/**
 * The continuation opens something new rather than finishing the interrupted word:
 * an uppercase letter, an opening quote, or a markup/dash lead-in. A genuine
 * mid-word completion can never start with any of these.
 */
const OPENS_NEW_TEXT_RE = /^[\p{Lu}"'«»“”‘’*_\-–—]/u;

/**
 * Separator to insert between the text being continued and the model's first
 * chunk. Empty in every normal case, so a real mid-word completion still joins
 * seamlessly. It only fires on the one combination that is always wrong: an
 * interrupted word followed by the start of a fresh sentence, which would
 * otherwise fuse two words into one ("он ша" + "Иван шагнул").
 */
export const continuationJoinSeparator = (base: string, next: string): string =>
    base && next && ENDS_MID_WORD_RE.test(base) && OPENS_NEW_TEXT_RE.test(next) ? ' ' : '';

export const buildContinuationRequest = (
    history: StoryTurn[],
    targetNodeId: string,
    historyContextTurns: number
): { history: StoryTurn[]; historyContextTurns: number; playerChoice: string } => ({
    history: [
        ...history,
        {
            id: `continue-${targetNodeId}`,
            text: CONTINUE_STORY_CUE,
            isPlayer: true,
        },
    ],
    // A finite one-message window would otherwise keep only the cue and hide the
    // assistant response being continued. Include it once as the preceding turn.
    historyContextTurns: historyContextTurns > 0 ? Math.max(2, historyContextTurns) : historyContextTurns,
    playerChoice: CONTINUE_STORY_CUE,
});
