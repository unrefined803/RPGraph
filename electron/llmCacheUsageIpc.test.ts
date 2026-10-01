import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { createTextStreamBatch } from './streamBatch.cjs';

const require = createRequire(import.meta.url);
const { LmStudioSseParser, lmStudioResponseText } = require('./lmStudioChat.cjs');
const { chat: lmStudioAdapterChat } = require('./providers/lmStudioAdapter.cjs');
const { veniceChatBody, veniceResponseText } = require('./veniceApi.cjs');
const { reasoningTextFromChatMessage } = require('./reasoningStream.cjs');

type Stats = { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; totalTokens?: number };
type Completion = { text: string; stats: Stats };
type LlmRequest = { connection: Record<string, string>; prompt: string; requestId: number };
type Handler = (event: unknown, request: LlmRequest) => Promise<Completion>;
type Reply = { json?: unknown; events?: unknown[]; done?: boolean };

const main = readFileSync(new URL('./main.cjs', import.meta.url), 'utf8');
const slice = (from: string, to: string) => main.slice(main.indexOf(from), main.indexOf(to, main.indexOf(from)));
const source = [
  slice('function textFromGeminiContent(', 'const supportedReasoningEfforts'),
  slice('function textFromChatContentPart(', 'function llmRequestId('),
  slice('async function requestLmStudioChat(', 'async function requestLmStudioV0Json('),
  slice('function isGeminiProviderConnection(', 'function isComfyConnectionUnavailable('),
  slice("handleWorkspace('llm:chat-completion',", "ipcMain.handle('llm:cancel-request',"),
].join('\n');

// Split every event across two network chunks so usage must survive buffering.
function sseBody(events: unknown[], done = true) {
  const bytes = new TextEncoder().encode(
    events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : ''),
  );
  const middle = Math.floor(bytes.length / 2) + 1;
  return (async function* chunks() { yield bytes.slice(0, middle); yield bytes.slice(middle); })();
}

function handlers(reply: Reply) {
  const registered: Record<string, Handler> = {};
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  runInNewContext(source, {
    handleWorkspace: (channel: string, handler: Handler) => { registered[channel] = handler; },
    createLlmAbortController: () => ({ signal: new AbortController().signal, dispose: () => {} }),
    requestLlmResponse: async (url: string, init: { body: string }) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => reply.json, body: reply.events && sseBody(reply.events, reply.done) };
    },
    limitedResponseChunks: (stream: AsyncIterable<Uint8Array>) => stream,
    freeComfyMemoryForLocalLlm: async () => {}, ensureLlamaCppModelLoaded: async () => {},
    isLmStudioProviderConnection: (connection: { providerKind?: string }) => connection?.providerKind === 'lm-studio',
    lmStudioReasoningProfile: async () => ({}), lmStudioChatBody: () => ({}),
    lmStudioEndpoint: () => 'lm-studio/chat', LmStudioSseParser, lmStudioResponseText, lmStudioAdapterChat,
    geminiApiUrl: (_connection: unknown, method: string) => `gemini/${method}`, geminiRequestBody: () => ({}),
    compositeEndpoint: (_connection: unknown, route: string) => `composite/${route}`,
    veniceEndpoint: (_connection: unknown, route: string) => `venice/${route}`, veniceChatBody, veniceResponseText,
    endpoint: (_baseUrl: string, route: string) => `generic/${route}`,
    requestHeaders: () => ({}), chatMessageContent: (prompt: string) => prompt,
    chatCompletionSamplingOptions: () => ({}), chatCompletionReasoningOptions: () => ({}),
    reasoningTextFromChatMessage, createTextStreamBatch, performance, TextDecoder,
    normalizeLlmError: (error: unknown) => error,
  });
  return { registered, requests };
}

const event = { sender: { send: () => {}, isDestroyed: () => false } };

async function run(providerKind: string, stream: boolean, reply: Reply) {
  const { registered, requests } = handlers(reply);
  const request = { connection: { providerKind, baseUrl: 'http://provider.invalid/v1', model: 'model' }, prompt: 'Prompt', requestId: 1 };
  const result = await registered[stream ? 'llm:chat-completion-stream' : 'llm:chat-completion'](event, request);
  return { result, request: requests[0] };
}

