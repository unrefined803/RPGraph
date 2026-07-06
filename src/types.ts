import type { Edge, Node, XYPosition } from '@xyflow/react';
import type { NodeVersion } from './nodes/nodeVersion';
import type { WorkflowFormatVersion } from './workflow/version';
import type {
  PromptActionConfig,
  PromptActionRuntimeSettings,
  PromptActionStoredConfig,
} from './nodes/shared/promptActions';
import type { PromptRunDebug } from './nodes/shared/promptRun';
import type { CoreNodeType } from './nodes/coreNodeTypes';

export type ConnectionReasoningEffort =
  | 'auto'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export type LlmProviderKind =
  | 'lm-studio'
  | 'ollama'
  | 'openrouter'
  | 'gemini';

export type ComfyConnectionRole = 'image' | 'voice';

export type ComfyNarratorVoice = {
  name: string;
  dataUrl: string;
};

export type DialogueVoiceMode = 'click' | 'preload' | 'read-aloud' | 'narrator-only';

export type ConnectionPreset = {
  id: string;
  kind?: 'llm' | 'comfyui';
  comfyRole?: ComfyConnectionRole;
  providerKind?: LlmProviderKind;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  ttsVoice?: string;
  ttsTemperature?: number;
  ttsStreamAudio?: boolean;
  ttsAudioProfile?: string;
  ttsStyle?: string;
  ttsAccent?: string;
  ttsPace?: string;
  comfyWorkflowPath?: string;
  comfyWorkflowSetupConfirmed?: boolean;
  comfyNarratorVoice?: ComfyNarratorVoice;
  comfyDeleteVoiceOutputs?: boolean;
  comfyWidth?: number;
  comfyHeight?: number;
  comfyPrompt?: string;
  comfyCheckpointName?: string;
  comfyDiffusionModelName?: string;
  comfyVaeName?: string;
  comfyTextEncoderName?: string;
  comfyLoraSlots?: ComfyLoraSlot[];
  reasoningEffort?: ConnectionReasoningEffort;
  vision?: boolean;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
};

export type ProviderConnectionCapabilities = {
  text?: boolean;
  vision?: boolean;
  tools?: boolean;
  image?: boolean;
  voice?: boolean;
};

export type ProviderConnectionHealth = {
  status: 'unknown' | 'checking' | 'online' | 'warning' | 'offline';
  detail?: string;
  capabilities?: ProviderConnectionCapabilities;
  checkedAt?: number;
};

export type LmStudioModelInfo = {
  id: string;
  name: string;
  type?: string;
  vision: boolean;
  trainedForToolUse: boolean;
};

export type OllamaModelInfo = {
  id: string;
  name: string;
  vision: boolean;
  trainedForToolUse: boolean;
};

export type OpenRouterModelInfo = {
  id: string;
  name: string;
  vision: boolean;
  text?: boolean;
  image?: boolean;
  voice?: boolean;
  inputModalities: string[];
  outputModalities: string[];
  supportedVoices: string[];
  supportedParameters: string[];
  contextLength?: number;
  pricing?: unknown;
};

export type GeminiModelInfo = OpenRouterModelInfo & {
  supportedGenerationMethods: string[];
};

export type ComfyLoraSlot = {
  name: string;
  strength: number;
};

export type RpDateTimeFormat = 'eu' | 'us' | 'iso';
export type RpWeekdayLanguage =
  | 'disabled'
  | 'system'
  | 'de-DE'
  | 'en-US'
  | 'ru-RU'
  | 'fr-FR'
  | 'es-ES'
  | 'it-IT'
  | 'pt-BR'
  | 'pl-PL'
  | 'tr-TR'
  | 'uk-UA'
  | 'ar-SA'
  | 'zh-CN'
  | 'ja-JP'
  | 'ko-KR'
  | 'hi-IN'
  | 'id-ID'
  | 'nl-NL'
  | 'sv-SE'
  | 'vi-VN';

