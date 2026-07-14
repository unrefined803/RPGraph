import type {
  ChatDialogueQuote,
  MessageRecord,
  RpAppointment,
  RpDateTimeFormat,
  RpWeekdayLanguage,
} from '../types';
import {
  defaultContextCompressionLengthWords,
  defaultContextCompressionRatio,
  defaultContextCompressionTokenLimit,
  defaultEstimatedTokenBytesPerToken,
  fixedTokenEstimateReservePercent,
} from './defaults';
import { TextMetricsApi, validTokenBytesPerToken } from '../llm/tokenMetrics';
import { formatPhoneReplyInput } from '../chat/phoneReplies';
import {
  createdPhoneNoteHistoryText,
  simulatedAiChatHistoryText,
} from '../chat/phoneAppsSessions';
import { rpPictureGalleryId } from '../chat/rpPictures';

function withPhoneAppCommandHistory(text: string, message: MessageRecord) {
  const trimmedText = text.trim();
  return [
    trimmedText,
    message.createdPhoneNote
      ? createdPhoneNoteHistoryText(message.createdPhoneNote)
      : '',
    message.simulatedAiChat
      ? simulatedAiChatHistoryText(message.simulatedAiChat)
      : '',
  ].filter((entry, index) =>
    !!entry && (index === 0 || !trimmedText.includes(entry.trim()))
  ).join('\n\n');
}

export function validEstimatedTokenBytesPerToken(value?: number) {
  return validTokenBytesPerToken(value);
}

