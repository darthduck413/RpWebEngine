
import { StoryTurn, TrackedCharacter } from '../../types';
import { WorldModelBlock } from '../common/worldModelPrompt';
import { applyHistoryWindow } from '../common/historyWindow';
import { getCharacterContext } from '../common/prompts';
import { stripThinkTags } from '../common/thinking';
import { stripInlineImages } from '../common/inlineImages';

export interface ProxyMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | any[];
    /** Cache breakpoint candidate. Not part of the wire format — consumed and stripped by prepareWireMessages. */
    cache?: boolean;
    /**
     * Tie-breaker when more breakpoints are marked than the provider allows.
     * Lower = kept first. Stable, expensive prefixes (character card, story bible)
     * should outrank the rotating history marks. Not part of the wire format.
     */
    cachePriority?: number;
}

/** Breakpoint value tiers — lower survives when the 4-slot budget overflows. */
export const CACHE_PRIORITY = {
    /** Big and byte-identical for the whole session (card, always-on lore, bible). */
    STABLE_PREFIX: 0,
    /** End of history — carries the cache from one turn to the next. */
    HISTORY_HEAD: 1,
    /** Depth-2 history mark — only pays off on regenerate/edit of the last exchange. */
    HISTORY_DEPTH: 2,
} as const;

const DEFAULT_CACHE_PRIORITY = CACHE_PRIORITY.HISTORY_HEAD;

export { isCacheCapableModel } from '../common/cache';
import { canPossiblyMeetCacheMinimum, isCacheCapableModel as isCacheCapable } from '../common/cache';

/** Anthropic rejects a request carrying more than 4 cache_control blocks. */
export const MAX_CACHE_BREAKPOINTS = 4;

/**
 * At least one slot is held for the history head. Without it, a World Model agent
 * with four stable system blocks (card, bible, description, notes) fills the whole
 * budget with prefix marks and evicts the one breakpoint that carries the cache from
 * one turn to the next — the growing history would then be re-read every turn.
 */
const RESERVED_HISTORY_SLOTS = 1;

const utf8Length = (text: string): number => new TextEncoder().encode(text).byteLength;

const isMediaPart = (part: any): boolean =>
    !!part?.image_url
    || !!part?.inlineData
    || part?.type === 'image'
    || part?.type === 'image_url';

/** Identifies one breakpoint candidate: a message, or a specific part inside it. */
const partKey = (messageIndex: number, partIndex: number): string => `${messageIndex}:${partIndex}`;

/** Index of the part a message-level `cache` mark applies to (the last text part). */
const lastTextPartIndex = (content: any[]): number => {
    for (let i = content.length - 1; i >= 0; i -= 1) {
        if (content[i]?.type === 'text') return i;
    }
    return -1;
};

/**
 * Picks which marks actually become wire breakpoints: drops only text prefixes
 * that cannot possibly reach the model minimum, then keeps at most
 * MAX_CACHE_BREAKPOINTS. Without the provider tokenizer, retained candidates are
 * possible rather than guaranteed cache entries.
 *
 * Candidates come from two places: a message-level `cache` mark (applied to its
 * last text part) and part-level `cache` marks, which is how the World Model
 * stacks several cacheable system blocks inside one message.
 */
