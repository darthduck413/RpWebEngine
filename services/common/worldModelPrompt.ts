/**
 * World Model prompt layering.
 *
 * Every World Model turn fans out to a dozen-plus agent calls that share the same
 * model and the same background material (character card, always-on lore and story
 * bible) but differ only in their role instruction. Historically the
 * shared material rode in the volatile tail — after every cache breakpoint — so it
 * was re-sent at full price by every agent on every turn, while the one thing that
 * differed (the role) sat at the very front where it split the cache prefix.
 *
 * This module inverts that: the shared material becomes an ordered stack of system
 * blocks, sorted by how stable each block is and how many agents can see it, with
 * the agent's own role last. Agents that see the same material produce a
 * byte-identical prefix, so the provider serves it from cache for every agent after
 * the first.
 *
 * Ordering is deliberate — most-shared first:
 *   1. setting + personality   — visible to every agent except a fully-blind router
 *   2. story bible             — visible to all, changes only when setup re-runs
 *   3. player description      — hidden from a few analysis agents
 *   4. agent role              — unique per agent, never cached
 *
 * Player notes are deliberately appended after history by the provider builders.
 * They are short and user-editable, so an edit must not invalidate the much
 * larger cached history segment.
 *
 * Light mode does not use any of this; its prompt shape is untouched.
 */

import { AgentSettings, Character, StoryBible } from '../../types';

export type WorldModelBlockId = 'world' | 'bible' | 'playerDescription' | 'role';

export interface WorldModelBlock {
    id: WorldModelBlockId;
    text: string;
    /**
     * Whether this block ends a cacheable segment. The role block never does — it
     * differs per agent, so a breakpoint there would only ever be written, never read.
     */
    cacheable: boolean;
}

export interface WorldModelLayerInput {
    character: Character;
    storyBible?: StoryBible | null;
    /** Fully-resolved role text: agent.systemInstruction plus any schema prompt. */
    roleInstruction: string;
    agent?: AgentSettings;
    /**
     * GM-style agents inline the character card into their own role text via
     * SYSTEM_INSTRUCTION_PLACEHOLDER. Repeating the card as a shared block would
     * duplicate it, so those agents opt out and only get the bible block.
     */
    cardInRole?: boolean;
}

const visibilityOf = (agent?: AgentSettings) => {
    const visibility = agent?.instructionVisibility;
    return {
        showSetting: visibility ? visibility.setting : true,
        showPersonality: visibility ? visibility.personality : true,
        showDescription: visibility ? visibility.playerDescription : true,
    };
};

/**
 * Builds the ordered system blocks for one World Model agent. Pure — the same
 * inputs always produce byte-identical text, which is what makes the shared prefix
 * cacheable across agents.
 */
export const buildWorldModelBlocks = (input: WorldModelLayerInput): WorldModelBlock[] => {
    const { character, storyBible, roleInstruction, agent, cardInRole } = input;
    const { showSetting, showPersonality, showDescription } = visibilityOf(agent);
    const blocks: WorldModelBlock[] = [];

    if (!cardInRole) {
        // Same fields, same wording as the tail block this replaces — only the
        // position and the split into cache tiers changed.
        const worldParts: string[] = [
            `Character name: ${character.name}`,
            `Player name: ${character.playerName}`,
        ];
        if (showSetting && character.setting) {
            worldParts.push(`[SETTING]\n${character.setting}\n[/SETTING]`);
        }
        if (showPersonality && character.personality) {
            worldParts.push(`[CHARACTER PERSONALITY]\n${character.personality}\n[/CHARACTER PERSONALITY]`);
        }
        blocks.push({
            id: 'world',
            text: `[VISIBLE SESSION CONTEXT]\n${worldParts.join('\n\n')}\n[/VISIBLE SESSION CONTEXT]`,
            cacheable: true,
        });
    }

    const bibleBlock: WorldModelBlock | null = storyBible
        ? {
            id: 'bible',
            text: `[STORY BIBLE]\n${JSON.stringify(storyBible, null, 2)}\n[/STORY BIBLE]`,
            cacheable: true,
        }
        : null;

    // Analysis agents read the world first and their own job last, so the shared
    // world+bible prefix is identical across them. The GM is different: its role
    // text already embeds the character card, so leading with a bare bible JSON
    // would put thousands of tokens of data ahead of its instructions. There it
    // keeps role-then-bible — still fully cacheable, since both are stable.
    if (cardInRole) {
        blocks.push({ id: 'role', text: roleInstruction, cacheable: false });
        if (bibleBlock) blocks.push(bibleBlock);
        return blocks;
    }

    if (bibleBlock) blocks.push(bibleBlock);

    if (showDescription && character.playerDescription) {
        blocks.push({
            id: 'playerDescription',
            text: `[PLAYER DESCRIPTION]\n${character.playerDescription}\n[/PLAYER DESCRIPTION]`,
            cacheable: true,
        });
    }

    blocks.push({ id: 'role', text: roleInstruction, cacheable: false });

    return blocks;
};

/**
 * Flattens the blocks into a single system string — used by providers that take a
 * plain system instruction (native Gemini) and by any request where cache
 * breakpoints are not being emitted, so the wire format stays exactly as before.
 */
export const flattenWorldModelBlocks = (blocks: WorldModelBlock[]): string =>
    blocks.map(block => block.text).filter(text => text.trim()).join('\n\n');

/**
 * History window for one agent.
 *
 * Agents ship with wildly different `contextMessages` (1, 3, 5, 6, or 0 meaning
 * "use the global setting"), which gives every agent a differently-sized history
 * and therefore a different prefix. When explicit caching is active it is cheaper
 * to give them all the same window — cache reads cost a fraction of fresh input —
 * so the windows are unified to the widest one any agent asked for.
 *
 * When caching is NOT active the original per-agent windows are kept: widening
 * them would just burn tokens at full price.
 */
export const resolveAgentHistoryWindow = (
    agent: AgentSettings,
    allAgents: AgentSettings[],
    globalContextTurns: number,
    cachingActive: boolean
): number => {
    const own = agent.contextMessages > 0 ? agent.contextMessages : globalContextTurns;
    if (!cachingActive) return own;

    // Agents with contextMessages === 0 follow the global setting, which is often
    // far larger than any explicit per-agent window; unifying to that would blow
    // up the small analysis agents, so only explicit windows feed the maximum.
    const explicit = allAgents
        .map(a => a.contextMessages)
        .filter(value => typeof value === 'number' && value > 0);
    if (explicit.length === 0) return own;

    const widest = Math.max(...explicit);
    // Never shrink an agent that legitimately asked for the whole global window.
    return agent.contextMessages > 0 ? widest : own;
};
