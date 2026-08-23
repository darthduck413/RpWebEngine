import { describe, it, expect } from 'vitest';
import {
    executeHeavyMode,
    AgentApiExecutor,
    HeavyModeParams,
    createAgentResultCache,
} from '../../services/common/gameplay';
import { AgentSettings, Character } from '../../types';

// Agents in one order share a prompt prefix. If they all start at once, none of
// them can read a cache entry that no one has written yet — every call pays the
// write premium. These tests pin the warm-up behaviour that avoids that.

const character: Character = {
    id: 'c1',
    name: 'Aurelia',
    image: '',
    personality: 'P',
    firstMessages: [],
    systemInstructionTemplate: 'T',
    playerDescription: 'D',
    setting: 'S',
    playerName: 'Alex',
};

const agent = (id: string, order: number): AgentSettings => ({
    id,
    name: id,
    systemInstruction: 'ROLE',
    contextMessages: 3,
    model: 'claude-sonnet-4-5',
    order,
    connections: [],
    position: { x: 0, y: 0 },
    outputType: id === 'gm' ? 'narrative' : 'worldSnapshot',
});

/** Records call start/end so overlap between agents is observable. */
const makeTracingExecutor = (events: string[]): AgentApiExecutor => {
    const run = async (name: string) => {
        events.push(`start:${name}`);
        await new Promise(resolve => setTimeout(resolve, 5));
        events.push(`end:${name}`);
    };
    return {
        async getWorldSnapshotUpdate(_params, agent) {
            await run(agent.name);
            return { analysis: 'ok', worldSnapshot: undefined };
        },
        async getDefaultResponse(_params, agent) {
            await run(agent.name);
            return 'narrative';
        },
    } as unknown as AgentApiExecutor;
};

const makeParams = (agents: AgentSettings[], caching: boolean): HeavyModeParams => ({
    storyHistory: [{ id: 't0', text: 'hi', isPlayer: true }],
    playerNotes: '',
    character,
    historyContextTurns: 10,
    playerChoice: 'go',
    agentSettings: agents,
    updateStatus: () => {},
    logContext: () => {},
    trackedCharacters: [],
    providerSettings: {
        model: caching ? 'claude-sonnet-4-5' : 'minimax/minimax-m3',
        enableAnthropicCaching: caching,
        proxyUrl: '',
        apiKey: '',
    },
});

const overlapCount = (events: string[]): number => {
    let running = 0;
    let maxRunning = 0;
    events.forEach(event => {
        if (event.startsWith('start:')) running += 1;
        if (event.startsWith('end:')) running -= 1;
        maxRunning = Math.max(maxRunning, running);
    });
    return maxRunning;
};

