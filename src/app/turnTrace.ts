import type { LlmDispatchMetadata, LlmRequestObserver } from '../llm/NodeLlmApi';
import { TextMetricsApi } from '../llm/tokenMetrics';
import { compactDebugValue, sanitizeDebugSnapshotValue } from './debugSnapshot';
import type { LlmCallStage, LlmCallStats, MessageRecord, TurnRecord, WorkflowNode } from '../types';
import type { FormattedChatHistorySegment } from '../workflow';
import { sanitizeDataUrlsInText } from '../utils/sanitize';
import {
  autoplayMessageFormat,
  socialMediaMessageFormat,
} from '../chat/messageFormats';

type TurnTracePromptPart = {
  text: string;
  actionInserted?: boolean;
  stepOutputInserted?: string;
  historySegments?: FormattedChatHistorySegment[];
};

export type TurnTracePromptSection = {
  label: string;
  text: string;
  parts?: TurnTracePromptPart[];
  historySegments?: FormattedChatHistorySegment[];
};

export type TurnTracePromptPass = {
  label: string;
  prompt?: string;
  images?: Array<{
    index: number;
    id: string;
    name: string;
    source?: 'input' | 'action' | 'reference';
  }>;
  sections?: TurnTracePromptSection[];
};

type TraceRunCall = Partial<LlmCallStats> & {
  startedAtMs?: number;
  order: number;
  nodeId: string;
  nodeLabel: string;
  label: string;
};

type TraceRunReport = {
  runId: string;
  startedAt: string;
  calls: TraceRunCall[];
};

export type TurnTraceMessage = {
  id: number;
  role: MessageRecord['role'];
  channel: 'rp' | 'phone';
  speaker?: string;
  from?: string;
  to?: string;
  text: string;
  translatedText?: string;
  imageCount?: number;
  includeInHistory?: boolean;
  replyToMessageId?: number;
  turnId?: string;
  rpDateTime?: string;
};

export type TurnTraceLlmCall = {
  order: number;
  nodeId: string;
  nodeLabel: string;
  nodeType?: string;
  prompt: string;
  capture?: 'request-boundary' | 'run-report-only';
  status?: 'pending' | 'completed' | 'error' | 'cancelled';
  dispatched?: boolean;
  startedAt?: string;
  startedAtMs?: number;
  partialResponse?: string;
  completedAt?: string;
  completedAtMs?: number;
  phase?: 'response' | 'prepare-next-turn';
  stage?: LlmCallStage;
  usage?: LlmCallStats;
  requestSettings?: LlmDispatchMetadata;
  error?: string;
  routing?: { outputChannelValue: string; promptSlotValue: string };
  selectedOutputChannel?: number;
  selectedPromptSlot?: number;
  promptBefore?: string;
  promptAfter?: string;
  promptPasses?: TurnTracePromptPass[];
  outputPasses?: Array<{ label: string; text: string }>;
  actionResults?: string[];
  generatedText?: string;
  warnings?: string[];
  formatResults?: TurnTraceFormatResult[];
};

type TurnTraceFormatResult = {
  name: string;
  status: 'ok' | 'error' | 'skipped';
  detail?: string;
  preview?: string;
};

export type TurnTraceEvent = { at?: string; atMs?: number; phase?: 'response' | 'prepare-next-turn' } & (
  | {
      kind: 'warning';
      nodeId?: string;
      nodeLabel?: string;
      nodeType?: string;
      message: string;
    }
  | ({
      kind: 'format';
      nodeId?: string;
      nodeLabel?: string;
      nodeType?: string;
    } & TurnTraceFormatResult));

export type TurnTrace = {
  traceId: string;
  turnId: string;
  turnNumber: number;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'error' | 'cancelled';
  turnCreatedAt?: string;
  nodeExecutions?: TurnTraceNodeExecution[];
  events?: TurnTraceEvent[];
  mode: TurnRecord['mode'];
  channel: 'rp' | 'phone' | 'narrator' | 'event' | 'output-actions' | 'social-media' | 'autoplay';
  input: {
    messages: TurnTraceMessage[];
    graphText?: string;
  };
  steps: TurnTraceLlmCall[];
  output: {
    messages: TurnTraceMessage[];
    graphText?: string;
  };
  warnings?: string[];
  error?: string;
};

export type TurnTraceCopyPayload = {
  schema: 'rpgraph-turn-trace';
  version: 6;
  compression: { textPreviewCharacters: number; references: string; notes: string };
  createdAt: string;
  privacy: 'memory-only';
  range: {
    fromTurn: number;
    toTurn: number;
    traceCount: number;
  };
  traces: unknown[];
};

function traceText(value: string) {
  return sanitizeDataUrlsInText(value);
}

