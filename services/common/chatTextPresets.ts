// Rendering helpers for the chat text presets. The preset data itself lives in
// constants.ts (CHAT_TEXT_PRESETS) next to the other editable preset consts —
// change colors there.

import { ChatTextPreset } from '../../types';
import { CHAT_TEXT_PRESETS } from '../../constants';

export { CHAT_TEXT_PRESETS };

export const DEFAULT_CHAT_TEXT_PRESET_ID = CHAT_TEXT_PRESETS[0].id;

export const getChatTextPreset = (id: string | undefined | null): ChatTextPreset =>
    CHAT_TEXT_PRESETS.find(p => p.id === id) ?? CHAT_TEXT_PRESETS[0];

/** Unknown ids (removed presets, corrupted saves) fall back to the default. */
export const normalizeChatTextPresetId = (id: unknown): string =>
    typeof id === 'string' && CHAT_TEXT_PRESETS.some(p => p.id === id)
        ? id
        : DEFAULT_CHAT_TEXT_PRESET_ID;

/**
 * Applies inline story markup (quotes, bold, italics) to already block-processed
 * HTML. Transforms run only on text between HTML tags, so attributes of earlier
 * block replacements (info boxes, inline images — full of double quotes) are
 * never corrupted. Colors are inline styles so they can never lose a CSS
 * specificity fight with utility classes.
 */
export const applyInlineStoryMarkup = (html: string, preset: ChatTextPreset): string =>
    html.split(/(<[^>]*>)/g).map(segment => {
        if (segment.startsWith('<')) return segment;
        return segment
            .replace(/"([^"\n]*)"/g, `<span style="color:${preset.quoteColor}">"$1"</span>`)
            .replace(/“([^”\n]*)”/g, `<span style="color:${preset.quoteColor}">“$1”</span>`)
            .replace(/«([^»\n]*)»/g, `<span style="color:${preset.quoteColor}">«$1»</span>`)
            .replace(/\*\*(.*?)\*\*/g, `<strong style="color:${preset.boldColor}">$1</strong>`)
            .replace(/\*(.*?)\*/g, `<em style="color:${preset.italicColor}">$1</em>`);
    }).join('');

/** Sample rendered in the UI Settings preview box. */
export const CHAT_TEXT_PRESET_PREVIEW =
    'The rain taps against the glass while you wait. *She glances at you, then away.* **Something is wrong.** "Stay a little longer," she says.';
