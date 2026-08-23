import { describe, it, expect } from 'vitest';
import { buildAgentMessages as buildProxyAgentMessages } from '../../services/proxy/gameplay';
import { buildAgentMessages as buildGeminiAgentMessages } from '../../services/gemini/gameplay';
import { HeavyModeParams } from '../../services/common/gameplay';
import { cleanModelOutputForPrompt } from '../../services/common/promptText';
import { AgentSettings, Character, StoryTurn } from '../../types';

// World Model agents must NEVER see the model's reasoning — not the history's <think>
// blocks, not a previous turn's, regardless of the active API preset's story-history
// switch. Analyzers that read a scratchpad audit
// the scratchpad instead of the prose, and it is pure token waste on every fan-out.

const character: Character = {
    id: 'c1',
    name: 'Aurelia',
    image: '',
    personality: 'PERSONALITY',
    firstMessages: [],
    systemInstructionTemplate: 'TEMPLATE',
    playerDescription: 'PLAYER DESCRIPTION',
    setting: 'SETTING',
    scenario: 'SCENARIO',
    playerName: 'Alex',
};

const agent: AgentSettings = {
    id: 'curator',
    name: 'World Curator',
    systemInstruction: 'You are the curator.',
    contextMessages: 6,
    model: 'claude-sonnet-4-5',
    order: 1,
    connections: [],
    position: { x: 0, y: 0 },
    instructionVisibility: { playerNotes: true, setting: true, personality: true, playerDescription: true },
};

const storyHistory: StoryTurn[] = [
    { id: '1', isPlayer: true, text: 'player one' },
    { id: '2', isPlayer: false, text: '<think>AGENT_SECRET_ONE</think>\n\nnarrator one' },
    { id: '3', isPlayer: true, text: 'player two' },
    { id: '4', isPlayer: false, text: '<think>AGENT_SECRET_TWO</think>\n\nnarrator two' },
    { id: '5', isPlayer: true, text: 'I open the door.' },
];

const makeParams = (overrides: Partial<HeavyModeParams> = {}): HeavyModeParams => ({
    storyHistory,
    playerNotes: 'PLAYER NOTES',
    character,
    historyContextTurns: 20,
    playerChoice: 'I open the door.',
    agentSettings: [agent],
    updateStatus: () => {},
    logContext: () => {},
    trackedCharacters: [],
    providerSettings: { model: 'claude-sonnet-4-5', proxyUrl: '', apiKey: '' },
    ...overrides,
});

describe('World Model agent prompts never carry reasoning', () => {
    it('strips <think> from the history the proxy agent sees', () => {
        const payload = JSON.stringify(buildProxyAgentMessages(makeParams(), agent, [], 'ROLE'));
        expect(payload).not.toContain('AGENT_SECRET');
        expect(payload).not.toContain('<think');
        expect(payload).toContain('narrator one');
    });

    it('strips <think> from the history the gemini agent sees', () => {
        const payload = JSON.stringify(buildGeminiAgentMessages(makeParams(), agent, [], 'ROLE'));
        expect(payload).not.toContain('AGENT_SECRET');
        expect(payload).not.toContain('<think');
        expect(payload).toContain('narrator one');
    });

    it('strips reasoning from proxy parent-agent output', () => {
        const parent = {
            agentId: 'parent',
            agentName: 'Parent',
            text: '<think>PARENT_SECRET</think>visible parent result',
        };
        const payload = JSON.stringify(buildProxyAgentMessages(makeParams(), agent, [parent], 'ROLE'));
        expect(payload).not.toContain('PARENT_SECRET');
        expect(payload).toContain('visible parent result');
    });

    it('strips reasoning at the Gemini agent context boundary', () => {
        const payload = JSON.stringify(buildGeminiAgentMessages(
            makeParams(),
            agent,
            [],
            '<think>PARENT_SECRET</think>visible parent result'
        ));
        expect(payload).not.toContain('PARENT_SECRET');
        expect(payload).toContain('visible parent result');
    });

    it('uses visible-only text for scratchpad and subgraph quoting', () => {
        expect(cleanModelOutputForPrompt('<think>SCRATCHPAD_SECRET</think>visible analysis'))
            .toBe('visible analysis');
    });

    it('ignores a preset story-history flag even if it is accidentally spread into params', () => {
        // The option is not part of HeavyModeParams by design; smuggling it in must
        // change nothing, so a future refactor that spreads settings into params
        // cannot silently switch reasoning on for the whole agent fan-out.
        const smuggled = makeParams({ includeThinkingInHistory: true } as Partial<HeavyModeParams>);
        const payload = JSON.stringify(buildProxyAgentMessages(smuggled, agent, [], 'ROLE'));
        expect(payload).not.toContain('AGENT_SECRET');
    });
});
