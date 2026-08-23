import { afterEach, describe, expect, it, vi } from 'vitest';
import { callProxy } from '../../services/proxy/client';
import { getGameTurnStream } from '../../services/proxy/gameplay';
import { fetchChatCompletion } from '../../services/proxy/proxyHelper';
import { Character } from '../../types';

const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const init = () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        model: 'some/model',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
        stream_options: { include_usage: true },
        usage: { include: true },
    }),
});

const bodyOf = (call: any) => JSON.parse(call[1].body);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('completion requests are single-attempt', () => {
    it('performs one fetch on success', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await fetchChatCompletion('https://api.example.com/v1/chat/completions', init());

        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not resend when telemetry fields are rejected', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            jsonResponse(400, { error: { message: 'Unrecognized request argument: stream_options' } })
        );
        vi.stubGlobal('fetch', fetchMock);

        const response = await fetchChatCompletion('https://api.example.com/v1/chat/completions', init());

        expect(response.status).toBe(400);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(bodyOf(fetchMock.mock.calls[0]).stream_options).toEqual({ include_usage: true });
        await expect(response.text()).resolves.toContain('stream_options');
    });

    it.each([500, 502, 503, 504, 429])('does not retry HTTP %s', async (status) => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(status, { error: { message: 'upstream failure' } }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await fetchChatCompletion('https://api.example.com/v1/chat/completions', init());

        expect(response.status).toBe(status);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry a network error', async () => {
        const networkError = new TypeError('network down');
        const fetchMock = vi.fn().mockRejectedValue(networkError);
        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchChatCompletion('https://api.example.com/v1/chat/completions', init()))
            .rejects.toBe(networkError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not issue a non-stream fallback for a reasoning-only story response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(
            'data: {"choices":[{"delta":{"reasoning":"internal"}}]}\n\ndata: [DONE]\n',
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        ));
        vi.stubGlobal('fetch', fetchMock);
        const character: Character = {
            id: 'c',
            name: 'Char',
            image: '',
            personality: '',
            firstMessages: [],
            systemInstructionTemplate: 'Write the story.',
            playerDescription: '',
            setting: '',
            playerName: 'Player',
        };
        const stream = getGameTurnStream(
            [{ id: 'u', text: 'Go.', isPlayer: true }],
            '',
            character,
            0,
            false,
            [],
            {
                proxyUrl: 'https://api.example.com/v1/chat/completions',
                apiKey: 'test',
                model: 'reasoning/model',
            }
        );

        const consume = async () => {
            for await (const _chunk of stream) {
                // Consume the stream until the explicit empty-narrative error.
            }
        };

        await expect(consume()).rejects.toThrow(/no story text/i);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe('stream_options is opt-in per host', () => {
    // Requests are single-attempt, so a proxy that rejects an unknown field has no
    // recovery path — the field must never be sent blind just to collect telemetry.
    const streamedBodyFor = async (proxyUrl: string) => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(
            'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n',
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        ));
        vi.stubGlobal('fetch', fetchMock);
        const character: Character = {
            id: 'c', name: 'Char', image: '', personality: '', firstMessages: [],
            systemInstructionTemplate: 'Write the story.', playerDescription: '',
            setting: '', playerName: 'Player',
        };
        const stream = getGameTurnStream(
            [{ id: 'u', text: 'Go.', isPlayer: true }], '', character, 0, false, [],
            { proxyUrl, apiKey: 'test', model: 'some/model' }
        );
        for await (const _chunk of stream) { /* drain */ }
        return bodyOf(fetchMock.mock.calls[0]);
    };

    it('omits stream_options for an unverified proxy', async () => {
        const body = await streamedBodyFor('https://api.example.com/v1/chat/completions');
        expect(body.stream).toBe(true);
        expect(body.stream_options).toBeUndefined();
    });

    it('still sends stream_options to OpenRouter', async () => {
        const body = await streamedBodyFor('https://openrouter.ai/api/v1/chat/completions');
        expect(body.stream_options).toEqual({ include_usage: true });
    });
});

describe('OpenRouter request routing', () => {
    it('passes the chat session id through the real callProxy request body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 10, completion_tokens: 1 },
        }));
        vi.stubGlobal('fetch', fetchMock);

        await callProxy(
            {
                proxyUrl: 'https://openrouter.ai/api/v1/chat/completions',
                apiKey: 'test',
                model: 'anthropic/claude-opus-5',
                extraParams: '',
            },
            'anthropic/claude-opus-5',
            [{ role: 'user', content: 'hi' }],
            false,
            undefined,
            'test',
            'rwe:chat-1'
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(bodyOf(fetchMock.mock.calls[0]).session_id).toBe('rwe:chat-1');
    });
});
