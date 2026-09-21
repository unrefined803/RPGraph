import type { StorybookCharacter } from '../storybook/runtime';
import { socialDirectMessageDisplayText } from '../chat/socialMedia';
import type {
  MessageRecord,
  RpDateTimeFormat,
  RpWeekdayLanguage,
} from '../types';
import { formatChatHistory } from '../workflow/textHelpers';

export type HistoryOutputs = {
  rawHistory: string;
  originalHistory: string;
  translatedHistory: string;
  lastTurnsHistory: string;
};

export type HistoryViewOptions = {
  messages: MessageRecord[];
  characters?: StorybookCharacter[];
  fallbackOriginalHistory: string;
  fallbackTranslatedHistory: string;
  lastTurnsCount: number;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
};

export function normalizeLocalDateTime(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute] = match;
  const parsed = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  ));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute)
  ) {
    return undefined;
  }
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function currentLocalDateTime() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  ].join('T');
}

export function formatHistoryMessageForAnalysis(message: MessageRecord, characters: StorybookCharacter[] = []) {
  return {
    messageId: message.id,
    turn: message.turnNumber,
    part: message.turnPart,
    role: message.role,
    channel: message.channel ?? 'rp',
    from: message.phoneFrom ?? message.speakerName,
    to: message.phoneTo,
    text: socialDirectMessageDisplayText(message, false, characters, true),
    rpDateTime: message.rpDateTime,
  };
}

export function boundedHistoryLastTurnsCount(value: number | undefined) {
  return Math.min(100, Math.max(1, Math.round(value ?? 5)));
}

function historyMessagesForPrompt(messages: MessageRecord[]) {
  return messages.filter(
    (message) =>
      message.includeInHistory !== false &&
      (message.role === 'user' || message.role === 'output'),
  );
}

export function lastTurnMessages(messages: MessageRecord[], count: number) {
  const included = historyMessagesForPrompt(messages);
  const turnKeys: string[] = [];
  included.forEach((message) => {
    const key =
      typeof message.turnNumber === 'number' && Number.isFinite(message.turnNumber)
        ? `number:${message.turnNumber}`
        : message.turnId
          ? `id:${message.turnId}`
          : undefined;
    if (key && !turnKeys.includes(key)) {
      turnKeys.push(key);
    }
  });
  if (turnKeys.length === 0) {
    return included.slice(-count * 2);
  }
  const selectedTurns = new Set(turnKeys.slice(-count));
  return included.filter((message) => {
    const key =
      typeof message.turnNumber === 'number' && Number.isFinite(message.turnNumber)
        ? `number:${message.turnNumber}`
        : message.turnId
          ? `id:${message.turnId}`
          : undefined;
    return key ? selectedTurns.has(key) : false;
  });
}

export function buildHistoryOutputs({
  messages,
  characters,
  fallbackOriginalHistory,
  fallbackTranslatedHistory,
  lastTurnsCount,
  rpDateTimeFormat,
  rpWeekdayLanguage,
}: HistoryViewOptions): HistoryOutputs {
  const hasStructuredHistory = messages.length > 0;
  const originalSessionHistory = hasStructuredHistory
    ? formatChatHistory(
        messages,
        false,
        rpDateTimeFormat,
        rpWeekdayLanguage,
        messages, characters,
      )
    : fallbackOriginalHistory;
  const translatedSessionHistory = hasStructuredHistory
    ? formatChatHistory(
        messages,
        true,
        rpDateTimeFormat,
        rpWeekdayLanguage,
        messages, characters,
      )
    : fallbackTranslatedHistory;
  const recentMessages = hasStructuredHistory
    ? lastTurnMessages(messages, lastTurnsCount)
    : [];
  return {
    rawHistory: hasStructuredHistory
      ? JSON.stringify(messages, null, 2)
      : fallbackOriginalHistory,
    originalHistory: originalSessionHistory,
    translatedHistory: translatedSessionHistory,
    lastTurnsHistory: hasStructuredHistory
      ? formatChatHistory(
          recentMessages,
          false,
          rpDateTimeFormat,
          rpWeekdayLanguage,
          messages, characters,
        )
      : fallbackOriginalHistory,
  };
}
