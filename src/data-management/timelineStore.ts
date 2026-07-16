import type { MessageRecord, TurnRecord } from '../types';
import type { ImageRef, TimelineEntry, TimelineMessageEntry } from './types';
import { stableEntryId } from './parsing';

function timelineRole(role: MessageRecord['role']): TimelineMessageEntry['role'] {
  if (role === 'output') {
    return 'assistant';
  }
  return role;
}

function messageEntryId(turn: TurnRecord, message: MessageRecord) {
  return stableEntryId('turn', turn.number, message.turnPart ?? 'message', message.id);
}

function imageRefs(message: MessageRecord): ImageRef[] | undefined {
  const refs = message.imageAttachments?.map((image) => ({ imageId: image.id })) ?? [];
  return refs.length ? refs : undefined;
}

function embeddedPhoneText(message: MessageRecord): TimelineMessageEntry['embeddedPhoneText'] | undefined {
  const text = {
    before: message.embeddedPhoneTextBefore,
    after: message.embeddedPhoneTextAfter,
    translatedBefore: message.embeddedPhoneTranslatedTextBefore,
    translatedAfter: message.embeddedPhoneTranslatedTextAfter,
  };
  return Object.values(text).some((value) => value !== undefined) ? text : undefined;
}

function messageFlags(message: MessageRecord, turn: TurnRecord): TimelineMessageEntry['flags'] | undefined {
  const flags: NonNullable<TimelineMessageEntry['flags']> = {};
  if (message.isOpening) {
    flags.opening = true;
  }
  if (turn.openingHistory) {
    flags.openingHistory = true;
  }
  if (message.includeInHistory !== undefined) {
    flags.includeInHistory = message.includeInHistory;
  }
  if (message.eventInput) {
    flags.eventInput = true;
  }
  if (turn.mode === 'auto-turn') {
    flags.autoTurn = true;
  }
  if (turn.mode === 'narrator') {
    flags.narrator = true;
  }
  return Object.keys(flags).length ? flags : undefined;
}

function messageToTimelineEntry(
  turn: TurnRecord,
  phase: TimelineMessageEntry['phase'],
  message: MessageRecord,
  embeddedPhoneMessageIds: Map<number, string>,
  embeddedSocialMessageIds: Map<number, string>,
): TimelineMessageEntry {
  const id = messageEntryId(turn, message);
  const channel = message.channel === 'phone' || message.phoneMessage ? 'phone' : 'rp';
  const speakerNames = message.speakerNames ?? (message.speakerName ? [message.speakerName] : undefined);
  return {
    id,
    kind: 'message',
    turnId: message.turnId ?? turn.id,
    turnNumber: message.turnNumber ?? turn.number,
    phase,
    channel,
    role: timelineRole(message.role),
    text: {
      original: message.originalText,
      translated: message.translatedText,
    },
    speakers: speakerNames || message.speakerColors || message.originalDialogue || message.translatedDialogue
      ? {
          primary: message.speakerName,
          names: speakerNames,
          colors: message.speakerColors,
          originalDialogue: message.originalDialogue,
          translatedDialogue: message.translatedDialogue,
        }
      : undefined,
    phone: channel === 'phone'
      ? {
          from: message.phoneFrom ?? '',
          to: message.phoneTo ?? '',
          voiceMessage: message.phoneVoiceMessage || undefined,
          imageIds: message.phoneImageIds,
          imageDescription: message.phoneImageDescription,
        }
      : undefined,
    images: imageRefs(message),
    embeddedPhoneMessageIds: message.embeddedPhoneMessages
      ?.map((link) => embeddedPhoneMessageIds.get(link.phoneMessageId))
      .filter((linkId): linkId is string => !!linkId),
    embeddedSocialMessageIds: message.embeddedSocialMessages
      ?.map((link) => embeddedSocialMessageIds.get(link.socialMessageId))
      .filter((linkId): linkId is string => !!linkId),
    embeddedPhoneText: embeddedPhoneText(message),
    replyToMessageId: message.replyToMessageId !== undefined
      ? embeddedPhoneMessageIds.get(message.replyToMessageId)
      : undefined,
    flags: messageFlags(message, turn),
    eventDisplayText: message.eventDisplayText,
    imageDescription: message.rpImageDescription ?? message.phoneImageDescription,
    imageLabel: channel === 'rp' ? message.rpImageName : undefined,
    imageCaptionChange: message.phoneImageCaptionChange,
    inputMessageFormat: message.inputMessageFormat,
    inputPromptSlot: message.inputPromptSlot,
    rpDateTime: message.rpDateTime,
    workflowVariableSetCommands: message.workflowVariableSetCommands,
    voiceClips: message.voiceClips?.length ? message.voiceClips : undefined,
    bankTransfer: message.bankTransfer,
    socialPost: message.socialPost,
    socialThreadAction: message.socialThreadAction,
    socialReactions: message.socialReactions,
    socialDirectMessage: message.socialDirectMessage,
    createdPhoneNote: message.createdPhoneNote,
    deletedPhoneNote: message.deletedPhoneNote,
    simulatedAiChat: message.simulatedAiChat,
  };
}

