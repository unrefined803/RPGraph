import { useMemo } from 'react';
import { isComfyImageConnection, isComfyVoiceConnection } from '../comfy/connectionRole';
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
  kind: 'text' | 'vision' | 'image' | 'audio';
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
  return useMemo<WorkflowCapabilityIndicator[]>(() => {
    const llmConnectionIds = new Set<string>();
    const visionConnectionIds = new Set<string>();
    const explicitComfyProviderIds = new Set<string>();
    let usesVision = false;
    let usesImage = false;
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

    for (const node of nodes) {
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
        if (action.actionId === 'createImage') {
          usesImage = true;
          const comfyProviderId = action.comfyProviderId?.trim();
          if (comfyProviderId) {
            explicitComfyProviderIds.add(comfyProviderId);
          }
        }
      }
    }

    const connectionIsOnline = (connectionId: string) =>
      providerHealthById[connectionId]?.status === 'online';
    // Plain OpenAI-compatible providers may not report capabilities. Only an
    // explicit text:false value disqualifies one as a text provider.
    const connectionTextCapable = (connectionId: string) =>
      providerHealthById[connectionId]?.capabilities?.text !== false;
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
    const imageProviders = connections.filter(isComfyImageConnection);
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
    const imageReady =
      usesImage &&
      (explicitComfyProviderIds.size > 0
        ? [...explicitComfyProviderIds].every((providerId) =>
            imageProviders.some(
              (connection) =>
                connection.id === providerId && connectionIsOnline(connection.id),
            ),
          )
        : anyImageConnected);
    const textActive = nodes.some(
      (node) => node.data.kind === undefined && node.data.runActive === true,
    );
    const visionActive = nodes.some(
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
    if (usesImage || anyImageConnected || imageGenerationActive) {
      const ready = usesImage ? imageReady : anyImageConnected;
      indicators.push({
        kind: 'image',
        tone: ready || imageGenerationActive ? 'ready' : 'missing',
        active: imageGenerationActive,
        label:
          ready || imageGenerationActive
            ? usesImage
              ? 'Image generation: required and connected'
              : 'Image generation: connected'
            : 'Image generation: required, but the ComfyUI provider is not connected',
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
    nodes,
    promptActionSettings,
    providerHealthById,
    resolvedNarratorProviderId,
    storyCharacters,
  ]);
}