function traceMessages(messages: MessageRecord[]) {
  return messages.flatMap((message): TurnTraceMessage[] => {
    const text = traceText(message.originalText);
    const translatedText = traceText(message.translatedText ?? '');
    const imageCount = message.imageAttachments?.length ?? 0;
    if (!text && !translatedText && imageCount === 0) {
      return [];
    }
    return [{
      id: message.id,
      role: message.role,
      channel: message.channel === 'phone' || message.phoneMessage ? 'phone' : 'rp',
      speaker: message.speakerName,
      from: message.phoneFrom,
      to: message.phoneTo,
      text,
      translatedText: translatedText && translatedText !== text ? translatedText : undefined,
      imageCount: imageCount || undefined,
      includeInHistory: message.includeInHistory,
      replyToMessageId: message.replyToMessageId,
      turnId: message.turnId,
      rpDateTime: message.rpDateTime,
    }];
  });
}

function traceChannel(turn: TurnRecord): TurnTrace['channel'] {
  if (turn.directAction) return 'output-actions';
  if (turn.messageFormat === socialMediaMessageFormat) return 'social-media';
  if (turn.messageFormat === autoplayMessageFormat) return 'autoplay';
  // Auxiliary output messages do not change the initiating turn's channel.
  if (turn.messageFormat === 1 || turn.input.messages.some((message) => message.channel === 'phone' || message.phoneMessage)) {
    return 'phone';
  }
  if (turn.input.messages.some((message) => message.eventInput)) return 'event';
  return turn.mode === 'narrator' ? 'narrator' : 'rp';
}

function promptDebugForNode(node: WorkflowNode | undefined) {
  if (!node || node.data.kind !== undefined) {
    return undefined;
  }
  if (node.data.nodeType === 'llm-prompt-switch') {
    return node.data.llmPromptSwitchDebug;
  }
  if (node.data.nodeType === 'llm-prompt') {
    return node.data.llmPromptDebug;
  }
  return undefined;
}

export function createTurnTrace({
  turn, run, status, warnings = [], traceEvents = [], error,
  completedAt = new Date().toISOString(), capturedSteps = [], nodeExecutions,
}: {
  turn: TurnRecord;
  run: TraceRunReport;
  status: TurnTrace['status'];
  warnings?: string[];
  traceEvents?: TurnTraceEvent[];
  error?: string;
  completedAt?: string;
  capturedSteps?: TurnTraceLlmCall[];
  nodeExecutions?: TurnTraceNodeExecution[];
}): TurnTrace {
  const unmatched = new Set(capturedSteps.filter((step) => step.status === 'completed'));
  const reportOnly: TurnTraceLlmCall[] = run.calls.flatMap((call) => {
    const captured = [...unmatched].find((step) =>
      step.nodeId === call.nodeId && step.prompt === call.label &&
      (call.startedAtMs === undefined || call.startedAtMs === step.startedAtMs),
    );
    if (captured) {
      unmatched.delete(captured);
      return [];
    }
    return [{
      order: call.order, nodeId: call.nodeId, nodeLabel: call.nodeLabel, prompt: call.label,
      capture: 'run-report-only', status: 'completed', startedAtMs: call.startedAtMs,
      usage: call.durationMs === undefined ? undefined : {
        durationMs: call.durationMs, inputTokens: call.inputTokens,
        outputTokens: call.outputTokens, totalTokens: call.totalTokens, reasoningTokens: call.reasoningTokens,
      },
    }];
  });
  const steps = [...capturedSteps, ...reportOnly].sort((a, b) =>
    (a.startedAtMs ?? Number.MAX_SAFE_INTEGER) - (b.startedAtMs ?? Number.MAX_SAFE_INTEGER),
  ).map((step, index) => ({ ...step, order: index + 1 }));
  return sanitizeDebugSnapshotValue({
    traceId: run.runId, turnId: turn.id, turnNumber: turn.number,
    startedAt: run.startedAt, completedAt, turnCreatedAt: turn.createdAt,
    nodeExecutions,
    events: traceEvents.length ? traceEvents : undefined,
    status, mode: turn.mode, channel: traceChannel(turn),
    input: { messages: traceMessages(turn.input.messages), graphText: traceText(turn.input.graphText) || undefined },
    steps,
    output: { messages: traceMessages(turn.output.messages), graphText: traceText(turn.output.graphText) || undefined },
    warnings: warnings.length ? [...new Set(warnings.map(traceText).filter(Boolean))] : undefined,
    error: status !== 'completed' ? traceText(error ?? 'Unknown run error') : undefined,
  }) as TurnTrace;
}

export function turnTraceCopyPayload(traces: TurnTrace[], textMetrics = new TextMetricsApi(), createdAt = new Date().toISOString()): TurnTraceCopyPayload {
  const ordered = [...traces].sort(
    (left, right) =>
      left.turnNumber - right.turnNumber ||
      left.startedAt.localeCompare(right.startedAt) || left.traceId.localeCompare(right.traceId),
  );
  return compactDebugValue({
    schema: 'rpgraph-turn-trace',
    version: 6,
    createdAt,
    compression: {
      textPreviewCharacters: 2400,
      references: 'JSON Pointer within this payload; identical sources or excerpts only',
      notes: 'Long texts show bounded excerpts. Request prompts are captured before dispatch; dispatched records bridge invocation, not provider receipt. Pass and node order is preserved. Usage tokens are provider-reported when available. Monotonic millisecond times share the application clock. Pending calls had not settled at capture. Report-only helpers have no captured prompt.',
    },
    privacy: 'memory-only',
    range: {
      fromTurn: ordered[0]?.turnNumber ?? 0,
      toTurn: ordered[ordered.length - 1]?.turnNumber ?? 0,
      traceCount: ordered.length,
    },
    traces: ordered,
  }, textMetrics, false, new Set(['promptPasses', 'outputPasses', 'events'])) as TurnTraceCopyPayload;
}