export function textStats(text: string, bytesPerEstimatedToken = defaultEstimatedTokenBytesPerToken) {
  return new TextMetricsApi(bytesPerEstimatedToken, fixedTokenEstimateReservePercent).measure(text);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function speakerLabelPattern(name: string) {
  return `(?:\\*\\*\\s*${name}\\s*(?::\\s*\\*\\*|\\*\\*\\s*(?::|(?=["“])))|${name}\\s*(?::|(?=["“])))`;
}

export function stripRecognizedSpeakerLabels(text: string, speakerNames: string[]) {
  return speakerNames.reduce((visibleText, speakerName) => {
    const name = escapeRegExp(speakerName);
    return visibleText.replace(
      new RegExp(
        `(^|\\n)(\\s*(?:[-*]\\s+)?)(?:${speakerLabelPattern(name)})\\s*`,
        'gi',
      ),
      '$1$2',
    );
  }, text);
}

function includeImageContext(text: string, imageDescription?: string, imageName?: string) {
  if (!imageDescription) {
    return text;
  }
  const imageLabel = rpPictureGalleryId(imageName) ?? (imageName?.trim() || 'Image');
  const imageContext = `[${imageLabel}: ${imageDescription}]`;
  const speakerPrefix = text.match(/^([^:\n]+:\s*)([\s\S]*)$/);
  return speakerPrefix
    ? `${speakerPrefix[1]}${imageContext} ${speakerPrefix[2]}`
    : `${imageContext} ${text}`;
}

function phoneImageIds(message: MessageRecord) {
  const explicitIds = message.phoneImageIds
    ?.map((imageId) => imageId.trim())
    .filter(Boolean);
  if (explicitIds?.length) {
    return explicitIds;
  }
  const attachmentIds = message.imageAttachments
    ?.map((image) => image.id.trim())
    .filter(Boolean);
  return attachmentIds?.length ? attachmentIds : [];
}

function phoneImageDescription(message: MessageRecord) {
  return (
    message.phoneImageDescription?.trim() ||
    message.imageAttachments
      ?.map((image) => image.description?.trim())
      .find(Boolean) ||
    ''
  );
}

function phoneImageContext(message: MessageRecord) {
  const description = phoneImageDescription(message);
  const imageIds = phoneImageIds(message);
  if (imageIds.length) {
    const imageLabel = imageIds.join(', ');
    return `[${description ? `${imageLabel}: ${description}` : imageLabel}] `;
  }
  return description ? `[Image: ${description}] ` : '';
}

function phoneMessagePrefix(message: MessageRecord, from: string, to: string) {
  const imageCount = phoneImageIds(message).length;
  if (imageCount > 1) {
    return `${from} sends images to ${to}:`;
  }
  return imageCount === 1
    ? `${from} sends an image to ${to}:`
    : `${from} texts ${to}:`;
}

function formatMessageRecordForContext(
  message: MessageRecord,
  translated: boolean,
  rpDateTimeFormat?: RpDateTimeFormat,
  rpWeekdayLanguage?: RpWeekdayLanguage,
  includeRpDateTime = true,
  linkedPhoneMessages = new Map<number, MessageRecord>(),
) {
  const withOptionalRpDateTime = (text: string) =>
    includeRpDateTime
      ? withRpDateTime(text, message.rpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
      : text;
  const phoneMessageText = (phoneMessage: NonNullable<MessageRecord['embeddedPhoneMessages']>[number]) => {
    const linkedMessage = linkedPhoneMessages.get(phoneMessage.phoneMessageId);
    const text = translated
      ? linkedMessage?.translatedText ?? phoneMessage.message
      : linkedMessage?.originalText ?? phoneMessage.message;
    const fallbackMessage: MessageRecord = {
      id: phoneMessage.phoneMessageId,
      role: 'output',
      originalText: phoneMessage.message,
      channel: 'phone',
      phoneFrom: phoneMessage.from,
      phoneTo: phoneMessage.to,
    };
    const contextMessage = linkedMessage ?? fallbackMessage;
    const replyTo = contextMessage.replyToMessageId !== undefined
      ? linkedPhoneMessages.get(contextMessage.replyToMessageId)
      : undefined;
    const formatted = replyTo
      ? formatPhoneReplyInput(phoneMessage.from, replyTo, text, translated)
      : `${phoneMessagePrefix(contextMessage, phoneMessage.from, phoneMessage.to)} ${phoneImageContext(contextMessage)}${text}`;
    return includeRpDateTime
      ? withRpDateTime(
          formatted,
          linkedMessage?.rpDateTime,
          rpDateTimeFormat,
          rpWeekdayLanguage,
        )
      : formatted;
  };

  if (message.channel === 'phone') {
    const from = message.phoneFrom || message.speakerName || 'Unknown';
    const to = message.phoneTo || 'Unknown';
    const text = translated
      ? message.translatedText ?? message.originalText
      : message.originalText;
    const replyTo = message.replyToMessageId !== undefined
      ? linkedPhoneMessages.get(message.replyToMessageId)
      : undefined;
    if (replyTo) {
      return withPhoneAppCommandHistory(
        withOptionalRpDateTime(formatPhoneReplyInput(from, replyTo, text, translated)),
        message,
      );
    }
    return withPhoneAppCommandHistory(
      withOptionalRpDateTime(`${phoneMessagePrefix(message, from, to)} ${phoneImageContext(message)}${text}`),
      message,
    );
  }
  if (message.eventInput && message.eventDisplayText) {
    return withOptionalRpDateTime(message.eventDisplayText.replace(/^Event:\s*/i, '').trim());
  }
  if (message.embeddedPhoneMessages?.length) {
    const knownOutputSpeakers = [
      ...(message.speakerNames ?? []),
      ...(message.speakerName ? [message.speakerName] : []),
      'User',
      'Assistant',
    ];
    const formatRpText = (text: string) => {
      const contextText =
        knownOutputSpeakers.length > 0
          ? stripRecognizedSpeakerLabels(text, knownOutputSpeakers)
          : text;
      return includeImageContext(contextText, message.rpImageDescription, message.rpImageName);
    };
    const hasCompositeText =
      message.embeddedPhoneTextBefore !== undefined ||
      message.embeddedPhoneTextAfter !== undefined ||
      message.embeddedPhoneTranslatedTextBefore !== undefined ||
      message.embeddedPhoneTranslatedTextAfter !== undefined;
    const sourceTextBefore = translated
      ? message.embeddedPhoneTranslatedTextBefore ??
        message.embeddedPhoneTextBefore ??
        (!hasCompositeText ? message.translatedText ?? message.originalText : undefined)
      : message.embeddedPhoneTextBefore ?? (!hasCompositeText ? message.originalText : undefined);
    const sourceTextAfter = translated
      ? message.embeddedPhoneTranslatedTextAfter ?? message.embeddedPhoneTextAfter
      : message.embeddedPhoneTextAfter;
    const textBefore = sourceTextBefore?.trim()
      ? formatRpText(sourceTextBefore)
      : '';
    const textAfter = sourceTextAfter?.trim()
      ? formatRpText(sourceTextAfter)
      : '';
    const parts = [
      textBefore && withOptionalRpDateTime(textBefore),
      ...message.embeddedPhoneMessages.map(phoneMessageText),
      textAfter,
    ].filter((part): part is string => !!part.trim());
    return withPhoneAppCommandHistory(parts.join('\n\n'), message);
  }
  const text = translated
    ? message.translatedText ?? message.originalText
    : message.originalText;
  const knownOutputSpeakers = [
    ...(message.speakerNames ?? []),
    ...(message.speakerName ? [message.speakerName] : []),
    'User',
    'Assistant',
  ];
  const contextText =
    knownOutputSpeakers.length > 0
      ? stripRecognizedSpeakerLabels(text, knownOutputSpeakers)
      : text;
  const historyText = includeImageContext(contextText, message.rpImageDescription, message.rpImageName);
  return withPhoneAppCommandHistory(withOptionalRpDateTime(historyText), message);
}

export function formatLastMessageForContext(
  message: MessageRecord,
  translated = false,
  rpDateTimeFormat?: RpDateTimeFormat,
  rpWeekdayLanguage?: RpWeekdayLanguage,
  includeRpDateTime = false,
) {
  const text = translated
    ? message.translatedText ?? message.originalText
    : message.originalText;
  const withOptionalRpDateTime = (value: string) =>
    includeRpDateTime
      ? withRpDateTime(value, message.rpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
      : value;

  if (message.channel === 'phone') {
    return includeRpDateTime
      ? formatMessageRecordForContext(message, translated, rpDateTimeFormat, rpWeekdayLanguage, true)
      : formatMessageRecordForContext(message, translated, undefined, undefined, false);
  }
  return withPhoneAppCommandHistory(withOptionalRpDateTime(text), message);
}

function formatTwelveHour(hourText: string) {
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) {
    return { hour: hourText, period: 'AM' };
  }
  const period = hour >= 12 ? 'PM' : 'AM';
  const twelveHour = hour % 12 || 12;
  return { hour: String(twelveHour), period };
}

function normalizeWeekdayLabel(value: string) {
  return value.replace(/[.,]/g, '').trim().toLocaleUpperCase();
}

function weekdayLocale(language: RpWeekdayLanguage) {
  if (language === 'disabled') {
    return undefined;
  }
  if (language === 'system') {
    return undefined;
  }
  return language;
}

function dateTimeLocale(language: RpWeekdayLanguage) {
  return language === 'disabled' ? undefined : weekdayLocale(language);
}

function weekdayLabel(
  year: string,
  month: string,
  day: string,
  language: RpWeekdayLanguage,
) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  if (language === 'disabled') {
    return '';
  }
  return normalizeWeekdayLabel(
    new Intl.DateTimeFormat(weekdayLocale(language), {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(date),
  );
}

export function formatRpDateTimeParts(
  value?: string,
  format: RpDateTimeFormat = 'eu',
  weekdayLanguage: RpWeekdayLanguage = 'system',
) {
  if (!value) {
    return undefined;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute] = match;
  const weekday = weekdayLabel(year, month, day, weekdayLanguage);
  if (format === 'iso') {
    return { date: `${year}-${month}-${day} ${weekday}`.trim(), time: `${hour}:${minute}` };
  }
  if (format === 'us') {
    const twelveHour = formatTwelveHour(hour);
    return {
      date: `${month}/${day}/${year.slice(2)} ${weekday}`.trim(),
      time: `${twelveHour.hour}:${minute} ${twelveHour.period}`,
    };
  }
  return { date: `${day}.${month}.${year.slice(2)} ${weekday}`.trim(), time: `${hour}:${minute}` };
}

export function formatRpDateTime(
  value?: string,
  format: RpDateTimeFormat = 'eu',
  weekdayLanguage: RpWeekdayLanguage = 'system',
) {
  if (!value) {
    return '';
  }
  const parts = formatRpDateTimeParts(value, format, weekdayLanguage);
  return parts ? `${parts.date} ${parts.time}` : value;
}

export function formatRpDayLabel(
  value?: string,
  _format: RpDateTimeFormat = 'eu',
  weekdayLanguage: RpWeekdayLanguage = 'system',
) {
  if (!value) {
    return '';
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) {
    return '';
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(dateTimeLocale(weekdayLanguage), {
    weekday: weekdayLanguage === 'disabled' ? undefined : 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
    .format(date)
    .replace(/[,.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function withRpDateTime(
  text: string,
  rpDateTime?: string,
  rpDateTimeFormat?: RpDateTimeFormat,
  rpWeekdayLanguage?: RpWeekdayLanguage,
) {
  const formatted = formatRpDateTime(rpDateTime, rpDateTimeFormat, rpWeekdayLanguage);
  return formatted ? `[${formatted}] ${text}` : text;
}

function isAutoTurnHistoryMarker(message: MessageRecord) {
  return (
    message.role === 'user' &&
    message.speakerName === 'Narrator' &&
    message.channel === 'rp' &&
    /^.+? moves the story forward with an action, dialogue, or decision\.$/.test(message.originalText.trim())
  );
}

function isNarratorPhoneAutoTurnInstruction(message: MessageRecord) {
  return (
    message.role === 'user' &&
    message.phoneMessage &&
    message.speakerName === 'Narrator' &&
    /^This is a Narrator Phone AutoTurn\./.test(message.originalText.trim())
  );
}

function historyTextWithoutTimestamp(
  message: MessageRecord,
  translated: boolean,
  phoneMessagesById = new Map<number, MessageRecord>(),
  includePhoneAppCommands = true,
) {
  if (message.channel === 'phone') {
    return formatMessageRecordForContext(
      message,
      translated,
      undefined,
      undefined,
      false,
      phoneMessagesById,
    );
  }
  if (message.eventInput && message.eventDisplayText) {
    const eventText = message.eventDisplayText.replace(/^Event:\s*/i, '').trim();
    return includePhoneAppCommands
      ? withPhoneAppCommandHistory(eventText, message)
      : eventText;
  }
  const text = translated
    ? message.translatedText ?? message.originalText
    : message.originalText;
  const knownOutputSpeakers = [
    ...(message.speakerNames ?? []),
    ...(message.speakerName ? [message.speakerName] : []),
    'User',
    'Assistant',
  ];
  const contextText =
    knownOutputSpeakers.length > 0
      ? stripRecognizedSpeakerLabels(text, knownOutputSpeakers)
      : text;
  const historyText = includeImageContext(contextText, message.rpImageDescription, message.rpImageName);
  return includePhoneAppCommands
    ? withPhoneAppCommandHistory(historyText, message)
    : historyText;
}

export function formatAppointments(
  appointments: RpAppointment[] = [],
  rpDateTimeFormat?: RpDateTimeFormat,
  rpWeekdayLanguage?: RpWeekdayLanguage,
) {
  const upcoming = appointments.filter((appointment) => appointment.status === 'upcoming');
  if (upcoming.length === 0) {
    return '';
  }
  const compareAppointments = (left: RpAppointment, right: RpAppointment) => {
    if (left.scheduledAt && right.scheduledAt) {
      return left.scheduledAt.localeCompare(right.scheduledAt);
    }
    if (left.scheduledAt) {
      return -1;
    }
    if (right.scheduledAt) {
      return 1;
    }
    return (left.sourceTurnNumber ?? 0) - (right.sourceTurnNumber ?? 0) ||
      left.title.localeCompare(right.title);
  };
  return [
    'Upcoming events:',
    ...[...upcoming].sort(compareAppointments).map((appointment) => {
      const people = [
        appointment.requestedBy ? `requested by ${appointment.requestedBy}` : '',
        appointment.assignedTo ? `for ${appointment.assignedTo}` : '',
      ].filter(Boolean).join(', ');
      const source = appointment.sourceNote
        ? ` - ${appointment.sourceNote}`
        : appointment.sourceTurnNumber !== undefined
          ? ` - Turn ${appointment.sourceTurnNumber}`
          : '';
      const timing = appointment.scheduledAt
        ? `[${formatRpDateTime(appointment.scheduledAt, rpDateTimeFormat, rpWeekdayLanguage)}]`
        : appointment.condition
          ? `[${appointment.condition}]`
          : '[conditional]';
      const channel = appointment.channel === 'phone'
        ? ` [phone: ${appointment.phoneFrom ?? appointment.assignedTo ?? 'sender'} -> ${appointment.phoneTo ?? appointment.requestedBy ?? 'recipient'}]`
        : '';
      const details = appointment.details ? ` - ${appointment.details}` : '';
      return `- ${timing} ${appointment.title}${channel}${people ? ` (${people})` : ''}${details}${source}`;
    }),
  ].join('\n');
}

export function formatChatHistory(
  messages: MessageRecord[],
  translated: boolean,
  rpDateTimeFormat?: RpDateTimeFormat,
  rpWeekdayLanguage?: RpWeekdayLanguage,
  linkedMessages: MessageRecord[] = messages,
) {
  return formatChatHistorySegments(
    messages,
    translated,
    rpDateTimeFormat,
    rpWeekdayLanguage,
    linkedMessages,
  )
    .map((segment) => segment.text)
    .join('\n\n');
}

export type FormattedChatHistorySegment = {
  text: string;
  turnKey: string;
  turnIndex: number;
  messageIndex: number;
  role: MessageRecord['role'];
  channel: 'rp' | 'phone';
  speakerNames?: string[];
  speakerColors?: Record<string, string>;
  dialogue?: ChatDialogueQuote[];
};

function historySegmentTurnKey(message: MessageRecord) {
  if (typeof message.turnNumber === 'number' && Number.isFinite(message.turnNumber)) {
    return `number:${message.turnNumber}`;
  }
  if (message.turnId) {
    return `id:${message.turnId}`;
  }
  return `message:${message.id}`;
}

function normalizedDialogueText(text: string) {
  return text.trim().replace(/^["“„«»]+|["“”„«»]+$/g, '').trim().toLocaleLowerCase();
}

function dialogueMatchCount(text: string, dialogue: ChatDialogueQuote[] | undefined) {
  if (!dialogue?.length) {
    return 0;
  }
  const normalizedText = text.toLocaleLowerCase();
  return dialogue.filter((quote) => {
    const quotedText = quote.text.trim().toLocaleLowerCase();
    const unquotedText = normalizedDialogueText(quote.text);
    return (
      (!!quotedText && normalizedText.includes(quotedText)) ||
      (!!unquotedText && normalizedText.includes(unquotedText))
    );
  }).length;
}

function dialogueForFormattedText(
  text: string,
  message: MessageRecord,
  translated: boolean,
) {
  const primaryDialogue = translated ? message.translatedDialogue : message.originalDialogue;
  const fallbackDialogue = translated ? message.originalDialogue : message.translatedDialogue;
  if (!fallbackDialogue?.length) {
    return primaryDialogue;
  }
  if (!primaryDialogue?.length) {
    return fallbackDialogue;
  }
  const primaryMatches = dialogueMatchCount(text, primaryDialogue);
  const fallbackMatches = dialogueMatchCount(text, fallbackDialogue);
  return fallbackMatches > primaryMatches ? fallbackDialogue : primaryDialogue;
}

export function formatChatHistorySegments(
  messages: MessageRecord[],
  translated: boolean,
  rpDateTimeFormat?: RpDateTimeFormat,
  rpWeekdayLanguage?: RpWeekdayLanguage,
  linkedMessages: MessageRecord[] = messages,
): FormattedChatHistorySegment[] {
  const isIncludedHistoryMessage = (message: MessageRecord) =>
    message.includeInHistory !== false &&
    !isAutoTurnHistoryMarker(message) &&
    !isNarratorPhoneAutoTurnInstruction(message) &&
    (message.role === 'user' || message.role === 'output');
  const linkedPhoneMessageIds = new Set(
    messages
      .filter(isIncludedHistoryMessage)
      .flatMap((message) =>
        message.embeddedPhoneMessages?.map((phoneMessage) => phoneMessage.phoneMessageId) ?? [],
      ),
  );
  const phoneMessagesById = new Map(
    linkedMessages
      .filter((message) => message.channel === 'phone')
      .map((message) => [message.id, message]),
  );
  const history = messages.filter(
    (message) =>
      isIncludedHistoryMessage(message) &&
      (message.channel !== 'phone' || !linkedPhoneMessageIds.has(message.id)),
  );
  if (
    translated &&
    !history.some(
      (message) =>
        message.translatedText ||
        message.channel === 'phone' ||
        message.createdPhoneNote ||
        message.simulatedAiChat,
    )
  ) {
    return [];
  }

  let previousRpDateTime = '';
  const segments: FormattedChatHistorySegment[] = [];
  const turnIndexes = new Map<string, number>();
  const turnIndexForMessage = (message: MessageRecord) => {
    const turnKey = historySegmentTurnKey(message);
    const existing = turnIndexes.get(turnKey);
    if (existing !== undefined) {
      return existing;
    }
    const nextIndex = turnIndexes.size;
    turnIndexes.set(turnKey, nextIndex);
    return nextIndex;
  };
  const addSegment = (text: string, message: MessageRecord) => {
    if (!text.trim()) {
      return;
    }
    const dialogue = dialogueForFormattedText(text, message, translated);
    const speakerNames = Array.from(new Set([
      ...(message.speakerNames ?? []),
      ...(message.speakerName ? [message.speakerName] : []),
      ...(message.phoneFrom ? [message.phoneFrom] : []),
      ...(message.phoneTo ? [message.phoneTo] : []),
      ...(dialogue?.map((quote) => quote.speakerName) ?? []),
    ].map((name) => name.trim()).filter(Boolean)));
    segments.push({
      text,
      turnKey: historySegmentTurnKey(message),
      turnIndex: turnIndexForMessage(message),
      messageIndex: segments.length,
      role: message.role,
      channel: message.channel === 'phone' || message.phoneMessage ? 'phone' : 'rp',
      speakerNames: speakerNames.length ? speakerNames : undefined,
      speakerColors: message.speakerColors,
      dialogue,
    });
  };
  const withChangedRpDateTime = (text: string, rpDateTime?: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return '';
    }
    if (!rpDateTime || rpDateTime === previousRpDateTime) {
      return trimmed;
    }
    previousRpDateTime = rpDateTime;
    return withRpDateTime(trimmed, rpDateTime, rpDateTimeFormat, rpWeekdayLanguage);
  };

  history.forEach((message) => {
    if (message.embeddedPhoneMessages?.length) {
      const hasCompositeText =
        message.embeddedPhoneTextBefore !== undefined ||
        message.embeddedPhoneTextAfter !== undefined ||
        message.embeddedPhoneTranslatedTextBefore !== undefined ||
        message.embeddedPhoneTranslatedTextAfter !== undefined;
      const beforeOriginalText = message.embeddedPhoneTextBefore ?? (!hasCompositeText ? message.originalText : '');
      const beforeTranslatedText =
        message.embeddedPhoneTranslatedTextBefore ??
        (!hasCompositeText ? message.translatedText : undefined);
      addSegment(
        withChangedRpDateTime(
          historyTextWithoutTimestamp(
            translated && beforeTranslatedText
              ? { ...message, originalText: beforeOriginalText, translatedText: beforeTranslatedText }
              : { ...message, originalText: beforeOriginalText, translatedText: undefined },
            translated,
            phoneMessagesById,
          ),
          message.rpDateTime,
        ),
        message,
      );
      message.embeddedPhoneMessages.forEach((phoneMessage) => {
        const linkedMessage = phoneMessagesById.get(phoneMessage.phoneMessageId);
        const fallbackMessage: MessageRecord = {
          id: phoneMessage.phoneMessageId,
          role: 'output',
          originalText: phoneMessage.message,
          channel: 'phone',
          phoneFrom: phoneMessage.from,
          phoneTo: phoneMessage.to,
          turnId: message.turnId,
          turnNumber: message.turnNumber,
          turnPart: message.turnPart,
        };
        addSegment(
          withChangedRpDateTime(
            formatMessageRecordForContext(
              linkedMessage ?? fallbackMessage,
              translated,
              undefined,
              undefined,
              false,
              phoneMessagesById,
            ),
            linkedMessage?.rpDateTime,
          ),
          linkedMessage ?? fallbackMessage,
        );
      });
      const afterOriginalText = message.embeddedPhoneTextAfter ?? '';
      addSegment(
        withChangedRpDateTime(
          historyTextWithoutTimestamp(
            translated && message.embeddedPhoneTranslatedTextAfter
              ? { ...message, originalText: afterOriginalText, translatedText: message.embeddedPhoneTranslatedTextAfter }
              : { ...message, originalText: afterOriginalText, translatedText: undefined },
            translated,
            phoneMessagesById,
            false,
          ),
          message.rpDateTime,
        ),
        message,
      );
      return;
    }
    addSegment(
      withChangedRpDateTime(
        historyTextWithoutTimestamp(message, translated, phoneMessagesById),
        message.rpDateTime,
      ),
      message,
    );
  });

  return segments;
}

export function validCompressionTokenLimit(value?: number | string) {
  const numericValue = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(numericValue) && numericValue !== undefined
    ? Math.max(0, Math.floor(numericValue))
    : defaultContextCompressionTokenLimit;
}

export function validCompressionRatio(value?: number) {
  return Number.isFinite(value) && value !== undefined
    ? Math.min(70, Math.max(30, Math.round(value)))
    : defaultContextCompressionRatio;
}

export function validCompressionLengthWords(value?: number | string) {
  const numericValue = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(numericValue) && numericValue !== undefined
    ? Math.max(1, Math.floor(numericValue))
    : defaultContextCompressionLengthWords;
}