export type WorkflowNodeType = CoreNodeType;

export type PortSnapshot = {
  id: string;
  direction: 'input' | 'output';
  valueType: string;
  label: string;
  multiple?: boolean;
};

export type ContextBuilderItem = {
  id: string;
  sourceIndex: number;
  sourceLabel: string;
  fieldPath: string;
  fieldLabel: string;
  value: string;
  enabled: boolean;
};

export type CharacterStatDefinition = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type CharacterStatsState = {
  characters: Record<string, Record<string, number>>;
};

export type CharacterStatsChanges = CharacterStatsState;

export type CharacterStatsTimelineEntry = {
  rpDateTime: string;
  turnNumber?: number;
  state: CharacterStatsState;
  baselineState: CharacterStatsState;
};

export type LlmCallStats = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  durationMs: number;
};

export type NodeLlmCallStats = LlmCallStats & {
  label: string;
};

export type SettingsValueEntry = {
  id: string;
  optionKey: string;
  label: string;
};

export type LlmDecisionOutputToggles = {
  bool: boolean;
  text: boolean;
  number: boolean;
};

export type TextRouterMode = 'bool' | 'number';

type RpStorybookFormattedTextSettings = {
  title: boolean;
  introduction: boolean;
  scenario: boolean;
  characters: boolean;
  openingHistory: boolean;
  characterImages: boolean;
};

export type SettingsValueDefinition = {
  key: string;
  label: string;
  enabled: boolean;
  builtIn?: boolean;
  valueKind: 'number' | 'text';
  used: boolean;
  usedAsNumber: boolean;
};

export type WorkflowVariableSetCommand = {
  name: string;
  value: string;
};

export type LlmCompletionResult = {
  text: string;
  stats: LlmCallStats;
};

export type ChatImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  width?: number;
  height?: number;
  description?: string;
  receivedFrom?: string;
  imageAccess?: boolean;
};

export type ImageCaptionChange = {
  imageId: string;
  beforeCaption?: string;
  afterCaption: string;
};

