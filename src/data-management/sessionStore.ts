import {
  currentSessionFormatVersion,
  currentSessionWorkflowFormatVersion,
} from '../session/version';
import type {
  MessageRecord,
  TurnRecord,
  TurnRuntimeSnapshot,
  WorkflowFile,
  WorkflowNode,
} from '../types';
import type { OnlyFriendsPurchasesByCharacter } from '../chat/onlyFriendsWallet';
import {
  normalizeDynamicSocialUsers,
  normalizeSocialConnectionsByCharacter,
  type DynamicSocialUsers,
  type SocialConnectionsByCharacter,
} from '../chat/socialDirectory';
import {
  normalizeChatGpdChatsByCharacter,
  normalizePhoneNotesByCharacter,
  type ChatGpdChatsByCharacter,
  type PhoneNotesByCharacter,
} from '../chat/phoneAppsSessions';
import { currentWorkflowFormatVersion } from '../workflow/version';
import { createMediaPoolReader, createMediaPoolWriter } from './mediaPool';
import { runtimeSnapshotForNode } from './checkpointStore';
import { debugStateFromNodes } from './debugContext';
import { entitiesFromCurrentState } from './entityStore';
import { eventTimelineEntriesFromEntities } from './eventStore';
import {
  timelineFromTurnRecordsWithOpeningMessages,
  timelineMessages,
} from './timelineStore';
import type {
  RpgraphSessionV2,
  RuntimeState,
  TimelineMessageEntry,
  TurnCheckpoint,
  WorkflowFileV2,
} from './types';

export type SessionV2AppState = {
  settings: {
    englishProcessingEnabled: boolean;
    inputTranslationOnlyEnabled?: boolean;
    displayLanguage: string;
  };
  workflowVariables: Record<string, string>;
  turns: TurnRecord[];
  turnCheckpoints: TurnCheckpoint[];
  openingMessages: MessageRecord[];
  currentRuntime: TurnRuntimeSnapshot;
  phoneSeenByConversation: Record<string, number>;
  bankingSeenByCharacter: Record<string, number>;
  phoneAppSeenByCharacter: Record<string, number>;
  bankingContactsByCharacter: Record<string, string[]>;
  socialLikesByAccount: Record<string, string[]>;
  dynamicSocialUsers: DynamicSocialUsers;
  socialConnectionsByCharacter: SocialConnectionsByCharacter;
  onlyFriendsPurchasesByCharacter: OnlyFriendsPurchasesByCharacter;
  phoneDividerAfterByConversation: Record<string, number>;
  recentlyUsedEmojis?: string[];
  phoneNotesByCharacter: PhoneNotesByCharacter;
  chatGpdChatsByCharacter: ChatGpdChatsByCharacter;
};

export type SessionV2CurrentStateInput = {
  name: string;
  settings: SessionV2AppState['settings'];
  workflowVariables: Record<string, string>;
  turns: TurnRecord[];
  turnCheckpoints: TurnCheckpoint[];
  openingMessages: MessageRecord[];
  phoneSeenByConversation?: Record<string, number>;
  bankingSeenByCharacter?: Record<string, number>;
  phoneAppSeenByCharacter?: Record<string, number>;
  bankingContactsByCharacter?: Record<string, string[]>;
  socialLikesByAccount?: Record<string, string[]>;
  dynamicSocialUsers?: DynamicSocialUsers;
  socialConnectionsByCharacter?: SocialConnectionsByCharacter;
  onlyFriendsPurchasesByCharacter?: OnlyFriendsPurchasesByCharacter;
  phoneDividerAfterByConversation?: Record<string, number>;
  recentlyUsedEmojis?: string[];
  phoneNotesByCharacter?: PhoneNotesByCharacter;
  chatGpdChatsByCharacter?: ChatGpdChatsByCharacter;
};

function workflowFileToV2(workflow: WorkflowFile): WorkflowFileV2 {
  return {
    format: 'rpgraph-workflow',
    formatVersion: currentSessionWorkflowFormatVersion,
    savedAt: workflow.savedAt,
    viewport: workflow.viewport,
    graph: {
      nodes: workflow.nodes,
      edges: workflow.edges,
    },
  };
}

