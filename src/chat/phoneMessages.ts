import type {
  BankTransferRecord,
  ChatImageAttachment,
  ImageCaptionChange,
  MessageRecord,
  SocialAppKind,
  TurnContext,
} from '../types';
import { isRecord } from '../utils/records';
import {
  parseCreatedPhoneNote,
  parseSimulatedAiChat,
  type CreatedPhoneNote,
  type SimulatedAiChat,
} from './phoneAppsSessions';

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
  /** Position among all messenger entries of one RP output, in source order. */
  sourceOrder?: number;
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
  const messageImageIds = [
    ...(message.phoneImageIds ?? []),
    ...(message.imageAttachments?.map((image) => image.id) ?? []),
  ].map((imageId) => imageId.trim()).filter(Boolean);
  if (action.imageAction === 'create') {
    return !hasImageCaption && (
      requestedImageId === 'new_image' || messageImageIds.includes(requestedImageId)
    );
  }
  if (requestedImageId === 'new_image') {
    return true;
  }
  return messageImageIds.includes(requestedImageId);
}

/** A "comment on an existing social post" command emitted next to any output. */
type ParsedSocialPostComment = {
  app: SocialAppKind;
  postId: string;
  from: string;
  text: string;
};

/** An LLM-sent message for the Fotogram or OnlyFriends messenger. */
export type ParsedIncomingSocialDirectMessage = {
  app: SocialAppKind;
  from: string;
  /** Optional explicit sender handle; derived from the name when absent. */
  handle?: string;
  /** Recipient name; social-reactions runs default it to the post author/actor. */
  to?: string;
  text: string;
  /** Optional referenced post the DM is about. */
  postId?: string;
  /** OnlyFriends-only optional tip credited to the recipient's wallet. */
  tip?: number;
  /** Position among all messenger entries of one RP output, in source order. */
  sourceOrder?: number;
};

export type EmbeddedPhoneMessagesResult = {
  text: string;
  textBefore: string;
  textAfter: string;
  phoneMessages: ParsedPhoneMessage[];
  phoneImageActions: ParsedPhoneImageAction[];
  bankTransfers: BankTransferRecord[];
  socialPostComments: ParsedSocialPostComment[];
  socialDirectMessages: ParsedIncomingSocialDirectMessage[];
  simulatedAiChats: SimulatedAiChat[];
  invalidSimulatedAiChatCount: number;
  createdPhoneNotes: CreatedPhoneNote[];
  invalidCreatedPhoneNoteCount: number;
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

export function jsonObjectRanges(text: string) {
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

export function parseEmbeddedBankTransfersObject(value: unknown): BankTransferRecord[] {
  if (!isRecord(value) || !Array.isArray(value.bankTransfers)) {
    return [];
  }
  return value.bankTransfers.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.from !== 'string' || typeof entry.to !== 'string') {
      return [];
    }
    const from = entry.from.trim();
    const to = entry.to.trim();
    const amount = typeof entry.amount === 'number'
      ? entry.amount
      : typeof entry.amount === 'string' && entry.amount.trim()
        ? Number(entry.amount)
        : Number.NaN;
    if (!from || !to || !Number.isFinite(amount) || amount <= 0) {
      return [];
    }
    return [{
      from,
      to,
      amount: Math.round(amount * 100) / 100,
      note: typeof entry.note === 'string' && entry.note.trim() ? entry.note.trim() : undefined,
    }];
  });
}

const socialPostCommentKeysByApp: Record<SocialAppKind, string> = {
  fotogram: 'fotogramPostComment',
  onlyfriends: 'onlyFriendsPostComment',
};

function parseEmbeddedSocialPostCommentsObject(value: unknown): ParsedSocialPostComment[] {
  if (!isRecord(value)) {
    return [];
  }
  return (Object.keys(socialPostCommentKeysByApp) as SocialAppKind[]).flatMap((app) => {
    const entry = value[socialPostCommentKeysByApp[app]];
    if (
      !isRecord(entry) ||
      typeof entry.postId !== 'string' ||
      typeof entry.from !== 'string' ||
      typeof entry.text !== 'string'
    ) {
      return [];
    }
    const parsed = {
      app,
      postId: entry.postId.trim(),
      from: entry.from.trim(),
      text: entry.text.trim(),
    };
    return parsed.postId && parsed.from && parsed.text ? [parsed] : [];
  });
}

type MessengerAppKind = 'whatsup' | SocialAppKind;

