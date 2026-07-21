import type { Edge } from '@xyflow/react';
import type { WorkflowNode } from '../types';
import { sanitizeDataUrlsInText } from '../utils/sanitize';
import { persistentNodeData } from '../workflow';

const excludedNodeDataKeys = new Set([
  'rawHistory',
  'originalHistory',
  'translatedHistory',
  'storybookJson',
  'storybookFileName',
  'storybookFilePath',
]);

const maxStringLength = 3000;
const maxArrayItems = 50;
const maxDepth = 5;

function limitText(text: string) {
  if (text.length <= maxStringLength) {
    return text;
  }
  return `${text.slice(0, maxStringLength)}\n\n[Truncated ${text.length - maxStringLength} characters.]`;
}

function sanitizedSnapshotValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return limitText(sanitizeDataUrlsInText(value));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (depth > maxDepth) {
    return '[Nested value omitted]';
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, maxArrayItems)
      .map((item) => sanitizedSnapshotValue(item, depth + 1));
    if (value.length > maxArrayItems) {
      items.push(`[${value.length - maxArrayItems} more items omitted]`);
    }
    return items;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !excludedNodeDataKeys.has(key))
      .map(([key, entryValue]) => [key, sanitizedSnapshotValue(entryValue, depth + 1)]),
  );
}

export function createWorkflowAssistantSnapshotJson(nodes: WorkflowNode[], edges: Edge[]) {
  const snapshot = {
    nodes: nodes.map((node) => {
      const persistentData = persistentNodeData(node.data);
      return {
        id: node.id,
        label: persistentData.label,
        type: persistentData.nodeType,
        data: sanitizedSnapshotValue(persistentData),
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? 'default',
      target: edge.target,
      targetHandle: edge.targetHandle ?? 'default',
    })),
  };
  return JSON.stringify(snapshot, null, 2);
}