export function workflowV2ToWorkflowFile(workflow: WorkflowFileV2): WorkflowFile {
  return {
    format: 'rpgraph-workflow',
    formatVersion: currentWorkflowFormatVersion,
    savedAt: workflow.savedAt,
    viewport: workflow.viewport,
    nodes: workflow.graph.nodes,
    edges: workflow.graph.edges,
  };
}

function workflowVariableRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry)))
      .map(([key, entry]) => [key, String(entry)]),
  );
}

function runtimeStateFromNodes(
  nodes: WorkflowNode[],
  workflowVariables: Record<string, string> = {},
): RuntimeState {
  return {
    workflowVariables: structuredClone(workflowVariables),
    nodes: Object.fromEntries(
      nodes
        .map((node) => [node.id, runtimeSnapshotForNode(node)] as const)
        .filter(([, snapshot]) => Object.keys(snapshot).length > 0),
    ),
  };
}

/**
 * Returns `fields` with a redacted or rehydrated `storybookJson`, reusing the
 * input object when the snapshot holds no storybook or nothing changed.
 */
function snapshotFieldsWithConvertedStorybook(
  fields: Record<string, unknown>,
  convertStorybookJson: (json: string) => string,
): Record<string, unknown> {
  if (typeof fields.storybookJson !== 'string') {
    return fields;
  }
  const converted = convertStorybookJson(fields.storybookJson);
  return converted === fields.storybookJson ? fields : { ...fields, storybookJson: converted };
}

function checkpointWithConvertedStorybooks(
  checkpoint: TurnCheckpoint,
  convertStorybookJson: (json: string) => string,
): TurnCheckpoint {
  let changed = false;
  const nodeSnapshots = Object.fromEntries(
    Object.entries(checkpoint.nodeSnapshots).map(([nodeId, snapshot]) => {
      const before = snapshotFieldsWithConvertedStorybook(snapshot.before, convertStorybookJson);
      const after = snapshotFieldsWithConvertedStorybook(snapshot.after, convertStorybookJson);
      if (before === snapshot.before && after === snapshot.after) {
        return [nodeId, snapshot];
      }
      changed = true;
      return [nodeId, { before, after }];
    }),
  );
  return changed ? { ...checkpoint, nodeSnapshots } : checkpoint;
}

function runtimeStateWithConvertedStorybooks(
  runtime: RuntimeState,
  convertStorybookJson: (json: string) => string,
): RuntimeState {
  return {
    ...runtime,
    nodes: Object.fromEntries(
      Object.entries(runtime.nodes).map(([nodeId, fields]) => [
        nodeId,
        snapshotFieldsWithConvertedStorybook(fields, convertStorybookJson),
      ]),
    ),
  };
}

export function sessionV2FromCurrentState(
  state: SessionV2CurrentStateInput,
  workflow: WorkflowFile,
  runtimeNodes: WorkflowNode[],
  savedAt = new Date().toISOString(),
): RpgraphSessionV2 {
  const entities = entitiesFromCurrentState(runtimeNodes, state.turns);
  const mediaWriter = createMediaPoolWriter();
  const timeline = [
    ...timelineFromTurnRecordsWithOpeningMessages(
      state.turns,
      state.openingMessages,
      savedAt,
      mediaWriter.mediaRefForDataUrl,
    ),
    ...eventTimelineEntriesFromEntities(entities.events),
  ];
  const debug = debugStateFromNodes(runtimeNodes, savedAt);
  // Timeline voice clips and runtime/undo storybook copies share one media
  // pool; the embedded workflow keeps the only full storybook copy in the save.
  const redactedRuntime = runtimeStateWithConvertedStorybooks(
    runtimeStateFromNodes(runtimeNodes, state.workflowVariables),
    mediaWriter.redactedStorybookJson,
  );
  const redactedCheckpoints = state.turnCheckpoints.map((checkpoint) =>
    checkpointWithConvertedStorybooks(checkpoint, mediaWriter.redactedStorybookJson),
  );
  return {
    format: 'rpgraph-session',
    formatVersion: currentSessionFormatVersion,
    savedAt,
    name: state.name,
    metadata: {
      settings: {
        englishProcessingEnabled: state.settings.englishProcessingEnabled,
        inputTranslationOnlyEnabled: state.settings.inputTranslationOnlyEnabled,
        displayLanguage: state.settings.displayLanguage,
      },
    },
    workflow: workflowFileToV2(workflow),
    timeline,
    entities: {
      ...entities,
      ...(Object.keys(mediaWriter.mediaData).length ? { mediaData: mediaWriter.mediaData } : {}),
    },
    runtime: {
      current: redactedRuntime,
      undo: redactedCheckpoints,
    },
    ui: {
      phoneSeenByConversation: state.phoneSeenByConversation ?? {},
      bankingSeenByCharacter: state.bankingSeenByCharacter ?? {},
      phoneAppSeenByCharacter: state.phoneAppSeenByCharacter ?? {},
      bankingContactsByCharacter: state.bankingContactsByCharacter ?? {},
      socialLikesByAccount: state.socialLikesByAccount ?? {},
      dynamicSocialUsers: normalizeDynamicSocialUsers(state.dynamicSocialUsers),
      socialConnectionsByCharacter: normalizeSocialConnectionsByCharacter(
        state.socialConnectionsByCharacter,
      ),
      onlyFriendsPurchasesByCharacter: state.onlyFriendsPurchasesByCharacter ?? {},
      phoneDividerAfterByConversation: state.phoneDividerAfterByConversation ?? {},
      recentlyUsedEmojis: state.recentlyUsedEmojis ?? [],
      phoneNotesByCharacter: state.phoneNotesByCharacter ?? {},
      chatGpdChatsByCharacter: state.chatGpdChatsByCharacter ?? {},
    },
    ...(debug ? { debug } : {}),
  };
}

