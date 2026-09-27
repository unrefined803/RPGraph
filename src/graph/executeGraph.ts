import type { TurnTraceNodeExecution } from '../app/turnTrace';
import { sanitizeDataUrlsInText } from '../utils/sanitize';
import type { Edge } from '@xyflow/react';
import { NodeLlmApi } from '../llm/NodeLlmApi';
import { PromptTokenCalibration, TextMetricsApi } from '../llm/tokenMetrics';
import { getRegisteredNode } from '../nodes/registry';
import { appointmentsFromEventEntities } from '../data-management/eventStore';
import type { EventEntity } from '../data-management/types';
import { runtimePortValueKey } from '../nodes/shared/portRuntime';
import { wireLinkName } from '../nodes/memory-slot/model';
import { customNodeDefinition } from '../nodes/custom-node/model';
import { isComfyImageConnection } from '../comfy/connectionRole';
import type {
  ChatImageAttachment,
  ConnectionPreset,
  MessageRecord,
  TurnRecord,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  ProviderConnectionHealth,
  SettingsValueDefinition,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';
import type { PromptActionRuntimeSettings } from '../nodes/shared/promptActions';
import type { WorkflowVariableSetCommand } from '../workflow/variables';
import { workflowVariableValueKind } from '../workflow/variables';
import type { ReferenceImageOptions } from '../chat/referenceImages';
import type { ExecuteTraceFormatResult, ExecuteTraceNodeInfo } from '../nodes/types';
import { runScratchKeys } from '../nodes/runScratch';
import { createComfyImageRunner } from './comfyImageRunner';

type ExecuteGraphOptions = {
  outputNodeId: string;
  outputSourceHandle?: string | null;
  nodes: WorkflowNode[];
  edges: Edge[];
  originalInput: string;
  visibleInput?: string;
  lastRpOutput?: string;
  inputImages?: ChatImageAttachment[];
  phoneMessage?: boolean;
  messageFormat?: number;
  promptSlot?: number;
  originalHistory: string;
  translatedHistory: string;
  historyMessages?: MessageRecord[];
  recentTurns?: TurnRecord[];
  currentTurnId?: string;
  updateHistoryMessageTimes?: (patches: Array<{ id: number; rpDateTime: string }>) => void;
  userControlledCharacterId?: string;
  appCharacters?: import('../storybook/runtime').StorybookCharacter[];
  matchMeDirectMessage?: import('../types').SocialDirectMessageRecord;
  llm: NodeLlmApi;
  textMetrics: TextMetricsApi;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  updateEventEntities?: (
    nodeId: string,
    events: Record<string, EventEntity>,
    status?: string,
  ) => void;
  streamOutput?: (text: string) => void;
  trackRunCompletion?: boolean;
  postOutputRun?: boolean;
  postOutputNodeIds?: string[];
  autoCalibrateTokenEstimate?: boolean;
  onTokenEstimateCalibrated?: (bytesPerToken: number) => void;
  settingsValues?: Record<string, string>;
  settingsValueDefinitions?: SettingsValueDefinition[];
  promptActionSettings?: PromptActionRuntimeSettings;
  onWorkflowVariablesSet?: (commands: WorkflowVariableSetCommand[]) => void;
  rpDateTimeFormat?: RpDateTimeFormat;
  rpWeekdayLanguage?: RpWeekdayLanguage;
  referenceImages?: ReferenceImageOptions;
  retryFormatErrorsEnabled?: boolean;
  connections?: ConnectionPreset[];
  providerHealthById?: Record<string, ProviderConnectionHealth>;
  auxiliaryOutputHandles?: string[];
  onAuxiliaryOutput?: (handle: string, text: string) => void;
  onNodeExecution?: (event: TurnTraceNodeExecution) => void;
  onWarning?: (message: string, node?: ExecuteTraceNodeInfo) => void;
  onFormatResult?: (result: ExecuteTraceFormatResult & ExecuteTraceNodeInfo) => void;
  onComfyGenerationActive?: (active: boolean) => void;
  signal?: AbortSignal;
};

class PostOutputNodeBlockedError extends Error {}

class NodeExecutionError extends Error {
  node: ExecuteTraceNodeInfo;
  originalError: unknown;

  constructor(message: string, node: ExecuteTraceNodeInfo, cause: unknown) {
    super(message);
    this.name = 'NodeExecutionError';
    this.node = node;
    this.originalError = cause;
  }
}

function executionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('The graph run was cancelled.');
  }
}

export { resolveCreateImageCharacterByName } from './comfyImageRunner';

