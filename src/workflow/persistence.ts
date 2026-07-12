import type { Edge } from '@xyflow/react';
import { getRegisteredCoreNode } from '../nodes/registry';
import { isMissingPluginTypeId } from '../nodes/extensions/typeIdPolicy';
import { areNodeVersionsCompatible, isNodeVersion } from '../nodes/nodeVersion';
import type { HydrateContext } from '../nodes/types';
import type { WorkflowNode, WorkflowNodeData } from '../types';

export function persistentNodeData(data: WorkflowNodeData): WorkflowNodeData {
  if (data.kind === 'incompatible-core-node') {
    return structuredClone(data.storedData) as WorkflowNodeData;
  }
  if (data.kind === 'missing-plugin-node' && data.storedData) {
    return structuredClone(data.storedData) as WorkflowNodeData;
  }
  if (isMissingPluginTypeId(data.nodeType) && data.portsSnapshot) {
    return structuredClone(data);
  }
  const definition = getRegisteredCoreNode(data.nodeType);
  if (!definition) {
    throw new Error(`Cannot save unknown node type: ${data.nodeType}`);
  }
  return definition.saveData(data);
}

export function hydrateNodeData(
  data: WorkflowNodeData | Record<string, unknown>,
  context: HydrateContext,
): WorkflowNodeData {
  if (
    typeof data.nodeType !== 'string' ||
    !isNodeVersion(data.nodeDataVersion) ||
    typeof data.label !== 'string' ||
    typeof data.description !== 'string' ||
    typeof data.preview !== 'string'
  ) {
    throw new Error('Cannot load invalid node data.');
  }
  if (isMissingPluginTypeId(data.nodeType) && Array.isArray(data.portsSnapshot)) {
    return {
      nodeType: data.nodeType,
      nodeDataVersion: data.nodeDataVersion,
      label: data.label,
      description: data.description,
      preview: data.preview,
      kind: 'missing-plugin-node',
      storedData: structuredClone(data as Record<string, unknown>),
      portsSnapshot: data.portsSnapshot as NonNullable<WorkflowNodeData['portsSnapshot']>,
    };
  }
  const definition = getRegisteredCoreNode(data.nodeType);
  if (!definition) {
    throw new Error(`Cannot load unknown node type: ${data.nodeType}`);
  }
  if (!areNodeVersionsCompatible(data.nodeDataVersion, definition.dataVersion)) {
    return {
      nodeType: data.nodeType,
      nodeDataVersion: data.nodeDataVersion,
      currentNodeVersion: definition.dataVersion,
      label: data.label,
      description: data.description,
      preview: data.preview,
      kind: 'incompatible-core-node',
      storedData: structuredClone(data as Record<string, unknown>),
    } as WorkflowNodeData;
  }
  return definition.hydrateData(data as WorkflowNodeData, context);
}

export function removeEdgesConnectedToIncompatibleNodes(nodes: WorkflowNode[], edges: Edge[]) {
  const incompatibleNodeIds = new Set(
    nodes
      .filter((node) => node.data.kind === 'incompatible-core-node')
      .map((node) => node.id),
  );
  return edges.filter(
    (edge) =>
      !incompatibleNodeIds.has(edge.source) &&
      !incompatibleNodeIds.has(edge.target),
  );
}
