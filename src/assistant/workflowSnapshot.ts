import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../types';
import { sanitizeDataUrlsInText } from '../utils/sanitize';
import { persistentNodeData } from '../workflow';
import { storybookContentRequest } from './storybookContext';

const excludedNodeDataKeys = new Set([
  'rawHistory',
  'originalHistory',
  'translatedHistory',
  'storybookJson',
  'storybookFileName',
  'storybookFilePath',
]);

// Keep authored text and structured configuration available on demand, rather
// than repeating them in every workflow question.
export function workflowAssistantNodeOverview(data: Record<string, unknown>) {
  const settings: Record<string, unknown> = {};
  const deferredFields: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (excludedNodeDataKeys.has(key) || ['label', 'nodeType', 'description', 'preview', 'nodeDataVersion'].includes(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'boolean' || typeof value === 'number') {
      settings[key] = value;
    } else if (typeof value === 'string' && value.length <= 120 && !/prompt|text|code|json|template/i.test(key)) {
      settings[key] = sanitizeDataUrlsInText(value);
    } else {
      deferredFields.push(key);
    }
  }
  return {
    ...(Object.keys(settings).length ? { settings } : {}),
    ...(deferredFields.length ? { deferredFields } : {}),
  };
}

export function createWorkflowAssistantSnapshotJson(nodes: WorkflowNode[], edges: Edge[]) {
  const snapshot = {
    nodes: nodes.map((node) => {
      const persistentData = persistentNodeData(node.data);
      return {
        id: node.id,
        label: persistentData.label,
        type: persistentData.nodeType,
        ...(persistentData.nodeType === 'rp-storybook' ? {
          contentContext: {
            description: 'Read the loaded Storybook: title, introduction, scenario, characters, and opening summary, without media. storybookFormattedTextSettings contains export switches only, not story content.',
            request: storybookContentRequest(node.id),
          },
        } : {}),
        ...workflowAssistantNodeOverview(persistentData as Record<string, unknown>),
      };
    }),
    edges: edges.map((edge) => ({
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? 'default',
      target: edge.target,
      targetHandle: edge.targetHandle ?? 'default',
    })),
  };
  return JSON.stringify(snapshot);
}
