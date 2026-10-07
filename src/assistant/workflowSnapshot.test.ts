import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../types';
import { createWorkflowAssistantSnapshotJson, workflowAssistantNodeOverview } from './workflowSnapshot';

describe('workflow assistant overview', () => {
  it('defers authored text and structured settings without losing their field names', () => {
    expect(workflowAssistantNodeOverview({
      label: 'Prompt', nodeType: 'llm-prompt', preview: 'runtime output',
      prompt: 'Short but important', temperature: 0.5, enabled: false,
      selectedConnectionId: 'local', steps: [{ prompt: 'Nested prompt' }],
      rawHistory: 'private history', storybookJson: 'large media',
      longValue: 'x'.repeat(121),
    })).toEqual({
      settings: { temperature: 0.5, enabled: false, selectedConnectionId: 'local' },
      deferredFields: ['prompt', 'steps', 'longValue'],
    });
  });

  it.each(['default_normal_v42.json', 'default_planning_v42.json'])(
    'keeps every node and connection while reducing %s configuration size',
    (fileName) => {
      const workflow = JSON.parse(readFileSync(`resources/default-content/${fileName}`, 'utf8')) as { nodes: WorkflowNode[]; edges: Edge[] };
      const json = createWorkflowAssistantSnapshotJson(workflow.nodes, workflow.edges);
      const snapshot = JSON.parse(json);
      expect(snapshot.nodes.map((node: { id: string }) => node.id)).toEqual(workflow.nodes.map((node) => node.id));
      expect(snapshot.edges).toEqual(workflow.edges.map((edge) => ({
        source: edge.source, sourceHandle: edge.sourceHandle ?? 'default',
        target: edge.target, targetHandle: edge.targetHandle ?? 'default',
      })));
      expect(json.length).toBeLessThan(JSON.stringify(workflow.nodes.map((node) => node.data)).length * 0.5);
      expect(snapshot.nodes.some((node: { deferredFields?: string[] }) => node.deferredFields?.length)).toBe(true);
      const storybookNode = snapshot.nodes.find((node: { type: string }) => node.type === 'rp-storybook');
      expect(storybookNode.contentContext.request).toEqual({ load: 'nodeData', id: storybookNode.id, field: 'storybookContent' });
    },
  );
});
