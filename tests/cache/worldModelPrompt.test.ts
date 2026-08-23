import { describe, it, expect } from 'vitest';
import {
    buildWorldModelBlocks,
    flattenWorldModelBlocks,
    resolveAgentHistoryWindow,
} from '../../services/common/worldModelPrompt';
import { buildBlockSystemMessage, prepareWireMessages } from '../../services/proxy/prompts';
import { AgentSettings, Character, StoryBible } from '../../types';

const character: Character = {
    id: 'c1',
    name: 'Aurelia',
    image: '',
    personality: 'PERSONALITY '.repeat(200),
    firstMessages: [],
    systemInstructionTemplate: 'TEMPLATE',
    playerDescription: 'PLAYER_DESCRIPTION '.repeat(100),
    setting: 'SETTING '.repeat(2000),
    scenario: 'SCENARIO',
    playerName: 'Alex',
};

const storyBible = {
    plot: 'PLOT '.repeat(500),
    lore: 'LORE',
} as unknown as StoryBible;

const agent = (overrides: Partial<AgentSettings> = {}): AgentSettings => ({
    id: 'a1',
    name: 'Agent',
    systemInstruction: 'ROLE',
    contextMessages: 3,
    model: 'claude-sonnet-4-5',
    order: 1,
    connections: [],
    position: { x: 0, y: 0 },
    ...overrides,
});

const ALL_VISIBLE: AgentSettings['instructionVisibility'] = {
    playerNotes: true, setting: true, personality: true, playerDescription: true,
};
const NO_NOTES: AgentSettings['instructionVisibility'] = {
    playerNotes: false, setting: true, personality: true, playerDescription: true,
};
const SETTING_ONLY: AgentSettings['instructionVisibility'] = {
    playerNotes: false, setting: true, personality: true, playerDescription: false,
};

const blocksFor = (overrides: Partial<AgentSettings> = {}, extra: Record<string, unknown> = {}) =>
    buildWorldModelBlocks({
        character,
        storyBible,
        roleInstruction: 'ROLE + SCHEMA',
        agent: agent(overrides),
        ...extra,
    });

describe('buildWorldModelBlocks — ordering', () => {
    it('orders blocks most-shared first, role last', () => {
        expect(blocksFor({ instructionVisibility: ALL_VISIBLE }).map(b => b.id))
            .toEqual(['world', 'bible', 'playerDescription', 'role']);
    });

    it('marks every shared block cacheable and the role block not', () => {
        const blocks = blocksFor({ instructionVisibility: ALL_VISIBLE });
        expect(blocks.filter(b => b.id !== 'role').every(b => b.cacheable)).toBe(true);
        expect(blocks.find(b => b.id === 'role')!.cacheable).toBe(false);
    });

    it('keeps player notes out of the cached stack', () => {
        expect(flattenWorldModelBlocks(blocksFor({ instructionVisibility: ALL_VISIBLE })))
            .not.toContain('NOTES');
    });
});

describe('buildWorldModelBlocks — shared prefix across agents', () => {
    it('produces a byte-identical world block for agents with the same visibility', () => {
        const a = blocksFor({ id: 'a', name: 'Curator', instructionVisibility: ALL_VISIBLE });
        const b = blocksFor({ id: 'b', name: 'Candidate', systemInstruction: 'OTHER', instructionVisibility: ALL_VISIBLE });
        expect(a[0].text).toBe(b[0].text);
        expect(a[1].text).toBe(b[1].text);
    });

    it('keeps the world and bible blocks shared even when later blocks differ', () => {
        const full = blocksFor({ instructionVisibility: ALL_VISIBLE });
        const noNotes = blocksFor({ instructionVisibility: NO_NOTES });
        const settingOnly = blocksFor({ instructionVisibility: SETTING_ONLY });

        // The two biggest blocks are identical for all three visibility profiles,
        // so they form one cache segment the whole fan-out reads.
        expect(noNotes[0].text).toBe(full[0].text);
        expect(settingOnly[0].text).toBe(full[0].text);
        expect(noNotes[1].text).toBe(full[1].text);
        expect(settingOnly[1].text).toBe(full[1].text);

        expect(noNotes.map(b => b.id)).toEqual(['world', 'bible', 'playerDescription', 'role']);
        expect(settingOnly.map(b => b.id)).toEqual(['world', 'bible', 'role']);
    });

    it('does not split the cached prefix by player-notes visibility', () => {
        const visible = blocksFor({ instructionVisibility: ALL_VISIBLE });
        const hidden = blocksFor({ instructionVisibility: NO_NOTES });
        expect(hidden.map(b => b.text)).toEqual(visible.map(b => b.text));
    });

    it('changes nothing above the bible when the bible is rewritten', () => {
        const before = blocksFor();
        const after = buildWorldModelBlocks({
            character, roleInstruction: 'ROLE + SCHEMA', agent: agent(),
            storyBible: { ...storyBible, plot: 'NEW PLOT' } as unknown as StoryBible,
        });
        expect(after[0].text).toBe(before[0].text);
        expect(after[1].text).not.toBe(before[1].text);
    });
});