type WorkflowNodeCommonFields = {
  label: string;
  description: string;
  preview: string;
  nodeDataVersion?: NodeVersion;
  currentNodeVersion?: NodeVersion;
  portsSnapshot?: PortSnapshot[];
  runActive?: boolean;
  runVisionActive?: boolean;
  runCompleted?: boolean;
  runPrepared?: boolean;
  runError?: string;
  displayTokenBytesPerToken?: number;
  runtimePortValues?: Record<string, string>;
  llmCallStats?: NodeLlmCallStats[];
  llmPromptBefore?: string;
  llmPromptAfter?: string;
  llmPromptAutoFormatJson?: boolean;
  llmPromptActions?: Array<PromptActionConfig | PromptActionStoredConfig>;
  llmPromptDebug?: PromptRunDebug;
  llmPromptSwitchOutputTitles?: string[];
  llmPromptSwitchPromptTitlesByOutput?: string[][];
  llmPromptSwitchPromptBeforesByOutput?: string[][];
  llmPromptSwitchPromptAftersByOutput?: string[][];
  llmPromptSwitchSelectedOutputChannel?: number;
  llmPromptSwitchSelectedPromptSlot?: number;
  llmPromptSwitchAutoShowPrompt?: boolean;
  llmPromptSwitchAutoFormatJson?: boolean;
  llmPromptSwitchDebug?: PromptRunDebug & {
    outputChannelValue: string;
    promptSlotValue: string;
    selectedOutputChannel: number;
    selectedPromptSlot: number;
  };
  connectionId?: string;
  streamOutputEnabled?: boolean;
  speakerAnalysisEnabled?: boolean;
  dialogueHighlightEnabled?: boolean;
  outputSpeakerResponseFormat?: OutputSpeakerResponseFormat;
  outputSpeakerPrompt?: OutputSpeakerPromptSettings;
  inputAPreview?: string;
  inputBPreview?: string;
  writeTextValue?: string;
  fixedBoolValue?: boolean;
  textRouterMode?: TextRouterMode;
  textRouterNumberOutputCount?: number;
  textSelectorMode?: TextRouterMode;
  textSelectorInputCount?: number;
  combinerInputCount?: number;
  combinerPrefixes?: string[];
  combinerInputPreviews?: string[];
  characterStatDefinitions?: CharacterStatDefinition[];
  characterStatsState?: CharacterStatsState;
  characterStatsBaselineState?: CharacterStatsState;
  characterStatsLastChanges?: CharacterStatsChanges;
  characterStatsLastRpDateTime?: string;
  characterStatsTimeline?: CharacterStatsTimelineEntry[];
  characterStatsPrimaryId?: string;
  characterStatsMaxChange?: number;
  characterStatsStatus?: string;
  characterStatsContextText?: string;
  characterStatsLastResponse?: string;
  characterStatsLastPrompt?: string;
  outputHighlightingInputToon?: string;
  outputHighlightingResponseToon?: string;
  outputHighlightingResultToon?: string;
  fullText?: string;
  includeRpDateTime?: boolean;
  memorySlotName?: string;
  memorySlotText?: string;
  memorySlotMode?: 'joined' | 'input' | 'output';
  generatedText?: string;
  rawHistory?: string;
  originalHistory?: string;
  translatedHistory?: string;
  lastTurnsHistory?: string;
  historyTimeTrackingEnabled?: boolean;
  historyCurrentRpDateTime?: string;
  historyProcessedTurnIds?: string[];
  historyLastTurnsCount?: number;
  historyTimeStatus?: string;
  historyLastPrompt?: string;
  historyLastResponse?: string;
  historyRpTimePrompt?: HistoryRpTimePromptSettings;
  eventAppointments?: RpAppointment[];
  eventProcessedTurnIds?: string[];
  eventStatus?: string;
  eventLastPrompt?: string;
  eventLastResponse?: string;
  eventManagerPrompt?: EventManagerPromptSettings;
  contextCompressionMaxTokens?: number | string;
  contextCompressionRatio?: number;
  contextCompressionLengthWords?: number | string;
  compressAfterOutput?: boolean;
  runAfterRpOutput?: boolean;
  compressedText?: string;
  compressionSourceText?: string;
  compressionRemainingText?: string;
  contextTokenLimit?: number;
  resolvedContextTokenLimit?: number;
  hasContextLimitConnection?: boolean;
  fixedNumberValue?: number | string;
  settingsValueEntries?: SettingsValueEntry[];
  llmDecisionQuestions?: string[];
  llmDecisionOutputToggles?: LlmDecisionOutputToggles[];
  llmDecisionBoolResults?: boolean[];
  llmDecisionTextResults?: string[];
  llmDecisionNumberResults?: number[];
  loadedText?: string;
  loadedFileName?: string;
  loadTextWrapPreview?: boolean;
  contextBuilderItems?: ContextBuilderItem[];
  contextBuilderStatus?: string;
  storybookJson?: string;
  storybookStatus?: string;
  storybookFileName?: string;
  storybookFilePath?: string;
  storybookFormattedTextSettings?: RpStorybookFormattedTextSettings;
  customNodeDefinition?: unknown;
  customNodeRuntimeDisplays?: Record<string, string>;
  autoTurnInstructions?: AutoTurnInstructionSettings;
  noteText?: string;
  noteFontSize?: number;
  groupTitle?: string;
};

export type AutoTurnInstructionKey =
  | 'character-rp'
  | 'character-phone'
  | 'narrator-rp'
  | 'narrator-phone';

type AutoTurnInstructionEntry = {
  mode: 'default' | 'custom';
  customText?: string;
};

export type AutoTurnInstructionSettings = Partial<Record<AutoTurnInstructionKey, AutoTurnInstructionEntry>>;

export type EventManagerPromptSettings = {
  mode: 'default' | 'custom';
  customText?: string;
};

