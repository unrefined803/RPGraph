import type { ComponentType } from 'react';
import type { Edge, Node, NodeProps, XYPosition } from '@xyflow/react';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import type { TextMetricsApi } from '../llm/tokenMetrics';
import type {
  ConnectionPreset,
  ChatImageAttachment,
  MessageRecord,
  TurnRecord,
  NodeLlmCallStats,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  SettingsValueDefinition,
  TextRouterMode,
  PortSnapshot,
  ProviderConnectionHealth,
  WorkflowNode,
} from '../types';
import type { PromptActionConfig, PromptActionRuntimeSettings } from './shared/promptActions';
import type { OutputFormatHelpKind } from './output/formatHelp';
import type { NodeVersion } from './nodeVersion';
import type { EventEntity } from '../data-management/types';
import type { WorkflowVariableSetCommand } from '../workflow/variables';
import type { ReferenceImageOptions } from '../chat/referenceImages';
import type { CoreNodeType } from './coreNodeTypes';

export type { CoreNodeType } from './coreNodeTypes';

export type NodeTypeId = string;

export type SharedNodeData<TType extends NodeTypeId = NodeTypeId> = {
  nodeType: TType;
  label: string;
  description: string;
  preview: string;
  runActive?: boolean;
  runVisionActive?: boolean;
  runCompleted?: boolean;
  runPrepared?: boolean;
  runError?: string;
  displayTokenBytesPerToken?: number;
  llmCallStats?: NodeLlmCallStats[];
};

export type PortDefinition = PortSnapshot;

export type StoredNodeData<TType extends NodeTypeId, TConfig extends object> = {
  nodeType: TType;
  nodeDataVersion: NodeVersion;
  portsSnapshot?: PortDefinition[];
  label: string;
  description: string;
  preview: string;
} & TConfig;

export type CreateNodeContext = {
  defaultConnectionId: string;
  position: XYPosition;
  createId: (prefix: string) => string;
  readNodes: () => WorkflowNode[];
  originalHistory: string;
  translatedHistory: string;
};

export type HydrateContext = {
  defaultConnectionId: string;
  connectionIds: Set<string>;
};

export type ExecuteTraceNodeInfo = {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
};

export type ExecuteTraceFormatResult = {
  name: string;
  status: 'ok' | 'error' | 'skipped';
  detail?: string;
  preview?: string;
};

