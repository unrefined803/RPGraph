import { afterEach, expect, it, vi } from 'vitest';
import { NodeLlmApi } from './NodeLlmApi';
import type { ConnectionPreset } from '../types';

const connection = { id: 'provider', label: 'Provider', model: 'test', vision: false } as ConnectionPreset;
afterEach(() => vi.unstubAllGlobals());

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