export type HistoryRpTimePromptSettings = {
  mode: 'default' | 'custom';
  customText?: string;
};

export type OutputSpeakerResponseFormat = 'toon' | 'json';

export type OutputSpeakerPromptSettings = {
  mode: 'default' | 'custom';
  customText?: string;
};

type CoreWorkflowNodeCommonFields = WorkflowNodeCommonFields & {
  kind?: undefined;
  storedData?: undefined;
};

type InputNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'input' };
type NoteNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'note' };
type GroupNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'group' };
type CustomNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'custom' };
type LastUserInputNodeData = CoreWorkflowNodeCommonFields & {
  nodeType: 'last-user-input';
  includeRpDateTime?: boolean;
};
type LastRpOutputNodeData = CoreWorkflowNodeCommonFields & {
  nodeType: 'last-rp-output';
  includeRpDateTime?: boolean;
};
type EventManagerNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'event-manager' };
type HistoryNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'history' };
type MemorySlotNodeData = CoreWorkflowNodeCommonFields & {
  nodeType: 'memory-slot';
  memorySlotName: string;
  memorySlotText: string;
  memorySlotMode: 'joined' | 'input' | 'output';
};
type PhoneMessageRouterNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'phone-message-router' };
type TextSelectorNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'text-selector' };
type LlmPromptSwitchNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'llm-prompt-switch' };
type FixedNumberNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'fixed-number' };
type FixedBoolNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'fixed-bool' };
type SettingsValueNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'settings-value' };
type ContextCompressionNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'context-compression' };
type LoadTextNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'load-text' };
type WriteTextNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'write-text' };
type TextPreviewNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'text-preview' };
type ContextBuilderNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'context-builder' };
type LlmDecisionNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'llm-decision' };
type LlmPromptNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'llm-prompt' };
type CombinerNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'combiner' };
type CharacterStatsNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'character-stats' };
type OutputNodeData = CoreWorkflowNodeCommonFields & { nodeType: 'output' };
type RpStorybookV1NodeData = CoreWorkflowNodeCommonFields & { nodeType: 'rp-storybook-v1' };

type ConcreteCoreWorkflowNodeData =
  | InputNodeData
  | NoteNodeData
  | GroupNodeData
  | CustomNodeData
  | LastUserInputNodeData
  | LastRpOutputNodeData
  | EventManagerNodeData
  | HistoryNodeData
  | MemorySlotNodeData
  | PhoneMessageRouterNodeData
  | TextSelectorNodeData
  | LlmPromptSwitchNodeData
  | FixedNumberNodeData
  | FixedBoolNodeData
  | SettingsValueNodeData
  | ContextCompressionNodeData
  | LoadTextNodeData
  | WriteTextNodeData
  | TextPreviewNodeData
  | ContextBuilderNodeData
  | LlmDecisionNodeData
  | LlmPromptNodeData
  | CombinerNodeData
  | CharacterStatsNodeData
  | OutputNodeData
  | RpStorybookV1NodeData;

type MissingNodeWorkflowData = WorkflowNodeCommonFields & {
  nodeType: string;
  kind: 'missing-plugin-node';
  storedData: Record<string, unknown>;
  portsSnapshot: PortSnapshot[];
};

type IncompatibleCoreNodeWorkflowData = WorkflowNodeCommonFields & {
  nodeType: WorkflowNodeType;
  nodeDataVersion: NodeVersion;
  currentNodeVersion: NodeVersion;
  kind: 'incompatible-core-node';
  storedData: Record<string, unknown>;
};

export type WorkflowNodeData =
  | ConcreteCoreWorkflowNodeData
  | MissingNodeWorkflowData
  | IncompatibleCoreNodeWorkflowData;

export type WorkflowNode = Node<WorkflowNodeData>;

export type EmbeddedPhoneMessageLink = {
  phoneMessageId: number;
  from: string;
  to: string;
  message: string;
  translatedMessage?: string;
};