export type ExecuteContext<TLlm = NodeLlmApi, TTextMetrics = TextMetricsApi> = {
  phase: 'response' | 'prepare-next-turn';
  nodes: WorkflowNode[];
  edges: Edge[];
  originalInput: string;
  visibleInput: string;
  lastRpOutput: string;
  inputImages: ChatImageAttachment[];
  phoneMessage: boolean;
  messageFormat?: number;
  promptSlot: number;
  originalHistory: string;
  translatedHistory: string;
  historyMessages: MessageRecord[];
  recentTurns: TurnRecord[];
  currentTurnId?: string;
  userControlledCharacterId?: string;
  outputNodeId: string;
  sourceHandle?: string | null;
  directActionOnly?: boolean;
  streamOutput?: (text: string) => void;
  llm: TLlm;
  textMetrics: TTextMetrics;
  settingsValues: Record<string, string>;
  settingsValueDefinitions: SettingsValueDefinition[];
  promptActionSettings: PromptActionRuntimeSettings;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  referenceImages: ReferenceImageOptions;
  retryFormatErrorsEnabled: boolean;
  runScratch: Map<string, unknown>;
  comfyProviderIds: string[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  executeInput: (nodeId: string, sourceHandle?: string | null) => Promise<string>;
  updateHistoryMessageTimes: (patches: Array<{ id: number; rpDateTime: string }>) => void;
  updateRuntimeData: (nodeId: string, patch: Partial<WorkflowNode['data']>) => void;
  updateEventEntities: (
    nodeId: string,
    events: Record<string, EventEntity>,
    status?: string,
  ) => void;
  updateRuntimePortValue: (
    nodeId: string,
    direction: 'input' | 'output',
    handle: string | null | undefined,
    value: string,
  ) => void;
  setWorkflowVariables: (commands: WorkflowVariableSetCommand[]) => void;
  reportWarning: (message: string) => void;
  reportFormatResult: (result: ExecuteTraceFormatResult) => void;
  blockPostOutput: (message: string) => never;
};

export type NodeCardProps<TData extends SharedNodeData = SharedNodeData> = {
  id: string;
  data: TData;
  selected?: boolean;
};

export type NodeDefinition<
  TType extends NodeTypeId,
  TConfig extends object,
  TData extends SharedNodeData<TType> & TConfig,
> = {
  type: TType;
  dataVersion: NodeVersion;
  label: string;
  description: string;
  origin: 'core' | 'plugin';
  singleton?: boolean;
  usesLlm?: boolean;
  contributesToTokenCalibration?: boolean;
  requiresPostOutputPermission?: boolean;
  passiveRuntime?: boolean;
  requiresPreparedInputEdge?: boolean;
  hydrateStyle?: (node: Node<TData>) => Node<TData>['style'];
  ports: (data: TData) => PortDefinition[];
  create: (context: CreateNodeContext) => Node<TData>;
  Component: ComponentType<NodeCardProps<TData>>;
  execute: (node: Node<TData>, context: ExecuteContext) => Promise<string>;
  saveData: (data: TData) => StoredNodeData<TType, TConfig>;
  hydrateData: (data: StoredNodeData<TType, TConfig>, context: HydrateContext) => TData;
  migrateStoredData?: (data: Record<string, unknown>) => Record<string, unknown>;
  validateStoredData: (
    data: Record<string, unknown>,
  ) => data is StoredNodeData<TType, TConfig>;
};

export type AnyNodeDefinition = NodeDefinition<
  string,
  Record<string, unknown>,
  SharedNodeData<string> & Record<string, unknown>
>;

export type NodeCreationDefinition = {
  type: NodeTypeId;
  dataVersion: NodeVersion;
  label: string;
  description: string;
  menuDescription: string;
  origin: 'core' | 'plugin';
  singleton?: boolean;
  usesLlm?: boolean;
  contributesToTokenCalibration?: boolean;
  requiresPostOutputPermission?: boolean;
  passiveRuntime?: boolean;
  requiresPreparedInputEdge?: boolean;
  hydrateStyle?: (node: WorkflowNode) => WorkflowNode['style'];
  ports: (data: WorkflowNode['data']) => PortDefinition[];
  create: (context: CreateNodeContext) => WorkflowNode;
  Component: ComponentType<NodeProps<WorkflowNode>>;
  execute: (node: WorkflowNode, context: ExecuteContext) => Promise<string>;
  saveData: (data: WorkflowNode['data']) => WorkflowNode['data'];
  hydrateData: (data: WorkflowNode['data'], context: HydrateContext) => WorkflowNode['data'];
};

export type CoreNodeCreationDefinition = NodeCreationDefinition & {
  type: CoreNodeType;
  origin: 'core';
};

export type MissingNodeData = SharedNodeData & {
  kind: 'missing-plugin-node';
  storedData: Record<string, unknown>;
  portsSnapshot: PortDefinition[];
};

export type IncompatibleCoreNodeData = SharedNodeData<CoreNodeType> & {
  kind: 'incompatible-core-node';
  nodeDataVersion: NodeVersion;
  currentNodeVersion: NodeVersion;
  storedData: Record<string, unknown>;
};

export type NodeActions = {
  updateData: (nodeId: string, patch: Record<string, unknown>) => void;
  changeConnection: (nodeId: string, value: string) => void;
  changeOutputOption: (
    nodeId: string,
    field: 'streamOutputEnabled' | 'speakerAnalysisEnabled' | 'dialogueHighlightEnabled',
    value: boolean,
  ) => void;
  changeFixedNumberValue: (nodeId: string, value: number | string) => void;
  changeFixedBoolValue: (nodeId: string, value: boolean) => void;
  changeWriteTextValue: (nodeId: string, value: string) => void;
  changeTextRouterMode: (nodeId: string, mode: TextRouterMode) => void;
  changeTextRouterNumberOutputCount: (nodeId: string, change: number) => void;
  changeTextSelectorMode: (nodeId: string, mode: TextRouterMode) => void;
  changeTextSelectorInputCount: (nodeId: string, change: number) => void;
  textPreview: (nodeId: string, text?: string) => void;
  showJson: (nodeId: string) => void;
  showCharacterStatsContext: (nodeId: string) => void;
  showCharacterStatsResponse: (nodeId: string) => void;
  showCharacterStatsPrompts: (nodeId: string) => void;
  showCharacterStatsChart: (nodeId: string) => void;
  showHistoryTimeResponse: (nodeId: string) => void;
  showEventManagerResponse: (nodeId: string) => void;
  showEventManagerAppointments: (nodeId: string) => void;
  showOutputHighlighting: (nodeId: string) => void;
  showOutputFormatHelp: (kind: OutputFormatHelpKind) => void;
  openStorybookCreator: (nodeId: string) => void;
  openStorybookEditor: (nodeId: string) => void;
  upgradeNode: (nodeId: string) => void;
  openCustomNodeAssistant: (nodeId: string) => void;
  runCustomNodeButton: (nodeId: string, label: string) => Promise<void>;
  loadStorybookFile: (nodeId: string) => Promise<boolean>;
  importSillyTavernCharacter: (nodeId: string) => Promise<void>;
  loadTextFile: (nodeId: string) => Promise<void>;
  loadContextBuilder: (nodeId: string) => Promise<void>;
  toggleContextBuilderItem: (nodeId: string, itemId: string, enabled: boolean) => void;
  reorderContextBuilderItem: (
    nodeId: string,
    draggedId: string,
    targetId: string,
    placement: 'before' | 'after',
  ) => void;
  changeCombinerPrefix: (nodeId: string, index: number, value: string) => void;
  changeCombinerInputCount: (nodeId: string, change: number) => void;
  addTextReplaceEntry: (nodeId: string) => void;
  removeTextReplaceEntry: (nodeId: string, entryId: string) => void;
  changeTextReplaceEntry: (
    nodeId: string,
    entryId: string,
    field: 'source' | 'replacement',
    value: string,
  ) => void;
  changeLlmDecisionQuestionCount: (nodeId: string, change: number) => void;
  changeLlmDecisionQuestion: (nodeId: string, index: number, value: string) => void;
  changeLlmDecisionOutput: (
    nodeId: string,
    index: number,
    field: 'bool' | 'text' | 'number',
    value: boolean,
  ) => void;
  removeLlmPromptSwitchOutputChannel: (nodeId: string, index: number) => void;
  addSettingsValue: (nodeId: string) => void;
  removeSettingsValue: (nodeId: string, entryId: string) => void;
  changeSettingsValueSelection: (nodeId: string, entryId: string, optionKey: string) => void;
  changeSettingsValueLabel: (nodeId: string, entryId: string, label: string) => void;
  clearCharacterStatsState: (nodeId: string) => void;
  clearHistoryTimeState: (nodeId: string) => void;
};

export type NodeViewValues = {
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  onCheckProviderConnection?: (connectionId: string) => void;
  estimatedTokenBytesPerToken: number;
  settingsValueDefinitions: SettingsValueDefinition[];
  settingsValues: Record<string, string>;
  promptActionCustomPresets: PromptActionConfig[];
  setPromptActionCustomPresets: (updater: (current: PromptActionConfig[]) => PromptActionConfig[]) => void;
  promptActionSettings: PromptActionRuntimeSettings;
  setPromptActionSettings: (updater: (current: PromptActionRuntimeSettings) => PromptActionRuntimeSettings) => void;
  promptTextCustomPresets: Record<string, string>;
  setPromptTextCustomPresets: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  nodes: WorkflowNode[];
  edges: Edge[];
};
