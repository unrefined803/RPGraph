import { debugTurnSummaryFromTurnRecord } from '../data-management/debugContext';
import { normalizeEventAppointments } from '../data-management/eventStore';
import type { TextMetricsApi } from '../llm/tokenMetrics';
import type {
  MessageRecord,
  TurnRecord,
  TurnRecordMode,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';
import type { TurnCheckpoint } from '../data-management/types';
import { sanitizeDataUrlsInText } from '../utils/sanitize';

export type LastRunDebug = {
  turnMode: TurnRecordMode;
  narratorAutoTurn: boolean;
  displayText: string;
  originalInput: string;
  promptSlot: number;
  isAutoTurn: boolean;
  isNarratorTurn: boolean;
  eventDisplayText?: string;
  phoneMessage: boolean;
  messageFormat: number;
  originalHistory: string;
  translatedHistory: string;
};

export type DebugSnapshot = {
  schema: 'rpgraph-debug-snapshot';
  version: number;
  createdAt: string;
  compression?: {
    mode: 'compact-debug-copy';
    textPreviewCharacters: number;
  };
  selectedSections: string[];
  appState: Record<string, unknown>;
  lastRun: Record<string, unknown>;
  recentTurns: unknown[];
  promptSwitch: Record<string, unknown>;
  eventManager: Record<string, unknown>;
  nodes: unknown[];
  edges: unknown[];
  systemLog: unknown[];
};

export function sanitizeDebugSnapshotValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== 'object') {
    if (typeof value === 'function') {
      return undefined;
    }
    return typeof value === 'string' ? sanitizeDataUrlsInText(value) : value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => sanitizeDebugSnapshotValue(entry, seen));
    seen.delete(value);
    return result;
  }
  const result = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'dataUrl')
      .map(([key, entry]) => [key, sanitizeDebugSnapshotValue(entry, seen)]),
  );
  seen.delete(value);
  return result;
}

function debugTextSummary(text: string, textMetrics: TextMetricsApi, previewLength = 500) {
  return {
    characters: text.length,
    estimatedTokens: textMetrics.measure(text).tokens,
    preview: text.length > previewLength ? `${text.slice(0, previewLength)}...` : text,
  };
}

export function compactDebugValue(value: unknown, textMetrics: TextMetricsApi): unknown {
  if (typeof value === 'string') {
    return value.length > 700 ? debugTextSummary(value, textMetrics) : value;
  }
  if (Array.isArray(value)) {
    const json = JSON.stringify(value);
    return json.length > 1200
      ? {
          type: 'array',
          items: value.length,
          characters: json.length,
          estimatedTokens: textMetrics.measure(json).tokens,
          preview: `${json.slice(0, 500)}...`,
        }
      : value;
  }
  if (value && typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 1200
      ? {
          type: 'object',
          keys: Object.keys(value).length,
          characters: json.length,
          estimatedTokens: textMetrics.measure(json).tokens,
          preview: `${json.slice(0, 500)}...`,
        }
      : value;
  }
  return value;
}

export function compactDebugNode(node: WorkflowNode, textMetrics: TextMetricsApi) {
  const data = node.data as Record<string, unknown>;
  const scalarData = Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) =>
        value === undefined ||
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean',
      )
      .map(([key, value]) => [key, compactDebugValue(value, textMetrics)]),
  );
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    selected: node.selected,
    data: {
      ...scalarData,
      runtimePortValues: compactDebugValue(data.runtimePortValues, textMetrics),
      llmCallStats: data.llmCallStats,
      llmPromptDebug: compactDebugValue(data.llmPromptDebug, textMetrics),
      eventAppointments: Array.isArray(data.eventAppointments)
        ? normalizeEventAppointments(data.eventAppointments as WorkflowNodeData['eventAppointments'])
        : data.eventAppointments,
      llmPromptSwitchDebug: compactDebugValue(data.llmPromptSwitchDebug, textMetrics),
    },
  };
}

function compactDebugMessage(message: MessageRecord, textMetrics: TextMetricsApi) {
  return {
    id: message.id,
    role: message.role,
    channel: message.channel ?? 'rp',
    speakerName: message.speakerName,
    phoneFrom: message.phoneFrom,
    phoneTo: message.phoneTo,
    eventInput: message.eventInput,
    embeddedPhoneMessageCount: message.embeddedPhoneMessages?.length,
    turnPart: message.turnPart,
    text: compactDebugValue(message.originalText, textMetrics),
    translatedText: compactDebugValue(message.translatedText, textMetrics),
  };
}

export function recentTurnDebugSummaries(
  turns: TurnRecord[],
  turnCheckpoints: TurnCheckpoint[],
  textMetrics: TextMetricsApi,
  turnsLimit = 2,
) {
  const checkpointsByTurnId = new Map(turnCheckpoints.map((checkpoint) => [checkpoint.turnId, checkpoint]));
  return turns
    .slice(-turnsLimit)
    .map((turn) => ({
      ...debugTurnSummaryFromTurnRecord(
        turn,
        checkpointsByTurnId.get(turn.id),
      ),
      inputMessages: turn.input.messages.map((message) => compactDebugMessage(message, textMetrics)),
      outputMessages: turn.output.messages.map((message) => compactDebugMessage(message, textMetrics)),
    }));
}
