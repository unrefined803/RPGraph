import { localModelApi } from '../llm/localModelApi';
import type { NodeLlmApi } from '../llm/NodeLlmApi';
import { getRegisteredNode } from '../nodes/registry';
import {
  defaultComfyCheckpointName,
  defaultComfyDiffusionModelName,
  defaultComfyHeight,
  defaultComfyLoraSlots,
  defaultComfyCfg,
  defaultComfySampler,
  defaultComfyScheduler,
  defaultComfySteps,
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
  isManagedLocalConnection,
  isLocalProviderConnection,
  isOllamaConnection,
} from '../llm/providerKind';
import { isComfyImageConnection } from '../comfy/connectionRole';
import { withImagesEnsuredForStorybookCharacter } from '../storybook/imageLibrary';
import {
  isStorybookSourceNode,
  storybookCreateImageCharactersFromNodes,
  type StorybookCreateImageCharacter,
} from '../storybook/runtime';
import { parseRpStorybookJson, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import type { ConnectionPreset, ProviderConnectionHealth, WorkflowNode, WorkflowNodeData } from '../types';
import type { CreateComfyImageForCharacterRunner } from '../nodes/runScratch';
import { encodedDataUrlBytes, normalizeImageAttachment } from '../utils/imageNormalization';
import { withGeneratedImageDescriptions } from './generatedImageDescriptions';

export type CreateImageCharacterNameResolution =
  | { status: 'found'; character: StorybookCreateImageCharacter }
  | { status: 'not-found' }
  | { status: 'ambiguous' };

function normalizedCreateImageCharacterName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function resolveCreateImageCharacterByName(
  characters: StorybookCreateImageCharacter[],
  requestedName: string,
): CreateImageCharacterNameResolution {
  const normalizedRequestedName = normalizedCreateImageCharacterName(requestedName);
  if (!normalizedRequestedName) {
    return { status: 'not-found' };
  }
  const exactMatches = characters.filter(
    (character) => normalizedCreateImageCharacterName(character.name) === normalizedRequestedName,
  );
  if (exactMatches.length === 1) {
    return { status: 'found', character: exactMatches[0] };
  }
  if (exactMatches.length > 1) {
    return { status: 'ambiguous' };
  }
  const requestedParts = normalizedRequestedName.split(' ');
  if (requestedParts.length !== 1) {
    return { status: 'not-found' };
  }
  const firstNameMatches = characters.filter(
    (character) => normalizedCreateImageCharacterName(character.name).split(' ')[0] === requestedParts[0],
  );
  return firstNameMatches.length === 1
    ? { status: 'found', character: firstNameMatches[0] }
    : { status: firstNameMatches.length > 1 ? 'ambiguous' : 'not-found' };
}

export type ComfyImageRunnerOptions = {
  /** Called fresh on every request, so a caller backed by a live ref (e.g. `nodesRef.current`)
   * always sees the current storybook/character set, while a one-shot graph run can just
   * close over its own start-of-run snapshot (matching `executeGraph`'s existing behavior). */
  getNodes: () => WorkflowNode[];
  connections: ConnectionPreset[];
  providerHealthById: Record<string, ProviderConnectionHealth>;
  llm: Pick<NodeLlmApi, 'supportsVision' | 'complete' | 'resolveConnection'>;
  updateRuntimeNode: (nodeId: string, patch: Partial<WorkflowNodeData>) => void;
  onComfyGenerationActive?: (active: boolean) => void;
  signal?: AbortSignal;
};

function dataUrlMimeType(dataUrl: string) {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] || 'image/png';
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('The graph run was cancelled.');
  }
}

/**
 * Builds a `CreateComfyImageForCharacterRunner`: resolves a phone owner/LoRA character by
 * name or id, runs the actual ComfyUI generation, captions the result (if vision is
 * available) and ensures the generated images land in that character's Storybook. Shared
 * by `executeGraph.ts` (the legacy/Structured v1 graph-evaluation path, one runner per
 * graph run) and the live `actions-v1`/`staged-v1` action bridge (one runner per turn,
 * reading nodes off a live ref) so `image.generate` behaves identically everywhere it runs.
 */
