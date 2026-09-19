import { afterEach, expect, it, vi } from 'vitest';
import { NodeLlmApi } from './NodeLlmApi';
import type { ConnectionPreset } from '../types';

const connection = { id: 'provider', label: 'Provider', model: 'test', vision: false } as ConnectionPreset;
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
