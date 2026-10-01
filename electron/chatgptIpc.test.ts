import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createTextStreamBatch } from './streamBatch.cjs';

type Request = { connection: { model: string; chatgptProfileId: string }; prompt: string; requestId?: number };
type Completion = { text: string; stats?: { inputTokens?: number; outputTokens?: number } };
type Bridge = {
  chatCompletion: (request: Request) => Promise<Completion>;
  streamChatCompletion: (request: Request, onChunk: (text: string) => void) => Promise<Completion>;
};

const main = readFileSync(new URL('./main.cjs', import.meta.url), 'utf8');
const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
const start = main.indexOf("handleWorkspace('llm:chat-completion',");
const end = main.indexOf("ipcMain.handle('llm:cancel-request',", start);

function bridge(fail = false) {
  type Event = { sender: { send: (channel: string, payload: unknown) => void; isDestroyed: () => boolean } };
  const handlers: Record<string, (event: Event, request: Request) => Promise<unknown>> = {};
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>();
  const dispose = vi.fn();
  const chatgptChat = vi.fn(async (_auth, _root, _request, _signal, onDelta?: (text: string) => void) => {
    onDelta?.('Hello');
    onDelta?.(' world');
    if (fail) throw Object.assign(new Error('Usage limit reached'), { code: 'subscription_sharing_usage_limit_exceeded', status: 429, requestId: 'request-1' });
    return { text: 'Hello world', usage: { input_tokens: 10, output_tokens: 3 } };
  });
  const context = {
    handleWorkspace: (channel: string, handler: typeof handlers[string]) => { handlers[channel] = handler; },
    createLlmAbortController: () => ({ signal: new AbortController().signal, dispose }),
    chatgptChat, chatgptAuth: {}, localAccounts: { root: '/accounts/alice' }, performance,
    createTextStreamBatch, usageReasoningTokens: () => undefined,
    llmStatsFromUsage: (usage: { input_tokens: number; output_tokens: number }) => ({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }),
    failedLlmIpcResult: (error: Error) => ({ __rpgraphLlmError: true, ...error, message: error.message }),
  };
  runInNewContext(main.slice(start, end), context);
  let api!: Bridge;
  const event: Event = { sender: { send: (channel, payload) => listeners.get(channel)?.({}, payload), isDestroyed: () => false } };
  runInNewContext(preload, { require: () => ({
    contextBridge: { exposeInMainWorld: (_name: string, value: typeof api) => { api = value; } },
    ipcRenderer: {
      invoke: (channel: string, request: Request) => handlers[channel]?.(event, request),
      on: (channel: string, listener: (event: unknown, payload: unknown) => void) => listeners.set(channel, listener),
      removeListener: (channel: string) => listeners.delete(channel),
    }, webFrame: {},
  }) });
  return { api, chatgptChat, dispose, listeners };
}
const connection = { id: 'provider', label: 'ChatGPT', providerKind: 'chatgpt',
  apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'model', chatgptProfileId: 'profile' };

it('routes ordinary node completion through the adapter and preserves token metrics', async () => {
  const { api, chatgptChat, dispose } = bridge();
  expect(await api.chatCompletion({ connection, prompt: 'Prompt' })).toEqual({ text: 'Hello world', stats: { inputTokens: 10, outputTokens: 3 } });
  expect(chatgptChat).toHaveBeenCalledWith({}, '/accounts/alice', expect.objectContaining({ connection }), expect.any(AbortSignal));
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('preserves accumulated streaming callbacks and removes bridge listeners', async () => {
  const { api, dispose, listeners } = bridge();
  const chunks: string[] = [];
  const result = await api.streamChatCompletion({ connection, prompt: 'Prompt' }, text => chunks.push(text));
  expect(result.text).toBe('Hello world');
  expect(chunks.at(-1)).toBe('Hello world');
  expect(listeners.size).toBe(0);
  expect(dispose).toHaveBeenCalledTimes(1);
});

it.each(['chatCompletion', 'streamChatCompletion'] as const)('%s preserves structured usage errors across IPC', async method => {
  const { api } = bridge(true);
  const result = method === 'chatCompletion'
    ? api.chatCompletion({ connection, prompt: 'Prompt' })
    : api.streamChatCompletion({ connection, prompt: 'Prompt' }, () => {});
  await expect(result).rejects.toMatchObject({ code: 'subscription_sharing_usage_limit_exceeded', status: 429, requestId: 'request-1' });
});