const selectBreakpoints = (messages: ProxyMessage[], model: string): Set<string> => {
    const candidates: { key: string; index: number; priority: number }[] = [];
    let prefixUtf8Bytes = 0;
    let structuralUnits = 0;
    let prefixHasMedia = false;

    const prefixCanBeCached = () => canPossiblyMeetCacheMinimum(
        model,
        prefixUtf8Bytes,
        structuralUnits,
        prefixHasMedia
    );

    messages.forEach((message, index) => {
        structuralUnits += 1;
        if (typeof message.content === 'string') {
            prefixUtf8Bytes += utf8Length(message.content);
            structuralUnits += 1;
            if (message.cache && prefixCanBeCached()) {
                candidates.push({
                    key: partKey(index, -1),
                    index: candidates.length,
                    priority: message.cachePriority ?? DEFAULT_CACHE_PRIORITY,
                });
            }
            return;
        }

        const messageMarkAt = message.cache ? lastTextPartIndex(message.content) : -1;
        message.content.forEach((part, partIndex) => {
            structuralUnits += 1;
            if (typeof part?.text === 'string') prefixUtf8Bytes += utf8Length(part.text);
            if (isMediaPart(part)) prefixHasMedia = true;
            const marked = part?.cache === true || partIndex === messageMarkAt;
            if (!marked) return;
            if (!prefixCanBeCached()) return;
            candidates.push({
                key: partKey(index, partIndex),
                index: candidates.length,
                priority: part?.cachePriority ?? message.cachePriority ?? DEFAULT_CACHE_PRIORITY,
            });
        });
    });

    const byValue = (a: typeof candidates[number], b: typeof candidates[number]) =>
        (a.priority - b.priority) || (a.index - b.index);

    // Hold a slot for the history head before filling the rest by priority — a
    // prefix full of stable blocks must never evict the mark that carries the cache
    // across turns.
    const historyHead = candidates
        .filter(c => c.priority === CACHE_PRIORITY.HISTORY_HEAD)
        .sort((a, b) => b.index - a.index)[0];

    const reserved = historyHead ? [historyHead] : [];
    const rest = candidates
        .filter(c => c !== historyHead)
        .sort(byValue)
        .slice(0, MAX_CACHE_BREAKPOINTS - (reserved.length * RESERVED_HISTORY_SLOTS));

    return new Set([...reserved, ...rest].map(c => c.key));
};

/** Internal-only part fields must never reach the provider. */
const cleanPart = (part: any): any => {
    const { cache, cachePriority, ...rest } = part ?? {};
    return rest;
};

const isAllText = (content: any[]): boolean =>
    content.length > 0 && content.every(part => part?.type === 'text' && typeof part.text === 'string');

/**
 * Converts internal ProxyMessages to the wire format. For Anthropic models the
 * `cache` marks become `cache_control` breakpoints (Anthropic prompt caching via
 * OpenAI-compatible endpoints, e.g. OpenRouter); for everything else the marks
 * are simply stripped. Must be applied to every messages array before fetch.
 *
 * When no breakpoints are emitted, a text-only multi-part message collapses back
 * into a plain string: providers that never see cache_control also never see an
 * array where they used to get a string.
 */
export const prepareWireMessages = (messages: ProxyMessage[], model: string, enableCaching?: boolean): ProxyMessage[] => {
    const applyCache = (enableCaching ?? false) && isCacheCapable(model);
    const breakpoints = applyCache ? selectBreakpoints(messages, model) : new Set<string>();

    return messages.map(({ cache, cachePriority, ...message }, index) => {
        if (typeof message.content === 'string') {
            if (!breakpoints.has(partKey(index, -1))) return message;
            return {
                ...message,
                content: [{ type: 'text', text: message.content, cache_control: { type: 'ephemeral' } }],
            };
        }

        const marks = message.content
            .map((_, partIndex) => breakpoints.has(partKey(index, partIndex)))
            .map((marked, partIndex) => (marked ? partIndex : -1))
            .filter(partIndex => partIndex >= 0);

        if (marks.length === 0 && isAllText(message.content)) {
            return { ...message, content: message.content.map(part => part.text).join('\n\n') };
        }

        const parts = message.content.map(cleanPart);
        marks.forEach(partIndex => {
            parts[partIndex].cache_control = { type: 'ephemeral' };
        });
        return { ...message, content: parts };
    });
};

/**
 * Turns World Model system blocks into one system message whose cacheable blocks
 * each carry their own breakpoint. Blocks are ordered most-shared first, so agents
 * that see the same material hit the same cached prefix (see worldModelPrompt.ts).
 */
export const buildBlockSystemMessage = (blocks: WorldModelBlock[]): ProxyMessage => {
    const parts = blocks
        .filter(block => block.text.trim())
        .map(block => ({
            type: 'text',
            text: block.text,
            ...(block.cacheable ? { cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX } : {}),
        }));

    // An empty content array is not a valid message for any provider; fall back
    // to an empty string so a misconfigured agent degrades instead of 400-ing.
    if (parts.length === 0) return { role: 'system', content: '' };
    return { role: 'system', content: parts };
};

export const JSON_MODE_INSTRUCTION ='IMPORTANT: Your entire response must be a single, valid JSON object or array as specified in the system prompt. Do not include any text or markdown formatting before or after the JSON.';