function withoutPromptPreviewFields(patch: Partial<WorkflowNodeData>) {
  const next = { ...patch };
  delete next.preview;
  delete next.generatedText;
  delete next.fullText;
  delete next.displayTokenBytesPerToken;
  delete next.llmPromptDebug;
  delete next.llmPromptSwitchDebug;
  delete next.llmPromptSwitchSelectedOutputChannel;
  delete next.llmPromptSwitchSelectedPromptSlot;
  delete next.llmCallStats;
  return next;
}

function memorySlotKey(name: string) {
  return name.trim().toLocaleLowerCase();
}

export async function executeGraph({
  outputNodeId,
  outputSourceHandle,
  nodes,
  edges,
  originalInput,
  visibleInput = originalInput,
  lastRpOutput = '',
  inputImages = [],
  phoneMessage = false,
  messageFormat,
  promptSlot = 0,
  originalHistory,
  translatedHistory,
  historyMessages = [],
  recentTurns = [],
  currentTurnId,
  updateHistoryMessageTimes = () => {},
  userControlledCharacterId,
  appCharacters,
  matchMeDirectMessage,
  llm,
  textMetrics,
  updateRuntimeNode,
  updateEventEntities,
  streamOutput,
  trackRunCompletion = false,
  postOutputRun = false,
  postOutputNodeIds,
  autoCalibrateTokenEstimate = false,
  onTokenEstimateCalibrated,
  settingsValues = {},
  settingsValueDefinitions = [],
  promptActionSettings = {},
  onWorkflowVariablesSet,
  rpDateTimeFormat = 'eu',
  rpWeekdayLanguage = 'system',
  referenceImages = { enabled: true, turnLookback: 10, maxImages: 3 },
  retryFormatErrorsEnabled = true,
  connections = [],
  providerHealthById = {},
  auxiliaryOutputHandles = [],
  onAuxiliaryOutput,
  onNodeExecution,
  onWarning = () => {},
  onFormatResult = () => {},
  onComfyGenerationActive,
  signal,
}: ExecuteGraphOptions) {
  let runtimeHistoryMessages = historyMessages;
  const runtimeSettingsValues = { ...settingsValues };
  const runtimeSettingsValueDefinitions = [...settingsValueDefinitions];
  const memo = new Map<string, Promise<string>>();
  const runScratch = new Map<string, unknown>();
  runScratch.set(runScratchKeys.characterStatsMemo, new Map());
  runScratch.set(runScratchKeys.historyMemo, new Map());
  runScratch.set(runScratchKeys.llmDecisionMemo, new Map());
  runScratch.set(runScratchKeys.llmPromptSwitchMemo, new Map());
  runScratch.set(
    runScratchKeys.memorySlotValues,
    new Map(
      nodes.flatMap((node) =>
        node.data.nodeType === 'memory-slot' && node.data.memorySlotText !== undefined
          ? [[memorySlotKey(wireLinkName(node.data)), node.data.memorySlotText] as const]
          : [],
      ),
    ),
  );
  // Track active waits, including dependencies reached after an await or from
  // another parallel branch, before reusing an in-flight result.
  const dependencies = new Map<string, Set<string>>();
  const dependsOn = (key: string, target: string, visited = new Set<string>()): boolean => {
    if (key === target) return true;
    if (visited.has(key)) return false;
    visited.add(key);
    return [...(dependencies.get(key) ?? [])].some((next) => dependsOn(next, target, visited));
  };
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const runtimePortValues = new Map<string, Record<string, string>>(
    nodes.map((node) => [node.id, { ...(node.data.runtimePortValues ?? {}) }]),
  );
  const calibration = new PromptTokenCalibration(autoCalibrateTokenEstimate);
  const isLlmNode = (nodeId: string) => {
    const node = nodeById.get(nodeId);
    if (!node || node.data.kind !== undefined) {
      return false;
    }
    return getRegisteredNode(node.data.nodeType)?.usesLlm ?? false;
  };
  const graphLlm = llm
    .withCalibrationSamples(({ prompt, stats }) => {
      calibration.addAuthorizedPromptSample(prompt, stats);
    })
    .withCallLifecycle(
      (nodeId, metadata) => {
        if (isLlmNode(nodeId)) {
          updateRuntimeNode(nodeId, {
            runActive: true,
            runVisionActive: metadata.hasImages,
            llmActiveCallLabel: metadata.label,
            llmActiveCallStage: metadata.stage,
            llmActiveCallStartedAtMs: metadata.startedAtMs,
            llmActiveReasoningTokens: undefined,
          });
        }
      },
      (nodeId) => {
        if (isLlmNode(nodeId)) {
          updateRuntimeNode(nodeId, {
            runVisionActive: false,
            llmActiveCallLabel: undefined,
            llmActiveCallStage: undefined,
            llmActiveCallStartedAtMs: undefined,
            llmActiveReasoningTokens: undefined,
          });
        }
      },
      (nodeId, tokenCount) => {
        if (isLlmNode(nodeId)) {
          updateRuntimeNode(nodeId, { llmActiveReasoningTokens: tokenCount });
        }
      },
    );

  const updateRuntimePortValue = (
    nodeId: string,
    direction: 'input' | 'output',
    handle: string | null | undefined,
    value: string,
  ) => {
    const nextValues = {
      ...(runtimePortValues.get(nodeId) ?? {}),
      [runtimePortValueKey(direction, handle ?? 'default')]: value,
    };
    runtimePortValues.set(nodeId, nextValues);
    updateRuntimeNode(nodeId, { runtimePortValues: nextValues });
  };

  const findRuntimeSettingsDefinition = (name: string) => {
    const normalized = name.trim().toLocaleLowerCase();
    return runtimeSettingsValueDefinitions.find(
      (definition) =>
        definition.key.toLocaleLowerCase() === normalized ||
        definition.label.toLocaleLowerCase() === normalized,
    );
  };

  const setWorkflowVariables = (commands: WorkflowVariableSetCommand[]) => {
    const validCommands = commands.filter((command) => command.name.trim());
    if (validCommands.length === 0) {
      return;
    }
    validCommands.forEach((command) => {
      const name = command.name.trim();
      const existingDefinition = findRuntimeSettingsDefinition(name);
      const key = existingDefinition?.key ?? name;
      runtimeSettingsValues[key] = command.value;
      if (existingDefinition) {
        existingDefinition.valueKind = workflowVariableValueKind(command.value);
      } else {
        runtimeSettingsValueDefinitions.push({
          key,
          label: name,
          enabled: true,
          valueKind: workflowVariableValueKind(command.value),
          used: false,
          usedAsNumber: false,
        });
      }
    });
    onWorkflowVariablesSet?.(validCommands);
  };

  const createComfyImageForCharacter = createComfyImageRunner({
    getNodes: () => nodes,
    connections,
    providerHealthById,
    llm: graphLlm,
    updateRuntimeNode,
    onComfyGenerationActive,
    signal,
  });
  runScratch.set(runScratchKeys.createComfyImageForCharacter, createComfyImageForCharacter);

  // Custom outputs share one execution, so their waits share one identity too.
  const dependencyKey = (nodeId: string, handle?: string | null) =>
    `${nodeId}:${nodeById.get(nodeId)?.data.nodeType === 'custom' ? 'default' : handle ?? 'default'}`;

  const executeNode = async (nodeId: string, sourceHandle?: string | null): Promise<string> => {
    throwIfAborted(signal);
    const executionKey = `${nodeId}:${sourceHandle ?? 'default'}`;
    const waitKey = dependencyKey(nodeId, sourceHandle);
    const memoized = memo.get(executionKey);
    if (memoized) {
      return memoized;
    }
    const shouldTrackRunState = (node: WorkflowNode) =>
      trackRunCompletion && !(postOutputRun && node.data.kind === undefined && node.data.nodeType === 'input');

    const traceNode = nodeById.get(nodeId);
    const preparedAtStart = traceNode?.data.runPrepared;
    const reportExecution = (status: TurnTraceNodeExecution['status'], output?: string, error?: string) => {
      onNodeExecution?.({
        nodeId, nodeLabel: traceNode?.data.label ?? nodeId, nodeType: traceNode?.data.nodeType,
        sourceHandle, phase: postOutputRun ? 'prepare-next-turn' : 'response',
        status, at: new Date().toISOString(), atMs: performance.now(), preparedAtStart,
        output: output === undefined ? undefined : sanitizeDataUrlsInText(output),
        error: error === undefined ? undefined : sanitizeDataUrlsInText(error),
      });
    };
    const promise = (async () => {
      reportExecution('started');
      try {
        throwIfAborted(signal);
        let traceNodeInfo: ExecuteTraceNodeInfo | undefined;
        const result = await (async () => {
          const node = nodeById.get(nodeId);
          if (!node) {
            throw new Error('A connected node no longer exists.');
          }
          traceNodeInfo = {
            nodeId: node.id,
            nodeLabel: node.data.label,
            nodeType: node.data.nodeType,
          };
          const currentTraceNodeInfo = traceNodeInfo;
          if (node.data.kind === 'missing-plugin-node') {
            throw new Error(`Cannot execute missing plugin node: ${node.data.nodeType}.`);
          }
          if (node.data.kind === 'incompatible-core-node') {
            throw new Error(`Cannot execute incompatible core node: ${node.data.nodeType}.`);
          }
          const definition = getRegisteredNode(node.data.nodeType);
          if (!definition) {
            throw new Error(`Cannot execute unknown node type: ${node.data.nodeType}.`);
          }
          const trackNodeRunState = shouldTrackRunState(node);
          if (postOutputRun && node.data.nodeType === 'output') {
            throw new PostOutputNodeBlockedError('RP Output does not run during next-turn preparation.');
          }
          if (
            postOutputRun &&
            definition.requiresPostOutputPermission &&
            !node.data.runAfterRpOutput
          ) {
            throw new PostOutputNodeBlockedError(
              `${node.data.label} needs permission to run after RP output.`,
            );
          }
          if (trackNodeRunState) {
            updateRuntimeNode(nodeId, {
              runActive: true,
              runActiveStartedAtMs: performance.now(),
              runCompleted: false,
              runPrepared: postOutputRun,
              runError: undefined,
            });
          }
          return definition.execute(node, {
            phase: postOutputRun ? 'prepare-next-turn' : 'response',
            nodes,
            edges,
            originalInput,
            visibleInput,
            lastRpOutput,
            inputImages,
            phoneMessage,
            messageFormat,
            promptSlot,
            originalHistory,
            translatedHistory,
            historyMessages: runtimeHistoryMessages,
            recentTurns,
            currentTurnId,
            userControlledCharacterId,
            appCharacters,
            matchMeDirectMessage,
            outputNodeId,
            sourceHandle,
            directActionOnly: outputSourceHandle === 'direct-actions',
            streamOutput,
            llm: graphLlm,
            textMetrics,
            settingsValues: runtimeSettingsValues,
            settingsValueDefinitions: runtimeSettingsValueDefinitions,
            promptActionSettings,
            rpDateTimeFormat,
            rpWeekdayLanguage,
            referenceImages,
            retryFormatErrorsEnabled,
            runScratch,
            comfyProviderIds: connections
              .filter(isComfyImageConnection)
              .map((connection) => connection.id),
            providerHealthById,
            executeInput: async (sourceNodeId, sourceHandle) => {
              const inputKey = dependencyKey(sourceNodeId, sourceHandle);
              if (dependsOn(inputKey, waitKey)) {
                throw new Error('The graph contains a cycle.');
              }
              const waits = dependencies.get(waitKey) ?? new Set<string>();
              dependencies.set(waitKey, waits);
              waits.add(inputKey);
              let inputValue: string;
              try {
                inputValue = await executeNode(sourceNodeId, sourceHandle);
              } finally {
                waits.delete(inputKey);
              }
              edges
                .filter(
                  (edge) =>
                    edge.target === node.id &&
                    edge.source === sourceNodeId &&
                    (edge.sourceHandle ?? 'default') === (sourceHandle ?? 'default'),
                )
                .forEach((edge) =>
                  updateRuntimePortValue(node.id, 'input', edge.targetHandle ?? 'default', inputValue),
                );
              return inputValue;
            },
            updateHistoryMessageTimes: (patches) => {
              const rpDateTimeById = new Map(patches.map((patch) => [patch.id, patch.rpDateTime]));
              runtimeHistoryMessages = runtimeHistoryMessages.map((message) => {
                const rpDateTime = rpDateTimeById.get(message.id);
                return rpDateTime ? { ...message, rpDateTime } : message;
              });
              updateHistoryMessageTimes(patches);
            },
            updateRuntimeData: (patchNodeId, patch) => {
              if (
                postOutputRun &&
                patchNodeId === node.id &&
                (node.data.nodeType === 'llm-prompt' || node.data.nodeType === 'llm-prompt-switch')
              ) {
                const visibleRunPatch = withoutPromptPreviewFields(patch);
                if (Object.keys(visibleRunPatch).length > 0) {
                  updateRuntimeNode(patchNodeId, visibleRunPatch);
                }
                return;
              }
              updateRuntimeNode(patchNodeId, patch);
            },
            updateEventEntities: (nodeId, events, status) => {
              updateEventEntities?.(nodeId, events, status);
              updateRuntimeNode(nodeId, {
                eventAppointments: appointmentsFromEventEntities(events),
                ...(status ? { eventStatus: status } : {}),
              });
            },
            updateRuntimePortValue,
            setWorkflowVariables,
            reportWarning: (message) => onWarning(message, currentTraceNodeInfo),
            reportFormatResult: (result) => onFormatResult({ ...currentTraceNodeInfo, ...result }),
            blockPostOutput: (message) => {
              throw new PostOutputNodeBlockedError(message);
            },
          });
        })().catch((error) => {
          if (error instanceof PostOutputNodeBlockedError || error instanceof NodeExecutionError) {
            throw error;
          }
          if (signal?.aborted) {
            throw error;
          }
          if (traceNodeInfo) {
            const message = executionErrorMessage(error);
            updateRuntimeNode(traceNodeInfo.nodeId, {
              runActive: false,
              runActiveStartedAtMs: undefined,
              llmActiveCallLabel: undefined,
              llmActiveCallStage: undefined,
              llmActiveCallStartedAtMs: undefined,
              runCompleted: false,
              runPrepared: false,
              runError: message,
            });
            throw new NodeExecutionError(message, traceNodeInfo, error);
          }
          throw error;
        });
        throwIfAborted(signal);
        const node = nodeById.get(nodeId);
        if (node && shouldTrackRunState(node)) {
          updateRuntimeNode(
            nodeId,
            postOutputRun
              ? { runActive: false, runCompleted: false, runPrepared: true, runError: undefined }
              : { runActive: false, runCompleted: true, runPrepared: false, runError: undefined },
          );
        }
        updateRuntimePortValue(nodeId, 'output', sourceHandle ?? 'default', result);
        reportExecution('completed', result);
        return result;
      } catch (error) {
        reportExecution(signal?.aborted ? 'cancelled' : error instanceof PostOutputNodeBlockedError ? 'blocked' : 'error',
          undefined, executionErrorMessage(error));
        throw error;
      } finally {
        const node = nodeById.get(nodeId);
        if (node && shouldTrackRunState(node)) {
          updateRuntimeNode(nodeId, {
            runActive: false,
            runActiveStartedAtMs: undefined,
            llmActiveCallLabel: undefined,
            llmActiveCallStage: undefined,
            llmActiveCallStartedAtMs: undefined,
          });
        }
        dependencies.delete(waitKey);
      }
    })();

    memo.set(executionKey, promise);
    return promise;
  };

  if (postOutputRun) {
    throwIfAborted(signal);
    const postOutputIds = postOutputNodeIds ?? [];
    const historyNodeIds = postOutputIds.filter((nodeId) => {
      const node = nodeById.get(nodeId);
      return !!node && node.data.kind === undefined && node.data.nodeType === 'history';
    });
    const remainingNodeIds = postOutputIds.filter((nodeId) => !historyNodeIds.includes(nodeId));
    const prepareNode = async (nodeId: string) => {
      try {
        await executeNode(nodeId);
      } catch (error) {
        if (!(error instanceof PostOutputNodeBlockedError)) {
          throw error;
        }
      }
    };
    await Promise.all(historyNodeIds.map(prepareNode));
    await Promise.all(
      remainingNodeIds.map(prepareNode),
    );
    return '';
  }

  const output = await executeNode(outputNodeId, outputSourceHandle);
  throwIfAborted(signal);
  for (const handle of auxiliaryOutputHandles) {
    throwIfAborted(signal);
    onAuxiliaryOutput?.(handle, await executeNode(outputNodeId, handle));
  }
  const isRpOutputRun = nodeById.get(outputNodeId)?.data.nodeType === 'output';
  if (isRpOutputRun) {
    await Promise.all(
      nodes
        .filter(
          (node) =>
            (
              node.data.nodeType === 'text-preview' ||
              node.data.nodeType === 'memory-slot' ||
              (
                node.data.nodeType === 'custom' &&
                customNodeDefinition(node.data.customNodeDefinition).outputs.length === 0
              )
            ) &&
            edges.some((edge) => edge.target === node.id),
        )
        .map((node) => executeNode(node.id)),
    );
  }
  const calibratedBytesPerToken = calibration.result();
  if (calibratedBytesPerToken !== undefined) {
    onTokenEstimateCalibrated?.(calibratedBytesPerToken);
    nodes.forEach((entry) =>
      updateRuntimeNode(entry.id, {
        displayTokenBytesPerToken: calibratedBytesPerToken,
      }),
    );
  }
  return output;
}
