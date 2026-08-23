import { stripInlineImages } from './inlineImages';
import { stripThinkTags } from './thinking';

/**
 * Text that may be quoted into a later model request must contain only the
 * visible response. Stored/UI text is left untouched; reasoning and inline-image
 * markers are removed only at the prompt boundary.
 */
export const cleanModelOutputForPrompt = (text: string | null | undefined): string =>
    stripInlineImages(stripThinkTags(text)).trim();