type OutputActionChoiceOption = {
  id?: string;
  label: string;
  value?: string;
  text?: string;
  player?: string;
  messageFormat?: number;
  turnMode?: number;
  mode?: 'submit' | 'state';
};

export type OutputActionChoiceGroup = {
  id?: string;
  kind: 'buttons';
  prompt?: string;
  columns?: number;
  text?: string;
  player?: string;
  messageFormat?: number;
  turnMode?: number;
  mode?: 'submit' | 'state';
  options: OutputActionChoiceOption[];
};

export type InputActionSelection = {
  source: 'outputAction';
  kind: 'buttons';
  messageId: number;
  groupId?: string;
  groupIndex: number;
  optionId?: string;
  optionIndex: number;
  prompt?: string;
  label: string;
  value?: string;
  text?: string;
  player?: string;
  messageFormat?: number;
  turnMode?: number;
  mode?: 'submit' | 'state';
};

export type OutputActionInfoBox = {
  title?: string;
  text: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
};

export type OutputActionProgressBar = {
  title: string;
  min: number;
  max: number;
  value: number;
  label?: string;
};

export type OutputActionContextCapacityBar = {
  id?: string;
  title: string;
  label?: string;
  nodeLabel?: string;
  maxTokens: number;
  replacedTokens: number;
  summaryTokens: number;
  activeTokens: number;
  replacedPercent: number;
  summaryPercent: number;
  activePercent: number;
  freePercent: number;
  showLegend: boolean;
};

export type MessageVoiceClip = {
  speakerName: string | null;
  text: string;
  dataUrl: string;
  filename?: string;
  source?: 'dialogue' | 'narration' | 'phone';
  createdAt?: string;
};

export type MessageRecord = {
  id: number;
  role: 'user' | 'output' | 'error';
  originalText: string;
  translatedText?: string;
  imageAttachments?: ChatImageAttachment[];
  includeInHistory?: boolean;
  channel?: 'rp' | 'phone';
  eventInput?: boolean;
  eventDisplayText?: string;
  phoneMessage?: boolean;
  phoneFrom?: string;
  phoneTo?: string;
  phoneVoiceMessage?: boolean;
  phoneAutoTurnSource?: 'narrator';
  embeddedPhoneMessages?: EmbeddedPhoneMessageLink[];
  embeddedPhoneTextBefore?: string;
  embeddedPhoneTextAfter?: string;
  embeddedPhoneTranslatedTextBefore?: string;
  embeddedPhoneTranslatedTextAfter?: string;
  phoneImageIds?: string[];
  phoneImageDescription?: string;
  phoneImageCaptionChange?: ImageCaptionChange;
  replyToMessageId?: number;
  inputMessageFormat?: number;
  inputPromptSlot?: number;
  rpImageDescription?: string;
  rpImageName?: string;
  outputActionChoices?: OutputActionChoiceGroup[];
  outputActionsHidden?: boolean;
  outputActionsHiddenByTurnId?: string;
  outputActionInfoBoxes?: OutputActionInfoBox[];
  outputActionProgressBars?: OutputActionProgressBar[];
  outputActionContextCapacityBars?: OutputActionContextCapacityBar[];
  isOpening?: boolean;
  speakerName?: string;
  speakerNames?: string[];
  speakerColors?: Record<string, string>;
  originalDialogue?: ChatDialogueQuote[];
  translatedDialogue?: ChatDialogueQuote[];
  turnContext?: TurnContext;
  turnId?: string;
  turnNumber?: number;
  turnPart?: 'input' | 'output';
  rpDateTime?: string;
  workflowVariableSetCommands?: WorkflowVariableSetCommand[];
  voiceClips?: MessageVoiceClip[];
};

export type RpAppointment = {
  id: string;
  scheduledAt?: string;
  title: string;
  condition?: string;
  details?: string;
  channel?: 'chat' | 'phone';
  phoneFrom?: string;
  phoneTo?: string;
  phoneRequester?: string;
  phoneMessenger?: string;
  phoneRecipient?: string;
  phoneAction?: string;
  requestedBy?: string;
  assignedTo?: string;
  sourceTurnId: string;
  sourceTurnNumber?: number;
  sourceNote?: string;
  status: 'upcoming' | 'completed' | 'cancelled';
};