const chatUsage = (details: Record<string, unknown>) => ({ prompt_tokens: 4096, completion_tokens: 100, total_tokens: 4196, ...details });
const chatReply = (usage: unknown): Reply => ({
  json: { choices: [{ message: { content: 'Hello world' }, finish_reason: 'stop' }], usage },
  events: [
    { choices: [{ delta: { content: 'Hello' } }] },
    { choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] },
    // OpenAI-style streams report usage in a trailing chunk without choices.
    ...(usage === undefined ? [] : [{ choices: [], usage }]),
  ],
});
const geminiUsage = (cached?: number) => ({
  promptTokenCount: 4096, candidatesTokenCount: 100, totalTokenCount: 4196,
  ...(cached === undefined ? {} : { cachedContentTokenCount: cached }),
});
const geminiReply = (cached?: number): Reply => ({
  json: { candidates: [{ content: { parts: [{ text: 'Hello world' }] } }], usageMetadata: geminiUsage(cached) },
  events: [
    { candidates: [{ content: { parts: [{ text: 'Hello' }] } }], usageMetadata: { promptTokenCount: 4096 } },
    { candidates: [{ content: { parts: [{ text: ' world' }] }, finishReason: 'STOP' }], usageMetadata: geminiUsage(cached) },
  ],
});
const lmStudioResult = { output: [{ type: 'message', content: 'Hello world' }], stats: { input_tokens: 4096, total_output_tokens: 100 } };
const lmStudioReply: Reply = {
  json: lmStudioResult,
  // The native LM Studio stream ends with chat.end instead of a [DONE] marker.
  events: [{ type: 'message.delta', content: 'Hello world' }, { type: 'chat.end', result: lmStudioResult }],
  done: false,
};

const chatCompletionProviders = ['openrouter', 'llama-cpp', 'ollama', 'unsloth', 'openai-compatible', 'composite', 'venice'];
const modes = [false, true];
const cases = chatCompletionProviders.flatMap(provider => modes.map(stream => [provider, stream] as const));

it.each(cases)('%s (stream: %s) reports Chat Completions cache hits, zero, and unknown', async (provider, stream) => {
  for (const cached of [2048, 0]) {
    const { result, request } = await run(provider, stream, chatReply(chatUsage({ prompt_tokens_details: { cached_tokens: cached } })));
    expect(result.text).toBe('Hello world');
    expect(result.stats.cachedInputTokens).toBe(cached);
    // Cached tokens are part of the input and must not inflate any total.
    expect([result.stats.inputTokens, result.stats.outputTokens, result.stats.totalTokens]).toEqual([4096, 100, 4196]);
    expect(request.url).toBe(`${provider === 'composite' || provider === 'venice' ? provider : 'generic'}/chat/completions`);
    expect(request.body.stream_options).toEqual(stream ? { include_usage: true } : undefined);
  }
  const unknown = await run(provider, stream, chatReply(chatUsage({})));
  expect(unknown.result.stats.inputTokens).toBe(4096);
  expect('cachedInputTokens' in unknown.result.stats).toBe(false);
});

it.each(chatCompletionProviders)('%s stream without a usage chunk leaves all token counts unknown', async provider => {
  const { result } = await run(provider, true, chatReply(undefined));
  expect(result.text).toBe('Hello world');
  expect([result.stats.inputTokens, result.stats.cachedInputTokens, result.stats.totalTokens]).toEqual([undefined, undefined, undefined]);
});

it.each(modes)('openai-compatible (stream: %s) reads DeepSeek-style cache hit counts', async stream => {
  const usage = chatUsage({ prompt_cache_hit_tokens: 1024, prompt_cache_miss_tokens: 3072 });
  const { result } = await run('openai-compatible', stream, chatReply(usage));
  expect([result.stats.inputTokens, result.stats.cachedInputTokens, result.stats.totalTokens]).toEqual([4096, 1024, 4196]);
  const standardFirst = chatUsage({ prompt_cache_hit_tokens: 1024, prompt_tokens_details: { cached_tokens: 512 } });
  expect((await run('openai-compatible', stream, chatReply(standardFirst))).result.stats.cachedInputTokens).toBe(512);
});

it.each(modes)('gemini (stream: %s) reports cached content tokens, zero, and unknown', async stream => {
  for (const cached of [2048, 0, undefined]) {
    const { result, request } = await run('gemini', stream, geminiReply(cached));
    expect(result.text).toBe('Hello world');
    expect(request.url).toBe(stream ? 'gemini/streamGenerateContent' : 'gemini/generateContent');
    expect([result.stats.inputTokens, result.stats.outputTokens, result.stats.totalTokens]).toEqual([4096, 100, 4196]);
    expect(result.stats.cachedInputTokens).toBe(cached);
  }
});

it.each(modes)('lm-studio (stream: %s) keeps cache usage unknown because native stats omit it', async stream => {
  const { result } = await run('lm-studio', stream, lmStudioReply);
  expect(result.text).toBe('Hello world');
  expect([result.stats.inputTokens, result.stats.outputTokens]).toEqual([4096, 100]);
  expect('cachedInputTokens' in result.stats).toBe(false);
});
