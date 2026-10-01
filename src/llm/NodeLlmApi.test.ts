import { afterEach, expect, it, vi } from 'vitest';
import { NodeLlmApi } from './NodeLlmApi';
import type { ConnectionPreset } from '../types';

const connection = { id: 'provider', label: 'Provider', model: 'test', vision: false, baseUrl: 'http://localhost:1234/v1', apiKey: '' } as ConnectionPreset;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('limits live reasoning updates while preserving the final count and text chunks', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const onReasoningTokens = vi.fn();
  const onChunk = vi.fn();
  vi.stubGlobal('window', { rpgraph: { streamChatCompletion: async (
    _request: unknown, chunk: (text: string) => void, _register: unknown, reasoning: (count: number) => void,
  ) => {
    for (let count = 1; count <= 20; count += 1) {
      now = count * 10;
      reasoning(count);
      chunk(`Text ${count}`);
    }
    return { text: 'Text 20', stats: { inputTokens: 1, outputTokens: 20, reasoningTokens: 42, totalTokens: 63, durationMs: 200 } };
  } } });
  const api = new NodeLlmApi({ resolveConnection: async () => connection, onReasoningTokens });
  await api.complete({ label: 'Test', prompt: 'Hello', nodeId: 'llm', onChunk });
  expect(onReasoningTokens.mock.calls).toEqual([['llm', 1], ['llm', 42]]);
  expect(onChunk).toHaveBeenCalledTimes(20);
});

it.each([false, true])('rejects a successful late IPC reply after abort (streaming: %s)', async (streaming) => {
  const controller = new AbortController();
  const recordCall = vi.fn();
  const onChunk = vi.fn();
  const completed = vi.fn();
  const cancel = vi.fn();
  const response = { text: 'Late reply', stats: { inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1 } };
  vi.stubGlobal('window', { rpgraph: {
    chatCompletion: async (_request: unknown, register: (cancel: () => void) => void) => {
      register(cancel); controller.abort(); return response;
    },
    streamChatCompletion: async (_request: unknown, chunk: (text: string) => void, register: (cancel: () => void) => void) => {
      register(cancel); chunk('Before abort'); controller.abort(); chunk('After abort'); return response;
    },
  } });
  const api = new NodeLlmApi({ resolveConnection: async () => connection, recordCall,
    observeRequest: () => ({ completed }) });
  await expect(api.complete({ label: 'Test', prompt: 'Hello', nodeId: 'prompt', signal: controller.signal,
    ...(streaming ? { onChunk } : {}) })).rejects.toThrow('cancelled');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(recordCall).not.toHaveBeenCalled();
  expect(completed).not.toHaveBeenCalled();
  expect(onChunk.mock.calls).toEqual(streaming ? [['Before abort']] : []);
});

it('does not start a call if cancellation happens during connection resolution', async () => {
  const controller = new AbortController();
  const start = vi.fn();
  const api = new NodeLlmApi({ resolveConnection: async () => { controller.abort(); return connection; }, onCallStart: start });
  await expect(api.complete({ label: 'Test', prompt: 'Hello', nodeId: 'prompt', signal: controller.signal })).rejects.toThrow('cancelled');
  expect(start).not.toHaveBeenCalled();
});

it.each([false, true])('honors mandatory reasoning when dispatching (fast task: %s)', async (fastTask) => {
  const chatCompletion = vi.fn().mockResolvedValue({ text: 'Done', stats: {
    inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1,
  } });
  vi.stubGlobal('window', { rpgraph: { chatCompletion } });
  const api = new NodeLlmApi({ resolveConnection: async () => ({
    ...connection, baseUrl: 'https://openrouter.ai/api/v1', providerKind: 'openrouter',
    reasoningEffort: 'none', reasoningCapabilities: {
      mandatory: true, supportedEfforts: ['high', 'medium', 'low'],
    },
  }) });
  await api.complete({ label: 'Test', prompt: 'Hello', fastTask });
  expect(chatCompletion.mock.calls[0][0].connection.reasoningEffort).toBe(fastTask ? 'low' : 'auto');
});

it.each(['text', 'error', 'disabled'] as const)('tracks actual reasoning activity until %s', async (mode) => {
  const activity = vi.fn();
  vi.stubGlobal('window', { rpgraph: { streamChatCompletion: async (
    _request: unknown, chunk: (text: string) => void, _register: unknown, reasoning: (count: number) => void,
  ) => {
    reasoning(1);
    reasoning(2);
    if (mode === 'error') throw new Error('Stream failed');
    chunk('Answer');
    reasoning(3); // Final usage must not restart the thinking indicator.
    return { text: 'Answer', stats: { inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1 } };
  } } });
  const api = new NodeLlmApi({ resolveConnection: async () => ({
    ...connection, providerKind: 'lm-studio', reasoningEffort: mode === 'disabled' ? 'none' : 'on',
    reasoningCapabilities: { supportedEfforts: ['none', 'on'], defaultEnabled: true },
  }), onReasoningActivity: activity });
  const result = api.complete({ label: 'Test', prompt: 'Hello', nodeId: 'llm', onChunk: () => {} });
  if (mode === 'error') await expect(result).rejects.toThrow('Stream failed');
  else await result;
  expect(activity.mock.calls).toEqual(mode === 'disabled' ? [] : [['llm', true], ['llm', false]]);
});

it.each([false, true])('preserves ChatGPT thinking and vision when dispatching (fast task: %s)', async fastTask => {
  const chatCompletion = vi.fn().mockResolvedValue({ text: 'Done', stats: {
    inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1,
  } });
  vi.stubGlobal('window', { rpgraph: { chatCompletion } });
  const api = new NodeLlmApi({ resolveConnection: async () => ({
    ...connection, providerKind: 'chatgpt', reasoningEffort: 'high',
  }) });
  const images = [{ id: 'image', name: 'image.png', size: 5, dataUrl: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' }];
  await api.complete({ label: 'Test', prompt: 'Hello', fastTask, images });
  expect(chatCompletion.mock.calls[0][0]).toMatchObject({
    connection: { reasoningEffort: 'high' }, images,
  });
});