export const messengerAppMessageKeys: Record<MessengerAppKind, string> = {
  whatsup: 'whatsUpApp',
  fotogram: 'fotogramApp',
  onlyfriends: 'onlyFriendsApp',
};

type ParsedMessengerAppMessages = {
  phoneMessages: ParsedPhoneMessage[];
  socialDirectMessages: ParsedIncomingSocialDirectMessage[];
};

/** Parse the shared message-array format used by WhatsUp, Fotogram, and OnlyFriends. */
export function parseMessengerAppMessagesObject(value: unknown): ParsedMessengerAppMessages {
  const result: ParsedMessengerAppMessages = { phoneMessages: [], socialDirectMessages: [] };
  if (!isRecord(value)) {
    return result;
  }
  for (const app of Object.keys(messengerAppMessageKeys) as MessengerAppKind[]) {
    const entries = value[messengerAppMessageKeys[app]];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries) {
      if (
        !isRecord(entry) ||
        typeof entry.from !== 'string' ||
        typeof entry.to !== 'string' ||
        typeof entry.message !== 'string'
      ) {
        continue;
      }
      const from = entry.from.trim();
      const to = entry.to.trim();
      const message = entry.message.trim();
      if (!from || !to || !message) {
        continue;
      }
      if (app === 'whatsup') {
        result.phoneMessages.push({
          from,
          to,
          message,
          isVoiceMessage: phoneVoiceMessageFlagFromRecord(entry) || undefined,
          imageId: outgoingPhoneImageIdFromRecord(entry) ?? phoneImageIdFromRecord(entry),
          imageDescription: phoneImageDescriptionFromRecord(entry),
        });
      } else {
        // Voice and image fields are intentionally ignored for social DMs until
        // those apps gain matching playback and attachment support.
        const stringField = (field: unknown) =>
          typeof field === 'string' && field.trim() ? field.trim() : undefined;
        const tipValue = typeof entry.tip === 'number'
          ? entry.tip
          : typeof entry.tip === 'string' && entry.tip.trim()
            ? Number(entry.tip)
            : Number.NaN;
        const tip = app === 'onlyfriends' && Number.isFinite(tipValue) && tipValue > 0
          ? Math.round(tipValue * 100) / 100
          : undefined;
        result.socialDirectMessages.push({
          app,
          from,
          to,
          text: message,
          handle: stringField(entry.handle),
          postId: stringField(entry.postId),
          ...(tip !== undefined ? { tip } : {}),
        });
      }
    }
  }
  return result;
}

/** True when the object claims a Fotogram or OnlyFriends message array. */
export function hasIncomingSocialDirectMessagesKey(value: unknown) {
  return isRecord(value) &&
    ([messengerAppMessageKeys.fotogram, messengerAppMessageKeys.onlyfriends] as const)
      .some((key) => value[key] !== undefined);
}

