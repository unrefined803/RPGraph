import { isTextGenerationConnection } from '../llm/textProvider';
import { isImageGenerationConnection } from '../images/providers';
import { reasoningActivation } from '../../shared/reasoning.cjs';
import { useMemo, useState } from 'react';
import { isComfyVoiceConnection } from '../comfy/connectionRole';
import { isGeminiConnection, isOpenRouterConnection } from '../llm/providerKind';
import {
  configForPromptActionToken,
  parsePromptActionTokens,
  promptActionConfigs,
  withPromptActionRuntimeSettingsList,
  type PromptActionRuntimeSettings,
} from '../nodes/shared/promptActions';
import type { StorybookCharacter } from '../storybook/runtime';
import type {
  ConnectionPreset,
  DialogueVoiceMode,
  ProviderConnectionHealth,
  WorkflowNode,
} from '../types';
import {
  llmPromptSwitchPromptAftersByOutput,
  llmPromptSwitchPromptBeforesByOutput,
} from '../workflow';

export type WorkflowCapabilityIndicator = {
  kind: 'text' | 'reasoning' | 'vision' | 'image' | 'audio';
  tone: 'ready' | 'missing';
  active: boolean;
  label: string;
};

type UseWorkflowCapabilitiesOptions = {
  nodes: WorkflowNode[];
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  defaultConnectionId: string;
  promptActionSettings: PromptActionRuntimeSettings;
  dialogueVoiceMode: DialogueVoiceMode;
  storyCharacters: StorybookCharacter[];
  resolvedNarratorProviderId: string;
  imageGenerationActive: boolean;
  audioGenerationActive: boolean;
};

function isLlmConnection(connection: ConnectionPreset) {
  return connection.kind !== 'comfyui';
}

/** The only per-node fields the capability scan below reads. Everything else
 * on a node (text content beyond these, portrait images, storybookJson,
 * runtime previews, ...) is irrelevant here. */
function capabilityRelevantNode(node: WorkflowNode): WorkflowNode {
  return { id: node.id, data: {
    kind: node.data.kind,
    ...(Object.prototype.hasOwnProperty.call(node.data, 'connectionId')
      ? { connectionId: node.data.connectionId }
      : {}),
    nodeType: node.data.nodeType,
    llmPromptActions: node.data.llmPromptActions,
    llmPromptBefore: node.data.llmPromptBefore,
    llmPromptAfter: node.data.llmPromptAfter,
    llmPromptSwitchOutputTitles: node.data.llmPromptSwitchOutputTitles,
    llmPromptSwitchPromptTitlesByOutput: node.data.llmPromptSwitchPromptTitlesByOutput,
    llmPromptSwitchPromptBeforesByOutput: node.data.llmPromptSwitchPromptBeforesByOutput,
    llmPromptSwitchPromptAftersByOutput: node.data.llmPromptSwitchPromptAftersByOutput,
    runActive: node.data.runActive,
    runVisionActive: node.data.runVisionActive,
    runReasoningActive: node.data.runReasoningActive,
  } } as WorkflowNode;
}

const capabilityRelevantFields = [
  'kind', 'connectionId', 'nodeType', 'llmPromptActions', 'llmPromptBefore', 'llmPromptAfter',
  'llmPromptSwitchOutputTitles', 'llmPromptSwitchPromptTitlesByOutput', 'llmPromptSwitchPromptBeforesByOutput',
  'llmPromptSwitchPromptAftersByOutput', 'runActive', 'runVisionActive', 'runReasoningActive',
] as const;

/** Keeps a stable array reference across renders where none of the fields
 * above changed for any node - so a keystroke or other unrelated node-data
 * edit doesn't force the capability scan (and every LLM node's prompt-action
 * reparsing within it) to re-run over the whole graph. */
export function createCapabilityRelevantNodesSelector() {
  let previous: WorkflowNode[] = [];
  return (nodes: WorkflowNode[]) => {
    if (previous.length !== nodes.length || nodes.some((node, index) => {
      const before = previous[index];
      return node.id !== before.id ||
        Object.prototype.hasOwnProperty.call(node.data, 'connectionId') !==
          Object.prototype.hasOwnProperty.call(before.data, 'connectionId') ||
        capabilityRelevantFields.some((field) => node.data[field] !== before.data[field]);
    })) previous = nodes.map(capabilityRelevantNode);
    return previous;
  };
}

