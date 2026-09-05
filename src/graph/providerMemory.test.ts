import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeGraph } from './executeGraph';
import { NodeLlmApi } from '../llm/NodeLlmApi';
import { TextMetricsApi } from '../llm/tokenMetrics';
import { defaultConnection } from '../settings';
import { getRegisteredNode } from '../nodes/registry';
import { runScratchKeys, type CreateComfyImageForCharacterRunner } from '../nodes/runScratch';
import type { ConnectionPreset, WorkflowNode } from '../types';

vi.mock('../storybook/runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('../storybook/runtime')>(),
  storybookCreateImageCharactersFromNodes: () => [{
    name: 'Alice', createImage: { hasLora: false },
  }],
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const comfy: ConnectionPreset = {
  ...defaultConnection, id: 'comfy', kind: 'comfyui', comfyRole: 'image',
  baseUrl: 'http://localhost:8188', comfyCheckpointName: 'checkpoint',
  comfyVaeName: 'vae', comfyTextEncoderName: 'encoder',
};

async function generate(connection: ConnectionPreset, options: {
  explicit?: boolean; manageModelMemory?: boolean; unloadError?: boolean;
} = {}) {
  const events: string[] = [];
  const unload = vi.fn(async () => {
    events.push('unload LLM');
    if (options.unloadError) throw new Error('Unload failed');
  });
  const generate = vi.fn(async () => { events.push('generate'); throw new Error('Generation failed'); });
  const free = vi.fn(async () => { events.push('free ComfyUI'); });
  vi.stubGlobal('window', { rpgraph: {
    unloadLmStudioModels: unload, unloadOllamaModels: unload, unloadLlamaCppModels: unload,
    runComfyWorkflowPath: generate, freeComfyMemory: free,
  } });
  const resolveConnection = vi.fn(async () => connection);
  const warn = vi.fn();
  vi.spyOn(getRegisteredNode('llm-prompt')!, 'execute').mockImplementation(async (_node, context) => {
    const runner = context.runScratch.get(runScratchKeys.createComfyImageForCharacter) as CreateComfyImageForCharacterRunner;
    await runner({ phoneOwnerName: 'Alice', prompt: 'Portrait', manageModelMemory: options.manageModelMemory }, warn);
    return '';
  });
  const node = {
    id: 'llm', type: 'workflow', position: { x: 0, y: 0 },
    data: { nodeType: 'llm-prompt', label: 'LLM', connectionId: options.explicit ? connection.id : undefined },
  } as WorkflowNode;
  await expect(executeGraph({
    outputNodeId: node.id, nodes: [node], edges: [], originalInput: '', originalHistory: '', translatedHistory: '',
    llm: new NodeLlmApi({ resolveConnection }), textMetrics: new TextMetricsApi(),
    updateRuntimeNode: vi.fn(), connections: [connection, comfy],
  })).rejects.toThrow('Generation failed');
  return { events, unload, free, resolveConnection, warn };
}

describe.each(['lm-studio', 'ollama', 'llama-cpp'] as const)('%s ComfyUI memory management', (providerKind) => {
  it('unloads the resolved local default before generation and frees ComfyUI after failure', async () => {
    const connection = { ...defaultConnection, providerKind };
    const result = await generate(connection);
    expect(result.resolveConnection).toHaveBeenCalledWith(undefined, 'ComfyUI memory management', undefined);
    expect(result.unload).toHaveBeenCalledWith(connection);
    expect(result.events).toEqual(['unload LLM', 'generate', 'free ComfyUI']);
  });

  it('continues to manage explicitly selected local providers', async () => {
    const result = await generate({ ...defaultConnection, providerKind }, { explicit: true });
    expect(result.events).toEqual(['unload LLM', 'generate', 'free ComfyUI']);
    expect(result.resolveConnection).not.toHaveBeenCalled();
  });

  it('leaves remote provider models and ComfyUI loaded', async () => {
    const result = await generate({ ...defaultConnection, providerKind, baseUrl: 'https://remote.example/v1' });
    expect(result.events).toEqual(['generate']);
  });
});

it('respects disabled automatic memory management', async () => {
  const result = await generate(defaultConnection, { manageModelMemory: false });
  expect(result.events).toEqual(['generate']);
  expect(result.resolveConnection).not.toHaveBeenCalled();
});

it('reports an unload failure and still attempts generation and cleanup', async () => {
  const result = await generate(defaultConnection, { unloadError: true });
  expect(result.warn).toHaveBeenCalledWith(expect.stringContaining('Unload failed'));
  expect(result.events).toEqual(['unload LLM', 'generate', 'free ComfyUI']);
});