export function createComfyImageRunner(options: ComfyImageRunnerOptions): CreateComfyImageForCharacterRunner {
  // Scoped to this runner instance (one graph run or one live turn), mirroring
  // `executeGraph`'s original `runStorybookJsonByNodeId`: a second generation for the
  // same character within the same run/turn must see the first one's Storybook write,
  // since nothing else re-reads the live node data mid-run.
  const runStorybookJsonByNodeId = new Map<string, string>();

  const workflowConnectionIds = () =>
    new Set(
      options.getNodes()
        .map((node) => node.data.connectionId)
        .filter((connectionId): connectionId is string => !!connectionId),
    );

  const isLlmNode = (node: WorkflowNode) =>
    node.data.kind === undefined && (getRegisteredNode(node.data.nodeType)?.usesLlm ?? false);

  const activeLocalLlmConnections = async (llmConnectionId?: string) => {
    const activeConnectionIds = workflowConnectionIds();
    if (llmConnectionId) {
      activeConnectionIds.add(llmConnectionId);
    }
    const candidates = new Map(options.connections.map((connection) => [connection.id, connection]));
    if (options.getNodes().some((node) => isLlmNode(node) && node.data.connectionId === undefined)) {
      const resolved = await options.llm.resolveConnection(undefined, 'ComfyUI memory management', options.signal);
      activeConnectionIds.add(resolved.id);
      candidates.set(resolved.id, resolved);
    }
    return [...candidates.values()].filter((connection) =>
      activeConnectionIds.has(connection.id) &&
      isLocalProviderConnection(connection) &&
      (isLmStudioConnection(connection) || isOllamaConnection(connection) || isManagedLocalConnection(connection)),
    );
  };

  const unloadLocalLlmModelsBeforeComfy = async (
    warn: (message: string) => void,
    localConnections: ConnectionPreset[],
  ) => {
    await Promise.all(
      localConnections
        .map(async (connection) => {
          try {
            if (isLmStudioConnection(connection)) {
              await window.rpgraph.unloadLmStudioModels(connection);
              return;
            }
            if (isManagedLocalConnection(connection)) {
              await localModelApi.unload(connection);
              return;
            }
            await window.rpgraph.unloadOllamaModels(connection);
          } catch (error) {
            warn(`${connection.label} unload before ComfyUI generation failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }),
    );
  };

  // Found live: unloading before Comfy generation had no counterpart — the LLM was freed to
  // make room for image generation and never reloaded, leaving every following turn with no
  // model to talk to. Mirrors `unloadLocalLlmModelsBeforeComfy` exactly, one connection at a
  // time, best-effort (a reload failure here shouldn't fail the turn that already has its
  // image — the next real LLM call will still trigger a provider-side load on demand for
  // LM Studio/Ollama's own JIT loading; this just avoids leaving the model cold in the
  // meantime and surfaces a warning if the explicit reload itself failed).
  const reloadLocalLlmModelsAfterComfy = async (
    warn: (message: string) => void,
    localConnections: ConnectionPreset[],
  ) => {
    await Promise.all(
      localConnections
        .map(async (connection) => {
          try {
            if (isLmStudioConnection(connection)) {
              await window.rpgraph.loadLmStudioModel(connection);
              return;
            }
            if (isManagedLocalConnection(connection)) {
              await localModelApi.load(connection);
              return;
            }
            await window.rpgraph.loadOllamaModel(connection);
          } catch (error) {
            warn(`${connection.label} reload after ComfyUI generation failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }),
    );
  };

  return async (request, warn) => {
    const nodes = options.getNodes();
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const phoneOwnerName = request.phoneOwnerName.trim();
    const loraCharacterName = request.loraCharacterName?.trim() ?? '';
    const prompt = request.prompt.trim();
    if (!phoneOwnerName || !prompt) {
      throw new Error('Create character phone image action requires a phone owner and prompt.');
    }

    const createImageCharacters = storybookCreateImageCharactersFromNodes(nodes);
    const exactOwner = request.phoneOwnerId ? createImageCharacters.find((entry) => entry.id === request.phoneOwnerId) : undefined;
    const phoneOwnerResolution: CreateImageCharacterNameResolution = request.phoneOwnerId
      ? exactOwner ? { status: 'found', character: exactOwner } : { status: 'not-found' }
      : resolveCreateImageCharacterByName(createImageCharacters, phoneOwnerName);
    if (phoneOwnerResolution.status === 'ambiguous') {
      throw new Error(`Create character phone image action found multiple phone owners matching "${phoneOwnerName}". Use the exact full name.`);
    }
    if (phoneOwnerResolution.status === 'not-found') {
      throw new Error(`Create character phone image action could not find phone owner "${phoneOwnerName}".`);
    }
    const phoneOwner = phoneOwnerResolution.character;
    const loraCharacter = loraCharacterName
      ? resolveCreateImageCharacterByName(createImageCharacters, loraCharacterName)
      : undefined;
    if (loraCharacter?.status === 'ambiguous') {
      throw new Error(`Create character phone image action found multiple LoRA characters matching "${loraCharacterName}". Use the exact full name.`);
    }
    if (loraCharacter?.status === 'not-found') {
      throw new Error(`Create character phone image action could not find LoRA character "${loraCharacterName}".`);
    }
    const resolvedLoraCharacter = loraCharacter?.character;
    if (resolvedLoraCharacter && !resolvedLoraCharacter.createImage.hasLora) {
      throw new Error(`Create character phone image action requires a configured LoRA for ${resolvedLoraCharacter.name}.`);
    }

    const comfyProviderId = request.comfyProviderId?.trim();
    const comfyConnection = comfyProviderId
      ? options.connections.find((connection) => isComfyImageConnection(connection) && connection.id === comfyProviderId)
      : options.connections.find(isComfyImageConnection);
    if (!comfyConnection) {
      throw new Error(comfyProviderId
        ? 'Create character phone image action requires the selected ComfyUI provider.'
        : 'Create character phone image action requires a saved ComfyUI provider.');
    }
    const comfyHealth = options.providerHealthById[comfyConnection.id];
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

    // With only API LLM providers in play, nothing competes with ComfyUI
    // for local VRAM, so its model can stay loaded across generations.
    const localConnections = (request.manageModelMemory ?? true)
      ? await activeLocalLlmConnections(request.llmConnectionId)
      : [];
    const manageModelMemory = localConnections.length > 0;
    throwIfAborted(options.signal);
    if (manageModelMemory) {
      await unloadLocalLlmModelsBeforeComfy(warn, localConnections);
    }

    const generationPrompt = prompt;
    throwIfAborted(options.signal);
    const characterLoraName = resolvedLoraCharacter?.createImage.loraName ?? '';

    let result: Awaited<ReturnType<typeof window.rpgraph.runComfyWorkflowPath>>;
    try {
      options.onComfyGenerationActive?.(true);
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
        steps: comfyConnection.comfySteps ?? defaultComfySteps,
        cfg: comfyConnection.comfyCfg ?? defaultComfyCfg,
        sampler: comfyConnection.comfySampler ?? defaultComfySampler,
        scheduler: comfyConnection.comfyScheduler ?? defaultComfyScheduler,
        loraSlots: characterComfyLoraSlots(comfyConnection.comfyLoraSlots ?? defaultComfyLoraSlots, characterLoraName),
        deleteOutputs: comfyConnection.comfyDeleteImageOutputs !== false,
        timeoutMs: 180000,
      });
    } finally {
      options.onComfyGenerationActive?.(false);
      if (manageModelMemory) {
        try {
          await window.rpgraph.freeComfyMemory({ baseUrl: comfyConnection.baseUrl });
        } catch (error) {
          warn(`ComfyUI unload after generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        await reloadLocalLlmModelsAfterComfy(warn, localConnections);
      }
    }

    throwIfAborted(options.signal);
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
    const describedImages = await withGeneratedImageDescriptions({
      images: normalizedImages,
      generationPrompt,
      llm: options.llm,
      connectionId: request.llmConnectionId,
      nodeId: request.llmNodeId,
      signal: options.signal,
      warn,
    });

    throwIfAborted(options.signal);
    const storybookNodeCandidate = nodeById.get(phoneOwner.storybookNodeId);
    const storybookNode = storybookNodeCandidate && isStorybookSourceNode(storybookNodeCandidate)
      ? storybookNodeCandidate
      : undefined;
    const storybookJson = storybookNode
      ? runStorybookJsonByNodeId.get(storybookNode.id) ?? storybookNode.data.storybookJson
      : undefined;
    if (!storybookNode || !storybookJson) {
      throw new Error(`Create character phone image action could not update ${phoneOwner.name}'s Storybook.`);
    }
    const storybook = parseRpStorybookJson(storybookJson);
    const ensureResult = withImagesEnsuredForStorybookCharacter(
      storybook,
      phoneOwner.sourceId,
      describedImages,
      '',
    );
    if (ensureResult.addedCount + ensureResult.updatedCount > 0) {
      const nextStorybookJson = rpStorybookJsonText(ensureResult.storybook);
      runStorybookJsonByNodeId.set(storybookNode.id, nextStorybookJson);
      options.updateRuntimeNode(storybookNode.id, {
        storybookJson: nextStorybookJson,
        storybookStatus: `Generated ${ensureResult.imageIds.length} image${ensureResult.imageIds.length === 1 ? '' : 's'} for ${phoneOwner.name}${resolvedLoraCharacter ? ` using ${resolvedLoraCharacter.name}'s LoRA` : ''}.`,
      });
    }

    const imagesById = new Map(ensureResult.images.map((image) => [image.id, image]));
    return {
      phoneOwnerName: phoneOwner.name,
      ...(resolvedLoraCharacter ? { loraCharacterName: resolvedLoraCharacter.name } : {}),
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
}
