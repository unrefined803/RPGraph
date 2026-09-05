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
  runId?: string;
  startedAt?: string;
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
    mode: 'compact-debug-copy' | 'bounded-debug-copy';
    textPreviewCharacters: number;
    maxCollectionItems: number;
    references: 'JSON Pointer within this payload';
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

export const debugSnapshotLimits = {
  standard: { textPreviewCharacters: 2400, maxCollectionItems: 100 },
  compressed: { textPreviewCharacters: 800, maxCollectionItems: 40 },
};

const boundedCollections = new Set([
  'systemLog', 'events', 'eventEntities', 'eventAppointments',
  'promptPasses', 'outputPasses', 'actionResults', 'llmCallStats', 'historySegments',
]);

function pointerPart(key: string) {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** References always point to an earlier value in this single exported value. */
export function compactDebugValue(
  value: unknown,
  textMetrics: TextMetricsApi,
  compressed = false,
  unboundedCollections = new Set<string>(),
): unknown {
  const limits = compressed ? debugSnapshotLimits.compressed : debugSnapshotLimits.standard;
  const texts = new Map<string, string>();
  const diagnosticObjects = new Map<string, string>();
  // Excerpts are compared separately: equal previews never imply equal sources.
  const excerpts = new Map<string, string>();
  const excerpt = (text: string, path: string): unknown => {
    const previous = excerpts.get(text);
    if (previous && text.length >= 160 && previous.length + 30 < text.length) {
      return { $ref: previous };
    }
    if (text.length >= 160) excerpts.set(text, path);
    return text;
  };
  const walk = (entry: unknown, path: string, key: string): unknown => {
    if (typeof entry === 'string') {
      if (entry.length >= 160) {
        const previous = texts.get(entry);
        if (previous !== undefined && previous.length + 30 < entry.length) return { $ref: previous };
        texts.set(entry, path);
      }
      if (entry.length <= limits.textPreviewCharacters + 160) {
        const result = excerpt(entry, path);
        if (typeof result !== 'string') texts.set(entry, excerpts.get(entry)!);
        return result;
      }
      const tailOnly = /history|inputValue/i.test(key);
      const headLength = Math.floor(limits.textPreviewCharacters / 3);
      return {
        characters: entry.length,
        estimatedTokens: textMetrics.measure(entry).tokens,
        omittedCharacters: entry.length - limits.textPreviewCharacters,
        ...(tailOnly
          ? { tail: excerpt(entry.slice(-limits.textPreviewCharacters), `${path}/tail`) }
          : {
              head: excerpt(entry.slice(0, headLength), `${path}/head`),
              tail: excerpt(entry.slice(-(limits.textPreviewCharacters - headLength)), `${path}/tail`),
            }),
      };
    }
    if (Array.isArray(entry)) {
      let indexes = entry.map((_, index) => index);
      if (boundedCollections.has(key) && !unboundedCollections.has(key) && entry.length > limits.maxCollectionItems) {
        const limit = limits.maxCollectionItems;
        if (key === 'systemLog') {
          const recentStart = Math.max(0, entry.length - Math.floor(limit * 0.75));
          const olderImportant = indexes.slice(0, recentStart).filter((index) =>
            entry[index]?.level === 'warning' || entry[index]?.level === 'error',
          ).slice(-(limit - (entry.length - recentStart)));
          const retained = new Set(olderImportant);
          for (let index = entry.length - 1; retained.size < limit; index -= 1) retained.add(index);
          indexes = [...retained].sort((a, b) => a - b);
        } else if (['events', 'eventEntities', 'eventAppointments'].includes(key)) {
          const active = indexes.filter((index) => entry[index]?.status === 'upcoming');
          const other = indexes.filter((index) => entry[index]?.status !== 'upcoming');
          const remaining = Math.max(0, limit - active.length);
          indexes = [...active.slice(0, limit), ...(remaining ? other.slice(-remaining) : [])]
            .sort((a, b) => a - b);
        } else {
          indexes = indexes.slice(-limit);
        }
      }
      const omitted = entry.length - indexes.length;
      // Keep arrays as arrays; the first entry explicitly describes any omission.
      const result: unknown[] = omitted ? [{
        omittedItems: omitted,
        totalItems: entry.length,
        retainedOriginalIndexes: indexes,
      }] : [];
      for (const index of indexes) {
        result.push(walk(entry[index], `${path}/${result.length}`, ''));
      }
      return result;
    }
    if (entry && typeof entry === 'object') {
      if (key === 'eventEntities') {
        const items = Object.entries(entry);
        if (items.length > limits.maxCollectionItems) {
          const isOpen = (value: unknown) => !!value && typeof value === 'object' &&
            'status' in value && value.status === 'upcoming';
          const active = items.filter(([, value]) => isOpen(value));
          const other = items.filter(([, value]) => !isOpen(value));
          const remaining = Math.max(0, limits.maxCollectionItems - active.length);
          const retained = [...active.slice(0, limits.maxCollectionItems),
            ...(remaining ? other.slice(-remaining) : [])];
          return {
            collectionType: 'event-entity-map',
            totalItems: items.length,
            omittedItems: items.length - retained.length,
            entries: Object.fromEntries(retained.map(([id, value]) =>
              [id, walk(value, `${path}/entries/${pointerPart(id)}`, '')])),
          };
        }
      }
      if (['runtimeDebug', 'llmPromptDebug', 'llmPromptSwitchDebug', 'runtimePortValues'].includes(key)) {
        const serialized = JSON.stringify(entry);
        if (serialized.length > 256) {
          const previous = diagnosticObjects.get(serialized);
          if (previous !== undefined && previous.length + 30 < serialized.length) return { $ref: previous };
          diagnosticObjects.set(serialized, path);
        }
      }
      return Object.fromEntries(Object.entries(entry).filter(([, child]) => child !== undefined)
        .map(([childKey, child]) => [childKey, walk(
          child,
          `${path}/${pointerPart(childKey)}`,
          (childKey === 'text' && 'label' in entry && entry.label === 'Text Input') ||
            (childKey === 'graphText' && key === 'input') ? 'inputValue' : childKey,
        )]));
    }
    return entry;
  };
  return walk(sanitizeDebugSnapshotValue(value), '#', '');
}

export type DebugSnapshotSectionKey = keyof Pick<DebugSnapshot,
  'appState' | 'lastRun' | 'recentTurns' | 'promptSwitch' | 'eventManager' | 'nodes' | 'edges' | 'systemLog'
>;

export type DebugSnapshotCopy = Omit<DebugSnapshot, DebugSnapshotSectionKey> &
  Partial<Pick<DebugSnapshot, DebugSnapshotSectionKey>>;

export function createDebugSnapshotCopy(
  snapshot: DebugSnapshot,
  sections: { id: string; snapshotKey: DebugSnapshotSectionKey }[],
  textMetrics: TextMetricsApi,
  compressed: boolean,
): DebugSnapshotCopy {
  const limits = compressed ? debugSnapshotLimits.compressed : debugSnapshotLimits.standard;
  const payload: DebugSnapshotCopy = {
    schema: snapshot.schema,
    version: 2,
    createdAt: snapshot.createdAt,
    compression: {
      mode: compressed ? 'compact-debug-copy' : 'bounded-debug-copy',
      ...limits,
      references: 'JSON Pointer within this payload',
    },
    selectedSections: sections.map((section) => section.id),
  };
  for (const section of sections) {
    (payload as Record<string, unknown>)[section.snapshotKey] = snapshot[section.snapshotKey];
  }
  return compactDebugValue(payload, textMetrics, compressed) as DebugSnapshotCopy;
}

export function debugSnapshotNode(node: WorkflowNode) {
  const data = node.data as Record<string, unknown>;
  const scalarData = Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) =>
        value === undefined ||
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean',
      ),
  );
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    selected: node.selected,
    data: {
      ...scalarData,
      runtimePortValues: data.runtimePortValues,
      llmCallStats: data.llmCallStats,
      llmPromptDebug: data.llmPromptDebug,
      eventAppointments: Array.isArray(data.eventAppointments)
        ? normalizeEventAppointments(data.eventAppointments as WorkflowNodeData['eventAppointments'])
        : data.eventAppointments,
      llmPromptSwitchDebug: data.llmPromptSwitchDebug,
    },
  };
}

function debugSnapshotMessage(message: MessageRecord) {
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
    turnId: message.turnId,
    rpDateTime: message.rpDateTime,
    includeInHistory: message.includeInHistory,
    replyToMessageId: message.replyToMessageId,
    inputPromptSlot: message.inputPromptSlot,
    inputMessageFormat: message.inputMessageFormat,
    imageCount: message.imageAttachments?.length,
    embeddedSocialMessageCount: message.embeddedSocialMessages?.length,
    text: message.originalText,
    translatedText: message.translatedText,
  };
}

export function recentTurnDebugSummaries(
  turns: TurnRecord[],
  turnCheckpoints: TurnCheckpoint[],
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
      inputMessages: turn.input.messages.map((message) => debugSnapshotMessage(message)),
      outputMessages: turn.output.messages.map((message) => debugSnapshotMessage(message)),
    }));
}
