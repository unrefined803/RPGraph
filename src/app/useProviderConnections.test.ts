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
  supportedVoices: [] as string[], supportedParameters: [], supportedGenerationMethods: ['generateContent'],
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

const chatgptState = {
  secureStorage: true, lastProfileId: 'saved-profile', profiles: [{
    id: 'saved-profile', label: 'Account', connected: true, sharing: true, storageLocked: false, usageConfirmed: true,
  }],
};

it('reuses the saved ChatGPT profile when creating another model connection', async () => {
  const ipc = { state: vi.fn().mockResolvedValue(chatgptState),
    listModels: vi.fn().mockResolvedValue([{ id: 'selected-model', name: 'Selected model' }]) };
  vi.stubGlobal('window', { rpgraph: { chatgpt: ipc } });
  const state = harness('chatgpt', 'selected-model');
  await state.render().checkProviderConnectionById('provider');
  expect(state.connections[0].chatgptProfileId).toBe('saved-profile');
  const resolved = await state.render().resolveConnection();
  expect(resolved).toMatchObject({ chatgptProfileId: 'saved-profile', model: 'selected-model', reasoningEffort: 'low', vision: true });
  expect(ipc.listModels).toHaveBeenCalledTimes(1);
  expect(state.render().chatgptModelsByProfileId['saved-profile'][0].name).toBe('Selected model');
});

it('does not accept a model missing from the selected ChatGPT account', async () => {
  vi.stubGlobal('window', { rpgraph: { chatgpt: {
    state: vi.fn().mockResolvedValue(chatgptState), listModels: vi.fn().mockResolvedValue([{ id: 'available-model', name: 'Available' }]),
  } } });
  const state = harness('chatgpt', 'unavailable-model');
  await expect(state.render().resolveConnection()).rejects.toThrow('Select a model available');
});

it('requires a model selection before reporting a ChatGPT provider as online', async () => {
  vi.stubGlobal('window', { rpgraph: { chatgpt: {
    state: vi.fn().mockResolvedValue(chatgptState), listModels: vi.fn().mockResolvedValue([{ id: 'available-model', name: 'Available' }]),
  } } });
  const state = harness('chatgpt', '');
  await state.render().checkProviderConnectionById('provider');
  expect(state.render().providerHealthById.provider).toMatchObject({
    status: 'warning', detail: 'Select a model available to this ChatGPT account.',
  });
});

it('keeps a signed-out ChatGPT provider saved and reports that sign-in is needed', async () => {
  const listModels = vi.fn();
  vi.stubGlobal('window', { rpgraph: { chatgpt: { listModels,
    state: vi.fn().mockResolvedValue({ ...chatgptState, profiles: [{ ...chatgptState.profiles[0], connected: false }] }),
  } } });
  const state = harness('chatgpt');
  await state.render().checkProviderConnectionById('provider');
  expect(state.render().providerHealthById.provider).toMatchObject({ status: 'warning', detail: expect.stringContaining('Continue with ChatGPT') });
  expect(state.connections[0].chatgptProfileId).toBe('saved-profile');
  expect(listModels).not.toHaveBeenCalled();
});

it('moves a preset from a signed-out ChatGPT profile to the current account and keeps its model', async () => {
  const listModels = vi.fn().mockResolvedValue([{ id: 'selected-model', name: 'Selected model' }]);
  vi.stubGlobal('window', { rpgraph: { chatgpt: { listModels, state: vi.fn().mockResolvedValue(chatgptState) } } });
  const state = harness('chatgpt', 'selected-model');
  state.setConnections([{ ...state.connections[0], chatgptProfileId: 'removed-profile' }]);
  const resolved = await state.render().resolveConnection();
  expect(resolved).toMatchObject({ chatgptProfileId: 'saved-profile', model: 'selected-model' });
  expect(state.connections[0]).toMatchObject({ chatgptProfileId: 'saved-profile', model: 'selected-model' });
  expect(listModels).toHaveBeenCalledWith(expect.objectContaining({ chatgptProfileId: 'saved-profile' }), expect.any(Function));
});