function useCapabilityRelevantNodes(nodes: WorkflowNode[]) {
  const [select] = useState(createCapabilityRelevantNodesSelector);
  return select(nodes);
}

export function useWorkflowCapabilities({
  nodes,
  connections,
  providerHealthById,
  defaultConnectionId,
  promptActionSettings,
  dialogueVoiceMode,
  storyCharacters,
  resolvedNarratorProviderId,
  imageGenerationActive,
  audioGenerationActive,
}: UseWorkflowCapabilitiesOptions) {
  const relevantNodes = useCapabilityRelevantNodes(nodes);
  return useMemo<WorkflowCapabilityIndicator[]>(() => {
    const llmConnectionIds = new Set<string>();
    const visionConnectionIds = new Set<string>();
    let usesVision = false;
    const usesAudio =
      dialogueVoiceMode === 'narrator-only' ||
      storyCharacters.some((character) => !!character.voiceConfig?.sampleDataUrl);

    const connectionIdForNode = (node: WorkflowNode) => {
      const connectionId =
        typeof node.data.connectionId === 'string' && node.data.connectionId.trim()
          ? node.data.connectionId
          : defaultConnectionId;
      const connection = connections.find((entry) => entry.id === connectionId);
      return connection && isLlmConnection(connection) ? connection.id : connectionId;
    };

    for (const node of relevantNodes) {
      if (node.data.kind !== undefined) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(node.data, 'connectionId')) {
        llmConnectionIds.add(connectionIdForNode(node));
      }
      if (node.data.nodeType !== 'llm-prompt' && node.data.nodeType !== 'llm-prompt-switch') {
        continue;
      }
      const actionConfigs = withPromptActionRuntimeSettingsList(
        promptActionConfigs(node.data.llmPromptActions),
        promptActionSettings,
      );
      const promptTexts =
        node.data.nodeType === 'llm-prompt'
          ? [node.data.llmPromptBefore ?? '', node.data.llmPromptAfter ?? '']
          : [
              ...llmPromptSwitchPromptBeforesByOutput(node.data).flat(),
              ...llmPromptSwitchPromptAftersByOutput(node.data).flat(),
            ];
      const usedActionConfigs = promptTexts
        .flatMap((text) => parsePromptActionTokens(text))
        .map((token) => configForPromptActionToken(actionConfigs, token.title));
      if (usedActionConfigs.length === 0) {
        continue;
      }
      const nodeConnectionId = connectionIdForNode(node);
      for (const action of usedActionConfigs) {
        if (
          action.actionId === 'updatePhoneImageCaption' ||
          action.actionId === 'describeInputImage' ||
          (action.actionId === 'getImageId' && action.sendImagesToLlm)
        ) {
          usesVision = true;
          visionConnectionIds.add(nodeConnectionId);
        }
      }
    }

    const connectionIsOnline = (connectionId: string) =>
      providerHealthById[connectionId]?.status === 'online';
    // Unknown API capabilities remain eligible; image output takes priority
    // over text, and audio-only models belong to voice generation.
    const connectionTextCapable = (connectionId: string) => {
      const connection = connections.find((entry) => entry.id === connectionId);
      return !!connection && isTextGenerationConnection(connection, providerHealthById[connectionId]);
    };
    const everyConnectionReady = (
      connectionIds: Set<string>,
      predicate: (connection: ConnectionPreset, id: string) => boolean,
    ) =>
      connectionIds.size > 0 &&
      [...connectionIds].every((connectionId) => {
        const connection = connections.find((entry) => entry.id === connectionId);
        return !!connection && predicate(connection, connectionId);
      });
    const textReady = everyConnectionReady(
      llmConnectionIds,
      (connection, connectionId) =>
        isLlmConnection(connection) &&
        connectionTextCapable(connectionId) &&
        connectionIsOnline(connectionId),
    );
    const anyTextConnected = connections.some(
      (connection) =>
        isLlmConnection(connection) &&
        connectionTextCapable(connection.id) &&
        connectionIsOnline(connection.id),
    );
    const anyVisionConnected = connections.some(
      (connection) =>
        isLlmConnection(connection) &&
        connection.vision === true &&
        connectionIsOnline(connection.id),
    );
    const visionReady = everyConnectionReady(
      visionConnectionIds,
      (connection, connectionId) =>
        isLlmConnection(connection) &&
        connection.vision === true &&
        connectionIsOnline(connectionId),
    );
    const imageProviders = connections.filter((connection) => isImageGenerationConnection(connection, providerHealthById[connection.id]));
    const voiceProviders = connections.filter(isComfyVoiceConnection);
    const anyImageConnected = imageProviders.some((connection) =>
      connectionIsOnline(connection.id),
    );
    const anyApiVoiceConnected = connections.some((connection) => {
      const capabilities = providerHealthById[connection.id]?.capabilities;
      return (
        (isOpenRouterConnection(connection) || isGeminiConnection(connection)) &&
        capabilities?.voice === true &&
        capabilities.text !== true &&
        connectionIsOnline(connection.id)
      );
    });
    const selectedNarratorConnected = resolvedNarratorProviderId
      ? connectionIsOnline(resolvedNarratorProviderId)
      : false;
    const anyVoiceConnected =
      voiceProviders.some((connection) => connectionIsOnline(connection.id)) ||
      anyApiVoiceConnected;
    const textActive = relevantNodes.some(
      (node) => node.data.kind === undefined && node.data.runActive === true,
    );
    const visionActive = relevantNodes.some(
      (node) => node.data.kind === undefined && node.data.runVisionActive === true,
    );
    const effectiveTextReady = llmConnectionIds.size > 0 ? textReady : anyTextConnected;

    const indicators: WorkflowCapabilityIndicator[] = [
      {
        kind: 'text',
        tone: effectiveTextReady || textActive ? 'ready' : 'missing',
        active: textActive,
        label:
          effectiveTextReady || textActive
            ? 'Text: required and connected'
            : 'Text: required, but no used LLM provider is connected',
      },
    ];
    const reasoningConnections = connections.filter((connection) =>
      isLlmConnection(connection) &&
      (llmConnectionIds.size === 0 || llmConnectionIds.has(connection.id)) &&
      reasoningActivation(connection.reasoningEffort, connection.reasoningCapabilities) === true);
    if (reasoningConnections.length > 0) {
      const reasoningActive = relevantNodes.some((node) =>
        node.data.kind === undefined && node.data.runReasoningActive === true &&
        reasoningConnections.some((connection) => connection.id === connectionIdForNode(node)));
      indicators.push({
        kind: 'reasoning', tone: 'ready', active: reasoningActive,
        label: reasoningActive ? 'Reasoning: thinking' : 'Reasoning: enabled',
      });
    }
    if (usesVision || anyVisionConnected || visionActive) {
      const ready = usesVision ? visionReady : anyVisionConnected;
      indicators.push({
        kind: 'vision',
        tone: ready || visionActive ? 'ready' : 'missing',
        active: visionActive,
        label:
          ready || visionActive
            ? usesVision
              ? 'Vision: required and available'
              : 'Vision: connected'
            : 'Vision: required, but the used LLM provider is not connected or has no vision',
      });
    }
    // Workflows never require image generation; it is offered by the phone camera assistant.
    if (anyImageConnected || imageGenerationActive) {
      indicators.push({
        kind: 'image',
        tone: 'ready',
        active: imageGenerationActive,
        label: 'Image generation: connected',
      });
    }
    if (usesAudio || anyVoiceConnected || audioGenerationActive) {
      const ready =
        dialogueVoiceMode === 'narrator-only'
          ? selectedNarratorConnected
          : anyVoiceConnected;
      indicators.push({
        kind: 'audio',
        tone: ready || audioGenerationActive ? 'ready' : 'missing',
        active: audioGenerationActive,
        label:
          ready || audioGenerationActive
            ? usesAudio
              ? 'Audio generation: required and connected'
              : 'Audio generation: connected'
            : 'Audio generation: required, but the selected voice provider is not connected',
      });
    }
    return indicators;
  }, [
    audioGenerationActive,
    connections,
    defaultConnectionId,
    dialogueVoiceMode,
    imageGenerationActive,
    relevantNodes,
    promptActionSettings,
    providerHealthById,
    resolvedNarratorProviderId,
    storyCharacters,
  ]);
}
