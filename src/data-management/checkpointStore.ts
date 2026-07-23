import type { TurnRecord, RpAppointment, WorkflowNode } from '../types';
import { DATA_MANAGEMENT_BUDGETS } from './budgets';
import {
  appointmentEntitiesFromAppointments,
  appointmentsFromEventEntities,
} from './eventStore';
import { turnTimelineEntryIds } from './timelineStore';
import type { NodeDataPolicyByType, TurnCheckpoint } from './types';

export const coreNodeDataPolicies: NodeDataPolicyByType = {
  history: {
    persisted: ['historyTimeTrackingEnabled', 'historyLastTurnsCount', 'historyRpTimePrompt'],
    runtime: ['preview', 'fullText', 'historyCurrentRpDateTime', 'historyTimeStatus'],
    checkpoint: ['historyCurrentRpDateTime', 'historyProcessedTurnIds'],
    debug: ['historyLastPrompt', 'historyLastResponse'],
  },
  'event-manager': {
    persisted: ['eventManagerPrompt'],
    runtime: ['preview', 'fullText', 'eventStatus'],
    checkpoint: ['eventProcessedTurnIds'],
    debug: ['eventLastPrompt', 'eventLastResponse'],
  },
  'character-stats': {
    persisted: ['characterStatDefinitions', 'characterStatsPrimaryId', 'characterStatsMaxChange'],
    runtime: ['preview', 'characterStatsStatus'],
    checkpoint: [
      'characterStatsState',
      'characterStatsBaselineState',
      'characterStatsLastChanges',
      'characterStatsLastRpDateTime',
    ],
    debug: ['characterStatsLastPrompt', 'characterStatsLastResponse', 'characterStatsContextText'],
  },
  'memory-slot': {
    persisted: ['memorySlotName', 'memorySlotMode'],
    runtime: ['preview', 'memorySlotText'],
    checkpoint: ['memorySlotText'],
  },
  'context-compression': {
    persisted: [
      'contextCompressionMaxTokens',
      'contextCompressionRatio',
      'contextCompressionLengthWords',
      'compressAfterOutput',
      'runAfterRpOutput',
    ],
    runtime: ['preview', 'compressedText', 'compressionRemainingText'],
    checkpoint: [
      'compressedText',
      'compressionSourceText',
      'compressionRemainingText',
      'resolvedContextTokenLimit',
      'hasContextLimitConnection',
    ],
  },
  'rp-storybook': {
    persisted: ['storybookJson'],
    runtime: ['preview', 'storybookStatus'],
    checkpoint: ['storybookJson'],
  },
  'rp-storybook-editor': {
    persisted: ['storybookJson'],
    runtime: ['preview', 'storybookStatus'],
    checkpoint: ['storybookJson'],
  },
};

function pickNodeFields(node: WorkflowNode, fields: readonly string[]) {
  const data = node.data as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field, structuredClone(data[field])]));
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function patchFromCheckpoint(
  snapshot: { before: Record<string, unknown>; after: Record<string, unknown> },
  target: 'before' | 'after',
) {
  return structuredClone(snapshot[target]);
}

function runtimeFieldsForNode(node: WorkflowNode): readonly string[] {
  if (node.data.kind !== undefined) {
    return [];
  }
  const policy = coreNodeDataPolicies[node.data.nodeType];
  if (!policy) {
    return [];
  }
  return [...new Set([...policy.runtime, ...policy.checkpoint])];
}

export function runtimeSnapshotForNode(node: WorkflowNode) {
  return pickNodeFields(node, runtimeFieldsForNode(node));
}