describe('World Model cache warm-up', () => {
    const parallelOrder = [agent('a', 1), agent('b', 1), agent('c', 1), agent('gm', 2)];

    it('runs the first agent alone, then fans out, when explicit caching is on', async () => {
        const events: string[] = [];
        await executeHeavyMode(makeParams(parallelOrder, true), makeTracingExecutor(events));

        // First agent finishes before either sibling starts.
        expect(events.slice(0, 2)).toEqual(['start:a', 'end:a']);
        expect(events.indexOf('start:b')).toBeGreaterThan(events.indexOf('end:a'));
        // The remaining two still run concurrently.
        expect(events.indexOf('start:c')).toBeLessThan(events.indexOf('end:b'));
    });

    it('fans out immediately when caching is off, leaving latency unchanged', async () => {
        const events: string[] = [];
        await executeHeavyMode(makeParams(parallelOrder, false), makeTracingExecutor(events));

        expect(events.slice(0, 3).sort()).toEqual(['start:a', 'start:b', 'start:c']);
        expect(overlapCount(events)).toBe(3);
    });

    it('warms up only once per turn, not once per order', async () => {
        const agents = [
            agent('a', 1), agent('b', 1),
            agent('c', 2), agent('d', 2),
            agent('gm', 3),
        ];
        const events: string[] = [];
        await executeHeavyMode(makeParams(agents, true), makeTracingExecutor(events));

        // Order 1 is serialised for the warm-up...
        expect(events.indexOf('start:b')).toBeGreaterThan(events.indexOf('end:a'));
        // ...order 2 runs fully parallel because the prefix is already cached.
        expect(events.indexOf('start:d')).toBeLessThan(events.indexOf('end:c'));
    });

    it('produces the same agent outputs either way', async () => {
        const cachedEvents: string[] = [];
        const plainEvents: string[] = [];
        const withCaching = await executeHeavyMode(makeParams(parallelOrder, true), makeTracingExecutor(cachedEvents));
        const withoutCaching = await executeHeavyMode(makeParams(parallelOrder, false), makeTracingExecutor(plainEvents));

        expect(withCaching.finalResponse).toBe(withoutCaching.finalResponse);
        expect(withCaching.agentResponses.map(r => r.agentName).sort())
            .toEqual(withoutCaching.agentResponses.map(r => r.agentName).sort());
    });

    it('does not serialise a single-agent order', async () => {
        const events: string[] = [];
        await executeHeavyMode(makeParams([agent('solo', 1), agent('gm', 2)], true), makeTracingExecutor(events));
        expect(events).toEqual(['start:solo', 'end:solo', 'start:gm', 'end:gm']);
    });

    it('does not count an all-failed order as having warmed the cache', async () => {
        // Nothing in order 1 completed a provider call, so order 2 must still warm
        // up rather than fanning out into a cache that was never written.
        const events: string[] = [];
        const failingFirstOrder = {
            async getWorldSnapshotUpdate(_params: any, a: any) {
                events.push(`start:${a.name}`);
                await new Promise(resolve => setTimeout(resolve, 5));
                events.push(`end:${a.name}`);
                if (a.order === 1) throw new Error('provider exploded');
                return { analysis: 'ok', worldSnapshot: undefined };
            },
            async getDefaultResponse(_params: any, a: any) {
                events.push(`start:${a.name}`);
                events.push(`end:${a.name}`);
                return 'narrative';
            },
        } as unknown as AgentApiExecutor;

        const agents = [agent('a', 1), agent('b', 1), agent('c', 2), agent('d', 2), agent('gm', 3)];
        await executeHeavyMode(makeParams(agents, true), failingFirstOrder);

        // Order 1 serialised for the warm-up that then failed...
        expect(events.indexOf('start:b')).toBeGreaterThan(events.indexOf('end:a'));
        // ...so order 2 serialises too, instead of assuming a warm cache.
        expect(events.indexOf('start:d')).toBeGreaterThan(events.indexOf('end:c'));
    });

    it('counts a successful sibling as having warmed the cache', async () => {
        // Only the *first* agent failed; its sibling completed a real call, so the
        // prefix is warm and later orders can fan out immediately.
        const events: string[] = [];
        const firstAgentFails = {
            async getWorldSnapshotUpdate(_params: any, a: any) {
                events.push(`start:${a.name}`);
                await new Promise(resolve => setTimeout(resolve, 5));
                events.push(`end:${a.name}`);
                if (a.name === 'a') throw new Error('provider exploded');
                return { analysis: 'ok', worldSnapshot: undefined };
            },
            async getDefaultResponse(_params: any, a: any) {
                events.push(`start:${a.name}`);
                events.push(`end:${a.name}`);
                return 'narrative';
            },
        } as unknown as AgentApiExecutor;

        const agents = [agent('a', 1), agent('b', 1), agent('c', 2), agent('d', 2), agent('gm', 3)];
        await executeHeavyMode(makeParams(agents, true), firstAgentFails);

        expect(events.indexOf('start:d')).toBeLessThan(events.indexOf('end:c'));
    });

    it('walks past a local result-cache hit before fanning out cold siblings', async () => {
        const resultCache = createAgentResultCache();
        const firstEvents: string[] = [];
        await executeHeavyMode(
            { ...makeParams([agent('a', 1)], true), agentCache: resultCache },
            makeTracingExecutor(firstEvents)
        );

        const events: string[] = [];
        await executeHeavyMode(
            { ...makeParams(parallelOrder, true), agentCache: resultCache },
            makeTracingExecutor(events)
        );

        // a was served locally and emitted no events. b must finish the real
        // provider warm-up before c is allowed to start.
        expect(events.slice(0, 2)).toEqual(['start:b', 'end:b']);
        expect(events.indexOf('start:c')).toBeGreaterThan(events.indexOf('end:b'));
    });

    it('warms different visibility prefixes independently', async () => {
        const visible = { playerNotes: true, setting: true, personality: true, playerDescription: true };
        const hidden = { playerNotes: false, setting: false, personality: false, playerDescription: false };
        const agents = [
            { ...agent('a', 1), instructionVisibility: visible },
            { ...agent('b', 1), instructionVisibility: visible },
            { ...agent('c', 1), instructionVisibility: hidden },
            { ...agent('d', 1), instructionVisibility: hidden },
            agent('gm', 2),
        ];
        const events: string[] = [];
        await executeHeavyMode(makeParams(agents, true), makeTracingExecutor(events));

        // The two unrelated warm-up calls may run together.
        expect(events.indexOf('start:c')).toBeLessThan(events.indexOf('end:a'));
        // Each group's sibling waits for its own warm-up.
        expect(events.indexOf('start:b')).toBeGreaterThan(events.indexOf('end:a'));
        expect(events.indexOf('start:d')).toBeGreaterThan(events.indexOf('end:c'));
    });
});
