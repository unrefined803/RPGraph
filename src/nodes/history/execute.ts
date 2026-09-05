import type { WorkflowNode } from '../../types';
import { formatChatHistory } from '../../workflow';
import {
  boundedHistoryLastTurnsCount,
  buildHistoryOutputs,
  currentLocalDateTime,
  formatHistoryMessageForAnalysis,
  normalizeLocalDateTime,
  type HistoryOutputs,
} from '../../data-management/historyStore';
import type { ExecuteContext } from '../types';
import { historyMemo } from '../runScratch';
import { buildHistoryRpTimePrompt } from './rpTimePrompt';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function salvageRpTimeResponse(text: string): Record<string, unknown> | undefined {
  const currentTimeMatch = text.match(/"t"\s*:\s*"?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  if (!currentTimeMatch) {
    return undefined;
  }
  const messageTimes = [...text.matchAll(/\[\s*(\d+)\s*,\s*"?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/g)]
    .map((match) => [Number(match[1]), match[2]] as [number, string]);
  return { t: currentTimeMatch[1], m: messageTimes };
}

function parseResponse(text: string, label = 'Chat History LLM') {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  const candidates = Array.from(new Set([
    withoutFence,
    firstBrace >= 0 && lastBrace > firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : '',
  ].filter(Boolean)));
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!isRecord(parsed)) {
        throw new Error('response is not an object');
      }
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  // Local models occasionally emit near-valid JSON (e.g. a missing closing
  // quote); the expected shape is rigid enough to recover by pattern.
  const salvaged = salvageRpTimeResponse(withoutFence);
  if (salvaged) {
    return salvaged;
  }
  const responsePreview = trimmed
    .replace(/\s+/g, ' ')
    .slice(0, 280);
  throw new Error(
    [
      `${label} returned invalid JSON: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      'Expected exactly one object like {"t":"YYYY-MM-DDTHH:mm","m":[[123,"YYYY-MM-DDTHH:mm"]]}.',
      `Model response preview: ${responsePreview || '(empty)'}`,
    ].join(' '),
  );
}

function outputForHandle(outputs: HistoryOutputs, sourceHandle?: string | null) {
  if (sourceHandle === 'translated') {
    return outputs.translatedHistory;
  }
  if (sourceHandle === 'last-turns') {
    return outputs.lastTurnsHistory;
  }
  return outputs.originalHistory;
}

function historyLastTurnsCount(node: WorkflowNode) {
  return boundedHistoryLastTurnsCount(node.data.historyLastTurnsCount);
}

function dateWithWeekday(date: string) {
  const weekday = new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday: 'long' });
  return `${date} (${weekday})`;
}

function currentOutputs(node: WorkflowNode, context: ExecuteContext): HistoryOutputs {
  return buildHistoryOutputs({
    messages: context.historyMessages,
    fallbackOriginalHistory: context.originalHistory,
    fallbackTranslatedHistory: context.translatedHistory,
    lastTurnsCount: historyLastTurnsCount(node),
    rpDateTimeFormat: context.rpDateTimeFormat,
    rpWeekdayLanguage: context.rpWeekdayLanguage,
  });
}

async function executeHistoryOutputs(node: WorkflowNode, context: ExecuteContext): Promise<HistoryOutputs> {
  let outputs = currentOutputs(node, context);
  const timeTrackingEnabled = node.data.historyTimeTrackingEnabled ?? false;
  if (context.phase !== 'prepare-next-turn') {
    context.updateRuntimeData(node.id, {
      preview: outputs.originalHistory ? 'Conversation provided' : 'No conversation yet',
      rawHistory: outputs.rawHistory,
      originalHistory: outputs.originalHistory,
      translatedHistory: outputs.translatedHistory,
      lastTurnsHistory: outputs.lastTurnsHistory,
      historyTimeStatus: timeTrackingEnabled ? node.data.historyTimeStatus : 'RP Time: Disabled',
    });
    return outputs;
  }

  const currentTurnId = context.currentTurnId;
  if (!currentTurnId) {
    throw new Error('Chat History RP Time needs the current turn id.');
  }
  const configuredPreviousDateTime = normalizeLocalDateTime(node.data.historyCurrentRpDateTime);
  const automaticStartDateTime = currentLocalDateTime();
  const usesAutomaticStart = !configuredPreviousDateTime;
  const previousDateTime =
    configuredPreviousDateTime ?? `${automaticStartDateTime.slice(0, 10)}T00:00`;
  const currentTurnMessages = context.historyMessages.filter(
    (message) =>
      message.turnId === currentTurnId &&
      message.includeInHistory !== false &&
      (message.role === 'user' || message.role === 'output'),
  );
  const previousMessages = context.recentTurns.flatMap(
    (turn) => [...turn.input.messages, ...turn.output.messages],
  );
  const pendingMessages = [...previousMessages, ...currentTurnMessages].filter(
    (message) =>
      message.includeInHistory !== false &&
      (message.role === 'user' || message.role === 'output') &&
      !message.eventInput &&
      !message.rpDateTime,
  );
  let currentDateTime = configuredPreviousDateTime ?? previousDateTime;
  const processedTurnIds = node.data.historyProcessedTurnIds ?? [];

  const nextProcessedTurnIds = processedTurnIds.includes(currentTurnId)
    ? processedTurnIds
    : [...processedTurnIds, currentTurnId];
  // Also run for already-processed turns while unstamped messages exist:
  // phone auto-turns execute twice with the same turn id, and regenerated
  // outputs arrive after the turn was first marked processed.
  if (timeTrackingEnabled && (pendingMessages.length > 0 || !processedTurnIds.includes(currentTurnId))) {
    if (pendingMessages.length === 0) {
      context.updateRuntimeData(node.id, {
        historyProcessedTurnIds: nextProcessedTurnIds,
        historyTimeStatus: `RP Time prepared: ${previousDateTime}`,
      });
    } else {
      const fallbackDate = automaticStartDateTime.slice(0, 10);
      // The opening counts as one of the five context slots: once five full
      // turns of history exist, it no longer adds date clues worth its tokens.
      const openingSituationText = context.recentTurns.length < 5
        ? context.historyMessages
            .filter(
              (message) =>
                message.isOpening &&
                !message.turnId &&
                message.includeInHistory !== false &&
                message.originalText.trim(),
            )
            .map((message) => message.originalText.trim())
            .join('\n\n')
        : '';
      const prompt = buildHistoryRpTimePrompt(node.data.historyRpTimePrompt, {
        PreviousRpTimeOrNone: usesAutomaticStart ? '(none)' : previousDateTime,
        FallbackDate: dateWithWeekday(fallbackDate),
        OpeningSituation: openingSituationText || '(none)',
        PreviousFiveTurns: formatChatHistory(previousMessages, false, 'iso', 'en-US') || '(none)',
        NewTurnJson: JSON.stringify(currentTurnMessages.map(formatHistoryMessageForAnalysis)),
        PendingMessagesJson: JSON.stringify(pendingMessages.map(formatHistoryMessageForAnalysis)),
        StartModeInstructions: usesAutomaticStart
          ? [
              'First pass: establish the initial fictional RP date and time from the OPENING SITUATION and the NEW TURN.',
              'Date, weekday, season, and time-of-day clues in the OPENING SITUATION take priority over FALLBACK DATE.',
              'If the user explicitly states a date or time, use it.',
              'If the scene states or implies a weekday, season, or holiday that does not match FALLBACK DATE, pick the nearest date, past or future, whose weekday and season match the scene instead of FALLBACK DATE.',
              'Only if no date, weekday, or season is stated or strongly implied, use FALLBACK DATE as the date.',
              'Do not use the wall-clock time as fallback for the hour/minute.',
            ].join('\n')
          : [
              'Infer elapsed time conservatively from the NEW TURN.',
              'Never move time backwards.',
            ].join('\n'),
        ReferenceTimeLabel: usesAutomaticStart ? 'FALLBACK DATE' : 'PREVIOUS CURRENT RP TIME',
        ReferenceTime: usesAutomaticStart ? dateWithWeekday(fallbackDate) : previousDateTime,
      });
      let lastResponseText = '';
      const attemptRpTime = async (attempt: number) => {
        lastResponseText = '';
        context.updateRuntimeData(node.id, { historyLastPrompt: prompt, historyLastResponse: '' });
        const completion = await context.llm.complete({
          connectionId: node.data.connectionId,
          nodeId: node.id,
          label: 'RP Time',
          prompt,
          fastTask: true,
          contributesToTokenCalibration: true,
          // A retry at the same near-zero temperature tends to reproduce the
          // identical malformed response; add variation on the second try.
          temperature: attempt > 1 ? 0.5 : 0.1,
        });
        lastResponseText = completion.text;
        context.updateRuntimeData(node.id, {
          historyLastPrompt: prompt,
          historyLastResponse: completion.text,
        });
        const response = parseResponse(completion.text, 'Chat History RP Time');
        const nextCurrentDateTime = normalizeLocalDateTime(response.t ?? response.currentDateTime);
        if (!nextCurrentDateTime || (!usesAutomaticStart && nextCurrentDateTime < previousDateTime)) {
          throw new Error('Chat History RP Time returned an invalid or backwards currentDateTime.');
        }
        return { completion, response, nextCurrentDateTime };
      };
      const maxAttempts = context.retryFormatErrorsEnabled ? 2 : 1;
      let attemptResult!: Awaited<ReturnType<typeof attemptRpTime>>;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          attemptResult = await attemptRpTime(attempt);
          context.reportFormatResult({
            name: 'RP Time JSON',
            status: 'ok',
            detail: attempt > 1
              ? 'RP Time response parsed after retry.'
              : 'RP Time response parsed.',
          });
          break;
        } catch (error) {
          if (attempt < maxAttempts) {
            continue;
          }
          context.reportFormatResult({
            name: 'RP Time JSON',
            status: 'error',
            detail: error instanceof Error ? error.message : String(error),
            preview: lastResponseText,
          });
          throw error;
        }
      }
      const { completion, response } = attemptResult;
      currentDateTime = attemptResult.nextCurrentDateTime;
      const messageTimes = Array.isArray(response.m)
        ? response.m
        : Array.isArray(response.messageTimes)
          ? response.messageTimes
          : [];
      const timeByMessageId = new Map<number, string>();
      messageTimes.forEach((entry) => {
        const messageId = Array.isArray(entry) ? entry[0] : isRecord(entry) ? entry.messageId : undefined;
        const value = Array.isArray(entry) ? entry[1] : isRecord(entry) ? entry.at : undefined;
        if (typeof messageId === 'number') {
          const at = normalizeLocalDateTime(value);
          if (at) {
            timeByMessageId.set(messageId, at);
          }
        }
      });
      let latestMessageTime = usesAutomaticStart ? '' : previousDateTime;
      const patches = pendingMessages.map((message) => {
        let rpDateTime = timeByMessageId.get(message.id) ?? currentDateTime;
        if (rpDateTime < latestMessageTime) {
          rpDateTime = latestMessageTime;
        }
        if (rpDateTime > currentDateTime) {
          rpDateTime = currentDateTime;
        }
        latestMessageTime = rpDateTime;
        return { id: message.id, rpDateTime };
      });
      const patchedMessages = context.historyMessages.map((message) => {
        const patch = patches.find((entry) => entry.id === message.id);
        return patch ? { ...message, rpDateTime: patch.rpDateTime } : message;
      });
      outputs = buildHistoryOutputs({
        messages: patchedMessages,
        fallbackOriginalHistory: context.originalHistory,
        fallbackTranslatedHistory: context.translatedHistory,
        lastTurnsCount: historyLastTurnsCount(node),
        rpDateTimeFormat: context.rpDateTimeFormat,
        rpWeekdayLanguage: context.rpWeekdayLanguage,
      });
      context.updateHistoryMessageTimes(patches);
      context.updateRuntimeData(node.id, {
        preview: 'Conversation and RP time prepared',
        rawHistory: outputs.rawHistory,
        originalHistory: outputs.originalHistory,
        translatedHistory: outputs.translatedHistory,
        lastTurnsHistory: outputs.lastTurnsHistory,
        historyCurrentRpDateTime: currentDateTime,
        historyProcessedTurnIds: nextProcessedTurnIds,
        historyTimeStatus: `RP Time prepared: ${currentDateTime}`,
        historyLastPrompt: prompt,
        historyLastResponse: completion.text,
      });
    }
  }

  return outputs;
}

export async function executeHistoryNode(node: WorkflowNode, context: ExecuteContext) {
  const memo = historyMemo(context);
  let outputs = memo.get(node.id);
  if (!outputs) {
    outputs = executeHistoryOutputs(node, context);
    memo.set(node.id, outputs);
  }
  return outputForHandle(await outputs, context.sourceHandle);
}
