import { DATA_MANAGEMENT_BUDGETS, truncateForBudget } from './budgets';
import {
  coreNodeDataPolicies,
} from './checkpointStore';
import type { TurnRecord, WorkflowNode } from '../types';
import type {
  DebugLlmCall,
  NodeDiagnostic,
  SessionDebugState,
  TurnCheckpoint,
} from './types';

function boundedDebugState(debug: SessionDebugState | undefined): SessionDebugState | undefined {
  if (!debug) {
    return undefined;
  }
  return {
    recentLlmCalls: debug.recentLlmCalls.slice(-DATA_MANAGEMENT_BUDGETS.maxRecentLlmCalls),
    nodeDiagnostics: Object.fromEntries(
      Object.entries(debug.nodeDiagnostics).map(([nodeId, diagnostic]) => [
        nodeId,
        boundedNodeDiagnostic(diagnostic),
      ]),
    ),
  };
}

function boundedNodeDiagnostic(diagnostic: NodeDiagnostic): NodeDiagnostic {
  return {
    ...diagnostic,
    entries: diagnostic.entries.slice(-DATA_MANAGEMENT_BUDGETS.maxDebugDiagnosticsPerNode),
  };
}

function debugLlmCallPreview(call: DebugLlmCall): DebugLlmCall {
  return {
    ...call,
    promptPreview: call.promptPreview
      ? truncateForBudget(call.promptPreview, DATA_MANAGEMENT_BUDGETS.llmPreviewMaxChars)
      : undefined,
    responsePreview: call.responsePreview
      ? truncateForBudget(call.responsePreview, DATA_MANAGEMENT_BUDGETS.llmPreviewMaxChars)
      : undefined,
  };
}

function debugValueText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function debugStateFromNodes(
  nodes: WorkflowNode[],
  createdAt = new Date().toISOString(),
): SessionDebugState | undefined {
  const recentLlmCalls = nodes.flatMap((node) => {
    if (node.data.kind !== undefined) {
      return [];
    }
    return (node.data.llmCallStats ?? []).map((call) =>
      debugLlmCallPreview({
        ...call,
        nodeId: node.id,
        createdAt,
      }),
    );
  });
  const nodeDiagnostics = Object.fromEntries(
    nodes.flatMap((node) => {
      if (node.data.kind !== undefined) {
        return [];
      }
      const policy = coreNodeDataPolicies[node.data.nodeType];
      const debugFields = policy?.debug ?? [];
      const data = node.data as Record<string, unknown>;
      const entries = debugFields
        .map((field) => ({ field, value: data[field] }))
        .filter(({ value }) => value !== undefined && value !== null && value !== '')
        .map(({ field, value }) => ({
          createdAt,
          level: 'info' as const,
          text: `${field}: ${truncateForBudget(debugValueText(value), DATA_MANAGEMENT_BUDGETS.llmPreviewMaxChars)}`,
        }));
      if (!entries.length) {
        return [];
      }
      const diagnostic: NodeDiagnostic = {
        label: node.data.label,
        entries,
      };
      return [[node.id, boundedNodeDiagnostic(diagnostic)] as const];
    }),
  );
  const debug = boundedDebugState({ recentLlmCalls, nodeDiagnostics });
  if (!debug || (!debug.recentLlmCalls.length && !Object.keys(debug.nodeDiagnostics).length)) {
    return undefined;
  }
  return debug;
}

function debugCheckpointSummary(checkpoint: TurnCheckpoint) {
  return {
    turnId: checkpoint.turnId,
    createdTimelineEntryCount: checkpoint.createdTimelineEntryIds.length,
    nodeSnapshots: Object.fromEntries(
      Object.entries(checkpoint.nodeSnapshots).map(([nodeId, snapshot]) => {
        const beforeFields = Object.keys(snapshot.before);
        const afterFields = Object.keys(snapshot.after);
        return [
          nodeId,
          {
            beforeFields,
            afterFields,
            fields: Array.from(new Set([...beforeFields, ...afterFields])).sort(),
          },
        ];
      }),
    ),
    eventIds: Object.keys(checkpoint.eventSnapshots ?? {}).sort(),
  };
}

export function debugTurnSummaryFromTurnRecord(
  turn: TurnRecord,
  checkpointOverride?: TurnCheckpoint,
) {
  const checkpoint = checkpointOverride ?? {
    turnId: turn.id,
    createdTimelineEntryIds: [],
    nodeSnapshots: {},
  };
  return {
    id: turn.id,
    number: turn.number,
    createdAt: turn.createdAt,
    mode: turn.mode,
    input: {
      graphText: turn.input.graphText,
      messageIds: turn.input.messages.map((message) => message.id),
      messageCount: turn.input.messages.length,
    },
    output: {
      graphText: turn.output.graphText,
      messageIds: turn.output.messages.map((message) => message.id),
      messageCount: turn.output.messages.length,
    },
    checkpoint: debugCheckpointSummary(checkpoint),
  };
}
