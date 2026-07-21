import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { encode } from '@toon-format/toon';
import packageMetadata from '../package.json';
import {
  ImagePreviewDialog,
  CustomNodeAssistantDialog,
  OutputFormatHelpDialog,
  RunLlmReportDialog,
  StorybookCreatorDialog,
  SystemLogDialog,
} from './components/AppDialogs';
import {
  AssistantDialog,
  type AssistantMessage as AssistantChatMessage,
  type DebugSnapshotAssistantSection,
} from './components/AssistantDialog';
import { ChatConversationPanel } from './components/ChatConversationPanel';
import { EventsPanel } from './components/EventsPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PhonePanel } from './components/PhonePanel';
import { useChatGpdPhoneApp } from './chat/useChatGpdPhoneApp';
import { useAutoplay, type AutoplayRunRequest } from './chat/useAutoplay';
import { PhoneTab } from './chat/PhoneTab';
import {
  autoplayMessageFormat,
  localActivityPromptSlot,
  socialMediaMessageFormat,
} from './chat/messageFormats';
import { PromptPresetOverview } from './components/PromptPresetOverview';
import { ResourceMonitor } from './components/ResourceMonitor';
import {
  autoTurnNarratorInstruction,
  autoTurnNarratorPhoneInstruction,
  autoTurnPhoneInstruction,
  autoTurnRpInstruction,
  autoTurnInstructionSettings,
  eventChatDisplayText,
  eventGraphInputText,
} from './chat/instructions';
import {
  canonicalPhoneName,
  parsePhoneGraphInput,
  phoneNamesMatch,
  type ParsedPhoneMessage,
} from './chat/phoneMessages';
import { useNextTurnReferenceImages } from './chat/useNextTurnReferenceImages';
import { shieldTranslationEmoji, restoreTranslationEmoji } from './chat/translationEmojiShield';
import { type OutputActionContextCapacityRequest } from './chat/outputActions';
import {
  applyTimeCommandsToWorkflowNodes,
  structuredInputPayload,
  type CommandInputCommand,
  type StructuredInputCommand,
} from './chat/structuredCommands';
import {
  directInputPrompt,
  translationPrompt,
} from './chat/inputTransforms';
import {
  bankingSeenStateFromMessages,
  bankTransferMessages,
} from './chat/bankTransfers';
import {
  socialDirectMessageInputText,
  socialIdentityMatches,
  socialPostInputText,
  socialThreadActionInputText,
  socialThreadRunContextFromInput,
} from './chat/socialMedia';
import {
  extractDialogueQuotes,
} from './chat/textRendering';
import {
  imageGenerationAssistantPrompt,
  parseImageGenerationAssistantResult,
} from './chat/imageGenerationAssistant';
import { lastTurnMessages } from './data-management/historyStore';
import {
  chatAttachmentFromStorybookImage,
  findChatEndpoints,
  storybookOpeningSituation,
  storyCharactersFromNodes,
  type StorybookCharacter,
} from './storybook/runtime';
import {
  formatDebugSnapshot as formatDataManagementDebugSnapshot,
  formatEventsContext,
  formatPhoneContext,
  formatTimelineContext,
} from './data-management/formatters';
import {
  compactDebugNode,
  type DebugSnapshot,
  compactDebugValue,
  recentTurnDebugSummaries,
  sanitizeDebugSnapshotValue,
} from './app/debugSnapshot';
import { useTurnTraceState } from './app/useTurnTraceState';
import { createWorkflowAssistantSnapshotJson } from './assistant/workflowSnapshot';
import {
  suggestedSessionNameFromCharacters,
  suggestedWorkflowNameFromPath,
  workflowSnapshotFromGraph,
} from './app/workflowSnapshot';
import { hydrateLoadedWorkflow, type HydratedWorkflow } from './app/workflowHydration';
import {
  lastMessage,
  narratorCharacterId,
  narratorSpeakerName,
} from './app/runOrchestration';
import {
  useGraphRun,
  type OutputAttribution,
  type PhoneMessageSound,
} from './app/useGraphRun';
import { useDirectAppActions } from './app/useDirectAppActions';
import {
  latestHistoryRpDateTime,
  phoneConversationKey,
  phoneMessageShouldBeMarkedSeen,
  phoneSeenStateFromMessages,
} from './data-management/selectors';
import {
  appStateFromSessionV2,
  latestSessionV2TurnNumber,
  sessionV2FromCurrentState,
  type SessionV2CurrentStateInput,
  workflowV2ToWorkflowFile,
} from './data-management/sessionStore';
import { isRpgraphSessionV2 } from './data-management/validation';
import type { RpgraphSessionV2 } from './data-management/types';
import { LiveRunClock } from './components/LiveRunClock';
import {
  appointmentsFromEventEntities,
  eventEntitiesFromNodes,
  normalizeEventAppointments,
} from './data-management/eventStore';
import { useStorybookActions } from './storybook/useStorybookActions';
import { storybookImageIdsUsedByMessages } from './storybook/imageUsage';
import storybookFormatVersions from './storybook/formatVersions.json';
import {
  openingHistoryEventsFromNodes,
  openingHistoryChatGpdChatsFromNodes,
  openingHistoryCheckpointsFromNodes,
  openingHistoryDynamicSocialUsersFromNodes,
  openingHistoryNotesFromNodes,
  openingHistorySocialConnectionsFromNodes,
  openingHistorySocialLikesFromNodes,
  openingHistoryTurnsFromNodes,
  remapOpeningTurnMessageIds,
} from './storybook/openingHistoryRuntime';
import {
  deletePhoneNotesForTurn,
  mergePhoneAppRecordsByCharacter,
  replaceCreatedPhoneNotesForTurn,
  replaceSimulatedAiChatsForTurn,
} from './chat/phoneAppsSessions';
import {
  archivedSimulatedAiChatIds,
  revertCreatedPhoneNotesForMessages,
  revertSimulatedAiChatsForMessages,
} from './chat/phoneAppHistoryMessages';
import {
  flattenTurnMessages,
  lastSessionTurn,
  lastSessionTurnIndex,
  restoreTurnRuntime,
  turnMessageIds,
} from './chat/turns';
import { useTurnRecordState } from './chat/useTurnRecordState';
import { currentSessionFormatVersion } from './session/version';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { StudioDialogs } from './dialogs/StudioDialogs';
import { ComfyGeneratedImageDialog } from './comfy/ComfyGeneratedImageDialog';
import { isComfyVoiceConnection } from './comfy/connectionRole';
import { useDialogueVoice } from './chat/useDialogueVoice';
import { latestOutputTurnMessages } from './chat/dialogueVoiceSegments';
import { WelcomeDialog } from './components/WelcomeDialog';
import { WorkflowCapabilityStrip } from './components/WorkflowCapabilityStrip';
import {
  withSourceNodeStatusConnectionColors,
  workflowEdgeType,
} from './graph/edges';
import { WorkflowEdge } from './graph/WorkflowEdge';
import { validatePortConnection } from './graph/portCompatibility';
import { useImageAttachments } from './hooks/useImageAttachments';
import { useSystemLog } from './hooks/useSystemLog';
import type { NodeLlmApi } from './llm/NodeLlmApi';
import {
  isGeminiConnection,
  isLmStudioConnection,
  isOllamaConnection,
  isLlamaCppConnection,
  isOpenRouterConnection,
} from './llm/providerKind';
import { TextMetricsApi } from './llm/tokenMetrics';
import { encodedDataUrlBytes, normalizeImageAttachment } from './utils/imageNormalization';
import { NodeActionsContext } from './nodes/NodeActionsContext';
import type { OutputFormatHelpKind } from './nodes/output/formatHelp';
import type { ExecuteTraceFormatResult } from './nodes/types';
import { getRegisteredCoreNode } from './nodes/registry';
import type { NodeViewValues } from './nodes/types';
import { NodeViewContext } from './nodes/NodeViewContext';
import { WorkflowNodeRenderer } from './nodes/WorkflowNodeRenderer';
import { resetCharacterStatsRuntimeData } from './nodes/character-stats/runtime';
import { contextCompressionCapacitySegments } from './nodes/context-compression/capacity';
import {
  defaultRpStorybookImageDescriptionPrompt,
  emptyRpStorybook,
  parseRpStorybookJson,
  type RpStorybookCharacterImage,
  type RpStorybook,
} from './nodes/rp-storybook/model';
import {
  buildOutputSpeakerPrompt,
  outputSpeakerFormatInstructions,
  outputSpeakerResponseFormat,
  parseOutputSpeakerResponse,
  speakerDataForFormat,
} from './nodes/output/speakerPrompt';
import {
  defaultChatPanelWidth,
  defaultConnection,
  useAppSettings,
} from './settings';
import {
  incompatibleSessionStatus,
  incompatibleStorybookStatus,
  incompatibleCharacterCardStatus,
  incompatibleWorkflowStatus,
  useRpgraphFiles,
  workflowName,
} from './app/useRpgraphFiles';
import { useUiScaling } from './app/useUiScaling';
import { useNodePalette } from './app/useNodePalette';
import { useRunLifecycle } from './app/useRunLifecycle';
import { useProviderConnections } from './app/useProviderConnections';
import { useNodeLlmApi } from './app/useNodeLlmApi';
import { useRuntimeNodePatching } from './app/useRuntimeNodePatching';
import { useNodeActionsController } from './app/useNodeActionsController';
import { useRoleplayPanelRuntime } from './app/useRoleplayPanelRuntime';
import { useWorkflowVariables } from './app/useWorkflowVariables';
import { useWorkflowCapabilities } from './app/useWorkflowCapabilities';
import { useCustomNodeAssistant } from './app/useCustomNodeAssistant';
import { useStorybookPhoneImages } from './storybook/useStorybookPhoneImages';
import type {
  ChatImageAttachment,
  ImageCaptionChange,
  InputActionSelection,
  MessageRecord,
  SocialDirectMessageRecord,
  SocialPostRecord,
  SocialReactionComment,
  SocialThreadActionRecord,
  MessageVoiceClip,
  OutputActionContextCapacityBar,
  ConnectionPreset,
  RpAppointment,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  SavedFileSummary,
  WorkflowFile,
  WorkflowNode,
  WorkflowNodeData,
} from './types';
import type { WorkflowVariableSetCommand } from './workflow';
import {
  currentWorkflowFormatVersion,
  createInitialEdges,
  createInitialNodes,
  formatChatHistory,
  formatLastMessageForContext,
  persistentNodeData,
  validEstimatedTokenBytesPerToken,
} from './workflow';

const currentStorybookFormatVersion = storybookFormatVersions.storybook;

type CopiedGraphSelection = {
  nodes: WorkflowNode[];
  edges: Edge[];
};

type DeletedGraphRestoreAction = {
  nodes: WorkflowNode[];
  edges: Edge[];
};




const maxDeletedNodeRestoreActions = 30;

const phoneMessageSoundUrls = {
  sent: new URL('./assets/sounds/message-send.mp3', import.meta.url).href,
  received: new URL('./assets/sounds/new-notification.mp3', import.meta.url).href,
} as const;

const phoneMessageAudio = new Map<PhoneMessageSound, HTMLAudioElement>();

function phoneMessageAudioElement(sound: PhoneMessageSound) {
  const cached = phoneMessageAudio.get(sound);
  if (cached) {
    return cached;
  }
  const audio = new Audio(phoneMessageSoundUrls[sound]);
  audio.preload = 'auto';
  phoneMessageAudio.set(sound, audio);
  return audio;
}

function primePhoneMessageSounds() {
  (Object.keys(phoneMessageSoundUrls) as PhoneMessageSound[]).forEach((sound) => {
    const audio = phoneMessageAudioElement(sound);
    const previousMuted = audio.muted;
    audio.muted = true;
    const playPromise = audio.play();
    if (playPromise) {
      void playPromise
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = previousMuted;
        })
        .catch(() => {
          audio.muted = previousMuted;
        });
    } else {
      audio.muted = previousMuted;
    }
  });
}

function playPhoneMessageSound(sound: PhoneMessageSound) {
  const audio = phoneMessageAudioElement(sound);
  audio.muted = false;
  audio.pause();
  audio.currentTime = 0;
  void audio.play().catch(() => {
    // Browsers may block audio until the user has interacted with the page.
  });
}

function storedAutoTurnInputText(graphText: string) {
  const withoutMarker = graphText.replace(/^\[AUTO TURN\]\s*/i, '').trim();
  const phoneInput = parsePhoneGraphInput(withoutMarker);
  if (!phoneInput) {
    return withoutMarker;
  }
  const separatorIndex = withoutMarker.indexOf(':');
  const text = separatorIndex >= 0 ? withoutMarker.slice(separatorIndex + 1).trim() : withoutMarker;
  return text || `${phoneInput.from} texts ${phoneInput.to}.`;
}

function storedNarratorInputText(graphText: string) {
  return graphText.replace(/^Narrator:\s*/i, '').trim();
}

function normalizedEventAppointments(appointments: WorkflowNodeData['eventAppointments']) {
  return normalizeEventAppointments(appointments ?? []);
}

function phoneSeenStateForLoadedMessages(messages: MessageRecord[]) {
  return phoneSeenStateFromMessages(messages);
}

function mergeSeenStates(...states: Array<Record<string, number> | undefined>) {
  return states.reduce<Record<string, number>>((merged, state) => {
    Object.entries(state ?? {}).forEach(([key, value]) => {
      merged[key] = Math.max(merged[key] ?? 0, value);
    });
    return merged;
  }, {});
}

function lastMessageNodeText(
  message: MessageRecord | undefined,
  includeRpDateTime: boolean | undefined,
  rpDateTimeFormat: RpDateTimeFormat,
  rpWeekdayLanguage: RpWeekdayLanguage,
) {
  if (!message) {
    return '';
  }
  return formatLastMessageForContext(
    message,
    false,
    rpDateTimeFormat,
    rpWeekdayLanguage,
    includeRpDateTime ?? false,
  );
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    '',
  );
}

function workflowFileMissing(error: unknown) {
  return errorMessage(error).includes('ENOENT');
}

function displayStorybookName(
  headerStorybookFileName: string | undefined,
  headerStorybookJson: string | undefined,
  activeSessionFileName: string | null,
) {
  if (headerStorybookFileName) {
    return `${headerStorybookFileName} (file)`;
  }
  if (!headerStorybookJson) {
    return 'not loaded';
  }
  try {
    const storybook = parseRpStorybookJson(headerStorybookJson);
    const title = storybook.title || 'untitled';
    return `${title} - embedded in ${activeSessionFileName ? 'RP' : 'WF'}`;
  } catch {
    return `embedded in ${activeSessionFileName ? 'RP' : 'WF'}`;
  }
}

const assistantConnectionStorageKey = 'rpgraph.assistantConnectionId';

function loadAssistantConnectionId() {
  try {
    return window.localStorage.getItem(assistantConnectionStorageKey) || undefined;
  } catch {
    return undefined;
  }
}

const minChatPanelWidth = 779;
const minGraphPanelWidth = 520;
const phoneEmojiOptions = [
  '🙂',
  '😀',
  '😂',
  '😊',
  '😍',
  '😘',
  '😏',
  '😢',
  '😡',
  '😳',
  '👍',
  '❤️',
  '🤣',
  '🥰',
  '😇',
  '😉',
  '🤔',
  '🙄',
  '😅',
  '😭',
  '😎',
  '🤗',
  '🙏',
  '🔥',
  '👌',
  '👏',
  '💯',
  '✨',
  '🎉',
  '💀',
  '🥺',
  '😬',
  '🤩',
  '😴',
  '🤦',
  '💔',
  '🥳',
  '😋',
  '😜',
  '🤪',
  '🤤',
  '😒',
  '😔',
  '😩',
  '😤',
  '😱',
  '😰',
  '🤢',
  '🤮',
  '🤫',
  '🥱',
  '🤐',
  '🤨',
  '😐',
  '😑',
  '😶',
  '💩',
  '🤡',
  '👾',
  '👽',
  '👻',
  '👑',
  '💸',
  '👀',
  '💪',
  '✌️',
  '🤟',
  '🤞',
  '🤙',
  '🎈',
  '🍀',
  '🌟',
];

const pastePositionOffset = 36;
const connectionRadius = 66;
const reconnectRadius = 54;
const fitViewPadding = 0.12;

function isEditableKeyboardTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    !!target.closest('input, textarea, select, [contenteditable="true"]')
  );
}