function chatRoleFromTimeline(role: TimelineMessageEntry['role']): MessageRecord['role'] {
  if (role === 'assistant') {
    return 'output';
  }
  return role;
}

function chatMessageFromTimelineEntry(
  entry: TimelineMessageEntry,
  numericId: number,
  messageIdsByTimelineId: Map<string, number>,
  session: RpgraphSessionV2,
  dataUrlForMediaRef: (ref: string) => string,
): MessageRecord {
  const imageAttachments = entry.images
    ?.map((ref) => session.entities.images[ref.imageId])
    .filter((image): image is NonNullable<typeof image> => !!image);
  const embeddedPhoneMessages = entry.embeddedPhoneMessageIds
    ?.map((timelineId) => {
      const linkedEntry = session.timeline.find(
        (candidate): candidate is TimelineMessageEntry =>
          candidate.kind === 'message' && candidate.id === timelineId,
      );
      const phoneMessageId = messageIdsByTimelineId.get(timelineId);
      if (!linkedEntry || phoneMessageId === undefined) {
        return undefined;
      }
      return {
        phoneMessageId,
        from: linkedEntry.phone?.from ?? '',
        to: linkedEntry.phone?.to ?? '',
        message: linkedEntry.text.original,
        translatedMessage: linkedEntry.text.translated,
      };
    })
    .filter((message): message is NonNullable<typeof message> => !!message);
  const embeddedSocialMessages = entry.embeddedSocialMessageIds
    ?.map((timelineId) => {
      const linkedEntry = session.timeline.find(
        (candidate): candidate is TimelineMessageEntry =>
          candidate.kind === 'message' && candidate.id === timelineId,
      );
      const socialMessageId = messageIdsByTimelineId.get(timelineId);
      const directMessage = linkedEntry?.socialDirectMessage;
      if (!directMessage || socialMessageId === undefined) {
        return undefined;
      }
      return {
        socialMessageId,
        app: directMessage.app,
        from: directMessage.from,
        to: directMessage.to,
        message: directMessage.text,
        translatedMessage: directMessage.displayText,
      };
    })
    .filter((message): message is NonNullable<typeof message> => !!message);
  return {
    id: numericId,
    role: chatRoleFromTimeline(entry.role),
    originalText: entry.text.original,
    translatedText: entry.text.translated,
    imageAttachments: imageAttachments?.length ? imageAttachments : undefined,
    includeInHistory: entry.flags?.includeInHistory,
    channel: entry.channel,
    eventInput: entry.flags?.eventInput,
    eventDisplayText: entry.eventDisplayText,
    phoneMessage: entry.channel === 'phone',
    phoneFrom: entry.phone?.from,
    phoneTo: entry.phone?.to,
    phoneVoiceMessage: entry.phone?.voiceMessage,
    embeddedPhoneMessages: embeddedPhoneMessages?.length ? embeddedPhoneMessages : undefined,
    embeddedSocialMessages: embeddedSocialMessages?.length ? embeddedSocialMessages : undefined,
    embeddedPhoneTextBefore: entry.embeddedPhoneText?.before,
    embeddedPhoneTextAfter: entry.embeddedPhoneText?.after,
    embeddedPhoneTranslatedTextBefore: entry.embeddedPhoneText?.translatedBefore,
    embeddedPhoneTranslatedTextAfter: entry.embeddedPhoneText?.translatedAfter,
    phoneImageIds: entry.channel === 'phone'
      ? entry.phone?.imageIds ?? entry.images?.map((image) => image.imageId)
      : undefined,
    phoneImageDescription: entry.channel === 'phone' ? entry.imageDescription ?? entry.phone?.imageDescription : undefined,
    phoneImageCaptionChange: entry.channel === 'phone' ? entry.imageCaptionChange : undefined,
    replyToMessageId: entry.replyToMessageId
      ? messageIdsByTimelineId.get(entry.replyToMessageId)
      : undefined,
    inputMessageFormat: entry.inputMessageFormat,
    inputPromptSlot: entry.inputPromptSlot,
    rpImageDescription: entry.channel === 'rp' ? entry.imageDescription : undefined,
    rpImageName: entry.channel === 'rp' ? entry.imageLabel : undefined,
    outputActionChoices: entry.outputActions?.choices,
    outputActionsHidden: entry.outputActions?.hidden,
    outputActionsHiddenByTurnId: entry.outputActions?.hiddenByTurnId,
    outputActionInfoBoxes: entry.outputActions?.infoBoxes,
    outputActionProgressBars: entry.outputActions?.progressBars,
    outputActionContextCapacityBars: entry.outputActions?.contextCapacityBars,
    isOpening: entry.flags?.opening,
    speakerName: entry.speakers?.primary,
    speakerNames: entry.speakers?.names,
    speakerColors: entry.speakers?.colors,
    originalDialogue: entry.speakers?.originalDialogue,
    translatedDialogue: entry.speakers?.translatedDialogue,
    turnContext: entry.turnContext,
    phoneAutoTurnSource: entry.phoneAutoTurnSource,
    // Loose opening messages (the "Opening" situation bubble) had no turn id
    // in RAM; saving wraps them in a synthesized `opening-message-*` turn.
    // Restoring that id would break the opening-bubble matching in App.tsx.
    turnId: entry.flags?.opening && entry.turnId.startsWith('opening-message-')
      ? undefined
      : entry.turnId,
    turnNumber: entry.turnNumber,
    turnPart: entry.phase,
    rpDateTime: entry.rpDateTime,
    workflowVariableSetCommands: entry.workflowVariableSetCommands,
    voiceClips: entry.voiceClips?.map(({ mediaRef, ...clip }) => ({
      ...clip,
      dataUrl: dataUrlForMediaRef(mediaRef),
    })),
    bankTransfer: entry.bankTransfer,
    socialPost: entry.socialPost,
    socialThreadAction: entry.socialThreadAction,
    socialReactions: entry.socialReactions,
    socialDirectMessage: entry.socialDirectMessage,
    createdPhoneNote: entry.createdPhoneNote,
    deletedPhoneNote: entry.deletedPhoneNote,
    simulatedAiChat: entry.simulatedAiChat,
  };
}