export function parseIncomingSocialDirectMessagesObject(
  value: unknown,
): ParsedIncomingSocialDirectMessage[] {
  return parseMessengerAppMessagesObject(value).socialDirectMessages;
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
  const parsedRanges: Array<{
    start: number;
    end: number;
    phoneMessages: ParsedPhoneMessage[];
    phoneImageActions: ParsedPhoneImageAction[];
    bankTransfers: BankTransferRecord[];
    socialPostComments: ParsedSocialPostComment[];
    socialDirectMessages: ParsedIncomingSocialDirectMessage[];
    simulatedAiChats: SimulatedAiChat[];
    invalidSimulatedAiChatCount: number;
    createdPhoneNotes: CreatedPhoneNote[];
    invalidCreatedPhoneNoteCount: number;
  }> = [];
  for (const range of ranges) {
    const candidate = value.slice(range.start, range.end);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const messengerMessages = parseMessengerAppMessagesObject(parsed);
      const phoneMessages = [
        ...parseEmbeddedPhoneMessagesObject(parsed),
        ...messengerMessages.phoneMessages,
      ];
      // A standalone caption action object emitted after an embedded phone
      // message (e.g. from the create image action's second JSON object).
      const phoneImageAction = isRecord(parsed) && parsed.imageAction !== undefined
        ? parsePhoneImageActionRecord(parsed)
        : undefined;
      const phoneImageActions = phoneImageAction ? [phoneImageAction] : [];
      const bankTransfers = parseEmbeddedBankTransfersObject(parsed);
      const socialPostComments = parseEmbeddedSocialPostCommentsObject(parsed);
      const socialDirectMessages = messengerMessages.socialDirectMessages;
      const claimsSimulatedAiChat = isRecord(parsed) && parsed.aiAssistantChat !== undefined;
      const simulatedAiChat = claimsSimulatedAiChat
        ? parseSimulatedAiChat(parsed.aiAssistantChat)
        : undefined;
      const simulatedAiChats = simulatedAiChat ? [simulatedAiChat] : [];
      const claimsCreatedPhoneNote = isRecord(parsed) && parsed.phoneNote !== undefined;
      const createdPhoneNote = claimsCreatedPhoneNote
        ? parseCreatedPhoneNote(parsed.phoneNote)
        : undefined;
      const createdPhoneNotes = createdPhoneNote ? [createdPhoneNote] : [];
      if (
        phoneMessages.length > 0 ||
        phoneImageActions.length > 0 ||
        bankTransfers.length > 0 ||
        socialPostComments.length > 0 ||
        socialDirectMessages.length > 0 ||
        claimsSimulatedAiChat ||
        claimsCreatedPhoneNote
      ) {
        parsedRanges.push({
          ...expandJsonFenceRange(value, range),
          phoneMessages,
          phoneImageActions,
          bankTransfers,
          socialPostComments,
          socialDirectMessages,
          simulatedAiChats,
          invalidSimulatedAiChatCount: claimsSimulatedAiChat && !simulatedAiChat ? 1 : 0,
          createdPhoneNotes,
          invalidCreatedPhoneNoteCount: claimsCreatedPhoneNote && !createdPhoneNote ? 1 : 0,
        });
      }
    } catch {
      // Ignore non-JSON prose blocks.
    }
  }
  if (parsedRanges.length > 0) {
    // Number every messenger entry across the whole output so display can keep
    // the source order even though phone and social messages are stored apart.
    let messengerSourceOrder = 0;
    for (const range of parsedRanges) {
      for (const phoneMessage of range.phoneMessages) {
        phoneMessage.sourceOrder = messengerSourceOrder;
        messengerSourceOrder += 1;
      }
      for (const socialMessage of range.socialDirectMessages) {
        socialMessage.sourceOrder = messengerSourceOrder;
        messengerSourceOrder += 1;
      }
    }
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
    const phoneImageActions = parsedRanges.flatMap((range) => range.phoneImageActions);
    const bankTransfers = parsedRanges.flatMap((range) => range.bankTransfers);
    const socialPostComments = parsedRanges.flatMap((range) => range.socialPostComments);
    const socialDirectMessages = parsedRanges.flatMap((range) => range.socialDirectMessages);
    const simulatedAiChats = parsedRanges.flatMap((range) => range.simulatedAiChats);
    const createdPhoneNotes = parsedRanges.flatMap((range) => range.createdPhoneNotes);
    return {
      text,
      textBefore,
      textAfter,
      phoneMessages,
      phoneImageActions,
      bankTransfers,
      socialPostComments,
      socialDirectMessages,
      simulatedAiChats,
      invalidSimulatedAiChatCount: parsedRanges.reduce(
        (count, range) => count + range.invalidSimulatedAiChatCount,
        0,
      ),
      createdPhoneNotes,
      invalidCreatedPhoneNoteCount: parsedRanges.reduce(
        (count, range) => count + range.invalidCreatedPhoneNoteCount,
        0,
      ),
    };
  }
  return {
    text: value.trim(),
    textBefore: value.trim(),
    textAfter: '',
    phoneMessages: [],
    phoneImageActions: [],
    bankTransfers: [],
    socialPostComments: [],
    socialDirectMessages: [],
    simulatedAiChats: [],
    invalidSimulatedAiChatCount: 0,
    createdPhoneNotes: [],
    invalidCreatedPhoneNoteCount: 0,
  };
}

