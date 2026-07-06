import type { ChatImageAttachment, ImageCaptionChange, MessageRecord, TurnContext } from '../types';
import { isRecord } from '../utils/records';

export type ParsedPhoneMessage = {
  from: string;
  to: string;
  message: string;
  isVoiceMessage?: boolean;
  imageId?: string;
  imageDescription?: string;
  incomingImageAction?: ParsedPhoneImageAction;
  phoneImageCaptionChange?: ImageCaptionChange;
  translatedMessage?: string;
  imageAttachments?: ChatImageAttachment[];
  turnContext?: TurnContext;
};

export type ParsedPhoneImageAction = {
  imageId: string;
  imageAction: 'create' | 'update' | 'no_change';
  caption?: string;
};

export function phoneImageActionMatchesMessage(
  message: Pick<
    MessageRecord,
    'phoneImageDescription' | 'phoneImageIds' | 'imageAttachments'
  >,
  action: ParsedPhoneImageAction,
) {
  const requestedImageId = action.imageId.trim();
  const hasImageCaption = !!(
    message.phoneImageDescription?.trim() ||
    message.imageAttachments?.some((image) => image.description?.trim())
  );
  if (requestedImageId === 'new_image' || (action.imageAction === 'create' && !hasImageCaption)) {
    return true;
  }
  const messageImageIds = [
    ...(message.phoneImageIds ?? []),
    ...(message.imageAttachments?.map((image) => image.id) ?? []),
  ].map((imageId) => imageId.trim()).filter(Boolean);
  return messageImageIds.includes(requestedImageId);
}

export type EmbeddedPhoneMessagesResult = {
  text: string;
  textBefore: string;
  textAfter: string;
  phoneMessages: ParsedPhoneMessage[];
};

export function parsePhoneGraphInput(text: string) {
  const match = text.match(/^([^:\n]+?)\s+texts\s+([^:\n]+?):/i);
  return match ? { from: match[1].trim(), to: match[2].trim() } : undefined;
}

export function compactPhonePreview(text: string) {
  const compacted = text.replace(/\s+/g, ' ').trim();
  return compacted.length > 74 ? `${compacted.slice(0, 71)}...` : compacted;
}

export function normalizePhoneName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function phoneFirstName(value: string) {
  return normalizePhoneName(value).split(' ')[0] ?? '';
}

