import { describe, it, expect } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../types';
import { nodesPreparedAfterOutput } from './edges';

const llmPromptNode = {
  id: 'llm-1',
  type: 'workflow',
  position: { x: 0, y: 0 },
  data: { nodeType: 'llm-prompt', label: 'LLM Prompt' },
} as WorkflowNode;

describe('nodesPreparedAfterOutput with prompt override handles', () => {
  it('does not prepare an llm-prompt whose only incoming edges are overrides', () => {
    const edges: Edge[] = [
      { id: 'e-before', source: 'b', target: 'llm-1', targetHandle: 'prompt-before' } as Edge,
      { id: 'e-after', source: 'a', target: 'llm-1', targetHandle: 'prompt-after' } as Edge,
    ];

    expect(nodesPreparedAfterOutput([llmPromptNode], edges)).toEqual([]);
  });

  it('prepares an llm-prompt that has a Text Input edge alongside overrides', () => {
    const edges: Edge[] = [
      { id: 'e-before', source: 'b', target: 'llm-1', targetHandle: 'prompt-before' } as Edge,
      { id: 'e-text', source: 't', target: 'llm-1', targetHandle: null } as Edge,
    ];

    expect(nodesPreparedAfterOutput([llmPromptNode], edges)).toEqual(['llm-1']);
  });
});