/**
 * Appends the JSON-mode reminder without disturbing the cached prefix.
 *
 * The plain "concatenate onto the last message" approach breaks in three ways:
 * array content stringifies to "[object Object]" and loses the real payload, a
 * cache-marked last message has its bytes rewritten (voiding the breakpoint it
 * carries), and an assistant-final history puts our instruction in the model's
 * own mouth. Only the common case — an unmarked trailing user string — is still
 * concatenated, so existing prompts stay byte-identical.
 */
export const appendJsonModeInstruction = (messages: ProxyMessage[]): ProxyMessage[] => {
    const result = messages.map(message => ({ ...message }));
    const last = result[result.length - 1];

    if (!last || last.cache || last.role !== 'user') {
        result.push({ role: 'user', content: JSON_MODE_INSTRUCTION });
        return result;
    }

    if (typeof last.content === 'string') {
        last.content = `${last.content}\n\n${JSON_MODE_INSTRUCTION}`;
        return result;
    }

    last.content = [...last.content, { type: 'text', text: JSON_MODE_INSTRUCTION }];
    return result;
};

interface BuildOptions {
    userAvatarUrl?: string | null;
    charAvatarUrl?: string | null;
    charName?: string;
    userName?: string;
    ignoreImages?: boolean;
    /** Keyword-triggered World Info (per-character profiles). Semi-stable: a profile
     *  stays loaded for as long as its name keeps appearing (12 messages), so it is
     *  worth its own cache segment rather than full price every turn. */
    keywordWorldInfo?: string;
    /** Manually-toggled scenarios normally stay fixed after chat start and lead
     *  the story history as semi-stable prefix context. */
    manualScenarios?: string;
    /** Player notes. They used to live inside the system instruction, where every
     *  edit invalidated the character card and the whole history with it; here an
     *  edit only costs this segment. */
    playerNotes?: string;
    /** Explicit user-authored text appended after light-mode history. */
    postHistoryInstruction?: string;
    /** True when this request will really carry cache breakpoints. Widens the
     *  history window step, which only pays off when a cache exists to preserve. */
    cachingActive?: boolean;
    includeCharacterSheets?: boolean;
    /** Echo the model's own <think> blocks back in the assistant turns instead of
     *  stripping them. Off everywhere unless the user turns it on — see the
     *  active API preset's `includeThinkingInHistory` switch. Only interleaved-thinking models
     *  (Kimi K3) need it; they stop reasoning after the first turn without it. */
    includeThinkingInHistory?: boolean;
}