export function timelineFromTurnRecords(turns: TurnRecord[]): TimelineEntry[] {
  const embeddedPhoneMessageIds = new Map<number, string>();
  const embeddedSocialMessageIds = new Map<number, string>();
  turns.forEach((turn) => {
    [...turn.input.messages, ...turn.output.messages].forEach((message) => {
      if (message.channel === 'phone' || message.phoneMessage) {
        embeddedPhoneMessageIds.set(message.id, messageEntryId(turn, message));
      }
      if (message.socialDirectMessage) {
        embeddedSocialMessageIds.set(message.id, messageEntryId(turn, message));
      }
    });
  });
  return turns.flatMap((turn) => [
    ...turn.input.messages.map((message) =>
      messageToTimelineEntry(turn, 'input', message, embeddedPhoneMessageIds, embeddedSocialMessageIds),
    ),
    ...turn.output.messages.map((message) =>
      messageToTimelineEntry(turn, 'output', message, embeddedPhoneMessageIds, embeddedSocialMessageIds),
    ),
  ]);
}

export function timelineFromTurnRecordsWithOpeningMessages(
  turns: TurnRecord[],
  openingMessages: MessageRecord[],
  savedAt: string,
): TimelineEntry[] {
  const openingTurnMessages = new Set(
    turns
      .filter((turn) => turn.input.messages.some((message) => message.isOpening) || turn.output.messages.some((message) => message.isOpening))
      .flatMap((turn) => [...turn.input.messages, ...turn.output.messages])
      .map((message) => message.id),
  );
  const looseOpeningTurns = openingMessages
    .filter((message) => !openingTurnMessages.has(message.id))
    .map((message, index) => {
      const turnNumber = message.turnNumber ?? index + 1;
      const phase = message.turnPart ?? (message.role === 'output' ? 'output' : 'input');
      return {
        id: message.turnId ?? `opening-message-${message.id}`,
        number: turnNumber,
        createdAt: savedAt,
        input: {
          graphText: phase === 'input' ? message.originalText : '',
          messages: phase === 'input' ? [{ ...message, isOpening: true }] : [],
        },
        output: {
          graphText: phase === 'output' ? message.originalText : '',
          messages: phase === 'output' ? [{ ...message, isOpening: true }] : [],
        },
      } satisfies TurnRecord;
    });
  return timelineFromTurnRecords([...looseOpeningTurns, ...turns]);
}

export function timelineMessages(timeline: TimelineEntry[]) {
  return timeline.filter((entry): entry is TimelineMessageEntry => entry.kind === 'message');
}

export function recentTimelineEntries(timeline: TimelineEntry[], maxEntries: number) {
  return maxEntries > 0 ? timeline.slice(-maxEntries) : timeline;
}
