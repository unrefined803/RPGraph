import { describe, it, expect } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { executeLlmPromptNode } from './execute';
import { executeLlmPromptSwitchNode } from '../llm-prompt-switch/execute';

function edge(id: string, source: string, targetHandle: string | null): Edge {
  return { id, source, target: 'llm-1', sourceHandle: null, targetHandle } as Edge;
}

function createContext(options: {
  edges: Edge[];
  executeInput?: ExecuteContext['executeInput'];
}) {
  const prompts: string[] = [];
  const context = {
    nodes: [],
    edges: options.edges,
    historyMessages: [],
    runScratch: new Map(),
    referenceImages: { enabled: false, maxImages: 0, turnLookback: 0 },
    comfyProviderIds: [],
    providerHealthById: {},
    settingsValueDefinitions: [],
    settingsValues: {},
    textMetrics: { bytesPerToken: 4 },
    retryFormatErrorsEnabled: false,
    executeInput: options.executeInput ?? (async () => ''),
    updateRuntimeData: () => {},
    reportWarning: () => {},
    reportFormatResult: () => {},
    llm: {
      supportsVision: async () => false,
      complete: async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        return { text: 'generated reply', connection: { label: 'Test LLM' } };
      },
    },
  } as unknown as ExecuteContext;
  return { context, prompts };
}

function promptNode(data: Partial<WorkflowNode['data']>): WorkflowNode {
  return {
    id: 'llm-1',
    type: 'workflow',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'llm-prompt',
      label: 'LLM Prompt',
      connectionId: 'conn-1',
      llmPromptBefore: '',
      llmPromptAfter: '',
      ...data,
    },
  } as WorkflowNode;
}

function runArgs(node: WorkflowNode, context: ExecuteContext, inputValue: string) {
  return { node, inputValue, images: [], referenceImages: [], context, streamsVisibleOutput: false };
}

describe('LLM Prompt text overrides', () => {
  it('uses the prompt-before override string and bypasses the authored text', async () => {
    const node = promptNode({ llmPromptBefore: 'AUTHORED BEFORE', llmPromptAfter: 'AUTHORED AFTER' });
    const { context, prompts } = createContext({
      edges: [edge('e1', 'src', 'prompt-before')],
      executeInput: async (nodeId) => (nodeId === 'src' ? 'OVERRIDE BEFORE' : ''),
    });

    await executeLlmPromptNode(runArgs(node, context, 'the input'));

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('OVERRIDE BEFORE');
    expect(prompts[0]).not.toContain('AUTHORED BEFORE');
    // The un-overridden "after" segment keeps using the authored text.
    expect(prompts[0]).toContain('AUTHORED AFTER');
  });

  it('uses the prompt-after override string and bypasses the authored text', async () => {
    const node = promptNode({ llmPromptBefore: 'AUTHORED BEFORE', llmPromptAfter: 'AUTHORED AFTER' });
    const { context, prompts } = createContext({
      edges: [edge('e1', 'src', 'prompt-after')],
      executeInput: async (nodeId) => (nodeId === 'src' ? 'OVERRIDE AFTER' : ''),
    });

    await executeLlmPromptNode(runArgs(node, context, 'the input'));

    expect(prompts[0]).toContain('OVERRIDE AFTER');
    expect(prompts[0]).not.toContain('AUTHORED AFTER');
    expect(prompts[0]).toContain('AUTHORED BEFORE');
  });

  it('uses the authored prompt text when no override edge is attached', async () => {
    const node = promptNode({ llmPromptBefore: 'AUTHORED BEFORE', llmPromptAfter: 'AUTHORED AFTER' });
    const { context, prompts } = createContext({ edges: [] });

    await executeLlmPromptNode(runArgs(node, context, 'the input'));

    expect(prompts[0]).toContain('AUTHORED BEFORE');
    expect(prompts[0]).toContain('AUTHORED AFTER');
  });

  it('treats an attached-but-empty override as an empty (bypassed) segment', async () => {
    const node = promptNode({ llmPromptBefore: 'AUTHORED BEFORE', llmPromptAfter: '' });
    const { context, prompts } = createContext({
      edges: [edge('e1', 'src', 'prompt-before')],
      executeInput: async () => '',
    });

    await executeLlmPromptNode(runArgs(node, context, 'the input'));

    expect(prompts[0]).not.toContain('AUTHORED BEFORE');
    expect(prompts[0]).toBe('the input');
  });

  it('does not clear the authored field data on an overridden run', async () => {
    const node = promptNode({ llmPromptBefore: 'AUTHORED BEFORE', llmPromptAfter: 'AUTHORED AFTER' });
    const { context } = createContext({
      edges: [edge('e1', 'a', 'prompt-before'), edge('e2', 'b', 'prompt-after')],
      executeInput: async (nodeId) => (nodeId === 'a' ? 'OVERRIDE BEFORE' : 'OVERRIDE AFTER'),
    });

    await executeLlmPromptNode(runArgs(node, context, 'the input'));

    expect(node.data.llmPromptBefore).toBe('AUTHORED BEFORE');
    expect(node.data.llmPromptAfter).toBe('AUTHORED AFTER');
  });
});


