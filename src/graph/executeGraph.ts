import type { Edge } from '@xyflow/react';
import { NodeLlmApi } from '../llm/NodeLlmApi';
import { PromptTokenCalibration, TextMetricsApi } from '../llm/tokenMetrics';
import { getRegisteredNode } from '../nodes/registry';
import { appointmentsFromEventEntities } from '../data-management/eventStore';
import type { EventEntity } from '../data-management/types';
import { runtimePortValueKey } from '../nodes/shared/portRuntime';
import { wireLinkName } from '../nodes/memory-slot/model';
import { customNodeDefinition } from '../nodes/custom-node/model';
import {
  parseRpStorybookJson,
  rpStorybookJsonText,
} from '../nodes/rp-storybook-v1/model';
import {
  defaultComfyCheckpointName,
  defaultComfyDiffusionModelName,
  defaultComfyHeight,
  defaultComfyLoraSlots,
  defaultComfyTextEncoderName,
  defaultComfyVaeName,
  defaultComfyWidth,
  defaultComfyWorkflowPath,
  comfySetupRequiredMessage,
  characterComfyLoraSlots,
  missingComfySetupFields,
} from '../settings';
import {
  isLmStudioConnection,
  isLocalProviderConnection,
  isOllamaConnection,
} from '../llm/providerKind';
import { isComfyImageConnection } from '../comfy/connectionRole';
import { withImagesEnsuredForStorybookCharacter } from '../storybook/imageLibrary';
import { storybookCreateImageCharactersFromNodes } from '../storybook/runtime';
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
import {
  runScratchKeys,
  type CreateComfyImageForCharacterRunner,
} from '../nodes/runScratch';
import { encodedDataUrlBytes, normalizeImageAttachment } from '../utils/imageNormalization';

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
  const resolving = new Set<string>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  // nodeById is a run-start snapshot; storybook JSON written during this run
  // must be read from here or a second image generation drops the first one.
  const runStorybookJsonByNodeId = new Map<string, string>();
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
          updateRuntimeNode(nodeId, { runActive: true, runVisionActive: metadata.hasImages });
        }
      },
      (nodeId) => {
        if (isLlmNode(nodeId)) {
          updateRuntimeNode(nodeId, { runActive: false, runVisionActive: false });
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

  const workflowConnectionIds = () =>
    new Set(
      nodes
        .map((node) => node.data.connectionId)
        .filter((connectionId): connectionId is string => !!connectionId),
    );

  const unloadLocalLlmModelsBeforeComfy = async (
    warn: (message: string) => void,
    llmConnectionId?: string,
  ) => {
    const activeConnectionIds = workflowConnectionIds();
    if (llmConnectionId) {
      activeConnectionIds.add(llmConnectionId);
    }
    await Promise.all(
      connections
        .filter((connection) =>
          activeConnectionIds.has(connection.id) &&
          isLocalProviderConnection(connection) &&
          (isLmStudioConnection(connection) || isOllamaConnection(connection)),
        )
        .map(async (connection) => {
          try {
            if (isLmStudioConnection(connection)) {
              await window.rpgraph.unloadLmStudioModels(connection);
              return;
            }
            await window.rpgraph.unloadOllamaModels(connection);
          } catch (error) {
            warn(`${connection.label} unload before ComfyUI generation failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }),
    );
  };

  const dataUrlMimeType = (dataUrl: string) => {
    const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
    return match?.[1] || 'image/png';
  };

  const createComfyImageForCharacter: CreateComfyImageForCharacterRunner = async (request, warn) => {
    const characterName = request.characterName.trim();
    const prompt = request.prompt.trim();
    if (!characterName || !prompt) {
      throw new Error('Create character phone image action requires a character and prompt.');
    }

    const character = storybookCreateImageCharactersFromNodes(nodes).find((entry) => {
      const left = entry.name.trim().toLocaleLowerCase();
      const right = characterName.toLocaleLowerCase();
      return left === right || left.split(/\s+/)[0] === right.split(/\s+/)[0];
    });
    if (!character) {
      throw new Error(`Create character phone image action could not find character "${characterName}".`);
    }
    if (!character.createImage.available) {
      throw new Error(`Create character phone image action requires Character Appearance or LoRA for ${character.name}.`);
    }

    const comfyProviderId = request.comfyProviderId?.trim();
    const comfyConnection = comfyProviderId
      ? connections.find((connection) => isComfyImageConnection(connection) && connection.id === comfyProviderId)
      : connections.find(isComfyImageConnection);
    if (!comfyConnection) {
      throw new Error(comfyProviderId
        ? 'Create character phone image action requires the selected ComfyUI provider.'
        : 'Create character phone image action requires a saved ComfyUI provider.');
    }
    const comfyHealth = providerHealthById[comfyConnection.id];
    if (comfyHealth?.status === 'offline') {
      throw new Error(`Create character phone image action skipped because ${comfyConnection.label} is offline${comfyHealth.detail ? `: ${comfyHealth.detail}` : '.'}`);
    }
    if (comfyHealth?.status === 'warning') {
      throw new Error(`Create character phone image action skipped because ${comfyConnection.label} is not fully set up${comfyHealth.detail ? `: ${comfyHealth.detail}` : '.'}`);
    }
    const missingComfyFields = missingComfySetupFields(comfyConnection);
    if (missingComfyFields.length > 0) {
      throw new Error(comfySetupRequiredMessage(missingComfyFields));
    }

    const manageModelMemory = request.manageModelMemory ?? true;
    if (manageModelMemory) {
      await unloadLocalLlmModelsBeforeComfy(warn, request.llmConnectionId);
    }

    const characterAppearance = character.createImage.appearance;
    const characterLoraName = character.createImage.loraName;
    const generationPrompt = [
      characterAppearance
        ? `Character appearance for ${character.name}: ${characterAppearance}`
        : '',
      prompt,
    ].filter(Boolean).join('\n\n');

    let result: Awaited<ReturnType<typeof window.rpgraph.runComfyWorkflowPath>>;
    try {
      onComfyGenerationActive?.(true);
      result = await window.rpgraph.runComfyWorkflowPath({
        baseUrl: comfyConnection.baseUrl,
        workflowPath: comfyConnection.comfyWorkflowPath || defaultComfyWorkflowPath,
        width: comfyConnection.comfyWidth ?? defaultComfyWidth,
        height: comfyConnection.comfyHeight ?? defaultComfyHeight,
        prompt: generationPrompt,
        checkpointName: comfyConnection.comfyCheckpointName ?? defaultComfyCheckpointName,
        diffusionModelName: comfyConnection.comfyDiffusionModelName ?? defaultComfyDiffusionModelName,
        vaeName: comfyConnection.comfyVaeName ?? defaultComfyVaeName,
        textEncoderName: comfyConnection.comfyTextEncoderName ?? defaultComfyTextEncoderName,
        loraSlots: characterComfyLoraSlots(comfyConnection.comfyLoraSlots ?? defaultComfyLoraSlots, characterLoraName),
        timeoutMs: 180000,
      });
    } finally {
      onComfyGenerationActive?.(false);
      if (manageModelMemory) {
        try {
          await window.rpgraph.freeComfyMemory({ baseUrl: comfyConnection.baseUrl });
        } catch (error) {
          warn(`ComfyUI unload after generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const normalizedImages = await Promise.all(
      result.images.map((image, index) =>
        normalizeImageAttachment({
          name: image.filename || `comfy-image-${index + 1}.png`,
          mimeType: dataUrlMimeType(image.dataUrl),
          size: encodedDataUrlBytes(image.dataUrl),
          dataUrl: image.dataUrl,
        }, () => `generated_comfy_${Date.now()}_${index + 1}`),
      ),
    );

    const storybookNodeCandidate = nodeById.get(character.storybookNodeId);
    const storybookNode = storybookNodeCandidate?.data.nodeType === 'rp-storybook-v1'
      ? storybookNodeCandidate
      : undefined;
    const storybookJson = storybookNode
      ? runStorybookJsonByNodeId.get(storybookNode.id) ?? storybookNode.data.storybookJson
      : undefined;
    if (!storybookNode || !storybookJson) {
      throw new Error(`Create character phone image action could not update ${character.name}'s Storybook.`);
    }
    const storybook = parseRpStorybookJson(storybookJson);
    const ensureResult = withImagesEnsuredForStorybookCharacter(
      storybook,
      character.sourceId,
      normalizedImages,
      generationPrompt,
    );
    if (ensureResult.addedCount + ensureResult.updatedCount > 0) {
      const nextStorybookJson = rpStorybookJsonText(ensureResult.storybook);
      runStorybookJsonByNodeId.set(storybookNode.id, nextStorybookJson);
      updateRuntimeNode(storybookNode.id, {
        storybookJson: nextStorybookJson,
        storybookStatus: `Generated ${ensureResult.imageIds.length} image${ensureResult.imageIds.length === 1 ? '' : 's'} for ${character.name}.`,
      });
    }

    const imagesById = new Map(ensureResult.images.map((image) => [image.id, image]));
    return {
      characterName: character.name,
      imageIds: ensureResult.imageIds,
      images: ensureResult.imageIds.flatMap((imageId) => {
        const image = imagesById.get(imageId);
        return image
          ? [{
              id: image.id,
              name: image.name || image.id,
              mimeType: image.mimeType,
              size: image.size,
              dataUrl: image.dataUrl,
              width: image.width,
              height: image.height,
              description: image.description,
              receivedFrom: image.receivedFrom,
              imageAccess: image.imageAccess,
            }]
          : [];
      }),
    };
  };
  runScratch.set(runScratchKeys.createComfyImageForCharacter, createComfyImageForCharacter);

  const executeNode = async (nodeId: string, sourceHandle?: string | null): Promise<string> => {
    throwIfAborted(signal);
    const executionKey = `${nodeId}:${sourceHandle ?? 'default'}`;
    const memoized = memo.get(executionKey);
    if (memoized) {
      return memoized;
    }
    const shouldTrackRunState = (node: WorkflowNode) =>
      trackRunCompletion && !(postOutputRun && node.data.kind === undefined && node.data.nodeType === 'input');

    const promise = (async () => {
      if (resolving.has(executionKey)) {
        throw new Error('The graph contains a cycle.');
      }
      resolving.add(executionKey);

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
            outputNodeId,
            sourceHandle,
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
              const inputValue = await executeNode(sourceNodeId, sourceHandle);
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
        return result;
      } finally {
        const node = nodeById.get(nodeId);
        if (node && shouldTrackRunState(node)) {
          updateRuntimeNode(nodeId, { runActive: false });
        }
        resolving.delete(executionKey);
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
