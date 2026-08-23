import { describe, it, expect } from 'vitest';
import { buildAgentMessages as buildProxyAgentMessages } from '../../services/proxy/gameplay';
import { buildAgentMessages as buildGeminiAgentMessages } from '../../services/gemini/gameplay';
import { prepareWireMessages } from '../../services/proxy/prompts';
import { HeavyModeParams } from '../../services/common/gameplay';
import { AgentSettings, Character, StoryBible, StoryTurn, TrackedCharacter } from '../../types';

// End-to-end check of the World Model prompt assembly: two different agents on the
// same turn must produce the same cached prefix, and that prefix must survive into
// the next turn.

const character: Character = {
    id: 'c1',
    name: 'Aurelia',
    image: '',
    personality: 'PERSONALITY '.repeat(200),
    firstMessages: [],
    systemInstructionTemplate: 'TEMPLATE',
    playerDescription: 'PLAYER DESCRIPTION '.repeat(100),
    setting: 'SETTING '.repeat(3000),
    scenario: 'SCENARIO',
    playerName: 'Alex',
};

const storyBible = { plot: 'PLOT '.repeat(500) } as unknown as StoryBible;

const makeAgent = (overrides: Partial<AgentSettings>): AgentSettings => ({
    id: 'agent',
    name: 'Agent',
    systemInstruction: 'ROLE',
    contextMessages: 3,
    model: 'claude-sonnet-4-5',
    order: 1,
    connections: [],
    position: { x: 0, y: 0 },
    instructionVisibility: { playerNotes: true, setting: true, personality: true, playerDescription: true },
    ...overrides,
});

const curator = makeAgent({ id: 'curator', name: 'World Curator', systemInstruction: 'You are the curator.', contextMessages: 6 });
const candidate = makeAgent({ id: 'candidate', name: 'Candidate', systemInstruction: 'You are a character.', contextMessages: 5 });
const detector = makeAgent({
    id: 'detector',
    name: 'Universe Detector',
    systemInstruction: 'You detect universes.',
    contextMessages: 1,
    instructionVisibility: { playerNotes: false, setting: true, personality: true, playerDescription: true },
});

const history = (count: number): StoryTurn[] =>
    Array.from({ length: count }, (_, i) => ({
        id: `t${i}`,
        text: `${i % 2 === 0 ? 'player' : 'narrator'} line ${i} `.repeat(40),
        isPlayer: i % 2 === 0,
    }));

const makeParams = (overrides: Partial<HeavyModeParams> = {}): HeavyModeParams => ({
    storyHistory: history(12),
    playerNotes: 'PLAYER NOTES',
    character,
    historyContextTurns: 20,
    playerChoice: 'I open the door.',
    agentSettings: [curator, candidate, detector],
    updateStatus: () => {},
    logContext: () => {},
    trackedCharacters: [],
    providerSettings: { model: 'claude-sonnet-4-5', enableAnthropicCaching: true, proxyUrl: '', apiKey: '' },
    storyBible,
    ...overrides,
});

const wireFor = (agent: AgentSettings, params = makeParams()) =>
    prepareWireMessages(
        buildProxyAgentMessages(params, agent, [], `${agent.systemInstruction}\n\nSCHEMA`),
        'claude-sonnet-4-5',
        true
    );

const systemParts = (wire: any[]): any[] => wire[0].content as any[];

/** Text of every part up to and including the last cache_control in the system message. */
const cachedPrefixText = (wire: any[]): string => {
    const parts = systemParts(wire);
    let lastMark = -1;
    parts.forEach((part, i) => { if (part.cache_control) lastMark = i; });
    return parts.slice(0, lastMark + 1).map(p => p.text).join('\n');
};

describe('World Model prompt — shared prefix across the fan-out', () => {
    it('gives two agents with identical visibility the same cached prefix', () => {
        expect(cachedPrefixText(wireFor(curator))).toBe(cachedPrefixText(wireFor(candidate)));
    });

    it('still shares the world+bible segment with an agent that hides player notes', () => {
        const full = systemParts(wireFor(curator));
        const partial = systemParts(wireFor(detector));
        expect(partial[0].text).toBe(full[0].text);
        expect(partial[1].text).toBe(full[1].text);
        expect(partial[0].cache_control).toBeDefined();
        expect(partial[1].cache_control).toBeDefined();
    });

    it('puts each agent role last, outside the cached prefix', () => {
        const parts = systemParts(wireFor(curator));
        const role = parts.at(-1)!;
        expect(role.cache_control).toBeUndefined();
        expect(role.text).toContain('You are the curator.');
        expect(cachedPrefixText(wireFor(curator))).not.toContain('You are the curator.');
    });

    it('stays within the provider breakpoint budget across the whole message list', () => {
        const wire = wireFor(curator);
        const total = wire.reduce((sum, message) => {
            if (typeof message.content === 'string') return sum;
            return sum + (message.content as any[]).filter(p => p.cache_control).length;
        }, 0);
        expect(total).toBeLessThanOrEqual(4);
        expect(total).toBeGreaterThan(0);
    });
});

