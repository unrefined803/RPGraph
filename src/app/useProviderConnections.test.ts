import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';
import type { ConnectionPreset, LlmProviderKind } from '../types';
import { defaultConnection } from '../settings';
import { useProviderConnections } from './useProviderConnections';

// Drive hook state explicitly so delayed IPC replies can race with user edits
// without introducing a DOM dependency into the node-based test suite.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function'
        ? (update as (current: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => {},
}));

const providers = [
  ['lm-studio', 'listLmStudioModels'],
  ['llama-cpp', 'listLlamaCppModels'],
  ['ollama', 'listOllamaModels'],
  ['openrouter', 'listOpenRouterModels'],
  ['gemini', 'listGeminiModels'],
] as const;
const models = [false, true].map((vision) => ({
  id: vision ? 'vision-model' : 'text-model', name: 'Model', type: 'llm',
  vision, text: true, trainedForToolUse: false, status: 'loaded',
  inputModalities: vision ? ['text', 'image'] : ['text'], outputModalities: ['text'],
  supportedVoices: [], supportedParameters: [], supportedGenerationMethods: ['generateContent'],
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(providerKind: LlmProviderKind, model = 'text-model') {
  let connections: ConnectionPreset[] = [{
    ...defaultConnection, id: 'provider', providerKind, apiKey: 'test-key', model, vision: false,
  }];
  const setConnections: Dispatch<SetStateAction<ConnectionPreset[]>> = (update) => {
    connections = typeof update === 'function' ? update(connections) : update;
  };
  return {
    get connections() { return connections; },
    setConnections,
    render() {
      hooks.index = 0;
      // The mocked hook runtime above provides the state normally owned by React.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useProviderConnections({
        connections, setConnections, defaultConnectionId: 'provider', setDefaultConnectionId: vi.fn(),
        settingsLoadComplete: false, isRunning: false, nodesRef: { current: [] },
        setNodes: vi.fn(), notifySystem: vi.fn(),
      });
    },
  };
}

beforeEach(() => { hooks.slots = []; hooks.index = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

describe.each(providers)('%s model capabilities', (kind, listMethod) => {
  it('keeps the current saved model capabilities when an old check completes', async () => {
    const pending = deferred<typeof models>();
    vi.stubGlobal('window', { rpgraph: { [listMethod]: vi.fn(() => pending.promise) } });
    const state = harness(kind);
    const api = state.render();
    const check = api.checkProviderConnectionById('provider');
    const selected = { ...state.connections[0], model: 'vision-model', vision: true };
    state.setConnections([selected]);
    api.setEditingConnection(selected);
    pending.resolve(models);
    await check;
    expect(state.connections[0]).toMatchObject({ model: 'vision-model', vision: true });
    expect(state.render().editingConnection.vision).toBe(true);
  });

  it('detects vision when automatically selecting a model without a warm cache', async () => {
    vi.stubGlobal('window', { rpgraph: {
      [listMethod]: vi.fn().mockResolvedValue([models[1]]),
      listModels: vi.fn().mockResolvedValue(['vision-model']),
    } });
    const state = harness(kind, '');
    const resolved = await state.render().resolveConnection();
    expect(resolved).toMatchObject({ model: 'vision-model', vision: true });
    expect(state.connections[0]).toMatchObject({ model: 'vision-model', vision: true });
  });

  it('does not overwrite a model or other edits saved during automatic selection', async () => {
    const pending = deferred<typeof models>();
    vi.stubGlobal('window', { rpgraph: { [listMethod]: vi.fn(() => pending.promise) } });
    const state = harness(kind, '');
    const resolve = state.render().resolveConnection();
    state.setConnections([{ ...state.connections[0], model: 'chosen-model', label: 'Edited' }]);
    pending.resolve(models);
    await resolve;
    expect(state.connections[0]).toMatchObject({ model: 'chosen-model', label: 'Edited' });
  });

  it('does not save an automatic selection after cancellation', async () => {
    const pending = deferred<typeof models>();
    vi.stubGlobal('window', { rpgraph: { [listMethod]: vi.fn(() => pending.promise) } });
    const state = harness(kind, '');
    const controller = new AbortController();
    const resolve = state.render().resolveConnection(undefined, undefined, controller.signal);
    controller.abort();
    pending.resolve(models);
    await expect(resolve).rejects.toThrow('cancelled');
    expect(state.connections[0].model).toBe('');
  });
});

describe.each([
  ['lm-studio', 'loadLmStudioModel'], ['lm-studio', 'unloadLmStudioModels'],
  ['ollama', 'loadOllamaModel'], ['ollama', 'unloadOllamaModels'],
  ['llama-cpp', 'loadLlamaCppModel'], ['llama-cpp', 'unloadLlamaCppModels'],
] as const)('%s %s', (kind, method) => {
  it('preserves a different preset selected while the command is running', async () => {
    const pending = deferred<{ unloadedCount: number }>();
    const command = vi.fn(() => pending.promise);
    vi.stubGlobal('window', { rpgraph: { [method]: command, listLlamaCppModels: vi.fn().mockResolvedValue(models) } });
    const state = harness(kind);
    state.render().setEditingConnection(state.connections[0]);
    const api = state.render();
    const action = api[method]();
    const selected = { ...state.connections[0], id: 'other', model: 'other-model' };
    api.setEditingConnection(selected);
    pending.resolve({ unloadedCount: 1 });
    await action;
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider', model: 'text-model' }));
    expect(state.render().editingConnection).toEqual(selected);
  });
});