export const buildProxyMessages = (
    storyHistory: StoryTurn[],
    historyContextTurns: number,
    aiName: string,
    playerName: string,
    /**
     * A plain instruction (light mode) or a pre-built system message — the World
     * Model passes a multi-block one so its shared prefix can carry its own
     * breakpoints.
     */
    systemInstruction: string | ProxyMessage,
    trackedCharacters?: TrackedCharacter[],
    agentContext?: string,
    options: BuildOptions = {}
): ProxyMessage[] => {
    // Prompt order is cache-oriented: stable prefix first (system, avatars and
    // manually-selected scenarios), then append-only history, then the per-turn
    // volatile tail (character sheets and agent context). Volatile content placed
    // before the history would invalidate the provider's prompt cache every turn.
    const messages: ProxyMessage[] = [
        typeof systemInstruction === 'string'
            ? { role: 'system', content: systemInstruction, cache: true, cachePriority: CACHE_PRIORITY.STABLE_PREFIX }
            : systemInstruction,
    ];

    const resolve = (text: string) => text
        .replace(/{{user}}/g, playerName)
        .replace(/{{char}}/g, aiName);

    if (!options.ignoreImages) {
        if (options.userAvatarUrl) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: `${options.userName || '{{user}}'}'s appearance:` },
                    { type: 'image_url', image_url: { url: options.userAvatarUrl } }
                ]
            });
        }

        if (options.charAvatarUrl) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: `${options.charName || '{{char}}'}'s appearance:` },
                    { type: 'image_url', image_url: { url: options.charAvatarUrl } }
                ]
            });
        }
    }

    if (options.manualScenarios?.trim()) {
        messages.push({
            role: 'user',
            content: resolve(options.manualScenarios.trim()),
            cache: true,
            cachePriority: CACHE_PRIORITY.STABLE_PREFIX,
        });
    }

    // Stepped history window — see services/common/historyWindow.ts.
    const historySlice = applyHistoryWindow(storyHistory, historyContextTurns, options.cachingActive);

    const historyStart = messages.length;

    historySlice.forEach((turn) => {
        const resolved = (turn.text ?? '')
            .replace(/{{user}}/g, playerName)
            .replace(/{{char}}/g, aiName);
        // Reasoning is echoed back only for model turns, and only when the setting is
        // on. Every assistant turn in the window keeps its block, not just the newest:
        // stripping the older ones would rewrite bytes the previous request already
        // sent, so the prompt-cache prefix would miss on every single turn.
        const text = options.includeThinkingInHistory && !turn.isPlayer
            ? stripInlineImages(resolved).trim()
            : stripInlineImages(stripThinkTags(resolved));

        if (!options.ignoreImages && turn.image) {
            const contentArray: any[] = [
                { type: 'text', text: turn.isPlayer ? `{{user}} attached image:\n${text}` : `{{char}} attached image:\n${text}` },
                { type: 'image_url', image_url: { url: turn.image } }
            ];
            messages.push({
                role: turn.isPlayer ? 'user' : 'assistant',
                content: contentArray
            });
        } else {
            messages.push({
                role: turn.isPlayer ? 'user' : 'assistant',
                content: text,
            });
        }
    });

    // Rotating cache breakpoints inside the history (SillyTavern-style): one on
    // the newest message and one two messages back. Next turn the history grows
    // from the end, so the previous "newest" breakpoint sits unchanged in the
    // prefix and its cache entry is read; the depth-2 one additionally survives
    // a regenerate/edit of the last exchange.
    const historyEnd = messages.length;
    if (historyEnd - 1 >= historyStart) {
        messages[historyEnd - 1].cache = true;
        messages[historyEnd - 1].cachePriority = CACHE_PRIORITY.HISTORY_HEAD;
    }
    if (historyEnd - 3 >= historyStart) {
        messages[historyEnd - 3].cache = true;
        messages[historyEnd - 3].cachePriority = CACHE_PRIORITY.HISTORY_DEPTH;
    }

    // Lore/WI content may carry {{user}}/{{char}} placeholders — resolve them here
    // since these blocks bypass buildSystemInstruction's replacement pass.
    // Tail — everything that is not part of the cacheable prefix, in ONE message.
    //
    // It is tempting to give the steadier half of this (notes and keyword lore)
    // its own breakpoint, on the theory that it can then be read from cache
    // while it stays unchanged. It cannot: the tail sits after the history, the
    // history grows every turn, and a prefix cache can only reuse what comes BEFORE
    // the first difference. Everything here is re-read every turn no matter how it
    // is split — and on Anthropic an extra breakpoint here would add a cache-write
    // premium for a read that only ever happens on a regenerate.
    //
    // Order still runs steadiest-first, so the block a reader is most likely to be
    // scanning for sits in a predictable place.
    const tailBlocks: string[] = [];
    // Notes live here rather than in the system instruction: up in the prefix, a
    // single edit invalidated the character card and the entire history behind it.
    if (options.playerNotes && options.playerNotes.trim()) {
        tailBlocks.push(`<Notes>\n${options.playerNotes.trim()}\n</Notes>`);
    }
    if (options.keywordWorldInfo && options.keywordWorldInfo.trim()) {
        tailBlocks.push(options.keywordWorldInfo.trim());
    }
    const characterContext = options.includeCharacterSheets === false
        ? null
        : getCharacterContext(trackedCharacters);
    if (characterContext) {
        tailBlocks.push(characterContext);
    }
    if (agentContext) {
        tailBlocks.push(agentContext);
    }
    // Post History goes last, so it is the final thing the model reads before writing
    // (SillyTavern's placement). Unlike the tail anchor it replaced, it is user-authored
    // and stands on its own: it is appended whenever it is non-empty, with or without
    // blocks above it, and nothing is sent when the user leaves it blank.
    if (options.postHistoryInstruction?.trim()) {
        tailBlocks.push(options.postHistoryInstruction.trim());
    }

    if (tailBlocks.length > 0) {
        messages.push({ role: 'user', content: resolve(tailBlocks.join('\n\n')) });
    }

    return messages;
};
