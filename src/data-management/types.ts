import type { Edge } from '@xyflow/react';
import type { RpStorybookV1 } from '../nodes/rp-storybook-v1/model';
import type {
  BankTransferRecord,
  SocialDirectMessageRecord,
  SocialPostRecord,
  SocialReactionsRecord,
  SocialThreadActionRecord,
  CharacterStatsState,
  ChatDialogueQuote,
  ChatImageAttachment,
  ImageCaptionChange,
  MessageVoiceClip,
  NodeLlmCallStats,
  RpAppointment,
  WorkflowFile,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowVariableSetCommand,
} from '../types';
import type { SessionFormatVersion, SessionWorkflowFormatVersion } from '../session/version';
import type {
  ChatGpdChatsByCharacter,
  CreatedPhoneNoteCommit,
  DeletedPhoneNoteCommit,
  PhoneNotesByCharacter,
  SimulatedAiChatCommit,
} from '../chat/phoneAppsSessions';
import type {
  DynamicSocialUsers,
  SocialConnectionsByCharacter,
} from '../chat/socialDirectory';

type AssistantContextEncodingMode = 'toon-default' | 'json-default';

export type WorkflowFileV2 = {
  format: 'rpgraph-workflow';
  formatVersion: SessionWorkflowFormatVersion;
  savedAt: string;
  viewport?: WorkflowFile['viewport'];
  graph: {
    nodes: WorkflowNode[];
    edges: Edge[];
  };
  defaults?: {
    connectionId?: string;
    assistantContextEncoding?: AssistantContextEncodingMode;
  };
};

type SpeakerAttribution = {
  primary?: string;
  names?: string[];
  colors?: Record<string, string>;
  originalDialogue?: ChatDialogueQuote[];
  translatedDialogue?: ChatDialogueQuote[];
};

type PhoneMetadata = {
  from: string;
  to: string;
  voiceMessage?: boolean;
  embeddedInMessageId?: string;
  imageIds?: string[];
  imageDescription?: string;
};

export type ImageRef = {
  imageId: string;
};

export type TimelineMessageEntry = {
  id: string;
  kind: 'message';
  turnId: string;
  turnNumber: number;
  phase: 'input' | 'output';
  channel: 'rp' | 'phone';
  role: 'user' | 'assistant' | 'error';
  text: {
    original: string;
    translated?: string;
  };
  speakers?: SpeakerAttribution;
  phone?: PhoneMetadata;
  images?: ImageRef[];
  embeddedPhoneMessageIds?: string[];
  embeddedSocialMessageIds?: string[];
  embeddedPhoneText?: {
    before?: string;
    after?: string;
    translatedBefore?: string;
    translatedAfter?: string;
  };
  replyToMessageId?: string;
  flags?: {
    opening?: boolean;
    openingHistory?: boolean;
    includeInHistory?: boolean;
    eventInput?: boolean;
    autoTurn?: boolean;
    narrator?: boolean;
  };
  eventDisplayText?: string;
  imageDescription?: string;
  imageLabel?: string;
  imageCaptionChange?: ImageCaptionChange;
  inputMessageFormat?: number;
  inputPromptSlot?: number;
  rpDateTime?: string;
  workflowVariableSetCommands?: WorkflowVariableSetCommand[];
  voiceClips?: MessageVoiceClip[];
  bankTransfer?: BankTransferRecord;
  socialPost?: SocialPostRecord;
  socialThreadAction?: SocialThreadActionRecord;
  socialReactions?: SocialReactionsRecord;
  socialDirectMessage?: SocialDirectMessageRecord;
  createdPhoneNote?: CreatedPhoneNoteCommit;
  deletedPhoneNote?: DeletedPhoneNoteCommit;
  simulatedAiChat?: SimulatedAiChatCommit;
};

export type TimelineEventEntry = {
  id: string;
  kind: 'event-change';
  turnId?: string;
  eventIds: string[];
  operation: 'add' | 'update' | 'complete' | 'cancel' | 'delete';
};

type TimelineStateEntry = {
  id: string;
  kind: 'state';
  turnId?: string;
  label: string;
  refs?: Record<string, string[]>;
};

type TimelineSystemEntry = {
  id: string;
  kind: 'system';
  turnId?: string;
  text: string;
};

export type TimelineEntry =
  | TimelineMessageEntry
  | TimelineEventEntry
  | TimelineStateEntry
  | TimelineSystemEntry;

type StorybookEntity = {
  sourceNodeId: string;
  value: RpStorybookV1;
  fileName?: string;
  filePath?: string;
};

export type EventEntity = {
  id: string;
  status: 'upcoming' | 'completed' | 'cancelled';
  title: string;
  scheduledAt?: string;
  condition?: string;
  details?: string;
  channel?: 'chat' | 'phone';
  phone?: {
    from?: string;
    to?: string;
    requester?: string;
    messenger?: string;
    recipient?: string;
    action?: string;
  };
  requestedBy?: string;
  assignedTo?: string;
  source: {
    turnId?: string;
    turnNumber?: number;
    messageIds?: string[];
    storybookOpening?: boolean;
    note?: string;
  };
};

export type ImageEntity = ChatImageAttachment;

type CharacterStatsEntity = {
  state: CharacterStatsState;
  baselineState?: CharacterStatsState;
  updatedAtRpDateTime?: string;
};