it('offers the thinking levels reported for the selected ChatGPT model', async () => {
  const reasoning = { mandatory: false, supportedEfforts: ['none' as const, 'medium' as const, 'xhigh' as const], defaultEffort: 'medium' as const };
  vi.stubGlobal('window', { rpgraph: { chatgpt: { state: vi.fn().mockResolvedValue(chatgptState), listModels: vi.fn().mockResolvedValue([
    { id: 'deep-model', name: 'Deep', reasoning }, { id: 'plain-model', name: 'Plain' },
  ]) } } });
  const state = harness('chatgpt', 'plain-model');
  state.setConnections([{ ...state.connections[0], chatgptProfileId: 'saved-profile', reasoningEffort: 'high' }]);
  state.render().setEditingConnection(state.connections[0]);
  await state.render().checkProviderConnectionById('provider');
  expect(state.render().editingConnectionReasoning).toMatchObject({ supportedEfforts: ['low', 'medium', 'high'] });
  state.render().editConnection('model', 'deep-model');
  expect(state.render().editingConnectionReasoning).toEqual(reasoning);
  expect(state.render().editingConnection.reasoningEffort).toBe('medium');
  state.render().editConnection('reasoningEffort', 'xhigh');
  expect(await state.render().resolveConnection()).toMatchObject({ reasoningEffort: 'xhigh', reasoningCapabilities: reasoning });
});

