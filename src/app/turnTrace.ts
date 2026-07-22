import type { MessageRecord, TurnRecord, WorkflowNode } from '../types';
import type { FormattedChatHistorySegment } from '../workflow';
import { sanitizeDataUrlsInText } from '../utils/sanitize';
import {
  autoplayMessageFormat,
  socialMediaMessageFormat,
} from '../chat/messageFormats';

const textPreviewCharacters = 320;
const textInputExcerptTargetWords = 240;
const textInputExcerptMaxWords = 300;

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
  excerpt?: {
    kind: 'last-text-input-words';
    shownWords: number;
    totalWords: number;
    targetWords: number;
  };
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

type TraceRunCall = {
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
};

export type TurnTraceLlmCall = {
  order: number;
  nodeId: string;
  nodeLabel: string;
  nodeType?: string;
  prompt: string;
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

export type TurnTraceEvent =
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
    } & TurnTraceFormatResult);

export type TurnTrace = {
  traceId: string;
  turnId: string;
  turnNumber: number;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'error';
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
  version: 5;
  createdAt: string;
  privacy: 'memory-only';
  range: {
    fromTurn: number;
    toTurn: number;
    traceCount: number;
  };
  traces: TurnTrace[];
};

function traceText(value: string) {
  return sanitizeDataUrlsInText(value).trim();
}

function previewText(value: string | undefined) {
  const text = traceText(value ?? '');
  if (!text) {
    return undefined;
  }
  return text.length > textPreviewCharacters
    ? `${text.slice(0, textPreviewCharacters)}...`
    : text;
}

function wordMatches(text: string) {
  return Array.from(text.matchAll(/\S+/g));
}

function countWords(text: string) {
  return wordMatches(text).length;
}