describe('World Model prompt — stability across turns', () => {
    it('keeps the cached prefix byte-identical when the story advances', () => {
        const before = cachedPrefixText(wireFor(curator, makeParams({ storyHistory: history(12) })));
        const after = cachedPrefixText(wireFor(curator, makeParams({
            storyHistory: history(14),
            playerChoice: 'I step through.',
        })));
        expect(after).toBe(before);
    });

    it('keeps the world block identical when the world snapshot changes', () => {
        const before = systemParts(wireFor(curator, makeParams()));
        const after = systemParts(wireFor(curator, makeParams({
            previousWorldSnapshot: {
                location: 'hall', timeOfDay: 'night', weather: 'rain',
                sceneSummary: 'new', charactersInScene: [], worldFacts: [], updatedAt: 1,
            },
        })));
        expect(after[0].text).toBe(before[0].text);
        expect(after[1].text).toBe(before[1].text);
    });

    it('keeps volatile per-turn material out of the system message entirely', () => {
        const wire = wireFor(curator);
        const system = JSON.stringify(systemParts(wire));
        expect(system).not.toContain('I open the door.');
        const tail = wire.at(-1)!;
        expect(JSON.stringify(tail.content)).toContain('I open the door.');
    });

    it('does not duplicate the character card into the tail', () => {
        const wire = wireFor(curator);
        const tail = JSON.stringify(wire.at(-1)!.content);
        expect(tail).not.toContain('[VISIBLE SESSION CONTEXT]');
        expect(tail).not.toContain('[STORY BIBLE]');
    });
});

describe('World Model volatile context', () => {
    it('sends player notes once after history on both provider builders', () => {
        const params = makeParams();
        const proxy = buildProxyAgentMessages(params, curator, [], 'ROLE');
        const gemini = buildGeminiAgentMessages(params, curator, [], 'TASK');

        expect(JSON.stringify(proxy[0])).not.toContain('PLAYER NOTES');
        expect(JSON.stringify(proxy.at(-1)!.content).split('PLAYER NOTES').length - 1).toBe(1);
        expect(JSON.stringify(gemini).split('PLAYER NOTES').length - 1).toBe(1);
    });

    it('keeps the proxy cached prefix unchanged when notes are edited', () => {
        const before = buildProxyAgentMessages(makeParams({ playerNotes: 'NOTES A' }), curator, [], 'ROLE');
        const after = buildProxyAgentMessages(makeParams({ playerNotes: 'NOTES B' }), curator, [], 'ROLE');
        expect(after.slice(0, -1).map(message => message.content))
            .toEqual(before.slice(0, -1).map(message => message.content));
    });

    it('does not broadcast Character Tracker sheets to every World Model agent', () => {
        const trackedCharacters: TrackedCharacter[] = [{
            id: 'tracked-1',
            name: 'TRACKED SHEET SENTINEL',
            description: 'large sheet',
            health: { value: 100, description: 'healthy' },
            topics: [],
        }];
        const params = makeParams({ trackedCharacters });

        expect(JSON.stringify(buildProxyAgentMessages(params, curator, [], 'ROLE')))
            .not.toContain('TRACKED SHEET SENTINEL');
        expect(JSON.stringify(buildGeminiAgentMessages(params, curator, [], 'TASK')))
            .not.toContain('TRACKED SHEET SENTINEL');
    });
});

describe('World Model prompt — non-caching providers', () => {
    const nonCachingParams = makeParams({
        providerSettings: { model: 'minimax/minimax-m3', enableAnthropicCaching: false, proxyUrl: '', apiKey: '' },
    });

    it('sends a plain system string, exactly as before block layering', () => {
        const wire = prepareWireMessages(
            buildProxyAgentMessages(nonCachingParams, curator, [], 'ROLE\n\nSCHEMA'),
            'minimax/minimax-m3',
            false
        );
        expect(typeof wire[0].content).toBe('string');
        expect(wire[0].content).toContain('[VISIBLE SESSION CONTEXT]');
        expect(wire[0].content).toContain('[STORY BIBLE]');
        expect(wire[0].content as string).toMatch(/ROLE\n\nSCHEMA$/);
    });

    it('keeps per-agent history windows when caching is inactive', () => {
        const curatorMessages = buildProxyAgentMessages(nonCachingParams, curator, [], 'ROLE');
        const detectorMessages = buildProxyAgentMessages(nonCachingParams, detector, [], 'ROLE');
        // contextMessages 6 vs 1 → different history lengths, untouched.
        expect(curatorMessages.length).toBeGreaterThan(detectorMessages.length);
    });

    it('unifies history windows once explicit caching is on', () => {
        const cachingParams = makeParams();
        const curatorMessages = buildProxyAgentMessages(cachingParams, curator, [], 'ROLE');
        const detectorMessages = buildProxyAgentMessages(cachingParams, detector, [], 'ROLE');
        expect(curatorMessages.length).toBe(detectorMessages.length);
    });
});
