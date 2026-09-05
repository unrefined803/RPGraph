import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type ModelListApi = Record<string, (connection: object, onAbort?: (cancel: () => void) => void) => Promise<unknown>>;

const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
function bridge(invoke: ReturnType<typeof vi.fn>) {
  let api!: ModelListApi;
  runInNewContext(preload, {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name: string, exposed: ModelListApi) => { api = exposed; } },
      ipcRenderer: { invoke }, webFrame: {},
    }),
  });
  return api;
}

describe.each([
  ['listLmStudioModels', 'lmstudio'], ['listLlamaCppModels', 'llamacpp'],
  ['listOllamaModels', 'ollama'], ['listOpenRouterModels', 'openrouter'], ['listGeminiModels', 'gemini'],
] as const)('%s IPC', (method, channel) => {
  it('cancels an in-flight model lookup', async () => {
    const invoke = vi.fn((name: string) => name === 'llm:cancel-request'
      ? Promise.resolve() : new Promise(() => {}));
    const api = bridge(invoke);
    let cancel!: () => void;
    const result = api[method]({}, (callback) => { cancel = callback; });
    cancel();
    await expect(result).rejects.toThrow('cancelled');
    expect(invoke).toHaveBeenCalledWith(`${channel}:list-models`, expect.objectContaining({ requestId: 1 }));
    expect(invoke).toHaveBeenCalledWith('llm:cancel-request', 1);
  });

  it('propagates provider errors instead of treating them as model lists', async () => {
    const api = bridge(vi.fn().mockResolvedValue({ __rpgraphLlmError: true, message: 'Provider unavailable' }));
    await expect(api[method]({})).rejects.toThrow('Provider unavailable');
  });
});
