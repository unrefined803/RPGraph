import { expect, it, vi } from 'vitest';
import { chat, listModels } from './providers/chatgptAdapter.cjs';

const connection = { id: 'provider', providerKind: 'chatgpt', label: 'ChatGPT',
  baseUrl: 'https://untrusted.example', apiKey: 'ignored', model: 'selected-model', chatgptProfileId: 'profile' };
const auth = { accessToken: vi.fn(async () => 'oauth-token') };
const signal = () => new AbortController().signal;
function event(value: object) { return `data: ${JSON.stringify(value)}\r\n\r\n`; }
function streamResponse(value: string) {
  const encoded = new TextEncoder().encode(value);
  // Split every byte, including CRLF separators and multibyte text.
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
}

it('uses the selected profile and sends only the supported Responses fields', async () => {
  const chunks: string[] = [];
  const fetchMock = vi.fn(async () => streamResponse(event({ type: 'response.output_text.delta', delta: 'Héllo' }) +
    event({ type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 4 } } })));
  const request = { connection, prompt: 'Prompt', temperature: 0.2, maxTokens: 12, images: [{ dataUrl: 'data:image/png;base64,aGVsbG8=' }] };
  const result = await chat(auth, '/workspace', request, signal(), chunk => chunks.push(chunk), fetchMock);
  expect(result).toEqual({ text: 'Héllo', usage: { input_tokens: 12, output_tokens: 4 } });
  expect(chunks).toEqual(['Héllo']);
  expect(auth.accessToken).toHaveBeenCalledWith('/workspace', 'profile', expect.any(AbortSignal));
  expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({
    redirect: 'error', headers: { Authorization: 'Bearer oauth-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'selected-model', store: false, stream: true,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Prompt' },
        { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }] }],
      reasoning: { effort: 'low' } }),
  }));
});

it('collects an internal stream for callers without a chunk callback', async () => {
  const fetchMock = vi.fn(async () => streamResponse(event({ type: 'response.completed', response: {
    output: [{ content: [{ type: 'output_text', text: 'Completed result' }] }],
  } })));
  expect((await chat(auth, '/workspace', { connection, prompt: 'Prompt' }, signal(), undefined, fetchMock)).text).toBe('Completed result');
});

it.each([
  [event({ type: 'response.output_text.delta', delta: 'Partial' }), 'before the response completed'],
  [event({ type: 'response.incomplete' }), 'incomplete'],
  [event({ type: 'response.completed', response: { output: [] } }), 'did not contain text'],
])('rejects incomplete or empty inference', async (body, message) => {
  await expect(chat(auth, '/workspace', { connection, prompt: 'Prompt' }, signal(), undefined,
    vi.fn(async () => streamResponse(body)))).rejects.toThrow(message);
});

it('preserves a usage-limit failure received after streaming begins', async () => {
  const fetchMock = vi.fn(async () => streamResponse(event({ type: 'response.output_text.delta', delta: 'Partial' }) +
    event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } })));
  await expect(chat(auth, '/workspace', { connection, prompt: 'Prompt' }, signal(), undefined, fetchMock))
    .rejects.toMatchObject({ code: 'subscription_sharing_usage_limit_exceeded', message: expect.stringContaining('Manage usage') });
});

it('returns visible account-specific model names and slugs in server order', async () => {
  const fetchMock = vi.fn(async () => Response.json({ models: [
    { slug: 'second', display_name: 'Second model', visibility: 'list' },
    { slug: 'hidden', visibility: 'hide' }, { slug: 'first', visibility: 'list' },
  ] }));
  expect(await listModels(auth, '/workspace', 'profile', signal(), fetchMock)).toEqual([
    { id: 'second', name: 'Second model' }, { id: 'first', name: 'first' },
  ]);
  expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({ redirect: 'error' }));
});

it.each(['subscription_sharing_usage_unavailable', 'subscription_sharing_user_unavailable'])(
  'reports temporary streamed failures with their correct status: %s', async code => {
    const fetchMock = vi.fn(async () => streamResponse(event({ type: 'response.failed', response: { error: { code } } })));
    await expect(chat(auth, '/workspace', { connection, prompt: 'Prompt' }, signal(), undefined, fetchMock))
      .rejects.toMatchObject({ code, status: 503, message: expect.stringContaining('retry later') });
  },
);

it('preserves admission status and request ID without leaking response details', async () => {
  const fetchMock = vi.fn(async () => Response.json({ detail: 'private diagnostic' }, { status: 403, headers: { 'x-request-id': 'request-123' } }));
  await expect(listModels(auth, '/workspace', 'profile', signal(), fetchMock)).rejects.toMatchObject({ status: 403, requestId: 'request-123' });
  await expect(listModels(auth, '/workspace', 'profile', signal(), fetchMock)).rejects.not.toThrow('private diagnostic');
});

it.each(['low', 'medium', 'high'] as const)('sends the selected thinking effort: %s', async effort => {
  const fetchMock = vi.fn(async () => streamResponse(event({ type: 'response.completed', response: {
    output: [{ content: [{ type: 'output_text', text: 'Result' }] }],
  } })));
  await chat(auth, '/workspace', { connection: { ...connection, reasoningEffort: effort }, prompt: 'Prompt' }, signal(), undefined, fetchMock);
  const body = JSON.parse((fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1].body as string);
  expect(body.reasoning).toEqual({ effort });
});
