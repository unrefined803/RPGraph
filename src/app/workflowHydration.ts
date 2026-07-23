import type { Edge } from '@xyflow/react';
import {
  keepLatestInputEdges,
  withWorkflowConnectionColor,
} from '../graph/edges';
import { normalizeEventAppointments } from '../data-management/eventStore';
import { flattenTurnMessages } from '../chat/turns';
import { getRegisteredNode } from '../nodes/registry';
import {
  openingHistoryEventsFromNodes,
  openingHistoryCheckpointsFromNodes,
  openingHistoryTurnsFromNodes,
} from '../storybook/openingHistoryRuntime';
import { isStorybookSourceNode } from '../storybook/runtime';
import type { TurnCheckpoint } from '../data-management/types';
import type { MessageRecord, TurnRecord, WorkflowFile, WorkflowNode, WorkflowNodeData } from '../types';
import { hydrateNodeData, removeEdgesConnectedToIncompatibleNodes } from '../workflow/persistence';
import { isWorkflowFile } from '../workflow/validation';
import { migrateStoredWorkflow } from '../workflow/migrations';

function hydratedNodeStyle(node: WorkflowNode, data: WorkflowNodeData) {
  // Only compatible nodes reach here (placeholder nodes are handled inline below).
  const hydratedNode = { ...node, data };
  return getRegisteredNode(data.nodeType)?.hydrateStyle?.(hydratedNode) ?? node.style;
}

export type HydratedWorkflow = {
  workflow: WorkflowFile;
  nodes: WorkflowNode[];
  edges: Edge[];
  openingTurns: TurnRecord[];
  openingMessages: MessageRecord[];
  openingCheckpoints: TurnCheckpoint[];
};

export function hydrateLoadedWorkflow({
  workflow,
  defaultConnectionId,
  connectionIds,
  hydrateOpeningHistory = true,
}: {
  workflow: unknown;
  defaultConnectionId: string;
  connectionIds: Set<string>;
  hydrateOpeningHistory?: boolean;
}): HydratedWorkflow {
  const migratedWorkflow = migrateStoredWorkflow(workflow);
  if (!isWorkflowFile(migratedWorkflow)) {
    throw new Error('Not a valid RPGraph workflow file.');
  }

  const hydrateContext = {
    defaultConnectionId,
    connectionIds,
  };
  let loadedNodes: WorkflowNode[] = migratedWorkflow.nodes.map((node): WorkflowNode => {
    const data = hydrateNodeData(node.data, hydrateContext);
    if (data.kind !== undefined) {
      // Placeholder nodes (incompatible core / missing plugin) render a small card.
      // Drop the saved dimensions so React Flow re-measures to the card instead of
      // leaving a large, empty-but-draggable wrapper at the old saved size.
      const { width: _width, height: _height, ...restStyle } = node.style ?? {};
      return {
        ...node,
        width: undefined,
        height: undefined,
        measured: undefined,
        style: restStyle,
        selected: false,
        data,
      };
    }
    return {
      ...node,
      style: hydratedNodeStyle(node, data),
      selected: false,
      data,
    };
  });
  // Storybook sources are mutually exclusive (v1 XOR editor). Reject a file with
  // more than one before any live state is committed (validate-then-commit).
  if (loadedNodes.filter(isStorybookSourceNode).length > 1) {
    throw new Error(
      'This workflow has more than one storybook source. A graph may contain only one RP Storybook or RP Storybook Editor node.',
    );
  }

  const loadedEdges = keepLatestInputEdges(
    removeEdgesConnectedToIncompatibleNodes(loadedNodes, migratedWorkflow.edges)
      .map((edge) => withWorkflowConnectionColor({ ...edge, selected: false })),
  );

  let openingTurns: TurnRecord[] = [];
  let openingMessages: MessageRecord[] = [];
  let openingCheckpoints: TurnCheckpoint[] = [];
  if (hydrateOpeningHistory) {
    const openingEvents = openingHistoryEventsFromNodes(loadedNodes);
    if (openingEvents.length > 0) {
      loadedNodes = loadedNodes.map((node) =>
        node.data.kind === undefined && node.data.nodeType === 'event-manager'
          ? {
              ...node,
              data: {
                ...node.data,
                eventAppointments: normalizeEventAppointments(openingEvents),
                eventStatus: `Loaded ${openingEvents.length} opening history events`,
              } as WorkflowNodeData,
            }
          : node,
      );
    }
    openingTurns = openingHistoryTurnsFromNodes(loadedNodes);
    openingMessages = flattenTurnMessages(openingTurns);
    openingCheckpoints = openingHistoryCheckpointsFromNodes(loadedNodes);
  }

  return {
    workflow: migratedWorkflow,
    nodes: loadedNodes,
    edges: loadedEdges,
    openingTurns,
    openingMessages,
    openingCheckpoints,
  };
}