function createTurnCheckpoint(
  turnId: string,
  beforeNodes: WorkflowNode[],
  afterNodes: WorkflowNode[],
  createdTimelineEntryIds: string[],
  beforeWorkflowVariables: Record<string, string> = {},
  afterWorkflowVariables: Record<string, string> = {},
): TurnCheckpoint {
  const beforeById = new Map(beforeNodes.map((node) => [node.id, node]));
  const nodeSnapshots: TurnCheckpoint['nodeSnapshots'] = {};
  const eventSnapshots: NonNullable<TurnCheckpoint['eventSnapshots']> = {};
  afterNodes.forEach((afterNode) => {
    if (afterNode.data.kind !== undefined) {
      return;
    }
    const policy = coreNodeDataPolicies[afterNode.data.nodeType];
    const beforeNode = beforeById.get(afterNode.id);
    if (!policy || !beforeNode) {
      return;
    }
    const before = pickNodeFields(beforeNode, policy.checkpoint);
    const after = pickNodeFields(afterNode, policy.checkpoint);
    if (!valuesEqual(before, after)) {
      nodeSnapshots[afterNode.id] = { before, after };
    }
    if (afterNode.data.nodeType === 'event-manager') {
      const beforeAppointments = Array.isArray(beforeNode.data.eventAppointments)
        ? beforeNode.data.eventAppointments
        : [];
      const afterAppointments = Array.isArray(afterNode.data.eventAppointments)
        ? afterNode.data.eventAppointments
        : [];
      const beforeEvents = appointmentEntitiesFromAppointments(beforeAppointments);
      const afterEvents = appointmentEntitiesFromAppointments(afterAppointments);
      const eventIds = new Set([...Object.keys(beforeEvents), ...Object.keys(afterEvents)]);
      eventIds.forEach((eventId) => {
        const beforeEvent = beforeEvents[eventId];
        const afterEvent = afterEvents[eventId];
        if (!valuesEqual(beforeEvent, afterEvent)) {
          eventSnapshots[eventId] = {
            ...(beforeEvent ? { before: beforeEvent } : {}),
            ...(afterEvent ? { after: afterEvent } : {}),
          };
        }
      });
    }
  });
  return {
    turnId,
    createdTimelineEntryIds,
    ...(!valuesEqual(beforeWorkflowVariables, afterWorkflowVariables)
      ? {
          workflowVariables: {
            before: structuredClone(beforeWorkflowVariables),
            after: structuredClone(afterWorkflowVariables),
          },
        }
      : {}),
    nodeSnapshots,
    ...(Object.keys(eventSnapshots).length ? { eventSnapshots } : {}),
  };
}

export function createTurnCheckpointFromNodesForTurnRecord(
  turn: TurnRecord,
  beforeNodes: WorkflowNode[],
  afterNodes: WorkflowNode[],
  beforeWorkflowVariables: Record<string, string> = {},
  afterWorkflowVariables: Record<string, string> = {},
) {
  return createTurnCheckpoint(
    turn.id,
    beforeNodes,
    afterNodes,
    turnTimelineEntryIds(turn),
    beforeWorkflowVariables,
    afterWorkflowVariables,
  );
}

export function workflowVariablesFromTurnCheckpoint(
  checkpoint: TurnCheckpoint,
  target: 'before' | 'after',
) {
  return checkpoint.workflowVariables
    ? structuredClone(checkpoint.workflowVariables[target])
    : undefined;
}

function applyEventSnapshotsToAppointments(
  appointments: RpAppointment[] | undefined,
  eventSnapshots: NonNullable<TurnCheckpoint['eventSnapshots']>,
  target: 'before' | 'after',
) {
  const events = appointmentEntitiesFromAppointments(appointments ?? []);
  Object.entries(eventSnapshots).forEach(([eventId, snapshot]) => {
    const event = snapshot[target];
    if (event) {
      events[eventId] = structuredClone(event);
      return;
    }
    delete events[eventId];
  });
  return appointmentsFromEventEntities(events);
}

export function applyTurnCheckpointToNodes(
  nodes: WorkflowNode[],
  checkpoint: TurnCheckpoint,
  target: 'before' | 'after',
): WorkflowNode[] {
  return nodes.map((node) => {
    if (node.data.kind !== undefined) {
      return node;
    }
    const nodeSnapshot = checkpoint.nodeSnapshots[node.id];
    const nodePatch = nodeSnapshot ? patchFromCheckpoint(nodeSnapshot, target) : {};
    const eventPatch = node.data.nodeType === 'event-manager' && checkpoint.eventSnapshots
      ? {
          eventAppointments: applyEventSnapshotsToAppointments(
            node.data.eventAppointments,
            checkpoint.eventSnapshots,
            target,
          ),
        }
      : {};
    if (!Object.keys(nodePatch).length && !Object.keys(eventPatch).length) {
      return node;
    }
    return {
      ...node,
      data: {
        ...node.data,
        ...nodePatch,
        ...eventPatch,
      },
    };
  });
}

export function trimCheckpoints(checkpoints: TurnCheckpoint[]) {
  return checkpoints.slice(-DATA_MANAGEMENT_BUDGETS.maxCheckpoints);
}