export type SystemLogLevel = 'info' | 'warning' | 'error';

export type SystemLogEntry = {
  id: number;
  level: SystemLogLevel;
  text: string;
  createdAt: string;
};

export type ChatDialogueQuote = {
  speakerName: string;
  text: string;
};

export type TurnContext = {
  englishProcessingEnabled: boolean;
  inputTranslationOnlyEnabled?: boolean;
  displayLanguage: string;
};

export type TurnRecordMode = 'user' | 'auto-turn' | 'narrator';

export type TurnRuntimeNodeSnapshot = Record<string, unknown>;

export type TurnRuntimeSnapshot = {
  nodes: Record<string, TurnRuntimeNodeSnapshot>;
  workflowVariables?: Record<string, string>;
};

type TurnRecordPart = {
  graphText: string;
  messages: MessageRecord[];
};

export type TurnRecord = {
  id: string;
  number: number;
  createdAt: string;
  openingHistory?: boolean;
  mode?: TurnRecordMode;
  messageFormat?: number;
  promptSlot?: number;
  input: TurnRecordPart;
  output: TurnRecordPart;
};

export type SavedFileSummary = {
  fileName: string;
  name: string;
  updatedAt: string;
  type: 'workflow' | 'session' | 'storybook' | 'unknown';
  protection: 'plain' | 'encrypted' | 'unknown';
  envelopeFormatVersion?: string;
  formatVersion?: string;
  workflowFormatVersion?: string;
  latestTurnNumber?: number;
  compatible: boolean;
};

export type AppSettings = {
  format: 'rpgraph-settings';
  version: 1;
  connections: ConnectionPreset[];
  defaultConnectionId: string;
  options: {
    englishProcessingEnabled: boolean;
    inputTranslationOnlyEnabled?: boolean;
    displayLanguage: string;
    convertImagesToJpeg?: boolean;
    convertImagesToPng?: boolean;
    downscaleImages?: boolean;
    imageMaxMegapixels?: number;
    tokenEstimateBytesPerToken?: number;
    autoCalibrateTokenEstimate?: boolean;
    calibratedTokenBytesPerToken?: number;
    workflowSettingsValues?: Record<string, string>;
    promptActionCustomPresets?: PromptActionStoredConfig[];
    promptActionSettings?: PromptActionRuntimeSettings;
    promptTextCustomPresets?: Record<string, string>;
    chatTextSize?: number;
    phoneChatTextSize?: number;
    smoothChatAutoScrollEnabled?: boolean;
    smoothChatAutoScrollMinSpeed?: number;
    thoughtTextStyle?: 'bold' | 'italic' | 'light';
    rpDateTimeFormat?: RpDateTimeFormat;
    rpWeekdayLanguage?: RpWeekdayLanguage;
    showReferenceImagesInContext?: boolean;
    referenceImageTurnLookback?: number;
    maxReferenceImages?: number;
    glassDesignEnabled?: boolean;
    glassDesignOpacity?: number;
    nodeTextSize?: 'small' | 'normal' | 'big';
    uiScale?: number;
    retryFormatErrorsEnabled?: boolean;
    dialogueVoiceMode?: DialogueVoiceMode;
    dialogueNarratorProviderId?: string;
    dialogueCloneVoiceProviderId?: string;
  };
  layout?: {
    chatPanelWidth: number;
  };
};

export type AddNodeType = WorkflowNodeType;

export type NodeMenu = {
  screen: XYPosition;
  flow: XYPosition;
};

export type WorkflowFile = {
  format: 'rpgraph-workflow';
  formatVersion: WorkflowFormatVersion;
  savedAt: string;
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  nodes: WorkflowNode[];
  edges: Edge[];
};
