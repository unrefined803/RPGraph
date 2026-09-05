import type {
  TurnRecord,
  TurnRuntimeNodeSnapshot,
  TurnRuntimeSnapshot,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';

const commonRuntimeFields = [
  'preview',
  'fullText',
  'runPrepared',
  'runCompleted',
] as const;

const runtimeFieldsByNodeType: Record<string, readonly string[]> = {
  'rp-storybook': [...commonRuntimeFields, 'storybookJson', 'storybookStatus'],
  'rp-storybook-editor': [...commonRuntimeFields, 'storybookJson', 'storybookStatus'],
  custom: [...commonRuntimeFields, 'customNodeDefinition', 'customNodeRuntimeDisplays'],
  history: [
    ...commonRuntimeFields,
    'historyCurrentRpDateTime',
    'historyProcessedTurnIds',
    'historyTimeStatus',
  ],
  'event-manager': [
    ...commonRuntimeFields,
    'eventAppointments',
    'eventProcessedTurnIds',
    'eventStatus',
  ],
  'character-stats': [
    ...commonRuntimeFields,
    'characterStatsState',
    'characterStatsBaselineState',
    'characterStatsStatus',
    'characterStatsLastChanges',
    'characterStatsLastRpDateTime',
    'characterStatsTimeline',
  ],
  'memory-slot': [
    ...commonRuntimeFields,
    'memorySlotText',
  ],
  'context-compression': [
    ...commonRuntimeFields,
    'compressedText',
    'compressionSourceText',
    'compressionRemainingText',
    'resolvedContextTokenLimit',
    'hasContextLimitConnection',
  ],
};

function runtimeFields(node: WorkflowNode) {
  return runtimeFieldsByNodeType[node.data.nodeType];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function captureTurnRuntime(
  nodes: WorkflowNode[],
  workflowVariables: Record<string, string> = {},
): TurnRuntimeSnapshot {
  return {
    workflowVariables: structuredClone(workflowVariables),
    nodes: Object.fromEntries(
      nodes.flatMap((node) => {
        const fields = runtimeFields(node);
        if (!fields) {
          return [];
        }
        const snapshot: TurnRuntimeNodeSnapshot = {};
        fields.forEach((field) => {
          snapshot[field] = clone((node.data as Record<string, unknown>)[field]);
        });
        return [[node.id, snapshot]];
      }),
    ),
  };
}

export function restoreTurnRuntime(nodes: WorkflowNode[], snapshot: TurnRuntimeSnapshot) {
  return nodes.map((node) => {
    const fields = runtimeFields(node);
    if (!fields) {
      return node;
    }
    const stored = snapshot.nodes[node.id] ?? {};
    const patch = Object.fromEntries(fields.map((field) => [field, clone(stored[field])]));
    return {
      ...node,
      data: { ...node.data, ...patch } as WorkflowNodeData,
    };
  });
}

export function flattenTurnMessages(turns: TurnRecord[]) {
  return turns.flatMap((turn) => [...turn.input.messages, ...turn.output.messages]);
}

export function turnMessageIds(turn: TurnRecord) {
  return new Set(
    [...turn.input.messages, ...turn.output.messages].map((message) => message.id),
  );
}

export function openingHistoryMessageIds(turns: TurnRecord[]) {
  return new Set(
    turns
      .filter((turn) => turn.openingHistory)
      .flatMap((turn) => [...turn.input.messages, ...turn.output.messages])
      .map((message) => message.id),
  );
}

export function lastSessionTurnIndex(turns: TurnRecord[]) {
  return turns.length - 1;
}

export function lastSessionTurn(turns: TurnRecord[]) {
  const index = lastSessionTurnIndex(turns);
  return index >= 0 ? turns[index] : undefined;
}