function phoneNameTokens(value: string) {
  return normalizePhoneName(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function phoneNamesMatch(left: string, right: string) {
  const normalizedLeft = normalizePhoneName(left);
  const normalizedRight = normalizePhoneName(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const leftFirstName = phoneFirstName(left);
  const rightFirstName = phoneFirstName(right);
  return !!leftFirstName && leftFirstName === rightFirstName;
}

function phoneNameMatchScore(characterName: string, inputName: string) {
  const normalizedCharacterName = normalizePhoneName(characterName);
  const normalizedInputName = normalizePhoneName(inputName);
  if (!normalizedCharacterName || !normalizedInputName) {
    return 0;
  }
  if (normalizedCharacterName === normalizedInputName) {
    return 100;
  }

  const characterTokens = phoneNameTokens(characterName);
  const inputTokens = phoneNameTokens(inputName);
  if (characterTokens.length === 0 || inputTokens.length === 0) {
    return 0;
  }

  if (inputTokens.length === 1 && characterTokens[0] === inputTokens[0]) {
    return 80;
  }

  const orderedPrefixMatch = inputTokens.every((token, index) => {
    const characterToken = characterTokens[index];
    return !!characterToken && characterToken.startsWith(token);
  });
  if (inputTokens.length > 1 && orderedPrefixMatch && inputTokens.some((token) => token.length >= 2)) {
    return 90;
  }

  if (characterTokens[0] === inputTokens[0]) {
    return 80;
  }

  if (inputTokens.some((token) => token.length >= 4 && characterTokens.includes(token))) {
    return 70;
  }

  if (
    inputTokens.some((token) =>
      token.length >= 4 && characterTokens.some((characterToken) => characterToken.startsWith(token))
    )
  ) {
    return 50;
  }

  return 0;
}

export function canonicalPhoneName<T extends { name: string }>(
  characters: T[],
  name: string,
) {
  const scoredMatches = characters
    .map((character) => ({
      character,
      score: phoneNameMatchScore(character.name, name),
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score);
  const bestMatch = scoredMatches[0];
  if (!bestMatch) {
    return name;
  }
  const nextBestMatch = scoredMatches[1];
  return nextBestMatch && nextBestMatch.score === bestMatch.score
    ? name
    : bestMatch.character.name;
}

function phoneImageDescriptionFromRecord(value: Record<string, unknown>) {
  const imageDescription =
    typeof value.image === 'string'
      ? value.image
      : typeof value.imageDescription === 'string'
        ? value.imageDescription
        : typeof value.image_description === 'string'
          ? value.image_description
          : '';
  return imageDescription.trim() || undefined;
}

function phoneImageIdFromRecord(value: Record<string, unknown>) {
  return typeof value.imageId === 'string'
    ? value.imageId.trim() || undefined
    : typeof value.image_id === 'string'
      ? value.image_id.trim() || undefined
      : undefined;
}

// The LLM may emit the flag as a boolean or as the strings "true"/"false",
// or omit it entirely; only a clear true counts as a voice message.
export function phoneVoiceMessageFlag(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  return typeof value === 'string' && value.trim().toLocaleLowerCase() === 'true';
}

function phoneVoiceMessageFlagFromRecord(value: Record<string, unknown>) {
  return phoneVoiceMessageFlag(
    value.isVoiceMessage ?? value.is_voice_message ?? value.voiceMessage ?? value.voice_message,
  );
}

function outgoingPhoneImageIdFromRecord(value: Record<string, unknown>) {
  return typeof value.sendImageId === 'string'
    ? value.sendImageId.trim() || undefined
    : typeof value.send_image_id === 'string'
      ? value.send_image_id.trim() || undefined
      : undefined;
}

function parsePhoneReplyRecord(value: unknown): ParsedPhoneMessage | undefined {
  if (
    !isRecord(value) ||
    typeof value.from !== 'string' ||
    typeof value.to !== 'string' ||
    typeof value.message !== 'string' ||
    value.image !== undefined ||
    value.imageDescription !== undefined ||
    value.image_description !== undefined ||
    value.imageId !== undefined ||
    value.image_id !== undefined ||
    value.caption !== undefined ||
    value.imageAction !== undefined
  ) {
    return undefined;
  }
  const parsed = {
    from: value.from.trim(),
    to: value.to.trim(),
    message: value.message.trim(),
    isVoiceMessage: phoneVoiceMessageFlagFromRecord(value) || undefined,
    imageId: outgoingPhoneImageIdFromRecord(value),
  };
  return parsed.from && parsed.to && parsed.message ? parsed : undefined;
}

function compactPhoneImageAction(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
    : '';
}

function parsePhoneImageActionRecord(value: unknown): ParsedPhoneImageAction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const imageId = phoneImageIdFromRecord(value);
  const compactAction = compactPhoneImageAction(value.imageAction ?? value.action);
  const imageAction =
    compactAction === 'create'
      ? 'create'
      : compactAction === 'update'
        ? 'update'
        : compactAction === 'nochange'
          ? 'no_change'
          : undefined;
  if (!imageId || !imageAction) {
    return undefined;
  }
  const caption = typeof value.caption === 'string' ? value.caption.trim() : undefined;
  if ((imageAction === 'create' || imageAction === 'update') && !caption) {
    return undefined;
  }
  return {
    imageId,
    imageAction,
    ...(caption ? { caption } : {}),
  };
}

function withoutJsonCodeFence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parsePhoneOutputJsonSequence(text: string) {
  const ranges = jsonObjectRanges(text);
  if (ranges.length <= 1) {
    return undefined;
  }
  const outside = ranges.reduceRight(
    (current, range) => `${current.slice(0, range.start)}${current.slice(range.end)}`,
    text,
  );
  if (outside.trim()) {
    return undefined;
  }
  return ranges.map((range) => JSON.parse(text.slice(range.start, range.end)) as unknown);
}

export function parsePhoneMessageOutput(
  value: string,
  options: { allowIncomingImageAction?: boolean } = {},
): ParsedPhoneMessage | null {
  const text = withoutJsonCodeFence(value);
  if (!text) {
    return null;
  }
  try {
    const sequence = parsePhoneOutputJsonSequence(text);
    if (sequence) {
      if (sequence.length > 2) {
        return null;
      }
      const phoneMessage = parsePhoneReplyRecord(sequence[0]);
      if (!phoneMessage) {
        return null;
      }
      if (sequence.length === 1) {
        return phoneMessage;
      }
      if (options.allowIncomingImageAction === false) {
        return phoneMessage;
      }
      const incomingImageAction = parsePhoneImageActionRecord(sequence[1]);
      return incomingImageAction ? { ...phoneMessage, incomingImageAction } : null;
    }
  } catch {
    return null;
  }
  try {
    const metadata = JSON.parse(text) as unknown;
    return parsePhoneReplyRecord(metadata) ?? null;
  } catch {
    return null;
  }
}

function scanJsonObjects(text: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        ranges.push({ start, end: index + 1 });
        start = -1;
      }
      if (depth < 0) {
        depth = 0;
        start = -1;
      }
    }
  }
  return { ranges, openObjectStart: depth > 0 && start >= 0 ? start : undefined };
}

function jsonObjectRanges(text: string) {
  return scanJsonObjects(text).ranges;
}

function parseEmbeddedPhoneMessagesObject(value: unknown): ParsedPhoneMessage[] {
  if (!isRecord(value) || !Array.isArray(value.phoneMessages)) {
    return [];
  }
  return value.phoneMessages.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.from !== 'string' ||
      typeof entry.to !== 'string' ||
      typeof entry.message !== 'string'
    ) {
      return [];
    }
    const parsed = {
      from: entry.from.trim(),
      to: entry.to.trim(),
      isVoiceMessage: phoneVoiceMessageFlagFromRecord(entry) || undefined,
      imageId: outgoingPhoneImageIdFromRecord(entry) ?? phoneImageIdFromRecord(entry),
      imageDescription: phoneImageDescriptionFromRecord(entry),
      message: entry.message.trim(),
    };
    return parsed.from && parsed.to && parsed.message ? [parsed] : [];
  });
}