export type TurnTraceNodeExecution = {
  nodeId: string;
  nodeLabel: string;
  nodeType?: string;
  sourceHandle?: string | null;
  phase: 'response' | 'prepare-next-turn';
  status: 'started' | 'completed' | 'error' | 'cancelled' | 'blocked';
  at: string;
  atMs: number;
  preparedAtStart?: boolean;
  output?: string;
  error?: string;
  actionResults?: string[];
};

/** Each observer belongs to one run; later node patches cannot alter its captures. */
export function createTurnTraceRecorder(getNode: (id: string) => WorkflowNode | undefined) {
  const steps: TurnTraceLlmCall[] = [];
  const observe = (phase: 'response' | 'prepare-next-turn'): LlmRequestObserver => (request, startedAtMs) => {
    const node = request.nodeId ? getNode(request.nodeId) : undefined;
    const debug = promptDebugForNode(node);
    const latestPass = debug?.promptPasses?.[debug.promptPasses.length - 1];
    const imageSources = new Map(latestPass?.images?.map((image) => [image.id, image.source]));
    const requestText = sanitizeDataUrlsInText(request.prompt);
    // Sections are annotations only when they reconstruct this exact request.
    const sectionsMatch = latestPass?.sections?.map((section) => section.text).filter(Boolean).join('\n\n') === request.prompt;
    const switchDebug = node?.data.kind === undefined && node?.data.nodeType === 'llm-prompt-switch'
      ? node.data.llmPromptSwitchDebug : undefined;
    const step = sanitizeDebugSnapshotValue({
      order: steps.length + 1,
      nodeId: request.nodeId ?? 'unattributed',
      nodeLabel: node?.data.label ?? request.nodeId ?? 'LLM helper',
      nodeType: node?.data.nodeType,
      prompt: request.label,
      capture: 'request-boundary',
      status: 'pending',
      dispatched: false,
      startedAt: new Date().toISOString(),
      startedAtMs,
      phase,
      stage: request.stage,
      selectedOutputChannel: sectionsMatch ? switchDebug?.selectedOutputChannel : undefined,
      selectedPromptSlot: sectionsMatch ? switchDebug?.selectedPromptSlot : undefined,
      routing: sectionsMatch && switchDebug ? {
        outputChannelValue: switchDebug.outputChannelValue,
        promptSlotValue: switchDebug.promptSlotValue,
      } : undefined,
      promptPasses: [{
        label: sectionsMatch ? latestPass.label : request.label,
        prompt: requestText,
        sections: sectionsMatch ? latestPass.sections : undefined,
      }],
    }) as TurnTraceLlmCall;
    steps.push(step);
    return {
      dispatched(images, metadata) {
        step.dispatched = true;
        step.requestSettings = sanitizeDebugSnapshotValue(metadata) as LlmDispatchMetadata;
        step.promptPasses![0].images = images?.map((image, index) => ({
          index: index + 1, id: sanitizeDataUrlsInText(image.id), name: sanitizeDataUrlsInText(image.name),
          source: sectionsMatch ? imageSources.get(image.id) : undefined,
        })) ?? [];
      },
      streamed(text) { step.partialResponse = sanitizeDataUrlsInText(text); },
      completed(result) {
        step.partialResponse = undefined;
        step.status = 'completed';
        step.completedAt = new Date().toISOString();
        step.completedAtMs = performance.now();
        step.outputPasses = [{ label: 'Raw response', text: sanitizeDataUrlsInText(result.text) }];
        step.usage = { ...result.stats };
      },
      failed(error, cancelled) {
        step.status = cancelled ? 'cancelled' : 'error';
        step.completedAt = new Date().toISOString();
        step.completedAtMs = performance.now();
        step.error = sanitizeDataUrlsInText(error);
      },
    };
  };
  const captureNodeExecution = (event: TurnTraceNodeExecution): TurnTraceNodeExecution => {
    const observed = steps.some((step) => step.nodeId === event.nodeId && step.phase === event.phase);
    const debug = observed && event.status !== 'started' ? promptDebugForNode(getNode(event.nodeId)) : undefined;
    return sanitizeDebugSnapshotValue({
      ...event,
      actionResults: debug?.actionResults?.length ? debug.actionResults : undefined,
    }) as TurnTraceNodeExecution;
  };
  return { steps, observe, captureNodeExecution };
}
