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
import { currentWorkflowFormatVersion } from '../workflow/version';
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
  bankingContactsByCharacter: Record<string, string[]>;
  socialLikesByAccount: Record<string, string[]>;
  phoneDividerAfterByConversation: Record<string, number>;
  recentlyUsedEmojis?: string[];
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
  bankingContactsByCharacter?: Record<string, string[]>;
  socialLikesByAccount?: Record<string, string[]>;
  phoneDividerAfterByConversation?: Record<string, number>;
  recentlyUsedEmojis?: string[];
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

export function sessionV2FromCurrentState(
  state: SessionV2CurrentStateInput,
  workflow: WorkflowFile,
  runtimeNodes: WorkflowNode[],
  savedAt = new Date().toISOString(),
): RpgraphSessionV2 {
  const entities = entitiesFromCurrentState(runtimeNodes, state.turns);
  const timeline = [
    ...timelineFromTurnRecordsWithOpeningMessages(state.turns, state.openingMessages, savedAt),
    ...eventTimelineEntriesFromEntities(entities.events),
  ];
  const debug = debugStateFromNodes(runtimeNodes, savedAt);
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
    entities,
    runtime: {
      current: runtimeStateFromNodes(runtimeNodes, state.workflowVariables),
      undo: state.turnCheckpoints,
    },
    ui: {
      phoneSeenByConversation: state.phoneSeenByConversation ?? {},
      bankingSeenByCharacter: state.bankingSeenByCharacter ?? {},
      bankingContactsByCharacter: state.bankingContactsByCharacter ?? {},
      socialLikesByAccount: state.socialLikesByAccount ?? {},
      phoneDividerAfterByConversation: state.phoneDividerAfterByConversation ?? {},
      recentlyUsedEmojis: state.recentlyUsedEmojis ?? [],
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
    isOpening: entry.flags?.opening,
    speakerName: entry.speakers?.primary,
    speakerNames: entry.speakers?.names,
    speakerColors: entry.speakers?.colors,
    originalDialogue: entry.speakers?.originalDialogue,
    translatedDialogue: entry.speakers?.translatedDialogue,
    turnId: entry.turnId,
    turnNumber: entry.turnNumber,
    turnPart: entry.phase,
    rpDateTime: entry.rpDateTime,
    workflowVariableSetCommands: entry.workflowVariableSetCommands,
    voiceClips: entry.voiceClips,
    bankTransfer: entry.bankTransfer,
    socialPost: entry.socialPost,
    socialThreadAction: entry.socialThreadAction,
    socialReactions: entry.socialReactions,
  };
}

function runtimeSnapshotFromSession(session: RpgraphSessionV2): TurnRuntimeSnapshot {
  return {
    workflowVariables: workflowVariableRecord(session.runtime.current.workflowVariables),
    nodes: Object.fromEntries(
      Object.entries(session.runtime.current.nodes).map(([nodeId, fields]) => [
        nodeId,
        structuredClone(fields),
      ]),
    ),
  };
}

export function appStateFromSessionV2(session: RpgraphSessionV2): SessionV2AppState {
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
    ),
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
      return {
        id: turnId,
        number: turnNumber,
        createdAt: session.savedAt,
        openingHistory: openingHistoryTurnIds.has(turnId) || undefined,
        input: {
          graphText: inputMessages.map((message) => message.originalText).join('\n\n'),
          messages: inputMessages,
        },
        output: {
          graphText: outputMessages.map((message) => message.originalText).join('\n\n'),
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
    turnCheckpoints: session.runtime.undo,
    openingMessages: messages.filter((message) => message.isOpening),
    currentRuntime: runtimeSnapshotFromSession(session),
    phoneSeenByConversation: session.ui.phoneSeenByConversation,
    bankingSeenByCharacter: session.ui.bankingSeenByCharacter,
    bankingContactsByCharacter: session.ui.bankingContactsByCharacter,
    socialLikesByAccount: session.ui.socialLikesByAccount,
    phoneDividerAfterByConversation: session.ui.phoneDividerAfterByConversation,
    recentlyUsedEmojis: session.ui.recentlyUsedEmojis ?? [],
  };
}

export function latestSessionV2TurnNumber(session: RpgraphSessionV2) {
  return timelineMessages(session.timeline).reduce(
    (latest, entry) => Math.max(latest, entry.turnNumber),
    0,
  );
}