function runtimeSnapshotFromSession(
  session: RpgraphSessionV2,
  rehydratedStorybookJson: (json: string) => string,
): TurnRuntimeSnapshot {
  return {
    workflowVariables: workflowVariableRecord(session.runtime.current.workflowVariables),
    nodes: Object.fromEntries(
      Object.entries(session.runtime.current.nodes).map(([nodeId, fields]) => [
        nodeId,
        snapshotFieldsWithConvertedStorybook(structuredClone(fields), rehydratedStorybookJson),
      ]),
    ),
  };
}

export function appStateFromSessionV2(session: RpgraphSessionV2): SessionV2AppState {
  const mediaReader = createMediaPoolReader(session.entities.mediaData);
  const entries = timelineMessages(session.timeline);
  const openingHistoryTurnIds = new Set(
    entries
      .filter((entry) => entry.flags?.openingHistory)
      .map((entry) => entry.turnId),
  );
  const messageIdsByTimelineId = new Map(entries.map((entry, index) => [entry.id, index + 1]));
  const messages = entries.map((entry) =>
    chatMessageFromTimelineEntry(
      entry,
      messageIdsByTimelineId.get(entry.id) ?? 0,
      messageIdsByTimelineId,
      session,
      mediaReader.dataUrlForMediaRef,
    ),
  );
  const turnMetadataByTurnId = new Map(
    entries.flatMap((entry) => (entry.turn ? [[entry.turnId, entry.turn] as const] : [])),
  );
  const messagesByTurnId = new Map<string, MessageRecord[]>();
  messages
    .filter((message) => !message.isOpening)
    .forEach((message) => {
      const key = message.turnId ?? `turn-${message.turnNumber ?? 0}`;
      const grouped = messagesByTurnId.get(key) ?? [];
      grouped.push(message);
      messagesByTurnId.set(key, grouped);
    });
  const turns: TurnRecord[] = [...messagesByTurnId.entries()]
    .map(([turnId, turnMessages]) => {
      const turnNumber = turnMessages.find((message) => message.turnNumber !== undefined)?.turnNumber ?? 0;
      const inputMessages = turnMessages.filter((message) => message.turnPart !== 'output');
      const outputMessages = turnMessages.filter((message) => message.turnPart === 'output');
      const turnMeta = turnMetadataByTurnId.get(turnId);
      return {
        id: turnId,
        number: turnNumber,
        createdAt: turnMeta?.createdAt ?? session.savedAt,
        openingHistory: openingHistoryTurnIds.has(turnId) || undefined,
        mode: turnMeta?.mode,
        messageFormat: turnMeta?.messageFormat,
        promptSlot: turnMeta?.promptSlot,
        directAction: turnMeta?.directAction || undefined,
        input: {
          graphText: turnMeta?.inputGraphText
            ?? inputMessages.map((message) => message.originalText).join('\n\n'),
          messages: inputMessages,
        },
        output: {
          graphText: turnMeta?.outputGraphText
            ?? outputMessages.map((message) => message.originalText).join('\n\n'),
          messages: outputMessages,
        },
      };
    })
    .sort((left, right) => left.number - right.number);
  return {
    settings: {
      englishProcessingEnabled: session.metadata.settings.englishProcessingEnabled,
      inputTranslationOnlyEnabled: session.metadata.settings.inputTranslationOnlyEnabled,
      displayLanguage: session.metadata.settings.displayLanguage,
    },
    workflowVariables: workflowVariableRecord(session.runtime.current.workflowVariables),
    turns,
    turnCheckpoints: session.runtime.undo.map((checkpoint) =>
      checkpointWithConvertedStorybooks(
        structuredClone(checkpoint),
        mediaReader.rehydratedStorybookJson,
      ),
    ),
    openingMessages: messages.filter((message) => message.isOpening),
    currentRuntime: runtimeSnapshotFromSession(session, mediaReader.rehydratedStorybookJson),
    phoneSeenByConversation: session.ui.phoneSeenByConversation,
    bankingSeenByCharacter: session.ui.bankingSeenByCharacter,
    phoneAppSeenByCharacter: session.ui.phoneAppSeenByCharacter ?? {},
    bankingContactsByCharacter: session.ui.bankingContactsByCharacter,
    socialLikesByAccount: session.ui.socialLikesByAccount,
    dynamicSocialUsers: normalizeDynamicSocialUsers(session.ui.dynamicSocialUsers),
    socialConnectionsByCharacter: normalizeSocialConnectionsByCharacter(
      session.ui.socialConnectionsByCharacter,
    ),
    onlyFriendsPurchasesByCharacter: session.ui.onlyFriendsPurchasesByCharacter,
    phoneDividerAfterByConversation: session.ui.phoneDividerAfterByConversation,
    recentlyUsedEmojis: session.ui.recentlyUsedEmojis ?? [],
    phoneNotesByCharacter: normalizePhoneNotesByCharacter(session.ui.phoneNotesByCharacter),
    chatGpdChatsByCharacter: normalizeChatGpdChatsByCharacter(session.ui.chatGpdChatsByCharacter),
  };
}

export function latestSessionV2TurnNumber(session: RpgraphSessionV2) {
  return timelineMessages(session.timeline).reduce(
    (latest, entry) => Math.max(latest, entry.turnNumber),
    0,
  );
}