function stripIncompleteEmbeddedJsonTail(value: string) {
  const { openObjectStart } = scanJsonObjects(value);
  if (openObjectStart !== undefined) {
    const tail = value.slice(openObjectStart);
    const startsOwnLine = /(?:^|\n)[ \t]*$/.test(value.slice(0, openObjectStart));
    if (
      startsOwnLine ||
      tail.includes('"phoneMessages"') ||
      tail.includes('"whatsUpApp"') ||
      tail.includes('"fotogramApp"') ||
      tail.includes('"onlyFriendsApp"') ||
      tail.includes('"bankTransfers"') ||
      tail.includes('"fotogramPostComment"') ||
      tail.includes('"onlyFriendsPostComment"') ||
      tail.includes('"aiAssistantChat"') ||
      tail.includes('"phoneNote"') ||
      tail.includes('"imageAction"')
    ) {
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

type PartialMessengerPreview = {
  phoneMessages: ParsedPhoneMessage[];
  socialDirectMessages: ParsedIncomingSocialDirectMessage[];
};

function decodedPartialJsonString(value: string) {
  const safeValue = value.endsWith('\\') ? value.slice(0, -1) : value;
  try {
    return JSON.parse(`"${safeValue}"`) as string;
  } catch {
    return undefined;
  }
}

function partialStringField(value: string, field: string, allowIncomplete = false) {
  const fieldPattern = new RegExp(
    `"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)${allowIncomplete ? '(?:"|$)' : '"'}`,
  );
  const match = value.match(fieldPattern);
  return match ? decodedPartialJsonString(match[1])?.trim() : undefined;
}

function completedArrayEntryRanges(value: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  let entryStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
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
        entryStart = index;
      }
      depth += 1;
      continue;
    }
    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && entryStart >= 0) {
        ranges.push({ start: entryStart, end: index + 1 });
        entryStart = -1;
      }
      continue;
    }
    // The closing bracket ends the scanned array; anything after it belongs
    // to a different key and must not be previewed under this one.
    if (char === ']' && depth === 0) {
      break;
    }
  }
  return { ranges, openEntryStart: depth > 0 && entryStart >= 0 ? entryStart : undefined };
}

function incompleteMessengerPreview(value: string): PartialMessengerPreview | undefined {
  const { openObjectStart } = scanJsonObjects(value);
  if (openObjectStart === undefined) {
    return undefined;
  }
  const openObject = value.slice(openObjectStart);
  const appMatch = openObject.match(
    /"(phoneMessages|whatsUpApp|fotogramApp|onlyFriendsApp)"\s*:\s*\[/,
  );
  if (!appMatch || appMatch.index === undefined) {
    return undefined;
  }
  const key = appMatch[1];
  const arrayStart = appMatch.index + appMatch[0].length;
  const arrayValue = openObject.slice(arrayStart);
  const { ranges, openEntryStart } = completedArrayEntryRanges(arrayValue);
  const entries = ranges.flatMap((range) => {
    try {
      return [JSON.parse(arrayValue.slice(range.start, range.end)) as unknown];
    } catch {
      return [];
    }
  });

  // Once from/to are complete, show the currently written message too. Its
  // bubble then grows with the streamed message text instead of waiting for
  // the closing quote and object brace.
  if (openEntryStart !== undefined) {
    const openEntry = arrayValue.slice(openEntryStart);
    const from = partialStringField(openEntry, 'from');
    const to = partialStringField(openEntry, 'to');
    const message = partialStringField(openEntry, 'message', true);
    if (from && to && message) {
      const sendImageId =
        partialStringField(openEntry, 'sendImageId', true) ??
        partialStringField(openEntry, 'send_image_id', true);
      entries.push({
        from,
        to,
        message,
        ...(sendImageId ? { sendImageId } : {}),
      });
    }
  }

  const wrapped = { [key]: entries };
  if (key === 'phoneMessages') {
    return {
      phoneMessages: parseEmbeddedPhoneMessagesObject(wrapped),
      socialDirectMessages: [],
    };
  }
  return parseMessengerAppMessagesObject(wrapped);
}

export function embeddedPhoneMessagesLivePreview(value: string): EmbeddedPhoneMessagesResult {
  const partial = incompleteMessengerPreview(value);
  const complete = parseEmbeddedPhoneMessagesFromRpOutput(stripIncompleteEmbeddedJsonTail(value));
  if (!partial) {
    return complete;
  }
  // The open object streams after every completed one, so its entries continue
  // the source numbering. Without it the still-streaming bubble would lack a
  // sourceOrder and briefly jump into the legacy phone-before-social order.
  let nextSourceOrder = complete.phoneMessages.length + complete.socialDirectMessages.length;
  for (const phoneMessage of partial.phoneMessages) {
    phoneMessage.sourceOrder = nextSourceOrder;
    nextSourceOrder += 1;
  }
  for (const socialMessage of partial.socialDirectMessages) {
    socialMessage.sourceOrder = nextSourceOrder;
    nextSourceOrder += 1;
  }
  return {
    ...complete,
    phoneMessages: [...complete.phoneMessages, ...partial.phoneMessages],
    socialDirectMessages: [
      ...complete.socialDirectMessages,
      ...partial.socialDirectMessages,
    ],
  };
}
