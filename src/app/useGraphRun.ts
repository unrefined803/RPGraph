// runGraph orchestration hook, extracted verbatim from App.tsx (Etappe 2, APP_ZERLEGUNG.md).
// Pure move: all component-scope dependencies arrive via the options object; the run
// body is unchanged. nodesRef discipline: runGraph writes nodesRef.current manually and
// then calls setNodes(...) so async continuations see fresh nodes immediately — the ref
// must therefore keep its render-phase sync in App.tsx (see "Gefahr: nodesRef").
import type {
  ChatImageAttachment,
  ConnectionPreset,
  EmbeddedPhoneMessageLink,
  ImageCaptionChange,
  MessageRecord,
  SocialPostRecord,
  SocialThreadActionRecord,
  ChatDialogueQuote,
  OutputActionContextCapacityBar,
  ProviderConnectionHealth,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  TurnContext,
  TurnRecord,
  TurnRecordMode,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { chatAttachmentFromStorybookImage, findChatEndpoints } from '../storybook/runtime';
import { storybookImageForAttachment } from '../storybook/imageLibrary';
import type { RpStorybookV1 } from '../nodes/rp-storybook-v1/model';
import type { ExecuteTraceFormatResult, ExecuteTraceNodeInfo } from '../nodes/types';
import type { RunLlmReport, LlmRunHistoryEntry } from '../components/AppDialogs';
import type { LastRunDebug } from './debugSnapshot';
import type { TurnTraceEvent } from './turnTrace';
import type { useTurnTraceState } from './useTurnTraceState';
import type { useTurnRecordState, TurnReplacement } from '../chat/useTurnRecordState';
import type { useNextTurnReferenceImages } from '../chat/useNextTurnReferenceImages';
import type { usePhoneReply } from '../chat/usePhoneReply';
import {
  applyTimeCommandsToWorkflowNodes,
  commandInputCommandsFromStructured,
  type CommandInputCommand,
  type StructuredInputPayload,
} from '../chat/structuredCommands';
import {
  canonicalPhoneName,
  embeddedPhoneMessagesLivePreview,
  parseEmbeddedPhoneMessagesFromRpOutput,
  parsePhoneMessageOutput,
  phoneNamesMatch,
  type EmbeddedPhoneMessagesResult,
  type ParsedPhoneImageAction,
  type ParsedPhoneMessage,
} from '../chat/phoneMessages';
import { captureTurnRuntime } from '../chat/turns';
import { createRpImageOutputStream, parseRpOutput } from '../chat/rpOutput';
import { extractDialogueQuotes } from '../chat/textRendering';
import {
  extractWorkflowVariableSetCommands,
  formatChatHistory,
  resolveWorkflowVariables,
  workflowVariablePreviewValues,
  type WorkflowVariableSetCommand,
} from '../workflow';
import { formatPhoneInput, formatPhoneReplyInput } from '../chat/phoneReplies';
import { nodesPreparedAfterOutput } from '../graph/edges';
import {
  parseOutputActions,
  type OutputActionChatMessage,
  type OutputActionContextCapacityRequest,
  type OutputActionUiItem,
} from '../chat/outputActions';
import {
  bankingBalanceForCharacter,
  bankTransferHistoryText,
  bankTransferPartyMatches,
} from '../chat/bankTransfers';
import {
  parseSocialReactionsOutput,
  socialPostInputText,
  socialPostHistoryText,
  socialPostTextFromInput,
  socialReactionsHistoryText,
  socialThreadActionInputText,
  socialThreadCommentTextFromInput,
  socialThreadHistoryText,
  type SocialThreadRunContext,
} from '../chat/socialMedia';
import { recentInputHistoryContext } from '../chat/inputTransforms';
import { withSpeakerPrefix } from '../chat/instructions';
import { executeGraph } from '../graph/executeGraph';
import { TextMetricsApi } from '../llm/tokenMetrics';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import {
  createRunId,
  createTurnId,
  isRunCancelledError,
  lastMessageText,
  narratorCharacterId,
  narratorSpeakerName,
  runClockNow,
  stripEventOutputHeader,
  withoutMessageRpDateTime,
} from './runOrchestration';

export type CancelReason = 'cancel' | 'restart';

export type ActiveRun = {
  id: string;
  controller: AbortController;
  retry: () => void;
};

export type PhoneMessageSound = 'sent' | 'received';

export type OutputAttribution = {
  speakerNames: string[];
  dialogue: ChatDialogueQuote[];
};

type Ref<T> = { current: T };

const liveOutputFlushIntervalMs = 100;

type ExecuteGraphOptions = Parameters<typeof executeGraph>[0];
type TurnRecordApi = ReturnType<typeof useTurnRecordState>;

type UseGraphRunOptions = Pick<
  TurnRecordApi,
  | 'messages'
  | 'setMessages'
  | 'messagesRef'
  | 'turnsRef'
  | 'activeTurnCollectorRef'
  | 'appendMessage'
  | 'updateMessage'
  | 'updateHistoryMessageTimes'
  | 'removeMessage'
  | 'applyTurnRuntime'
  | 'applyTurnCheckpointRuntime'
  | 'commitCollectedTurn'
> & {
  recordTurnTrace: ReturnType<typeof useTurnTraceState>['recordTurnTrace'];
  referenceImageOptionsForRun: ReturnType<typeof useNextTurnReferenceImages>['optionsForRun'];
  clearTemporaryReferenceImages: ReturnType<typeof useNextTurnReferenceImages>['clearSelectedImages'];
  selectPhoneReply: ReturnType<typeof usePhoneReply>['selectReply'];
  nodesRef: Ref<WorkflowNode[]>;
  setNodes: (nodes: WorkflowNode[]) => void;
  edges: ExecuteGraphOptions['edges'];
  connections: ConnectionPreset[];
  defaultConnectionId: string;
  isLlmConnection: (connection: ConnectionPreset) => boolean;
  nodeHasVision: (node: WorkflowNode) => boolean;
  checkProviderConnections: (
    connectionsToCheck: ConnectionPreset[],
  ) => Promise<Record<string, ProviderConnectionHealth>>;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
  onRpOutputReady?: (text: string) => void;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  clearAllRunActiveTimers: () => void;
  updateWorkflowComfyGenerationActive: (active: boolean) => void;
  setOutputActionChoicesHiddenByTurn: (turnId: string, hidden: boolean) => void;
  setWorkflowVariablesFromCommands: (commands: WorkflowVariableSetCommand[]) => void;
  workflowSettingsValuesForGraph: () => NonNullable<ExecuteGraphOptions['settingsValues']>;
  settingsValueDefinitionsRef: Ref<NonNullable<ExecuteGraphOptions['settingsValueDefinitions']>>;
  promptActionSettings: NonNullable<ExecuteGraphOptions['promptActionSettings']>;
  workflowSettingsValuesRef: Ref<NonNullable<Parameters<typeof captureTurnRuntime>[1]>>;
  characterStorybookNodes: readonly unknown[];
  storyCharacters: StorybookCharacter[];
  phoneCharacters: StorybookCharacter[];
  selectedCharacter: StorybookCharacter | undefined;
  selectedPhoneContact: { character: StorybookCharacter } | undefined;
  storybooksByNodeId: Map<string, RpStorybookV1>;
  characterColors: Map<string, string>;
  englishProcessingEnabled: boolean;
  inputTranslationOnlyEnabled: boolean;
  displayLanguage: TurnContext['displayLanguage'];
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  retryFormatErrorsEnabled: boolean;
  nodeLlm: NodeLlmApi;
  activeTokenEstimateBytesPerToken: number;
  autoCalibrateTokenEstimate: boolean;
  setCalibratedTokenBytesPerToken: NonNullable<ExecuteGraphOptions['onTokenEstimateCalibrated']>;
  lastRunDebugRef: Ref<LastRunDebug | null>;
  translateText: (
    text: string,
    direction: 'to-english' | 'to-display',
    connectionId: string,
    nodeId: string,
    onChunk?: (text: string) => void,
    displayLanguageOverride?: TurnContext['displayLanguage'],
    signal?: AbortSignal,
    recentHistoryContext?: string,
    label?: string,
  ) => Promise<string>;
  directInputText: (
    text: string,
    connectionId: string,
    nodeId: string,
    recentHistoryContext: string,
    channel: 'rp' | 'phone',
    displayLanguageOverride?: TurnContext['displayLanguage'],
    signal?: AbortSignal,
  ) => Promise<string>;
  analyzeDisplayedOutput: (
    text: string,
    outputNode: WorkflowNode,
    cast: StorybookCharacter[],
    highlightingContext: string,
    signal?: AbortSignal,
    onFormatResult?: (result: ExecuteTraceFormatResult) => void,
  ) => Promise<OutputAttribution>;
  appendPhoneMessage: (
    message: ParsedPhoneMessage,
    sound?: PhoneMessageSound,
    role?: Extract<MessageRecord['role'], 'user' | 'output'>,
    phoneAutoTurnSource?: MessageRecord['phoneAutoTurnSource'],
    workflowVariableSetCommands?: WorkflowVariableSetCommand[],
    inputMetadata?: Pick<MessageRecord, 'inputMessageFormat' | 'inputPromptSlot' | 'replyToMessageId'>,
  ) => number;
  ensurePhoneImagesInStorybooks: (
    fromName: string,
    toName: string,
    images: ChatImageAttachment[] | undefined,
    description?: string,
  ) => ChatImageAttachment[] | undefined;
  imageDescriptionFromAttachments: (images: ChatImageAttachment[] | undefined) => string | undefined;
  applyPhoneImageActionFromLlm: (
    action: ParsedPhoneImageAction,
    phoneReplyTo?: MessageRecord,
  ) => ImageCaptionChange | undefined;
  resolveOutputActionContextCapacityBars: (
    requests: OutputActionContextCapacityRequest[],
  ) => OutputActionContextCapacityBar[];
  pruneStorybookExternalImagesForMessages: () => void;
  selectChatPanelView: (view: 'chat' | 'phone' | 'events') => void;
  selectChatCharacter: (characterId: string) => void;
  setSelectedCharacterId: (characterId: string) => void;
  setDraft: (text: string) => void;
  setDraftCommands: (commands: CommandInputCommand[]) => void;
  setDraftImages: (images: ChatImageAttachment[]) => void;
  setPhoneDraft: (text: string) => void;
  setPhoneDraftCommands: (commands: CommandInputCommand[]) => void;
  setPhoneImages: (images: ChatImageAttachment[]) => void;
  activeRun: Ref<ActiveRun | null>;
  setActiveRunId: (runId: string | null) => void;
  setIsRunning: (running: boolean) => void;
  setRunDurationMs: (ms: number) => void;
  setRunStartTimeMs: (ms: number | null) => void;
  runStartTimeRef: Ref<number | null>;
  runEndTimeRef: Ref<number | null>;
  pendingRunRestart: Ref<(() => void) | null>;
  runLlmReport: RunLlmReport | null;
  runDurationMs: number;
  setRunHistory: (updater: (prev: LlmRunHistoryEntry[]) => LlmRunHistoryEntry[]) => void;
  activeRunLlmReport: Ref<RunLlmReport | null>;
  setRunLlmReport: (report: RunLlmReport | null) => void;
  activeRunCancelReason: Ref<CancelReason>;
};

const rpPictureNamePattern = /^RP Picture (\d+)$/;

function formatRpPictureName(index: number) {
  return `RP Picture ${String(Math.max(1, index)).padStart(2, '0')}`;
}

function nextRpPictureName(messages: readonly MessageRecord[]) {
  const existingNumbers = messages
    .map((message) => message.rpImageName?.trim().match(rpPictureNamePattern)?.[1])
    .filter((value): value is string => !!value)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return formatRpPictureName((existingNumbers.length ? Math.max(...existingNumbers) : 0) + 1);
}

function storybookImageAttachmentById(
  storybooksByNodeId: Map<string, RpStorybookV1>,
  imageId: string | undefined,
) {
  const normalizedImageId = imageId?.trim();
  if (!normalizedImageId) {
    return undefined;
  }
  for (const storybook of storybooksByNodeId.values()) {
    for (const character of storybook.characters) {
      const image = character.images.find((entry) => entry.id === normalizedImageId);
      if (image) {
        return chatAttachmentFromStorybookImage(image);
      }
    }
  }
  return undefined;
}

export function useGraphRun(options: UseGraphRunOptions) {
  // React Compiler explicitly opted out: runGraph writes options-provided refs
  // (nodesRef, activeRun, messagesRef, ...) manually mid-run by design so async
  // continuations see fresh values immediately. The compiler treats those writes
  // as prop mutation and would otherwise bail out of this hook silently (verified
  // via canary test); the directive makes that skip explicit. Revisit when the
  // ref discipline is reworked (commitNodes, Etappe 4 in APP_ZERLEGUNG.md).
  'use no memo';
  const {
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
    onRpOutputReady,
    updateRuntimeNode,
    clearAllRunActiveTimers,
    updateWorkflowComfyGenerationActive,
    setOutputActionChoicesHiddenByTurn,
    setWorkflowVariablesFromCommands,
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
    activeRun,
    setActiveRunId,
    setIsRunning,
    setRunDurationMs,
    setRunStartTimeMs,
    runStartTimeRef,
    runEndTimeRef,
    pendingRunRestart,
    runLlmReport,
    runDurationMs,
    setRunHistory,
    activeRunLlmReport,
    setRunLlmReport,
    activeRunCancelReason,
  } = options;


  async function runGraph(
    displayText: string,
    inputImages: ChatImageAttachment[] = [],
    existingInputMessage?: MessageRecord,
    historyMessages = messages,
    replacedMessageIds?: Set<number>,
    inputCharacterOverride?: StorybookCharacter,
    phoneMessageOverride?: boolean,
    phoneRecipientCharacterOverride?: StorybookCharacter,
    replacement?: TurnReplacement,
    turnMode: TurnRecordMode = 'user',
    eventDisplayText?: string,
    onSuccessfulRunBeforeCommit?: () => void,
    phoneOutputSoundOverride?: PhoneMessageSound,
    narratorAutoTurn = false,
    messageFormatOverride?: number,
    turnModeOverride?: number,
    phoneReplyToOverride?: MessageRecord,
    structuredInput?: StructuredInputPayload,
    socialPost?: SocialPostRecord,
    socialThreadAction?: SocialThreadActionRecord,
    socialThreadContext?: SocialThreadRunContext,
  ) {
    const isAutoTurn = turnMode === 'auto-turn';
    const isNarratorTurn = turnMode === 'narrator';
    const shouldRestoreCancelledInput =
      !isAutoTurn && !narratorAutoTurn && messageFormatOverride !== 3;
    const runtimeNodes = nodesRef.current;
    const { inputNode, outputNode } = findChatEndpoints(runtimeNodes);
    if (!outputNode || !inputNode) {
      notifySystem('error', 'The graph requires exactly one User Input and one RP Output.');
      return false;
    }
    if (characterStorybookNodes.length === 0) {
      notifySystem('error', 'The graph requires at least one Storybook character.');
      return false;
    }
    const outputNodeTraceInfo: ExecuteTraceNodeInfo = {
      nodeId: outputNode.id,
      nodeLabel: outputNode.data.label,
      nodeType: outputNode.data.nodeType,
    };
    const phoneReplyTo = phoneReplyToOverride ?? (
      existingInputMessage?.replyToMessageId !== undefined
        ? historyMessages.find((message) => message.id === existingInputMessage.replyToMessageId)
        : undefined
    );
    const runReferenceImageOptions = referenceImageOptionsForRun(phoneReplyTo);
    const inputCharacter = existingInputMessage?.speakerName
      ? phoneCharacters.find((character) => phoneNamesMatch(character.name, existingInputMessage.speakerName ?? ''))
      : inputCharacterOverride ?? selectedCharacter;
    const isOutputActionsRun = messageFormatOverride === 2;
    const runPromptSwitchVisionFeaturesEnabled = runtimeNodes.some(
      (node) => node.data.kind === undefined && node.data.nodeType === 'llm-prompt-switch' && nodeHasVision(node),
    );
    if (!existingInputMessage && !isNarratorTurn && !isAutoTurn && !isOutputActionsRun && !inputCharacter) {
      notifySystem('warning', 'Select a Storybook character to play as.');
      return false;
    }
    const providerHealthForRun = await checkProviderConnections(connections);
    const usedLlmConnectionIds = new Set(
      runtimeNodes.flatMap((node) => {
        if (node.data.kind !== undefined || !Object.prototype.hasOwnProperty.call(node.data, 'connectionId')) {
          return [];
        }
        const connectionId = node.data.connectionId ?? defaultConnectionId;
        const connection = connections.find((entry) => entry.id === connectionId);
        return connection && isLlmConnection(connection) ? [connection.id] : [];
      }),
    );
    const offlineLlmConnection = connections.find((connection) =>
      usedLlmConnectionIds.has(connection.id) &&
      providerHealthForRun[connection.id]?.status === 'offline',
    );
    if (offlineLlmConnection) {
      const detail = providerHealthForRun[offlineLlmConnection.id]?.detail;
      notifySystem(
        'error',
        `Provider ${offlineLlmConnection.label} is offline${detail ? `: ${detail}` : '.'}`,
      );
      return false;
    }
    const runId = createRunId();
    const runController = new AbortController();
    const runSignal = runController.signal;
    const retryRun = () => {
      void runGraph(
        displayText,
        inputImages,
        existingInputMessage,
        historyMessages,
        replacedMessageIds,
        inputCharacterOverride,
        phoneMessageOverride,
        phoneRecipientCharacterOverride,
        replacement,
        turnMode,
        eventDisplayText,
        onSuccessfulRunBeforeCommit,
        phoneOutputSoundOverride,
        narratorAutoTurn,
        messageFormatOverride,
        turnModeOverride,
        phoneReplyToOverride,
        structuredInput,
        socialPost,
        socialThreadAction,
        socialThreadContext,
      );
    };
    const finishRun = () => {
      if (activeRun.current?.id !== runId) {
        return;
      }
      runEndTimeRef.current = runClockNow();
      if (runStartTimeRef.current !== null) {
        setRunDurationMs(runEndTimeRef.current - runStartTimeRef.current);
      }
      activeRun.current = null;
      setActiveRunId(null);
      setIsRunning(false);
      const restart = pendingRunRestart.current;
      if (restart) {
        pendingRunRestart.current = null;
        queueMicrotask(restart);
      }
    };
    activeRun.current = {
      id: runId,
      controller: runController,
      retry: retryRun,
    };
    setActiveRunId(runId);
    if (runLlmReport) {
      setRunHistory((prev) =>
        [{ report: runLlmReport, durationMs: runDurationMs }, ...prev].slice(0, 3),
      );
    }
    const initialRunLlmReport: RunLlmReport = {
      runId,
      startedAt: new Date().toISOString(),
      calls: [],
    };
    activeRunLlmReport.current = initialRunLlmReport;
    setRunLlmReport(initialRunLlmReport);
    activeRunCancelReason.current = 'cancel';
    const turnContext: TurnContext = existingInputMessage?.turnContext ?? {
      englishProcessingEnabled: existingInputMessage
        ? !!existingInputMessage.translatedText
        : englishProcessingEnabled,
      inputTranslationOnlyEnabled: existingInputMessage
        ? existingInputMessage.turnContext?.inputTranslationOnlyEnabled ?? false
        : inputTranslationOnlyEnabled,
      displayLanguage,
    };
    const runEnglishProcessing = turnContext.englishProcessingEnabled;
    const translateInputOnly = !runEnglishProcessing && !!turnContext.inputTranslationOnlyEnabled;
    let executionNodes = runtimeNodes;
    const workflowVariablesBeforeAttempt = structuredClone(workflowSettingsValuesRef.current);
    const runtimeBeforeAttempt = captureTurnRuntime(runtimeNodes, workflowVariablesBeforeAttempt);
    const checkpointBeforeNodes = structuredClone(runtimeNodes);
    const checkpointBeforeWorkflowVariables = structuredClone(workflowVariablesBeforeAttempt);
    if (structuredInput?.commands.length) {
      const timeCommandResult = applyTimeCommandsToWorkflowNodes(nodesRef.current, structuredInput.commands);
      if (timeCommandResult.error) {
        notifySystem('warning', timeCommandResult.error);
        activeRun.current = null;
        setActiveRunId(null);
        activeRunLlmReport.current = null;
        setRunLlmReport(null);
        return false;
      }
      if (timeCommandResult.appliedDateTime) {
        nodesRef.current = timeCommandResult.nodes;
        setNodes(timeCommandResult.nodes);
        executionNodes = timeCommandResult.nodes;
        notifySystem('info', `RP Time set to ${timeCommandResult.appliedDateTime}.`);
      }
    }
    const turnNumber =
      replacement?.turn.number ?? (turnsRef.current[turnsRef.current.length - 1]?.number ?? 0) + 1;
    const turnId = replacement?.turn.id ?? createTurnId(turnNumber);
    const resetReplacementInputRpTime = replacement?.replaceInput === false && isAutoTurn;
    const replacementInputMessages =
      replacement && !replacement.replaceInput
        ? structuredClone(replacement.turn.input.messages).map((message) =>
            resetReplacementInputRpTime ? withoutMessageRpDateTime(message) : message,
          )
        : [];
    if (resetReplacementInputRpTime && replacementInputMessages.length > 0) {
      const inputIds = new Set(replacementInputMessages.map((message) => message.id));
      messagesRef.current = messagesRef.current.map((message) =>
        inputIds.has(message.id) ? withoutMessageRpDateTime(message) : message,
      );
      setMessages(messagesRef.current);
    }
    activeTurnCollectorRef.current = {
      turnId,
      turnNumber,
      createdAt: replacement?.turn.createdAt ?? new Date().toISOString(),
      part: replacement?.replaceInput === false ? 'output' : 'input',
      inputMessages: replacementInputMessages,
      outputMessages: [],
    };
    const replacedMessages = replacedMessageIds
      ? messagesRef.current.filter((message) => replacedMessageIds.has(message.id))
      : [];
    const replacedMessageInsertIndex = replacedMessageIds
      ? messagesRef.current.findIndex((message) => replacedMessageIds.has(message.id))
      : -1;
    let replacedMessagesRemoved = false;
    const removeReplacedMessages = () => {
      if (!replacedMessageIds || replacedMessagesRemoved) {
        return;
      }
      replacedMessagesRemoved = true;
      messagesRef.current = messagesRef.current.filter(
        (message) => !replacedMessageIds.has(message.id),
      );
      setMessages(messagesRef.current);
    };
    const restoreReplacedMessages = () => {
      if (!replacedMessageIds || !replacedMessagesRemoved || replacedMessages.length === 0) {
        return;
      }
      const nextMessages = messagesRef.current.filter(
        (message) => !replacedMessageIds.has(message.id),
      );
      const insertAt = Math.min(
        replacedMessageInsertIndex >= 0 ? replacedMessageInsertIndex : nextMessages.length,
        nextMessages.length,
      );
      nextMessages.splice(insertAt, 0, ...replacedMessages);
      messagesRef.current = nextMessages;
      setMessages(messagesRef.current);
      replacedMessagesRemoved = false;
    };

    clearAllRunActiveTimers();
    const resetRunNodes = nodesRef.current.map((node) => ({
        ...node,
        data: {
          ...node.data,
          runActive: false,
          runCompleted: !!node.data.runPrepared,
          runPrepared: false,
          runError: undefined,
          runtimePortValues: undefined,
        },
      }));
    nodesRef.current = resetRunNodes;
    setNodes(resetRunNodes);
    removeReplacedMessages();
    runStartTimeRef.current = runClockNow();
    setRunStartTimeMs(runStartTimeRef.current);
    runEndTimeRef.current = null;
    setRunDurationMs(0);
    setIsRunning(true);
    runtimeNodes
      .filter((node) =>
        node.data.kind === undefined &&
        (node.data.nodeType === 'llm-prompt' || node.data.nodeType === 'llm-prompt-switch')
      )
      .forEach((node) => updateRuntimeNode(node.id, { llmCallStats: [] }));
    updateRuntimeNode(inputNode.id, { llmCallStats: [] });
    updateRuntimeNode(outputNode.id, { llmCallStats: [] });
    const originalHistory = formatChatHistory(
      historyMessages,
      false,
      rpDateTimeFormat,
      rpWeekdayLanguage,
    );
    const translatedHistory = formatChatHistory(
      historyMessages,
      true,
      rpDateTimeFormat,
      rpWeekdayLanguage,
    );
    const basePhoneMessage = phoneMessageOverride ?? existingInputMessage?.phoneMessage ?? false;
    const messageFormat =
      messageFormatOverride ??
      (basePhoneMessage ? 1 : 0);
    const isPhoneMessage = messageFormat === 1;
    const turnModeOverrideValue = turnModeOverride;
    const isNarratorPhoneAutoTurn = narratorAutoTurn && isNarratorTurn && isPhoneMessage;
    const shouldAppendInputMessage =
      !existingInputMessage && replacement?.replaceInput !== false;
    if (shouldAppendInputMessage && activeTurnCollectorRef.current) {
      setOutputActionChoicesHiddenByTurn(activeTurnCollectorRef.current.turnId, true);
    }
    let inputText = displayText;
    let displayInputText = displayText;
    let liveOutputMessageId: number | undefined;
    let pendingLiveOutput:
      | {
          text: string;
          translated: boolean;
          originalText: string;
          extraFields?: Partial<MessageRecord>;
        }
      | undefined;
    let liveOutputFlushFrame = 0;
    let liveOutputFlushTimer = 0;
    let lastLiveOutputFlushMs = 0;
    let autoTurnInputMessageId: number | undefined;
    const responseWorkflowVariableSetCommands: WorkflowVariableSetCommand[] = [];
    const runWarnings: string[] = [];
    const runTraceEvents: TurnTraceEvent[] = [];
    const reportRunWarning = (message: string, node?: ExecuteTraceNodeInfo) => {
      if (node) {
        runTraceEvents.push({ kind: 'warning', ...node, message });
      } else {
        runWarnings.push(message);
      }
      notifySystem('warning', message);
    };
    const reportFormatResult = (
      result: ExecuteTraceFormatResult,
      node: ExecuteTraceNodeInfo = outputNodeTraceInfo,
    ) => {
      runTraceEvents.push({ kind: 'format', ...node, ...result });
    };
    const setWorkflowVariablesForResponseRun = (commands: WorkflowVariableSetCommand[]) => {
      responseWorkflowVariableSetCommands.push(...structuredClone(commands));
      setWorkflowVariablesFromCommands(commands);
    };

    const applyLiveOutput = (
      text: string,
      translated: boolean,
      originalText = '',
      extraFields?: Partial<MessageRecord>,
    ) => {
      if (liveOutputMessageId === undefined) {
        liveOutputMessageId = appendMessage({
          role: 'output',
          originalText: translated ? originalText : text,
          translatedText: translated ? text : undefined,
          includeInHistory: false,
          ...extraFields,
        });
        return;
      }
      updateMessage(
        liveOutputMessageId,
        translated
          ? { originalText, translatedText: text, ...extraFields }
          : { originalText: text, ...extraFields },
      );
    };
    const clearLiveOutputFlush = () => {
      if (liveOutputFlushFrame) {
        cancelAnimationFrame(liveOutputFlushFrame);
        liveOutputFlushFrame = 0;
      }
      if (liveOutputFlushTimer) {
        window.clearTimeout(liveOutputFlushTimer);
        liveOutputFlushTimer = 0;
      }
    };
    const flushLiveOutput = () => {
      const pending = pendingLiveOutput;
      if (!pending) {
        return;
      }
      pendingLiveOutput = undefined;
      clearLiveOutputFlush();
      lastLiveOutputFlushMs = performance.now();
      applyLiveOutput(pending.text, pending.translated, pending.originalText, pending.extraFields);
    };
    const scheduleLiveOutputFlush = () => {
      if (liveOutputFlushFrame || liveOutputFlushTimer) {
        return;
      }
      const elapsedMs = performance.now() - lastLiveOutputFlushMs;
      const waitMs = Math.max(0, liveOutputFlushIntervalMs - elapsedMs);
      const requestFlushFrame = () => {
        liveOutputFlushTimer = 0;
        liveOutputFlushFrame = requestAnimationFrame(() => {
          liveOutputFlushFrame = 0;
          flushLiveOutput();
        });
      };
      if (waitMs > 0) {
        liveOutputFlushTimer = window.setTimeout(requestFlushFrame, waitMs);
      } else {
        requestFlushFrame();
      }
    };
    const showLiveOutput = (
      text: string,
      translated: boolean,
      originalText = '',
      extraFields?: Partial<MessageRecord>,
    ) => {
      pendingLiveOutput = { text, translated, originalText, extraFields };
      scheduleLiveOutputFlush();
    };
    const inputHistoryContext = recentInputHistoryContext(
      historyMessages,
      rpDateTimeFormat,
      rpWeekdayLanguage,
    );
    const directInput = structuredInput?.commands.some((command) => command.type === 'direct') ?? false;
    const directInputTransformLabel = isPhoneMessage ? 'Act Phone' : 'Act RP';
    if (
      directInput &&
      !isAutoTurn &&
      !narratorAutoTurn &&
      !existingInputMessage &&
      displayText.trim()
    ) {
      try {
        inputText = await directInputText(
          displayText,
          inputNode.data.connectionId ?? defaultConnectionId,
          inputNode.id,
          inputHistoryContext,
          isPhoneMessage ? 'phone' : 'rp',
          turnContext.displayLanguage,
          runSignal,
        );
        displayInputText = inputText;
        if (runEnglishProcessing && inputText.trim()) {
          displayInputText = await translateText(
            inputText,
            'to-display',
            inputNode.data.connectionId ?? defaultConnectionId,
            inputNode.id,
            undefined,
            turnContext.displayLanguage,
            runSignal,
            inputHistoryContext,
            directInputTransformLabel,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = isRunCancelledError(error);
        const cancelReason = activeRunCancelReason.current as CancelReason;
        const restarting = cancelled && cancelReason === 'restart';
        restoreReplacedMessages();
        if (replacement) {
          applyTurnCheckpointRuntime(replacement.turn, 'after');
        } else {
          applyTurnRuntime(runtimeBeforeAttempt);
        }
        activeTurnCollectorRef.current = null;
        if (!cancelled) {
          notifySystem('error', `Input direction failed: ${message}`);
        } else if (!restarting) {
          notifySystem('info', 'Run cancelled.');
        }
        if (!restarting && shouldRestoreCancelledInput) {
          if (isPhoneMessage) {
            setPhoneDraft(displayText);
            setPhoneDraftCommands(commandInputCommandsFromStructured(structuredInput?.commands ?? []));
            setPhoneImages(inputImages);
            if (phoneReplyToOverride) {
              selectPhoneReply(phoneReplyToOverride);
            }
          } else {
            setDraft(displayText);
            setDraftCommands(commandInputCommandsFromStructured(structuredInput?.commands ?? []));
          }
        }
        finishRun();
        return false;
      }
    }
    if (
      (runEnglishProcessing || translateInputOnly) &&
      !directInput &&
      !isAutoTurn &&
      !narratorAutoTurn &&
      !existingInputMessage &&
      displayText.trim()
    ) {
      try {
        const translateSocialText = (text: string) => translateText(
          text,
          'to-english',
          inputNode.data.connectionId ?? defaultConnectionId,
          inputNode.id,
          undefined,
          turnContext.displayLanguage,
          runSignal,
          inputHistoryContext,
        );
        if (socialPost) {
          const translatedCaption = await translateSocialText(socialPost.caption);
          inputText = socialPostInputText({
            ...socialPost,
            caption: translatedCaption || socialPost.caption,
          });
        } else if (socialThreadAction && socialThreadContext) {
          const translatedComment = socialThreadAction.action === 'comment'
            ? await translateSocialText(socialThreadAction.commentText ?? '')
            : undefined;
          inputText = socialThreadActionInputText(
            translatedComment
              ? { ...socialThreadAction, commentText: translatedComment }
              : socialThreadAction,
            socialThreadContext.existingComments,
            socialThreadContext.likeCount,
          );
        } else {
          inputText = await translateSocialText(displayText);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = isRunCancelledError(error);
        const cancelReason = activeRunCancelReason.current as CancelReason;
        const restarting = cancelled && cancelReason === 'restart';
        restoreReplacedMessages();
        if (replacement) {
          applyTurnCheckpointRuntime(replacement.turn, 'after');
        } else {
          applyTurnRuntime(runtimeBeforeAttempt);
        }
        activeTurnCollectorRef.current = null;
        if (!cancelled) {
          notifySystem('error', `Input translation failed: ${message}`);
        } else if (!restarting) {
          notifySystem('info', 'Run cancelled.');
        }
        if (!restarting && shouldRestoreCancelledInput) {
          if (isPhoneMessage) {
            setPhoneDraft(displayText);
            setPhoneDraftCommands(commandInputCommandsFromStructured(structuredInput?.commands ?? []));
            setPhoneImages(inputImages);
            if (phoneReplyToOverride) {
              selectPhoneReply(phoneReplyToOverride);
            }
          } else {
            setDraft(displayText);
            setDraftCommands(commandInputCommandsFromStructured(structuredInput?.commands ?? []));
          }
        }
        finishRun();
        return false;
      }
    }

    const inputCharacterName = existingInputMessage?.speakerName ??
      (messageFormat === 2 || isNarratorTurn || (isAutoTurn && !inputCharacter)
        ? narratorSpeakerName
        : inputCharacter!.name);
    const phoneRecipientName =
      existingInputMessage?.phoneTo ?? phoneRecipientCharacterOverride?.name ?? selectedPhoneContact?.character.name;
    const rawSentPhoneImages = existingInputMessage?.imageAttachments ?? inputImages;
    const sentPhoneImages =
      !existingInputMessage && isPhoneMessage && phoneRecipientName && rawSentPhoneImages.length
        ? ensurePhoneImagesInStorybooks(
            inputCharacterName,
            phoneRecipientName,
            rawSentPhoneImages,
            imageDescriptionFromAttachments(rawSentPhoneImages),
          ) ?? rawSentPhoneImages
        : rawSentPhoneImages;
    if (sentPhoneImages !== rawSentPhoneImages) {
      executionNodes = nodesRef.current;
    }
    const rpInputImageName =
      !isPhoneMessage && sentPhoneImages.length > 0
        ? existingInputMessage?.rpImageName ?? nextRpPictureName(messagesRef.current)
        : undefined;
    const activeInputImages = rpInputImageName
      ? sentPhoneImages.map((image, index) =>
          index === 0 ? { ...image, name: rpInputImageName } : image,
        )
      : sentPhoneImages;
    const sentStorybookImage = sentPhoneImages.length === 1
      ? storybookImageForAttachment(
          inputCharacter ? storybooksByNodeId.get(inputCharacter.storybookNodeId) : undefined,
          inputCharacter?.sourceId,
          sentPhoneImages[0],
        )
      : undefined;
    const formatCurrentPhoneInput = (message: string, translated = false) =>
      phoneReplyTo
        ? formatPhoneReplyInput(inputCharacterName, phoneReplyTo, message.trim(), translated)
        : formatPhoneInput(
            inputCharacterName,
            phoneRecipientName ?? 'Unknown',
            message,
            sentPhoneImages.length
              ? {
                  id: sentStorybookImage?.id ?? sentPhoneImages[0]?.id,
                  description: sentStorybookImage?.description ?? sentPhoneImages[0]?.description,
                }
              : undefined,
          );
    const promptSlot = turnModeOverrideValue ?? (
      eventDisplayText
        ? 3
        : narratorAutoTurn
          ? 5
        : isNarratorTurn
          ? 4
        : isAutoTurn
          ? 2
          : activeInputImages.length > 0
            ? 0
            : 1
    );
    // While streaming, completed embedded phone JSON blocks render as preview
    // bubbles (negative placeholder ids — no phone records exist yet) and a
    // still-incomplete trailing JSON block stays hidden entirely.
    const livePhonePreviewFields = (
      preview: EmbeddedPhoneMessagesResult,
    ): Partial<MessageRecord> =>
      preview.phoneMessages.length > 0
        ? {
            embeddedPhoneMessages: preview.phoneMessages.map((phoneMessage, index) => ({
              phoneMessageId: -(index + 1),
              from: phoneMessage.from,
              to: phoneMessage.to,
              message: phoneMessage.message,
            })),
            embeddedPhoneTextBefore: preview.textBefore,
            embeddedPhoneTextAfter: preview.textAfter,
          }
        : {
            embeddedPhoneMessages: undefined,
            embeddedPhoneTextBefore: undefined,
            embeddedPhoneTextAfter: undefined,
          };
    const showLiveWorkflowOutput = (text: string) => {
      const definitions = settingsValueDefinitionsRef.current;
      const extracted = extractWorkflowVariableSetCommands(text);
      const previewValues = workflowVariablePreviewValues(
        extracted.commands,
        definitions,
        workflowSettingsValuesForGraph(),
      );
      const preview = embeddedPhoneMessagesLivePreview(
        resolveWorkflowVariables(extracted.text, definitions, previewValues),
      );
      showLiveOutput(preview.text, false, '', livePhonePreviewFields(preview));
    };
    const showLiveRpOutput =
      activeInputImages.length > 0
        ? createRpImageOutputStream(showLiveWorkflowOutput)
        : showLiveWorkflowOutput;
    const originalInput = replacement && !replacement.replaceInput
      ? (isAutoTurn ? inputText.trim() : replacement.turn.input.graphText)
      : (existingInputMessage && isPhoneMessage && phoneRecipientName
        ? formatCurrentPhoneInput(inputText)
        : existingInputMessage?.originalText) ??
      (messageFormat === 2
        ? inputText
        : undefined) ??
      (isNarratorTurn
        ? withSpeakerPrefix(narratorSpeakerName, inputText)
        : undefined) ??
      (isAutoTurn
        ? inputText.trim()
        : undefined) ??
      (isPhoneMessage && phoneRecipientName
        ? formatCurrentPhoneInput(inputText)
        : withSpeakerPrefix(inputCharacterName, inputText));
    const storedInputGraphText = replacement && !replacement.replaceInput
      ? replacement.turn.input.graphText
      : (existingInputMessage && isPhoneMessage ? originalInput : existingInputMessage?.originalText) ??
      (messageFormat === 2
        ? originalInput
        : undefined) ??
      (isNarratorTurn
        ? originalInput
        : undefined) ??
      (isAutoTurn && isPhoneMessage && phoneRecipientName
        ? `${inputCharacterName} texts ${phoneRecipientName}: ${inputText.trim()}`
        : undefined) ??
      (isAutoTurn
        ? `[AUTO TURN]\n${inputText.trim()}`
        : originalInput);
    const narratorDisplayInput = eventDisplayText ?? (narratorAutoTurn ? 'Narrator AutoTurn' : originalInput);
    const translatedInput = (existingInputMessage?.translatedText
      ? isPhoneMessage && phoneRecipientName
        ? formatCurrentPhoneInput(existingInputMessage.translatedText, true)
        : existingInputMessage.translatedText
      : undefined) ??
      (runEnglishProcessing && isNarratorTurn
        ? withSpeakerPrefix(narratorSpeakerName, displayInputText)
        : undefined) ??
      (runEnglishProcessing && isPhoneMessage && phoneRecipientName
        ? formatCurrentPhoneInput(displayInputText, true)
        : undefined) ??
      (
        runEnglishProcessing
          ? withSpeakerPrefix(inputCharacterName, displayInputText)
          : undefined
      );
    const inputCharacterColor = characterColors.get(inputCharacterName);
    const inputCharacterColors = inputCharacterColor
      ? { [inputCharacterName]: inputCharacterColor }
      : undefined;
    const originalInputDialogue = extractDialogueQuotes(originalInput).map((quote) => ({
      speakerName: inputCharacterName,
      text: quote.text,
    }));
    const translatedInputDialogue = translatedInput
      ? extractDialogueQuotes(translatedInput).map((quote) => ({
          speakerName: inputCharacterName,
          text: quote.text,
        }))
      : undefined;
    if (shouldAppendInputMessage && !isAutoTurn && isPhoneMessage && phoneRecipientName && !isNarratorPhoneAutoTurn) {
      appendPhoneMessage({
        from: inputCharacterName,
        to: phoneRecipientName,
        message: inputText.trim() || 'Attached image.',
        translatedMessage: runEnglishProcessing ? displayInputText.trim() || 'Attached image.' : undefined,
        imageAttachments: sentPhoneImages,
        turnContext,
      }, 'sent', 'user', undefined, undefined, {
        inputMessageFormat: messageFormat,
        inputPromptSlot: promptSlot,
        replyToMessageId: phoneReplyTo?.id,
      });
    }
    if (shouldAppendInputMessage && isAutoTurn) {
      autoTurnInputMessageId = appendMessage({
        role: 'user',
        originalText: narratorDisplayInput,
        imageAttachments: activeInputImages,
        rpImageName: rpInputImageName,
        includeInHistory: !isPhoneMessage,
        channel: 'rp',
        eventInput: !!eventDisplayText,
        eventDisplayText,
        phoneMessage: isPhoneMessage,
        phoneFrom: isPhoneMessage ? inputCharacterName : undefined,
        phoneTo: isPhoneMessage ? phoneRecipientName : undefined,
        speakerName: narratorSpeakerName,
        speakerNames: [narratorSpeakerName],
        turnContext,
      });
    }
    // Output-actions (2) and social-media (3) runs do not append the raw input
    // text; their results are recorded as dedicated history messages instead.
    if (shouldAppendInputMessage && !isAutoTurn && !isPhoneMessage && messageFormat !== 2 && messageFormat !== 3) {
      appendMessage({
        role: 'user',
        originalText: narratorAutoTurn ? 'Narrator AutoTurn' : originalInput,
        translatedText: narratorAutoTurn ? undefined : translatedInput,
        eventInput: !!eventDisplayText,
        eventDisplayText,
        imageAttachments: activeInputImages,
        rpImageName: rpInputImageName,
        includeInHistory: !narratorAutoTurn,
        phoneMessage: isPhoneMessage,
        speakerName: inputCharacterName,
        speakerNames: [inputCharacterName],
        speakerColors: inputCharacterColors,
        originalDialogue: narratorAutoTurn ? [] : originalInputDialogue,
        translatedDialogue: narratorAutoTurn ? undefined : translatedInputDialogue,
        turnContext,
      });
    }
    if (activeTurnCollectorRef.current) {
      activeTurnCollectorRef.current.part = 'output';
    }
    const visibleInput = originalInput;
    const lastRpOutput = lastMessageText(historyMessages, 'output');
    lastRunDebugRef.current = {
      turnMode,
      narratorAutoTurn,
      displayText,
      originalInput,
      visibleInput,
      promptSlot,
      isAutoTurn,
      isNarratorTurn,
      eventDisplayText,
      phoneMessage: isPhoneMessage,
      messageFormat,
      lastRpOutput,
      originalHistory,
      translatedHistory,
    };
    updateRuntimeNode(inputNode.id, {
      preview: (isAutoTurn || isNarratorTurn) ? `${narratorSpeakerName}: ${narratorDisplayInput}` : originalInput,
    });

    try {
      let outputHighlightingContext = '';
      let phoneMessageOutput = '';
      let outputActionsText = '';
      let socialMediaOutputText = '';
      const graphOutput = await executeGraph({
        outputNodeId: outputNode.id,
        nodes: executionNodes,
        edges,
        originalInput,
        visibleInput,
        lastRpOutput,
        inputImages: activeInputImages,
        phoneMessage: isPhoneMessage,
        messageFormat,
        promptSlot,
        originalHistory,
        translatedHistory,
        historyMessages,
        userControlledCharacterId: (messageFormat === 2 || isAutoTurn || isNarratorTurn) ? undefined : inputCharacter?.id,
        llm: nodeLlm.withAbortSignal(runSignal),
        textMetrics: new TextMetricsApi(activeTokenEstimateBytesPerToken),
        updateRuntimeNode,
        connections,
        onComfyGenerationActive: updateWorkflowComfyGenerationActive,
        settingsValues: workflowSettingsValuesForGraph(),
        settingsValueDefinitions: settingsValueDefinitionsRef.current,
        promptActionSettings,
        onWorkflowVariablesSet: setWorkflowVariablesForResponseRun,
        rpDateTimeFormat,
        rpWeekdayLanguage,
        referenceImages: runReferenceImageOptions,
        retryFormatErrorsEnabled,
        providerHealthById: providerHealthForRun,
        autoCalibrateTokenEstimate,
        onTokenEstimateCalibrated: setCalibratedTokenBytesPerToken,
        onWarning: reportRunWarning,
        onFormatResult: (result) => {
          runTraceEvents.push({ kind: 'format', ...result });
        },
        trackRunCompletion: true,
        auxiliaryOutputHandles: ['output-actions', 'highlighting-context', 'phone-message', 'social-media'],
        onAuxiliaryOutput: (handle, text) => {
          if (handle === 'highlighting-context') {
            outputHighlightingContext = text;
          }
          if (handle === 'phone-message') {
            phoneMessageOutput = text;
          }
          if (handle === 'output-actions') {
            outputActionsText = text;
          }
          if (handle === 'social-media') {
            socialMediaOutputText = text;
          }
        },
        streamOutput:
          messageFormat !== 2 &&
          !isPhoneMessage &&
          outputNode.data.streamOutputEnabled &&
          !runEnglishProcessing
            ? showLiveRpOutput
            : undefined,
        signal: runSignal,
      });
      flushLiveOutput();
      const parsedRpOutput = isPhoneMessage
        ? { story: graphOutput }
        : parseRpOutput(graphOutput);
      if (!isPhoneMessage && graphOutput.trim()) {
        reportFormatResult({
          name: 'RP Output format',
          status: 'ok',
          detail: parsedRpOutput.imageDescription
            ? parsedRpOutput.displayImageId
              ? 'Story text, image metadata, and display image parsed.'
              : 'Story text and image metadata parsed.'
            : parsedRpOutput.displayImageId
              ? 'Story text and display image parsed.'
              : 'Story text parsed.',
        });
      }
      const rpDisplayImageAttachment =
        !isPhoneMessage
          ? storybookImageAttachmentById(storybooksByNodeId, parsedRpOutput.displayImageId)
          : undefined;
      if (!isPhoneMessage && parsedRpOutput.displayImageId && !rpDisplayImageAttachment) {
        reportRunWarning(
          `RP Output displayImageId "${parsedRpOutput.displayImageId}" was not found in the Storybook image libraries.`,
          outputNodeTraceInfo,
        );
      }
      const embeddedPhoneResult =
        !isPhoneMessage
          ? parseEmbeddedPhoneMessagesFromRpOutput(parsedRpOutput.story)
          : {
              text: parsedRpOutput.story,
              textBefore: parsedRpOutput.story,
              textAfter: '',
              phoneMessages: [],
              bankTransfers: [],
            };
      // Phone replies may append a bankTransfers object after the reply JSON;
      // split it off so the reply still parses as a single phone message.
      const phoneOutputBankResult =
        isPhoneMessage && phoneMessageOutput
          ? parseEmbeddedPhoneMessagesFromRpOutput(phoneMessageOutput)
          : undefined;
      if (phoneOutputBankResult?.bankTransfers.length) {
        phoneMessageOutput = phoneOutputBankResult.text;
      }
      if (!isPhoneMessage && embeddedPhoneResult.phoneMessages.length > 0) {
        reportFormatResult({
          name: 'Embedded phone messages',
          status: 'ok',
          detail: `${embeddedPhoneResult.phoneMessages.length} embedded phone message(s) parsed.`,
        });
      }
      const rpOutput = eventDisplayText
        ? stripEventOutputHeader(embeddedPhoneResult.text, eventDisplayText)
        : embeddedPhoneResult.text;
      updateRuntimeNode(outputNode.id, { preview: rpOutput });
      if (!isPhoneMessage && rpOutput.trim()) {
        onRpOutputReady?.(rpOutput);
      }
      if (parsedRpOutput.imageDescription) {
        const describedInput = activeTurnCollectorRef.current?.inputMessages.find(
          (message) =>
            message.channel !== 'phone' &&
            !!message.imageAttachments?.length,
        );
        if (describedInput) {
          updateMessage(describedInput.id, {
            rpImageDescription: parsedRpOutput.imageDescription,
            rpImageName: describedInput.rpImageName ?? nextRpPictureName(messagesRef.current),
          });
        } else {
          notifySystem(
            'warning',
            'RP Output returned an RP image description, but the latest RP input has no image.',
          );
        }
      }
      const parsedPhoneMessage = parsePhoneMessageOutput(phoneMessageOutput, {
        allowIncomingImageAction: runPromptSwitchVisionFeaturesEnabled,
      });
      if (parsedPhoneMessage) {
        reportFormatResult({
          name: 'Phone Message JSON',
          status: 'ok',
          detail: `${parsedPhoneMessage.from} → ${parsedPhoneMessage.to}`,
        });
        let phoneImageCaptionChange: ImageCaptionChange | undefined;
        if (parsedPhoneMessage.incomingImageAction) {
          phoneImageCaptionChange = applyPhoneImageActionFromLlm(parsedPhoneMessage.incomingImageAction, phoneReplyTo);
        }
        if (runEnglishProcessing) {
          try {
            parsedPhoneMessage.translatedMessage = await translateText(
              parsedPhoneMessage.message,
              'to-display',
              outputNode.data.connectionId ?? defaultConnectionId,
              outputNode.id,
              undefined,
              turnContext.displayLanguage,
              runSignal,
              inputHistoryContext,
            );
          } catch (error) {
            if (isRunCancelledError(error)) {
              throw error;
            }
            notifySystem(
              'error',
              `Phone message translation failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        const canonicalParsedPhoneMessage = {
          ...parsedPhoneMessage,
          from: canonicalPhoneName(phoneCharacters, parsedPhoneMessage.from),
          to: canonicalPhoneName(phoneCharacters, parsedPhoneMessage.to),
        };
        const phoneMessageId = appendPhoneMessage(
          {
            ...canonicalParsedPhoneMessage,
            imageDescription: undefined,
            phoneImageCaptionChange,
          },
          phoneOutputSoundOverride ?? (isAutoTurn ? 'sent' : 'received'),
          'output',
          isNarratorPhoneAutoTurn ? 'narrator' : undefined,
          responseWorkflowVariableSetCommands.length > 0
            ? structuredClone(responseWorkflowVariableSetCommands)
            : undefined,
        );
        if (isAutoTurn && isPhoneMessage) {
          const autoTurnInput = autoTurnInputMessageId
            ? activeTurnCollectorRef.current?.inputMessages.find((message) => message.id === autoTurnInputMessageId)
            : activeTurnCollectorRef.current?.inputMessages.find(
                (message) =>
                  message.role === 'user' &&
                  message.speakerName === narratorSpeakerName &&
                  message.phoneMessage,
              );
          if (autoTurnInput) {
            updateMessage(autoTurnInput.id, {
              embeddedPhoneMessages: [{
                phoneMessageId,
                from: canonicalParsedPhoneMessage.from,
                to: canonicalParsedPhoneMessage.to,
                message: canonicalParsedPhoneMessage.message,
                translatedMessage: canonicalParsedPhoneMessage.translatedMessage,
              }],
              embeddedPhoneTextBefore: autoTurnInput.originalText,
              embeddedPhoneTextAfter: '',
            });
          }
        }
      } else if (phoneMessageOutput.trim()) {
        reportFormatResult({
          name: 'Phone Message JSON',
          status: 'error',
          detail: 'RP Output Phone Message could not be parsed.',
          preview: phoneMessageOutput,
        });
        reportRunWarning('RP Output Phone Message could not be parsed.', outputNodeTraceInfo);
      }
      const outputActions = parseOutputActions(outputActionsText);
      if (outputActionsText.trim()) {
        reportFormatResult({
          name: 'Output Actions JSON',
          status: outputActions.warnings.length ? 'error' : 'ok',
          detail: outputActions.warnings.length
            ? outputActions.warnings.join(' ')
            : 'Output Actions parsed.',
          preview: outputActions.warnings.length ? outputActionsText : undefined,
        });
      }
      outputActions.warnings.forEach((warning) => reportRunWarning(warning, outputNodeTraceInfo));
      const embeddedPhoneMessages: EmbeddedPhoneMessageLink[] = [];
      if (embeddedPhoneResult.phoneMessages.length > 0) {
        for (const [index, embeddedPhoneMessage] of embeddedPhoneResult.phoneMessages.entries()) {
          const canonicalEmbeddedPhoneMessage = {
            ...embeddedPhoneMessage,
            from: canonicalPhoneName(phoneCharacters, embeddedPhoneMessage.from),
            to: canonicalPhoneName(phoneCharacters, embeddedPhoneMessage.to),
          };
          const phoneMessageId = appendPhoneMessage(
            {
              ...canonicalEmbeddedPhoneMessage,
              turnContext,
            },
            index === 0 ? 'received' : undefined,
            'output',
          );
          embeddedPhoneMessages.push({
            phoneMessageId,
            from: canonicalEmbeddedPhoneMessage.from,
            to: canonicalEmbeddedPhoneMessage.to,
            message: canonicalEmbeddedPhoneMessage.message,
          });
        }
        // Link the phone records to the output message before the slow
        // translation/attribution steps run, so the bubbles render inside the
        // output card right away instead of flashing as standalone phone
        // messages below it.
        if (!isPhoneMessage) {
          flushLiveOutput();
          const earlyOutput = {
            originalText: rpOutput,
            imageAttachments: rpDisplayImageAttachment ? [rpDisplayImageAttachment] : undefined,
            includeInHistory: !!rpOutput.trim() || !!rpDisplayImageAttachment,
            embeddedPhoneMessages: embeddedPhoneMessages.map((link) => ({ ...link })),
            embeddedPhoneTextBefore: embeddedPhoneResult.textBefore,
            embeddedPhoneTextAfter: embeddedPhoneResult.textAfter,
          };
          if (liveOutputMessageId === undefined) {
            liveOutputMessageId = appendMessage({ role: 'output', ...earlyOutput });
          } else {
            updateMessage(liveOutputMessageId, earlyOutput);
          }
        }
        if (runEnglishProcessing) {
          for (const link of embeddedPhoneMessages) {
            try {
              const translatedMessage = await translateText(
                link.message,
                'to-display',
                outputNode.data.connectionId ?? defaultConnectionId,
                outputNode.id,
                undefined,
                turnContext.displayLanguage,
                runSignal,
                inputHistoryContext,
              );
              link.translatedMessage = translatedMessage;
              updateMessage(link.phoneMessageId, { translatedText: translatedMessage });
            } catch (error) {
              if (isRunCancelledError(error)) {
                throw error;
              }
              notifySystem(
                'error',
                `Embedded phone message translation failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }
      }
      let translatedOutput: string | undefined;
      let embeddedPhoneTranslatedTextBefore: string | undefined;
      let embeddedPhoneTranslatedTextAfter: string | undefined;
      let translationError: string | undefined;
      let primarySpeaker: string | undefined;
      let attributedNames: string[] = [];
      if (!isPhoneMessage && runEnglishProcessing) {
        try {
          translatedOutput = await translateText(
            rpOutput,
            'to-display',
            outputNode.data.connectionId ?? defaultConnectionId,
            outputNode.id,
            outputNode.data.streamOutputEnabled
              ? (text) => showLiveOutput(text, true, rpOutput)
              : undefined,
            turnContext.displayLanguage,
            runSignal,
            inputHistoryContext,
          );
          if (embeddedPhoneMessages.length > 0) {
            embeddedPhoneTranslatedTextBefore = embeddedPhoneResult.textBefore.trim()
              ? await translateText(
                  embeddedPhoneResult.textBefore,
                  'to-display',
                  outputNode.data.connectionId ?? defaultConnectionId,
                  outputNode.id,
                  undefined,
                  turnContext.displayLanguage,
                  runSignal,
                  inputHistoryContext,
                )
              : undefined;
            embeddedPhoneTranslatedTextAfter = embeddedPhoneResult.textAfter.trim()
              ? await translateText(
                  embeddedPhoneResult.textAfter,
                  'to-display',
                  outputNode.data.connectionId ?? defaultConnectionId,
                  outputNode.id,
                  undefined,
                  turnContext.displayLanguage,
                  runSignal,
                  inputHistoryContext,
                )
              : undefined;
          }
        } catch (error) {
          if (isRunCancelledError(error)) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          translationError = `Output translation failed: ${message}`;
        }
      }
      const displayOutput = translatedOutput ?? rpOutput;
      let attribution: OutputAttribution = { speakerNames: [], dialogue: [] };
      let analysisError: string | undefined;
      {
        try {
          attribution = await analyzeDisplayedOutput(
            displayOutput,
            outputNode,
            storyCharacters,
            outputHighlightingContext,
            runSignal,
            (result) => reportFormatResult(result, outputNodeTraceInfo),
          );
        } catch (error) {
          if (isRunCancelledError(error)) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          analysisError = `Speaker analysis failed: ${message}`;
        }
        primarySpeaker = attribution.speakerNames[0];
        attributedNames = attribution.speakerNames;
      }
      if (!isPhoneMessage && embeddedPhoneMessages.length > 0) {
        const embeddedPhoneSpeakerNames = embeddedPhoneMessages
          .map((phoneMessage) => phoneMessage.from)
          .map((speakerName) =>
            phoneCharacters.find(
              (character) => phoneNamesMatch(character.name, speakerName),
            )?.name ?? speakerName,
          );
        attributedNames = Array.from(new Set([...attributedNames, ...embeddedPhoneSpeakerNames]));
        primarySpeaker = attributedNames[0];
      }
      const speakerColors = Object.fromEntries(
        attributedNames.flatMap((speakerName) => {
          const color = characterColors.get(speakerName);
          return color ? [[speakerName, color]] : [];
        }),
      );
      const workflowVariableSetCommandsForOutput = responseWorkflowVariableSetCommands.length > 0
        ? structuredClone(responseWorkflowVariableSetCommands)
        : undefined;
      flushLiveOutput();
      const completedOutput: Partial<MessageRecord> = {
        originalText: rpOutput,
        translatedText: translatedOutput,
        imageAttachments: rpDisplayImageAttachment ? [rpDisplayImageAttachment] : undefined,
        includeInHistory: !!rpOutput.trim() || !!rpDisplayImageAttachment,
        speakerName: primarySpeaker,
        speakerNames: attributedNames,
        speakerColors,
        originalDialogue: runEnglishProcessing ? undefined : attribution.dialogue,
        translatedDialogue:
          runEnglishProcessing && translatedOutput ? attribution.dialogue : undefined,
        embeddedPhoneMessages,
        embeddedPhoneTextBefore: embeddedPhoneResult.textBefore,
        embeddedPhoneTextAfter: embeddedPhoneResult.textAfter,
        embeddedPhoneTranslatedTextBefore,
        embeddedPhoneTranslatedTextAfter,
        workflowVariableSetCommands: workflowVariableSetCommandsForOutput,
      };
      if (!isPhoneMessage && liveOutputMessageId === undefined) {
        appendMessage({
          role: 'output',
          originalText: rpOutput,
          translatedText: translatedOutput,
          imageAttachments: rpDisplayImageAttachment ? [rpDisplayImageAttachment] : undefined,
          includeInHistory: !!rpOutput.trim() || !!rpDisplayImageAttachment,
          speakerName: primarySpeaker,
          speakerNames: attributedNames,
          speakerColors,
          originalDialogue: completedOutput.originalDialogue,
          translatedDialogue: completedOutput.translatedDialogue,
          embeddedPhoneMessages,
          embeddedPhoneTextBefore: embeddedPhoneResult.textBefore,
          embeddedPhoneTextAfter: embeddedPhoneResult.textAfter,
          embeddedPhoneTranslatedTextBefore,
          embeddedPhoneTranslatedTextAfter,
          workflowVariableSetCommands: workflowVariableSetCommandsForOutput,
        });
      } else if (!isPhoneMessage && liveOutputMessageId !== undefined) {
        updateMessage(liveOutputMessageId, completedOutput);
      }
      {
        const translateOutputActionText = async (
          text: string,
          action: OutputActionChatMessage,
        ) => {
          if (!runEnglishProcessing) {
            return undefined;
          }
          try {
            return await translateText(
              text,
              'to-display',
              outputNode.data.connectionId ?? defaultConnectionId,
              outputNode.id,
              undefined,
              turnContext.displayLanguage,
              runSignal,
              inputHistoryContext,
            );
          } catch (error) {
            if (isRunCancelledError(error)) {
              throw error;
            }
            notifySystem(
              'error',
              `Output Actions chat translation failed for ${action.speakerName ?? 'chat message'}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return undefined;
          }
        };

        outputActions.controls.forEach((control) => {
          if (control.type === 'setTab') {
            selectChatPanelView(control.tab);
            return;
          }
          if (control.name.toLocaleLowerCase() === 'current') {
            return;
          }
          const character =
            phoneNamesMatch(control.name, narratorSpeakerName)
              ? { id: narratorCharacterId }
              : storyCharacters.find(
                  (entry) => entry.id === control.name || phoneNamesMatch(entry.name, control.name),
                );
          if (character) {
            selectChatCharacter(character.id);
          } else {
            setSelectedCharacterId(narratorCharacterId);
            notifySystem('warning', `Output Actions could not find player "${control.name}". Falling back to Narrator.`);
          }
        });

        for (const chatMessage of outputActions.chatMessages) {
          const translatedText = await translateOutputActionText(chatMessage.text, chatMessage);
          const speakerName = chatMessage.speakerName;
          appendMessage({
            role: 'output',
            originalText: chatMessage.text,
            translatedText,
            includeInHistory: true,
            speakerName,
            speakerNames: speakerName ? [speakerName] : undefined,
            speakerColors:
              speakerName && characterColors.get(speakerName)
                ? { [speakerName]: characterColors.get(speakerName)! }
                : undefined,
          });
        }

        const appendOutputActionUiItem = (item: OutputActionUiItem) => {
          if (item.type === 'choiceGroup') {
            appendMessage({
              role: 'output',
              originalText: item.value.prompt?.trim() ?? '',
              includeInHistory: false,
              outputActionChoices: [item.value],
            });
            return;
          }
          if (item.type === 'infoBox') {
            appendMessage({
              role: 'output',
              originalText: [item.value.title, item.value.text].filter(Boolean).join(': '),
              includeInHistory: false,
              outputActionInfoBoxes: [item.value],
            });
            return;
          }
          if (item.type === 'progressBar') {
            appendMessage({
              role: 'output',
              originalText: `${item.value.title}: ${item.value.value}/${item.value.max}`,
              includeInHistory: false,
              outputActionProgressBars: [item.value],
            });
            return;
          }
          const contextCapacityBars = resolveOutputActionContextCapacityBars([item.value]);
          if (contextCapacityBars.length === 0) {
            return;
          }
          appendMessage({
            role: 'output',
            originalText: contextCapacityBars
              .map(
                (bar) =>
                  `${bar.title}: trimmed context ${bar.replacedTokens} / summary ${bar.summaryTokens} / active ${bar.activeTokens} / max ${bar.maxTokens}`,
              )
              .join('\n'),
            includeInHistory: false,
            outputActionContextCapacityBars: contextCapacityBars,
          });
        };

        outputActions.uiItems.forEach(appendOutputActionUiItem);

        for (const [index, actionPhoneMessage] of outputActions.phoneMessages.entries()) {
          const canonicalActionPhoneMessage = {
            ...actionPhoneMessage,
            from: canonicalPhoneName(phoneCharacters, actionPhoneMessage.from),
            to: canonicalPhoneName(phoneCharacters, actionPhoneMessage.to),
          };
          let translatedMessage: string | undefined;
          if (runEnglishProcessing) {
            try {
              translatedMessage = await translateText(
                canonicalActionPhoneMessage.message,
                'to-display',
                outputNode.data.connectionId ?? defaultConnectionId,
                outputNode.id,
                undefined,
                turnContext.displayLanguage,
                runSignal,
                inputHistoryContext,
              );
            } catch (error) {
              if (isRunCancelledError(error)) {
                throw error;
              }
              notifySystem(
                'error',
                `Output Actions phone translation failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          appendPhoneMessage(
            {
              from: canonicalActionPhoneMessage.from,
              to: canonicalActionPhoneMessage.to,
              message: canonicalActionPhoneMessage.message,
              translatedMessage,
              imageId: canonicalActionPhoneMessage.imageId,
              imageDescription: canonicalActionPhoneMessage.imageDescription,
              turnContext,
            },
            index === 0 ? 'received' : undefined,
            'output',
          );
        }

        for (const bankTransfer of [
          ...outputActions.bankTransfers,
          ...embeddedPhoneResult.bankTransfers,
          ...(phoneOutputBankResult?.bankTransfers ?? []),
        ]) {
          const canonicalTransfer = {
            ...bankTransfer,
            from: canonicalPhoneName(phoneCharacters, bankTransfer.from),
            to: canonicalPhoneName(phoneCharacters, bankTransfer.to),
          };
          const sender = storyCharacters.find((character) =>
            bankTransferPartyMatches(character, canonicalTransfer.from)
          );
          const recipient = storyCharacters.find((character) =>
            bankTransferPartyMatches(character, canonicalTransfer.to)
          );
          if (!sender && !recipient) {
            reportRunWarning(
              `Bank transfer from "${canonicalTransfer.from}" to "${canonicalTransfer.to}" was ignored because neither party has a Storybook bank account.`,
              outputNodeTraceInfo,
            );
            continue;
          }
          if (sender?.id === recipient?.id) {
            reportRunWarning('A bank transfer to the same account was ignored.', outputNodeTraceInfo);
            continue;
          }
          if (
            sender &&
            canonicalTransfer.amount > bankingBalanceForCharacter(sender, messagesRef.current)
          ) {
            reportRunWarning(
              `Bank transfer from "${sender.name}" was ignored because the account balance is too low.`,
              outputNodeTraceInfo,
            );
            continue;
          }
          const historyText = bankTransferHistoryText(canonicalTransfer);
          const translatedText = await translateOutputActionText(historyText, { text: historyText });
          appendMessage({
            role: 'output',
            originalText: historyText,
            translatedText,
            includeInHistory: true,
            bankTransfer: canonicalTransfer,
          });
        }

        // Social-media runs record the post itself plus the generated
        // reactions as history messages, mirroring how bank transfers land in
        // the timeline. The post is only persisted when the run succeeds.
        if (socialPost) {
          // The whole input block was translated to English for the run. The
          // persisted record uses that text too, so the app and history agree.
          const englishCaption = socialPostTextFromInput(originalInput) ?? socialPost.caption;
          const persistedSocialPost = { ...socialPost, caption: englishCaption };
          const postHistoryText = socialPostHistoryText(persistedSocialPost);
          const translatedPostText = await translateOutputActionText(postHistoryText, {
            text: postHistoryText,
          });
          appendMessage({
            role: 'output',
            originalText: postHistoryText,
            translatedText: translatedPostText,
            includeInHistory: true,
            socialPost: persistedSocialPost,
          });
          const parsedReactions = parseSocialReactionsOutput(socialMediaOutputText, socialPost);
          reportFormatResult({
            name: 'Social Media JSON',
            status: parsedReactions.reactions && parsedReactions.warnings.length === 0 ? 'ok' : 'error',
            detail: parsedReactions.warnings.length
              ? parsedReactions.warnings.join(' ')
              : `${parsedReactions.reactions?.likes ?? 0} like(s), ${parsedReactions.reactions?.comments.length ?? 0} comment(s) parsed.`,
            preview: parsedReactions.warnings.length ? socialMediaOutputText : undefined,
          });
          parsedReactions.warnings.forEach((warning) => reportRunWarning(warning, outputNodeTraceInfo));
          if (parsedReactions.reactions) {
            // Only comments from real Storybook characters matter to the
            // story; generated NPC comments stay in the app but are left out
            // of the chat-history line.
            const characterComments = parsedReactions.reactions.comments.filter((comment) =>
              storyCharacters.some((character) => bankTransferPartyMatches(character, comment.from)),
            );
            const reactionsText = socialReactionsHistoryText(
              { ...parsedReactions.reactions, comments: characterComments },
              persistedSocialPost,
            );
            const translatedReactionsText = await translateOutputActionText(reactionsText, {
              text: reactionsText,
            });
            appendMessage({
              role: 'output',
              originalText: reactionsText,
              translatedText: translatedReactionsText,
              includeInHistory: true,
              socialReactions: parsedReactions.reactions,
            });
          }
        }
        if (socialThreadAction) {
          const persistedThreadAction = socialThreadAction.action === 'comment'
            ? {
                ...socialThreadAction,
                commentText:
                  socialThreadCommentTextFromInput(originalInput) ?? socialThreadAction.commentText,
              }
            : socialThreadAction;
          const parsedReactions = parseSocialReactionsOutput(socialMediaOutputText, {
            app: persistedThreadAction.app,
            postId: persistedThreadAction.postId,
            append: true,
          });
          reportFormatResult({
            name: 'Social Media Thread JSON',
            status: parsedReactions.reactions && parsedReactions.warnings.length === 0 ? 'ok' : 'error',
            detail: parsedReactions.warnings.length
              ? parsedReactions.warnings.join(' ')
              : `${parsedReactions.reactions?.likes ?? 0} additional like(s), ${parsedReactions.reactions?.comments.length ?? 0} comment(s) parsed.`,
            preview: parsedReactions.warnings.length ? socialMediaOutputText : undefined,
          });
          parsedReactions.warnings.forEach((warning) => reportRunWarning(warning, outputNodeTraceInfo));
          const historyReactions = parsedReactions.reactions ?? {
            app: persistedThreadAction.app,
            postId: persistedThreadAction.postId,
            likes: 0,
            comments: [],
            append: true,
          };
          const historyText = socialThreadHistoryText(
            persistedThreadAction,
            historyReactions,
            parsedReactions.historySummary,
          );
          const translatedHistoryText = await translateOutputActionText(historyText, {
            text: historyText,
          });
          appendMessage({
            role: 'output',
            originalText: historyText,
            translatedText: translatedHistoryText,
            includeInHistory: true,
            socialThreadAction: persistedThreadAction,
            socialReactions: parsedReactions.reactions,
          });
        }
      }
      if (!isPhoneMessage && translationError) {
        notifySystem('error', translationError);
      }
      if (!isPhoneMessage && analysisError) {
        notifySystem('warning', analysisError);
      }
      if (responseWorkflowVariableSetCommands.length > 0) {
        const collectedOutputWithCommands = activeTurnCollectorRef.current?.outputMessages.some(
          (message) => (message.workflowVariableSetCommands?.length ?? 0) > 0,
        );
        if (!collectedOutputWithCommands) {
          const metadataTarget = [...(activeTurnCollectorRef.current?.outputMessages ?? [])]
            .reverse()
            .find((message) => message.role === 'output');
          if (metadataTarget) {
            updateMessage(metadataTarget.id, {
              workflowVariableSetCommands: structuredClone(responseWorkflowVariableSetCommands),
            });
          }
        }
      }
      const collectedTurn = activeTurnCollectorRef.current;
      const completedHistoryMessages: MessageRecord[] = [
        ...historyMessages,
        ...(collectedTurn?.inputMessages ?? []),
        ...(collectedTurn?.outputMessages ?? []),
      ];
      const completedOriginalHistory = formatChatHistory(
        completedHistoryMessages,
        false,
        rpDateTimeFormat,
        rpWeekdayLanguage,
      );
      const completedTranslatedHistory = formatChatHistory(
        completedHistoryMessages,
        true,
        rpDateTimeFormat,
        rpWeekdayLanguage,
      );
      try {
        const recentTurns = turnsRef.current
          .filter((turn) => turn.id !== collectedTurn?.turnId)
          .slice(-5);
        await executeGraph({
          outputNodeId: outputNode.id,
          postOutputRun: true,
          postOutputNodeIds: nodesPreparedAfterOutput(nodesRef.current, edges),
          nodes: nodesRef.current,
          edges,
          originalInput,
          visibleInput,
          lastRpOutput: lastMessageText(completedHistoryMessages, 'output') || rpOutput,
          inputImages: activeInputImages,
          phoneMessage: isPhoneMessage,
          originalHistory: completedOriginalHistory,
          translatedHistory: completedTranslatedHistory,
          historyMessages: completedHistoryMessages,
          recentTurns,
          currentTurnId: collectedTurn?.turnId,
          updateHistoryMessageTimes,
          userControlledCharacterId: (messageFormat === 2 || isAutoTurn || isNarratorTurn) ? undefined : inputCharacter?.id,
          llm: nodeLlm.withAbortSignal(runSignal),
          textMetrics: new TextMetricsApi(activeTokenEstimateBytesPerToken),
          updateRuntimeNode,
          connections,
          onComfyGenerationActive: updateWorkflowComfyGenerationActive,
          onWarning: reportRunWarning,
          onFormatResult: (result) => {
            runTraceEvents.push({ kind: 'format', ...result });
          },
          settingsValues: workflowSettingsValuesForGraph(),
          settingsValueDefinitions: settingsValueDefinitionsRef.current,
          promptActionSettings,
          onWorkflowVariablesSet: setWorkflowVariablesFromCommands,
          rpDateTimeFormat,
          rpWeekdayLanguage,
          referenceImages: runReferenceImageOptions,
          retryFormatErrorsEnabled,
          trackRunCompletion: true,
          signal: runSignal,
        });
      } catch (error) {
        if (isRunCancelledError(error)) {
          throw error;
        }
        reportRunWarning(
          `Next-turn preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      onSuccessfulRunBeforeCommit?.();
      const committedTurn = commitCollectedTurn(
        storedInputGraphText,
        rpOutput,
        checkpointBeforeNodes,
        checkpointBeforeWorkflowVariables,
        replacement,
        turnMode,
        { messageFormat, promptSlot },
      );
      const completedRunReport = activeRunLlmReport.current;
      if (committedTurn && completedRunReport) {
        recordTurnTrace({
          turn: committedTurn,
          run: completedRunReport,
          nodes: nodesRef.current,
          status: 'completed',
          warnings: runWarnings,
          traceEvents: runTraceEvents,
        });
      }
      clearTemporaryReferenceImages();
      pruneStorybookExternalImagesForMessages();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = isRunCancelledError(error);
      const cancelReason = activeRunCancelReason.current as CancelReason;
      const restarting = cancelled && cancelReason === 'restart';
      const failedCollector = activeTurnCollectorRef.current;
      const failedRunReport = activeRunLlmReport.current;
      if (!cancelled && failedCollector && failedRunReport) {
        const failedTurn: TurnRecord = {
          id: failedCollector.turnId,
          number: failedCollector.turnNumber,
          createdAt: failedCollector.createdAt,
          mode: turnMode,
          messageFormat,
          promptSlot,
          input: {
            graphText: storedInputGraphText,
            messages: structuredClone(failedCollector.inputMessages),
          },
          output: {
            graphText: '',
            messages: structuredClone(failedCollector.outputMessages),
          },
        };
        recordTurnTrace({
          turn: failedTurn,
          run: failedRunReport,
          nodes: nodesRef.current,
          status: 'error',
          warnings: runWarnings,
          traceEvents: runTraceEvents,
          error: message,
        });
      }
      pendingLiveOutput = undefined;
      clearLiveOutputFlush();
      if (liveOutputMessageId !== undefined) {
        removeMessage(liveOutputMessageId);
      }
      restoreReplacedMessages();
      if (activeTurnCollectorRef.current) {
        setOutputActionChoicesHiddenByTurn(activeTurnCollectorRef.current.turnId, false);
      }
      const collectedIds = new Set(
        [
          ...(replacement?.replaceInput === false
            ? []
            : activeTurnCollectorRef.current?.inputMessages ?? []),
          ...(activeTurnCollectorRef.current?.outputMessages ?? []),
        ].map((entry) => entry.id),
      );
      messagesRef.current = messagesRef.current.filter((entry) => !collectedIds.has(entry.id));
      setMessages(messagesRef.current);
      if (replacement) {
        applyTurnCheckpointRuntime(replacement.turn, 'after');
      } else {
        applyTurnRuntime(runtimeBeforeAttempt);
        pruneStorybookExternalImagesForMessages();
      }
      activeTurnCollectorRef.current = null;
      if (!restarting && !replacement && shouldRestoreCancelledInput) {
        if (isPhoneMessage) {
          setPhoneDraft(displayText);
          setPhoneDraftCommands(commandInputCommandsFromStructured(structuredInput?.commands ?? []));
          setPhoneImages(inputImages);
          if (phoneReplyToOverride) {
            selectPhoneReply(phoneReplyToOverride);
          }
        } else {
          setDraft(displayText);
          setDraftCommands(commandInputCommandsFromStructured(structuredInput?.commands ?? []));
          setDraftImages(inputImages);
        }
      }
      if (!cancelled) {
        updateRuntimeNode(outputNode.id, { preview: `Error: ${message}` });
        notifySystem('error', `Graph error: ${message}`);
      } else if (!restarting) {
        notifySystem('info', 'Run cancelled.');
      }
      return false;
    } finally {
      finishRun();
    }
  }

  return { runGraph };
}