function normalizedCharacterName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function textMentionsCharacter(text: string, character: StorybookCharacter) {
  const names = [
    character.name,
    character.name.trim().split(/\s+/)[0] ?? '',
  ].filter(Boolean);
  return names.some((name) => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapedName}($|[^\\p{L}\\p{N}_])`, 'iu').test(text);
  });
}

function sameNodeViewNodes(left: WorkflowNode[], right: WorkflowNode[]) {
  return left.length === right.length && left.every((node, index) => {
    const other = right[index];
    return (
      !!other &&
      node.id === other.id &&
      node.type === other.type &&
      node.data === other.data &&
      node.style === other.style
    );
  });
}

function eventStoryCharacter(event: RpAppointment, characters: StorybookCharacter[]) {
  const explicitName = event.assignedTo ?? event.requestedBy;
  if (explicitName) {
    const normalizedExplicitName = normalizedCharacterName(explicitName);
    const explicitMatch = characters.find(
      (character) =>
        normalizedCharacterName(character.name) === normalizedExplicitName ||
        normalizedCharacterName(character.name.trim().split(/\s+/)[0] ?? '') === normalizedExplicitName,
    );
    if (explicitMatch) {
      return explicitMatch;
    }
  }

  const eventText = [event.title, event.details, event.condition].filter(Boolean).join('\n');
  const mentionedCharacters = characters.filter((character) => textMentionsCharacter(eventText, character));
  return mentionedCharacters.length === 1 ? mentionedCharacters[0] : characters[0];
}

type PreviewImageState = {
  image: ChatImageAttachment;
};

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>(createInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(createInitialEdges());
  const nodesRef = useRef(nodes);
  const commitNodes = useCallback((nextNodes: WorkflowNode[]) => {
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
  }, [setNodes]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  // Dragging recreates `nodes` every frame with only positions changed; keep a
  // semantically-stable array so downstream memos only recompute on real changes.
  // Guarded render-phase setState is React's sanctioned previous-render pattern.
  const [nodeViewNodes, setNodeViewNodes] = useState(nodes);
  if (!sameNodeViewNodes(nodeViewNodes, nodes)) {
    setNodeViewNodes(nodes);
  }
  const [showWelcome, setShowWelcome] = useState(() => {
    return window.localStorage.getItem('rpgraph.welcomeSeen') !== 'true';
  });
  const {
    connections,
    setConnections,
    defaultConnectionId,
    setDefaultConnectionId,
    englishProcessingEnabled,
    setEnglishProcessingEnabled,
    inputTranslationOnlyEnabled,
    setInputTranslationOnlyEnabled,
    displayLanguage,
    setDisplayLanguage,
    tokenEstimateBytesPerToken,
    setTokenEstimateBytesPerToken,
    autoCalibrateTokenEstimate,
    setAutoCalibrateTokenEstimate,
    calibratedTokenBytesPerToken,
    setCalibratedTokenBytesPerToken,
    workflowSettingsValues,
    setWorkflowSettingsValues,
    promptActionCustomPresets,
    setPromptActionCustomPresets,
    promptActionSettings,
    setPromptActionSettings,
    promptTextCustomPresets,
    setPromptTextCustomPresets,
    chatTextSize,
    setChatTextSize,
    phoneChatTextSize,
    setPhoneChatTextSize,
    phoneDesktopLayout,
    setPhoneDesktopLayout,
    phoneDesktopIconSize,
    setPhoneDesktopIconSize,
    chatGpdSidebarOpen,
    setChatGpdSidebarOpen,
    chatGpdSidebarWidth,
    setChatGpdSidebarWidth,
    chatGpdModel,
    setChatGpdModel,
    smoothChatAutoScrollEnabled,
    setSmoothChatAutoScrollEnabled,
    smoothChatAutoScrollMinSpeed,
    setSmoothChatAutoScrollMinSpeed,
    thoughtTextStyle,
    setThoughtTextStyle,
    rpDateTimeFormat,
    setRpDateTimeFormat,
    rpWeekdayLanguage,
    setRpWeekdayLanguage,
    showReferenceImagesInContext,
    setShowReferenceImagesInContext,
    referenceImageTurnLookback,
    setReferenceImageTurnLookback,
    maxReferenceImages,
    setMaxReferenceImages,
    chatPanelWidth: storedChatPanelWidth,
    setChatPanelWidth: setStoredChatPanelWidth,
    settingsLoadComplete,
    settingsStatus,
    glassDesignEnabled,
    setGlassDesignEnabled,
    glassDesignOpacity,
    setGlassDesignOpacity,
    nodeTextSize,
    setNodeTextSize,
    uiScale,
    setUiScale,
    retryFormatErrorsEnabled,
    setRetryFormatErrorsEnabled,
    dialogueVoiceMode,
    setDialogueVoiceMode,
    dialogueNarratorProviderId,
    setDialogueNarratorProviderId,
    dialogueCloneVoiceProviderId,
    setDialogueCloneVoiceProviderId,
    phoneNotificationSwitchHintSeen,
    setPhoneNotificationSwitchHintSeen,
  } = useAppSettings();
  const {
    appliedUiScale,
    minUiScale: minimumAllowedUiScale,
    maxUiScale: allowedUiScale,
    changeUiScale,
  } = useUiScaling(uiScale, setUiScale);
  const activeTokenEstimateBytesPerToken = validEstimatedTokenBytesPerToken(
    autoCalibrateTokenEstimate
      ? calibratedTokenBytesPerToken ?? tokenEstimateBytesPerToken
      : tokenEstimateBytesPerToken,
  );
  function isLlmConnection(connection: ConnectionPreset) {
    return connection.kind !== 'comfyui';
  }
  function firstLlmConnection(connectionsToSearch = connections) {
    return connectionsToSearch.find(isLlmConnection) ?? defaultConnection;
  }
  const connectionHasVision = useCallback((connectionId?: string) => {
    const connection = connections.find(
      (entry) => entry.id === (connectionId ?? defaultConnectionId),
    );
    return !!connection && isLlmConnection(connection) && !!connection.vision;
  }, [connections, defaultConnectionId]);
  const nodeHasVision = useCallback((node: WorkflowNode) => {
    return node.data.kind === undefined && connectionHasVision(node.data.connectionId);
  }, [connectionHasVision]);
  function nodeCanUseUploadedImages(node: WorkflowNode) {
    return (
      node.data.kind === undefined &&
      (
        node.data.nodeType === 'llm-prompt' ||
        node.data.nodeType === 'llm-prompt-switch' ||
        node.data.nodeType === 'custom'
      )
    );
  }
  const imageUploadVisionEnabled = useMemo(
    () => nodeViewNodes.some((node) => nodeCanUseUploadedImages(node) && nodeHasVision(node)),
    [nodeHasVision, nodeViewNodes],
  );
  const referenceImageOptions = useMemo(
    () => ({
      enabled: showReferenceImagesInContext && imageUploadVisionEnabled,
      turnLookback: referenceImageTurnLookback,
      maxImages: maxReferenceImages,
    }),
    [imageUploadVisionEnabled, showReferenceImagesInContext, referenceImageTurnLookback, maxReferenceImages],
  );
  const {
    definitions: settingsValueDefinitions,
    definitionsRef: settingsValueDefinitionsRef,
    resolvedValues: resolvedWorkflowSettingsValues,
    valuesRef: workflowSettingsValuesRef,
    replaceValues: replaceWorkflowSettingsValues,
    valuesForGraph: workflowSettingsValuesForGraph,
    changeValue: changeWorkflowSettingsValue,
    setValuesFromCommands: setWorkflowVariablesFromCommands,
    addValue: addWorkflowSettingsValue,
    renameValue: renameWorkflowSettingsValue,
    removeValue: removeWorkflowSettingsValue,
  } = useWorkflowVariables({
    nodes: nodeViewNodes,
    edges,
    values: workflowSettingsValues,
    setValues: setWorkflowSettingsValues,
    setNodes,
  });
  const [draft, setDraft] = useState('');
  const [draftCommands, setDraftCommands] = useState<CommandInputCommand[]>([]);
  const [draftImages, setDraftImages] = useState<ChatImageAttachment[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [previewImage, setPreviewImage] = useState<PreviewImageState | null>(null);
  const {
    isRunning,
    setIsRunning,
    runLlmReport,
    setRunLlmReport,
    showRunLlmReport,
    setShowRunLlmReport,
    runDurationMs,
    setRunDurationMs,
    runHistory,
    setRunHistory,
    workflowComfyGenerationActive,
    updateWorkflowComfyGenerationActive,
    activeRunRef,
    activeRunId,
    setActiveRunId,
    lastRunDebugRef,
    activeRunCancelReasonRef,
    activeRunLlmReportRef,
    pendingRunRestartRef,
    runStartTimeRef,
    runEndTimeRef,
    runStartTimeMs,
    setRunStartTimeMs,
    cancelCurrentRun,
  } = useRunLifecycle();
  const autoplayGraphRunRef = useRef<((request: AutoplayRunRequest) => Promise<boolean>) | null>(null);
  const requestAutoplayRun = useCallback(
    (request: AutoplayRunRequest) => autoplayGraphRunRef.current?.(request) ?? Promise.resolve(false),
    [],
  );
  const autoplay = useAutoplay({
    isRunning,
    runAutoplay: requestAutoplayRun,
    cancelAutoplayRun: () => {
      cancelCurrentRun('cancel');
    },
  });
  const [characterDropdownOpen, setCharacterDropdownOpen] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [textDialogNodeId, setTextDialogNodeId] = useState<string | null>(null);
  const [textDialogView, setTextDialogView] =
    useState<
      | 'text'
      | 'output-highlighting'
      | 'character-stats-context'
      | 'character-stats-response'
      | 'character-stats-prompts'
      | 'character-stats-chart'
      | 'history-time-response'
      | 'event-manager-response'
      | 'event-manager-appointments'
    >('text');
  const [jsonDialogNodeId, setJsonDialogNodeId] = useState<string | null>(null);
  const [nodeAssistantNodeId, setNodeAssistantNodeId] = useState<string | null>(null);
  const [nodeAssistantHistories, setNodeAssistantHistories] = useState<Record<string, AssistantChatMessage[]>>({});
  const [assistantConnectionId, setAssistantConnectionId] = useState<string | undefined>(
    loadAssistantConnectionId,
  );
  const [workflowAssistantOpen, setWorkflowAssistantOpen] = useState(false);
  const [workflowAssistantMessages, setWorkflowAssistantMessages] = useState<AssistantChatMessage[]>([]);
  const [outputFormatHelpKind, setOutputFormatHelpKind] =
    useState<OutputFormatHelpKind | null>(null);
  const [chatWidth, setChatWidth] = useState(defaultChatPanelWidth);
  const [isChatPanelOpen, setIsChatPanelOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [showDeletedNodeRestoreButton, setShowDeletedNodeRestoreButton] = useState(false);
  const [activeWorkflowProtection, setActiveWorkflowProtection] = useState<'plain' | 'encrypted'>('plain');
  const [activeStorybookProtection, setActiveStorybookProtection] = useState<'plain' | 'encrypted'>('plain');
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<WorkflowNode> | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<WorkflowNode> | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const characterDropdownRef = useRef<HTMLDivElement | null>(null);
  const {
    messages,
    setMessages,
    messagesRef,
    turns,
    setTurns,
    turnsRef,
    setTurnCheckpoints,
    turnCheckpointsRef,
    nextMessageIdRef,
    activeTurnCollectorRef,
    appendMessage,
    updateMessage,
    updateHistoryMessageTimes,
    updatePhoneImageDescriptions,
    removeMessage,
    replaceLastTurnCreatedPhoneNote,
    removeLastTurnCreatedPhoneNote,
    applyTurnRuntime,
    applyTurnCheckpointRuntime,
    removeTurnCheckpoint,
    commitCollectedTurn,
  } = useTurnRecordState({
    nodesRef,
    setNodes,
    workflowVariablesRef: workflowSettingsValuesRef,
    setWorkflowVariables: replaceWorkflowSettingsValues,
  });
  const storeMessageVoiceClip = useCallback((messageId: number, clip: MessageVoiceClip) => {
    const existingMessage = messagesRef.current.find((message) => message.id === messageId);
    if (!existingMessage) {
      return;
    }
    const existingClips = existingMessage.voiceClips ?? [];
    if (existingClips.some((entry) =>
      entry.speakerName === clip.speakerName &&
      entry.text === clip.text &&
      entry.source === clip.source
    )) {
      return;
    }
    updateMessage(messageId, {
      voiceClips: [...existingClips, clip],
    });
  }, [messagesRef, updateMessage]);
  const {
    turnTraces,
    recordTurnTrace,
    removeTurnTracesForTurn,
    clearTurnTraces,
  } = useTurnTraceState();
  const notifySystemRef = useRef<(level: 'info' | 'warning' | 'error', message: string) => void>(() => {});
  const { characterStorybookNodes } = useMemo(() => findChatEndpoints(nodeViewNodes), [nodeViewNodes]);
  const storybooksByNodeId = useMemo(() => {
    return new Map(
      nodeViewNodes.flatMap((node) => {
        if (node.data.kind !== undefined || node.data.nodeType !== 'rp-storybook' || !node.data.storybookJson) {
          return [];
        }
        try {
          const storybook = parseRpStorybookJson(node.data.storybookJson);
          return [[node.id, storybook] as const];
        } catch {
          return [];
        }
      }),
    );
  }, [nodeViewNodes]);
  const {
    chatPanelView,
    selectChatPanelView,
    selectPhonePanelView,
    cyclePhoneNotificationOwner,
    setSelectedCharacterId,
    selectedCharacter,
    narratorSelected,
    storyCharacters,
    phoneCharacters,
    characterColors,
    viewedPhoneCharacter,
    phoneGalleryImages,
    selectChatCharacter,
    rememberChatCharacter,
    openPhoneConversation,
    phoneContacts,
    selectedPhoneContact,
    openPhoneContact,
    switchActivePlayer,
    selectedPhoneConversation,
    selectedPhoneDividerAfterId,
    eventManagerAvailable,
    upcomingEvents,
    selectedEvent,
    selectedEventId,
    setSelectedEventId,
    closeEvent,
    cancelEvent,
    highlightedEventIds,
    unreadPhoneConversations,
    unreadPhoneNotificationCount,
    viewedPhoneHasNotifications,
    unreadPhoneSwitchName,
    openUnreadPhoneConversation,
    openEmbeddedPhoneMessage,
    openEmbeddedSocialMessage,
    openSocialPost,
    socialPostOpenRequest,
    socialDirectMessageOpenRequest,
    socialImageById,
    socialLikesByAccount,
    setSocialLikesByAccount,
    socialDirectoryUsers,
    fotogramContactsByCharacter,
    dynamicSocialUsers,
    setDynamicSocialUsers,
    socialConnectionsByCharacter,
    setSocialConnectionsByCharacter,
    addSocialConnection,
    phoneNotesByCharacter,
    setPhoneNotesByCharacter,
    chatGpdChatsByCharacter,
    setChatGpdChatsByCharacter,
    toggleSocialLike,
    onlyFriendsPurchasesByCharacter,
    setOnlyFriendsPurchasesByCharacter,
    unlockOnlyFriendsPost,
    unreadEventCount,
    unreadChatCount,
    unreadBankingCount,
    markViewedBankingSeen,
    phoneAppNotificationCounts,
    markViewedPhoneAppSeen,
    markViewedSocialDmSeen,
    unreadSocialDirectMessages,
    phoneAppSeenByCharacter,
    setPhoneAppSeenByCharacter,
    phoneAuthorBadgesEnabled,
    changePhoneAuthorBadgesEnabled,
    chatReadsPhoneAppsEnabled,
    changeChatReadsPhoneAppsEnabled,
    autoTurnDisabled,
    autoTurnTitle,
    switchPlayerDisabled,
    switchPlayerTitle,
    highlightedPhoneMessage,
    phoneSeenByConversation,
    setPhoneSeenByConversation,
    bankingSeenByCharacter,
    setBankingSeenByCharacter,
    bankingContactsByCharacter,
    setBankingContactsByCharacter,
    addBankingContact,
    markSelectedPhoneConversationSeen,
    phoneHomeRequestId,
    phoneDividerAfterByConversation,
    setPhoneDividerAfterByConversation,
    openedPhoneConversationKey,
    setOpenedPhoneConversationKey,
    phoneReplyToMessage,
    selectPhoneReply,
    clearPhoneReply,
    phoneDraft,
    setPhoneDraft,
    phoneDraftCommands,
    setPhoneDraftCommands,
    phoneImages,
    setPhoneImages,
    showPhoneEmojiPicker,
    setShowPhoneEmojiPicker,
    recentlyUsedEmojis,
    setRecentlyUsedEmojis,
    setRecentChatCharacterIds,
    chatThreadRef,
    phoneImageInputRef,
    phoneEmojiPickerRef,
    phoneThreadRef,
    scrollPhoneThreadToBottom,
    scrollChatThreadToBottomIfFollowing,
    selectPhoneReplyFromComposer,
    selectPhoneGalleryImageFromComposer,
    selectPhoneEmoji,
  } = useRoleplayPanelRuntime({
    nodeViewNodes,
    nodesRef,
    messages,
    turns,
    storybooksByNodeId,
    characterStorybookNodeCount: characterStorybookNodes.length,
    imageUploadVisionEnabled,
    englishProcessingEnabled,
    smoothChatAutoScrollEnabled,
    smoothChatAutoScrollMinSpeed,
    isRunning,
    commitNodes,
    notifySystem: (level, message) => notifySystemRef.current(level, message),
  });
  const usedStorybookImageIds = useMemo(
    () => storybookImageIdsUsedByMessages(messages),
    [messages],
  );
  const {
    contextualImageIds: contextualReferenceImageIds,
    selectedImageIds: selectedReferenceImageIds,
    nextTurnOptions: nextTurnReferenceImageOptions,
    optionsForRun: referenceImageOptionsForRun,
    toggleSelectedImage: toggleReferenceImage,
    retainMessageImages: retainReplyReferenceImages,
    clearSelectedImages: clearTemporaryReferenceImages,
  } = useNextTurnReferenceImages({
    messages,
    nodes: nodeViewNodes,
    options: referenceImageOptions,
    replyToMessage: phoneReplyToMessage,
  });
  const pendingViewport = useRef<WorkflowFile['viewport']>(undefined);
  const pendingFitView = useRef(false);
  const uniqueId = () => crypto.randomUUID();
  const {
    systemLog,
    systemLogCounts,
    systemLogBadgeCount,
    visibleLogEntry,
    showSystemLog,
    setShowSystemLog,
    notifySystem,
    clearSystemLog,
    resetSystemLog,
  } = useSystemLog();
  useEffect(() => {
    notifySystemRef.current = notifySystem;
  }, [notifySystem]);
  const replaceCurrentChatWithOpeningHistoryRef = useRef(false);
  const {
    updateRuntimeNode,
    updateLlmNodeActive,
    recordNodeLlmCall,
    clearAllRunActiveTimers,
  } = useRuntimeNodePatching({
    nodesRef,
    commitNodes,
    activeRunRef,
    activeRunLlmReportRef,
    setRunLlmReport,
    openingHistorySignature: storybookOpeningHistorySignature,
    onStorybookOpeningHistoryChanged: syncOpeningHistoryFromNodes,
    replaceCurrentChatWithOpeningHistoryRef,
  });
  const {
    showConnections,
    comfyPreview,
    setComfyPreview,
    editingConnection,
    connectionDraftPending,
    availableConnectionModels,
    availableComfyModels,
    comfyWorkflowInspection,
    connectionStatus,
    providerHealthById,
    imageAssistantModelStateById,
    comfyProviderActionActive,
    voiceGenerationActive,
    lmStudioModelActionActive,
    ollamaModelActionActive,
    editingConnectionCapabilities,
    editingConnectionSupportedVoices,
    editingConnectionSupportedParameters,
    comfyWorkflowRepairStatus,
    comfyWorkflowRepairReady,
    comfyWorkflowRepairInspection,
    modelCapabilitiesSourceLabel,
    openConnectionManager,
    openOpenRouterTtsSetup,
    closeConnectionManager,
    selectConnection,
    newConnection,
    applyProviderPreset,
    applyComfyConnectionRole,
    editConnection,
    loadConnectionModels,
    deleteConnection,
    checkConnectionModels,
    loadComfyModelLists,
    connectionFromEditingConnection,
    selectBundledComfyWorkflow,
    confirmComfyWorkflowSetup,
    repairComfyWorkflow,
    applyComfyWorkflowRepair,
    generateComfyTestImage,
    unloadComfyModels,
    loadLmStudioModel,
    unloadLmStudioModels,
    loadOllamaModel,
    unloadOllamaModels,
    loadLlamaCppModel,
    unloadLlamaCppModels,
    unloadAllProviderModelsForClose,
    applyConnectionToAllNodes,
    checkProviderConnection,
    checkProviderConnectionById,
    checkProviderConnections,
    loadCharacterComfyLoras,
    generateCharacterComfyPreview,
    generateImageAssistantImages,
    prepareImageAssistantLlmProvider,
    setImageAssistantLlmModelLoaded,
    unloadImageAssistantComfyModel,
    refreshImageAssistantModelState,
    generateCharacterVoicePreview,
    unloadCharacterComfyModels,
    resolveConnection,
  } = useProviderConnections({
    connections,
    setConnections,
    defaultConnectionId,
    setDefaultConnectionId,
    settingsLoadComplete,
    isRunning,
    nodesRef,
    setNodes,
    notifySystem,
  });
  const narratorProviderOptions = connections.flatMap((connection) => {
    const status = providerHealthById[connection.id]?.status ?? 'unknown';
    if (isComfyVoiceConnection(connection) && connection.comfyNarratorVoice?.dataUrl) {
      return [{ value: connection.id, label: `${connection.label} — ComfyUI narrator`, status }];
    }
    const capabilities = providerHealthById[connection.id]?.capabilities;
    if (
      (isOpenRouterConnection(connection) || isGeminiConnection(connection)) &&
      capabilities?.voice === true &&
      capabilities.text !== true &&
      connection.ttsVoice
    ) {
      return [{ value: connection.id, label: `${connection.label} — ${connection.ttsVoice}`, status }];
    }
    return [];
  });
  const resolvedNarratorProviderId = narratorProviderOptions.some(
    (option) => option.value === dialogueNarratorProviderId,
  )
    ? dialogueNarratorProviderId
    : narratorProviderOptions[0]?.value ?? '';
  const cloneVoiceProviderOptions = connections
    .filter(isComfyVoiceConnection)
    .map((connection) => ({
      value: connection.id,
      label: connection.label,
      status: providerHealthById[connection.id]?.status ?? 'unknown',
    }));
  const resolvedCloneVoiceProviderId = cloneVoiceProviderOptions.some(
    (option) => option.value === dialogueCloneVoiceProviderId,
  )
    ? dialogueCloneVoiceProviderId
    : cloneVoiceProviderOptions[0]?.value ?? '';
  // A voice provider can be selectable in the Voice Playback dialog while its
  // setup is still incomplete (e.g. OpenRouter TTS without an API key). Surface
  // the health detail as a warning next to the provider picker.
  const voiceProviderSetupWarning = (connectionId: string) => {
    if (!connectionId) {
      return null;
    }
    const health = providerHealthById[connectionId];
    if (!health || health.status === 'online' || health.status === 'checking') {
      return null;
    }
    return health.detail ?? 'Provider is not connected.';
  };
  const narratorProviderWarning = voiceProviderSetupWarning(resolvedNarratorProviderId);
  const cloneVoiceProviderWarning = voiceProviderSetupWarning(resolvedCloneVoiceProviderId);
  const {
    dialogueVoiceSpeakerNames,
    narratorVoiceReady,
    narratorOnlyReady,
    apiNarratorGenerationActive,
    activeDialogueVoiceKey,
    readAloudActive,
    speakDialogue,
    preloadTurnVoices,
    readMessagesAloud,
    readMessagesAsNarrator,
    readTextAsApiNarratorEarly,
    generateVoiceMessageClip,
    stopDialogueVoice,
  } = useDialogueVoice({
    storyCharacters,
    connections,
    messages,
    englishProcessingEnabled,
    cloneVoiceProviderId: resolvedCloneVoiceProviderId,
    narratorOnlyProviderId: resolvedNarratorProviderId,
    generateVoiceClip: generateCharacterVoicePreview,
    generateApiNarratorClip: (connection, input, onChunk) =>
      isGeminiConnection(connection)
        ? window.rpgraph.generateGeminiSpeech({ connection, input }, onChunk)
        : window.rpgraph.generateOpenRouterSpeech({ connection, input }, onChunk),
    unloadVoiceModels: unloadCharacterComfyModels,
    onVoiceClipGenerated: storeMessageVoiceClip,
    notifySystem,
  });
  const dialogueVoicePreloadDisabledReason = !connections.some(isComfyVoiceConnection)
    ? 'Requires a ComfyUI voice provider.'
    : dialogueVoiceSpeakerNames.size === 0
      ? 'Requires at least one character voice sample in the storybook.'
      : null;
  const charactersWithoutVoice = storyCharacters
    .filter((character) => !character.voiceConfig?.sampleDataUrl)
    .map((character) => character.name);
  const dialogueVoiceReadAloudDisabledReason =
    dialogueVoicePreloadDisabledReason ??
    (!narratorVoiceReady
      ? 'Requires a narrator voice sample in the ComfyUI voice provider.'
      : charactersWithoutVoice.length > 0
        ? `Requires a voice sample for every storybook character (missing: ${charactersWithoutVoice.join(', ')}).`
      : null);
  const dialogueNarratorOnlyDisabledReason = narratorOnlyReady
    ? null
    : 'Requires a configured ComfyUI narrator, OpenRouter TTS, or Google Gemini TTS provider.';

  useEffect(() => {
    return window.rpgraph.onWindowCleanupBeforeClose(async () => {
      try {
        await unloadAllProviderModelsForClose();
      } finally {
        await window.rpgraph.finishWindowCloseCleanup();
      }
    });
  }, [unloadAllProviderModelsForClose]);
  const wasRunningForDialogueVoiceRef = useRef(false);
  useEffect(() => {
    const wasRunning = wasRunningForDialogueVoiceRef.current;
    wasRunningForDialogueVoiceRef.current = isRunning;
    if (isRunning === wasRunning) {
      return;
    }
    if (isRunning) {
      // Voice generation unloads local LLM models; never keep it running into a chat run.
      stopDialogueVoice();
      return;
    }
    if (dialogueVoiceMode === 'preload') {
      void preloadTurnVoices(latestOutputTurnMessages(messages));
    } else if (dialogueVoiceMode === 'read-aloud') {
      void readMessagesAloud(latestOutputTurnMessages(messages));
    } else if (dialogueVoiceMode === 'narrator-only') {
      void readMessagesAsNarrator(latestOutputTurnMessages(messages));
    }
  }, [
    isRunning,
    dialogueVoiceMode,
    messages,
    preloadTurnVoices,
    readMessagesAloud,
    readMessagesAsNarrator,
    stopDialogueVoice,
  ]);
  const {
    showFiles,
    setShowFiles,
    savedFiles,
    selectedFile,
    setSelectedFile,
    workflowNameDraft,
    setWorkflowNameDraft,
    storybookNameDraft,
    setStorybookNameDraft,
    characterNameDraft,
    setCharacterNameDraft,
    fileStorageStatus,
    setFileStorageStatus,
    workflowOverwritePending,
    setWorkflowOverwritePending,
    activeSessionFileName,
    setActiveSessionFileName,
    activeSessionSavedTurn,
    setActiveSessionSavedTurn,
    activeSessionPathRef,
    activeSessionProtection,
    setActiveSessionProtection,
    activeSessionPasswordRef,
    sessionName,
    setSessionName,
    sessionPassword,
    setSessionPassword,
    sessionPasswordAction,
    setSessionPasswordAction,
    fileProtection,
    setFileProtection,
    workflowSaveScope,
    setWorkflowSaveScope,
    sessionOverwritePending,
    setSessionOverwritePending,
    chooseSaveLocation,
    setChooseSaveLocation,
    returnToFilesAfterSaveRef,
    pendingSessionFilePath,
    setPendingSessionFilePath,
    setPendingStorybookLoad,
    activeWorkflowPath,
    activeWorkflowFileName,
    activeWorkflowResetSnapshotRef,
    activateWorkflowPath,
    refreshFiles,
    openFiles,
    saveNamedWorkflow,
    requestExportWorkflow,
    requestSaveStorybook,
    requestSaveCharacter,
    openStoredFile,
    deleteStoredFile,
    requestSaveSession,
    requestOpenFile,
    saveSession,
    saveStorybook,
    saveCharacter,
    unlockStorybookFile,
    unlockOpenFilePath,
    unlockStoredFile,
    saveCurrentSession,
    loadStartupWorkflow,
    restoreDefaultWorkflow,
    resetWorkflow,
    saveCurrentWorkflow,
  } = useRpgraphFiles({
    currentWorkflowForSave,
    currentSession,
    currentStorybookForSave,
    latestSessionTurnNumber,
    suggestedWorkflowName,
    suggestedSessionName,
    applyLoadedRpgraphFile,
    applyLoadedWorkflow,
    applyStorybookToNode: (...args) => applyStorybookToNode(...args),
    updateRuntimeNode,
    notifySystem,
    errorMessage,
    workflowFileMissing,
    setActiveWorkflowProtection,
    setActiveStorybookProtection,
    clearWorkspaceForLockedStartup,
  });
  const nodeLlm = useNodeLlmApi({
    resolveConnection,
    recordCall: recordNodeLlmCall,
  });
  const customNodeAssistant = useCustomNodeAssistant({
    nodes: nodeViewNodes,
    nodesRef,
    edges,
    inputImages: [...draftImages, ...phoneImages],
    nodeLlm,
    updateRuntimeNode,
  });
  const {
    imageDescriptionById: storybookImageDescriptionById,
    imageCaptionChangesById: phoneImageCaptionChangesById,
    currentImageSourceById: currentStorybookImageSourceById,
    allowPhoneContactPair: allowStorybookPhoneContactPair,
    changePhoneWallpaper: changeStorybookPhoneWallpaper,
    saveSocialUsername: saveStorybookSocialUsername,
    imageIdsFromAttachments,
    imageDescriptionFromAttachments,
    ensureImagesForCharacter: ensureImagesForStorybookCharacter,
    ensurePhoneImages: ensurePhoneImagesInStorybooks,
    changeCaptionUpdate: changeImageCaptionUpdate,
    pruneExternalImagesForMessages: pruneStorybookExternalImagesForMessages,
    applyPhoneImageAction: applyPhoneImageActionFromLlm,
  } = useStorybookPhoneImages({
    storybooksByNodeId,
    storyCharacters,
    messages,
    messagesRef,
    nodesRef,
    currentTurnInputMessages: () => activeTurnCollectorRef.current?.inputMessages ?? [],
    updateRuntimeNode,
    updateMessage,
    updatePhoneImageDescriptions,
    notifySystem,
  });
  const chatGpd = useChatGpdPhoneApp({
    nodes,
    nodesRef,
    viewedCharacterId: viewedPhoneCharacter?.id,
    chatsByCharacter: chatGpdChatsByCharacter,
    setChatsByCharacter: setChatGpdChatsByCharacter,
    model: chatGpdModel,
    onModelChange: setChatGpdModel,
    nodeLlm,
    updateLlmNodeActive,
    notifySystem,
  });
  const {
    storybookCreatorNodeId,
    setStorybookCreatorNodeId,
    storybookCreatorMessages,
    storybookCreatorSubmitting,
    openStorybookCreator,
    submitStorybookCreatorMessage,
    updateStorybook,
    applyStorybookToNode,
    importCurrentSessionAsOpeningHistory,
    clearStorybookOpeningHistory,
    resetStorybook,
    importSillyTavernCharacter,
    exportStorybookCharacter,
    deleteStorybookCharacter,
    importCharacterCard,
    showCharacterFiles,
    characterFiles,
    selectedCharacterFile,
    characterFileStatus,
    setSelectedCharacterFile,
    closeCharacterFiles,
    cancelCharacterCardUnlock,
    importSelectedCharacterCard,
    openExternalCharacterCard,
    applyCharacterCardToNode,
    unlockCharacterCard,
    loadStorybookFile,
    pendingStorybookConversion,
    beginPendingStorybookReview,
    improvePendingStorybookConversion,
    applyPendingStorybookConversion,
    cancelPendingStorybookConversion,
  } = useStorybookActions({
    nodesRef,
    turnsRef,
    turnCheckpointsRef,
    replaceCurrentChatWithOpeningHistoryRef,
    nodeLlm,
    updateRuntimeNode,
    errorMessage,
    refreshFiles,
    setPendingStorybookLoad,
    setPendingSessionFilePath,
    setSessionPassword,
    sessionPassword,
    setFileStorageStatus,
    setSessionPasswordAction,
    setActiveStorybookProtection,
    notifySystem,
    usedStorybookImageIds,
    currentSocialLikesByAccount: () => socialLikesByAccount,
    currentDynamicSocialUsers: () => dynamicSocialUsers,
    currentSocialConnectionsByCharacter: () => socialConnectionsByCharacter,
    currentPhoneNotesByCharacter: () => phoneNotesByCharacter,
    currentChatGpdChatsByCharacter: () => chatGpdChatsByCharacter,
    clearCurrentSession: () => clearCurrentSession(),
    requestSaveCharacter,
  });
  async function describeStorybookCharacterImage(
    node: WorkflowNode,
    characterContext: string,
    image: RpStorybookCharacterImage,
    descriptionPrompt: string,
  ) {
    if (node.data.nodeType !== 'rp-storybook') {
      throw new Error('Storybook image descriptions require an RP Storybook node.');
    }
    const prompt = [
      descriptionPrompt.trim() || defaultRpStorybookImageDescriptionPrompt,
      '',
      'Character context:',
      characterContext.trim() || 'Name: selected character',
    ].join('\n');
    const visionEnabled = await nodeLlm.supportsVision(
      node.data.connectionId,
      'Storybook image description',
    );
    if (!visionEnabled) {
      throw new Error('Storybook image descriptions require a provider with Activate vision features enabled.');
    }
    const completion = await nodeLlm.complete({
      connectionId: node.data.connectionId,
      nodeId: node.id,
      label: 'Storybook Image Description',
      prompt,
      images: [image],
      maxTokens: 120,
      temperature: 0.2,
    });
    return completion.text.trim().replace(/^["']|["']$/g, '');
  }
  const {
    addDraftImages,
    addPhoneImages,
    selectDraftImages,
    selectPhoneImages,
  } = useImageAttachments({
    createId: () => `image-${uniqueId()}`,
    setDraftImages,
    setPhoneImages,
    draftImageInputRef: imageInputRef,
    phoneImageInputRef,
    onError: (error) => notifySystem('error', error instanceof Error ? error.message : String(error)),
  });
  const copiedSelection = useRef<CopiedGraphSelection | null>(null);
  const deletedNodeRestoreStack = useRef<DeletedGraphRestoreAction[]>([]);
  const pasteCount = useRef(0);
  const chatWidthRef = useRef(chatWidth);
  const edgesRef = useRef(edges);
  const commitEdges = useCallback((nextEdges: Edge[]) => {
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
  }, [setEdges]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  const nodeTypes = useMemo(() => ({ workflow: WorkflowNodeRenderer }), []);
  const edgeTypes = useMemo<EdgeTypes>(() => ({ [workflowEdgeType]: WorkflowEdge }), []);
  const openingSituation = useMemo(
    () => storybookOpeningSituation(nodeViewNodes),
    [nodeViewNodes],
  );
  const {
    groupedNodePaletteItems,
    nodeMenu,
    setNodeMenu,
    favoriteNodeTypeSet,
    favoriteNodeItems,
    splitWireLink,
    connectNodes,
    reconnectNodes,
    startReconnect,
    finishReconnect,
    openNodeMenu,
    nodeTypeUnavailable,
    addNode,
    toggleFavoriteNodeType,
    startNodeDrag,
    allowNodeDrop,
    dropNode,
  } = useNodePalette({
    nodes,
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
    flowInstance,
    defaultConnectionId,
    messages,
    rpDateTimeFormat,
    rpWeekdayLanguage,
    settingsValueDefinitions,
    createId: uniqueId,
    notifySystem,
  });

  useEffect(() => {
    chatWidthRef.current = chatWidth;
  }, [chatWidth]);

  useEffect(() => {
    if (assistantConnectionId) {
      window.localStorage.setItem(assistantConnectionStorageKey, assistantConnectionId);
    } else {
      window.localStorage.removeItem(assistantConnectionStorageKey);
    }
  }, [assistantConnectionId]);

  useEffect(() => {
    function primeSounds() {
      primePhoneMessageSounds();
    }
    window.addEventListener('pointerdown', primeSounds, { once: true });
    window.addEventListener('keydown', primeSounds, { once: true });
    return () => {
      window.removeEventListener('pointerdown', primeSounds);
      window.removeEventListener('keydown', primeSounds);
    };
  }, []);

  useEffect(() => {
    if (!showPhoneEmojiPicker) {
      return;
    }
    const closePhoneEmojiPicker = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !phoneEmojiPickerRef.current?.contains(event.target)
      ) {
        setShowPhoneEmojiPicker(false);
      }
    };
    document.addEventListener('pointerdown', closePhoneEmojiPicker);
    return () => document.removeEventListener('pointerdown', closePhoneEmojiPicker);
  }, [phoneEmojiPickerRef, setShowPhoneEmojiPicker, showPhoneEmojiPicker]);

  useEffect(() => {
    if (!characterDropdownOpen) {
      return;
    }
    const closeCharacterDropdown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !characterDropdownRef.current?.contains(event.target)
      ) {
        setCharacterDropdownOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeCharacterDropdown);
    return () => document.removeEventListener('pointerdown', closeCharacterDropdown);
  }, [characterDropdownOpen]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }
      const fallbackLlmConnection = connections.find(isLlmConnection) ?? defaultConnection;
      if (!connections.some((connection) => connection.id === defaultConnectionId && isLlmConnection(connection))) {
        setDefaultConnectionId(fallbackLlmConnection.id);
      }
      if (settingsLoadComplete) {
        setAssistantConnectionId((current) =>
          current && connections.some((connection) => connection.id === current && isLlmConnection(connection))
            ? current
            : undefined,
        );
      }
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          (node.data.nodeType === 'llm-prompt' ||
            node.data.nodeType === 'llm-prompt-switch' ||
            node.data.nodeType === 'input' ||
            node.data.nodeType === 'history' ||
            node.data.nodeType === 'output' ||
            node.data.nodeType === 'rp-storybook' ||
            node.data.nodeType === 'character-stats' ||
            node.data.nodeType === 'context-compression') &&
          !connections.some((connection) => connection.id === node.data.connectionId && isLlmConnection(connection))
            ? {
                ...node,
                data: {
                  ...node.data,
                  connectionId: fallbackLlmConnection.id,
                } as WorkflowNodeData,
              }
            : node,
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [connections, defaultConnectionId, settingsLoadComplete, setDefaultConnectionId, setNodes]);

  useEffect(() => {
    setMessages((currentMessages) => {
      const hasStartedConversation = currentMessages.some(
        (message) => !message.isOpening && message.role !== 'error' && message.channel !== 'phone',
      );
      if (hasStartedConversation) {
        messagesRef.current = currentMessages;
        return currentMessages;
      }

      const existingOpening = currentMessages.find((message) =>
        message.isOpening &&
        message.speakerName === 'Opening' &&
        !message.turnId
      );
      if (!openingSituation) {
        const nextMessages = existingOpening
          ? currentMessages.filter((message) => message.id !== existingOpening.id)
          : currentMessages;
        messagesRef.current = nextMessages;
        return nextMessages;
      }

      if (existingOpening) {
        if (existingOpening.originalText === openingSituation) {
          messagesRef.current = currentMessages;
          return currentMessages;
        }
        const nextMessages = currentMessages.map((message) =>
          message.id === existingOpening.id ? { ...message, originalText: openingSituation } : message,
        );
        messagesRef.current = nextMessages;
        return nextMessages;
      }

      const id = nextMessageIdRef.current;
      nextMessageIdRef.current += 1;
      const openingMessage: MessageRecord = {
        id,
        role: 'output',
        originalText: openingSituation,
        includeInHistory: true,
        isOpening: true,
        speakerName: 'Opening',
        speakerNames: ['Opening'],
      };
      const nextMessages = [
        openingMessage,
        ...currentMessages,
      ];
      messagesRef.current = nextMessages;
      return nextMessages;
    });
  }, [messagesRef, nextMessageIdRef, openingSituation, setMessages]);

  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.data.displayTokenBytesPerToken === activeTokenEstimateBytesPerToken
          ? node
          : {
              ...node,
              data: {
                ...node.data,
                displayTokenBytesPerToken: activeTokenEstimateBytesPerToken,
              },
            },
      ),
    );
  }, [activeTokenEstimateBytesPerToken, setNodes]);

  useEffect(() => {
    // Streaming updates the live output message repeatedly. Rebuilding all
    // history strings for every partial chunk creates extreme allocation
    // pressure, especially when messages contain base64 image data. The graph
    // run receives its history directly; node previews only need the completed
    // message once the run has finished.
    if (isRunning) {
      return;
    }
    const rawHistory = JSON.stringify(messages, null, 2);
    const originalHistory = formatChatHistory(
      messages,
      false,
      rpDateTimeFormat,
      rpWeekdayLanguage,
    );
    const translatedHistory = formatChatHistory(
      messages,
      true,
      rpDateTimeFormat,
      rpWeekdayLanguage,
    );
    const latestHistoryMessage = [...messages].reverse().find(
      (message) =>
        message.includeInHistory !== false &&
        (message.role === 'user' || message.role === 'output'),
    );
    const latestTurnHasVisibleInput =
      !!latestHistoryMessage?.turnId &&
      messages.some(
        (message) =>
          message.turnId === latestHistoryMessage.turnId &&
          message.turnPart === 'input' &&
          message.role === 'user' &&
          message.includeInHistory !== false,
      );
    const lastUserMessage =
      latestHistoryMessage?.role === 'output' &&
      latestHistoryMessage.turnId &&
      !latestTurnHasVisibleInput
        ? undefined
        : lastMessage(messages, 'user');
    const lastRpOutputMessage = lastMessage(messages, 'output');
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.data.nodeType === 'history'
          ? {
              ...node,
              data: {
                ...node.data,
                preview: originalHistory ? 'Conversation available' : 'No conversation yet',
                rawHistory,
                originalHistory,
                translatedHistory,
              },
            }
          : node.data.nodeType === 'last-user-input'
            ? {
                ...node,
                data: {
                  ...node.data,
                  preview: lastUserMessage ? 'Last user input available' : 'No user input yet',
                  fullText: lastMessageNodeText(
                    lastUserMessage,
                    node.data.includeRpDateTime,
                    rpDateTimeFormat,
                    rpWeekdayLanguage,
                  ),
                },
              }
          : node.data.nodeType === 'last-rp-output'
            ? {
                ...node,
                data: {
                  ...node.data,
                  preview: lastRpOutputMessage ? 'Last RP output available' : 'No RP output yet',
                  fullText: lastMessageNodeText(
                    lastRpOutputMessage,
                    node.data.includeRpDateTime,
                    rpDateTimeFormat,
                    rpWeekdayLanguage,
                  ),
                },
              }
          : node,
      ),
    );
  }, [isRunning, messages, rpDateTimeFormat, rpWeekdayLanguage, setNodes]);

  useEffect(() => {
    if (settingsLoadComplete) {
      const maximum = Math.max(minChatPanelWidth, window.innerWidth - minGraphPanelWidth);
      queueMicrotask(() => {
        setChatWidth(Math.min(maximum, Math.max(minChatPanelWidth, storedChatPanelWidth)));
      });
    }
  }, [settingsLoadComplete, storedChatPanelWidth]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    function resize(event: PointerEvent) {
      const maximum = Math.max(minChatPanelWidth, window.innerWidth - minGraphPanelWidth);
      const width = Math.min(maximum, Math.max(minChatPanelWidth, window.innerWidth - event.clientX));
      chatWidthRef.current = width;
      setChatWidth(width);
    }

    function stopResize() {
      setIsResizing(false);
      setStoredChatPanelWidth(chatWidthRef.current);
    }

    document.body.classList.add('resizing-panels');
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize);

    return () => {
      document.body.classList.remove('resizing-panels');
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
    };
  }, [isResizing, setStoredChatPanelWidth]);

  useEffect(() => {
    if (!previewImage) {
      return;
    }
    function closePreview(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPreviewImage(null);
      }
    }
    window.addEventListener('keydown', closePreview);
    return () => window.removeEventListener('keydown', closePreview);
  }, [previewImage]);

  function persistentDeletedNodeData(data: WorkflowNodeData) {
    try {
      return persistentNodeData(data);
    } catch {
      return structuredClone(data);
    }
  }

  function updateDeletedNodeRestoreButton() {
    setShowDeletedNodeRestoreButton(deletedNodeRestoreStack.current.length > 0);
  }

  function rememberDeletedNodes(deletedNodes: WorkflowNode[]) {
    if (deletedNodes.length === 0) {
      return;
    }

    const deletedNodeIds = new Set(deletedNodes.map((node) => node.id));
    const connectedEdges = edgesRef.current.filter(
      (edge) => deletedNodeIds.has(edge.source) || deletedNodeIds.has(edge.target),
    );
    deletedNodeRestoreStack.current.push(
      {
        nodes: deletedNodes.map((node) => {
          const storedNode = structuredClone(node);
          return {
            ...storedNode,
            selected: true,
            dragging: false,
            data: persistentDeletedNodeData(node.data),
          };
        }),
        edges: connectedEdges.map((edge) => ({
          ...structuredClone(edge),
          selected: false,
        })),
      },
    );
    if (deletedNodeRestoreStack.current.length > maxDeletedNodeRestoreActions) {
      deletedNodeRestoreStack.current.shift();
    }
    updateDeletedNodeRestoreButton();
  }

  function edgeTargetPortIsFree(edgesToCheck: Edge[], edge: Edge) {
    return !edgesToCheck.some(
      (candidate) =>
        candidate.id !== edge.id &&
        candidate.target === edge.target &&
        (candidate.targetHandle ?? null) === (edge.targetHandle ?? null),
    );
  }

  function restorableDeletedEdges(
    deletedEdges: Edge[],
    restoredNodes: WorkflowNode[],
    currentEdges: Edge[],
  ) {
    const nextNodes = [...nodesRef.current, ...restoredNodes];
    const existingNodeIds = new Set(nextNodes.map((node) => node.id));
    const nextEdges = currentEdges.map((edge) => ({ ...edge, selected: false }));
    const existingEdgeIds = new Set(nextEdges.map((edge) => edge.id));
    const restoredEdges: Edge[] = [];

    for (const edge of deletedEdges) {
      if (
        existingEdgeIds.has(edge.id) ||
        !existingNodeIds.has(edge.source) ||
        !existingNodeIds.has(edge.target) ||
        !edgeTargetPortIsFree(nextEdges, edge)
      ) {
        continue;
      }

      const connection: Connection = {
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? null,
        target: edge.target,
        targetHandle: edge.targetHandle ?? null,
      };
      const compatibility = validatePortConnection(
        nextNodes,
        nextEdges,
        connection,
        undefined,
        settingsValueDefinitionsRef.current,
      );
      if (!compatibility.ok) {
        continue;
      }

      const restoredEdge = { ...structuredClone(edge), selected: false };
      restoredEdges.push(restoredEdge);
      nextEdges.push(restoredEdge);
      existingEdgeIds.add(restoredEdge.id);
    }

    return restoredEdges;
  }

  function restoreLastDeletedNodes() {
    while (deletedNodeRestoreStack.current.length > 0) {
      const deletedAction = deletedNodeRestoreStack.current.pop();
      if (!deletedAction) {
        continue;
      }
      const existingNodeIds = new Set(nodesRef.current.map((node) => node.id));
      const existingSingletonTypes = new Set(
        nodesRef.current
          .filter((node) => node.data.kind === undefined && getRegisteredCoreNode(node.data.nodeType)?.singleton)
          .map((node) => node.data.nodeType),
      );
      const restoredNodes = deletedAction.nodes.filter((node) => {
        if (existingNodeIds.has(node.id)) {
          return false;
        }
        return !getRegisteredCoreNode(node.data.nodeType)?.singleton ||
          !existingSingletonTypes.has(node.data.nodeType);
      });

      if (restoredNodes.length === 0) {
        continue;
      }

      const restoredEdges = restorableDeletedEdges(
        deletedAction.edges,
        restoredNodes,
        edgesRef.current,
      );
      const nextNodes = [
        ...nodesRef.current.map((node) => ({ ...node, selected: false })),
        ...restoredNodes.map((node) => ({
          ...structuredClone(node),
          selected: true,
          dragging: false,
        })),
      ];
      commitNodes(nextNodes);
      if (restoredEdges.length > 0) {
        const nextEdges = [
          ...edgesRef.current.map((edge) => ({ ...edge, selected: false })),
          ...restoredEdges,
        ];
        commitEdges(nextEdges);
      }
      setNodeMenu(null);
      updateDeletedNodeRestoreButton();
      return true;
    }

    updateDeletedNodeRestoreButton();
    return false;
  }
  const restoreLastDeletedNodesRef = useRef(restoreLastDeletedNodes);

  useEffect(() => {
    restoreLastDeletedNodesRef.current = restoreLastDeletedNodes;
  });

  useEffect(() => {
    function onGraphKeyboardShortcut(event: KeyboardEvent) {
      if (
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        isEditableKeyboardTarget(event.target)
      ) {
        return;
      }

      const key = event.key.toLocaleLowerCase();
      if (key === 'z' && !event.shiftKey && !document.querySelector('[role="dialog"], .dialog-backdrop')) {
        if (restoreLastDeletedNodesRef.current()) {
          event.preventDefault();
        }
        return;
      }

      if (key === 'c') {
        if (window.getSelection()?.toString()) {
          return;
        }
        const selectedNodes = nodesRef.current.filter((node) => node.selected);
        if (selectedNodes.length === 0) {
          return;
        }

        const selectedIds = new Set(selectedNodes.map((node) => node.id));
        copiedSelection.current = {
          nodes: selectedNodes.map((node) => ({
            ...node,
            selected: false,
            data: structuredClone(persistentNodeData(node.data)),
          })),
          edges: edgesRef.current
            .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
            .map((edge) => ({ ...edge, selected: false })),
        };
        pasteCount.current = 0;
        event.preventDefault();
        return;
      }

      if (key !== 'v' || !copiedSelection.current) {
        return;
      }

      const copied = copiedSelection.current;
      const existingSingletons = new Set(
        nodesRef.current
          .filter((node) => getRegisteredCoreNode(node.data.nodeType)?.singleton)
          .map((node) => node.data.nodeType),
      );
      const pasteableNodes = copied.nodes.filter(
        (node) =>
          !getRegisteredCoreNode(node.data.nodeType)?.singleton ||
          !existingSingletons.has(node.data.nodeType),
      );
      if (pasteableNodes.length === 0) {
        event.preventDefault();
        return;
      }

      pasteCount.current += 1;
      const offset = pastePositionOffset * pasteCount.current;
      const idMap = new Map(
        pasteableNodes.map((node) => [
          node.id,
          `${node.data.nodeType}-copy-${uniqueId()}`,
        ]),
      );
      const pastedNodes = pasteableNodes.map((node) => {
        const data = node.data.kind === 'incompatible-core-node'
          ? structuredClone(node.data)
          : structuredClone(persistentNodeData(node.data));
        return {
          ...node,
          id: idMap.get(node.id)!,
          position: { x: node.position.x + offset, y: node.position.y + offset },
          selected: true,
          data,
        };
      });
      const pastedEdges = copied.edges.flatMap((edge) => {
        const source = idMap.get(edge.source);
        const target = idMap.get(edge.target);
        return source && target
          ? [{
              ...edge,
              id: `copied-edge-${uniqueId()}`,
              source,
              target,
              selected: false,
            }]
          : [];
      });

      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        ...pastedNodes,
      ]);
      setEdges((currentEdges) => [
        ...currentEdges.map((edge) => ({ ...edge, selected: false })),
        ...pastedEdges,
      ]);
      event.preventDefault();
    }

    window.addEventListener('keydown', onGraphKeyboardShortcut);
    return () => window.removeEventListener('keydown', onGraphKeyboardShortcut);
  }, [setEdges, setNodes]);

  useEffect(() => {
    function handleF1Key(event: KeyboardEvent) {
      if (
        event.key === 'F1' &&
        !event.defaultPrevented &&
        !isEditableKeyboardTarget(event.target) &&
        !document.querySelector('[role="dialog"], .dialog-backdrop')
      ) {
        const selected = nodesRef.current.find((n) => n.selected);
        if (selected) {
          event.preventDefault();
          setNodeAssistantNodeId(selected.id);
        } else {
          event.preventDefault();
          setWorkflowAssistantOpen(true);
        }
      }
    }
    window.addEventListener('keydown', handleF1Key);
    return () => window.removeEventListener('keydown', handleF1Key);
  }, []);

  useEffect(() => {
    if (!settingsLoadComplete) {
      return;
    }
    void loadStartupWorkflow();
    // The last local workflow is loaded once settings are ready at app startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoadComplete]);

  function changeTokenEstimateBytesPerToken(value: number) {
    setTokenEstimateBytesPerToken(validEstimatedTokenBytesPerToken(value));
    setCalibratedTokenBytesPerToken(undefined);
  }

  function changeAutoCalibrateTokenEstimate(enabled: boolean) {
    setAutoCalibrateTokenEstimate(enabled);
    setCalibratedTokenBytesPerToken(undefined);
  }

  function changeEnglishProcessing(enabled: boolean) {
    setEnglishProcessingEnabled(enabled);
    if (enabled) {
      setInputTranslationOnlyEnabled(false);
    }
  }

  function changeInputTranslationOnly(enabled: boolean) {
    setInputTranslationOnlyEnabled(enabled);
    if (enabled) {
      setEnglishProcessingEnabled(false);
    }
  }

  function syncOpeningHistoryFromNodes(nextNodes: WorkflowNode[]) {
    const currentMessages = messagesRef.current;
    const currentTurns = turnsRef.current;
    const replaceCurrentChat = replaceCurrentChatWithOpeningHistoryRef.current;
    replaceCurrentChatWithOpeningHistoryRef.current = false;
    const preservedOpeningSituationMessages = currentMessages.filter(
      (message) => message.isOpening && !message.turnId && message.speakerName === 'Opening',
    );
    const currentOpeningMessageIds = new Set(
      currentTurns
        .filter((turn) => turn.openingHistory)
        .flatMap((turn) => [...turn.input.messages, ...turn.output.messages])
        .map((message) => message.id),
    );
    const nonOpeningMessages = replaceCurrentChat
      ? []
      : currentMessages.filter(
          (message) => !message.isOpening && !currentOpeningMessageIds.has(message.id),
        );
    const highestPreservedMessageId = [...preservedOpeningSituationMessages, ...nonOpeningMessages].reduce(
      (highest, message) => Math.max(highest, message.id),
      0,
    );
    const { remappedTurns, nextId } = remapOpeningTurnMessageIds(
      openingHistoryTurnsFromNodes(nextNodes),
      highestPreservedMessageId + 1,
    );
    const openingMessages = flattenTurnMessages(remappedTurns);
    const nextMessages = [
      ...preservedOpeningSituationMessages,
      ...openingMessages,
      ...nonOpeningMessages,
    ];
    const nextTurns = [
      ...remappedTurns,
      ...(replaceCurrentChat ? [] : currentTurns.filter((turn) => !turn.openingHistory)),
    ];
    const openingCheckpoints = openingHistoryCheckpointsFromNodes(nextNodes);
    const currentOpeningTurnIds = new Set(
      currentTurns.filter((turn) => turn.openingHistory).map((turn) => turn.id),
    );
    const nextTurnCheckpoints = [
      ...openingCheckpoints,
      ...(replaceCurrentChat
        ? []
        : turnCheckpointsRef.current.filter(
            (checkpoint) => !currentOpeningTurnIds.has(checkpoint.turnId),
          )),
    ];

    messagesRef.current = nextMessages;
    turnsRef.current = nextTurns;
    turnCheckpointsRef.current = nextTurnCheckpoints;
    nextMessageIdRef.current = Math.max(
      nextId,
      nextMessages.reduce((highest, message) => Math.max(highest, message.id), 0) + 1,
    );
    setMessages(nextMessages);
    setTurns(nextTurns);
    setTurnCheckpoints(nextTurnCheckpoints);
    setPhoneSeenByConversation((current) =>
      mergeSeenStates(current, phoneSeenStateForLoadedMessages(openingMessages))
    );
    setBankingSeenByCharacter((current) =>
      mergeSeenStates(
        current,
        bankingSeenStateFromMessages(storyCharactersFromNodes(nextNodes), openingMessages),
      )
    );

    // Imported opening histories bring the players' likes back; when the
    // current chat is kept, the imported likes are merged in on top.
    const openingSocialLikes = openingHistorySocialLikesFromNodes(nextNodes);
    setSocialLikesByAccount((current) => {
      if (replaceCurrentChat) {
        return openingSocialLikes;
      }
      const merged = { ...current };
      Object.entries(openingSocialLikes).forEach(([accountKey, postIds]) => {
        const existing = merged[accountKey] ?? [];
        merged[accountKey] = [
          ...existing,
          ...postIds.filter((postId) => !existing.includes(postId)),
        ];
      });
      return merged;
    });

    const openingDynamicSocialUsers = openingHistoryDynamicSocialUsersFromNodes(nextNodes);
    setDynamicSocialUsers((current) =>
      replaceCurrentChat
        ? openingDynamicSocialUsers
        : { ...current, ...openingDynamicSocialUsers }
    );
    const openingSocialConnections = openingHistorySocialConnectionsFromNodes(nextNodes);
    setSocialConnectionsByCharacter((current) => {
      const merged = replaceCurrentChat ? {} : structuredClone(current);
      Object.entries(openingSocialConnections).forEach(([characterId, apps]) => {
        const existing = merged[characterId] ?? {};
        const mergeApp = (app: 'fotogram' | 'onlyfriends') => {
          const ids = existing[app] ?? [];
          return [...ids, ...(apps[app] ?? []).filter((id) => !ids.includes(id))];
        };
        merged[characterId] = {
          fotogram: mergeApp('fotogram'),
          onlyfriends: mergeApp('onlyfriends'),
        };
      });
      return merged;
    });

    // Notes and ChatGPD chats follow the likes: replaced on a fresh import,
    // merged in (existing entries win) when the current chat is kept.
    const openingNotes = openingHistoryNotesFromNodes(nextNodes);
    setPhoneNotesByCharacter((current) =>
      replaceCurrentChat ? openingNotes : mergePhoneAppRecordsByCharacter(current, openingNotes),
    );
    const openingChatGpdChats = openingHistoryChatGpdChatsFromNodes(nextNodes);
    setChatGpdChatsByCharacter((current) =>
      replaceCurrentChat
        ? openingChatGpdChats
        : mergePhoneAppRecordsByCharacter(current, openingChatGpdChats),
    );

    const openingEvents = openingHistoryEventsFromNodes(nextNodes);
    if (openingEvents.length > 0) {
      const nodesWithOpeningEvents = nextNodes.map((node) =>
        node.data.kind === undefined && node.data.nodeType === 'event-manager'
          ? {
              ...node,
              data: {
                ...node.data,
                eventAppointments: normalizedEventAppointments(openingEvents),
                eventStatus: `Loaded ${openingEvents.length} opening history events`,
              } as WorkflowNodeData,
            }
          : node,
      );
      commitNodes(nodesWithOpeningEvents);
    }
  }

  function storybookOpeningHistorySignature(storybookJson?: string) {
    if (!storybookJson) {
      return '';
    }
    try {
      return JSON.stringify(parseRpStorybookJson(storybookJson).openingHistory);
    } catch {
      return '';
    }
  }

  function currentSessionState(name: string): SessionV2CurrentStateInput {
    const openingMessages = messages.filter((message) => message.isOpening);
    return {
      name,
      settings: {
        englishProcessingEnabled,
        inputTranslationOnlyEnabled,
        displayLanguage,
      },
      workflowVariables: workflowSettingsValuesRef.current,
      turns: turnsRef.current,
      turnCheckpoints: turnCheckpointsRef.current,
      openingMessages,
      phoneSeenByConversation,
      bankingSeenByCharacter,
      phoneAppSeenByCharacter,
      bankingContactsByCharacter,
      socialLikesByAccount,
      dynamicSocialUsers,
      socialConnectionsByCharacter,
      onlyFriendsPurchasesByCharacter,
      phoneDividerAfterByConversation,
      recentlyUsedEmojis,
      phoneNotesByCharacter,
      chatGpdChatsByCharacter,
    };
  }

  async function currentSession(name: string): Promise<RpgraphSessionV2> {
    const savedAt = new Date().toISOString();
    return sessionV2FromCurrentState(
      currentSessionState(name),
      await currentWorkflowForSave(),
      nodesRef.current,
      savedAt,
    );
  }

  function latestSessionTurnNumber(session: RpgraphSessionV2) {
    return latestSessionV2TurnNumber(session);
  }

  function suggestedSessionName() {
    return suggestedSessionNameFromCharacters(storyCharactersFromNodes(nodesRef.current));
  }

  function suggestedWorkflowName() {
    return suggestedWorkflowNameFromPath(activeWorkflowPath);
  }

  function currentStorybookForSave() {
    const storybookNode =
      nodesRef.current.find((node) => node.id === storybookCreatorNodeId && node.data.nodeType === 'rp-storybook') ??
      nodesRef.current.find((node) => node.data.nodeType === 'rp-storybook');
    if (!storybookNode || storybookNode.data.nodeType !== 'rp-storybook') {
      throw new Error('Add an RP Storybook V2 node before saving a storybook file.');
    }
    const storybook = storybookNode.data.storybookJson
      ? parseRpStorybookJson(storybookNode.data.storybookJson)
      : emptyRpStorybook;
    return {
      storybook,
      name: storybookNode.data.storybookFileName
        ? storybookNode.data.storybookFileName.replace(/(\.rpgraph-storybook)?\.json$/i, '')
        : storybook.title || 'storybook',
      nodeId: storybookNode.id,
    };
  }

  function clearCurrentSession() {
    clearTemporaryReferenceImages();
    clearTurnTraces();
    messagesRef.current = [];
    setMessages([]);
    turnsRef.current = [];
    setTurns([]);
    setTurnCheckpoints([]);
    setPhoneSeenByConversation({});
    setBankingSeenByCharacter({});
    setPhoneAppSeenByCharacter({});
    setBankingContactsByCharacter({});
    setSocialLikesByAccount({});
    setDynamicSocialUsers({});
    setSocialConnectionsByCharacter({});
    setOnlyFriendsPurchasesByCharacter({});
    setPhoneDividerAfterByConversation({});
    setOpenedPhoneConversationKey('');
    setRecentlyUsedEmojis([]);
    setRecentChatCharacterIds([]);
    setPhoneNotesByCharacter({});
    setChatGpdChatsByCharacter({});
    resetSystemLog();
    setActiveSessionFileName(null);
    setActiveSessionSavedTurn(null);
    activeSessionPathRef.current = null;
    setActiveSessionProtection('plain');
    activeSessionPasswordRef.current = '';
    setActiveWorkflowProtection('plain');
    setActiveStorybookProtection('plain');
    setSessionName('');
    setDraft('');
    nextMessageIdRef.current = 1;
  }

  function clearWorkspaceForLockedStartup() {
    clearCurrentSession();
    commitNodes([]);
    commitEdges([]);
    pendingViewport.current = undefined;
    pendingFitView.current = false;
    setNodeMenu(null);
    setTextDialogNodeId(null);
    setJsonDialogNodeId(null);
    activeWorkflowResetSnapshotRef.current = null;
    activateWorkflowPath(null);
  }

  function applyLoadedRpgraphFile(
    result: {
      fileName: string;
      name: string;
      filePath: string;
      type: SavedFileSummary['type'];
      protection: SavedFileSummary['protection'];
      value: unknown;
    },
    password = '',
  ) {
    if (result.type === 'workflow') {
      const hydratedWorkflow = prepareLoadedWorkflow(result.value);
      clearCurrentSession();
      setActiveWorkflowProtection(result.protection === 'encrypted' ? 'encrypted' : 'plain');
      commitHydratedWorkflow(
        hydratedWorkflow,
        result.protection === 'plain' ? result.filePath : null,
        'Loaded workflow',
        result.fileName,
        result.protection === 'encrypted' ? result.fileName : undefined,
      );
      setWorkflowNameDraft(result.name);
      setSelectedFile(result.fileName);
      setWorkflowOverwritePending(false);
      setFileStorageStatus(`Started new session from workflow: ${result.name}`);
      setSessionPasswordAction(null);
      setShowFiles(false);
      return;
    }
    if (result.type === 'storybook') {
      const storybookNode =
        nodesRef.current.find((node) => node.id === storybookCreatorNodeId && node.data.nodeType === 'rp-storybook') ??
        nodesRef.current.find((node) => node.data.nodeType === 'rp-storybook');
      if (!storybookNode) {
        throw new Error('Add an RP Storybook V2 node before opening a storybook file.');
      }
      const applied = applyStorybookToNode(
        storybookNode.id,
        result.value,
        result.fileName,
        result.filePath,
        result.protection === 'encrypted' ? 'Loaded encrypted storybook' : 'Loaded storybook',
        result.protection === 'encrypted' ? 'encrypted' : 'plain',
      );
      if (!applied) {
        setFileStorageStatus('Cannot load storybook: it conflicts with the running chat history.');
        return;
      }
      setActiveStorybookProtection(result.protection === 'encrypted' ? 'encrypted' : 'plain');
      setSelectedFile(result.fileName);
      setFileStorageStatus(`Loaded storybook: ${result.name}`);
      setSessionPasswordAction(null);
      setShowFiles(false);
      return;
    }
    if (result.type === 'character-card') {
      const storybookNode =
        nodesRef.current.find((node) => node.id === storybookCreatorNodeId && node.data.nodeType === 'rp-storybook') ??
        nodesRef.current.find((node) => node.data.nodeType === 'rp-storybook');
      if (!storybookNode) {
        throw new Error('Add an RP Storybook V2 node before importing a character card.');
      }
      applyCharacterCardToNode(storybookNode.id, result.value, result.fileName);
      setSelectedFile(result.fileName);
      setFileStorageStatus(`Imported character card: ${result.name}`);
      setSessionPasswordAction(null);
      setShowFiles(false);
      return;
    }
    if (!isRpgraphSessionV2(result.value)) {
      throw new Error('The selected file does not contain a valid RPGraph file.');
    }
    applySessionFile(
      result.fileName,
      result.name,
      result.filePath,
      result.protection,
      result.value,
      result.protection === 'encrypted' ? password : '',
    );
  }

  function applySessionFile(
    fileName: string,
    name: string,
    filePath: string,
    protection: SavedFileSummary['protection'],
    session: RpgraphSessionV2,
    password: string,
  ) {
    // Prepare everything that can fail before touching any state, so a
    // corrupted session cannot leave a half-loaded mix of old and new data.
    const hydratedWorkflow = prepareLoadedWorkflow(workflowV2ToWorkflowFile(session.workflow), false);
    const sessionState = appStateFromSessionV2(session);
    const canonicalAppointments = normalizedEventAppointments(
      appointmentsFromEventEntities(session.entities.events),
    );
    const resetNodes = hydratedWorkflow.nodes.map((node) =>
        node.data.nodeType === 'character-stats'
          ? {
              ...node,
              data: { ...node.data, ...resetCharacterStatsRuntimeData() } as WorkflowNodeData,
            }
          : node,
    );
    const loadedRuntimeNodes = restoreTurnRuntime(resetNodes, sessionState.currentRuntime).map((node) =>
      node.data.kind === undefined && node.data.nodeType === 'event-manager'
        ? {
            ...node,
            data: {
              ...node.data,
              eventAppointments: canonicalAppointments,
              eventStatus: canonicalAppointments.length
                ? `Loaded ${canonicalAppointments.length} RP save events`
                : node.data.eventStatus,
            } as WorkflowNodeData,
          }
        : node,
    );
    clearTurnTraces();
    setActiveWorkflowProtection(protection === 'encrypted' ? 'encrypted' : 'plain');
    setActiveStorybookProtection('plain');
    commitHydratedWorkflow(
      hydratedWorkflow,
      null,
      'Loaded session workflow',
      'embedded workflow',
      'embedded workflow',
      false,
    );
    const openingMessages = sessionState.openingMessages;
    const loadedTurns = sessionState.turns;
    const loadedMessages = [
      ...openingMessages,
      ...flattenTurnMessages(loadedTurns),
    ];
    messagesRef.current = loadedMessages;
    setMessages(loadedMessages);
    turnsRef.current = loadedTurns;
    setTurns(loadedTurns);
    setTurnCheckpoints(sessionState.turnCheckpoints);
    setPhoneSeenByConversation(
      mergeSeenStates(
        sessionState.phoneSeenByConversation,
        phoneSeenStateForLoadedMessages(loadedMessages),
      ),
    );
    setBankingSeenByCharacter(sessionState.bankingSeenByCharacter);
    setPhoneAppSeenByCharacter(sessionState.phoneAppSeenByCharacter);
    setBankingContactsByCharacter(sessionState.bankingContactsByCharacter);
    setSocialLikesByAccount(sessionState.socialLikesByAccount);
    setDynamicSocialUsers(sessionState.dynamicSocialUsers);
    setSocialConnectionsByCharacter(sessionState.socialConnectionsByCharacter);
    setOnlyFriendsPurchasesByCharacter(sessionState.onlyFriendsPurchasesByCharacter);
    setPhoneDividerAfterByConversation(sessionState.phoneDividerAfterByConversation);
    setRecentlyUsedEmojis(sessionState.recentlyUsedEmojis ?? []);
    setPhoneNotesByCharacter(sessionState.phoneNotesByCharacter);
    setChatGpdChatsByCharacter(sessionState.chatGpdChatsByCharacter);
    setRecentChatCharacterIds([]);
    setOpenedPhoneConversationKey('');
    resetSystemLog();
    setEnglishProcessingEnabled(sessionState.settings.englishProcessingEnabled);
    setInputTranslationOnlyEnabled(sessionState.settings.inputTranslationOnlyEnabled ?? false);
    setDisplayLanguage(sessionState.settings.displayLanguage);
    replaceWorkflowSettingsValues(sessionState.workflowVariables);
    commitNodes(loadedRuntimeNodes);
    setActiveSessionFileName(fileName);
    setActiveSessionSavedTurn(latestSessionTurnNumber(session));
    activeSessionPathRef.current = filePath;
    setActiveSessionProtection(protection === 'encrypted' ? 'encrypted' : 'plain');
    activeSessionPasswordRef.current = protection === 'encrypted' ? password : '';
    setSessionName(name);
    setDraft('');
    nextMessageIdRef.current =
      loadedMessages.reduce(
        (highest, message) => Math.max(highest, message.id),
        0,
      ) + 1;
    setSessionPassword('');
    setSessionOverwritePending(false);
    setPendingSessionFilePath(null);
    setFileStorageStatus(`Loaded session: ${name}`);
    setSessionPasswordAction(null);
    setShowFiles(false);
  }

  function currentWorkflow(includeStorybook = true): WorkflowFile {
    return workflowSnapshotFromGraph({
      nodes: nodesRef.current,
      edges: edgesRef.current,
      viewport: flowInstanceRef.current?.getViewport(),
      includeStorybook,
    });
  }

  async function currentWorkflowForSave(includeStorybook = true) {
    return currentWorkflow(includeStorybook);
  }

  function prepareLoadedWorkflow(workflow: unknown, hydrateOpeningHistory = true) {
    return hydrateLoadedWorkflow({
      workflow,
      defaultConnectionId: firstLlmConnection().id,
      connectionIds: new Set(connections.filter(isLlmConnection).map((connection) => connection.id)),
      hydrateOpeningHistory,
    });
  }

  function applyLoadedWorkflow(
    workflow: unknown,
    filePath: string | null,
    status: string,
    fileName?: string | null,
    resetSnapshotFileName?: string,
    hydrateOpeningHistory = true,
  ) {
    // Validate and hydrate before any state is cleared, so a corrupted file
    // cannot wipe the running session.
    const hydratedWorkflow = prepareLoadedWorkflow(workflow, hydrateOpeningHistory);
    commitHydratedWorkflow(
      hydratedWorkflow,
      filePath,
      status,
      fileName,
      resetSnapshotFileName,
      hydrateOpeningHistory,
    );
  }

  function commitHydratedWorkflow(
    hydratedWorkflow: HydratedWorkflow,
    filePath: string | null,
    status: string,
    fileName?: string | null,
    resetSnapshotFileName?: string,
    hydrateOpeningHistory = true,
  ) {
    customNodeAssistant.clearState();
    clearTemporaryReferenceImages();
    if (hydrateOpeningHistory) {
      clearTurnTraces();
    }
    const loadedNodes = hydratedWorkflow.nodes;
    const loadedEdges = hydratedWorkflow.edges;
    commitNodes(loadedNodes);
    commitEdges(loadedEdges);
    if (hydrateOpeningHistory) {
      const openingTurns = hydratedWorkflow.openingTurns;
      const openingMessages = hydratedWorkflow.openingMessages;
      const openingCheckpoints = hydratedWorkflow.openingCheckpoints;
      messagesRef.current = openingMessages;
      turnsRef.current = openingTurns;
      turnCheckpointsRef.current = openingCheckpoints;
      setTurnCheckpoints(openingCheckpoints);
      setTurns(openingTurns);
      setMessages(openingMessages);
      setPhoneSeenByConversation(phoneSeenStateForLoadedMessages(openingMessages));
      setBankingSeenByCharacter(
        bankingSeenStateFromMessages(storyCharactersFromNodes(loadedNodes), openingMessages),
      );
      setPhoneAppSeenByCharacter({});
      setBankingContactsByCharacter({});
      setSocialLikesByAccount({});
      setOnlyFriendsPurchasesByCharacter({});
      setPhoneDividerAfterByConversation({});
      setPhoneNotesByCharacter(openingHistoryNotesFromNodes(loadedNodes));
      setChatGpdChatsByCharacter(openingHistoryChatGpdChatsFromNodes(loadedNodes));
      setOpenedPhoneConversationKey('');
      nextMessageIdRef.current =
        openingMessages.reduce(
          (highest, message) => Math.max(highest, message.id),
          0,
        ) + 1;
    }
    setNodeMenu(null);
    setTextDialogNodeId(null);
    setTextDialogView('text');
    setJsonDialogNodeId(null);
    activeWorkflowResetSnapshotRef.current = resetSnapshotFileName
      ? {
        workflow: structuredClone(hydratedWorkflow.workflow),
        fileName: resetSnapshotFileName,
      }
      : null;
    activateWorkflowPath(filePath, fileName);
    notifySystem('info', `${status}: ${fileName ?? (filePath ? workflowName(filePath) : 'embedded workflow')}`);
    pendingViewport.current = hydratedWorkflow.workflow.viewport;
    pendingFitView.current = !hydratedWorkflow.workflow.viewport;
    const initializedFlow = flowInstanceRef.current;
    if (initializedFlow) {
      if (hydratedWorkflow.workflow.viewport) {
        void initializedFlow.setViewport(hydratedWorkflow.workflow.viewport);
      } else {
        void initializedFlow.fitView({ padding: fitViewPadding });
      }
      pendingViewport.current = undefined;
      pendingFitView.current = false;
    }
  }

  function initializeFlow(instance: ReactFlowInstance<WorkflowNode>) {
    flowInstanceRef.current = instance;
    setFlowInstance(instance);
    if (pendingViewport.current) {
      void instance.setViewport(pendingViewport.current);
      pendingViewport.current = undefined;
    } else if (pendingFitView.current) {
      void instance.fitView({ padding: fitViewPadding });
      pendingFitView.current = false;
    }
  }

  const { nodeActions } = useNodeActionsController({
    nodesRef,
    edges,
    setNodes,
    setEdges,
    setDefaultConnectionId,
    settingsValueDefinitions,
    settingsValueDefinitionsRef,
    createId: uniqueId,
    updateRuntimeNode,
    messages,
    messagesRef,
    setMessages,
    turnsRef,
    setTurns,
    turnCheckpointsRef,
    setTurnCheckpoints,
    draft,
    nodeLlm,
    activeTokenEstimateBytesPerToken,
    connections,
    promptActionSettings,
    updateWorkflowComfyGenerationActive,
    workflowSettingsValuesForGraph,
    setWorkflowVariablesFromCommands,
    rpDateTimeFormat,
    rpWeekdayLanguage,
    nextTurnReferenceImageOptions,
    setTextDialogView,
    setTextDialogNodeId,
    setJsonDialogNodeId,
    setOutputFormatHelpKind,
    openStorybookCreator,
    openCustomNodeAssistant: customNodeAssistant.open,
    runCustomNodeButton: customNodeAssistant.runButton,
    loadStorybookFile,
    importSillyTavernCharacter,
  });

  function stringValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  async function analyzeDisplayedOutput(
    text: string,
    outputNode: WorkflowNode,
    cast: StorybookCharacter[],
    highlightingContext: string,
    signal?: AbortSignal,
    onFormatResult?: (result: ExecuteTraceFormatResult) => void,
  ): Promise<OutputAttribution> {
    if (!outputNode.data.speakerAnalysisEnabled) {
      return { speakerNames: [], dialogue: [] };
    }

    const highlightDialogue = outputNode.data.dialogueHighlightEnabled ?? false;
    const extractedQuotes = highlightDialogue ? extractDialogueQuotes(text) : [];
    const speakerReferences = cast.map((character, index) => ({
      speakerId: index + 1,
      name: character.name,
    }));
    const speakerFormat = outputSpeakerResponseFormat(outputNode.data.outputSpeakerResponseFormat);
    const numberedQuotedPassages = extractedQuotes.map((quote) => ({
      quoteId: quote.index + 1,
      text: quote.text,
    }));
    const analysisShapeObject = highlightDialogue
      ? { dialogue: [{ quoteId: 1, speakerId: 1 }] }
      : { speakers: [1] };
    const analysisShape = speakerFormat === 'json'
      ? JSON.stringify(analysisShapeObject, null, 2)
      : encode(analysisShapeObject);
    const highlightingInputToon = encode({
      speakerReferences,
      ...(highlightingContext.trim() ? { highlightingContext: highlightingContext.trim() } : {}),
      ...(highlightDialogue
        ? {
            numberedQuotedPassages: extractedQuotes.map((quote) => ({
              quoteId: quote.index + 1,
              text: quote.text,
            })),
          }
        : {}),
      dialogueHighlightEnabled: highlightDialogue,
    });
    if (highlightDialogue && extractedQuotes.length === 0) {
      const attribution = { speakerNames: [], dialogue: [] };
      updateRuntimeNode(outputNode.id, {
        outputHighlightingInputToon: highlightingInputToon,
        outputHighlightingResponseToon: '',
        outputHighlightingResultToon: encode({
          speakerMap: speakerReferences.map(({ speakerId, name }) => ({ speakerId, name })),
          speakers: [],
          markedQuotes: [],
          highlightedDialogue: [],
          skipped: 'No quoted passages found in response text.',
        }),
      });
      return attribution;
    }
    const prompt = buildOutputSpeakerPrompt(outputNode.data.outputSpeakerPrompt, {
      OutputFormatInstructions: outputSpeakerFormatInstructions(
        speakerFormat,
        highlightDialogue,
        analysisShape,
      ),
      KnownSpeakers: speakerDataForFormat(speakerFormat, speakerReferences),
      HighlightingContext: highlightingContext.trim()
        ? `HIGHLIGHTING CONTEXT:\n${highlightingContext.trim()}\n`
        : '',
      NumberedQuotedPassages: highlightDialogue
        ? `NUMBERED QUOTED PASSAGES:\n${speakerDataForFormat(speakerFormat, numberedQuotedPassages)}\n`
        : '',
      ResponseText: text,
      ExpectedShape: analysisShape,
    });
    let lastResponseText = '';
    const attemptSpeakerAnalysis = async () => {
      updateLlmNodeActive(outputNode.id, true, 'Speakers');
      let completion: Awaited<ReturnType<NodeLlmApi['complete']>>;
      try {
        completion = await nodeLlm.withAbortSignal(signal).complete({
          connectionId: outputNode.data.connectionId,
          purpose: 'RP Output speaker analysis',
          nodeId: outputNode.id,
          label: 'Speakers',
          prompt,
        });
      } finally {
        updateLlmNodeActive(outputNode.id, false);
      }
      lastResponseText = completion.text;
      updateRuntimeNode(outputNode.id, {
        outputHighlightingInputToon: highlightingInputToon,
        outputHighlightingResponseToon: completion.text.trim(),
        outputHighlightingResultToon: '',
      });
      return parseOutputSpeakerResponse(completion.text, speakerFormat);
    };
    const maxAttempts = retryFormatErrorsEnabled ? 2 : 1;
    let result!: ReturnType<typeof parseOutputSpeakerResponse>;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        result = await attemptSpeakerAnalysis();
        onFormatResult?.({
          name: `Speaker ${speakerFormat.toUpperCase()}`,
          status: 'ok',
          detail: attempt > 1
            ? 'Speaker analysis response parsed after retry.'
            : 'Speaker analysis response parsed.',
        });
        break;
      } catch (error) {
        if (attempt < maxAttempts && !signal?.aborted) {
          continue;
        }
        onFormatResult?.({
          name: `Speaker ${speakerFormat.toUpperCase()}`,
          status: 'error',
          detail: error instanceof Error ? error.message : String(error),
          preview: lastResponseText,
        });
        throw error;
      }
    }
    const speakerNameById = new Map(
      speakerReferences.map((speaker) => [speaker.speakerId, speaker.name]),
    );
    const canonicalNameById = (value: unknown) => {
      const speakerId = typeof value === 'number' ? Math.floor(value) : Number(value);
      return speakerId > 0 ? speakerNameById.get(speakerId) : undefined;
    };
    const canonicalName = (name: string) => {
      const normalizedName = name.toLocaleLowerCase();
      const exactMatch = cast.find((character) => character.name.toLocaleLowerCase() === normalizedName);
      if (exactMatch) {
        return exactMatch.name;
      }

      const firstNameMatches = cast.filter(
        (character) => character.name.trim().split(/\s+/)[0]?.toLocaleLowerCase() === normalizedName,
      );
      return firstNameMatches.length === 1 ? firstNameMatches[0].name : undefined;
    };
    const explicitSpeakers = Array.isArray(result.speakers)
      ? result.speakers
          .map((value) => canonicalNameById(value) ?? canonicalName(stringValue(value)))
          .filter((value): value is string => !!value)
      : [];
    const dialogueEntries = outputNode.data.dialogueHighlightEnabled && Array.isArray(result.dialogue)
      ? result.dialogue.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') {
            return [];
          }
          const values = entry as Record<string, unknown>;
          const quoteId =
            values.quoteId !== undefined
              ? (typeof values.quoteId === 'number' ? Math.floor(values.quoteId) : Number(values.quoteId))
              : (typeof values.quoteIndex === 'number'
                  ? Math.floor(values.quoteIndex) + 1
                  : Number(values.quoteIndex) + 1);
          const speakerId =
            values.speakerId !== undefined
              ? (typeof values.speakerId === 'number'
                  ? Math.floor(values.speakerId)
                  : Number(values.speakerId))
              : Number.NaN;
          return [{ quoteId, speakerId, speakerName: stringValue(values.speakerName) }];
        })
      : [];
    const looksSwapped =
      dialogueEntries.length > 0 &&
      dialogueEntries.some((entry) => !speakerNameById.has(entry.speakerId)) &&
      dialogueEntries.every(
        (entry) =>
          entry.speakerId >= 1 &&
          entry.speakerId <= extractedQuotes.length &&
          entry.quoteId >= 0 &&
          entry.quoteId <= speakerReferences.length,
      );
    const usedQuoteIds = new Set<number>();
    const dialogue = dialogueEntries.flatMap((entry) => {
      const quoteId = looksSwapped ? entry.speakerId : entry.quoteId;
      const speakerId = looksSwapped ? entry.quoteId : entry.speakerId;
      const speakerName = canonicalNameById(speakerId) ?? canonicalName(entry.speakerName);
      const quote = extractedQuotes.find((entryQuote) => entryQuote.index + 1 === quoteId);
      if (!speakerName || !quote || usedQuoteIds.has(quoteId)) {
        return [];
      }
      usedQuoteIds.add(quoteId);
      return [{ speakerName, text: quote.text }];
    });
    const attribution = {
      speakerNames: Array.from(
        new Set([...explicitSpeakers, ...dialogue.map((quote) => quote.speakerName)]),
      ),
      dialogue,
    };
    updateRuntimeNode(outputNode.id, {
      outputHighlightingResultToon: encode({
        speakerMap: speakerReferences.map(({ speakerId, name }) => ({ speakerId, name })),
        speakers: attribution.speakerNames.flatMap((speakerName) => {
          const speaker = speakerReferences.find((entry) => entry.name === speakerName);
          return speaker ? [speaker.speakerId] : [];
        }),
        markedQuotes: attribution.dialogue.flatMap((quote) => {
          const speaker = speakerReferences.find((entry) => entry.name === quote.speakerName);
          const extractedQuote = extractedQuotes.find((entry) => entry.text === quote.text);
          return speaker && extractedQuote
            ? [{ speakerId: speaker.speakerId, quoteId: extractedQuote.index + 1 }]
            : [];
        }),
        highlightedDialogue: attribution.dialogue.map((quote) => ({
          speakerName: quote.speakerName,
          text: quote.text,
        })),
      }),
    });
    return attribution;
  }

  async function translateText(
    text: string,
    direction: 'to-english' | 'to-display',
    connectionId: string,
    nodeId: string,
    onChunk?: (text: string) => void,
    displayLanguageOverride = displayLanguage,
    signal?: AbortSignal,
    recentHistoryContext = '',
    label = 'Translate',
  ) {
    // Nothing to translate — skip the LLM call. Passing an empty string to the
    // translator otherwise yields a spurious "I don't see the text to translate"
    // style reply that surfaces as the translated output.
    if (!text.trim()) {
      return '';
    }
    const language = displayLanguageOverride.trim() || 'German';
    // W11: shield emoji so a weak translation model (e.g. Haiku) cannot mangle
    // them into U+FFFD replacement characters. Translate ASCII placeholders and
    // restore the original emoji afterwards (streamed output restored on the fly).
    const { shielded, tokens } = shieldTranslationEmoji(text);
    const prompt = translationPrompt({
      text: shielded,
      direction,
      displayLanguage: language,
      recentHistoryContext,
    });
    updateLlmNodeActive(nodeId, true, label);
    try {
      const completion = await nodeLlm.withAbortSignal(signal).complete({
        connectionId,
        purpose: 'translation',
        nodeId,
        label,
        prompt,
        onChunk: onChunk
          ? (streamed) => onChunk(restoreTranslationEmoji(streamed, tokens))
          : undefined,
      });
      const translated = restoreTranslationEmoji(completion.text, tokens).trim();
      if (!translated) {
        if (direction === 'to-english') {
          return '';
        }
        throw new Error('The translator returned empty text.');
      }
      return translated;
    } finally {
      updateLlmNodeActive(nodeId, false);
    }
  }

  async function directInputText(
    text: string,
    connectionId: string,
    nodeId: string,
    recentHistoryContext: string,
    channel: 'rp' | 'phone',
    displayLanguageOverride = displayLanguage,
    signal?: AbortSignal,
  ) {
    const language = displayLanguageOverride.trim() || 'German';
    const prompt = directInputPrompt({
      text,
      displayLanguage: language,
      channel,
      recentHistoryContext,
    });
    updateLlmNodeActive(nodeId, true, channel === 'phone' ? 'Act Phone' : 'Act RP');
    try {
      const completion = await nodeLlm.withAbortSignal(signal).complete({
        connectionId,
        purpose: 'input direction',
        nodeId,
        label: channel === 'phone' ? 'Act Phone' : 'Act RP',
        prompt,
      });
      const directed = completion.text.trim();
      if (!directed) {
        throw new Error('The input director returned empty text.');
      }
      return directed;
    } finally {
      updateLlmNodeActive(nodeId, false);
    }
  }

  const rpTimeTrackingEnabled = !!nodeViewNodes.find(
    (node) => node.data.kind === undefined && node.data.nodeType === 'history',
  )?.data.historyTimeTrackingEnabled;
  function createDebugSnapshot() {
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;
    const currentTurns = turnsRef.current;
    const currentEventManagerNode = currentNodes.find(
      (node) => node.data.kind === undefined && node.data.nodeType === 'event-manager',
    );
    const currentEventEntities = eventEntitiesFromNodes(currentNodes);
    const promptDebugNodes = currentNodes.filter(
      (node) =>
        node.data.kind === undefined &&
        (node.data.nodeType === 'llm-prompt-switch' || node.data.nodeType === 'llm-prompt'),
    );
    const textMetrics = new TextMetricsApi(activeTokenEstimateBytesPerToken);
    const promptSwitchDebug = promptDebugNodes.map((node) => ({
      id: node.id,
      nodeType: node.data.nodeType,
      label: node.data.label,
      selectedOutputChannel: node.data.llmPromptSwitchSelectedOutputChannel,
      selectedPromptSlot: node.data.llmPromptSwitchSelectedPromptSlot,
      runtimeDebug:
        node.data.nodeType === 'llm-prompt' ? node.data.llmPromptDebug : node.data.llmPromptSwitchDebug,
      preview: node.data.preview,
      fullText: compactDebugValue(node.data.fullText, textMetrics),
      generatedText: node.data.generatedText,
      runtimePortValues: compactDebugValue(node.data.runtimePortValues, textMetrics),
      runPrepared: node.data.runPrepared,
      runCompleted: node.data.runCompleted,
    }));
    const eventManagerDebug = currentEventManagerNode
      ? {
          id: currentEventManagerNode.id,
          label: currentEventManagerNode.data.label,
          events: appointmentsFromEventEntities(currentEventEntities),
          eventEntities: currentEventEntities,
          preview: currentEventManagerNode.data.preview,
          fullText: compactDebugValue(currentEventManagerNode.data.fullText, textMetrics),
          status: currentEventManagerNode.data.eventStatus,
          runtimePortValues: compactDebugValue(currentEventManagerNode.data.runtimePortValues, textMetrics),
          runPrepared: currentEventManagerNode.data.runPrepared,
          runCompleted: currentEventManagerNode.data.runCompleted,
          eventLastPrompt: compactDebugValue(currentEventManagerNode.data.eventLastPrompt, textMetrics),
          eventLastResponse: currentEventManagerNode.data.eventLastResponse,
        }
      : {};

    return sanitizeDebugSnapshotValue({
      schema: 'rpgraph-debug-snapshot',
      version: 1,
      createdAt: new Date().toISOString(),
      selectedSections: [],
      appState: {
        currentTab: chatPanelView,
        selectedCharacter: selectedCharacter
          ? { id: selectedCharacter.id, name: selectedCharacter.name }
          : undefined,
        narratorSelected,
        narratorSelectedName: narratorSelected ? narratorSpeakerName : undefined,
        selectedEvent,
        selectedEventId,
        selectedPhone: {
          viewedCharacter: viewedPhoneCharacter
            ? { id: viewedPhoneCharacter.id, name: viewedPhoneCharacter.name }
            : undefined,
          selectedContact: selectedPhoneContact
            ? {
                character: {
                  id: selectedPhoneContact.character.id,
                  name: selectedPhoneContact.character.name,
                },
                conversationKey: selectedPhoneContact.conversationKey,
                latestPhoneId: selectedPhoneContact.latestPhoneId,
                unreadCount: selectedPhoneContact.unreadCount,
              }
            : undefined,
          openedPhoneConversationKey,
          selectedPhoneConversation,
          selectedPhoneDividerAfterId,
          phoneDraft,
          phoneImages,
          phoneSeenByConversation,
          phoneDividerAfterByConversation,
        },
        isRunning,
        turnNumber: currentTurns[currentTurns.length - 1]?.number ?? 0,
        activeRunId: activeRunRef.current?.id,
        rpTimeTrackingEnabled,
        englishProcessingEnabled,
        inputTranslationOnlyEnabled,
        displayLanguage,
        workflowVariables: workflowSettingsValuesRef.current,
      },
      lastRun: lastRunDebugRef.current
        ? {
            ...lastRunDebugRef.current,
            originalHistory: compactDebugValue(lastRunDebugRef.current.originalHistory, textMetrics),
            translatedHistory: compactDebugValue(lastRunDebugRef.current.translatedHistory, textMetrics),
          }
        : {},
      recentTurns: recentTurnDebugSummaries(
        turnsRef.current,
        turnCheckpointsRef.current,
        textMetrics,
        2,
      ),
      promptSwitch: {
        nodes: promptSwitchDebug,
      },
      eventManager: eventManagerDebug,
      nodes: currentNodes.map((node) => compactDebugNode(node, textMetrics)),
      edges: currentEdges,
      systemLog,
    }) as DebugSnapshot;
  }

  function createAssistantDebugSnapshotSections(): DebugSnapshotAssistantSection[] {
    const snapshot = createDebugSnapshot();
    const debugSessionState = currentSessionState(sessionName || suggestedSessionName());
    const dataManagementSession = sessionV2FromCurrentState(
      debugSessionState,
      currentWorkflow(false),
      nodesRef.current,
      snapshot.createdAt,
    );
    const sectionDefinitions: Array<{
      id: string;
      label: string;
      description: string;
      value: unknown;
      json?: string;
    }> = [
      {
        id: 'v2-timeline',
        label: 'V2 Timeline',
        description: 'Canonical data-management timeline view for recent RP, phone, opening, and event-input messages.',
        value: null,
        json: formatTimelineContext(dataManagementSession, {
          encoding: 'json-compact',
          maxEntries: 24,
        }),
      },
      {
        id: 'v2-events',
        label: 'V2 Events',
        description: 'Canonical data-management event entities, separated from Event Manager node runtime.',
        value: null,
        json: formatEventsContext(dataManagementSession, {
          encoding: 'json-compact',
          maxEntries: 40,
        }),
      },
      {
        id: 'v2-phone',
        label: 'V2 Phone',
        description: 'Canonical data-management phone timeline entries with normalized participants and linked RP metadata.',
        value: null,
        json: formatPhoneContext(dataManagementSession, {
          encoding: 'json-compact',
          maxEntries: 40,
        }),
      },
      {
        id: 'v2-debug-overview',
        label: 'V2 Debug Overview',
        description: 'Compact data-management session overview with bounded timeline, events, runtime ids, and checkpoint count.',
        value: null,
        json: formatDataManagementDebugSnapshot(dataManagementSession, {
          encoding: 'json-compact',
          maxEntries: 12,
          includeDebug: false,
        }),
      },
      {
        id: 'app-state',
        label: 'App State',
        description: 'Current tab, selected character/event/phone state, running state, settings, workflow variables, and turn number.',
        value: snapshot.appState,
      },
      {
        id: 'workflow-nodes',
        label: 'Workflow Nodes (Compact Runtime)',
        description: 'Current workflow nodes with compact status, preview, runtime, and debug fields, including Chat History RP Time prompt/response when present.',
        value: snapshot.nodes,
      },
      {
        id: 'workflow-edges',
        label: 'Workflow Connections',
        description: 'Current workflow graph connections between node handles.',
        value: snapshot.edges,
      },
      {
        id: 'last-run-debug',
        label: 'Last Run Debug',
        description: 'Last run mode, prompt slot, original input, compact history summaries, and phone/event flags.',
        value: snapshot.lastRun,
      },
      {
        id: 'recent-turns',
        label: 'Recent Turns (last two turns)',
        description: 'Last two complete RP turns with input/output graph text, message ids/counts, and V2 checkpoint summary.',
        value: snapshot.recentTurns,
      },
      {
        id: 'prompt-switch-debug',
        label: 'Prompt Debug (Switch + Multistep)',
        description: 'LLM Prompt Switch and multistep LLM Prompt node input values, selected output/prompt slot, prompt pieces, combined prompt, and generated text.',
        value: snapshot.promptSwitch,
      },
      {
        id: 'event-manager-debug',
        label: 'Event Manager Debug',
        description: 'Event list, Event Manager status, compact context, prompt, and response data; the selected event lives in App State.',
        value: snapshot.eventManager,
      },
      {
        id: 'system-log',
        label: 'System Log',
        description: 'Current System Log entries, including info, warning, and error entries.',
        value: snapshot.systemLog,
      },
    ];
    const textMetrics = new TextMetricsApi(activeTokenEstimateBytesPerToken);
    return sectionDefinitions.map((section) => {
      const json = section.json ?? JSON.stringify(section.value, null, 2);
      return {
        id: section.id,
        label: section.label,
        description: section.description,
        tokenEstimate: textMetrics.measure(json).tokens,
        json,
      };
    });
  }

  const currentSessionTurn = lastSessionTurn(turns);
  const undoTurnTitle = isRunning
    ? 'Cancel the running turn'
    : currentSessionTurn
      ? 'Undo the complete last turn'
      : 'No turn to undo';
  const undoTurnDisabled = !isRunning && !currentSessionTurn;

  function openImagePreview(image: ChatImageAttachment) {
    setPreviewImage({ image });
  }

  function openImageCaptionChangePreview(change: ImageCaptionChange) {
    const source = currentStorybookImageSourceById(change.imageId);
    if (!source) {
      notifySystem('warning', `Phone image ${change.imageId} was not found in the Storybook image libraries.`);
      return;
    }
    setPreviewImage({
      image: chatAttachmentFromStorybookImage(source.image),
    });
  }

  function storybookPhoneImageAttachment(message: Pick<ParsedPhoneMessage, 'from' | 'imageId'>) {
    const imageId = message.imageId?.trim();
    if (!imageId) {
      return undefined;
    }
    const source = currentStorybookImageSourceById(imageId);
    if (!source) {
      notifySystem('warning', `Phone image ${imageId} was not found in the Storybook image libraries.`);
      return undefined;
    }
    return {
      attachment: chatAttachmentFromStorybookImage(source.image),
      description: source.image.description.trim() || undefined,
      ownerName: source.ownerName,
    };
  }

  function appendPhoneMessage(
    message: ParsedPhoneMessage,
    sound?: PhoneMessageSound,
    role: Extract<MessageRecord['role'], 'user' | 'output'> = 'user',
    phoneAutoTurnSource?: MessageRecord['phoneAutoTurnSource'],
    workflowVariableSetCommands?: WorkflowVariableSetCommand[],
    inputMetadata: Pick<MessageRecord, 'inputMessageFormat' | 'inputPromptSlot' | 'replyToMessageId'> = {},
  ) {
    const canonicalMessage = {
      ...message,
      from: canonicalPhoneName(phoneCharacters, message.from),
      to: canonicalPhoneName(phoneCharacters, message.to),
    };
    const storybookImage = canonicalMessage.imageAttachments?.length
      ? undefined
      : storybookPhoneImageAttachment(canonicalMessage);
    const sourceImageAttachments = canonicalMessage.imageAttachments?.length
      ? canonicalMessage.imageAttachments
      : storybookImage
        ? [storybookImage.attachment]
        : undefined;
    const imageDescription =
      canonicalMessage.imageDescription ??
      storybookImage?.description ??
      imageDescriptionFromAttachments(sourceImageAttachments);
    const imageAttachments = ensurePhoneImagesInStorybooks(
      canonicalMessage.from,
      canonicalMessage.to,
      sourceImageAttachments,
      imageDescription,
      storybookImage?.ownerName,
    ) ?? sourceImageAttachments;
    const phoneImageIds = imageIdsFromAttachments(imageAttachments);
    allowStorybookPhoneContactPair(canonicalMessage.from, canonicalMessage.to);
    const id = appendMessage({
      role,
      originalText: canonicalMessage.message,
      translatedText: canonicalMessage.translatedMessage,
      imageAttachments,
      includeInHistory: true,
      channel: 'phone',
      phoneMessage: true,
      phoneFrom: canonicalMessage.from,
      phoneTo: canonicalMessage.to,
      phoneVoiceMessage: canonicalMessage.isVoiceMessage || undefined,
      phoneAutoTurnSource,
      phoneImageIds,
      phoneImageDescription: imageDescription,
      phoneImageCaptionChange: canonicalMessage.phoneImageCaptionChange,
      replyToMessageId: inputMetadata.replyToMessageId,
      inputMessageFormat: inputMetadata.inputMessageFormat,
      inputPromptSlot: inputMetadata.inputPromptSlot,
      speakerName: canonicalMessage.from,
      speakerNames: [canonicalMessage.from],
      turnContext: canonicalMessage.turnContext,
      workflowVariableSetCommands,
    });
    if (sound) {
      playPhoneMessageSound(sound);
    }
    const conversationKey = phoneConversationKey(canonicalMessage.from, canonicalMessage.to);
    const messageShouldBeMarkedSeen = phoneMessageShouldBeMarkedSeen(
      role,
      chatPanelView,
      conversationKey,
      openedPhoneConversationKey,
      selectedPhoneContact?.conversationKey,
    );
    if (messageShouldBeMarkedSeen) {
      setPhoneSeenByConversation((current) =>
        id > (current[conversationKey] ?? 0)
          ? { ...current, [conversationKey]: id }
          : current
      );
    } else {
      setPhoneSeenByConversation((current) => ({
        ...current,
        [conversationKey]: Math.min(current[conversationKey] ?? 0, id - 1),
      }));
    }
    return id;
  }

  function setOutputActionChoicesHiddenByTurn(turnId: string, hidden: boolean) {
    const shouldPatch = (message: MessageRecord) =>
      ((message.outputActionChoices?.length ?? 0) > 0 ||
        (message.outputActionInfoBoxes?.length ?? 0) > 0 ||
        (message.outputActionProgressBars?.length ?? 0) > 0 ||
        (message.outputActionContextCapacityBars?.length ?? 0) > 0) &&
      (hidden
        ? !message.outputActionsHidden
        : message.outputActionsHidden && message.outputActionsHiddenByTurnId === turnId);
    const patchMessage = (message: MessageRecord): MessageRecord => {
      if (!shouldPatch(message)) {
        return message;
      }
      return hidden
        ? { ...message, outputActionsHidden: true, outputActionsHiddenByTurnId: turnId }
        : { ...message, outputActionsHidden: false, outputActionsHiddenByTurnId: undefined };
    };
    if (!messagesRef.current.some(shouldPatch)) {
      return;
    }

    messagesRef.current = messagesRef.current.map(patchMessage);
    turnsRef.current = turnsRef.current.map((turn) => ({
      ...turn,
      input: { ...turn.input, messages: turn.input.messages.map(patchMessage) },
      output: { ...turn.output, messages: turn.output.messages.map(patchMessage) },
    }));
    setMessages(messagesRef.current);
    setTurns(turnsRef.current);
  }

  function resolveOutputActionContextCapacityBars(
    requests: OutputActionContextCapacityRequest[],
  ): OutputActionContextCapacityBar[] {
    return requests.flatMap((request) => {
      const compressionNodes = nodesRef.current.filter(
        (node) => node.data.nodeType === 'context-compression',
      );
      const compressionNode = compressionNodes[request.source.index - 1];
      if (!compressionNode) {
        notifySystem(
          'warning',
          `Output Actions contextCapacity could not find Context Compression node #${request.source.index}.`,
        );
        return [];
      }
      const segments = contextCompressionCapacitySegments(
        compressionNode,
        activeTokenEstimateBytesPerToken,
      );
      return [{
        id: request.id,
        title: request.title ?? 'Context Capacity',
        label: request.label,
        nodeLabel: compressionNode.data.label,
        showLegend: request.showLegend ?? true,
        ...segments,
      }];
    });
  }
  const { runGraph } = useGraphRun({
    messages,
    setMessages,
    messagesRef,
    turnsRef,
    activeTurnCollectorRef,
    appendMessage,
    updateMessage,
    updateHistoryMessageTimes,
    removeMessage,
    applyTurnRuntime,
    applyTurnCheckpointRuntime,
    commitCollectedTurn,
    recordTurnTrace,
    referenceImageOptionsForRun,
    clearTemporaryReferenceImages,
    selectPhoneReply,
    nodesRef,
    setNodes,
    edges,
    connections,
    defaultConnectionId,
    isLlmConnection,
    nodeHasVision,
    checkProviderConnections,
    notifySystem,
    onRunStarting: autoplay.cancelPendingAutoplay,
    onRunCommitted: autoplay.onRunCommitted,
    onRpOutputReady:
      dialogueVoiceMode === 'narrator-only' && !englishProcessingEnabled
        ? (text) => { void readTextAsApiNarratorEarly(text); }
        : undefined,
    updateRuntimeNode,
    clearAllRunActiveTimers,
    updateWorkflowComfyGenerationActive,
    setOutputActionChoicesHiddenByTurn,
    setWorkflowVariablesFromCommands,
    commitSimulatedAiChats: (turnId, chats) => {
      setChatGpdChatsByCharacter((current) =>
        replaceSimulatedAiChatsForTurn(current, turnId, chats)
      );
    },
    commitCreatedPhoneNotes: (turnId, notes) => {
      setPhoneNotesByCharacter((current) =>
        replaceCreatedPhoneNotesForTurn(current, turnId, notes)
      );
    },
    commitDeletedPhoneNotes: (notes) => {
      setPhoneNotesByCharacter((current) => deletePhoneNotesForTurn(current, notes));
    },
    workflowSettingsValuesForGraph,
    settingsValueDefinitionsRef,
    promptActionSettings,
    workflowSettingsValuesRef,
    characterStorybookNodes,
    storyCharacters,
    phoneCharacters,
    selectedCharacter,
    selectedPhoneContact,
    storybooksByNodeId,
    characterColors,
    englishProcessingEnabled,
    inputTranslationOnlyEnabled,
    displayLanguage,
    rpDateTimeFormat,
    rpWeekdayLanguage,
    retryFormatErrorsEnabled,
    nodeLlm,
    activeTokenEstimateBytesPerToken,
    autoCalibrateTokenEstimate,
    setCalibratedTokenBytesPerToken,
    lastRunDebugRef,
    translateText,
    directInputText,
    analyzeDisplayedOutput,
    appendPhoneMessage,
    ensurePhoneImagesInStorybooks,
    imageDescriptionFromAttachments,
    applyPhoneImageActionFromLlm,
    resolveOutputActionContextCapacityBars,
    pruneStorybookExternalImagesForMessages,
    selectChatPanelView,
    selectChatCharacter,
    setSelectedCharacterId,
    setDraft,
    setDraftCommands,
    setDraftImages,
    setPhoneDraft,
    setPhoneDraftCommands,
    setPhoneImages,
    activeRun: activeRunRef,
    setActiveRunId,
    setIsRunning,
    setRunDurationMs,
    setRunStartTimeMs,
    runStartTimeRef,
    runEndTimeRef,
    pendingRunRestart: pendingRunRestartRef,
    runLlmReport,
    runDurationMs,
    setRunHistory,
    activeRunLlmReport: activeRunLlmReportRef,
    setRunLlmReport,
    activeRunCancelReason: activeRunCancelReasonRef,
  });

  useEffect(() => {
    autoplayGraphRunRef.current = (request) => runGraph(
      `[AUTOPLAY]\nPlayer-controlled character: ${request.playerCharacterName}`,
      [],
      undefined,
      messagesRef.current,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      'user',
      undefined,
      undefined,
      undefined,
      false,
      autoplayMessageFormat,
      request.promptSlot,
    );
    return () => {
      autoplayGraphRunRef.current = null;
    };
  }, [messagesRef, runGraph]);

  function regenerateLastOutput() {
    if (isRunning) {
      const retry = activeRunRef.current?.retry;
      if (retry) {
        pendingRunRestartRef.current = retry;
        cancelCurrentRun('restart');
      }
      return;
    }
    const turn = lastSessionTurn(turnsRef.current);
    const inputMessage = turn?.input.messages[0];
    if (!turn) {
      return;
    }
    const allTurnMessageIds = turnMessageIds(turn);
    const replacedMessageIds = new Set(turn.output.messages.map((message) => message.id));
    const isAutoTurn =
      turn.mode === 'auto-turn' ||
      turn.input.graphText.includes('[AUTO TURN]') ||
      turn.input.graphText.includes('[AUTO PHONE TURN]');
    if (turn.directAction) {
      applyTurnCheckpointRuntime(turn, 'before');
      void runGraph(
        turn.input.graphText,
        inputMessage?.imageAttachments ?? [],
        undefined,
        messagesRef.current.filter((message) => !allTurnMessageIds.has(message.id)),
        replacedMessageIds,
        turn.mode === 'narrator' ? undefined : selectedCharacter,
        false,
        undefined,
        { turn, replaceInput: false },
        turn.mode ?? 'user',
        inputMessage?.eventDisplayText,
        undefined,
        undefined,
        false,
        turn.messageFormat,
        turn.promptSlot,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      );
      return;
    }
    if (turn.messageFormat === socialMediaMessageFormat) {
      const turnMessages = [...turn.input.messages, ...turn.output.messages];
      const socialPost = turnMessages.find((message) => message.socialPost)?.socialPost;
      const socialThreadAction = turnMessages.find(
        (message) => message.socialThreadAction,
      )?.socialThreadAction;
      const socialDirectInputMessage = turn.input.messages.find(
        (message) => message.socialDirectMessage,
      );
      const socialDirectRegenerateInputMessage = socialDirectInputMessage
        ? {
            ...socialDirectInputMessage,
            turnContext: socialDirectInputMessage.turnContext ?? {
              englishProcessingEnabled,
              inputTranslationOnlyEnabled,
              displayLanguage,
            },
          }
        : undefined;
      const socialDirectMessage = socialDirectInputMessage?.socialDirectMessage;
      const actorName = socialPost?.author ?? socialThreadAction?.actor ?? socialDirectMessage?.from;
      const actorHandle = socialPost?.authorHandle ??
        socialThreadAction?.actorHandle ??
        socialDirectMessage?.fromHandle;
      const actor = storyCharacters.find((character) =>
        socialIdentityMatches(character.name, actorName ?? '') ||
        socialIdentityMatches(character.id, actorName ?? '') ||
        socialIdentityMatches(character.social.fotogramUsername, actorHandle ?? '') ||
        socialIdentityMatches(character.social.onlyfriendsUsername, actorHandle ?? ''),
      ) ?? selectedCharacter;
      const historyMessages = messagesRef.current.filter(
        (message) => !allTurnMessageIds.has(message.id),
      );
      const socialDirectRunMessage = socialDirectMessage
        ? {
            ...socialDirectMessage,
            text: socialDirectMessage.internalText ?? socialDirectMessage.text,
          }
        : undefined;
      const threadContext = socialThreadAction
        ? socialThreadRunContextFromInput(turn.input.graphText)
        : undefined;
      const displayText = socialPost
        ? socialPostInputText(socialPost)
        : socialThreadAction
          ? socialThreadActionInputText(
              socialThreadAction,
              threadContext?.existingComments ?? [],
              threadContext?.likeCount ?? 0,
            )
          : socialDirectRunMessage
            ? socialDirectMessageInputText(socialDirectRunMessage, historyMessages)
            : turn.input.graphText;
      const imageId = socialPost?.imageId ?? socialDirectMessage?.origin?.postImageId;
      const inputImages = imageId
        ? [socialImageById(imageId)].filter(
            (image): image is ChatImageAttachment => !!image,
          )
        : [];
      const promptSlot = turn.promptSlot ?? (
        socialPost
          ? socialPost.app === 'fotogram' ? 0 : 1
          : socialThreadAction
            ? socialThreadAction.app === 'fotogram' ? 2 : 3
            : socialDirectRunMessage?.app === 'fotogram' ? 4 : 5
      );
      applyTurnCheckpointRuntime(turn, 'before');
      void runGraph(
        displayText,
        inputImages,
        socialDirectRegenerateInputMessage,
        historyMessages,
        replacedMessageIds,
        actor,
        false,
        undefined,
        { turn, replaceInput: false },
        turn.mode ?? 'user',
        socialDirectRegenerateInputMessage?.eventDisplayText,
        undefined,
        undefined,
        false,
        socialMediaMessageFormat,
        promptSlot,
        undefined,
        undefined,
        socialPost,
        socialThreadAction,
        threadContext,
        false,
        socialDirectRunMessage,
      );
      return;
    }
    if (turn.messageFormat === autoplayMessageFormat) {
      applyTurnCheckpointRuntime(turn, 'before');
      void runGraph(
        turn.input.graphText,
        [],
        undefined,
        messagesRef.current.filter((message) => !allTurnMessageIds.has(message.id)),
        replacedMessageIds,
        undefined,
        false,
        undefined,
        { turn, replaceInput: false },
        'user',
        undefined,
        undefined,
        undefined,
        false,
        autoplayMessageFormat,
        turn.promptSlot ?? localActivityPromptSlot,
      );
      return;
    }
    if (isAutoTurn) {
      const phoneInput = parsePhoneGraphInput(turn.input.graphText);
      const phoneAutoTurn = !!phoneInput;
      const inputCharacter = phoneInput
        ? phoneCharacters.find((character) => phoneNamesMatch(character.name, phoneInput.from)) ?? selectedCharacter
        : selectedCharacter;
      const phoneRecipient = phoneInput
        ? phoneCharacters.find((character) => phoneNamesMatch(character.name, phoneInput.to))
        : undefined;
      applyTurnCheckpointRuntime(turn, 'before');
      void runGraph(
        storedAutoTurnInputText(turn.input.graphText),
        [],
        undefined,
        messagesRef.current.filter((message) => !allTurnMessageIds.has(message.id)),
        replacedMessageIds,
        inputCharacter,
        phoneAutoTurn,
        phoneRecipient,
        { turn, replaceInput: false },
        'auto-turn',
        inputMessage?.eventDisplayText,
      );
      return;
    }
    if (turn.mode === 'narrator') {
      applyTurnCheckpointRuntime(turn, 'before');
      void runGraph(
        storedNarratorInputText(turn.input.graphText),
        inputMessage?.imageAttachments ?? [],
        inputMessage,
        messagesRef.current.filter((message) => !allTurnMessageIds.has(message.id)),
        replacedMessageIds,
        undefined,
        false,
        undefined,
        { turn, replaceInput: false },
        'narrator',
      );
      return;
    }
    if (!inputMessage) {
      return;
    }
    const inputCharacter = inputMessage.speakerName
      ? phoneCharacters.find((character) => phoneNamesMatch(character.name, inputMessage.speakerName ?? ''))
      : selectedCharacter;
    applyTurnCheckpointRuntime(turn, 'before');
    void runGraph(
      inputMessage.translatedText ?? inputMessage.originalText,
      inputMessage.imageAttachments ?? [],
      inputMessage,
      messagesRef.current.filter((message) => !allTurnMessageIds.has(message.id)),
      replacedMessageIds,
      inputCharacter,
      inputMessage.phoneMessage,
      inputMessage.phoneTo
        ? phoneCharacters.find((character) => phoneNamesMatch(character.name, inputMessage.phoneTo ?? ''))
        : undefined,
      { turn, replaceInput: false },
    );
  }

  function cancelEditMessage() {
    setEditingMessageId(null);
    setEditingDraft('');
  }

  function undoLastTurn() {
    const turnIndex = lastSessionTurnIndex(turnsRef.current);
    const turn = turnIndex >= 0 ? turnsRef.current[turnIndex] : undefined;
    if (isRunning) {
      return;
    }
    if (!turn) {
      return;
    }
    const removedIds = turnMessageIds(turn);
    const nextTurns = turnsRef.current.filter((_, index) => index !== turnIndex);
    turnsRef.current = nextTurns;
    setTurns(nextTurns);
    messagesRef.current = messagesRef.current.filter((message) => !removedIds.has(message.id));
    setMessages(messagesRef.current);
    applyTurnCheckpointRuntime(turn, 'before');
    pruneStorybookExternalImagesForMessages();
    setOutputActionChoicesHiddenByTurn(turn.id, false);
    removeTurnCheckpoint(turn.id);
    removeTurnTracesForTurn(turn.id);
    const removedTurnMessages = flattenTurnMessages([turn]);
    setChatGpdChatsByCharacter((current) =>
      revertSimulatedAiChatsForMessages(current, removedTurnMessages, messagesRef.current)
    );
    setPhoneNotesByCharacter((current) =>
      revertCreatedPhoneNotesForMessages(current, removedTurnMessages, messagesRef.current)
    );
    cancelEditMessage();
  }

  function cancelRunOrUndoLastTurn() {
    if (isRunning) {
      cancelCurrentRun('cancel');
      return;
    }
    undoLastTurn();
  }

  function beginEditMessage(message: MessageRecord, visibleText: string) {
    if (isRunning) {
      return;
    }
    setEditingMessageId(message.id);
    setEditingDraft(visibleText);
  }

  function applyInputTimeCommands(commands: StructuredInputCommand[]) {
    const timeCommandResult = applyTimeCommandsToWorkflowNodes(nodesRef.current, commands);
    if (timeCommandResult.error) {
      notifySystem('warning', timeCommandResult.error);
      return false;
    }
    if (timeCommandResult.appliedDateTime) {
      commitNodes(timeCommandResult.nodes);
      notifySystem('info', `RP Time set to ${timeCommandResult.appliedDateTime}.`);
    }
    return true;
  }

  function regenerateEditedMessage() {
    if (editingMessageId === null) {
      return;
    }
    if (isRunning) {
      const retry = activeRunRef.current?.retry;
      if (retry) {
        pendingRunRestartRef.current = retry;
        cancelCurrentRun('restart');
      }
      return;
    }
    const editedText = editingDraft.trim();
    if (!editedText) {
      return;
    }
    const inputIndex = messagesRef.current.findIndex((message) => message.id === editingMessageId);
    const inputMessage = messagesRef.current[inputIndex];
    if (inputIndex < 0 || inputMessage?.role !== 'user') {
      cancelEditMessage();
      return;
    }
    const inputCharacter = inputMessage.speakerName
      ? phoneCharacters.find((character) => phoneNamesMatch(character.name, inputMessage.speakerName ?? ''))
      : selectedCharacter;
    const turn =
      turnsRef.current.find((entry) => entry.id === inputMessage.turnId) ??
      turnsRef.current[turnsRef.current.length - 1];
    if (!turn || turn.id !== turnsRef.current[turnsRef.current.length - 1]?.id) {
      cancelEditMessage();
      return;
    }
    const replacedMessageIds = turnMessageIds(turn);
    cancelEditMessage();
    applyTurnCheckpointRuntime(turn, 'before');
    void runGraph(
      editedText,
      inputMessage.imageAttachments ?? [],
      undefined,
      messagesRef.current.filter((message) => !replacedMessageIds.has(message.id)),
      replacedMessageIds,
      inputCharacter,
      inputMessage.phoneMessage,
      inputMessage.phoneTo
        ? phoneCharacters.find((character) => phoneNamesMatch(character.name, inputMessage.phoneTo ?? ''))
        : undefined,
      { turn, replaceInput: true },
      inputMessage.speakerName === narratorSpeakerName ? 'narrator' : 'user',
    );
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning) {
      cancelCurrentRun('cancel');
      return;
    }
    const message = draft.trim();
    const inputPayload = structuredInputPayload(draftCommands, message);
    if (!message && draftImages.length === 0) {
      if (inputPayload.commands.some((command) => command.type === 'time')) {
        if (applyInputTimeCommands(inputPayload.commands)) {
          setDraft('');
          setDraftCommands([]);
        }
      }
      return;
    }
    const commandCheck = applyTimeCommandsToWorkflowNodes(nodesRef.current, inputPayload.commands);
    if (commandCheck.error) {
      notifySystem('warning', commandCheck.error);
      return;
    }
    setDraft('');
    setDraftCommands([]);
    setDraftImages([]);
    if (!narratorSelected && selectedCharacter) {
      rememberChatCharacter(selectedCharacter.id);
    }
    void runGraph(
      message,
      draftImages,
      undefined,
      messagesRef.current,
      undefined,
      narratorSelected ? undefined : selectedCharacter,
      false,
      undefined,
      undefined,
      narratorSelected ? 'narrator' : 'user',
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      inputPayload,
    );
  }

  function submitOutputActionChoice(selection: InputActionSelection) {
    if (isRunning) {
      return;
    }
    if (selection.mode === 'state') {
      notifySystem('info', 'State Output Actions are not implemented yet.');
      return;
    }
    const actionText = selection.text ?? selection.value ?? selection.label;
    const requestedPlayer = selection.player?.trim();
    const requestedPlayerKey = requestedPlayer?.toLocaleLowerCase();
    let runNarratorSelected = narratorSelected;
    let runSelectedCharacter = selectedCharacter;

    if (requestedPlayer && requestedPlayerKey !== 'current') {
      if (phoneNamesMatch(requestedPlayer, narratorSpeakerName)) {
        runNarratorSelected = true;
        runSelectedCharacter = undefined;
      } else {
        const targetCharacter = storyCharacters.find(
          (character) => character.id === requestedPlayer || phoneNamesMatch(character.name, requestedPlayer),
        );
        if (targetCharacter) {
          runNarratorSelected = false;
          runSelectedCharacter = targetCharacter;
        } else {
          runNarratorSelected = true;
          runSelectedCharacter = undefined;
          notifySystem('warning', `Output Actions could not find player "${requestedPlayer}". Falling back to Narrator.`);
        }
      }
    }

    if (!runNarratorSelected && runSelectedCharacter) {
      rememberChatCharacter(runSelectedCharacter.id);
    }
    void runGraph(
      actionText,
      [],
      undefined,
      messagesRef.current,
      undefined,
      runNarratorSelected ? undefined : runSelectedCharacter,
      false,
      undefined,
      undefined,
      runNarratorSelected ? 'narrator' : 'user',
      undefined,
      undefined,
      undefined,
      false,
      selection.messageFormat,
      selection.turnMode,
    );
  }

  const {
    submitBankTransfer,
    submitOnlyFriendsWalletTransfer,
    commitCreatedPhoneNote,
    updatePhoneNoteColor,
    deletePhoneNote,
    commitChatGpdChat,
  } = useDirectAppActions({
    runGraph,
    isRunning,
    messagesRef,
    turnsRef,
    applyTurnCheckpointRuntime,
    undoLastTurn,
    replaceLastTurnCreatedPhoneNote,
    removeLastTurnCreatedPhoneNote,
    viewedPhoneCharacter,
    phoneNotesByCharacter,
    setPhoneNotesByCharacter,
    notifySystem,
  });

  async function submitSocialPost(request: {
    author: StorybookCharacter;
    post: SocialPostRecord;
    image?: ChatImageAttachment;
  }) {
    if (isRunning) {
      return false;
    }
    return runGraph(
      socialPostInputText(request.post),
      request.image ? [request.image] : [],
      undefined,
      messagesRef.current,
      undefined,
      request.author,
      false,
      undefined,
      undefined,
      'user',
      undefined,
      undefined,
      undefined,
      false,
      socialMediaMessageFormat,
      // Each social app has its own prompt slot: 0 = Fotogram, 1 = OnlyFriends.
      request.post.app === 'fotogram' ? 0 : 1,
      undefined,
      undefined,
      request.post,
    );
  }

  // Social posts link images by Storybook/Gallery id instead of storing their
  // own copy. Uploaded files are imported into the acting character's Gallery
  // first (deduplicated by image data), then the post references the saved id.
  async function importSocialPostImage(request: {
    owner: StorybookCharacter;
    image: ChatImageAttachment;
  }) {
    const normalized = await normalizeImageAttachment(
      {
        name: request.image.name,
        mimeType: request.image.mimeType,
        size: request.image.size,
        dataUrl: request.image.dataUrl,
      },
      () => `image-${uniqueId()}`,
    );
    const savedImages = ensureImagesForStorybookCharacter(
      request.owner,
      [normalized],
      '',
      (addedCount) =>
        addedCount > 0
          ? `Saved uploaded image for ${request.owner.name}.`
          : `Uploaded image already saved for ${request.owner.name}.`,
    );
    if (!savedImages?.length) {
      notifySystem('error', `Could not save the uploaded image for ${request.owner.name}.`);
      return undefined;
    }
    return savedImages[0];
  }

  async function submitSocialThreadAction(request: {
    actor: StorybookCharacter;
    action: SocialThreadActionRecord;
    existingComments: SocialReactionComment[];
    likeCount: number;
  }) {
    if (isRunning) {
      return false;
    }
    return runGraph(
      socialThreadActionInputText(
        request.action,
        request.existingComments,
        request.likeCount,
      ),
      [],
      undefined,
      messagesRef.current,
      undefined,
      request.actor,
      false,
      undefined,
      undefined,
      'user',
      undefined,
      undefined,
      undefined,
      false,
      socialMediaMessageFormat,
      // Both thread actions share the app's prompt slot.
      request.action.app === 'fotogram' ? 2 : 3,
      undefined,
      undefined,
      undefined,
      request.action,
      {
        existingComments: request.existingComments,
        likeCount: request.likeCount,
      },
    );
  }

  async function submitSocialDirectMessage(message: SocialDirectMessageRecord) {
    if (isRunning) {
      return false;
    }
    const actor = storyCharacters.find((character) =>
      socialIdentityMatches(character.name, message.from) ||
      socialIdentityMatches(character.id, message.from),
    ) ?? selectedCharacter;
    if (!actor) {
      notifySystem('warning', 'Select a Storybook character before sending a social direct message.');
      return false;
    }
    return runGraph(
      socialDirectMessageInputText(message, messagesRef.current),
      message.origin?.postImageId
        ? [socialImageById(message.origin.postImageId)].filter(
            (image): image is ChatImageAttachment => !!image,
          )
        : [],
      undefined,
      messagesRef.current,
      undefined,
      actor,
      false,
      undefined,
      undefined,
      'user',
      undefined,
      undefined,
      undefined,
      false,
      socialMediaMessageFormat,
      message.app === 'fotogram' ? 4 : 5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      message,
    );
  }

  function selectPhoneImagesFromComposer() {
    void selectPhoneImages();
  }

  function addPhoneImagesFromComposer(files: FileList | null) {
    void addPhoneImages(files);
  }

  function submitPhoneMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning) {
      cancelCurrentRun('cancel');
      return;
    }
    const message = phoneDraft.trim();
    const inputPayload = structuredInputPayload(phoneDraftCommands, message);
    if (!message && phoneImages.length === 0) {
      if (inputPayload.commands.some((command) => command.type === 'time')) {
        if (applyInputTimeCommands(inputPayload.commands)) {
          setPhoneDraft('');
          setPhoneDraftCommands([]);
        }
      }
      return;
    }
    const commandCheck = applyTimeCommandsToWorkflowNodes(nodesRef.current, inputPayload.commands);
    if (commandCheck.error) {
      notifySystem('warning', commandCheck.error);
      return;
    }
    if (narratorSelected) {
      notifySystem('warning', 'Narrator cannot send phone messages from the Phone tab. Use the Chat tab.');
      return;
    }
    if (!selectedPhoneContact) {
      notifySystem('warning', 'Select a phone contact first.');
      return;
    }
    if (selectedCharacter) {
      openPhoneConversation(selectedPhoneContact.conversationKey, selectedPhoneContact.latestPhoneId, {
        speakerId: selectedCharacter.id,
        contactId: selectedPhoneContact.character.id,
      });
    }
    const images = phoneImages;
    const replyTo = phoneReplyToMessage;
    retainReplyReferenceImages(replyTo);
    setPhoneDraft('');
    setPhoneDraftCommands([]);
    setPhoneImages([]);
    clearPhoneReply();
    setShowPhoneEmojiPicker(false);
    void runGraph(
      message,
      images,
      undefined,
      messagesRef.current,
      undefined,
      selectedCharacter,
      true,
      selectedPhoneContact.character,
      undefined,
      'user',
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      replyTo,
      inputPayload,
    );
  }

  async function runSelectedEvent() {
    if (isRunning || !eventManagerAvailable || !selectedEvent) {
      return;
    }
    const eventToRun = selectedEvent;
    const completeEvent = () => closeEvent(eventToRun.id, 'completed');
    if (eventToRun.channel === 'phone') {
      const senderName = eventToRun.phoneFrom ?? eventToRun.assignedTo;
      const recipientName = eventToRun.phoneTo ?? eventToRun.requestedBy;
      const sender =
        senderName
          ? phoneCharacters.find((character) => phoneNamesMatch(character.name, senderName))
          : selectedCharacter;
      const recipient =
        recipientName
          ? phoneCharacters.find((character) => phoneNamesMatch(character.name, recipientName))
          : undefined;
      if (!sender || !recipient) {
        notifySystem('warning', 'Phone event needs a sender and recipient character.');
        return;
      }
      const eventGraphText = eventGraphInputText(eventToRun);
      const eventNarratorText = eventChatDisplayText(
        eventToRun,
        rpDateTimeFormat,
        rpWeekdayLanguage,
      );
      await runGraph(
        eventGraphText,
        [],
        undefined,
        messagesRef.current,
        undefined,
        sender,
        true,
        recipient,
        undefined,
        'auto-turn',
        eventNarratorText,
        completeEvent,
        'received',
      );
      return;
    }
    const eventSpeaker = eventStoryCharacter(eventToRun, storyCharacters);
    if (!eventSpeaker) {
      notifySystem('warning', 'Event needs at least one playable character.');
      return;
    }
    const eventGraphText = eventGraphInputText(eventToRun);
    const eventNarratorText = eventChatDisplayText(
      eventToRun,
      rpDateTimeFormat,
      rpWeekdayLanguage,
    );
    await runGraph(
      eventGraphText,
      [],
      undefined,
      messagesRef.current,
      undefined,
      eventSpeaker,
      undefined,
      undefined,
      undefined,
      'auto-turn',
      eventNarratorText,
      completeEvent,
    );
  }

  function triggerAutoTurn() {
    if (autoTurnDisabled) {
      return;
    }
    const inputNode = nodesRef.current.find((node) => node.data.nodeType === 'input');
    const autoTurnInstructions = autoTurnInstructionSettings(inputNode?.data.autoTurnInstructions);
    if (chatPanelView === 'events') {
      runSelectedEvent();
      return;
    }
    if (chatPanelView === 'phone') {
      if (narratorSelected) {
        void runGraph(
          autoTurnNarratorPhoneInstruction(autoTurnInstructions),
          [],
          undefined,
          messagesRef.current,
          undefined,
          undefined,
          true,
          undefined,
          undefined,
          'narrator',
          undefined,
          undefined,
          undefined,
          true,
        );
        return;
      }
      if (!selectedCharacter || !selectedPhoneContact) {
        notifySystem('warning', 'Select a phone contact first.');
        return;
      }
      void runGraph(
        autoTurnPhoneInstruction(
          selectedCharacter.name,
          selectedPhoneContact.character.name,
          autoTurnInstructions,
        ),
        [],
        undefined,
        messagesRef.current,
        undefined,
        selectedCharacter,
        true,
        selectedPhoneContact.character,
        undefined,
        'auto-turn',
      );
      return;
    }
    if (!selectedCharacter && !narratorSelected) {
      notifySystem('warning', 'Select a Storybook character first.');
      return;
    }
    void runGraph(
      narratorSelected
        ? autoTurnNarratorInstruction(autoTurnInstructions)
        : autoTurnRpInstruction(selectedCharacter!.name, autoTurnInstructions),
      [],
      undefined,
      messagesRef.current,
      undefined,
      narratorSelected ? undefined : selectedCharacter,
      false,
      undefined,
      undefined,
      narratorSelected ? 'narrator' : 'auto-turn',
      undefined,
      undefined,
      undefined,
      narratorSelected,
    );
  }

  const displayedWorkflowName = activeWorkflowFileName
    ? activeWorkflowFileName === 'embedded workflow'
      ? 'embedded in RP'
      : activeWorkflowFileName
    : 'not saved';
  const displayedSessionSavedTurn =
    activeSessionFileName && activeSessionSavedTurn !== null
      ? `Turn ${activeSessionSavedTurn} Saved`
      : null;
  const headerStorybookNode = nodeViewNodes.find(
    (node) => node.data.kind === undefined && node.data.nodeType === 'rp-storybook',
  );
  const headerStorybookFileName = headerStorybookNode?.data.storybookFileName;
  const headerStorybookJson = headerStorybookNode?.data.storybookJson;
  const displayedStorybookName = displayStorybookName(
    headerStorybookFileName,
    headerStorybookJson,
    activeSessionFileName,
  );

  const formatEncryptedFileName = (fileName: string | null | undefined) => {
    if (!fileName) return '';
    return /\.json$/i.test(fileName) ? fileName : `${fileName}.json`;
  };

  const isSessionEncrypted = activeSessionProtection === 'encrypted';
  const displayedSessionFileName = isSessionEncrypted && activeSessionFileName
    ? formatEncryptedFileName(activeSessionFileName)
    : (activeSessionFileName ?? 'not saved');

  const isWorkflowEncrypted = activeWorkflowProtection === 'encrypted' && !!activeWorkflowFileName;
  const displayedWorkflowNameFormatted = isWorkflowEncrypted
    ? activeWorkflowFileName === 'embedded workflow'
      ? displayedWorkflowName
      : formatEncryptedFileName(activeWorkflowFileName)
    : displayedWorkflowName;

  const isStorybookEncrypted =
    (activeStorybookProtection === 'encrypted' && !!headerStorybookNode?.data.storybookFileName) ||
    (isSessionEncrypted && !headerStorybookNode?.data.storybookFileName && !!headerStorybookNode?.data.storybookJson) ||
    (activeWorkflowProtection === 'encrypted' && !headerStorybookNode?.data.storybookFileName && !!headerStorybookNode?.data.storybookJson);
  const displayedStorybookNameFormatted = isStorybookEncrypted
    ? headerStorybookNode?.data.storybookFileName
      ? formatEncryptedFileName(headerStorybookNode.data.storybookFileName)
      : displayedStorybookName
    : displayedStorybookName;

  const headerLockIcon = (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ marginLeft: '4px', verticalAlign: 'middle', opacity: 0.9, color: 'var(--success)' }}
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );

  const textDialogSourceNode = nodes.find((node) => node.id === textDialogNodeId);
  const textDialogNode = textDialogSourceNode;
  const jsonDialogNode = nodes.find((node) => node.id === jsonDialogNodeId);
  const storybookCreatorNode = nodeViewNodes.find((node) => node.id === storybookCreatorNodeId);
  const customNodeAssistantNode = customNodeAssistant.activeNode;
  const nodeAssistantNode = nodeViewNodes.find((node) => node.id === nodeAssistantNodeId);
  const nodeAssistantMessages = nodeAssistantNodeId ? (nodeAssistantHistories[nodeAssistantNodeId] || []) : [];
  const workflowAssistantSnapshotJson = useMemo(
    () => createWorkflowAssistantSnapshotJson(nodeViewNodes, edges),
    [edges, nodeViewNodes],
  );
  const [assistantDebugSnapshotSections, setAssistantDebugSnapshotSections] =
    useState<DebugSnapshotAssistantSection[]>([]);
  useEffect(
    () => {
      // Building the debug snapshot reads refs and serializes large parts of the app
      // state, so it must not run during render; recompute only when the serialized
      // inputs change instead of on every render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAssistantDebugSnapshotSections(
        nodeAssistantNode || workflowAssistantOpen ? createAssistantDebugSnapshotSections() : [],
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeTokenEstimateBytesPerToken,
      edges,
      messages,
      nodeAssistantNode,
      nodeViewNodes,
      sessionName,
      systemLog,
      workflowAssistantOpen,
    ],
  );
  const setNodeAssistantMessages = (
    newMessages: React.SetStateAction<AssistantChatMessage[]>
  ) => {
    if (!nodeAssistantNodeId) return;
    setNodeAssistantHistories((prev) => {
      const current = prev[nodeAssistantNodeId] || [];
      const next = typeof newMessages === 'function'
        ? (newMessages as (prev: AssistantChatMessage[]) => AssistantChatMessage[])(current)
        : newMessages;
      return {
        ...prev,
        [nodeAssistantNodeId]: next,
      };
    });
  };
  const outputNode = nodeViewNodes.find(
    (node) => node.data.kind === undefined && node.data.nodeType === 'output',
  );
  const dialogueColorsEnabled = outputNode?.data.dialogueHighlightEnabled ?? false;
  let editableUserMessageId: number | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.includeInHistory !== false) {
      editableUserMessageId = message.id;
      break;
    }
  }
  const nodeViewValues = useMemo<NodeViewValues>(() => ({
    connections,
    providerHealthById,
    onCheckProviderConnection: (connectionId) => {
      void checkProviderConnectionById(connectionId);
    },
    estimatedTokenBytesPerToken: activeTokenEstimateBytesPerToken,
    settingsValueDefinitions,
    settingsValues: resolvedWorkflowSettingsValues,
    promptActionCustomPresets,
    setPromptActionCustomPresets,
    promptActionSettings,
    setPromptActionSettings,
    promptTextCustomPresets,
    setPromptTextCustomPresets,
    nodes: nodeViewNodes,
    edges,
  }), [
    activeTokenEstimateBytesPerToken,
    checkProviderConnectionById,
    connections,
    edges,
    nodeViewNodes,
    providerHealthById,
    promptActionCustomPresets,
    promptActionSettings,
    promptTextCustomPresets,
    resolvedWorkflowSettingsValues,
    setPromptActionCustomPresets,
    setPromptActionSettings,
    setPromptTextCustomPresets,
    settingsValueDefinitions,
  ]);
  const renderedEdges = useMemo(
    () => withSourceNodeStatusConnectionColors(edges, nodeViewNodes),
    [edges, nodeViewNodes],
  );
  const workflowCapabilityIndicators = useWorkflowCapabilities({
    nodes: nodeViewNodes,
    connections,
    providerHealthById,
    defaultConnectionId,
    promptActionSettings,
    dialogueVoiceMode,
    storyCharacters,
    resolvedNarratorProviderId,
    imageGenerationActive:
      workflowComfyGenerationActive || comfyProviderActionActive === 'generate',
    audioGenerationActive:
      voiceGenerationActive || apiNarratorGenerationActive || readAloudActive,
  });

  return (
    <div
      className={`studio node-text-${nodeTextSize}${glassDesignEnabled ? ' glass-design-active' : ''}`}
      style={{
        '--glass-opacity': glassDesignOpacity,
        '--glass-blur': glassDesignEnabled ? '1px' : '0px',
      } as React.CSSProperties}
    >
      {showRunLlmReport && runLlmReport && (
        <RunLlmReportDialog
          currentReport={runLlmReport}
          currentDurationMs={runDurationMs}
          history={runHistory}
          isRunning={isRunning && activeRunId === runLlmReport.runId}
          runStartTimeMs={runStartTimeMs}
          onClose={() => setShowRunLlmReport(false)}
        />
      )}
      <header className="topbar">
        <div className="brand">
          <h1>
            <span className="brand-name"><span className="brand-name-rp">RP</span>graph Studio</span>
            <span className="app-version">v{packageMetadata.version} Beta</span>
          </h1>
          <div className="header-brand-actions">
            <button
              className="connection-button"
              type="button"
              onClick={() => setShowWelcome(true)}
              title="Show first-run welcome and onboarding guide"
            >
              Welcome
            </button>
            <button className="connection-button" type="button" onClick={() => setShowOptions(true)}>
              Options
            </button>
            <button className="connection-button" type="button" onClick={openConnectionManager}>
              Providers
            </button>
            <button
              className="connection-button"
              type="button"
              onClick={() => {
                setNodeAssistantNodeId(null);
                setWorkflowAssistantOpen(true);
              }}
              title="Open workflow assistant. You can also press F1, or select a node and press F1 for node-specific help."
            >
              Assistant
            </button>
            <button
              className={`connection-button log-button ${systemLogBadgeCount ? 'has-log' : ''}`}
              type="button"
              onClick={() => setShowSystemLog(true)}
              title="Open system log"
            >
              Log
              {systemLogBadgeCount > 0 && <span key={systemLogBadgeCount}>{systemLogBadgeCount}</span>}
            </button>
            <button className="connection-button" type="button" onClick={() => void openFiles()}>
              Files
            </button>
          </div>
        </div>
        <div className="header-actions">
          {settingsStatus && <span className="workflow-status">{settingsStatus}</span>}
          <div className="topbar-file-status" aria-label="Active RP files">
            <div className="status-badge">
              <span className="session-label">RP save:</span>
              <span className="session-file">
                {displayedSessionFileName}
                {isSessionEncrypted && headerLockIcon}
              </span>
              {displayedSessionSavedTurn && (
                <span className="session-turn">{displayedSessionSavedTurn}</span>
              )}
            </div>
            <div className="status-badge">
              <span className="session-label">workflow:</span>
              <span className="session-file">
                {displayedWorkflowNameFormatted}
                {isWorkflowEncrypted && headerLockIcon}
              </span>
            </div>
            <div className="status-badge">
              <span className="session-label">storybook:</span>
              <span className="session-file">
                {displayedStorybookNameFormatted}
                {isStorybookEncrypted && headerLockIcon}
              </span>
            </div>
          </div>
          <div className="window-controls" aria-label="Window controls">
            <button
              className="window-control"
              type="button"
              onClick={() => void window.rpgraph.minimizeWindow()}
              aria-label="Minimize window"
              title="Minimize"
            >
              <span className="window-control-icon minimize" aria-hidden="true" />
            </button>
            <button
              className="window-control"
              type="button"
              onClick={() => void window.rpgraph.toggleFullScreenWindow()}
              aria-label="Toggle full screen"
              title="Full screen (F11)"
            >
              <span className="window-control-icon full-screen" aria-hidden="true" />
            </button>
            <button
              className="window-control"
              type="button"
              onClick={() => void window.rpgraph.toggleMaximizeWindow()}
              aria-label="Maximize or restore window"
              title="Maximize / Restore"
            >
              <span className="window-control-icon maximize" aria-hidden="true" />
            </button>
            <button
              className="window-control close"
              type="button"
              onClick={() => void window.rpgraph.closeWindow()}
              aria-label="Close window"
              title="Close"
            >
              <span className="window-control-icon close" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main
        className={`workspace ${isResizing ? 'resizing' : ''}`}
      >
        <ErrorBoundary label="Graph Panel">
        <section className="graph-panel" aria-label="Workflow Graph">
          <div className="graph-toolbar">
            <div className="panel-label">
              <span>GRAPH</span>
              <PromptPresetOverview
                nodes={nodeViewNodes}
                connections={connections}
                providerHealthById={providerHealthById}
                onCheckProviderConnection={(connectionId) => {
                  void checkProviderConnectionById(connectionId);
                }}
                promptActionCustomPresets={promptActionCustomPresets}
                setPromptActionCustomPresets={setPromptActionCustomPresets}
                promptActionSettings={promptActionSettings}
                setPromptActionSettings={setPromptActionSettings}
                promptTextCustomPresets={promptTextCustomPresets}
                setPromptTextCustomPresets={setPromptTextCustomPresets}
                updateNodeData={updateRuntimeNode}
              />
              <button
                className="graph-reset"
                type="button"
                onClick={() => void resetWorkflow()}
                disabled={!!activeSessionFileName}
                title={activeSessionFileName
                  ? 'Workflow reset is unavailable while an RP save is active.'
                  : 'Reset workflow'}
              >
                Reset Workflow
              </button>
              <button className="graph-reset" type="button" onClick={() => void saveCurrentWorkflow()}>
                Save Workflow
              </button>
              <button className="graph-reset" type="button" onClick={() => void saveCurrentSession()}>
                Save RP
              </button>
              <button
                className="runtime-summary-button"
                type="button"
                onClick={() => setShowRunLlmReport(true)}
                disabled={!runLlmReport}
                title="Show LLM calls for the current or last run"
              >
                Runtime: <LiveRunClock isRunning={isRunning} startTimeMs={runStartTimeMs} finalMs={runDurationMs} /> s
              </button>
              <WorkflowCapabilityStrip indicators={workflowCapabilityIndicators} />
              {visibleLogEntry && (
                <div
                  key={visibleLogEntry.id}
                  className={`graph-system-toast ${visibleLogEntry.level}`}
                  role="status"
                  aria-live="polite"
                >
                  <div className="graph-system-toast-content">
                    <strong>{visibleLogEntry.level}</strong>
                    <span>{visibleLogEntry.text}</span>
                  </div>
                </div>
              )}
            </div>
            {showDeletedNodeRestoreButton && (
              <button
                className="graph-restore-deleted"
                type="button"
                onClick={restoreLastDeletedNodes}
                title="Restore last deleted node"
                aria-label="Restore last deleted node"
              >
                ↶
              </button>
            )}
          </div>
          <NodeActionsContext.Provider value={nodeActions}>
            <NodeViewContext.Provider value={nodeViewValues}>
              <ReactFlow
                nodes={nodes}
                edges={renderedEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onInit={initializeFlow}
                onDragOver={allowNodeDrop}
                onDrop={dropNode}
                onPaneContextMenu={openNodeMenu}
                onPaneClick={() => {
                  setNodeMenu(null);
                  setIsChatPanelOpen(false);
                }}
                onNodeClick={() => {
                  setIsChatPanelOpen(false);
                }}
                onNodeDoubleClick={(_event, node) => splitWireLink(node.id)}
                onNodesChange={onNodesChange}
                onNodesDelete={rememberDeletedNodes}
                onEdgesChange={onEdgesChange}
                onConnect={connectNodes}
                onReconnect={reconnectNodes}
                onReconnectStart={startReconnect}
                onReconnectEnd={finishReconnect}
                minZoom={0.25}
                maxZoom={1.6}
                nodesConnectable
                edgesReconnectable
                elementsSelectable
                onlyRenderVisibleElements
                deleteKeyCode={['Backspace', 'Delete']}
                multiSelectionKeyCode="Control"
                selectionKeyCode="Control"
                connectionRadius={connectionRadius}
                reconnectRadius={reconnectRadius}
                zoomOnDoubleClick={false}
                colorMode="dark"
                proOptions={{ hideAttribution: true }}
              >
                <Background
                  color="#273043"
                  gap={24}
                  size={1.5}
                  variant={BackgroundVariant.Dots}
                />
                <Controls position="bottom-left" showInteractive={false} />
                <ResourceMonitor />
              </ReactFlow>
            </NodeViewContext.Provider>
          </NodeActionsContext.Provider>
          <aside className="node-palette" aria-label="Available nodes">
            <div className="node-palette-handle" aria-hidden="true">
              NODES
            </div>
            <div className="node-palette-drawer">
              <header>
                <strong>Add Node</strong>
                <small>Drag onto graph</small>
              </header>
              <div className="node-palette-items">
                {groupedNodePaletteItems.map((group) => (
                  <section className="node-palette-group" key={group.title}>
                    <div className="node-palette-group-header">
                      <strong>{group.title}</strong>
                    </div>
                    {group.items.map((item) => {
                      const unavailable = nodeTypeUnavailable(item.type);
                      const favorite = favoriteNodeTypeSet.has(item.type);
                      return (
                        <div className={`node-palette-item-row${favorite ? ' favorite' : ''}`} key={item.type}>
                          <button
                            className="node-favorite-button"
                            type="button"
                            aria-pressed={favorite}
                            aria-label={favorite ? `Remove ${item.label} from quick add` : `Add ${item.label} to quick add`}
                            title={favorite ? 'Remove from right-click quick add' : 'Add to right-click quick add'}
                            onClick={() => toggleFavoriteNodeType(item.type)}
                          >
                            ★
                          </button>
                          <button
                            className="node-palette-item"
                            type="button"
                            disabled={unavailable}
                            draggable={!unavailable}
                            onDragStart={(event) => startNodeDrag(event, item.type)}
                          >
                            <span className="node-menu-item-label">
                              <span>{item.label}</span>
                              <small className="node-menu-item-version">v{item.version}</small>
                            </span>
                            <small>{unavailable ? 'Already in graph' : item.description}</small>
                          </button>
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>
          </aside>
          {nodeMenu && (
            <div
              className="node-menu"
              style={{ left: nodeMenu.screen.x, top: nodeMenu.screen.y }}
            >
              <strong>Quick Add</strong>
              {favoriteNodeItems.length ? favoriteNodeItems.map((item) => {
                const unavailable = nodeTypeUnavailable(item.type);
                return (
                  <button
                    type="button"
                    key={item.type}
                    disabled={unavailable}
                    onClick={() => addNode(item.type)}
                  >
                    <span className="node-menu-item-label">
                      <span>{item.label}</span>
                      <small className="node-menu-item-version">v{item.version}</small>
                    </span>
                    <small>{unavailable ? 'Already in graph' : item.description}</small>
                  </button>
                );
              }) : (
                <p className="node-menu-empty">Mark nodes with ★ in the side panel.</p>
              )}
            </div>
          )}
        </section>
        </ErrorBoundary>

        <div
          className={`chat-drawer ${isChatPanelOpen || isResizing ? 'open' : ''}`}
          style={{ gridTemplateColumns: `7px ${chatWidth}px` }}
          onMouseEnter={() => setIsChatPanelOpen(true)}
        >
          <div
            className="panel-resizer"
            role="separator"
            aria-label="Resize chat panel"
            aria-orientation="vertical"
            onPointerDown={() => {
              setIsChatPanelOpen(true);
              setIsResizing(true);
            }}
          >
            <span className="chat-drawer-handle" aria-hidden="true">CHAT</span>
          </div>

          <ErrorBoundary label="Chat Panel">
          <aside className="chat-panel">
          <div className="chat-header">
            <div className="chat-header-primary">
              <div className="chat-panel-tabs" role="tablist" aria-label="Chat views">
                <button
                  className={chatPanelView === 'chat' ? 'active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={chatPanelView === 'chat'}
                  onClick={() => selectChatPanelView('chat')}
	                >
	                  Chat
	                  {unreadChatCount > 0 && (
	                    <span className="tab-badge">{unreadChatCount}</span>
	                  )}
	                </button>
                <PhoneTab
                  active={chatPanelView === 'phone'}
                  notificationCount={unreadPhoneNotificationCount}
                  viewedPhoneHasNotifications={viewedPhoneHasNotifications}
                  settingsLoadComplete={settingsLoadComplete}
                  switchHintSeen={phoneNotificationSwitchHintSeen}
                  onSelect={selectPhonePanelView}
                  onCycleNotificationOwner={cyclePhoneNotificationOwner}
                  onSwitchHintSeen={() => setPhoneNotificationSwitchHintSeen(true)}
                />
                <button
                  className={chatPanelView === 'events' ? 'active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={chatPanelView === 'events'}
                  onClick={() => selectChatPanelView('events')}
                >
                  Events
                  {unreadEventCount > 0 && (
                    <span className="tab-badge">{unreadEventCount}</span>
                  )}
                </button>
              </div>
              <div className="speaker-picker-menu" ref={characterDropdownRef}>
                <span className="speaker-picker-label">Play as</span>
                <button
                  type="button"
                  className="speaker-picker-button nodrag"
                  aria-expanded={characterDropdownOpen}
                  onClick={() => setCharacterDropdownOpen((current) => !current)}
                  style={
                    narratorSelected
                      ? {
                          color: '#cbd5e1',
                          textShadow: '0 0 8px rgba(203, 213, 225, 0.35)',
                        }
                      : selectedCharacter
                      ? {
                          color: characterColors.get(selectedCharacter.name),
                          textShadow: `0 0 8px ${characterColors.get(selectedCharacter.name)}`,
                        }
                      : undefined
                  }
                >
                  {narratorSelected ? narratorSpeakerName : selectedCharacter ? selectedCharacter.name : 'Select Character'} ▾
                </button>
                {characterDropdownOpen && (
                  <div className="speaker-picker-popover" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        selectChatCharacter(narratorCharacterId);
                        setCharacterDropdownOpen(false);
                      }}
                      className="narrator-option"
                    >
                      {narratorSpeakerName}
                    </button>
                    {storyCharacters.map((character) => {
                      const charColor = characterColors.get(character.name);
                      return (
                        <button
                          type="button"
                          key={character.id}
                          role="menuitem"
                          onClick={() => {
                            selectChatCharacter(character.id);
                            setCharacterDropdownOpen(false);
                          }}
                          style={charColor ? { color: charColor } : undefined}
                        >
                          {character.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button
                className="switch-player-button"
                type="button"
                onClick={switchActivePlayer}
                disabled={switchPlayerDisabled}
                title={switchPlayerTitle}
              >
                Switch
              </button>
              <div className="header-turn-actions">
                <button
                  className="auto-turn-button"
                  type="button"
                  onClick={triggerAutoTurn}
                  disabled={autoTurnDisabled}
                  title={autoTurnTitle}
                >
                  {chatPanelView === 'events' ? 'Run Event' : 'AutoTurn'}
                </button>
                <div className="turn-controls" aria-label="Turn actions">
                  <button
                    type="button"
                    onClick={cancelRunOrUndoLastTurn}
                    disabled={undoTurnDisabled}
                    title={undoTurnTitle}
                    aria-label={undoTurnTitle}
                  >
                    {isRunning ? 'x' : '←'}
                  </button>
                  <button
                    type="button"
                    onClick={regenerateLastOutput}
                    disabled={!isRunning && !currentSessionTurn}
                    title={isRunning ? 'Cancel and restart the running RP output' : 'Regenerate the last RP output'}
                    aria-label={isRunning ? 'Cancel and restart the running RP output' : 'Regenerate the last RP output'}
                  >
                    ↶
                  </button>
                </div>
                <span className="turn-counter">
                  Turn {currentSessionTurn?.number ?? 0}
                </span>
              </div>
            </div>
          </div>
          <div className="chat-lockable">
          {chatPanelView === 'chat' ? (
            <ChatConversationPanel
              runtimeNodes={nodes}
              messages={messages}
              storyCharacters={storyCharacters}
              characterColors={characterColors}
              selectedCharacter={selectedCharacter}
              isNarratorSelected={narratorSelected}
              draft={draft}
              draftCommands={draftCommands}
              draftImages={draftImages}
              editingMessageId={editingMessageId}
              editingDraft={editingDraft}
              editableUserMessageId={editableUserMessageId}
              isRunning={isRunning}
              runStartTimeMs={runStartTimeMs}
              onCancelRun={cancelRunOrUndoLastTurn}
              englishProcessingEnabled={englishProcessingEnabled}
              dialogueHighlightEnabled={dialogueColorsEnabled}
              dialogueVoiceSpeakerNames={dialogueVoiceSpeakerNames}
              activeDialogueVoiceKey={activeDialogueVoiceKey}
              onSpeakDialogue={(request) => {
                // Voice generation unloads local LLM models first; never do that mid-run.
                if (isRunning) {
                  return;
                }
                void speakDialogue(request);
              }}
              onGenerateVoiceMessageClip={async ({ messageId, speakerName, text }) => {
                // Voice generation unloads local LLM models first; never do that mid-run.
                if (isRunning) {
                  return null;
                }
                try {
                  return await generateVoiceMessageClip(messageId, speakerName, text);
                } catch (error) {
                  notifySystem(
                    'error',
                    `Phone voice message failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
                  return null;
                }
              }}
              dialogueVoiceMode={dialogueVoiceMode}
              onDialogueVoiceModeChange={(mode) => {
                setDialogueVoiceMode(mode);
                if (mode !== 'read-aloud' && mode !== 'narrator-only' && readAloudActive) {
                  stopDialogueVoice();
                }
                if ((mode === 'preload' || mode === 'read-aloud') && !isRunning) {
                  void preloadTurnVoices(latestOutputTurnMessages(messages));
                }
              }}
              dialogueVoicePreloadDisabledReason={dialogueVoicePreloadDisabledReason}
              dialogueVoiceReadAloudDisabledReason={dialogueVoiceReadAloudDisabledReason}
              dialogueNarratorOnlyDisabledReason={dialogueNarratorOnlyDisabledReason}
              narratorProviderOptions={narratorProviderOptions}
              narratorProviderId={resolvedNarratorProviderId}
              narratorProviderWarning={narratorProviderWarning}
              onNarratorProviderChange={setDialogueNarratorProviderId}
              cloneVoiceProviderOptions={cloneVoiceProviderOptions}
              cloneVoiceProviderId={resolvedCloneVoiceProviderId}
              cloneVoiceProviderWarning={cloneVoiceProviderWarning}
              onCloneVoiceProviderChange={setDialogueCloneVoiceProviderId}
              onConfigureOpenRouterTts={openOpenRouterTtsSetup}
              voiceReadAloudActive={readAloudActive}
              onStopVoiceReadAloud={stopDialogueVoice}
              rpTimeTrackingEnabled={rpTimeTrackingEnabled}
              chatTextSize={chatTextSize}
              onChatTextSizeChange={setChatTextSize}
              phoneAuthorBadgesEnabled={phoneAuthorBadgesEnabled}
              onPhoneAuthorBadgesEnabledChange={changePhoneAuthorBadgesEnabled}
              chatReadsPhoneAppsEnabled={chatReadsPhoneAppsEnabled}
              onChatReadsPhoneAppsEnabledChange={changeChatReadsPhoneAppsEnabled}
              thoughtTextStyle={thoughtTextStyle}
              rpDateTimeFormat={rpDateTimeFormat}
              rpWeekdayLanguage={rpWeekdayLanguage}
              contextualReferenceImageIds={contextualReferenceImageIds}
              selectedReferenceImageIds={selectedReferenceImageIds}
              imageUploadEnabled={imageUploadVisionEnabled}
              imageUploadDisabledReason="Attach Image requires a provider with Activate vision features enabled."
              referenceImageContextEnabled={imageUploadVisionEnabled}
              referenceImageContextDisabledReason="Not possible without vision capabilities."
              canRunChat={
                isRunning ||
                draftCommands.some((command) => command.type === 'time') ||
                (
                  (!!draft.trim() || draftImages.length > 0) &&
                  characterStorybookNodes.length > 0 &&
                  (narratorSelected || !!selectedCharacter)
                )
              }
              autoplayEnabled={autoplay.enabled}
              autoplayMode={autoplay.mode}
              autoplayReplayDisabled={isRunning || (!narratorSelected && !selectedCharacter)}
              onAutoplayEnabledChange={autoplay.setEnabled}
              onAutoplayModeChange={autoplay.setMode}
              onAutoplayRunModeNow={(mode) => autoplay.runModeNow(
                mode,
                narratorSelected
                  ? narratorSpeakerName
                  : selectedCharacter?.name ?? '',
              )}
              imageInputRef={imageInputRef}
              chatThreadRef={chatThreadRef}
              onBeginEditMessage={beginEditMessage}
              onCancelEditMessage={cancelEditMessage}
              onRegenerateEditedMessage={regenerateEditedMessage}
              onEditingDraftChange={setEditingDraft}
              onPreviewImage={openImagePreview}
              onToggleReferenceImage={toggleReferenceImage}
              onPreviewImageCaptionChange={openImageCaptionChangePreview}
              onRemoveDraftImage={(imageId) =>
                setDraftImages((current) => current.filter((entry) => entry.id !== imageId))
              }
              onOpenEmbeddedPhoneMessage={openEmbeddedPhoneMessage}
              onOpenEmbeddedSocialMessage={openEmbeddedSocialMessage}
              onOpenSocialPost={openSocialPost}
              socialImageById={socialImageById}
              socialLikesByAccount={socialLikesByAccount}
              onOutputActionChoice={submitOutputActionChoice}
              onSubmitMessage={submitMessage}
              onDraftChange={setDraft}
              onDraftCommandsChange={setDraftCommands}
              onAddDraftImages={(files) => void addDraftImages(files)}
              onSelectDraftImages={() => void selectDraftImages()}
              onMessageContentLoaded={() => scrollChatThreadToBottomIfFollowing('auto')}
            />
          ) : chatPanelView === 'phone' ? (
            <PhonePanel
              phoneContacts={phoneContacts}
              storyCharacters={storyCharacters}
              estimatedTokenBytesPerToken={activeTokenEstimateBytesPerToken}
              imageAssistantChatHistoryContext={formatChatHistory(
                lastTurnMessages(messages, 4),
                false,
                rpDateTimeFormat,
                rpWeekdayLanguage,
                messages,
              )}
              characterColors={characterColors}
              selectedPhoneContact={selectedPhoneContact}
              selectedCharacter={viewedPhoneCharacter}
              selectedCharacterPlayable={
                !!viewedPhoneCharacter &&
                storyCharacters.some((character) => character.id === viewedPhoneCharacter.id)
              }
              selectedPhoneConversation={selectedPhoneConversation}
              selectedPhoneDividerAfterId={selectedPhoneDividerAfterId}
              highlightedPhoneMessageId={highlightedPhoneMessage?.id}
              highlightedPhoneMessagePulseKey={highlightedPhoneMessage?.pulseKey ?? 0}
              unreadPhoneConversations={unreadPhoneConversations}
              unreadBankingCount={unreadBankingCount}
              phoneAppNotificationCounts={phoneAppNotificationCounts}
              phoneHomeRequestId={phoneHomeRequestId}
              socialPostOpenRequest={socialPostOpenRequest}
              socialDirectMessageOpenRequest={socialDirectMessageOpenRequest}
              phoneImages={phoneImages}
              phoneGalleryImages={phoneGalleryImages}
              phoneDraft={phoneDraft}
              phoneDraftCommands={phoneDraftCommands}
              replyToMessage={phoneReplyToMessage}
              showPhoneEmojiPicker={showPhoneEmojiPicker}
              phoneEmojiOptions={phoneEmojiOptions}
              isRunning={isRunning}
              canSend={
                isRunning ||
                (
                  phoneDraftCommands.some((command) => command.type === 'time') &&
                  !narratorSelected
                ) ||
                (
                  (!!phoneDraft.trim() || phoneImages.length > 0) &&
                  characterStorybookNodes.length > 0 &&
                  !narratorSelected &&
                  !!selectedCharacter &&
                  !!selectedPhoneContact
                )
              }
              inputLocked={narratorSelected}
              voiceMessageSpeakerNames={dialogueVoiceSpeakerNames}
              onGenerateVoiceMessageClip={async ({ messageId, speakerName, text }) => {
                // Voice generation unloads local LLM models first; never do that mid-run.
                if (isRunning) {
                  return null;
                }
                try {
                  return await generateVoiceMessageClip(messageId, speakerName, text);
                } catch (error) {
                  notifySystem(
                    'error',
                    `Phone voice message failed: ${error instanceof Error ? error.message : String(error)}`,
                  );
                  return null;
                }
              }}
              englishProcessingEnabled={englishProcessingEnabled}
              rpTimeTrackingEnabled={rpTimeTrackingEnabled}
              phoneAuthorBadgesEnabled={phoneAuthorBadgesEnabled}
              phoneChatTextSize={phoneChatTextSize}
              rpDateTimeFormat={rpDateTimeFormat}
              rpWeekdayLanguage={rpWeekdayLanguage}
              contextualReferenceImageIds={contextualReferenceImageIds}
              selectedReferenceImageIds={selectedReferenceImageIds}
              imageUploadEnabled={imageUploadVisionEnabled}
              imageUploadDisabledReason="Upload from Computer requires a provider with Activate vision features enabled. Choose captioned images from the Phone Gallery instead."
              referenceImageContextEnabled={imageUploadVisionEnabled}
              referenceImageContextDisabledReason="Not possible without vision capabilities."
              phoneThreadRef={phoneThreadRef}
              phoneEmojiPickerRef={phoneEmojiPickerRef}
              phoneImageInputRef={phoneImageInputRef}
              onOpenPhoneContact={openPhoneContact}
              onMarkSelectedPhoneConversationSeen={markSelectedPhoneConversationSeen}
              onMarkBankingSeen={markViewedBankingSeen}
              onMarkPhoneAppSeen={markViewedPhoneAppSeen}
              onMarkSocialDirectMessagesSeen={markViewedSocialDmSeen}
              unreadSocialDirectMessages={unreadSocialDirectMessages}
              onOpenUnreadPhoneConversation={openUnreadPhoneConversation}
              unreadPhoneSwitchName={unreadPhoneSwitchName}
              onSwitchToViewedCharacter={() => {
                if (
                  viewedPhoneCharacter &&
                  storyCharacters.some((character) => character.id === viewedPhoneCharacter.id)
                ) {
                  selectChatCharacter(viewedPhoneCharacter.id);
                }
              }}
              onPreviewImage={openImagePreview}
              onToggleReferenceImage={toggleReferenceImage}
              onPreviewImageCaptionChange={openImageCaptionChangePreview}
              onScrollPhoneThreadToBottom={scrollPhoneThreadToBottom}
              onRemovePhoneImage={(imageId) =>
                setPhoneImages((current) => current.filter((entry) => entry.id !== imageId))
              }
              onPhoneDraftChange={setPhoneDraft}
              onPhoneDraftCommandsChange={setPhoneDraftCommands}
              onReplyToMessage={selectPhoneReplyFromComposer}
              onCancelPhoneReply={clearPhoneReply}
              onSubmitPhoneMessage={submitPhoneMessage}
              onTogglePhoneEmojiPicker={() => setShowPhoneEmojiPicker((current) => !current)}
              onSelectPhoneEmoji={selectPhoneEmoji}
              recentlyUsedEmojis={recentlyUsedEmojis}
              onSelectPhoneImages={selectPhoneImagesFromComposer}
              onSelectPhoneGalleryImage={selectPhoneGalleryImageFromComposer}
              onAddPhoneImages={addPhoneImagesFromComposer}
              bankTransferMessages={bankTransferMessages(messages)}
              socialMediaMessages={messages.filter(
                (message) =>
                  !!message.socialPost ||
                  !!message.socialThreadAction ||
                  !!message.socialReactions ||
                  !!message.socialDirectMessage,
              )}
              onSubmitSocialPost={submitSocialPost}
              onSubmitSocialThreadAction={submitSocialThreadAction}
              onSubmitSocialDirectMessage={submitSocialDirectMessage}
              onCreateSocialAccount={saveStorybookSocialUsername}
              onImportSocialPostImage={importSocialPostImage}
              socialImageById={socialImageById}
              socialLikesByAccount={socialLikesByAccount}
              socialDirectoryUsers={socialDirectoryUsers}
              fotogramContactsByCharacter={fotogramContactsByCharacter}
              socialConnectionsByCharacter={socialConnectionsByCharacter}
              onAddSocialConnection={addSocialConnection}
              onToggleSocialLike={toggleSocialLike}
              onlyFriendsPurchasesByCharacter={onlyFriendsPurchasesByCharacter}
              onUnlockOnlyFriendsPost={unlockOnlyFriendsPost}
              bankingContactNames={viewedPhoneCharacter
                ? bankingContactsByCharacter[viewedPhoneCharacter.id] ?? []
                : []}
              onAddBankingContact={addBankingContact}
              onSendBankTransfer={submitBankTransfer}
              onTransferOnlyFriendsWallet={submitOnlyFriendsWalletTransfer}
              connections={connections}
              providerHealthById={providerHealthById}
              onSubmitImageAssistantMessage={async ({
                connectionId,
                imageProviderId,
                currentPrompt,
                currentSettings,
                currentImage,
                availableCharacterLoras,
                characterContext,
                chatHistoryContext,
                messages,
                userMessage,
                describeImage,
              }) => {
                await prepareImageAssistantLlmProvider({
                  llmProviderId: connectionId,
                  comfyProviderId: imageProviderId,
                });
                if (currentImage) {
                  const visionEnabled = await nodeLlm.supportsVision(
                    connectionId,
                    'Image Generation Assistant',
                  );
                  if (!visionEnabled) {
                    throw new Error('The selected assistant provider needs vision enabled to inspect the generated image.');
                  }
                }
                const completion = await nodeLlm.complete({
                  connectionId,
                  label: 'Image Generation Assistant',
                  prompt: imageGenerationAssistantPrompt(
                    currentPrompt,
                    currentSettings,
                    currentImage?.description ?? '',
                    availableCharacterLoras,
                    characterContext,
                    chatHistoryContext,
                    messages,
                    userMessage,
                    describeImage,
                  ),
                  images: currentImage ? [{
                    id: 'image-generation-assistant-current',
                    name: 'Currently selected generated image',
                    mimeType: /^data:([^;,]+)/.exec(currentImage.dataUrl)?.[1] ?? 'image/png',
                    size: encodedDataUrlBytes(currentImage.dataUrl),
                    dataUrl: currentImage.dataUrl,
                    description: currentImage.description,
                  }] : undefined,
                  maxTokens: 1200,
                  temperature: 0.2,
                });
                return parseImageGenerationAssistantResult(completion.text, describeImage);
              }}
              onGenerateImageAssistantImages={generateImageAssistantImages}
              onSaveImageAssistantImage={async ({ characterId, dataUrl, description }) => {
                const character = storyCharacters.find((entry) => entry.id === characterId);
                if (!character) {
                  throw new Error('The selected Storybook character is no longer available.');
                }
                const mimeType = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/png';
                const image = await normalizeImageAttachment({
                  name: `generated-${character.name}.png`,
                  mimeType,
                  size: encodedDataUrlBytes(dataUrl),
                  dataUrl,
                }, () => `image-${uniqueId()}`);
                const savedImages = ensureImagesForStorybookCharacter(
                  character,
                  [image],
                  description,
                  (addedCount, updatedCount) =>
                    addedCount > 0
                      ? `Saved generated image for ${character.name}.`
                      : updatedCount > 0
                        ? `Updated generated image for ${character.name}.`
                        : `Generated image already saved for ${character.name}.`,
                );
                if (!savedImages?.length) {
                  throw new Error(`Could not save the image for ${character.name}.`);
                }
                notifySystem('info', `Saved generated image in ${character.name}'s Phone Gallery.`);
              }}
              onPhoneWallpaperChange={changeStorybookPhoneWallpaper}
              chatGpd={chatGpd}
              chatGpdSidebarOpen={chatGpdSidebarOpen}
              onChatGpdSidebarOpenChange={setChatGpdSidebarOpen}
              chatGpdSidebarWidth={chatGpdSidebarWidth}
              onChatGpdSidebarWidthChange={setChatGpdSidebarWidth}
              archivedChatGpdChatIds={viewedPhoneCharacter
                ? archivedSimulatedAiChatIds(turns, viewedPhoneCharacter.id)
                : new Set()}
              phoneNotes={viewedPhoneCharacter
                ? phoneNotesByCharacter[viewedPhoneCharacter.id] ?? []
                : []}
              onPhoneNoteDelete={deletePhoneNote}
              onPhoneNoteColorChange={updatePhoneNoteColor}
              onPhoneNoteCommit={commitCreatedPhoneNote}
              onChatGpdChatCommit={commitChatGpdChat}
              phoneDesktopLayout={phoneDesktopLayout}
              onPhoneDesktopLayoutChange={setPhoneDesktopLayout}
              phoneDesktopIconSize={phoneDesktopIconSize}
              onPhoneDesktopIconSizeChange={setPhoneDesktopIconSize}
              phoneClockRpDateTime={latestHistoryRpDateTime(messages)}
              imageAssistantModelStateById={imageAssistantModelStateById}
              onSetImageAssistantLlmModelLoaded={setImageAssistantLlmModelLoaded}
              onUnloadImageAssistantComfyModel={unloadImageAssistantComfyModel}
              onRefreshImageAssistantModelState={(providerId) => void refreshImageAssistantModelState(providerId)}
            />
          ) : (
            <EventsPanel
              upcomingEvents={upcomingEvents}
              selectedEvent={selectedEvent}
              highlightedEventIds={highlightedEventIds}
              eventManagerAvailable={eventManagerAvailable}
              runDisabled={
                isRunning ||
                !eventManagerAvailable ||
                characterStorybookNodes.length === 0 ||
                !selectedEvent
              }
              isRunning={isRunning}
              rpDateTimeFormat={rpDateTimeFormat}
              rpWeekdayLanguage={rpWeekdayLanguage}
              onSelectEvent={setSelectedEventId}
              onCancelEvent={cancelEvent}
              onRunEvent={runSelectedEvent}
            />
          )}
          </div>
          </aside>
          </ErrorBoundary>
        </div>
      </main>

      {outputFormatHelpKind && (
        <OutputFormatHelpDialog
          kind={outputFormatHelpKind}
          onClose={() => setOutputFormatHelpKind(null)}
        />
      )}


      {storybookCreatorNode && storybookCreatorNode.data.nodeType === 'rp-storybook' && (
        <StorybookCreatorDialog
          node={storybookCreatorNode}
          workflowNodes={nodeViewNodes}
          promptActionSettings={promptActionSettings}
          messages={storybookCreatorMessages}
          isSubmitting={storybookCreatorSubmitting}
          connections={connections}
          providerHealthById={providerHealthById}
          onSubmit={submitStorybookCreatorMessage}
          onLoad={() => loadStorybookFile(storybookCreatorNode.id)}
          onSaveStorybook={() => requestSaveStorybook(false)}
          promptTextCustomPresets={promptTextCustomPresets}
          setPromptTextCustomPresets={setPromptTextCustomPresets}
          usedImageIds={usedStorybookImageIds}
          imageCaptionChangesById={phoneImageCaptionChangesById}
          onUpdateStorybook={(storybook: RpStorybook, status?: string) =>
            updateStorybook(storybookCreatorNode.id, storybook, status)
          }
          onChangeImageCaptionUpdate={changeImageCaptionUpdate}
          onUpdateFormattedTextSettings={(settings) => {
            updateRuntimeNode(storybookCreatorNode.id, {
              storybookFormattedTextSettings: settings,
            });
          }}
          onDescribeCharacterImage={(characterContext, image, prompt) =>
            describeStorybookCharacterImage(storybookCreatorNode, characterContext, image, prompt)
          }
          onLoadCharacterComfyLoras={loadCharacterComfyLoras}
          onGenerateCharacterComfyPreview={generateCharacterComfyPreview}
          onGenerateCharacterVoicePreview={generateCharacterVoicePreview}
          onUnloadCharacterComfyModels={unloadCharacterComfyModels}
          onImportOpeningHistory={() => importCurrentSessionAsOpeningHistory(storybookCreatorNode.id)}
          onClearOpeningHistory={() => clearStorybookOpeningHistory(storybookCreatorNode.id)}
          onResetStorybook={() => resetStorybook(storybookCreatorNode.id)}
          onImportSillyTavernCharacter={() => importSillyTavernCharacter(storybookCreatorNode.id)}
          onImportCharacterCard={() => importCharacterCard(storybookCreatorNode.id)}
          onExportCharacter={(characterId) => exportStorybookCharacter(storybookCreatorNode.id, characterId)}
          onDeleteCharacter={(characterId) => deleteStorybookCharacter(storybookCreatorNode.id, characterId)}
          pendingConversion={
            pendingStorybookConversion?.nodeId === storybookCreatorNode.id
              ? pendingStorybookConversion
              : null
          }
          onApplyConversion={applyPendingStorybookConversion}
          onCancelConversion={cancelPendingStorybookConversion}
          onBeginConversionReview={beginPendingStorybookReview}
          onImproveConversion={improvePendingStorybookConversion}
          onClose={() => setStorybookCreatorNodeId(null)}
        />
      )}

      {customNodeAssistantNode && customNodeAssistantNode.data.nodeType === 'custom' && (
        <CustomNodeAssistantDialog
          node={customNodeAssistantNode}
          connections={connections}
          defaultConnectionId={defaultConnectionId}
          messages={customNodeAssistant.messages}
          diagnostics={customNodeAssistant.diagnostics}
          onSubmit={customNodeAssistant.submitMessage}
          onStructureCheck={() => customNodeAssistant.checkStructure(customNodeAssistantNode.id)}
          onSecurityCheck={(connectionId) =>
            customNodeAssistant.checkSecurity(customNodeAssistantNode.id, connectionId)
          }
          onApplyDefinitionText={(text) =>
            customNodeAssistant.applyDefinitionText(customNodeAssistantNode.id, text)
          }
          onToggleDiagnostic={(diagnosticId) =>
            customNodeAssistant.toggleDiagnostic(customNodeAssistantNode.id, diagnosticId)
          }
          onDismissDiagnostic={(diagnosticId) =>
            customNodeAssistant.dismissDiagnostic(customNodeAssistantNode.id, diagnosticId)
          }
          onClearChat={() => customNodeAssistant.clearChat(customNodeAssistantNode.id)}
          onReset={() => customNodeAssistant.resetDefinition(customNodeAssistantNode.id)}
          onClose={customNodeAssistant.close}
        />
      )}

      {nodeAssistantNode && (
        <AssistantDialog
          key={nodeAssistantNode.id}
          mode="node"
          node={nodeAssistantNode}
          debugSnapshotSections={assistantDebugSnapshotSections}
          connections={connections}
          providerHealthById={providerHealthById}
          defaultConnectionId={defaultConnectionId}
          preferredConnectionId={assistantConnectionId}
          onPreferredConnectionChange={setAssistantConnectionId}
          resolveConnection={resolveConnection}
          messages={nodeAssistantMessages}
          setMessages={setNodeAssistantMessages}
          systemLog={systemLog}
          estimatedTokenBytesPerToken={activeTokenEstimateBytesPerToken}
          onClose={() => setNodeAssistantNodeId(null)}
        />
      )}

      {workflowAssistantOpen && !nodeAssistantNode && (
        <AssistantDialog
          key="workflow"
          mode="workflow"
          workflowNodes={nodeViewNodes}
          workflowSnapshotJson={workflowAssistantSnapshotJson}
          debugSnapshotSections={assistantDebugSnapshotSections}
          connections={connections}
          providerHealthById={providerHealthById}
          defaultConnectionId={defaultConnectionId}
          preferredConnectionId={assistantConnectionId}
          onPreferredConnectionChange={setAssistantConnectionId}
          resolveConnection={resolveConnection}
          messages={workflowAssistantMessages}
          setMessages={setWorkflowAssistantMessages}
          systemLog={systemLog}
          estimatedTokenBytesPerToken={activeTokenEstimateBytesPerToken}
          onClose={() => setWorkflowAssistantOpen(false)}
        />
      )}

      <StudioDialogs
        textDialogNode={textDialogNode}
        nodes={nodeViewNodes}
        textDialogView={textDialogView}
        onCloseText={() => {
          setTextDialogNodeId(null);
          setTextDialogView('text');
        }}
        jsonDialogNode={jsonDialogNode}
        onCloseJson={() => setJsonDialogNodeId(null)}
        showOptions={showOptions}
        englishProcessingEnabled={englishProcessingEnabled}
        inputTranslationOnlyEnabled={inputTranslationOnlyEnabled}
        displayLanguage={displayLanguage}
        tokenEstimateBytesPerToken={tokenEstimateBytesPerToken}
        autoCalibrateTokenEstimate={autoCalibrateTokenEstimate}
        activeTokenEstimateBytesPerToken={activeTokenEstimateBytesPerToken}
        settingsValueDefinitions={settingsValueDefinitions}
        settingsValues={resolvedWorkflowSettingsValues}
        chatTextSize={chatTextSize}
        phoneChatTextSize={phoneChatTextSize}
        smoothChatAutoScrollEnabled={smoothChatAutoScrollEnabled}
        smoothChatAutoScrollMinSpeed={smoothChatAutoScrollMinSpeed}
        thoughtTextStyle={thoughtTextStyle}
        rpDateTimeFormat={rpDateTimeFormat}
        rpWeekdayLanguage={rpWeekdayLanguage}
        showReferenceImagesInContext={showReferenceImagesInContext}
        referenceImageTurnLookback={referenceImageTurnLookback}
        maxReferenceImages={maxReferenceImages}
        glassDesignEnabled={glassDesignEnabled}
        glassDesignOpacity={glassDesignOpacity}
        nodeTextSize={nodeTextSize}
        retryFormatErrorsEnabled={retryFormatErrorsEnabled}
        uiScale={appliedUiScale}
        minUiScale={minimumAllowedUiScale}
        maxUiScale={allowedUiScale}
        onCloseOptions={() => setShowOptions(false)}
        onEnglishProcessingChange={changeEnglishProcessing}
        onInputTranslationOnlyChange={changeInputTranslationOnly}
        onDisplayLanguageChange={setDisplayLanguage}
        onTokenEstimateBytesPerTokenChange={changeTokenEstimateBytesPerToken}
        onAutoCalibrateTokenEstimateChange={changeAutoCalibrateTokenEstimate}
        onSettingsValueAdd={addWorkflowSettingsValue}
        onSettingsValueChange={changeWorkflowSettingsValue}
        onSettingsValueRename={renameWorkflowSettingsValue}
        onSettingsValueRemove={removeWorkflowSettingsValue}
        onChatTextSizeChange={setChatTextSize}
        onPhoneChatTextSizeChange={setPhoneChatTextSize}
        onSmoothChatAutoScrollEnabledChange={setSmoothChatAutoScrollEnabled}
        onSmoothChatAutoScrollMinSpeedChange={setSmoothChatAutoScrollMinSpeed}
        onThoughtTextStyleChange={setThoughtTextStyle}
        onRpDateTimeFormatChange={setRpDateTimeFormat}
        onRpWeekdayLanguageChange={setRpWeekdayLanguage}
        onShowReferenceImagesInContextChange={setShowReferenceImagesInContext}
        onReferenceImageTurnLookbackChange={setReferenceImageTurnLookback}
        onMaxReferenceImagesChange={setMaxReferenceImages}
        onGlassDesignEnabledChange={setGlassDesignEnabled}
        onGlassDesignOpacityChange={setGlassDesignOpacity}
        onNodeTextSizeChange={setNodeTextSize}
        onUiScaleChange={changeUiScale}
        onRetryFormatErrorsChange={setRetryFormatErrorsEnabled}
        showFiles={showFiles}
        savedFiles={savedFiles}
        selectedFile={selectedFile}
        workflowName={workflowNameDraft}
        storybookName={storybookNameDraft}
        characterName={characterNameDraft}
        workflowFormatVersion={currentWorkflowFormatVersion}
        rpSaveFormatVersion={currentSessionFormatVersion}
        storybookFormatVersion={currentStorybookFormatVersion}
        workflowOverwritePending={workflowOverwritePending}
        fileStorageStatus={fileStorageStatus}
        onCloseFiles={() => {
          returnToFilesAfterSaveRef.current = false;
          setShowFiles(false);
          setWorkflowOverwritePending(false);
          setSessionOverwritePending(false);
          setSessionPasswordAction(null);
          setSessionPassword('');
          setPendingSessionFilePath(null);
          setPendingStorybookLoad(null);
        }}
        onSelectFile={(file) => {
          setSelectedFile(file.fileName);
          if (file.type === 'workflow') {
            setWorkflowNameDraft(file.name);
          } else if (file.type === 'session') {
            setSessionName(file.name);
          } else if (file.type === 'storybook') {
            setStorybookNameDraft(file.name);
          } else if (file.type === 'character-card') {
            setCharacterNameDraft(file.name);
          }
          setWorkflowOverwritePending(false);
          setSessionOverwritePending(false);
          setFileStorageStatus(
            file.compatible
              ? file.type === 'workflow'
                ? `Workflow File Format ${file.workflowFormatVersion} is compatible.`
                : file.type === 'session'
                  ? `RP Save Format v${file.formatVersion} is compatible.`
                  : file.type === 'storybook'
                    ? `Storybook Format ${file.formatVersion} is compatible.`
                  : file.type === 'character-card'
                    ? `Character Card Format ${file.formatVersion} is compatible.`
                    : 'This is not a supported RPGraph file.'
              : file.type === 'workflow'
                ? incompatibleWorkflowStatus(file)
                : file.type === 'session'
                  ? incompatibleSessionStatus(file)
                  : file.type === 'storybook'
                    ? incompatibleStorybookStatus(file)
                  : file.type === 'character-card'
                    ? incompatibleCharacterCardStatus(file)
                    : 'This is not a supported RPGraph file.',
          );
        }}
        onOpenFile={(file) => void openStoredFile(file)}
        onDeleteFile={(file) => void deleteStoredFile(file)}
        onRequestOpenFile={() => void requestOpenFile()}
        onRestoreDefaultWorkflow={() => void restoreDefaultWorkflow()}
        onRequestExportWorkflow={() => requestExportWorkflow(true)}
        onRequestSaveStorybook={() => requestSaveStorybook(true)}
        onWorkflowNameChange={(name) => {
          setWorkflowNameDraft(name);
          setWorkflowOverwritePending(false);
        }}
        onStorybookNameChange={(name) => {
          setStorybookNameDraft(name);
          setSessionOverwritePending(false);
        }}
        onCharacterNameChange={(name) => {
          setCharacterNameDraft(name);
          setSessionOverwritePending(false);
        }}
        onRequestSaveSession={() => requestSaveSession(true)}
        sessionPasswordAction={sessionPasswordAction}
        sessionOverwritePending={sessionOverwritePending}
        sessionName={sessionName}
        sessionPassword={sessionPassword}
        fileProtection={fileProtection}
        workflowSaveScope={workflowSaveScope}
        chooseSaveLocation={chooseSaveLocation}
        onCloseSessionPassword={() => {
          if (sessionPasswordAction === 'load-character') {
            cancelCharacterCardUnlock();
          }
          setShowFiles(
            sessionPasswordAction === 'save-workflow' ||
              sessionPasswordAction === 'save-session' ||
              sessionPasswordAction === 'save-storybook' ||
              sessionPasswordAction === 'save-character'
              ? returnToFilesAfterSaveRef.current
              : sessionPasswordAction === 'load-storybook'
                ? false
              : sessionPasswordAction === 'load-character'
                ? false
              : true,
          );
          returnToFilesAfterSaveRef.current = false;
          setSessionPasswordAction(null);
          setSessionOverwritePending(false);
          setSessionPassword('');
          setChooseSaveLocation(false);
          setPendingSessionFilePath(null);
          setPendingStorybookLoad(null);
        }}
        onSessionNameChange={(name) => {
          setSessionName(name);
          setSessionOverwritePending(false);
        }}
        onSessionPasswordChange={setSessionPassword}
        onFileProtectionChange={(protection) => {
          setFileProtection(protection);
          setSessionPassword('');
        }}
        onWorkflowSaveScopeChange={setWorkflowSaveScope}
        onChooseSaveLocationChange={(enabled) => {
          setChooseSaveLocation(enabled);
          if (enabled) {
            setWorkflowOverwritePending(false);
            setSessionOverwritePending(false);
          }
        }}
        onSubmitSessionPassword={() =>
          void (
            sessionPasswordAction === 'save-workflow'
              ? saveNamedWorkflow()
              : sessionPasswordAction === 'save-session'
                ? saveSession()
                : sessionPasswordAction === 'save-storybook'
                  ? saveStorybook()
                : sessionPasswordAction === 'save-character'
                  ? saveCharacter()
                : sessionPasswordAction === 'open-file'
                  ? pendingSessionFilePath
                    ? unlockOpenFilePath(pendingSessionFilePath)
                  : requestOpenFile()
              : sessionPasswordAction === 'load-storybook'
                ? unlockStorybookFile()
              : sessionPasswordAction === 'load-character'
                ? unlockCharacterCard()
                : unlockStoredFile()
          )
        }
        showCharacterFiles={showCharacterFiles}
        characterFiles={characterFiles}
        selectedCharacterFile={selectedCharacterFile}
        characterFileStatus={characterFileStatus}
        onCloseCharacterFiles={closeCharacterFiles}
        onSelectCharacterFile={(file) => setSelectedCharacterFile(file.fileName)}
        onImportCharacterFile={(file) => void importSelectedCharacterCard(file)}
        onOpenExternalCharacterFile={() => void openExternalCharacterCard()}
        showConnections={showConnections}
        connections={connections}
        editingConnection={editingConnection}
        connectionDraftPending={connectionDraftPending}
        editingConnectionCapabilities={editingConnectionCapabilities}
        editingConnectionSupportedVoices={editingConnectionSupportedVoices}
        editingConnectionSupportedParameters={editingConnectionSupportedParameters}
        providerHealthById={providerHealthById}
        availableConnectionModels={availableConnectionModels}
        availableComfyModels={availableComfyModels}
        comfyWorkflowInspection={comfyWorkflowInspection}
        comfyWorkflowRepairStatus={comfyWorkflowRepairStatus}
        comfyWorkflowRepairReady={comfyWorkflowRepairReady}
        comfyWorkflowRepairInspection={comfyWorkflowRepairInspection}
        connectionStatus={connectionStatus}
        onCloseConnections={closeConnectionManager}
        onSelectConnection={selectConnection}
        onNewConnection={newConnection}
        onApplyProviderPreset={applyProviderPreset}
        onApplyComfyConnectionRole={applyComfyConnectionRole}
        onEditConnection={editConnection}
        onRefreshConnectionModels={() => void loadConnectionModels(false)}
        onDeleteConnection={deleteConnection}
        onCheckConnectionModels={() => void checkConnectionModels()}
        onConnectComfyProvider={() => {
          const connection = connectionFromEditingConnection();
          if (isComfyVoiceConnection(connection)) {
            void checkProviderConnection(connection, { showStatus: true });
          } else {
            void loadComfyModelLists(connection);
          }
        }}
        onSelectBundledComfyWorkflow={selectBundledComfyWorkflow}
        onConfirmComfyWorkflowSetup={confirmComfyWorkflowSetup}
        onRepairComfyWorkflow={(llmConnectionId) => void repairComfyWorkflow(llmConnectionId)}
        onApplyComfyWorkflowRepair={() => void applyComfyWorkflowRepair()}
        onGenerateComfyTestImage={() => void generateComfyTestImage()}
        onGenerateCharacterVoicePreview={generateCharacterVoicePreview}
        onUnloadComfyModels={() => void unloadComfyModels()}
        comfyProviderActionActive={comfyProviderActionActive}
        lmStudioToolsAvailable={isLmStudioConnection(editingConnection)}
        modelCapabilitiesSourceLabel={modelCapabilitiesSourceLabel}
        lmStudioModelActionActive={lmStudioModelActionActive}
        onLoadLmStudioModel={() => void loadLmStudioModel()}
        onUnloadLmStudioModels={() => void unloadLmStudioModels()}
        ollamaToolsAvailable={isOllamaConnection(editingConnection)}
        llamaCppToolsAvailable={isLlamaCppConnection(editingConnection)}
        ollamaModelActionActive={ollamaModelActionActive}
        onLoadOllamaModel={() => void loadOllamaModel()}
        onUnloadOllamaModels={() => void unloadOllamaModels()}
        onLoadLlamaCppModel={() => void loadLlamaCppModel()}
        onUnloadLlamaCppModels={() => void unloadLlamaCppModels()}
        onApplyConnectionToAllNodes={applyConnectionToAllNodes}
        onSetNarratorOnlyProvider={setDialogueNarratorProviderId}
      />
      {showSystemLog && (
        <SystemLogDialog
          entries={systemLog}
          counts={systemLogCounts}
          turnTraces={turnTraces}
          estimatedTokenBytesPerToken={activeTokenEstimateBytesPerToken}
          onCreateDebugSnapshot={createDebugSnapshot}
          onClear={clearSystemLog}
          onClose={() => setShowSystemLog(false)}
        />
      )}
      {comfyPreview && (
        <ComfyGeneratedImageDialog
          promptId={comfyPreview.promptId}
          images={comfyPreview.images}
          onClose={() => setComfyPreview(null)}
        />
      )}
      {previewImage && (
        <ImagePreviewDialog
          image={previewImage.image}
          caption={storybookImageDescriptionById.get(previewImage.image.id)}
          captionHistory={phoneImageCaptionChangesById.get(previewImage.image.id)}
          onClose={() => setPreviewImage(null)}
        />
      )}
      {showWelcome && (
        <WelcomeDialog
          onClose={() => {
            window.localStorage.setItem('rpgraph.welcomeSeen', 'true');
            setShowWelcome(false);
          }}
        />
      )}
    </div>
  );
}

export default App;
