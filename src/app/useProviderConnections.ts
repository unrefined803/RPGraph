import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ComfyGeneratedImage } from '../comfy/api';
import type { ComfyWorkflowInspection } from '../comfy/workflowCompatibility';
import {
  connectionWithGeminiCapabilities as connectionWithGeminiCapabilitiesForModels,
  connectionWithLmStudioCapabilities as connectionWithLmStudioCapabilitiesForModels,
  connectionWithLlamaCppCapabilities as connectionWithLlamaCppCapabilitiesForModels,
  connectionWithOllamaCapabilities as connectionWithOllamaCapabilitiesForModels,
  connectionWithOpenRouterCapabilities as connectionWithOpenRouterCapabilitiesForModels,
  createProviderConnectionId,
  geminiCapabilitiesForConnection,
  lmStudioCapabilitiesForConnection,
  lmStudioLlmModels,
  llamaCppCapabilitiesForConnection,
  ollamaCapabilitiesForConnection,
  providerCheckedAt,
  openRouterCapabilitiesForConnection,
  providerCheckConnectionStatus,
  providerErrorMessage,
  providerModelCountDetail,
} from './providerCapabilities';
import {
  inferredProviderKind,
  isLmStudioConnection,
  isLlamaCppConnection,
  isLocalProviderConnection,
  isOllamaConnection,
  isOpenRouterConnection,
  isGeminiConnection,
  llmProviderKind,
} from '../llm/providerKind';
import {
  comfyConnectionRole,
  isComfyImageConnection,
  isComfyVoiceConnection,
} from '../comfy/connectionRole';
import { bundledComfyNarratorVoice } from '../comfy/defaultNarratorVoice';
import {
  characterComfyLoraSlots,
  bundledComfyWorkflows,
  bundledComfyWorkflowPathForRole,
  comfySetupRequiredMessage,
  defaultComfyBaseUrl,
  defaultComfyVoiceWorkflowPath,
  defaultComfyCheckpointName,
  defaultComfyDiffusionModelName,
  defaultComfyHeight,
  defaultComfyLoraSlots,
  defaultComfyPrompt,
  defaultComfyTextEncoderName,
  defaultComfyVaeName,
  defaultComfyWidth,
  defaultComfyWorkflowPath,
  defaultConnection,
  defaultConnectionSampling,
  missingComfySetupFields,
  runtimeComfyLoraSlots,
  validComfyDimension,
  validComfyLoraSlots,
  validConnectionReasoningEffort,
} from '../settings';
import type {
  ComfyConnectionRole,
  ConnectionPreset,
  GeminiModelInfo,
  LmStudioModelInfo,
  LlamaCppModelInfo,
  OllamaModelInfo,
  OpenRouterModelInfo,
  ProviderConnectionCapabilities,
  ProviderConnectionHealth,
  WorkflowNode,
  WorkflowNodeData,
} from '../types';
import type { ImageAssistantModelState } from '../chat/imageGenerationAssistant';

type AvailableComfyModels = {
  checkpoints: string[];
  loras: string[];
  vae: string[];
  text_encoders: string[];
  diffusion_models: string[];
};

const recommendedOpenRouterTtsModel = 'google/gemini-3.1-flash-tts-preview';

function comfyConnectionCapabilities(connection: ConnectionPreset) {
  return comfyConnectionRole(connection) === 'voice' ? { voice: true } : { image: true };
}

function comfySetupHealth(connection: ConnectionPreset, detail: string): ProviderConnectionHealth {
  const role = comfyConnectionRole(connection);
  if (role === null) {
    return {
      status: 'warning',
      detail: 'Choose Image Generation or Voice Generation for this ComfyUI preset.',
      checkedAt: providerCheckedAt(),
    };
  }
  if (role === 'voice') {
    return {
      status: 'online',
      detail,
      capabilities: { voice: true },
      checkedAt: providerCheckedAt(),
    };
  }
  const missingFields = missingComfySetupFields(connection);
  if (missingFields.length === 0) {
    return {
      status: 'online',
      detail,
      capabilities: { image: true },
      checkedAt: providerCheckedAt(),
    };
  }
  return {
    status: 'warning',
    detail: comfySetupRequiredMessage(missingFields),
    capabilities: { image: true },
    checkedAt: providerCheckedAt(),
  };
}

type UseProviderConnectionsOptions = {
  connections: ConnectionPreset[];
  setConnections: Dispatch<SetStateAction<ConnectionPreset[]>>;
  defaultConnectionId: string;
  setDefaultConnectionId: (connectionId: string) => void;
  settingsLoadComplete: boolean;
  // Whether a run/turn is currently active. The background health poll pauses
  // while true and the connections dialog is closed (providers do not change
  // mid-run).
  isRunning: boolean;
  nodesRef: { current: WorkflowNode[] };
  setNodes: Dispatch<SetStateAction<WorkflowNode[]>>;
  notifySystem: (level: 'info' | 'warning' | 'error', text: string) => void;
};

