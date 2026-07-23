import { describe, it, expect } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { resolveTextAndImageInputs } from './imageInputs';

const node = { id: 'llm-1', data: { nodeType: 'llm-prompt', label: 'LLM Prompt' } } as WorkflowNode;

function createContext(edges: Edge[], executeInput: ExecuteContext['executeInput']) {
  return {
    edges,
    nodes: [],
    inputImages: [],
    executeInput,
  } as unknown as ExecuteContext;
}

describe('resolveTextAndImageInputs with prompt override handles', () => {
  it('selects the default Text Input even when override edges are present', async () => {
    const resolved: string[] = [];
    const context = createContext(
      [
        { id: 'e-before', source: 'b', target: 'llm-1', targetHandle: 'prompt-before' } as Edge,
        { id: 'e-text', source: 't', target: 'llm-1', targetHandle: null } as Edge,
        { id: 'e-after', source: 'a', target: 'llm-1', targetHandle: 'prompt-after' } as Edge,
      ],
      async (nodeId) => {
        resolved.push(nodeId);
        return nodeId === 't' ? 'TEXT INPUT' : 'OVERRIDE';
      },
    );

    const result = await resolveTextAndImageInputs(node, context);

    expect(result.inputValue).toBe('TEXT INPUT');
    // Only the Text Input edge is resolved as the main input; override edges are not.
    expect(resolved).toEqual(['t']);
  });

  it('throws when only override edges (no Text Input) exist', async () => {
    const context = createContext(
      [
        { id: 'e-before', source: 'b', target: 'llm-1', targetHandle: 'prompt-before' } as Edge,
        { id: 'e-after', source: 'a', target: 'llm-1', targetHandle: 'prompt-after' } as Edge,
      ],
      async () => 'OVERRIDE',
    );

    await expect(resolveTextAndImageInputs(node, context)).rejects.toThrow(/no incoming connection/);
  });
});