it('preserves unreadable key payloads during provider edits and discards them on explicit key replacement', () => {
  const state = harness('openai-compatible');
  const payload = { format: 'electron-safe-storage' as const, value: 'unreadable-key' };
  const connection = { ...state.connections[0], apiKey: '', apiKeyEncrypted: payload };
  state.setConnections([connection]);
  state.render().setEditingConnection(connection);
  state.render().editConnection('label', 'Renamed provider');
  expect(state.connections[0].apiKeyEncrypted).toEqual(payload);
  state.render().editConnection('apiKey', 'replacement-key');
  expect(state.connections[0].apiKeyEncrypted).toBeUndefined();
  state.render().editConnection('apiKey', '');
  expect(state.connections[0].apiKey).toBe('');
  expect(state.connections[0].apiKeyEncrypted).toBeUndefined();
});

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

  it('cancels on-demand model discovery through IPC without waiting for a model reply', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('window', { rpgraph: {
      [listMethod]: vi.fn((_connection, onAbort) => new Promise((_resolve, reject) => {
        onAbort(() => { cancel(); reject(new Error('The LLM request was cancelled.')); });
      })),
    } });
    const state = harness(kind, '');
    const controller = new AbortController();
    const pending = state.render().resolveConnection(undefined, undefined, controller.signal);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
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


describe('OpenAI-compatible providers', () => {
  it('updates capabilities and reasoning when selecting a different model', async () => {
    vi.stubGlobal('window', { rpgraph: { listCompatibleModels: vi.fn().mockResolvedValue([
      { id: 'text-model', capabilities: { vision: false, reasoning: false }, reasoning: { supportedEfforts: [] } },
      { id: 'vision-model', capabilities: { vision: true, reasoning: true }, reasoning: { supportedEfforts: ['low', 'high'], mandatory: true } },
      { id: 'unknown-model', capabilities: {} },
    ]) } });
    const state = harness('openai-compatible');
    state.render().setEditingConnection(state.connections[0]);
    await state.render().checkProviderConnectionById('provider');
    expect(state.render().editingConnectionCapabilities).toEqual({ vision: false, reasoning: false });
    state.render().editConnection('model', 'vision-model');
    expect(state.render().editingConnection).toMatchObject({ vision: true, reasoningEffort: 'auto' });
    expect(state.render().editingConnectionReasoning).toMatchObject({ supportedEfforts: ['low', 'high'] });
    state.render().editConnection('model', 'unknown-model');
    expect(state.render().modelCapabilitiesSourceLabel).toBeUndefined();
    expect(state.render().editingConnectionReasoning).toBeUndefined();
  });

  it('ignores old metadata after the endpoint changes', async () => {
    const pending = deferred<[{ id: string; capabilities: { vision: boolean } }]>();
    vi.stubGlobal('window', { rpgraph: { listCompatibleModels: vi.fn(() => pending.promise) } });
    const state = harness('openai-compatible');
    state.render().setEditingConnection(state.connections[0]);
    const check = state.render().checkProviderConnectionById('provider');
    state.render().editConnection('baseUrl', 'http://localhost:9999/v1');
    pending.resolve([{ id: 'text-model', capabilities: { vision: true } }]);
    await check;
    expect(state.render().editingConnectionCapabilities).toBeUndefined();
    expect(state.render().editingConnection.vision).toBe(false);
  });

  it('allows a configured model when optional discovery is unavailable', async () => {
    vi.stubGlobal('window', { rpgraph: { listCompatibleModels: vi.fn().mockRejectedValue(new Error('Not found')) } });
    expect(await harness('openai-compatible').render().resolveConnection()).toMatchObject({ model: 'text-model' });
  });

  it('uses the generic model API and selects a returned model', async () => {
    const listModels = vi.fn().mockResolvedValue([{ id: 'custom-model', capabilities: {} }]);
    vi.stubGlobal('window', { rpgraph: { listCompatibleModels: listModels } });
    const state = harness('openai-compatible', '');
    const resolved = await state.render().resolveConnection();
    expect(listModels).toHaveBeenCalledOnce();
    expect(resolved).toMatchObject({ providerKind: 'openai-compatible', model: 'custom-model' });
  });

  it('checks generic API health without provider-specific endpoints', async () => {
    const listModels = vi.fn().mockResolvedValue([{ id: 'text-model', capabilities: {} }]);
    vi.stubGlobal('window', { rpgraph: { listCompatibleModels: listModels } });
    const state = harness('openai-compatible');
    await state.render().checkProviderConnectionById('provider');
    expect(state.render().providerHealthById.provider).toMatchObject({ status: 'online' });
    expect(listModels).toHaveBeenCalledOnce();
  });

  it('does not automatically load models or free ComfyUI for a custom local API', async () => {
    const freeComfyMemory = vi.fn();
    vi.stubGlobal('window', { rpgraph: { freeComfyMemory } });
    const state = harness('openai-compatible');
    state.setConnections([...state.connections, {
      ...defaultConnection, id: 'comfy', kind: 'comfyui',
    }]);
    await state.render().prepareImageAssistantLlmProvider({ llmProviderId: 'provider', comfyProviderId: 'comfy' });
    expect(freeComfyMemory).not.toHaveBeenCalled();
  });
});

it('keeps editor changes when Gemini falls back to its bundled model list', async () => {
  const pending = deferred<typeof models>();
  vi.stubGlobal('window', { rpgraph: { listGeminiModels: () => pending.promise.then(() => { throw new Error('404 NOT_FOUND'); }) } });
  const state = harness('gemini', '');
  state.render().setEditingConnection(state.connections[0]);
  const check = state.render().checkConnectionModels();
  const edited = { ...state.connections[0], apiKey: 'new-key', model: 'chosen-model', label: 'Edited' };
  state.render().setEditingConnection(edited);
  pending.resolve(models);
  await check;
  expect(state.render().editingConnection).toEqual(edited);
});

it('keeps edits and selected presets when ComfyUI model lists arrive', async () => {
  const pending = deferred<string[]>();
  vi.stubGlobal('window', { rpgraph: {
    listComfyModels: () => pending.promise,
    listComfySamplersAndSchedulers: async () => ({ samplers: [], schedulers: [] }),
  } });
  const state = harness('openai-compatible');
  state.render().setEditingConnection({ ...state.connections[0], kind: 'comfyui', comfyRole: 'image' });
  const check = state.render().loadComfyModelLists();
  const edited = { ...state.connections[0], id: 'other', label: 'Other connection' };
  state.render().setEditingConnection(edited);
  pending.resolve(['model']);
  await check;
  expect(state.render().editingConnection).toEqual(edited);
});

it('preserves a voice chosen while OpenRouter model capabilities are loading', async () => {
  const pending = deferred<typeof models>();
  vi.stubGlobal('window', { rpgraph: { listOpenRouterModels: () => pending.promise } });
  const state = harness('openrouter');
  state.render().setEditingConnection(state.connections[0]);
  const check = state.render().checkConnectionModels();
  state.render().setEditingConnection({ ...state.connections[0], ttsVoice: 'chosen-voice' });
  pending.resolve(models.map((model) => ({ ...model, supportedVoices: ['default-voice'] })));
  await check;
  expect(state.render().editingConnection.ttsVoice).toBe('chosen-voice');
});