describe('buildWorldModelBlocks — content parity', () => {
    it('hides what instructionVisibility hides', () => {
        const text = flattenWorldModelBlocks(blocksFor({ instructionVisibility: SETTING_ONLY }));
        expect(text).toContain('SETTING');
        expect(text).toContain('CHARACTER PERSONALITY');
        expect(text).not.toContain('PLAYER DESCRIPTION');
        expect(text).not.toContain('[PLAYER NOTES]');
    });

    it('emits no shared card when the role already embeds it', () => {
        const blocks = blocksFor({ instructionVisibility: ALL_VISIBLE }, { cardInRole: true });
        // Role first: this agent's instructions must not sit behind a wall of bible JSON.
        expect(blocks.map(b => b.id)).toEqual(['role', 'bible']);
        expect(flattenWorldModelBlocks(blocks)).not.toContain('[VISIBLE SESSION CONTEXT]');
        expect(flattenWorldModelBlocks(blocks).indexOf('ROLE + SCHEMA'))
            .toBeLessThan(flattenWorldModelBlocks(blocks).indexOf('[STORY BIBLE]'));
    });

    it('still ends the cacheable run on the bible for a card-in-role agent', () => {
        const blocks = blocksFor({}, { cardInRole: true });
        expect(blocks.find(b => b.id === 'bible')!.cacheable).toBe(true);
        expect(blocks.find(b => b.id === 'role')!.cacheable).toBe(false);
    });

    it('falls back to role-only when a card-in-role agent has no bible', () => {
        const blocks = buildWorldModelBlocks({
            character, storyBible: null,
            roleInstruction: 'ROLE', agent: agent(), cardInRole: true,
        });
        expect(blocks.map(b => b.id)).toEqual(['role']);
    });

    it('omits the bible block when there is no bible yet', () => {
        const blocks = buildWorldModelBlocks({
            character, storyBible: null, roleInstruction: 'ROLE', agent: agent(),
        });
        expect(blocks.map(b => b.id)).toEqual(['world', 'playerDescription', 'role']);
    });

    it('defaults to fully visible when the agent has no visibility settings', () => {
        const blocks = buildWorldModelBlocks({
            character, storyBible, roleInstruction: 'ROLE', agent: agent(),
        });
        expect(blocks.map(b => b.id)).toEqual(['world', 'bible', 'playerDescription', 'role']);
    });

    it('always ends with the role text verbatim', () => {
        const blocks = blocksFor();
        expect(blocks.at(-1)).toEqual({ id: 'role', text: 'ROLE + SCHEMA', cacheable: false });
    });
});

describe('buildBlockSystemMessage on the wire', () => {
    const blocks = blocksFor({ instructionVisibility: ALL_VISIBLE });

    it('emits one cache_control per shared block for Anthropic', () => {
        const wire = prepareWireMessages([buildBlockSystemMessage(blocks)], 'claude-sonnet-4-5', true);
        const parts = wire[0].content as any[];
        expect(parts).toHaveLength(4);
        expect(parts.filter(p => p.cache_control)).toHaveLength(3);
        // The role block — the one that differs per agent — is never a breakpoint.
        expect(parts[3].cache_control).toBeUndefined();
        expect(parts[3].text).toBe('ROLE + SCHEMA');
    });

    it('collapses back to a plain string when caching is off', () => {
        const wire = prepareWireMessages([buildBlockSystemMessage(blocks)], 'claude-sonnet-4-5', false);
        expect(typeof wire[0].content).toBe('string');
        expect(wire[0].content).toBe(flattenWorldModelBlocks(blocks));
    });

    it('collapses back to a plain string for non-Anthropic providers', () => {
        const wire = prepareWireMessages([buildBlockSystemMessage(blocks)], 'minimax/minimax-m3', true);
        expect(typeof wire[0].content).toBe('string');
        expect(JSON.stringify(wire)).not.toContain('cache_control');
    });

    it('never leaks internal cache fields to the wire', () => {
        const wire = prepareWireMessages([buildBlockSystemMessage(blocks)], 'claude-sonnet-4-5', true);
        const serialized = JSON.stringify(wire);
        expect(serialized).not.toContain('"cache"');
        expect(serialized).not.toContain('cachePriority');
    });

    it('drops empty blocks instead of emitting blank parts', () => {
        const message = buildBlockSystemMessage([
            { id: 'world', text: 'WORLD', cacheable: true },
            { id: 'bible', text: '   ', cacheable: true },
            { id: 'role', text: 'ROLE', cacheable: false },
        ]);
        expect((message.content as any[]).map(p => p.text)).toEqual(['WORLD', 'ROLE']);
    });
});

describe('resolveAgentHistoryWindow', () => {
    const agents = [
        agent({ id: 'router', contextMessages: 3 }),
        agent({ id: 'curator', contextMessages: 6 }),
        agent({ id: 'detector', contextMessages: 1 }),
        agent({ id: 'gm', contextMessages: 0 }),
    ];

    it('keeps each agent\'s own window when caching is inactive', () => {
        expect(resolveAgentHistoryWindow(agents[0], agents, 20, false)).toBe(3);
        expect(resolveAgentHistoryWindow(agents[1], agents, 20, false)).toBe(6);
        expect(resolveAgentHistoryWindow(agents[2], agents, 20, false)).toBe(1);
    });

    it('falls back to the global setting for contextMessages = 0', () => {
        expect(resolveAgentHistoryWindow(agents[3], agents, 20, false)).toBe(20);
        expect(resolveAgentHistoryWindow(agents[3], agents, 20, true)).toBe(20);
    });

    it('unifies explicit windows to the widest one when caching is active', () => {
        expect(resolveAgentHistoryWindow(agents[0], agents, 20, true)).toBe(6);
        expect(resolveAgentHistoryWindow(agents[1], agents, 20, true)).toBe(6);
        expect(resolveAgentHistoryWindow(agents[2], agents, 20, true)).toBe(6);
    });

    it('never widens beyond what an agent already asked for when no explicit windows exist', () => {
        const onlyGlobal = [agent({ id: 'x', contextMessages: 0 })];
        expect(resolveAgentHistoryWindow(onlyGlobal[0], onlyGlobal, 12, true)).toBe(12);
    });
});