function expandJsonFenceRange(text: string, range: { start: number; end: number }) {
  let start = range.start;
  let end = range.end;
  const before = text.slice(0, start);
  const openingFenceMatch = before.match(/(?:^|\n)[ \t]*```(?:json)?[ \t]*\n[ \t]*$/i);
  if (openingFenceMatch?.index !== undefined) {
    start = openingFenceMatch.index;
  }
  const after = text.slice(end);
  const closingFenceMatch = after.match(/^[ \t]*\n?[ \t]*```[ \t]*(?=\n|$)/);
  if (closingFenceMatch) {
    end += closingFenceMatch[0].length;
  }
  return { start, end };
}

export function parseEmbeddedPhoneMessagesFromRpOutput(value: string): EmbeddedPhoneMessagesResult {
  const ranges = jsonObjectRanges(value);
  const parsedRanges: Array<{ start: number; end: number; phoneMessages: ParsedPhoneMessage[] }> = [];
  for (const range of ranges) {
    const candidate = value.slice(range.start, range.end);
    try {
      const phoneMessages = parseEmbeddedPhoneMessagesObject(JSON.parse(candidate) as unknown);
      if (phoneMessages.length > 0) {
        parsedRanges.push({ ...expandJsonFenceRange(value, range), phoneMessages });
      }
    } catch {
      // Ignore non-JSON prose blocks.
    }
  }
  if (parsedRanges.length > 0) {
    const textBefore = value.slice(0, parsedRanges[0].start).replace(/\n{3,}$/g, '\n\n').trim();
    const textAfter = parsedRanges
      .map((range, index) => {
        const nextStart = parsedRanges[index + 1]?.start ?? value.length;
        return value.slice(range.end, nextStart).replace(/^\n{3,}/g, '\n\n').replace(/\n{3,}$/g, '\n\n').trim();
      })
      .filter(Boolean)
      .join('\n\n');
    const text = [textBefore, textAfter].filter(Boolean).join('\n\n');
    const phoneMessages = parsedRanges.flatMap((range) => range.phoneMessages);
    return { text, textBefore, textAfter, phoneMessages };
  }
  return { text: value.trim(), textBefore: value.trim(), textAfter: '', phoneMessages: [] };
}

function stripIncompleteEmbeddedJsonTail(value: string) {
  const { openObjectStart } = scanJsonObjects(value);
  if (openObjectStart !== undefined) {
    const tail = value.slice(openObjectStart);
    const startsOwnLine = /(?:^|\n)[ \t]*$/.test(value.slice(0, openObjectStart));
    if (startsOwnLine || tail.includes('"phoneMessages"')) {
      const start = expandJsonFenceRange(value, {
        start: openObjectStart,
        end: value.length,
      }).start;
      return value.slice(0, start).replace(/\n{3,}$/g, '\n\n').trimEnd();
    }
    return value;
  }
  const fenceMatch = value.match(/(?:^|\n)[ \t]*`{1,3}(?:j(?:s(?:o(?:n)?)?)?)?[ \t]*\n?[ \t]*$/i);
  if (fenceMatch?.index !== undefined) {
    return value.slice(0, fenceMatch.index).replace(/\n{3,}$/g, '\n\n').trimEnd();
  }
  return value;
}

export function embeddedPhoneMessagesLivePreview(value: string): EmbeddedPhoneMessagesResult {
  return parseEmbeddedPhoneMessagesFromRpOutput(stripIncompleteEmbeddedJsonTail(value));
}
