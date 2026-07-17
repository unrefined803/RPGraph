import { describe, it, expect } from 'vitest';
import { hydrateLoadedWorkflow } from './workflowHydration';
import { currentWorkflowFormatVersion } from '../workflow/version';
import { currentCoreNodeVersions } from '../nodes/nodeVersion';

function workflowWith(nodes: unknown[]) {
  return {
    format: 'rpgraph-workflow',
    formatVersion: currentWorkflowFormatVersion,
    savedAt: '2026-01-01T00:00:00.000Z',
    nodes,
    edges: [],
  };
}

describe('hydrateLoadedWorkflow node sizing', () => {
  it('strips stale dimensions from an incompatible core node so it re-measures to its card', () => {
    const workflow = workflowWith([
      {
        id: 'old-llm',
        type: 'workflow',
        position: { x: 5, y: 5 },
        style: { width: 548, height: 1140 },
        width: 548,
        height: 1140,
        measured: { width: 548, height: 1140 },
        data: {
          nodeType: 'llm-prompt',
          nodeDataVersion: '0.0.1',
          label: 'Old LLM',
          description: 'outdated',
          preview: 'stored',
          llmPromptBefore: 'keep me',
        },
      },
    ]);

    const { nodes } = hydrateLoadedWorkflow({
      workflow,
      defaultConnectionId: 'default',
      connectionIds: new Set(['default']),
    });

    const node = nodes[0];
    expect(node.data.kind).toBe('incompatible-core-node');
    expect(node.width).toBeUndefined();
    expect(node.height).toBeUndefined();
    expect(node.measured).toBeUndefined();
    const style = (node.style ?? {}) as Record<string, unknown>;
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
  });

  it('leaves a compatible node in the same file untouched', () => {
    const workflow = workflowWith([
      {
        id: 'old-llm',
        type: 'workflow',
        position: { x: 5, y: 5 },
        width: 548,
        height: 1140,
        data: {
          nodeType: 'llm-prompt',
          nodeDataVersion: '0.0.1',
          label: 'Old LLM',
          description: 'outdated',
          preview: 'stored',
        },
      },
      {
        id: 'live-writer',
        type: 'workflow',
        position: { x: 400, y: 5 },
        width: 300,
        height: 200,
        style: { width: 300, height: 200 },
        data: {
          nodeType: 'write-text',
          nodeDataVersion: currentCoreNodeVersions['write-text'],
          label: 'Writer',
          description: 'current',
          preview: 'Text ready',
          writeTextValue: 'keep me',
        },
      },
    ]);

    const { nodes } = hydrateLoadedWorkflow({
      workflow,
      defaultConnectionId: 'default',
      connectionIds: new Set(['default']),
    });

    const writer = nodes.find((node) => node.id === 'live-writer')!;
    expect(writer.data.kind).toBeUndefined();
    expect(writer.width).toBe(300);
    expect(writer.height).toBe(200);
    expect(writer.style).toEqual({ width: 300, height: 200 });
  });
});
