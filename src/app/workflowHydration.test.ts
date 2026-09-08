import { workflowSnapshotFromGraph } from './workflowSnapshot';
import { describe, it, expect } from 'vitest';
import { hydrateLoadedWorkflow } from './workflowHydration';
import { currentWorkflowFormatVersion } from '../workflow/version';
import { currentCoreNodeVersions } from '../nodes/nodeVersion';
import { emptyRpStorybook, normalizeRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';

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

it.each(['2.1.0', '3.0.0'])('loads a Storybook node at %s without converting its embedded document', (version) => {
  const storybookJson = JSON.stringify({ format: 'rpgraph-storybook', version: '2.2.0', title: 'Old book', characters: [] });
  const { nodes } = hydrateLoadedWorkflow({
    workflow: workflowWith([{ id: 'book', type: 'workflow', position: { x: 0, y: 0 },
      data: { nodeType: 'rp-storybook', nodeDataVersion: version, label: 'Storybook', description: '', preview: '', storybookJson } }]),
    defaultConnectionId: 'default', connectionIds: new Set(['default']),
  });
  if (version === '2.1.0') {
    expect(nodes[0].data.kind).toBe('incompatible-core-node');
    expect(nodes[0].data.storedData?.storybookJson).toBe(storybookJson);
  } else {
    expect(nodes[0].data.kind).toBeUndefined();
    expect(nodes[0].data.storybookJson).toBe(storybookJson);
  }
});

it('rejects a loaded Storybook containing duplicate character names', () => {
  const storybook = normalizeRpStorybook({ ...emptyRpStorybook, characters: [
    { id: 'one', name: 'Same Name', images: [] },
    { id: 'two', name: ' same   name ', images: [] },
  ] });
  const workflow = workflowWith([{ id: 'book', type: 'workflow', position: { x: 0, y: 0 },
    data: { nodeType: 'rp-storybook', nodeDataVersion: '3.0.0', label: 'Storybook', description: '', preview: '',
      storybookJson: rpStorybookJsonText(storybook) } }]);
  expect(() => hydrateLoadedWorkflow({ workflow, defaultConnectionId: 'default', connectionIds: new Set(['default']) }))
    .toThrow('Character names must be unique');
});


it('preserves connections through loading and saving incompatible nodes', () => {
  const data = { nodeType: 'load-text', nodeDataVersion: '0.0.1', label: 'Old', description: '', preview: '' };
  const workflow = { ...workflowWith([
    { id: 'source', type: 'workflow', position: { x: 0, y: 0 }, data },
    { id: 'target', type: 'workflow', position: { x: 200, y: 0 }, data: { ...data, nodeType: 'text-preview' } },
  ]), edges: [{ id: 'wire', source: 'source', target: 'target', sourceHandle: 'default', targetHandle: 'default' }] };
  const loaded = hydrateLoadedWorkflow({ workflow, defaultConnectionId: 'default', connectionIds: new Set(['default']) });
  expect(loaded.edges).toHaveLength(1);
  const saved = workflowSnapshotFromGraph({ nodes: loaded.nodes, edges: loaded.edges });
  const reloaded = hydrateLoadedWorkflow({ workflow: saved, defaultConnectionId: 'default', connectionIds: new Set(['default']) });
  expect(reloaded.edges[0]).toMatchObject(workflow.edges[0]);
});
