import { describe, it, expect } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { executeLlmPromptNode } from './execute';

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