type MemoryEntity = {
  id: string;
  name: string;
  text: string;
  mode: 'joined' | 'input' | 'output';
};

export type SessionEntities = {
  storybook?: StorybookEntity;
  events: Record<string, EventEntity>;
  images: Record<string, ImageEntity>;
  characterStats?: CharacterStatsEntity;
  memory: Record<string, MemoryEntity>;
};

type NodeRuntimeState = Record<string, unknown>;

export type RuntimeState = {
  nodes: Record<string, NodeRuntimeState>;
  workflowVariables: Record<string, string>;
};

export type TurnCheckpoint = {
  turnId: string;
  createdTimelineEntryIds: string[];
  workflowVariables?: {
    before: Record<string, string>;
    after: Record<string, string>;
  };
  nodeSnapshots: Record<string, {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }>;
  eventSnapshots?: Record<string, {
    before?: EventEntity;
    after?: EventEntity;
  }>;
};

type SessionRuntime = {
  current: RuntimeState;
  undo: TurnCheckpoint[];
};

type SessionUiState = {
  phoneSeenByConversation: Record<string, number>;
  bankingSeenByCharacter: Record<string, number>;
  phoneAppSeenByCharacter?: Record<string, number>;
  bankingContactsByCharacter: Record<string, string[]>;
  socialLikesByAccount: Record<string, string[]>;
  dynamicSocialUsers: DynamicSocialUsers;
  socialConnectionsByCharacter: SocialConnectionsByCharacter;
  onlyFriendsPurchasesByCharacter: Record<string, Record<string, number>>;
  phoneDividerAfterByConversation: Record<string, number>;
  selectedEventId?: string;
  openedPhoneConversationKey?: string;
  recentlyUsedEmojis?: string[];
  phoneNotesByCharacter?: PhoneNotesByCharacter;
  chatGpdChatsByCharacter?: ChatGpdChatsByCharacter;
};

export type DebugLlmCall = NodeLlmCallStats & {
  nodeId: string;
  createdAt: string;
  promptPreview?: string;
  responsePreview?: string;
};

export type NodeDiagnostic = {
  label: string;
  entries: Array<{
    createdAt: string;
    level: 'info' | 'warning' | 'error';
    text: string;
  }>;
};

export type SessionDebugState = {
  recentLlmCalls: DebugLlmCall[];
  nodeDiagnostics: Record<string, NodeDiagnostic>;
};

export type RpgraphSessionV2 = {
  format: 'rpgraph-session';
  formatVersion: SessionFormatVersion;
  savedAt: string;
  name: string;
  metadata: {
    settings: {
      englishProcessingEnabled: boolean;
      inputTranslationOnlyEnabled?: boolean;
      displayLanguage: string;
    };
  };
  workflow: WorkflowFileV2;
  timeline: TimelineEntry[];
  entities: SessionEntities;
  runtime: SessionRuntime;
  ui: SessionUiState;
  debug?: SessionDebugState;
};

type NodeDataPolicy = {
  persisted: readonly string[];
  runtime: readonly string[];
  checkpoint: readonly string[];
  debug?: readonly string[];
};

export type NodeDataPolicyByType = Partial<Record<WorkflowNodeType, NodeDataPolicy>>;

export type ContextEncoding = 'toon' | 'json-compact' | 'json-pretty' | 'text';

export type ContextViewOptions = {
  encoding: ContextEncoding;
  maxEntries?: number;
  includeDebug?: boolean;
  includeDerivedText?: boolean;
};

export function eventEntityFromAppointment(
  appointment: RpAppointment,
  options: { storybookOpening?: boolean; messageIds?: string[] } = {},
): EventEntity {
  return {
    id: appointment.id,
    status: appointment.status,
    title: appointment.title,
    scheduledAt: appointment.scheduledAt,
    condition: appointment.condition,
    details: appointment.details,
    channel: appointment.channel,
    phone: {
      from: appointment.phoneFrom,
      to: appointment.phoneTo,
      requester: appointment.phoneRequester,
      messenger: appointment.phoneMessenger,
      recipient: appointment.phoneRecipient,
      action: appointment.phoneAction,
    },
    requestedBy: appointment.requestedBy,
    assignedTo: appointment.assignedTo,
    source: {
      turnId: appointment.sourceTurnId,
      turnNumber: appointment.sourceTurnNumber,
      messageIds: options.messageIds,
      storybookOpening: options.storybookOpening,
      note: appointment.sourceNote,
    },
  };
}

export function appointmentFromEventEntity(event: EventEntity): RpAppointment {
  return {
    id: event.id,
    scheduledAt: event.scheduledAt,
    title: event.title,
    condition: event.condition,
    details: event.details,
    channel: event.channel,
    phoneFrom: event.phone?.from,
    phoneTo: event.phone?.to,
    phoneRequester: event.phone?.requester,
    phoneMessenger: event.phone?.messenger,
    phoneRecipient: event.phone?.recipient,
    phoneAction: event.phone?.action,
    requestedBy: event.requestedBy,
    assignedTo: event.assignedTo,
    sourceTurnId: event.source.turnId ?? '',
    sourceTurnNumber: event.source.turnNumber,
    sourceNote: event.source.note,
    status: event.status,
  };
}
