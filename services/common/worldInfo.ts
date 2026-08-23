// Keyword-triggered World Info (SillyTavern-style).
//
// Lore entries with `keys` are scanned against the recent story text each
// turn and injected into the system instruction only when they match, so
// large lorebooks don't bloat the context. `alwaysActive` entries are always
// injected. This is independent of the greeting-bound composition
// (FirstMessage.loreIds), which handles entries without keys.

import { LoreEntry, StoryTurn } from '../../types';
import { stripThinkTags } from './thinking';

// How many recent turns are scanned for keyword matches (4 exchanges).
export const DEFAULT_SCAN_DEPTH = 8;

// Deeper default for character profiles (set by the lore.character factory):
// keeps a profile loaded through pronoun-only stretches of a long scene where
// the name may not recur for several messages.
export const CHARACTER_PROFILE_SCAN_DEPTH = 12;

// Safety valve for degenerate scenes that name-drop half the cast: keyword
// entries are trimmed to this many characters (~6k tokens), dropping the least
// recently mentioned first. Generous on purpose — normal play never hits it.
export const KEYWORD_BUDGET_CHARS = 24_000;

// Why a given entry is currently active.
export type WorldInfoReason = 'always' | 'keyword';

// Unicode-aware "word" character (letters/digits in any script). The old
// [^a-z0-9] boundary treated every non-Latin letter as a boundary, so e.g.
// Cyrillic keys matched inside Cyrillic words.
const WORD_CHAR = /[\p{L}\p{N}]/u;
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && WORD_CHAR.test(ch);

// Whole-word(-phrase) match so a key like "echo" fires on "Echo" but NOT on
// "echoes", and "zero" doesn't fire on "zeroed". Multi-word/hyphenated keys
// ("li xian", "yin-yang") work because boundaries are only checked at the
// key's ends. Returns the index of the LAST whole-word occurrence (used for
// recency ranking), or -1. scanText is already lowercased by the caller.
const lastKeyIndex = (key: string, scanText: string): number => {
    const k = key.trim().toLowerCase();
    if (!k) return -1;
    let idx = scanText.lastIndexOf(k);
    while (idx !== -1) {
        if (!isWordChar(scanText[idx - 1]) && !isWordChar(scanText[idx + k.length])) return idx;
        idx = idx > 0 ? scanText.lastIndexOf(k, idx - 1) : -1;
    }
    return -1;
};

export interface ActiveWorldInfoEntry {
    entry: LoreEntry;
    reason: WorldInfoReason;
    matchedKeys: string[]; // which keys triggered it (empty for `always`)
}

// Single source of truth for selection. Both the prompt builder (composeWorldInfo)
// and the in-app viewer use this, so what you see can never drift from what is sent.
export const selectActiveWorldInfo = (
    loreBook: LoreEntry[] | undefined,
    storyHistory: StoryTurn[],
    currentInput?: string,
    alreadyComposed: string[] = [],
    scanDepth: number = DEFAULT_SCAN_DEPTH
): ActiveWorldInfoEntry[] => {
    if (!loreBook || loreBook.length === 0) return [];

    // One scan text per distinct depth (entries can override via entry.scanDepth).
    // <think> reasoning is stripped so a model merely *contemplating* a name in
    // its chain of thought doesn't load that profile into the story.
    const scanTexts = new Map<number, string>();
    const getScanText = (depth: number): string => {
        let text = scanTexts.get(depth);
        if (text === undefined) {
            text = [
                ...storyHistory.slice(-depth).map(t => stripThinkTags(t.text ?? '')),
                currentInput ?? '',
            ].join('\n').toLowerCase();
            scanTexts.set(depth, text);
        }
        return text;
    };

    const composedText = alreadyComposed.filter(Boolean).join('\n');

    const active: ActiveWorldInfoEntry[] = [];
    // Distance from the end of the scan text to the entry's most recent key hit.
    // Comparable across different depths because all scan texts share the same
    // suffix (the newest messages).
    const recency = new Map<LoreEntry, number>();

    for (const entry of loreBook) {
        if (entry.disabled) continue;
        const content = entry.content.trim();
        // Skip empty, or anything whose content is already in the prompt (no dup tokens).
        if (content === '' || (composedText && composedText.includes(content))) continue;
        if (entry.alwaysActive) {
            active.push({ entry, reason: 'always', matchedKeys: [] });
            continue;
        }
        if (!entry.keys || entry.keys.length === 0) continue;

        const scanText = getScanText(Math.max(1, entry.scanDepth ?? scanDepth));
        const matchedKeys: string[] = [];
        let lastHit = -1;
        for (const key of entry.keys) {
            if (!key) continue;
            const idx = lastKeyIndex(key, scanText);
            if (idx !== -1) {
                matchedKeys.push(key);
                if (idx > lastHit) lastHit = idx;
            }
        }
        if (matchedKeys.length > 0) {
            active.push({ entry, reason: 'keyword', matchedKeys });
            recency.set(entry, scanText.length - (lastHit + 1));
        }
    }

    // Budget guard: over budget, keep the most recently mentioned keyword entries
    // (greedy by recency). Always-active entries are exempt; survivors keep their
    // lorebook order because we filter `active` rather than re-sort it.
    const keywordActive = active.filter(a => a.reason === 'keyword');
    const totalChars = keywordActive.reduce((sum, a) => sum + a.entry.content.length, 0);
    if (totalChars > KEYWORD_BUDGET_CHARS) {
        const byRecency = [...keywordActive].sort(
            (x, y) => (recency.get(x.entry) ?? Infinity) - (recency.get(y.entry) ?? Infinity)
        );
        const keep = new Set<LoreEntry>();
        let used = 0;
        for (const a of byRecency) {
            if (keep.size > 0 && used + a.entry.content.length > KEYWORD_BUDGET_CHARS) continue;
            keep.add(a.entry);
            used += a.entry.content.length;
        }
        return active.filter(a => a.reason === 'always' || keep.has(a.entry));
    }

    return active;
};

// `scope` controls which tier is rendered, so callers can split World Info across
// cache regions: 'always' (static index/lore → cacheable system prefix), 'keyword'
// (per-character profiles for who's on-screen → volatile tail), or 'all' (both, the
// default — used by the editor preview and the multi-agent path).
export const composeWorldInfo = (
    loreBook: LoreEntry[] | undefined,
    storyHistory: StoryTurn[],
    currentInput?: string,
    /** Prompt sections already sent to the model (personality/setting/scenario).
     *  Entries whose content is already present there are skipped, so an entry
     *  that is both greeting-bound and keyword-triggered is never sent twice. */
    alreadyComposed: string[] = [],
    scanDepth: number = DEFAULT_SCAN_DEPTH,
    scope: 'all' | WorldInfoReason = 'all'
): string => {
    const active = selectActiveWorldInfo(loreBook, storyHistory, currentInput, alreadyComposed, scanDepth)
        .filter(a => scope === 'all' || a.reason === scope);
    if (active.length === 0) return '';

    const body = active
        .map(({ entry }) => (entry.name ? `[${entry.name}]\n${entry.content}` : entry.content))
        .join('\n\n');

    return `<World Info>\n${body}\n</World Info>`;
};