describe('prompt diagnostics on failed runs', () => {
  it('replaces previous output and records the current failed provider request', async () => {
    const node = promptNode({
      generatedText: 'OLD OUTPUT',
      llmPromptDebug: { inputValue: 'OLD INPUT', promptBefore: '', promptAfter: '', combinedPrompt: '', generatedText: 'OLD OUTPUT' },
      llmPromptBefore: 'Current instructions',
    });
    const { context } = createContext({ edges: [] });
    context.updateRuntimeData = (_id, patch) => { Object.assign(node.data, patch); };
    context.llm.complete = async () => { throw new Error('Provider timeout'); };

    await expect(executeLlmPromptNode(runArgs(node, context, 'CURRENT INPUT'))).rejects.toThrow('Provider timeout');
    expect(node.data.generatedText).toBe('');
    expect(node.data.llmPromptDebug?.inputValue).toBe('CURRENT INPUT');
    expect(node.data.llmPromptDebug?.promptPasses?.slice(-1)[0]?.sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'CURRENT INPUT' })]),
    );
    expect(JSON.stringify(node.data.llmPromptDebug)).not.toContain('OLD');
  });

  it('retains completed intermediate output and the failed later prompt', async () => {
    const node = promptNode({ llmPromptAfter: '@step:planning\nMake a plan.\n@step:main\nUse this plan: @output:planning' });
    const { context } = createContext({ edges: [] });
    context.updateRuntimeData = (_id, patch) => { Object.assign(node.data, patch); };
    let calls = 0;
    context.llm.complete = async () => {
      if (++calls > 1) throw new Error('Later pass failed');
      return { text: 'CURRENT PLAN', connection: { label: 'Test LLM' } } as Awaited<ReturnType<ExecuteContext['llm']['complete']>>;
    };
    await expect(executeLlmPromptNode(runArgs(node, context, 'CURRENT INPUT'))).rejects.toThrow('Later pass failed');
    expect(node.data.llmPromptDebug?.promptPasses).toHaveLength(2);
    expect(node.data.llmPromptDebug?.outputPasses).toEqual([{ label: 'Step planning output', text: 'CURRENT PLAN' }]);
    expect(JSON.stringify(node.data.llmPromptDebug?.promptPasses?.slice(-1)[0])).toContain('CURRENT PLAN');
  });

  it('clears stale debug when resolving a prompt override fails before the provider call', async () => {
    const node = promptNode({ llmPromptDebug: { inputValue: 'OLD', promptBefore: '', promptAfter: '', combinedPrompt: '', generatedText: '' } });
    const { context } = createContext({
      edges: [edge('override', 'upstream', 'prompt-before')],
      executeInput: async () => { throw new Error('Upstream failure'); },
    });
    context.updateRuntimeData = (_id, patch) => { Object.assign(node.data, patch); };
    await expect(executeLlmPromptNode(runArgs(node, context, 'input'))).rejects.toThrow('Upstream failure');
    expect(node.data.llmPromptDebug).toBeUndefined();
  });

  it('preserves current switch routing and prompt passes when the provider fails', async () => {
    const node = promptNode({ nodeType: 'llm-prompt-switch', generatedText: 'OLD OUTPUT' });
    const { context } = createContext({
      edges: [edge('text', 'text-source', 'text'), edge('channel', 'channel-source', 'output-channel'), edge('slot', 'slot-source', 'prompt-slot')],
      executeInput: async (source) => source === 'text-source' ? 'CURRENT SWITCH INPUT' : '0',
    });
    context.nodes = [node];
    context.updateRuntimeData = (_id, patch) => { Object.assign(node.data, patch); };
    context.llm.complete = async () => { throw new Error('Switch timeout'); };
    await expect(executeLlmPromptSwitchNode(node, context)).rejects.toThrow('Switch timeout');
    expect(node.data.generatedText).toBe('');
    expect(node.data.llmPromptSwitchDebug).toMatchObject({
      inputValue: 'CURRENT SWITCH INPUT', selectedOutputChannel: 0, selectedPromptSlot: 0,
      promptPasses: expect.arrayContaining([expect.objectContaining({ sections: expect.any(Array) })]),
    });
  });
});