export function useProviderConnections({
  connections,
  setConnections,
  defaultConnectionId,
  setDefaultConnectionId,
  settingsLoadComplete,
  isRunning,
  nodesRef,
  setNodes,
  notifySystem,
}: UseProviderConnectionsOptions) {
  const [showConnections, setShowConnections] = useState(false);
  const [comfyPreview, setComfyPreview] = useState<{
    promptId: string;
    images: ComfyGeneratedImage[];
  } | null>(null);
  const [editingConnection, setEditingConnection] = useState<ConnectionPreset>(defaultConnection);
  const [connectionDraftPending, setConnectionDraftPending] = useState(false);
  const [availableConnectionModels, setAvailableConnectionModels] = useState<string[]>([]);
  const [availableComfyModels, setAvailableComfyModels] = useState<AvailableComfyModels>({
    checkpoints: [],
    loras: [],
    vae: [],
    text_encoders: [],
    diffusion_models: [],
  });
  const [comfyWorkflowInspection, setComfyWorkflowInspection] = useState<ComfyWorkflowInspection | null>(null);
  const [pendingComfyWorkflowRepair, setPendingComfyWorkflowRepair] = useState<{
    workflowPath: string;
    workflowJson: string;
    inspection: ComfyWorkflowInspection;
  } | null>(null);
  const [comfyWorkflowRepairStatus, setComfyWorkflowRepairStatus] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('');
  const [providerHealthById, setProviderHealthById] = useState<Record<string, ProviderConnectionHealth>>({});
  const [imageAssistantModelStateById, setImageAssistantModelStateById] = useState<Record<string, ImageAssistantModelState>>({});
  const providerHealthByIdRef = useRef<Record<string, ProviderConnectionHealth>>({});
  const [lmStudioModelsByConnectionId, setLmStudioModelsByConnectionId] = useState<Record<string, LmStudioModelInfo[]>>({});
  const lmStudioModelsByConnectionIdRef = useRef<Record<string, LmStudioModelInfo[]>>({});
  const [openRouterModelsByConnectionId, setOpenRouterModelsByConnectionId] = useState<Record<string, OpenRouterModelInfo[]>>({});
  const openRouterModelsByConnectionIdRef = useRef<Record<string, OpenRouterModelInfo[]>>({});
  const [geminiModelsByConnectionId, setGeminiModelsByConnectionId] = useState<Record<string, GeminiModelInfo[]>>({});
  const geminiModelsByConnectionIdRef = useRef<Record<string, GeminiModelInfo[]>>({});
  const [ollamaModelsByConnectionId, setOllamaModelsByConnectionId] = useState<Record<string, OllamaModelInfo[]>>({});
  const ollamaModelsByConnectionIdRef = useRef<Record<string, OllamaModelInfo[]>>({});
  const [llamaCppModelsByConnectionId, setLlamaCppModelsByConnectionId] = useState<Record<string, LlamaCppModelInfo[]>>({});
  const llamaCppModelsByConnectionIdRef = useRef<Record<string, LlamaCppModelInfo[]>>({});
  const startupProviderCheckCompleteRef = useRef(false);
  const localProviderPollActiveRef = useRef(false);
  const characterComfyLoraCacheRef = useRef<Record<string, string[] | Promise<string[]>>>({});
  const [lmStudioModelActionActive, setLmStudioModelActionActive] = useState<'load' | 'unload' | null>(null);
  const [ollamaModelActionActive, setOllamaModelActionActive] = useState<'load' | 'unload' | null>(null);
  const [comfyProviderActionActive, setComfyProviderActionActive] = useState<'models' | 'generate' | 'unload' | 'repair' | 'apply-repair' | null>(null);
  const [voiceGenerationActive, setVoiceGenerationActive] = useState(false);
  const voiceGenerationCountRef = useRef(0);
  const voiceCleanupWarningCountsRef = useRef<Record<string, number>>({});

  function isLlmConnection(connection: ConnectionPreset) {
    return connection.kind !== 'comfyui';
  }

  function setImageAssistantModelState(connectionId: string, state: ImageAssistantModelState) {
    setImageAssistantModelStateById((current) => ({ ...current, [connectionId]: state }));
  }

  function firstLlmConnection(connectionsToSearch = connections) {
    return connectionsToSearch.find(isLlmConnection) ?? defaultConnection;
  }

  useEffect(() => {
    providerHealthByIdRef.current = providerHealthById;
  }, [providerHealthById]);
  useEffect(() => {
    lmStudioModelsByConnectionIdRef.current = lmStudioModelsByConnectionId;
  }, [lmStudioModelsByConnectionId]);
  useEffect(() => {
    openRouterModelsByConnectionIdRef.current = openRouterModelsByConnectionId;
  }, [openRouterModelsByConnectionId]);
  useEffect(() => {
    geminiModelsByConnectionIdRef.current = geminiModelsByConnectionId;
  }, [geminiModelsByConnectionId]);
  useEffect(() => {
    ollamaModelsByConnectionIdRef.current = ollamaModelsByConnectionId;
  }, [ollamaModelsByConnectionId]);
  useEffect(() => {
    llamaCppModelsByConnectionIdRef.current = llamaCppModelsByConnectionId;
  }, [llamaCppModelsByConnectionId]);

  function beginVoiceGeneration() {
    voiceGenerationCountRef.current += 1;
    setVoiceGenerationActive(true);
  }

  function endVoiceGeneration() {
    voiceGenerationCountRef.current = Math.max(0, voiceGenerationCountRef.current - 1);
    if (voiceGenerationCountRef.current === 0) {
      setVoiceGenerationActive(false);
    }
  }

  // Only fires when a voice workflow saves clips with a custom node that
  // RPGraph cannot reroute through the ComfyUI temp folder. Warns at most
  // twice per provider and session, then the failure stays silent.
  function notifyVoiceCleanupFailure(connection: ConnectionPreset) {
    const warningCount = voiceCleanupWarningCountsRef.current[connection.id] ?? 0;
    if (warningCount >= 2) {
      return;
    }
    voiceCleanupWarningCountsRef.current[connection.id] = warningCount + 1;
    notifySystem(
      'warning',
      warningCount === 0
        ? `${connection.label}: could not remove the generated voice files from the ComfyUI server. The voice workflow saves them with a custom node, so they remain in the ComfyUI output folder.`
        : `${connection.label}: removing voice files from the ComfyUI server failed again. Use a standard audio save node (e.g. Save Audio (MP3)) in the voice workflow so RPGraph can route the clips through the ComfyUI temp folder, or delete the rpgraph files in the ComfyUI output folder manually. This warning will not be shown again.`,
    );
  }

  function openConnectionManager() {
    const selected =
      connections.find((connection) => connection.id === defaultConnectionId && isLlmConnection(connection)) ??
      firstLlmConnection();
    setEditingConnection({ ...selected });
    setAvailableConnectionModels([]);
    setAvailableComfyModels({
      checkpoints: [],
      loras: [],
      vae: [],
      text_encoders: [],
      diffusion_models: [],
    });
    setComfyWorkflowInspection(null);
    setPendingComfyWorkflowRepair(null);
    setComfyWorkflowRepairStatus('');
    setConnectionStatus('');
    setShowConnections(true);
    void checkProviderConnections(connections, { showStatus: true });
  }

  function openOpenRouterTtsSetup() {
    const template = connections.find(isOpenRouterConnection);
    const existingTtsCount = connections.filter((connection) =>
      isOpenRouterConnection(connection) && connection.label.startsWith('OpenRouter TTS')
    ).length;
    const connectionId = createProviderConnectionId();
    const modelDetails = template
      ? openRouterModelsByConnectionIdRef.current[template.id] ?? []
      : [];
    const selectedModel = modelDetails.find((model) => model.id === recommendedOpenRouterTtsModel);
    const nextConnection = connectionWithOpenRouterCapabilities({
      id: connectionId,
      kind: 'llm',
      providerKind: 'openrouter',
      label: existingTtsCount > 0 ? `OpenRouter TTS ${existingTtsCount + 1}` : 'OpenRouter TTS',
      baseUrl: template?.baseUrl || 'https://openrouter.ai/api/v1',
      apiKey: template?.apiKey ?? '',
      model: recommendedOpenRouterTtsModel,
      ttsVoice: selectedModel?.supportedVoices[0],
      ttsStreamAudio: true,
      reasoningEffort: 'none',
      vision: false,
      ...defaultConnectionSampling,
    }, modelDetails);
    if (modelDetails.length > 0) {
      updateOpenRouterModelCache(connectionId, modelDetails);
    }
    setConnections((current) => [...current, nextConnection]);
    setEditingConnection(nextConnection);
    setConnectionDraftPending(false);
    setAvailableConnectionModels(modelDetails.map((model) => model.id));
    setAvailableComfyModels({
      checkpoints: [],
      loras: [],
      vae: [],
      text_encoders: [],
      diffusion_models: [],
    });
    setComfyWorkflowInspection(null);
    setPendingComfyWorkflowRepair(null);
    setComfyWorkflowRepairStatus('');
    setConnectionStatus(template?.apiKey
      ? 'New OpenRouter TTS provider created. Choose its voice and delivery settings.'
      : 'New OpenRouter TTS provider created. Add your API key, then check the models.');
    setShowConnections(true);
    void checkProviderConnection(nextConnection, { showStatus: false });
  }

  function closeConnectionManager() {
    const connection = connectionFromEditingConnection();
    setConnections((current) =>
      current.map((entry) => (entry.id === connection.id ? connection : entry)),
    );
    setEditingConnection(connection);
    setConnectionDraftPending(false);
    setShowConnections(false);
    void unloadComfyConnectionForClose(connection);
  }

  function newConnection() {
    setConnectionDraftPending(true);
    setAvailableConnectionModels([]);
    setAvailableComfyModels({
      checkpoints: [],
      loras: [],
      vae: [],
      text_encoders: [],
      diffusion_models: [],
    });
    setComfyWorkflowInspection(null);
    setPendingComfyWorkflowRepair(null);
    setComfyWorkflowRepairStatus('');
    setConnectionStatus('');
  }

  function applyProviderPreset(
    preset: Pick<ConnectionPreset, 'kind' | 'providerKind' | 'label' | 'baseUrl' | 'apiKey' | 'model' | 'ttsStreamAudio' | 'comfyWorkflowPath' | 'comfyWidth' | 'comfyHeight' | 'comfyPrompt' | 'comfyCheckpointName' | 'comfyDiffusionModelName' | 'comfyVaeName' | 'comfyTextEncoderName' | 'comfyLoraSlots' | 'reasoningEffort'>,
  ) {
    const currentKind = editingConnection.kind === 'comfyui' ? 'comfyui' : 'llm';
    const presetKind = preset.kind === 'comfyui' ? 'comfyui' : 'llm';
    const nextConnection: ConnectionPreset = connectionDraftPending
      ? {
          id: createProviderConnectionId(),
          ...(presetKind === 'comfyui' ? {} : defaultConnectionSampling),
          ...preset,
          // Applying the ComfyUI type always re-enters the image/voice picker step.
          comfyRole: undefined,
          comfyWorkflowSetupConfirmed: presetKind === 'comfyui' ? false : undefined,
          providerKind: presetKind === 'comfyui' ? undefined : preset.providerKind,
          vision: false,
        }
      : {
          ...editingConnection,
          ...preset,
          comfyRole: undefined,
          comfyWorkflowSetupConfirmed: presetKind === 'comfyui' ? false : undefined,
          providerKind: presetKind === 'comfyui' ? undefined : preset.providerKind,
          vision: presetKind === 'comfyui' ? false : editingConnection.vision ?? false,
        };
    if (
      !connectionDraftPending &&
      currentKind !== presetKind &&
      editingConnection.id === defaultConnectionId &&
      presetKind === 'comfyui'
    ) {
      const nextDefault = connections.find((connection) =>
        connection.id !== editingConnection.id && isLlmConnection(connection)
      );
      if (nextDefault) {
        setDefaultConnectionId(nextDefault.id);
      }
    }
    setConnections((current) => {
      const exists = current.some((entry) => entry.id === nextConnection.id);
      return exists
        ? current.map((entry) => (entry.id === nextConnection.id ? nextConnection : entry))
        : [...current, nextConnection];
    });
    setEditingConnection(nextConnection);
    setConnectionDraftPending(false);
    setAvailableConnectionModels([]);
    setAvailableComfyModels({
      checkpoints: [],
      loras: [],
      vae: [],
      text_encoders: [],
      diffusion_models: [],
    });
    setComfyWorkflowInspection(null);
    setPendingComfyWorkflowRepair(null);
    setComfyWorkflowRepairStatus('');
    setConnectionStatus(
      connectionDraftPending
        ? preset.kind === 'comfyui'
          ? 'ComfyUI preset created. Choose Image Generation or Voice Generation.'
          : `${preset.label} preset created. Changes are saved automatically.`
        : preset.kind === 'comfyui'
          ? 'ComfyUI type applied. Choose Image Generation or Voice Generation.'
          : `${preset.label} type applied. Add your API key if needed.`,
    );
    void checkProviderConnection(nextConnection, { showStatus: true });
  }

  function applyComfyConnectionRole(role: ComfyConnectionRole) {
    if (editingConnection.kind !== 'comfyui') {
      return;
    }
    const roleLabels = ['ComfyUI Default', 'ComfyUI Image + Voice', 'ComfyUI Image', 'ComfyUI Voice'];
    const currentLabel = editingConnection.label.trim();
    const currentWorkflowPath = editingConnection.comfyWorkflowPath?.trim() ?? '';
    const roleDefaultWorkflowPath = role === 'voice' ? defaultComfyVoiceWorkflowPath : defaultComfyWorkflowPath;
    const nextConnection: ConnectionPreset = {
      ...editingConnection,
      comfyRole: role,
      label: !currentLabel || roleLabels.includes(currentLabel)
        ? (role === 'voice' ? 'ComfyUI Voice' : 'ComfyUI Image')
        : editingConnection.label,
      comfyWorkflowPath: !currentWorkflowPath
        ? roleDefaultWorkflowPath
        : bundledComfyWorkflowPathForRole(currentWorkflowPath, role),
      comfyWorkflowSetupConfirmed: false,
      comfyNarratorVoice: role === 'voice'
        ? editingConnection.comfyNarratorVoice ?? bundledComfyNarratorVoice()
        : undefined,
    };
    setConnections((current) =>
      current.map((entry) => (entry.id === nextConnection.id ? nextConnection : entry)),
    );
    setEditingConnection(nextConnection);
    setComfyWorkflowInspection(null);
    setPendingComfyWorkflowRepair(null);
    setComfyWorkflowRepairStatus('');
    setConnectionStatus(
      role === 'voice'
        ? 'ComfyUI voice generation selected. Open the normal workflow in ComfyUI first.'
        : 'ComfyUI image generation selected. Open the normal workflow in ComfyUI first.',
    );
  }

  function connectionFromEditingConnection(): ConnectionPreset {
    const kind: NonNullable<ConnectionPreset['kind']> =
      editingConnection.kind === 'comfyui' ? 'comfyui' : 'llm';
    const comfyRole = kind === 'comfyui' ? comfyConnectionRole(editingConnection) : null;
    const isComfyImage = comfyRole === 'image';
    return {
      ...editingConnection,
      kind,
      comfyRole: comfyRole ?? undefined,
      providerKind: kind === 'comfyui'
        ? undefined
        : llmProviderKind(editingConnection) ?? inferredProviderKind(editingConnection),
      label: editingConnection.label.trim() || (kind === 'comfyui' ? 'ComfyUI Default' : 'Provider'),
      baseUrl: editingConnection.baseUrl.trim() || (kind === 'comfyui' ? defaultComfyBaseUrl : defaultConnection.baseUrl),
      model: kind === 'comfyui' ? '' : editingConnection.model.trim(),
      ttsVoice: kind === 'comfyui' ? undefined : editingConnection.ttsVoice?.trim() || undefined,
      ttsTemperature: kind === 'comfyui' ? undefined : editingConnection.ttsTemperature,
      ttsStreamAudio: kind === 'comfyui' ? undefined : editingConnection.ttsStreamAudio === true,
      ttsAudioProfile: kind === 'comfyui' ? undefined : editingConnection.ttsAudioProfile?.trim() || undefined,
      ttsStyle: kind === 'comfyui' ? undefined : editingConnection.ttsStyle?.trim() || undefined,
      ttsAccent: kind === 'comfyui' ? undefined : editingConnection.ttsAccent?.trim() || undefined,
      ttsPace: kind === 'comfyui' ? undefined : editingConnection.ttsPace?.trim() || undefined,
      apiKey: kind === 'comfyui' ? '' : editingConnection.apiKey.trim(),
      comfyWorkflowPath: kind === 'comfyui'
        ? bundledComfyWorkflowPathForRole(editingConnection.comfyWorkflowPath, comfyRole)
        : undefined,
      comfyWorkflowSetupConfirmed: kind === 'comfyui'
        ? editingConnection.comfyWorkflowSetupConfirmed === true
        : undefined,
      comfyNarratorVoice: comfyRole === 'voice'
        ? editingConnection.comfyNarratorVoice
        : undefined,
      comfyDeleteVoiceOutputs: comfyRole === 'voice'
        ? editingConnection.comfyDeleteVoiceOutputs !== false
        : undefined,
      comfyDeleteImageOutputs: isComfyImage
        ? editingConnection.comfyDeleteImageOutputs !== false
        : undefined,
      comfyWidth: isComfyImage
        ? validComfyDimension(editingConnection.comfyWidth, defaultComfyWidth)
        : undefined,
      comfyHeight: isComfyImage
        ? validComfyDimension(editingConnection.comfyHeight, defaultComfyHeight)
        : undefined,
      comfyPrompt: isComfyImage
        ? editingConnection.comfyPrompt?.trim() || defaultComfyPrompt
        : undefined,
      comfyCheckpointName: isComfyImage
        ? editingConnection.comfyCheckpointName ?? defaultComfyCheckpointName
        : undefined,
      comfyDiffusionModelName: isComfyImage
        ? editingConnection.comfyDiffusionModelName ?? defaultComfyDiffusionModelName
        : undefined,
      comfyVaeName: isComfyImage
        ? editingConnection.comfyVaeName ?? defaultComfyVaeName
        : undefined,
      comfyTextEncoderName: isComfyImage
        ? editingConnection.comfyTextEncoderName ?? defaultComfyTextEncoderName
        : undefined,
      comfyLoraSlots: isComfyImage
        ? validComfyLoraSlots(editingConnection.comfyLoraSlots ?? defaultComfyLoraSlots)
        : undefined,
      reasoningEffort: kind === 'comfyui'
        ? defaultConnection.reasoningEffort
        : validConnectionReasoningEffort(editingConnection.reasoningEffort),
      vision: kind === 'comfyui' ? false : editingConnection.vision ?? false,
      temperature: kind === 'comfyui'
        ? undefined
        : editingConnection.temperature ?? defaultConnectionSampling.temperature,
      topP: kind === 'comfyui'
        ? undefined
        : editingConnection.topP ?? defaultConnectionSampling.topP,
      presencePenalty: kind === 'comfyui'
        ? undefined
        : editingConnection.presencePenalty ?? defaultConnectionSampling.presencePenalty,
      frequencyPenalty: kind === 'comfyui'
        ? undefined
        : editingConnection.frequencyPenalty ?? defaultConnectionSampling.frequencyPenalty,
    };
  }

  function applyConnectionToAllNodes() {
    const connection = connectionFromEditingConnection();
    if (!isLlmConnection(connection)) {
      setConnectionStatus('ComfyUI cannot be applied to LLM nodes.');
      return;
    }
    const affectedCount = nodesRef.current.filter((node) =>
      Object.prototype.hasOwnProperty.call(node.data, 'connectionId') &&
      node.data.connectionId !== connection.id,
    ).length;

    setConnections((current) => {
      const exists = current.some((entry) => entry.id === connection.id);
      return exists
        ? current.map((entry) => (entry.id === connection.id ? connection : entry))
        : [...current, connection];
    });
    setDefaultConnectionId(connection.id);
    setEditingConnection(connection);
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        Object.prototype.hasOwnProperty.call(node.data, 'connectionId')
          ? {
              ...node,
              data: {
                ...node.data,
                connectionId: connection.id,
              } as WorkflowNodeData,
            }
          : node,
      ),
    );
    setConnectionStatus(
      affectedCount === 1
        ? 'Preset saved and applied to 1 node.'
        : `Preset saved and applied to ${affectedCount} nodes.`,
    );
  }

  function updateProviderHealth(connectionId: string, health: ProviderConnectionHealth) {
    providerHealthByIdRef.current = {
      ...providerHealthByIdRef.current,
      [connectionId]: health,
    };
    setProviderHealthById(providerHealthByIdRef.current);
  }

  function updateLmStudioModelCache(connectionId: string, models: LmStudioModelInfo[]) {
    lmStudioModelsByConnectionIdRef.current = {
      ...lmStudioModelsByConnectionIdRef.current,
      [connectionId]: models,
    };
    setLmStudioModelsByConnectionId(lmStudioModelsByConnectionIdRef.current);
  }

  function updateOpenRouterModelCache(connectionId: string, models: OpenRouterModelInfo[]) {
    openRouterModelsByConnectionIdRef.current = {
      ...openRouterModelsByConnectionIdRef.current,
      [connectionId]: models,
    };
    setOpenRouterModelsByConnectionId(openRouterModelsByConnectionIdRef.current);
  }

  function updateGeminiModelCache(connectionId: string, models: GeminiModelInfo[]) {
    geminiModelsByConnectionIdRef.current = {
      ...geminiModelsByConnectionIdRef.current,
      [connectionId]: models,
    };
    setGeminiModelsByConnectionId(geminiModelsByConnectionIdRef.current);
  }

  function updateOllamaModelCache(connectionId: string, models: OllamaModelInfo[]) {
    ollamaModelsByConnectionIdRef.current = {
      ...ollamaModelsByConnectionIdRef.current,
      [connectionId]: models,
    };
    setOllamaModelsByConnectionId(ollamaModelsByConnectionIdRef.current);
  }

  function updateLlamaCppModelCache(connectionId: string, models: LlamaCppModelInfo[]) {
    llamaCppModelsByConnectionIdRef.current = { ...llamaCppModelsByConnectionIdRef.current, [connectionId]: models };
    setLlamaCppModelsByConnectionId(llamaCppModelsByConnectionIdRef.current);
  }

  function connectionWithLmStudioCapabilities(
    connection: ConnectionPreset,
    models = lmStudioModelsByConnectionIdRef.current[connection.id] ?? [],
  ): ConnectionPreset {
    return connectionWithLmStudioCapabilitiesForModels(connection, models);
  }

  function connectionWithOpenRouterCapabilities(
    connection: ConnectionPreset,
    models = openRouterModelsByConnectionIdRef.current[connection.id] ?? [],
  ): ConnectionPreset {
    return connectionWithOpenRouterCapabilitiesForModels(connection, models);
  }

  function connectionWithGeminiCapabilities(
    connection: ConnectionPreset,
    models = geminiModelsByConnectionIdRef.current[connection.id] ?? [],
  ): ConnectionPreset {
    return connectionWithGeminiCapabilitiesForModels(connection, models);
  }

  function connectionWithOllamaCapabilities(
    connection: ConnectionPreset,
    models = ollamaModelsByConnectionIdRef.current[connection.id] ?? [],
  ): ConnectionPreset {
    return connectionWithOllamaCapabilitiesForModels(connection, models);
  }

  function connectionWithLlamaCppCapabilities(
    connection: ConnectionPreset,
    models = llamaCppModelsByConnectionIdRef.current[connection.id] ?? [],
  ): ConnectionPreset {
    return connectionWithLlamaCppCapabilitiesForModels(connection, models);
  }

  function applyDetectedConnectionCapabilities(
    connection: ConnectionPreset,
    capabilities: ProviderConnectionCapabilities,
  ) {
    if (
      !isLmStudioConnection(connection) &&
      !isLlamaCppConnection(connection) &&
      !isOllamaConnection(connection) &&
      !isOpenRouterConnection(connection) &&
      !isGeminiConnection(connection)
    ) {
      return;
    }
    const vision = capabilities.vision === true;
    setEditingConnection((current) =>
      current.id === connection.id
        ? isLmStudioConnection(current)
          ? connectionWithLmStudioCapabilities(current)
          : isLlamaCppConnection(current)
            ? connectionWithLlamaCppCapabilities(current)
          : isOllamaConnection(current)
            ? connectionWithOllamaCapabilities(current)
            : isOpenRouterConnection(current)
              ? connectionWithOpenRouterCapabilities(current)
              : connectionWithGeminiCapabilities(current)
        : current,
    );
    setConnections((current) =>
      current.map((entry) =>
        entry.id !== connection.id
          ? entry
          : isOpenRouterConnection(entry)
            ? connectionWithOpenRouterCapabilities(entry)
            : isGeminiConnection(entry)
              ? connectionWithGeminiCapabilities(entry)
            : entry.vision !== vision
              ? { ...entry, vision }
              : entry,
      ),
    );
  }

  async function checkProviderConnection(
    connection: ConnectionPreset,
    options: { showStatus?: boolean; selectFallbackModel?: boolean; markChecking?: boolean } = {},
  ): Promise<ProviderConnectionHealth> {
    if (options.markChecking !== false) {
      updateProviderHealth(connection.id, { status: 'checking', detail: 'Checking ...' });
    }
    if (options.showStatus) {
      setConnectionStatus(`${connection.label}: Checking ...`);
    }
    try {
      let health: ProviderConnectionHealth;
      if (connection.kind === 'comfyui') {
        const result = await window.rpgraph.checkComfyConnection({ baseUrl: connection.baseUrl });
        if (!result.ok) {
          health = {
            status: 'offline',
            detail: result.error ?? 'ComfyUI is not reachable.',
            capabilities: comfyConnectionCapabilities(connection),
            checkedAt: providerCheckedAt(),
          };
          updateProviderHealth(connection.id, health);
          if (options.showStatus) {
            setConnectionStatus(providerCheckConnectionStatus(connection, health));
          }
          return health;
        }
        const devices = Array.isArray(result.devices) ? result.devices.length : 0;
        health = comfySetupHealth(
          connection,
          devices > 0
            ? `Connected to ComfyUI. ${devices} device${devices === 1 ? '' : 's'} reported.`
            : 'Connected to ComfyUI.',
        );
      } else if (
        connectionRequiresApiKeyForModelList(connection) &&
        connection.apiKey.trim().length === 0
      ) {
        health = {
          status: 'offline',
          detail: 'Missing API key.',
          checkedAt: providerCheckedAt(),
        };
      } else if (isLmStudioConnection(connection)) {
        const modelDetails = lmStudioLlmModels(await window.rpgraph.listLmStudioModels(connection));
        updateLmStudioModelCache(connection.id, modelDetails);
        const models = modelDetails.map((model) => model.id);
        const fallbackModel = models.includes(connection.model)
          ? connection.model
          : options.selectFallbackModel
            ? models[0] ?? connection.model
            : connection.model;
        const detectedConnection = connectionWithLmStudioCapabilities(
          { ...connection, model: fallbackModel },
          modelDetails,
        );
        if (options.selectFallbackModel && detectedConnection.model !== connection.model) {
          setEditingConnection(detectedConnection);
          setConnections((current) =>
            current.map((entry) => (entry.id === detectedConnection.id ? detectedConnection : entry)),
          );
        } else {
          applyDetectedConnectionCapabilities(
            detectedConnection,
            lmStudioCapabilitiesForConnection(detectedConnection, modelDetails),
          );
        }
        if (editingConnection.id === connection.id) {
          setAvailableConnectionModels(models);
        }
        const capabilities = lmStudioCapabilitiesForConnection(detectedConnection, modelDetails);
        health = {
          status: models.length > 0 ? 'online' : 'offline',
          detail: models.length > 0
            ? providerModelCountDetail(models.length)
            : 'Connection succeeded, but no LLM models were returned.',
          capabilities,
          checkedAt: providerCheckedAt(),
        };
      } else if (isLlamaCppConnection(connection)) {
        const modelDetails = await window.rpgraph.listLlamaCppModels(connection);
        updateLlamaCppModelCache(connection.id, modelDetails);
        const models = modelDetails.map((model) => model.id);
        const fallbackModel = models.includes(connection.model)
          ? connection.model
          : options.selectFallbackModel
            ? models[0] ?? connection.model
            : connection.model;
        const detectedConnection = connectionWithLlamaCppCapabilities(
          { ...connection, model: fallbackModel },
          modelDetails,
        );
        if (options.selectFallbackModel && detectedConnection.model !== connection.model) {
          setEditingConnection(detectedConnection);
          setConnections((current) =>
            current.map((entry) => (entry.id === detectedConnection.id ? detectedConnection : entry)),
          );
        } else {
          applyDetectedConnectionCapabilities(
            detectedConnection,
            llamaCppCapabilitiesForConnection(detectedConnection, modelDetails),
          );
        }
        if (editingConnection.id === connection.id) {
          setAvailableConnectionModels(models);
        }
        const capabilities = llamaCppCapabilitiesForConnection(detectedConnection, modelDetails);
        const selected = modelDetails.find((model) => model.id === detectedConnection.model);
        health = {
          status: models.length > 0 ? 'online' : 'offline',
          detail: models.length > 0
            ? `${providerModelCountDetail(models.length)} Selected model: ${selected?.status ?? 'unknown'}.`
            : 'Connection succeeded, but no LLM models were returned.',
          capabilities,
          checkedAt: providerCheckedAt(),
        };
      } else if (isOllamaConnection(connection)) {
        const modelDetails = await window.rpgraph.listOllamaModels(connection);
        updateOllamaModelCache(connection.id, modelDetails);
        const models = modelDetails.map((model) => model.id);
        const fallbackModel = models.includes(connection.model)
          ? connection.model
          : options.selectFallbackModel
            ? models[0] ?? connection.model
            : connection.model;
        const detectedConnection = connectionWithOllamaCapabilities(
          { ...connection, model: fallbackModel },
          modelDetails,
        );
        if (options.selectFallbackModel && detectedConnection.model !== connection.model) {
          setEditingConnection(detectedConnection);
          setConnections((current) =>
            current.map((entry) => (entry.id === detectedConnection.id ? detectedConnection : entry)),
          );
        } else {
          applyDetectedConnectionCapabilities(
            detectedConnection,
            ollamaCapabilitiesForConnection(detectedConnection, modelDetails),
          );
        }
        if (editingConnection.id === connection.id) {
          setAvailableConnectionModels(models);
        }
        const capabilities = ollamaCapabilitiesForConnection(detectedConnection, modelDetails);
        health = {
          status: models.length > 0 ? 'online' : 'offline',
          detail: models.length > 0
            ? providerModelCountDetail(models.length)
            : 'Connection succeeded, but no LLM models were returned.',
          capabilities,
          checkedAt: providerCheckedAt(),
        };
      } else if (isOpenRouterConnection(connection)) {
        const modelDetails = await window.rpgraph.listOpenRouterModels(connection);
        updateOpenRouterModelCache(connection.id, modelDetails);
        const models = modelDetails.map((model) => model.id);
        const fallbackModel = models.includes(connection.model)
          ? connection.model
          : options.selectFallbackModel
            ? models[0] ?? connection.model
            : connection.model;
        const detectedConnection = connectionWithOpenRouterCapabilities(
          { ...connection, model: fallbackModel },
          modelDetails,
        );
        if (options.selectFallbackModel && detectedConnection.model !== connection.model) {
          setEditingConnection(detectedConnection);
          setConnections((current) =>
            current.map((entry) => (entry.id === detectedConnection.id ? detectedConnection : entry)),
          );
        } else {
          applyDetectedConnectionCapabilities(
            detectedConnection,
            openRouterCapabilitiesForConnection(detectedConnection, modelDetails),
          );
        }
        if (editingConnection.id === connection.id) {
          setAvailableConnectionModels(models);
        }
        const capabilities = openRouterCapabilitiesForConnection(detectedConnection, modelDetails);
        // The OpenRouter model list is public, so a successful listing does not
        // prove the preset can generate anything. Without an API key the preset
        // stays yellow ("Setup needed") instead of green.
        const missingApiKey = connection.apiKey.trim().length === 0;
        health = {
          status: missingApiKey
            ? 'warning'
            : models.length > 0 ? 'online' : 'offline',
          detail: missingApiKey
            ? 'No API key set. Add your OpenRouter API key.'
            : models.length > 0
              ? providerModelCountDetail(models.length)
              : 'Connection succeeded, but no models were returned.',
          capabilities,
          checkedAt: providerCheckedAt(),
        };
      } else if (isGeminiConnection(connection)) {
        const modelDetails = await window.rpgraph.listGeminiModels(connection);
        updateGeminiModelCache(connection.id, modelDetails);
        const models = modelDetails.map((model) => model.id);
        const fallbackModel = models.includes(connection.model)
          ? connection.model
          : options.selectFallbackModel
            ? models[0] ?? connection.model
            : connection.model;
        const detectedConnection = connectionWithGeminiCapabilities(
          { ...connection, model: fallbackModel },
          modelDetails,
        );
        if (options.selectFallbackModel && detectedConnection.model !== connection.model) {
          setEditingConnection(detectedConnection);
          setConnections((current) =>
            current.map((entry) => (entry.id === detectedConnection.id ? detectedConnection : entry)),
          );
        } else {
          applyDetectedConnectionCapabilities(
            detectedConnection,
            geminiCapabilitiesForConnection(detectedConnection, modelDetails),
          );
        }
        if (editingConnection.id === connection.id) {
          setAvailableConnectionModels(models);
        }
        const capabilities = geminiCapabilitiesForConnection(detectedConnection, modelDetails);
        health = {
          status: models.length > 0 ? 'online' : 'offline',
          detail: models.length > 0
            ? providerModelCountDetail(models.length)
            : 'Connection succeeded, but no models were returned.',
          capabilities,
          checkedAt: providerCheckedAt(),
        };
      } else {
        const models = await window.rpgraph.listModels(connection);
        const fallbackModel = models.includes(connection.model)
          ? connection.model
          : options.selectFallbackModel
            ? models[0] ?? connection.model
            : connection.model;
        if (options.selectFallbackModel && fallbackModel !== connection.model) {
          const updatedConnection = { ...connection, model: fallbackModel };
          setEditingConnection(updatedConnection);
          setConnections((current) =>
            current.map((entry) => (entry.id === updatedConnection.id ? updatedConnection : entry)),
          );
        }
        if (editingConnection.id === connection.id) {
          setAvailableConnectionModels(models);
        }
        health = {
          status: models.length > 0 ? 'online' : 'offline',
          detail: models.length > 0
            ? providerModelCountDetail(models.length)
            : 'Connection succeeded, but no models were returned.',
          capabilities: { text: models.length > 0 },
          checkedAt: providerCheckedAt(),
        };
      }
      updateProviderHealth(connection.id, health);
      if (options.showStatus) {
        setConnectionStatus(providerCheckConnectionStatus(connection, health));
      }
      return health;
    } catch (error) {
      const fallbackModels = connection.kind !== 'comfyui'
        ? fallbackModelsForConnection(connection, error)
        : null;
      const health: ProviderConnectionHealth = fallbackModels
        ? {
            status: 'online',
            detail: 'Using bundled model list.',
            checkedAt: providerCheckedAt(),
          }
        : {
            status: 'offline',
            detail: providerErrorMessage(error),
            checkedAt: providerCheckedAt(),
          };
      if (fallbackModels && editingConnection.id === connection.id) {
        setAvailableConnectionModels(fallbackModels);
      }
      updateProviderHealth(connection.id, health);
      if (options.showStatus) {
        setConnectionStatus(providerCheckConnectionStatus(connection, health));
      }
      return health;
    }
  }

  async function checkProviderConnectionById(connectionId: string, showStatus = false) {
    const connection = connections.find((entry) => entry.id === connectionId);
    if (!connection) {
      updateProviderHealth(connectionId, {
        status: 'offline',
        detail: 'Provider is no longer saved.',
        checkedAt: providerCheckedAt(),
      });
      return;
    }
    await checkProviderConnection(connection, { showStatus });
  }

  async function checkProviderConnections(
    connectionsToCheck: ConnectionPreset[],
    options: { showStatus?: boolean; markChecking?: boolean } = {},
  ) {
    if (!connectionsToCheck.length) {
      return providerHealthByIdRef.current;
    }
    const results = await Promise.all(
      connectionsToCheck.map(async (connection) => [
        connection.id,
        await checkProviderConnection(connection, options),
      ] as const),
    );
    return {
      ...providerHealthByIdRef.current,
      ...Object.fromEntries(results),
    };
  }
  const checkProviderConnectionByIdRef = useRef(checkProviderConnectionById);
  const checkProviderConnectionsRef = useRef(checkProviderConnections);
  const inspectComfyWorkflowRef = useRef(inspectComfyWorkflow);
  const editingConnectionRef = useRef(editingConnection);
  const isRunningRef = useRef(isRunning);
  const showConnectionsRef = useRef(showConnections);
  useEffect(() => {
    checkProviderConnectionByIdRef.current = checkProviderConnectionById;
    checkProviderConnectionsRef.current = checkProviderConnections;
    inspectComfyWorkflowRef.current = inspectComfyWorkflow;
    editingConnectionRef.current = editingConnection;
    isRunningRef.current = isRunning;
    showConnectionsRef.current = showConnections;
  });

  useEffect(() => {
    if (!settingsLoadComplete || startupProviderCheckCompleteRef.current || connections.length === 0) {
      return;
    }
    startupProviderCheckCompleteRef.current = true;
    void checkProviderConnectionsRef.current(connections);
  }, [connections, settingsLoadComplete]);

  useEffect(() => {
    if (!settingsLoadComplete) {
      return;
    }
    const checkLocalProviders = async () => {
      // Skip the background health poll while a turn is running AND the
      // connections dialog is closed — providers do not change mid-run, so this
      // avoids redundant check-connection round-trips (and the list-models +
      // settings-save churn they cascade into) during generation. When the dialog
      // is open the user may be tuning a provider, so keep polling to reflect it.
      if (isRunningRef.current && !showConnectionsRef.current) {
        return;
      }
      if (localProviderPollActiveRef.current) {
        return;
      }
      const localConnections = connections.filter(isLocalProviderConnection);
      if (!localConnections.length) {
        return;
      }
      localProviderPollActiveRef.current = true;
      try {
        await checkProviderConnectionsRef.current(localConnections, { markChecking: false });
      } finally {
        localProviderPollActiveRef.current = false;
      }
    };
    const intervalId = window.setInterval(() => {
      void checkLocalProviders();
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [connections, settingsLoadComplete]);

  useEffect(() => {
    if (!showConnections) {
      return;
    }
    if (editingConnection.kind !== 'comfyui') {
      queueMicrotask(() => setComfyWorkflowInspection(null));
      return;
    }
    void inspectComfyWorkflowRef.current(editingConnectionRef.current, { showStatus: false });
  }, [editingConnection.kind, editingConnection.comfyRole, editingConnection.comfyWorkflowPath, showConnections]);

  function deleteConnection() {
    if (connections.length === 1) {
      setConnectionStatus('At least one preset must remain.');
      return;
    }
    if (
      isLlmConnection(editingConnection) &&
      connections.filter((connection) => isLlmConnection(connection) && connection.id !== editingConnection.id).length === 0
    ) {
      setConnectionStatus('At least one LLM provider must remain.');
      return;
    }

    const remaining = connections.filter(
      (connection) => connection.id !== editingConnection.id,
    );
    const fallbackConnection = firstLlmConnection(remaining);
    setConnections(remaining);
    const nextProviderHealth = { ...providerHealthByIdRef.current };
    delete nextProviderHealth[editingConnection.id];
    providerHealthByIdRef.current = nextProviderHealth;
    setProviderHealthById(nextProviderHealth);
    setDefaultConnectionId(fallbackConnection.id);
    setEditingConnection({ ...(remaining[0] ?? fallbackConnection) });
    setConnectionStatus('Preset removed.');
  }

  async function unloadLocalLlmModelsForComfy(reason: string) {
    const localLlmConnections = connections.filter((connection) =>
      isLocalProviderConnection(connection) &&
      (isLmStudioConnection(connection) || isOllamaConnection(connection) || isLlamaCppConnection(connection)),
    );
    if (!localLlmConnections.length) {
      return [];
    }
    const failures: string[] = [];
    await Promise.all(
      localLlmConnections.map(async (connection) => {
        try {
          setImageAssistantModelState(connection.id, 'unloading');
          if (isLmStudioConnection(connection)) {
            await window.rpgraph.unloadLmStudioModels(connection);
          } else if (isLlamaCppConnection(connection)) {
            await window.rpgraph.unloadLlamaCppModels(connection);
          } else {
            await window.rpgraph.unloadOllamaModels(connection);
          }
          setImageAssistantModelState(connection.id, 'unloaded');
        } catch (error) {
          setImageAssistantModelState(connection.id, 'unknown');
          failures.push(`${connection.label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
    if (failures.length) {
      notifySystem('warning', `${reason}: ${failures.join('; ')}`);
    }
    return failures;
  }

  async function unloadComfyConnectionForClose(connection: ConnectionPreset) {
    if (connection.kind !== 'comfyui') {
      return;
    }
    try {
      await window.rpgraph.freeComfyMemory({ baseUrl: connection.baseUrl });
      updateProviderHealth(connection.id, {
        status: 'online',
        detail: 'ComfyUI models unloaded.',
        checkedAt: providerCheckedAt(),
      });
    } catch (error) {
      notifySystem(
        'warning',
        `ComfyUI unload on close failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function connectionRequiresApiKeyForModelList(connection: ConnectionPreset) {
    const providerKind = llmProviderKind(connection);
    return providerKind === 'gemini';
  }

  function fallbackModelsForConnection(connection: ConnectionPreset, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      llmProviderKind(connection) === 'gemini' &&
      (message.includes('404') || message.includes('NOT_FOUND'))
    ) {
      return ['gemini-2.5-flash', 'gemini-2.5-pro'];
    }
    return null;
  }

  async function loadConnectionModels(selectFallbackModel: boolean) {
    if (!isLlmConnection(editingConnection)) {
      setAvailableConnectionModels([]);
      setConnectionStatus('ComfyUI model lists load automatically from the ComfyUI provider panel.');
      return;
    }
    if (
      connectionRequiresApiKeyForModelList(editingConnection) &&
      editingConnection.apiKey.trim().length === 0
    ) {
      setAvailableConnectionModels([]);
      setConnectionStatus('Add an API key before loading models for this provider.');
      return;
    }

    setConnectionStatus('Checking models ...');

    try {
      const lmStudioModels = isLmStudioConnection(editingConnection)
        ? lmStudioLlmModels(await window.rpgraph.listLmStudioModels(editingConnection))
        : null;
      if (lmStudioModels) {
        updateLmStudioModelCache(editingConnection.id, lmStudioModels);
      }
      const ollamaModels = !lmStudioModels && isOllamaConnection(editingConnection)
        ? await window.rpgraph.listOllamaModels(editingConnection)
        : null;
      if (ollamaModels) {
        updateOllamaModelCache(editingConnection.id, ollamaModels);
      }
      const llamaCppModels = !lmStudioModels && !ollamaModels && isLlamaCppConnection(editingConnection)
        ? await window.rpgraph.listLlamaCppModels(editingConnection)
        : null;
      if (llamaCppModels) {
        updateLlamaCppModelCache(editingConnection.id, llamaCppModels);
      }
      const openRouterModels = !lmStudioModels && !ollamaModels && !llamaCppModels && isOpenRouterConnection(editingConnection)
        ? await window.rpgraph.listOpenRouterModels(editingConnection)
        : null;
      if (openRouterModels) {
        updateOpenRouterModelCache(editingConnection.id, openRouterModels);
      }
      const geminiModels = !lmStudioModels && !ollamaModels && !llamaCppModels && !openRouterModels && isGeminiConnection(editingConnection)
        ? await window.rpgraph.listGeminiModels(editingConnection)
        : null;
      if (geminiModels) {
        updateGeminiModelCache(editingConnection.id, geminiModels);
      }
      const models = lmStudioModels
        ? lmStudioModels.map((model) => model.id)
        : ollamaModels
          ? ollamaModels.map((model) => model.id)
        : llamaCppModels
          ? llamaCppModels.map((model) => model.id)
        : openRouterModels
          ? openRouterModels.map((model) => model.id)
        : geminiModels
          ? geminiModels.map((model) => model.id)
        : await window.rpgraph.listModels(editingConnection);
      if (models.length === 0) {
        setAvailableConnectionModels([]);
        updateProviderHealth(editingConnection.id, {
          status: 'offline',
          detail: lmStudioModels || ollamaModels || llamaCppModels
            ? 'Connection succeeded, but no LLM models were returned.'
            : 'Connection succeeded, but no models were returned.',
          capabilities: lmStudioModels || ollamaModels || llamaCppModels
            ? { text: false, vision: false, tools: false }
            : openRouterModels
              ? { text: false, vision: false, image: false, voice: false }
              : geminiModels
                ? { text: false, vision: false, image: false, voice: false }
              : undefined,
          checkedAt: providerCheckedAt(),
        });
        setConnectionStatus('Connection successful, but no models were returned.');
        return;
      }

      let connection = {
        ...editingConnection,
        model: models.includes(editingConnection.model)
          ? editingConnection.model
          : selectFallbackModel
            ? models[0]
            : editingConnection.model,
      };
      if (lmStudioModels) {
        connection = connectionWithLmStudioCapabilities(connection, lmStudioModels);
      } else if (ollamaModels) {
        connection = connectionWithOllamaCapabilities(connection, ollamaModels);
      } else if (llamaCppModels) {
        connection = connectionWithLlamaCppCapabilities(connection, llamaCppModels);
      } else if (openRouterModels) {
        connection = connectionWithOpenRouterCapabilities(connection, openRouterModels);
        const selectedModel = openRouterModels.find((model) => model.id === connection.model);
        if (selectedModel?.supportedVoices.length) {
          connection = {
            ...connection,
            ttsVoice: selectedModel.supportedVoices.includes(connection.ttsVoice ?? '')
              ? connection.ttsVoice
              : selectedModel.supportedVoices[0],
          };
        }
      } else if (geminiModels) {
        connection = connectionWithGeminiCapabilities(connection, geminiModels);
      }
      const capabilities = lmStudioModels
        ? lmStudioCapabilitiesForConnection(connection, lmStudioModels)
        : ollamaModels
          ? ollamaCapabilitiesForConnection(connection, ollamaModels)
        : llamaCppModels
          ? llamaCppCapabilitiesForConnection(connection, llamaCppModels)
        : openRouterModels
          ? openRouterCapabilitiesForConnection(connection, openRouterModels)
        : geminiModels
          ? geminiCapabilitiesForConnection(connection, geminiModels)
        : { text: true };
      setAvailableConnectionModels(models);
      setEditingConnection(connection);
      // See checkProviderConnection: the public OpenRouter model list also
      // loads without an API key, but generation would fail with 401.
      const missingOpenRouterApiKey =
        !!openRouterModels && connection.apiKey.trim().length === 0;
      updateProviderHealth(connection.id, {
        status: missingOpenRouterApiKey ? 'warning' : 'online',
        detail: missingOpenRouterApiKey
          ? 'No API key set. Add your OpenRouter API key.'
          : providerModelCountDetail(models.length),
        capabilities,
        checkedAt: providerCheckedAt(),
      });
      setConnectionStatus(
        missingOpenRouterApiKey
          ? `${models.length} ${models.length === 1 ? 'model' : 'models'} found, but no API key is set.`
          : `Connected. ${models.length} ${models.length === 1 ? 'model' : 'models'} found.`,
      );
    } catch (error) {
      const fallbackModels = fallbackModelsForConnection(editingConnection, error);
      if (fallbackModels) {
        const connection = {
          ...editingConnection,
          model: fallbackModels.includes(editingConnection.model)
            ? editingConnection.model
            : selectFallbackModel
              ? fallbackModels[0]
              : editingConnection.model,
        };
        setAvailableConnectionModels(fallbackModels);
        setEditingConnection(connection);
        updateProviderHealth(connection.id, {
          status: 'online',
          detail: 'Using bundled model list.',
          checkedAt: providerCheckedAt(),
        });
        setConnectionStatus('Gemini does not expose this model list endpoint. Using bundled Gemini models.');
        return;
      }

      setAvailableConnectionModels([]);
      updateProviderHealth(editingConnection.id, {
        status: 'offline',
        detail: providerErrorMessage(error),
        checkedAt: providerCheckedAt(),
      });
      setConnectionStatus(
        `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function checkConnectionModels() {
    await loadConnectionModels(true);
  }

  async function loadComfyModelLists(
    connectionOverride?: ConnectionPreset,
    options: { showStatus?: boolean; markActive?: boolean } = {},
  ) {
    const connection = connectionOverride ?? connectionFromEditingConnection();
    if (!isComfyImageConnection(connection)) {
      setConnectionStatus('Choose a ComfyUI image provider before loading ComfyUI models.');
      return;
    }

    if (comfyProviderActionActive === 'models') {
      return;
    }

    if (options.markActive !== false) {
      setComfyProviderActionActive('models');
    }
    if (options.showStatus !== false) {
      setConnectionStatus('Loading ComfyUI model lists ...');
    }
    try {
      const [
        checkpoints,
        loras,
        vae,
        textEncoders,
        diffusionModels,
      ] = await Promise.all([
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'checkpoints' }),
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'loras' }),
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'vae' }),
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'text_encoders' }),
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'diffusion_models' }),
      ]);
      setAvailableComfyModels({
        checkpoints,
        loras,
        vae,
        text_encoders: textEncoders,
        diffusion_models: diffusionModels,
      });
      setEditingConnection(connection);
      const total = checkpoints.length + loras.length + vae.length + textEncoders.length + diffusionModels.length;
      if (total === 0) {
        const healthResult = await window.rpgraph.checkComfyConnection({ baseUrl: connection.baseUrl });
        if (!healthResult.ok) {
          updateProviderHealth(connection.id, {
            status: 'offline',
            detail: healthResult.error ?? 'ComfyUI is not reachable.',
            checkedAt: providerCheckedAt(),
          });
          if (options.showStatus !== false) {
            setConnectionStatus(healthResult.error ?? 'ComfyUI is not reachable.');
          }
          return;
        }
      }
      updateProviderHealth(
        connection.id,
        comfySetupHealth(connection, `Loaded ${total} ComfyUI model entr${total === 1 ? 'y' : 'ies'}.`),
      );
      if (options.showStatus !== false) {
        setConnectionStatus(`Loaded ${total} ComfyUI model entr${total === 1 ? 'y' : 'ies'}.`);
      }
    } catch (error) {
      setAvailableComfyModels({
        checkpoints: [],
        loras: [],
        vae: [],
        text_encoders: [],
        diffusion_models: [],
      });
      updateProviderHealth(connection.id, {
        status: 'offline',
        detail: providerErrorMessage(error),
        checkedAt: providerCheckedAt(),
      });
      if (options.showStatus !== false) {
        setConnectionStatus(
          `ComfyUI model list failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      if (options.markActive !== false) {
        setComfyProviderActionActive(null);
      }
    }
  }

  function comfyWorkflowPathForConnection(connection: ConnectionPreset) {
    return bundledComfyWorkflowPathForRole(connection.comfyWorkflowPath, comfyConnectionRole(connection));
  }

  async function inspectComfyWorkflow(
    connectionOverride?: ConnectionPreset,
    options: { showStatus?: boolean } = {},
  ) {
    const connection = connectionOverride ?? connectionFromEditingConnection();
    const role = comfyConnectionRole(connection);
    if (connection.kind !== 'comfyui' || role === null) {
      setComfyWorkflowInspection(null);
      return null;
    }

    const workflowPath = comfyWorkflowPathForConnection(connection);
    if (pendingComfyWorkflowRepair?.workflowPath !== workflowPath) {
      setPendingComfyWorkflowRepair(null);
      setComfyWorkflowRepairStatus('');
    }
    try {
      const inspection = await window.rpgraph.inspectComfyWorkflow({ workflowPath, role });
      setComfyWorkflowInspection(inspection);
      if (inspection.ok) {
        setPendingComfyWorkflowRepair(null);
        setComfyWorkflowRepairStatus('');
      }
      if (!inspection.ok && options.showStatus !== false) {
        setConnectionStatus(`ComfyUI workflow is not compatible: ${inspection.missing.join(', ')}.`);
      }
      return inspection;
    } catch (error) {
      const inspection: ComfyWorkflowInspection = {
        ok: false,
        format: 'unknown',
        role,
        modelSource: 'missing',
        placeholders: [],
        missing: [error instanceof Error ? error.message : String(error)],
        workflowPath,
        fileName: workflowPath.split(/[\\/]/).pop() ?? workflowPath,
      };
      setComfyWorkflowInspection(inspection);
      if (options.showStatus !== false) {
        setConnectionStatus(`ComfyUI workflow check failed: ${inspection.missing[0]}.`);
      }
      return inspection;
    }
  }

  async function repairComfyWorkflow(llmConnectionId: string) {
    const connection = connectionFromEditingConnection();
    if (connection.kind !== 'comfyui') {
      setConnectionStatus('Choose a ComfyUI provider before fixing a workflow.');
      return;
    }
    const llmConnection = connections.find((entry) => entry.id === llmConnectionId && isLlmConnection(entry));
    if (!llmConnection) {
      setComfyWorkflowRepairStatus('Choose an LLM provider to fix this workflow.');
      return;
    }

    const workflowPath = comfyWorkflowPathForConnection(connection);
    setComfyProviderActionActive('repair');
    setPendingComfyWorkflowRepair(null);
    setComfyWorkflowRepairStatus(`Fixing workflow with ${llmConnection.label} ...`);
    try {
      const result = await window.rpgraph.repairComfyWorkflow({
        workflowPath,
        role: comfyConnectionRole(connection) ?? 'image',
        connection: llmConnection,
      });
      setPendingComfyWorkflowRepair({
        workflowPath,
        workflowJson: result.workflowJson,
        inspection: result.inspection,
      });
      setComfyWorkflowRepairStatus(
        result.changed
          ? 'Workflow fixed and checked. Apply the fix to overwrite the workflow JSON.'
          : 'Workflow already passes the compatibility check.',
      );
      setConnectionStatus('ComfyUI workflow fix is ready to apply.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPendingComfyWorkflowRepair(null);
      setComfyWorkflowRepairStatus(`Workflow fix failed: ${message}`);
      setConnectionStatus(`ComfyUI workflow fix failed: ${message}`);
      notifySystem('error', `ComfyUI workflow fix failed: ${message}`);
    } finally {
      setComfyProviderActionActive(null);
    }
  }

  async function applyComfyWorkflowRepair() {
    const connection = connectionFromEditingConnection();
    const workflowPath = connection.kind === 'comfyui'
      ? comfyWorkflowPathForConnection(connection)
      : '';
    if (!pendingComfyWorkflowRepair || pendingComfyWorkflowRepair.workflowPath !== workflowPath) {
      setComfyWorkflowRepairStatus('Run Fix Prompt before applying a repair.');
      return;
    }

    setComfyProviderActionActive('apply-repair');
    setComfyWorkflowRepairStatus('Applying fixed workflow ...');
    try {
      const result = await window.rpgraph.applyComfyWorkflowRepair({
        workflowPath,
        role: comfyConnectionRole(connection) ?? 'image',
        workflowJson: pendingComfyWorkflowRepair.workflowJson,
      });
      setPendingComfyWorkflowRepair(null);
      setComfyWorkflowInspection(result.inspection);
      setComfyWorkflowRepairStatus('');
      setConnectionStatus(`ComfyUI workflow fixed and applied: ${result.fileName}.`);
      notifySystem('info', `ComfyUI workflow fixed and applied: ${result.fileName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setComfyWorkflowRepairStatus(`Apply failed: ${message}`);
      setConnectionStatus(`ComfyUI workflow apply failed: ${message}`);
      notifySystem('error', `ComfyUI workflow apply failed: ${message}`);
    } finally {
      setComfyProviderActionActive(null);
    }
  }

  async function selectComfyWorkflow() {
    const connection = connectionFromEditingConnection();
    if (connection.kind !== 'comfyui') {
      setConnectionStatus('Choose a ComfyUI provider before selecting a workflow.');
      return;
    }

    try {
      const result = await window.rpgraph.selectComfyWorkflow();
      if (result.canceled || !result.filePath) {
        return;
      }
      setEditingConnection({
        ...connection,
        comfyWorkflowPath: result.filePath,
      });
      setConnectionStatus(`ComfyUI workflow selected: ${result.fileName ?? result.filePath}`);
      void inspectComfyWorkflow({ ...connection, comfyWorkflowPath: result.filePath });
    } catch (error) {
      setConnectionStatus(
        `ComfyUI workflow selection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function selectBundledComfyWorkflow(workflowPath: string) {
    const connection = connectionFromEditingConnection();
    if (connection.kind !== 'comfyui') {
      setConnectionStatus('Choose a ComfyUI provider before selecting a workflow.');
      return;
    }
    const workflow = bundledComfyWorkflows.find((entry) => entry.apiWorkflowPath === workflowPath);
    const role = comfyConnectionRole(connection);
    if (!workflow || workflow.role !== role) {
      setConnectionStatus('Choose a workflow that matches the ComfyUI provider role.');
      return;
    }
    const nextConnection: ConnectionPreset = {
      ...connection,
      comfyWorkflowPath: workflow.apiWorkflowPath,
      comfyWorkflowSetupConfirmed: false,
    };
    setConnections((current) =>
      current.map((entry) => (entry.id === nextConnection.id ? nextConnection : entry)),
    );
    setEditingConnection(nextConnection);
    setComfyWorkflowInspection(null);
    setPendingComfyWorkflowRepair(null);
    setComfyWorkflowRepairStatus('');
    setConnectionStatus(`ComfyUI workflow selected: ${workflow.label}. Open the normal workflow in ComfyUI first.`);
  }

  function confirmComfyWorkflowSetup() {
    const connection = connectionFromEditingConnection();
    if (connection.kind !== 'comfyui') {
      setConnectionStatus('Choose a ComfyUI provider before confirming setup.');
      return;
    }
    const nextConnection: ConnectionPreset = {
      ...connection,
      comfyWorkflowSetupConfirmed: true,
    };
    setConnections((current) =>
      current.map((entry) => (entry.id === nextConnection.id ? nextConnection : entry)),
    );
    setEditingConnection(nextConnection);
    setComfyWorkflowInspection(null);
    setPendingComfyWorkflowRepair(null);
    setComfyWorkflowRepairStatus('');
    setConnectionStatus('ComfyUI setup confirmed. Provider settings are available.');
    void checkProviderConnection(nextConnection, { showStatus: true });
    void inspectComfyWorkflow(nextConnection, { showStatus: false });
    if (isComfyImageConnection(nextConnection)) {
      void loadComfyModelLists(nextConnection);
    }
  }

  async function generateComfyTestImage() {
    const connection = connectionFromEditingConnection();
    if (!isComfyImageConnection(connection)) {
      setConnectionStatus('Choose a ComfyUI image provider before generating an image.');
      return;
    }
    const missingFields = missingComfySetupFields(connection);
    if (missingFields.length > 0) {
      const message = comfySetupRequiredMessage(missingFields);
      updateProviderHealth(connection.id, comfySetupHealth(connection, message));
      setConnectionStatus(message);
      notifySystem('warning', message);
      return;
    }
    const workflowPath = comfyWorkflowPathForConnection(connection);
    const inspection = comfyWorkflowInspection?.workflowPath === workflowPath
      ? comfyWorkflowInspection
      : await inspectComfyWorkflow(connection);
    if (inspection && !inspection.ok) {
      setConnectionStatus(`ComfyUI workflow is not compatible: ${inspection.missing.join(', ')}.`);
      notifySystem('error', `ComfyUI workflow is not compatible: ${inspection.missing.join(', ')}.`);
      return;
    }

    setComfyProviderActionActive('generate');
    setConnectionStatus('Unloading local LLM models before ComfyUI generation ...');
    try {
      await unloadLocalLlmModelsForComfy('Local LLM unload before ComfyUI generation failed');
      setConnectionStatus('Generating image with ComfyUI ...');
      const result = await window.rpgraph.runComfyWorkflowPath({
        baseUrl: connection.baseUrl,
        workflowPath,
        width: connection.comfyWidth ?? defaultComfyWidth,
        height: connection.comfyHeight ?? defaultComfyHeight,
        prompt: connection.comfyPrompt || defaultComfyPrompt,
        checkpointName: connection.comfyCheckpointName ?? defaultComfyCheckpointName,
        diffusionModelName: connection.comfyDiffusionModelName ?? defaultComfyDiffusionModelName,
        vaeName: connection.comfyVaeName ?? defaultComfyVaeName,
        textEncoderName: connection.comfyTextEncoderName ?? defaultComfyTextEncoderName,
        loraSlots: runtimeComfyLoraSlots(connection.comfyLoraSlots ?? defaultComfyLoraSlots),
        deleteOutputs: connection.comfyDeleteImageOutputs !== false,
        timeoutMs: 180000,
      });
      setEditingConnection(connection);
      setComfyPreview(result);
      updateProviderHealth(connection.id, {
        status: 'online',
        detail: `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'}.`,
        checkedAt: providerCheckedAt(),
      });
      setConnectionStatus(`ComfyUI generated ${result.images.length} image${result.images.length === 1 ? '' : 's'}.`);
      notifySystem('info', `ComfyUI generated ${result.images.length} image${result.images.length === 1 ? '' : 's'}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateProviderHealth(connection.id, {
        status: 'offline',
        detail: message,
        checkedAt: providerCheckedAt(),
      });
      setConnectionStatus(`ComfyUI generation failed: ${message}`);
      notifySystem('error', `ComfyUI generation failed: ${message}`);
    } finally {
      setComfyProviderActionActive(null);
    }
  }

  async function loadCharacterComfyLoras(providerId: string) {
    const connection = connections.find((entry) => entry.id === providerId && isComfyImageConnection(entry));
    if (!connection) {
      throw new Error('Choose a ComfyUI image provider first.');
    }
    const cacheKey = `${connection.id}|${connection.baseUrl}`;
    const cachedLoras = characterComfyLoraCacheRef.current[cacheKey];
    if (cachedLoras) {
      return cachedLoras;
    }
    const loraRequest = window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'loras' });
    characterComfyLoraCacheRef.current = {
      ...characterComfyLoraCacheRef.current,
      [cacheKey]: loraRequest,
    };
    let loras: string[];
    try {
      loras = await loraRequest;
    } catch (error) {
      const nextCache = { ...characterComfyLoraCacheRef.current };
      delete nextCache[cacheKey];
      characterComfyLoraCacheRef.current = nextCache;
      throw error;
    }
    characterComfyLoraCacheRef.current = {
      ...characterComfyLoraCacheRef.current,
      [cacheKey]: loras,
    };
    updateProviderHealth(connection.id, {
      status: 'online',
      detail: `Loaded ${loras.length} ComfyUI LoRA${loras.length === 1 ? '' : 's'}.`,
      checkedAt: providerCheckedAt(),
    });
    if (editingConnection.id === connection.id) {
      setAvailableComfyModels((current) => ({
        ...current,
        loras,
      }));
    }
    return loras;
  }

  async function generateCharacterComfyPreview(request: {
    providerId: string;
    characterName: string;
    characterContext: string;
    loraName: string;
    appearance: string;
    scenarioPrompt: string;
  }) {
    const connection = connections.find((entry) => entry.id === request.providerId && isComfyImageConnection(entry));
    if (!connection) {
      throw new Error('Choose a ComfyUI image provider first.');
    }
    const missingFields = missingComfySetupFields(connection);
    if (missingFields.length > 0) {
      const message = comfySetupRequiredMessage(missingFields);
      updateProviderHealth(connection.id, comfySetupHealth(connection, message));
      throw new Error(message);
    }
    const appearance = request.appearance.trim();
    const scenarioPrompt = request.scenarioPrompt.trim();
    const prompt = appearance
      ? `character reference image of ${request.characterName}, ${appearance}${scenarioPrompt ? `, ${scenarioPrompt}` : ''}`
      : `character reference image of ${request.characterName}, ${request.characterContext}${scenarioPrompt ? `, ${scenarioPrompt}` : ''}`;
    await unloadLocalLlmModelsForComfy('Local LLM unload before character preview failed');
    const result = await window.rpgraph.runComfyWorkflowPath({
      baseUrl: connection.baseUrl,
      workflowPath: comfyWorkflowPathForConnection(connection),
      width: connection.comfyWidth ?? defaultComfyWidth,
      height: connection.comfyHeight ?? defaultComfyHeight,
      prompt,
      checkpointName: connection.comfyCheckpointName ?? defaultComfyCheckpointName,
      diffusionModelName: connection.comfyDiffusionModelName ?? defaultComfyDiffusionModelName,
      vaeName: connection.comfyVaeName ?? defaultComfyVaeName,
      textEncoderName: connection.comfyTextEncoderName ?? defaultComfyTextEncoderName,
      loraSlots: characterComfyLoraSlots(connection.comfyLoraSlots ?? defaultComfyLoraSlots, request.loraName),
      deleteOutputs: connection.comfyDeleteImageOutputs !== false,
      timeoutMs: 180000,
    });
    updateProviderHealth(connection.id, {
      status: 'online',
      detail: `Generated ${result.images.length} character preview image${result.images.length === 1 ? '' : 's'}.`,
      checkedAt: providerCheckedAt(),
    });
    return result.images.map((image) => ({
      dataUrl: image.dataUrl,
      filename: image.filename,
    }));
  }

  async function generateImageAssistantImages(request: {
    providerId: string;
    prompt: string;
    settings: { width: number; height: number; characterLora: string };
  }) {
    const connection = connections.find(
      (entry) => entry.id === request.providerId && isComfyImageConnection(entry),
    );
    if (!connection) {
      throw new Error('Choose a ComfyUI image provider first.');
    }
    const health = providerHealthByIdRef.current[connection.id];
    if (health?.status === 'offline') {
      throw new Error(`${connection.label} is offline${health.detail ? `: ${health.detail}` : '.'}`);
    }
    if (health?.status === 'warning') {
      throw new Error(`${connection.label} is not fully set up${health.detail ? `: ${health.detail}` : '.'}`);
    }
    const missingFields = missingComfySetupFields(connection);
    if (missingFields.length > 0) {
      const message = comfySetupRequiredMessage(missingFields);
      updateProviderHealth(connection.id, comfySetupHealth(connection, message));
      throw new Error(message);
    }

    setComfyProviderActionActive('generate');
    setImageAssistantModelState(connection.id, 'loading');
    try {
      const unloadFailures = await unloadLocalLlmModelsForComfy('Local LLM unload before image generation failed');
      if (unloadFailures.length > 0) {
        throw new Error(`Could not unload local LLM models: ${unloadFailures.join('; ')}`);
      }
      const result = await window.rpgraph.runComfyWorkflowPath({
        baseUrl: connection.baseUrl,
        workflowPath: comfyWorkflowPathForConnection(connection),
        width: validComfyDimension(request.settings.width, connection.comfyWidth ?? defaultComfyWidth),
        height: validComfyDimension(request.settings.height, connection.comfyHeight ?? defaultComfyHeight),
        prompt: request.prompt.trim(),
        checkpointName: connection.comfyCheckpointName ?? defaultComfyCheckpointName,
        diffusionModelName: connection.comfyDiffusionModelName ?? defaultComfyDiffusionModelName,
        vaeName: connection.comfyVaeName ?? defaultComfyVaeName,
        textEncoderName: connection.comfyTextEncoderName ?? defaultComfyTextEncoderName,
        loraSlots: characterComfyLoraSlots(
          connection.comfyLoraSlots ?? defaultComfyLoraSlots,
          request.settings.characterLora,
        ),
        deleteOutputs: connection.comfyDeleteImageOutputs !== false,
        timeoutMs: 180000,
      });
      if (result.images.length === 0) {
        throw new Error('ComfyUI finished without returning an image.');
      }
      updateProviderHealth(connection.id, {
        status: 'online',
        detail: `Generated ${result.images.length} image${result.images.length === 1 ? '' : 's'}.`,
        capabilities: { image: true },
        checkedAt: providerCheckedAt(),
      });
      setImageAssistantModelState(connection.id, 'loaded');
      return result.images.map((image) => image.dataUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateProviderHealth(connection.id, {
        status: 'offline',
        detail: message,
        capabilities: { image: true },
        checkedAt: providerCheckedAt(),
      });
      setImageAssistantModelState(connection.id, 'unknown');
      throw error;
    } finally {
      setComfyProviderActionActive(null);
    }
  }

  async function prepareImageAssistantLlmProvider(request: {
    llmProviderId: string;
    comfyProviderId?: string;
  }) {
    const llmConnection = connections.find((entry) => entry.id === request.llmProviderId);
    if (!llmConnection || !isLocalProviderConnection(llmConnection)) {
      // API providers do not compete with ComfyUI for local VRAM,
      // so the ComfyUI model can stay loaded.
      return;
    }
    const comfyConnection = connections.find(
      (entry) => entry.id === request.comfyProviderId && isComfyImageConnection(entry),
    );
    if (comfyConnection) {
      setImageAssistantModelState(comfyConnection.id, 'unloading');
      try {
        await window.rpgraph.freeComfyMemory({ baseUrl: comfyConnection.baseUrl });
        setImageAssistantModelState(comfyConnection.id, 'unloaded');
      } catch {
        // An unreachable ComfyUI holds no VRAM; keep the assistant usable.
        setImageAssistantModelState(comfyConnection.id, 'unknown');
      }
    }
    setImageAssistantModelState(llmConnection.id, 'loading');
    try {
      if (isLmStudioConnection(llmConnection)) {
        await window.rpgraph.loadLmStudioModel(llmConnection);
      } else if (isLlamaCppConnection(llmConnection)) {
        await window.rpgraph.loadLlamaCppModel(llmConnection);
      } else if (isOllamaConnection(llmConnection)) {
        await window.rpgraph.loadOllamaModel(llmConnection);
      }
      setImageAssistantModelState(llmConnection.id, 'loaded');
    } catch (error) {
      setImageAssistantModelState(llmConnection.id, 'unknown');
      throw error;
    }
  }

  async function setImageAssistantLlmModelLoaded(providerId: string, loaded: boolean) {
    const connection = connections.find((entry) => entry.id === providerId);
    if (!connection || !isLocalProviderConnection(connection)) {
      throw new Error('Manual model control requires a local LM Studio, Ollama, or llama.cpp provider.');
    }
    setImageAssistantModelState(connection.id, loaded ? 'loading' : 'unloading');
    try {
      if (loaded) {
        const comfyConnections = connections.filter(isComfyImageConnection);
        for (const comfyConnection of comfyConnections) {
          setImageAssistantModelState(comfyConnection.id, 'unloading');
          try {
            await window.rpgraph.freeComfyMemory({ baseUrl: comfyConnection.baseUrl });
            setImageAssistantModelState(comfyConnection.id, 'unloaded');
          } catch {
            // An unreachable ComfyUI holds no VRAM; keep loading the LLM.
            setImageAssistantModelState(comfyConnection.id, 'unknown');
          }
        }
      }
      if (isLmStudioConnection(connection)) {
        await (loaded
          ? window.rpgraph.loadLmStudioModel(connection)
          : window.rpgraph.unloadLmStudioModels(connection));
      } else if (isOllamaConnection(connection)) {
        await (loaded
          ? window.rpgraph.loadOllamaModel(connection)
          : window.rpgraph.unloadOllamaModels(connection));
      } else if (isLlamaCppConnection(connection)) {
        await (loaded
          ? window.rpgraph.loadLlamaCppModel(connection)
          : window.rpgraph.unloadLlamaCppModels(connection));
      }
      setImageAssistantModelState(connection.id, loaded ? 'loaded' : 'unloaded');
    } catch (error) {
      setImageAssistantModelState(connection.id, 'unknown');
      throw error;
    }
  }

  async function refreshImageAssistantModelState(providerId: string) {
    const connection = connections.find((entry) => entry.id === providerId);
    if (
      !connection ||
      !isLocalProviderConnection(connection) ||
      !(isLmStudioConnection(connection) || isOllamaConnection(connection) || isLlamaCppConnection(connection))
    ) {
      return;
    }
    let probed: ImageAssistantModelState;
    try {
      const result = isLmStudioConnection(connection)
        ? await window.rpgraph.isLmStudioModelLoaded(connection)
        : isLlamaCppConnection(connection)
          ? await window.rpgraph.isLlamaCppModelLoaded(connection)
          : await window.rpgraph.isOllamaModelLoaded(connection);
      probed = result.loaded === true ? 'loaded' : result.loaded === false ? 'unloaded' : 'unknown';
    } catch {
      probed = 'unknown';
    }
    setImageAssistantModelStateById((current) => {
      const state = current[connection.id];
      if (state === 'loading' || state === 'unloading') {
        return current;
      }
      return { ...current, [connection.id]: probed };
    });
  }

  async function unloadImageAssistantComfyModel(providerId: string) {
    const connection = connections.find(
      (entry) => entry.id === providerId && isComfyImageConnection(entry),
    );
    if (!connection) {
      throw new Error('Choose a ComfyUI image provider first.');
    }
    setImageAssistantModelState(connection.id, 'unloading');
    try {
      await window.rpgraph.freeComfyMemory({ baseUrl: connection.baseUrl });
      setImageAssistantModelState(connection.id, 'unloaded');
    } catch (error) {
      setImageAssistantModelState(connection.id, 'unknown');
      throw error;
    }
  }

  async function generateCharacterVoicePreview(request: {
    providerId: string;
    speechText: string;
    sampleDataUrl: string;
  }) {
    const connection = connections.find((entry) => entry.id === request.providerId && isComfyVoiceConnection(entry));
    if (!connection) {
      throw new Error('Choose a ComfyUI voice provider first.');
    }
    const speechText = request.speechText.trim();
    if (!speechText) {
      throw new Error('Enter a text to speak first.');
    }
    if (!request.sampleDataUrl) {
      throw new Error('Upload a voice sample for this character first.');
    }
    await unloadLocalLlmModelsForComfy('Local LLM unload before voice preview failed');
    beginVoiceGeneration();
    let result: Awaited<ReturnType<typeof window.rpgraph.runComfyVoiceWorkflowPath>>;
    try {
      result = await window.rpgraph.runComfyVoiceWorkflowPath({
        baseUrl: connection.baseUrl,
        workflowPath: comfyWorkflowPathForConnection(connection),
        speechText,
        sampleDataUrl: request.sampleDataUrl,
        deleteOutputs: connection.comfyDeleteVoiceOutputs !== false,
        timeoutMs: 300000,
      });
    } finally {
      endVoiceGeneration();
    }
    if (result.cleanupFailed) {
      notifyVoiceCleanupFailure(connection);
    }
    updateProviderHealth(connection.id, {
      status: 'online',
      detail: `Generated ${result.audio.length} voice clip${result.audio.length === 1 ? '' : 's'}.`,
      capabilities: { voice: true },
      checkedAt: providerCheckedAt(),
    });
    return result.audio.map((clip) => ({
      dataUrl: clip.dataUrl,
      filename: clip.filename,
    }));
  }

  async function unloadCharacterComfyModels(providerId: string) {
    const connection = connections.find((entry) => entry.id === providerId && entry.kind === 'comfyui');
    if (!connection) {
      throw new Error('Choose a ComfyUI provider first.');
    }
    await window.rpgraph.freeComfyMemory({ baseUrl: connection.baseUrl });
    updateProviderHealth(connection.id, {
      status: 'online',
      detail: 'ComfyUI models unloaded.',
      checkedAt: providerCheckedAt(),
    });
  }

  async function unloadComfyModels() {
    const connection = connectionFromEditingConnection();
    if (connection.kind !== 'comfyui') {
      setConnectionStatus('Choose a ComfyUI provider before unloading models.');
      return;
    }

    setComfyProviderActionActive('unload');
    setConnectionStatus('Requesting ComfyUI model unload ...');
    try {
      await window.rpgraph.freeComfyMemory({ baseUrl: connection.baseUrl });
      setEditingConnection(connection);
      setConnectionStatus('ComfyUI unload requested.');
      notifySystem('info', 'ComfyUI unload requested.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConnectionStatus(`ComfyUI unload failed: ${message}`);
      notifySystem('error', `ComfyUI unload failed: ${message}`);
    } finally {
      setComfyProviderActionActive(null);
    }
  }

  const unloadAllProviderModelsForClose = useCallback(async () => {
    const failures: string[] = [];
    await Promise.all(
      connections.map(async (connection) => {
        try {
          if (connection.kind === 'comfyui') {
            await window.rpgraph.freeComfyMemory({ baseUrl: connection.baseUrl });
            return;
          }
          if (isLmStudioConnection(connection)) {
            await window.rpgraph.unloadLmStudioModels(connection);
            return;
          }
          if (isOllamaConnection(connection)) {
            await window.rpgraph.unloadOllamaModels(connection);
            return;
          }
          if (isLlamaCppConnection(connection)) {
            await window.rpgraph.unloadLlamaCppModels(connection);
          }
        } catch (error) {
          failures.push(`${connection.label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
    if (failures.length > 0) {
      notifySystem('warning', `Provider unload before close failed: ${failures.join('; ')}`);
    }
  }, [connections, notifySystem]);

  async function loadLmStudioModel() {
    const connection = connectionFromEditingConnection();
    if (!isLmStudioConnection(connection)) {
      setConnectionStatus('LM Studio tools are only available for LM Studio providers.');
      return;
    }
    if (!connection.model.trim()) {
      setConnectionStatus('Choose a model ID before loading an LM Studio model.');
      return;
    }

    setLmStudioModelActionActive('load');
    setConnectionStatus(`Loading LM Studio model "${connection.model}" ...`);
    try {
      const result = await window.rpgraph.loadLmStudioModel(connection);
      setEditingConnection(connection);
      setConnectionStatus(
        result.method === 'cli'
          ? `LM Studio load command sent for "${connection.model}".`
          : `LM Studio loaded "${connection.model}".`,
      );
    } catch (error) {
      setConnectionStatus(
        `LM Studio load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLmStudioModelActionActive(null);
    }
  }

  async function unloadLmStudioModels() {
    const connection = connectionFromEditingConnection();
    if (!isLmStudioConnection(connection)) {
      setConnectionStatus('LM Studio tools are only available for LM Studio providers.');
      return;
    }

    setLmStudioModelActionActive('unload');
    setConnectionStatus('Unloading LM Studio models ...');
    try {
      const result = await window.rpgraph.unloadLmStudioModels(connection);
      setEditingConnection(connection);
      setConnectionStatus(
        result.method === 'cli'
          ? 'LM Studio unload all command sent.'
          : result.unloadedCount === 0
          ? 'LM Studio did not report any loaded models.'
          : `LM Studio unloaded ${result.unloadedCount} ${result.unloadedCount === 1 ? 'model' : 'models'}.`,
      );
    } catch (error) {
      setConnectionStatus(
        `LM Studio unload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLmStudioModelActionActive(null);
    }
  }

  async function loadOllamaModel() {
    const connection = connectionFromEditingConnection();
    if (!isOllamaConnection(connection)) {
      setConnectionStatus('Ollama tools are only available for Ollama providers.');
      return;
    }
    if (!connection.model.trim()) {
      setConnectionStatus('Choose a model ID before loading an Ollama model.');
      return;
    }

    setOllamaModelActionActive('load');
    setConnectionStatus(`Loading Ollama model "${connection.model}" ...`);
    try {
      await window.rpgraph.loadOllamaModel(connection);
      setEditingConnection(connection);
      setConnectionStatus(`Ollama loaded "${connection.model}".`);
    } catch (error) {
      setConnectionStatus(
        `Ollama load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setOllamaModelActionActive(null);
    }
  }

  async function unloadOllamaModels() {
    const connection = connectionFromEditingConnection();
    if (!isOllamaConnection(connection)) {
      setConnectionStatus('Ollama tools are only available for Ollama providers.');
      return;
    }

    setOllamaModelActionActive('unload');
    setConnectionStatus('Unloading Ollama running models ...');
    try {
      const result = await window.rpgraph.unloadOllamaModels(connection);
      setEditingConnection(connection);
      setConnectionStatus(
        result.unloadedCount === 0
          ? 'Ollama did not report any running models.'
          : `Ollama unloaded ${result.unloadedCount} ${result.unloadedCount === 1 ? 'model' : 'models'}.`,
      );
    } catch (error) {
      setConnectionStatus(
        `Ollama unload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setOllamaModelActionActive(null);
    }
  }

  async function loadLlamaCppModel() {
    const connection = connectionFromEditingConnection();
    if (!isLlamaCppConnection(connection)) return;
    if (!connection.model.trim()) {
      setConnectionStatus('Choose a model ID before loading a llama.cpp model.');
      return;
    }
    setOllamaModelActionActive('load');
    setConnectionStatus(`Loading llama.cpp model "${connection.model}" ...`);
    try {
      await window.rpgraph.loadLlamaCppModel(connection);
      const models = await window.rpgraph.listLlamaCppModels(connection);
      updateLlamaCppModelCache(connection.id, models);
      setConnectionStatus(`llama.cpp loaded "${connection.model}".`);
    } catch (error) {
      setConnectionStatus(`llama.cpp load failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOllamaModelActionActive(null);
    }
  }

  async function unloadLlamaCppModels() {
    const connection = connectionFromEditingConnection();
    if (!isLlamaCppConnection(connection)) return;
    setOllamaModelActionActive('unload');
    setConnectionStatus('Unloading llama.cpp models ...');
    try {
      const result = await window.rpgraph.unloadLlamaCppModels(connection);
      const models = await window.rpgraph.listLlamaCppModels(connection);
      updateLlamaCppModelCache(connection.id, models);
      setConnectionStatus(result.unloadedCount === 0
        ? 'llama.cpp did not report any active models.'
        : `llama.cpp unloaded ${result.unloadedCount} ${result.unloadedCount === 1 ? 'model' : 'models'}.`);
    } catch (error) {
      setConnectionStatus(`llama.cpp unload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOllamaModelActionActive(null);
    }
  }

  async function resolveConnection(
    connectionId?: string,
    purpose = 'an LLM node',
    signal?: AbortSignal,
  ): Promise<ConnectionPreset> {
    const connection = connections.find(
      (entry) => entry.id === (connectionId ?? defaultConnectionId),
    );
    if (!connection) {
      throw new Error(`Select an LLM connection for ${purpose} first.`);
    }
    if (!isLlmConnection(connection)) {
      throw new Error(`Select an LLM connection for ${purpose}; "${connection.label}" is a ComfyUI image provider.`);
    }

    if (connection.model.trim()) {
      return connection;
    }

    let cleanupAbort: (() => void) | undefined;
    let models: string[];
    try {
      models = await window.rpgraph.listModels(connection, (cancel) => {
        if (signal) {
          if (signal.aborted) {
            cancel();
            return;
          }
          signal.addEventListener('abort', cancel, { once: true });
          cleanupAbort = () => signal.removeEventListener('abort', cancel);
        }
      });
    } finally {
      cleanupAbort?.();
    }
    if (!models[0]) {
      throw new Error('No model is configured for this provider.');
    }

    const updated = { ...connection, model: models[0] };
    setConnections((current) =>
      current.map((entry) => (entry.id === updated.id ? updated : entry)),
    );
    return updated;
  }

  function selectConnection(connection: ConnectionPreset) {
    setConnectionDraftPending(false);
    setEditingConnection({ ...connection });
    setAvailableConnectionModels([]);
    setAvailableComfyModels({
      checkpoints: [],
      loras: [],
      vae: [],
      text_encoders: [],
      diffusion_models: [],
    });
    setComfyWorkflowInspection(null);
    setPendingComfyWorkflowRepair(null);
    setComfyWorkflowRepairStatus('');
    setConnectionStatus('');
    void checkProviderConnection(connection, { showStatus: true });
    if (connection.kind === 'comfyui' && connection.comfyWorkflowSetupConfirmed === true) {
      void inspectComfyWorkflow(connection, { showStatus: false });
      if (isComfyImageConnection(connection)) {
        void loadComfyModelLists(connection);
      }
    }
  }

  function editConnection(field: keyof ConnectionPreset, value: ConnectionPreset[keyof ConnectionPreset]) {
    let nextConnection = { ...editingConnection, [field]: value };
    if (field === 'model' && isLmStudioConnection(nextConnection)) {
      const modelDetails = lmStudioModelsByConnectionIdRef.current[nextConnection.id] ?? [];
      nextConnection = connectionWithLmStudioCapabilities(nextConnection, modelDetails);
      updateProviderHealth(nextConnection.id, {
        ...(providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const }),
        capabilities: lmStudioCapabilitiesForConnection(nextConnection, modelDetails),
      });
    } else if (field === 'model' && isLlamaCppConnection(nextConnection)) {
      const modelDetails = llamaCppModelsByConnectionIdRef.current[nextConnection.id] ?? [];
      nextConnection = connectionWithLlamaCppCapabilities(nextConnection, modelDetails);
      updateProviderHealth(nextConnection.id, {
        ...(providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const }),
        capabilities: llamaCppCapabilitiesForConnection(nextConnection, modelDetails),
      });
    } else if (field === 'model' && isOllamaConnection(nextConnection)) {
      const modelDetails = ollamaModelsByConnectionIdRef.current[nextConnection.id] ?? [];
      nextConnection = connectionWithOllamaCapabilities(nextConnection, modelDetails);
      updateProviderHealth(nextConnection.id, {
        ...(providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const }),
        capabilities: ollamaCapabilitiesForConnection(nextConnection, modelDetails),
      });
    } else if (field === 'model' && isOpenRouterConnection(nextConnection)) {
      const modelDetails = openRouterModelsByConnectionIdRef.current[nextConnection.id] ?? [];
      nextConnection = connectionWithOpenRouterCapabilities(nextConnection, modelDetails);
      const selectedModel = modelDetails.find((model) => model.id === nextConnection.model);
      nextConnection.ttsVoice = selectedModel?.supportedVoices.length
        ? selectedModel.supportedVoices.includes(nextConnection.ttsVoice ?? '')
          ? nextConnection.ttsVoice
          : selectedModel.supportedVoices[0]
        : undefined;
      updateProviderHealth(nextConnection.id, {
        ...(providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const }),
        capabilities: openRouterCapabilitiesForConnection(nextConnection, modelDetails),
      });
    } else if (field === 'model' && isGeminiConnection(nextConnection)) {
      const modelDetails = geminiModelsByConnectionIdRef.current[nextConnection.id] ?? [];
      nextConnection = connectionWithGeminiCapabilities(nextConnection, modelDetails);
      updateProviderHealth(nextConnection.id, {
        ...(providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const }),
        capabilities: geminiCapabilitiesForConnection(nextConnection, modelDetails),
      });
    } else if (
      nextConnection.kind === 'comfyui' &&
      (
        field === 'comfyCheckpointName' ||
        field === 'comfyDiffusionModelName' ||
        field === 'comfyVaeName' ||
        field === 'comfyTextEncoderName'
      )
    ) {
      const currentHealth = providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const };
      if (currentHealth.status === 'online' || currentHealth.status === 'warning') {
        updateProviderHealth(nextConnection.id, comfySetupHealth(nextConnection, 'ComfyUI setup is complete.'));
      }
    }
    setEditingConnection(nextConnection);
    setConnections((current) =>
      current.map((entry) => (entry.id === nextConnection.id ? nextConnection : entry)),
    );
    if (field === 'baseUrl' || field === 'apiKey') {
      updateProviderHealth(editingConnection.id, {
        status: 'unknown',
        detail: 'Provider settings changed.',
      });
      setAvailableConnectionModels([]);
      setAvailableComfyModels({
        checkpoints: [],
        loras: [],
        vae: [],
        text_encoders: [],
        diffusion_models: [],
      });
      setComfyWorkflowInspection(null);
      setPendingComfyWorkflowRepair(null);
      setComfyWorkflowRepairStatus('');
    }
  }

  const editingConnectionCapabilities = isLmStudioConnection(editingConnection)
    ? lmStudioCapabilitiesForConnection(editingConnection, lmStudioModelsByConnectionId[editingConnection.id] ?? [])
    : isLlamaCppConnection(editingConnection)
      ? llamaCppCapabilitiesForConnection(editingConnection, llamaCppModelsByConnectionId[editingConnection.id] ?? [])
    : isOllamaConnection(editingConnection)
      ? ollamaCapabilitiesForConnection(editingConnection, ollamaModelsByConnectionId[editingConnection.id] ?? [])
      : isOpenRouterConnection(editingConnection)
        ? openRouterCapabilitiesForConnection(editingConnection, openRouterModelsByConnectionId[editingConnection.id] ?? [])
        : isGeminiConnection(editingConnection)
          ? geminiCapabilitiesForConnection(editingConnection, geminiModelsByConnectionId[editingConnection.id] ?? [])
        : providerHealthById[editingConnection.id]?.capabilities;
  const editingConnectionVoiceModels = isOpenRouterConnection(editingConnection)
    ? openRouterModelsByConnectionId[editingConnection.id]
    : isGeminiConnection(editingConnection)
      ? geminiModelsByConnectionId[editingConnection.id]
      : undefined;
  const editingConnectionSupportedVoices = editingConnectionVoiceModels
        ?.find((model) => model.id === editingConnection.model)
        ?.supportedVoices ?? [];
  const editingConnectionSupportedParameters = editingConnectionVoiceModels
        ?.find((model) => model.id === editingConnection.model)
        ?.supportedParameters ?? [];
  const editingComfyWorkflowPath = comfyWorkflowPathForConnection(editingConnection);
  const comfyWorkflowRepairReady = !!pendingComfyWorkflowRepair && pendingComfyWorkflowRepair.workflowPath === editingComfyWorkflowPath;
  const comfyWorkflowRepairInspection = pendingComfyWorkflowRepair?.workflowPath === editingComfyWorkflowPath
    ? pendingComfyWorkflowRepair.inspection
    : null;
  const modelCapabilitiesSourceLabel = isLmStudioConnection(editingConnection)
    ? 'LM Studio'
    : isLlamaCppConnection(editingConnection)
      ? 'llama.cpp'
    : isOllamaConnection(editingConnection)
      ? 'Ollama'
      : isOpenRouterConnection(editingConnection)
        ? 'OpenRouter'
        : isGeminiConnection(editingConnection)
          ? 'Google Gemini'
          : undefined;

  return {
    showConnections,
    setShowConnections,
    comfyPreview,
    setComfyPreview,
    editingConnection,
    setEditingConnection,
    connectionDraftPending,
    setConnectionDraftPending,
    availableConnectionModels,
    availableComfyModels,
    comfyWorkflowInspection,
    connectionStatus,
    providerHealthById,
    imageAssistantModelStateById,
    lmStudioModelsByConnectionId,
    openRouterModelsByConnectionId,
    geminiModelsByConnectionId,
    ollamaModelsByConnectionId,
    llamaCppModelsByConnectionId,
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
    selectComfyWorkflow,
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
  };
}
