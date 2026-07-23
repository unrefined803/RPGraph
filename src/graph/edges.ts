import {
  MarkerType,
  type Connection,
  type Edge,
} from '@xyflow/react';
import type { WorkflowNode } from '../types';
import { getRegisteredNode } from '../nodes/registry';
import { wireLinkMode, wireLinkName } from '../nodes/memory-slot/model';
import { promptAfterInputHandle, promptBeforeInputHandle } from '../nodes/shared/imageInputs';
import {
  combinerInputCount,
  combinerInputHandle,
  workflowCompleteColor,
  workflowPendingColor,
  workflowPreparedColor,
} from '../workflow';

export const workflowEdgeType = 'workflow';

function inputPortKey(target: string | null, targetHandle?: string | null) {
  return JSON.stringify([target, targetHandle ?? null]);
}

export function removeCompetingInputEdges(
  edges: Edge[],
  connection: Connection,
  retainedEdgeId?: string,
) {
  const newInputKey = inputPortKey(connection.target, connection.targetHandle);
  return edges.filter(
    (edge) =>
      edge.id === retainedEdgeId ||
      inputPortKey(edge.target, edge.targetHandle) !== newInputKey,
  );
}

export function keepLatestInputEdges(edges: Edge[]) {
  const occupiedInputs = new Set<string>();
  return [...edges].reverse().filter((edge) => {
    const key = inputPortKey(edge.target, edge.targetHandle);
    if (occupiedInputs.has(key)) {
      return false;
    }
    occupiedInputs.add(key);
    return true;
  }).reverse();
}

function workflowNodeStatusColor(node: WorkflowNode | undefined) {
  if (node?.data.runPrepared) {
    return workflowPreparedColor;
  }
  if (node?.data.runCompleted) {
    return workflowCompleteColor;
  }
  return workflowPendingColor;
}

export function withWorkflowConnectionColor(edge: Edge, color = workflowPendingColor): Edge {
  return {
    ...edge,
    animated: false,
    type: workflowEdgeType,
    markerEnd: { type: MarkerType.ArrowClosed, color },
    style: { ...edge.style, stroke: color, strokeWidth: 2 },
  };
}

export function withSourceNodeStatusConnectionColors(edges: Edge[], nodes: WorkflowNode[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) =>
    withWorkflowConnectionColor(edge, workflowNodeStatusColor(nodeById.get(edge.source))),
  );
}

function wireLinkKey(node: WorkflowNode) {
  if (node.data.kind !== undefined || node.data.nodeType !== 'memory-slot') {
    return null;
  }
  try {
    return wireLinkName(node.data).toLocaleLowerCase();
  } catch {
    return null;
  }
}

export function nodeDependsOnPendingUserInput(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: Edge[],
  visiting = new Set<string>(),
): boolean {
  if (visiting.has(nodeId)) {
    return false;
  }
  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return false;
  }
  if (node.data.kind === undefined && node.data.nodeType === 'input') {
    return true;
  }
  const nextVisiting = new Set(visiting).add(nodeId);
  const directInputBlocked = edges
    .filter((edge) => edge.target === nodeId)
    .some((edge) => nodeDependsOnPendingUserInput(edge.source, nodes, edges, nextVisiting));
  if (directInputBlocked) {
    return true;
  }
  const slotKey = wireLinkKey(node);
  if (!slotKey || wireLinkMode(node.data) === 'input') {
    return false;
  }
  return nodes
    .filter(
      (candidate) =>
        candidate.id !== node.id &&
        candidate.data.kind === undefined &&
        candidate.data.nodeType === 'memory-slot' &&
        wireLinkKey(candidate) === slotKey,
    )
    .some((candidate) =>
      edges.some((edge) => edge.target === candidate.id) &&
      nodeDependsOnPendingUserInput(candidate.id, nodes, edges, nextVisiting),
    );
}

export function nodesPreparedAfterOutput(nodes: WorkflowNode[], edges: Edge[]) {
  const dependsOnPendingUserInput = new Map<string, boolean>();
  const isBlockedByPendingUserInput = (nodeId: string, visiting = new Set<string>()): boolean => {
    const cached = dependsOnPendingUserInput.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    const blocked = nodeDependsOnPendingUserInput(nodeId, nodes, edges, visiting);
    dependsOnPendingUserInput.set(nodeId, blocked);
    return blocked;
  };

  return nodes.flatMap((node) => {
    const definition =
      node.data.kind === undefined ? getRegisteredNode(node.data.nodeType) : undefined;
    const passiveRuntimeNode = definition?.passiveRuntime ?? false;
    if (
      node.data.kind !== undefined ||
      node.data.nodeType === 'output' ||
      (!passiveRuntimeNode && isBlockedByPendingUserInput(node.id))
    ) {
      return [];
    }
    if (node.data.nodeType === 'combiner') {
      const isFullyConnected = Array.from(
        { length: combinerInputCount(node.data) },
        (_, index) =>
          edges.some(
            (edge) =>
              edge.target === node.id && edge.targetHandle === combinerInputHandle(index),
          ),
      ).every(Boolean);
      return isFullyConnected ? [node.id] : [];
    }
    if (definition?.requiresPreparedInputEdge) {
      // A prompt-override edge is not a Text Input; it must not, on its own,
      // pull the node into the prepare set (it would then hard-throw for a
      // missing Text Input and abort the whole preparation pass).
      return edges.some(
        (edge) =>
          edge.target === node.id &&
          edge.targetHandle !== promptBeforeInputHandle &&
          edge.targetHandle !== promptAfterInputHandle,
      )
        ? [node.id]
        : [];
    }
    return [node.id];
  });
}