function textAfterSentenceBoundary(text: string, startIndex: number) {
  const windowStart = Math.max(0, startIndex - 1600);
  const prefix = text.slice(windowStart, startIndex);
  const boundaries = Array.from(prefix.matchAll(/(?:[.!?]["')\]]?|\n{2,})\s+/g));
  const boundary = boundaries[boundaries.length - 1];
  return boundary ? windowStart + boundary.index + boundary[0].length : startIndex;
}

function textInputExcerpt(text: string) {
  const words = wordMatches(text);
  if (words.length <= textInputExcerptMaxWords) {
    return {
      text,
      excerpt: undefined,
    };
  }
  const targetWord = words[Math.max(0, words.length - textInputExcerptTargetWords)];
  const targetStart = targetWord?.index ?? 0;
  let startIndex = textAfterSentenceBoundary(text, targetStart);
  let excerpt = text.slice(startIndex).trimStart();
  if (countWords(excerpt) > textInputExcerptMaxWords) {
    startIndex = targetStart;
    excerpt = text.slice(startIndex).trimStart();
  }
  const shownWords = countWords(excerpt);
  return {
    text: [
      `[Text Input excerpt: showing the last ${shownWords} of ${words.length} words.]`,
      excerpt,
    ].join('\n\n'),
    excerpt: {
      kind: 'last-text-input-words' as const,
      shownWords,
      totalWords: words.length,
      targetWords: textInputExcerptTargetWords,
    },
  };
}

function shouldExcerptTextInput(label: string) {
  return label.trim().toLocaleLowerCase() === 'text input';
}

function tracePromptPart(part: {
  text: string;
  actionInserted?: boolean;
  stepOutputInserted?: string;
}) {
  const text = traceText(part.text);
  return text
    ? {
        text,
        actionInserted: part.actionInserted || undefined,
        stepOutputInserted: traceText(part.stepOutputInserted ?? '') || undefined,
        historySegments: 'historySegments' in part && Array.isArray(part.historySegments)
          ? part.historySegments
          : undefined,
      }
    : undefined;
}

function tracePromptSections(
  sections: Array<{
    label: string;
    text: string;
    parts?: Array<{
      text: string;
      actionInserted?: boolean;
      stepOutputInserted?: string;
      historySegments?: FormattedChatHistorySegment[];
    }>;
    historySegments?: FormattedChatHistorySegment[];
  }> | undefined,
) {
  return sections?.flatMap((section): TurnTracePromptSection[] => {
    const label = traceText(section.label) || 'Prompt Section';
    const rawText = traceText(section.text);
    const inputExcerpt = shouldExcerptTextInput(label) ? textInputExcerpt(rawText) : undefined;
    const text = inputExcerpt?.text ?? rawText;
    const parts = inputExcerpt?.excerpt
      ? [{ text }]
      : section.parts?.flatMap((part) => {
          const normalized = tracePromptPart(part);
          return normalized ? [normalized] : [];
        });
    if (!text && !parts?.length) {
      return [];
    }
    return [{
      label,
      text,
      parts: parts?.length ? parts : undefined,
      historySegments: section.historySegments?.length ? section.historySegments : undefined,
      excerpt: inputExcerpt?.excerpt,
    }];
  });
}

function promptFromSections(sections: TurnTracePromptSection[] | undefined) {
  return sections
    ?.map((section) => section.text)
    .filter(Boolean)
    .join('\n\n') ?? '';
}

function tracePromptPasses(
  passes: Array<{
    label: string;
    prompt?: string;
    images?: TurnTracePromptPass['images'];
    sections?: Array<{
      label: string;
      text: string;
      parts?: Array<{
        text: string;
        actionInserted?: boolean;
        stepOutputInserted?: string;
        historySegments?: FormattedChatHistorySegment[];
      }>;
      historySegments?: FormattedChatHistorySegment[];
    }>;
  }> | undefined,
) {
  let textInputIncluded = false;
  return passes?.flatMap((pass): TurnTracePromptPass[] => {
    const sections = tracePromptSections(pass.sections)?.filter((section) => {
      if (!shouldExcerptTextInput(section.label)) {
        return true;
      }
      if (textInputIncluded) {
        return false;
      }
      textInputIncluded = true;
      return true;
    });
    const prompt = sections?.length ? promptFromSections(sections) : traceText(pass.prompt ?? '');
    if (!prompt && !sections?.length) {
      return [];
    }
    return [{
      label: traceText(pass.label) || 'Prompt',
      prompt: sections?.length ? undefined : prompt,
      images: pass.images?.map((image) => ({
        index: image.index,
        id: image.id,
        name: image.name,
        source: image.source,
      })),
      sections: sections?.length ? sections : undefined,
    }];
  });
}

function traceOutputPasses(passes: Array<{ label: string; text: string }> | undefined) {
  return passes?.flatMap((pass): Array<{ label: string; text: string }> => {
    const text = traceText(pass.text);
    return text
      ? [{
          label: traceText(pass.label) || 'Output',
          text,
        }]
      : [];
  });
}

function traceMessages(messages: MessageRecord[]) {
  return messages.flatMap((message): TurnTraceMessage[] => {
    if (message.includeInHistory === false) {
      return [];
    }
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
    }];
  });
}

function traceChannel(turn: TurnRecord) {
  const messages = [...turn.input.messages, ...turn.output.messages];
  if (messages.some((message) => message.channel === 'phone' || message.phoneMessage)) {
    return 'phone' as const;
  }
  if (messages.some((message) => message.eventInput)) {
    return 'event' as const;
  }
  if (turn.directAction) {
    return 'output-actions' as const;
  }
  if (turn.messageFormat === socialMediaMessageFormat) {
    return 'social-media' as const;
  }
  if (turn.messageFormat === autoplayMessageFormat) {
    return 'autoplay' as const;
  }
  if (turn.mode === 'narrator') {
    return 'narrator' as const;
  }
  return 'rp' as const;
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
  turn,
  run,
  nodes,
  status,
  warnings = [],
  traceEvents = [],
  error,
  completedAt = new Date().toISOString(),
}: {
  turn: TurnRecord;
  run: TraceRunReport;
  nodes: WorkflowNode[];
  status: TurnTrace['status'];
  warnings?: string[];
  traceEvents?: TurnTraceEvent[];
  error?: string;
  completedAt?: string;
}): TurnTrace {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const promptPreviewIncluded = new Set<string>();
  const inputMessages = traceMessages(turn.input.messages);
  const outputMessages = traceMessages(turn.output.messages);
  const normalizedWarnings = warnings
    .map(traceText)
    .filter((warning, index, values) => warning && values.indexOf(warning) === index);
  const normalizedEvents = traceEvents.flatMap((event): TurnTraceEvent[] => {
    if (event.kind === 'warning') {
      const message = traceText(event.message);
      return message ? [{ ...event, message }] : [];
    }
    const name = traceText(event.name);
    if (!name) {
      return [];
    }
    return [{
      ...event,
      name,
      detail: previewText(event.detail),
      preview: previewText(event.preview),
    }];
  });
  const eventsByNodeId = new Map<string, TurnTraceEvent[]>();
  normalizedEvents.forEach((event) => {
    if (!event.nodeId) {
      return;
    }
    eventsByNodeId.set(event.nodeId, [...(eventsByNodeId.get(event.nodeId) ?? []), event]);
  });
  const stepEvents = (nodeId: string | undefined) => {
    if (!nodeId) {
      return [];
    }
    const events = eventsByNodeId.get(nodeId) ?? [];
    eventsByNodeId.delete(nodeId);
    return events;
  };
  const stepFieldsForEvents = (events: TurnTraceEvent[]) => {
    const stepWarnings = events.flatMap((event) =>
      event.kind === 'warning' ? [event.message] : [],
    );
    const formatResults = events.flatMap((event) =>
      event.kind === 'format'
        ? [{
            name: event.name,
            status: event.status,
            detail: event.detail,
            preview: event.preview,
          }]
        : [],
    );
    return {
      warnings: stepWarnings.length ? Array.from(new Set(stepWarnings)) : undefined,
      formatResults: formatResults.length ? formatResults : undefined,
    };
  };
  const callOccurrencesByNodeId = new Map<string, number>();
  const baseSteps = [...run.calls]
    .sort((left, right) => left.order - right.order)
    .map((call) => {
      const node = nodesById.get(call.nodeId);
      const debug = promptDebugForNode(node);
      const occurrenceIndex = callOccurrencesByNodeId.get(call.nodeId) ?? 0;
      callOccurrencesByNodeId.set(call.nodeId, occurrenceIndex + 1);
      const allPromptPasses = tracePromptPasses(debug?.promptPasses);
      const allOutputPasses = traceOutputPasses(debug?.outputPasses);
      const promptPasses = allPromptPasses?.[occurrenceIndex]
        ? [allPromptPasses[occurrenceIndex]]
        : occurrenceIndex === 0 && !allPromptPasses?.length && debug?.combinedPrompt
          ? [{
              label: 'Prompt',
              prompt: traceText(debug.combinedPrompt),
            }]
          : undefined;
      const outputPasses = allOutputPasses?.[occurrenceIndex] ? [allOutputPasses[occurrenceIndex]] : undefined;
      const includeStaticPromptText = !!debug && !promptPreviewIncluded.has(call.nodeId);
      if (includeStaticPromptText) {
        promptPreviewIncluded.add(call.nodeId);
      }
      const includePromptDebug = !!debug && (includeStaticPromptText || !!promptPasses?.length || !!outputPasses?.length);
      const switchDebug =
        node && node.data.kind === undefined && node.data.nodeType === 'llm-prompt-switch'
          ? node.data.llmPromptSwitchDebug
          : undefined;
      return {
        order: call.order,
        nodeId: call.nodeId,
        nodeLabel: call.nodeLabel,
        nodeType: node?.data.nodeType,
        prompt: call.label,
        selectedOutputChannel: switchDebug?.selectedOutputChannel,
        selectedPromptSlot: switchDebug?.selectedPromptSlot,
        promptBefore: includeStaticPromptText
          ? traceText(debug?.promptBefore ?? '') || undefined
          : undefined,
        promptAfter: includeStaticPromptText
          ? traceText(debug?.promptAfter ?? '') || undefined
          : undefined,
        promptPasses: includePromptDebug && promptPasses?.length ? promptPasses : undefined,
        outputPasses: includePromptDebug && outputPasses?.length ? outputPasses : undefined,
        actionResults: includeStaticPromptText
          ? debug?.actionResults?.map(traceText).filter(Boolean)
          : undefined,
        generatedText: includeStaticPromptText
          ? traceText(debug?.generatedText ?? '') || undefined
          : undefined,
        ...stepFieldsForEvents(stepEvents(call.nodeId)),
      };
    });
  const syntheticSteps = Array.from(eventsByNodeId.values()).map((events, index) => {
    const first = events[0];
    const format = events.find((event) => event.kind === 'format');
    return {
      order: baseSteps.length + index + 1,
      nodeId: first?.nodeId ?? `trace-event-${index}`,
      nodeLabel: first?.nodeLabel ?? 'Trace Event',
      nodeType: first?.nodeType,
      prompt: format?.kind === 'format' ? format.name : 'Trace event',
      ...stepFieldsForEvents(events),
    };
  });
  return {
    traceId: run.runId,
    turnId: turn.id,
    turnNumber: turn.number,
    startedAt: run.startedAt,
    completedAt,
    status,
    mode: turn.mode,
    channel: traceChannel(turn),
    input: {
      messages: inputMessages,
      graphText: inputMessages.length === 0 ? previewText(turn.input.graphText) : undefined,
    },
    steps: [...baseSteps, ...syntheticSteps],
    output: {
      messages: outputMessages,
      graphText: outputMessages.length === 0 ? previewText(turn.output.graphText) : undefined,
    },
    warnings: normalizedWarnings.length ? normalizedWarnings : undefined,
    error: status === 'error' ? traceText(error ?? 'Unknown run error') : undefined,
  };
}

export function turnTraceCopyPayload(traces: TurnTrace[]): TurnTraceCopyPayload {
  const ordered = [...traces].sort(
    (left, right) =>
      left.turnNumber - right.turnNumber ||
      left.startedAt.localeCompare(right.startedAt),
  );
  return {
    schema: 'rpgraph-turn-trace',
    version: 5,
    createdAt: new Date().toISOString(),
    privacy: 'memory-only',
    range: {
      fromTurn: ordered[0]?.turnNumber ?? 0,
      toTurn: ordered[ordered.length - 1]?.turnNumber ?? 0,
      traceCount: ordered.length,
    },
    traces: ordered,
  };
}
