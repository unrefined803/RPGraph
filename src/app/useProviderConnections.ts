import { isTextGenerationConnection } from '../llm/textProvider';
import type { ImageGenerationReference } from '../images/references';
import { generateApiImages, isImageGenerationConnection, supportsImageGenerationReferences } from '../images/providers';
import { localModelApi } from '../llm/localModelApi';
import type { CompatibleModelInfo } from '../../shared/compatibleModels.cjs';
import { normalizeReasoningEffort } from '../../shared/reasoning.cjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ComfyGeneratedImage } from '../comfy/api';
import type { ComfyWorkflowInspection } from '../comfy/workflowCompatibility';
import {
  compositeCapabilitiesForConnection,
  connectionWithCompositeCapabilities as connectionWithCompositeCapabilitiesForModels,
  connectionWithGeminiCapabilities as connectionWithGeminiCapabilitiesForModels,
  connectionWithLmStudioCapabilities as connectionWithLmStudioCapabilitiesForModels,
  connectionWithLlamaCppCapabilities as connectionWithLlamaCppCapabilitiesForModels,
  connectionWithOllamaCapabilities as connectionWithOllamaCapabilitiesForModels,
  connectionWithOpenRouterCapabilities as connectionWithOpenRouterCapabilitiesForModels,
  connectionWithVeniceCapabilities as connectionWithVeniceCapabilitiesForModels,
  connectionWithOpenRouterReasoning,
  connectionWithLmStudioReasoning,
  connectionWithOllamaReasoning,
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
  veniceCapabilitiesForConnection,
} from './providerCapabilities';
import {
  inferredProviderKind,
  isCompositeConnection,
  isLlamaCppConnection,
  isLmStudioConnection,
  isManagedLocalConnection,
  isLocalProviderConnection,
  isOllamaConnection,
  isOpenRouterConnection,
  isGeminiConnection,
  llmProviderKind,
  isVeniceConnection,
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
  defaultComfyCfg,
  defaultComfySampler,
  defaultComfyScheduler,
  defaultComfySteps,
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
  ChatGPTModelInfo,
  ComfyConnectionRole,
  CompositeModelInfo,
  ConnectionPreset,
  GeminiModelInfo,
  LmStudioModelInfo,
  LlamaCppModelInfo,
  OllamaModelInfo,
  OpenRouterModelInfo,
  ProviderConnectionHealth,
  VeniceModelInfo,
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
  samplers: string[];
  schedulers: string[];
};

const recommendedOpenRouterTtsModel = 'google/gemini-3.1-flash-tts-preview';
const localProviderPollIntervalMs = 6000;

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
  const [chatgptModelsByProfileId, setChatGPTModelsByProfileId] = useState<Record<string, ChatGPTModelInfo[]>>({});
  const chatgptModelsRef = useRef<Record<string, ChatGPTModelInfo[]>>({});
  const chatgptCatalogVersionRef = useRef(0);
  const [availableComfyModels, setAvailableComfyModels] = useState<AvailableComfyModels>({
    checkpoints: [],
    loras: [],
    vae: [],
    text_encoders: [],
    diffusion_models: [],
    samplers: [],
    schedulers: [],
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
  const [compositeModelsByConnectionId, setCompositeModelsByConnectionId] = useState<Record<string, CompositeModelInfo[]>>({});
  const compositeModelsByConnectionIdRef = useRef<Record<string, CompositeModelInfo[]>>({});
  const [geminiModelsByConnectionId, setGeminiModelsByConnectionId] = useState<Record<string, GeminiModelInfo[]>>({});
  const geminiModelsByConnectionIdRef = useRef<Record<string, GeminiModelInfo[]>>({});
  const [veniceModelsByConnectionId, setVeniceModelsByConnectionId] = useState<Record<string, VeniceModelInfo[]>>({});
  const veniceModelsByConnectionIdRef = useRef<Record<string, VeniceModelInfo[]>>({});
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
    const health = providerHealthByIdRef.current[connection.id];
    return isTextGenerationConnection(connection, isOpenRouterConnection(connection) && openRouterModelsByConnectionIdRef.current[connection.id]
      ? { status: health?.status ?? 'unknown', capabilities: openRouterCapabilitiesForConnection(connection, openRouterModelsByConnectionIdRef.current[connection.id]) }
      : health);
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
    compositeModelsByConnectionIdRef.current = compositeModelsByConnectionId;
  }, [compositeModelsByConnectionId]);
  useEffect(() => {
    geminiModelsByConnectionIdRef.current = geminiModelsByConnectionId;
  }, [geminiModelsByConnectionId]);
  useEffect(() => {
    veniceModelsByConnectionIdRef.current = veniceModelsByConnectionId;
  }, [veniceModelsByConnectionId]);
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
      samplers: [],
      schedulers: [],
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
      samplers: [],
      schedulers: [],
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
      samplers: [],
      schedulers: [],
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
    // Provider presets reference a reusable account; changing type never signs it out.
    nextConnection.chatgptProfileId = preset.providerKind === 'chatgpt'
      ? !connectionDraftPending && editingConnection.providerKind === 'chatgpt' ? editingConnection.chatgptProfileId : undefined
      : undefined;
    if (preset.providerKind === 'chatgpt') {
      nextConnection.apiKey = '';
      nextConnection.vision = false;
      nextConnection.reasoningEffort = 'auto';
      delete nextConnection.apiKeyEncrypted;
    }
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
      samplers: [],
      schedulers: [],
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
    return connectionWithReasoning({
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
    });
  }

  function applyConnectionToAllNodes() {
    const connection = connectionFromEditingConnection();
    if (!isLlmConnection(connection)) {
      setConnectionStatus('ComfyUI cannot be applied to LLM nodes.');
      return;
    }
    const affectedCount = nodesRef.current.filter((node) =>
      (Object.prototype.hasOwnProperty.call(node.data, 'connectionId') &&
        node.data.connectionId !== connection.id) ||
      (Object.prototype.hasOwnProperty.call(node.data, 'phoneAppsNotesConnectionId') &&
        node.data.phoneAppsNotesConnectionId !== connection.id),
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
        Object.prototype.hasOwnProperty.call(node.data, 'connectionId') ||
        Object.prototype.hasOwnProperty.call(node.data, 'phoneAppsNotesConnectionId')
          ? {
              ...node,
              data: {
                ...node.data,
                ...(Object.prototype.hasOwnProperty.call(node.data, 'connectionId')
                  ? { connectionId: connection.id }
                  : {}),
                ...(Object.prototype.hasOwnProperty.call(node.data, 'phoneAppsNotesConnectionId')
                  ? { phoneAppsNotesConnectionId: connection.id }
                  : {}),
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
      [connectionId]: { ...health, comfyImageReferences: health.comfyImageReferences ?? providerHealthByIdRef.current[connectionId]?.comfyImageReferences },
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

  function updateCompositeModelCache(connectionId: string, models: CompositeModelInfo[]) {
    compositeModelsByConnectionIdRef.current = {
      ...compositeModelsByConnectionIdRef.current,
      [connectionId]: models,
    };
    setCompositeModelsByConnectionId(compositeModelsByConnectionIdRef.current);
  }

  function updateGeminiModelCache(connectionId: string, models: GeminiModelInfo[]) {
    geminiModelsByConnectionIdRef.current = {
      ...geminiModelsByConnectionIdRef.current,
      [connectionId]: models,
    };
    setGeminiModelsByConnectionId(geminiModelsByConnectionIdRef.current);
  }

  function updateVeniceModelCache(connectionId: string, models: VeniceModelInfo[]) {
    veniceModelsByConnectionIdRef.current = {
      ...veniceModelsByConnectionIdRef.current,
      [connectionId]: models,
    };
    setVeniceModelsByConnectionId(veniceModelsByConnectionIdRef.current);
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

  const [compatibleModels, setCompatibleModels] = useState<Record<string, CompatibleModelInfo[]>>({});
  const compatibleModelsRef = useRef(compatibleModels);
  const compatibleRequestsRef = useRef<Record<string, number>>({});

  function compatibleCacheKey(connection: ConnectionPreset) {
    return JSON.stringify([connection.id, connection.baseUrl, connection.apiKey]);
  }

  function compatibleDetails(connection: ConnectionPreset) {
    return compatibleModelsRef.current[compatibleCacheKey(connection)]?.find((model) => model.id === connection.model);
  }

  function connectionWithCompatibleCapabilities(connection: ConnectionPreset): ConnectionPreset {
    const detail = compatibleDetails(connection);
    return {
      ...connection,
      ...(detail?.capabilities.vision !== undefined ? { vision: detail.capabilities.vision } : {}),
      reasoningCapabilities: detail?.reasoning,
      reasoningEffort: normalizeReasoningEffort(connection.reasoningEffort, detail?.reasoning),
      compatibleReasoningFormat: detail?.reasoningFormat,
    };
  }

  async function listGenericModels(connection: ConnectionPreset, onAbort?: (cancel: () => void) => void) {
    if (connection.providerKind === 'chatgpt') {
      const prepared = await prepareChatGPTConnection(connection);
      const version = chatgptCatalogVersionRef.current;
      const models = await window.rpgraph.chatgpt.listModels(prepared, onAbort);
      if (prepared.chatgptProfileId && version === chatgptCatalogVersionRef.current) {
        chatgptModelsRef.current = { ...chatgptModelsRef.current, [prepared.chatgptProfileId]: models };
        setChatGPTModelsByProfileId(chatgptModelsRef.current);
      }
      return models.map(model => model.id);
    }
    if (connection.providerKind !== 'openai-compatible') return window.rpgraph.listModels(connection, onAbort);
    const key = compatibleCacheKey(connection);
    const version = (compatibleRequestsRef.current[key] ?? 0) + 1;
    compatibleRequestsRef.current[key] = version;
    const details = await window.rpgraph.listCompatibleModels(connection, onAbort);
    if (compatibleRequestsRef.current[key] === version) {
      compatibleModelsRef.current = { ...compatibleModelsRef.current, [key]: details };
      setCompatibleModels(compatibleModelsRef.current);
      applyDetectedConnectionCapabilities(connection);
    }
    return details.map((model) => model.id);
  }

  function connectionWithReasoning(connection: ConnectionPreset) {
    if (connection.providerKind === 'chatgpt') return { ...connection, reasoningEffort: 'auto' as const, reasoningCapabilities: undefined };
    if (connection.providerKind === 'openai-compatible') return connectionWithCompatibleCapabilities(connection);
    if (isGeminiConnection(connection)) {
      return { ...connection, reasoningEffort: 'auto' as const, reasoningCapabilities: undefined };
    }
    if (isOllamaConnection(connection)) {
      return connectionWithOllamaReasoning(connection, ollamaModelsByConnectionIdRef.current[connection.id] ?? []);
    }
    if (isLmStudioConnection(connection)) {
      return connectionWithLmStudioReasoning(connection, lmStudioModelsByConnectionIdRef.current[connection.id] ?? []);
    }
    return connectionWithOpenRouterReasoning(connection, openRouterModelsByConnectionIdRef.current[connection.id] ?? []);
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

  function connectionWithCompositeCapabilities(
    connection: ConnectionPreset,
    models = compositeModelsByConnectionIdRef.current[connection.id] ?? [],
  ): ConnectionPreset {
    return connectionWithCompositeCapabilitiesForModels(connection, models);
  }

  function connectionWithGeminiCapabilities(
    connection: ConnectionPreset,
    models = geminiModelsByConnectionIdRef.current[connection.id] ?? [],
  ): ConnectionPreset {
    return connectionWithGeminiCapabilitiesForModels(connection, models);
  }

  function connectionWithVeniceCapabilities(
    connection: ConnectionPreset,
    models = veniceModelsByConnectionIdRef.current[connection.id] ?? [],
  ): ConnectionPreset {
    return connectionWithVeniceCapabilitiesForModels(connection, models);
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

  function connectionWithDetectedCapabilities(connection: ConnectionPreset): ConnectionPreset {
    if (connection.providerKind === 'openai-compatible') return connectionWithCompatibleCapabilities(connection);
    if (isLmStudioConnection(connection)) return connectionWithLmStudioCapabilities(connection);
    if (isManagedLocalConnection(connection)) return connectionWithLlamaCppCapabilities(connection);
    if (isOllamaConnection(connection)) return connectionWithOllamaCapabilities(connection);
    if (isOpenRouterConnection(connection)) return connectionWithOpenRouterCapabilities(connection);
    if (isCompositeConnection(connection)) return connectionWithCompositeCapabilities(connection);
    if (isGeminiConnection(connection)) return connectionWithGeminiCapabilities(connection);
    if (isVeniceConnection(connection)) return connectionWithVeniceCapabilities(connection);
    return connection;
  }

  function applyDetectedConnectionCapabilities(connection: ConnectionPreset) {
    // A model may have changed while the provider request was in flight.
    // Resolve capabilities against each current selection, including saved presets.
    const update = (current: ConnectionPreset) => {
      if (current.id !== connection.id || current.baseUrl !== connection.baseUrl || current.apiKey !== connection.apiKey ||
          llmProviderKind(current) !== llmProviderKind(connection)) return current;
      const updated = connectionWithDetectedCapabilities(current);
      return updated.vision === current.vision && updated.ttsVoice === current.ttsVoice
        && updated.reasoningEffort === current.reasoningEffort
        && updated.compatibleReasoningFormat === current.compatibleReasoningFormat
        && JSON.stringify(updated.reasoningCapabilities) === JSON.stringify(current.reasoningCapabilities)
        ? current
        : updated;
    };
    setEditingConnection(update);
    setConnections((current) => current.map(update));
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
      if (connection.providerKind === 'chatgpt') {
        const prepared = await prepareChatGPTConnection(connection);
        const state = await window.rpgraph.chatgpt.state();
        const profile = state.profiles.find(entry => entry.id === prepared.chatgptProfileId);
        if (!profile?.connected || !profile.sharing) {
          health = { status: 'warning', detail: profile?.connected ? 'Enable ChatGPT plan usage to use this provider.' : 'Continue with ChatGPT to connect this provider.', checkedAt: providerCheckedAt() };
        } else {
          const models = await listGenericModels(prepared);
          if (editingConnectionRef.current.id === connection.id && editingConnectionRef.current.chatgptProfileId === prepared.chatgptProfileId) {
            setAvailableConnectionModels(models);
          }
          health = { status: models.length && prepared.model && models.includes(prepared.model) ? 'online' : 'warning',
            detail: models.length ? !prepared.model || !models.includes(prepared.model) ? 'Select a model available to this ChatGPT account.' : providerModelCountDetail(models.length) : 'No ChatGPT models are available.',
            checkedAt: providerCheckedAt() };
        }
      } else if (connection.kind === 'comfyui') {
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
        const inspection = await window.rpgraph.inspectComfyWorkflow({
          workflowPath: comfyWorkflowPathForConnection(connection), role: comfyConnectionRole(connection) ?? 'image',
        });
        const devices = Array.isArray(result.devices) ? result.devices.length : 0;
        health = comfySetupHealth(
          connection,
          devices > 0
            ? `Connected to ComfyUI. ${devices} device${devices === 1 ? '' : 's'} reported.`
            : 'Connected to ComfyUI.',
        );
        health.comfyImageReferences = {
          workflowPath: connection.comfyWorkflowPath ?? '',
          supported: inspection.ok && inspection.supportsImageReferences === true,
        };
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
          applyDetectedConnectionCapabilities(detectedConnection);
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
      } else if (isManagedLocalConnection(connection)) {
        const modelDetails = await localModelApi.list(connection);
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
          applyDetectedConnectionCapabilities(detectedConnection);
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
          applyDetectedConnectionCapabilities(detectedConnection);
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
          applyDetectedConnectionCapabilities(detectedConnection);
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
      } else if (isCompositeConnection(connection)) {
        const modelDetails = await window.rpgraph.listCompositeModels(connection);
        updateCompositeModelCache(connection.id, modelDetails);
        const models = modelDetails.map((model) => model.id);
        const fallbackModel = models.includes(connection.model)
          ? connection.model
          : options.selectFallbackModel
            ? models.find((model) => model.includes('composite')) ?? models[0] ?? connection.model
            : connection.model;
        const detectedConnection = connectionWithCompositeCapabilities(
          { ...connection, model: fallbackModel },
          modelDetails,
        );
        if (options.selectFallbackModel && detectedConnection.model !== connection.model) {
          setEditingConnection(detectedConnection);
          setConnections((current) =>
            current.map((entry) => (entry.id === detectedConnection.id ? detectedConnection : entry)),
          );
        } else {
          applyDetectedConnectionCapabilities(detectedConnection);
        }
        if (editingConnection.id === connection.id) {
          setAvailableConnectionModels(models);
        }
        const capabilities = compositeCapabilitiesForConnection(detectedConnection, modelDetails);
        const missingApiKey = connection.apiKey.trim().length === 0;
        health = {
          status: missingApiKey
            ? 'warning'
            : models.length > 0 ? 'online' : 'offline',
          detail: missingApiKey
            ? 'No API key set. Add your Composite API key.'
            : models.length > 0
              ? providerModelCountDetail(models.length)
              : 'Connection succeeded, but no Composite models were returned.',
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
          applyDetectedConnectionCapabilities(detectedConnection);
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
      } else if (isVeniceConnection(connection)) {
        const modelDetails = await window.rpgraph.listVeniceModels(connection);
        updateVeniceModelCache(connection.id, modelDetails);
        const models = modelDetails.map((model) => model.id);
        const fallbackModel = models.includes(connection.model)
          ? connection.model
          : options.selectFallbackModel
            ? models.find((model) => model.includes('venice')) ?? models[0] ?? connection.model
            : connection.model;
        const detectedConnection = connectionWithVeniceCapabilities(
          { ...connection, model: fallbackModel },
          modelDetails,
        );
        if (options.selectFallbackModel && detectedConnection.model !== connection.model) {
          setEditingConnection(detectedConnection);
          setConnections((current) =>
            current.map((entry) => (entry.id === detectedConnection.id ? detectedConnection : entry)),
          );
        } else {
          applyDetectedConnectionCapabilities(detectedConnection);
        }
        if (editingConnection.id === connection.id) {
          setAvailableConnectionModels(models);
        }
        const capabilities = veniceCapabilitiesForConnection(detectedConnection, modelDetails);
        health = {
          status: models.length > 0 ? 'online' : 'offline',
          detail: models.length > 0
            ? providerModelCountDetail(models.length)
            : 'Connection succeeded, but no Venice models were returned.',
          capabilities,
          checkedAt: providerCheckedAt(),
        };
      } else {
        const models = await listGenericModels(connection);
        const fallbackModel = models.includes(connection.model)
          ? connection.model
          : options.selectFallbackModel
            ? models[0] ?? connection.model
            : connection.model;
        if (options.selectFallbackModel && fallbackModel !== connection.model) {
          const update = (current: ConnectionPreset) => {
            if (current.id !== connection.id || current.model !== connection.model ||
                compatibleCacheKey(current) !== compatibleCacheKey(connection) ||
                current.providerKind !== connection.providerKind) return current;
            return connectionWithDetectedCapabilities({ ...current, model: fallbackModel });
          };
          setEditingConnection(update);
          setConnections((current) => current.map(update));
        }
        if (editingConnection.id === connection.id) {
          setAvailableConnectionModels(models);
        }
        health = {
          status: models.length > 0 ? 'online' : 'offline',
          detail: models.length > 0
            ? providerModelCountDetail(models.length)
            : 'Connection succeeded, but no models were returned.',
          capabilities: connection.providerKind === 'openai-compatible'
            ? compatibleDetails({ ...connection, model: fallbackModel })?.capabilities
            : { text: models.length > 0 },
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
      if (connection.kind === 'comfyui') {
        health.comfyImageReferences = { workflowPath: connection.comfyWorkflowPath ?? '', supported: false };
      }
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
  const inspectComfyWorkflowRef = useRef<
    (
      connectionOverride?: ConnectionPreset,
      options?: { showStatus?: boolean },
    ) => Promise<ComfyWorkflowInspection | null>
  >(async () => null);
  const editingConnectionRef = useRef(editingConnection);
  const isRunningRef = useRef(isRunning);
  const showConnectionsRef = useRef(showConnections);
  const checkProviderConnectionByIdStable = useCallback(
    (connectionId: string, showStatus = false) => checkProviderConnectionByIdRef.current(connectionId, showStatus),
    [],
  );
  useEffect(() => {
    checkProviderConnectionByIdRef.current = checkProviderConnectionById;
    checkProviderConnectionsRef.current = checkProviderConnections;
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
    if (!settingsLoadComplete || isRunning) {
      return;
    }
    const checkLocalProviders = async () => {
      // Skip the background health poll while a workflow is running — providers do
      // not change mid-run, avoiding redundant round-trips and model queries.
      if (isRunningRef.current) {
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
    }, localProviderPollIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [connections, isRunning, settingsLoadComplete]);

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
      (isLmStudioConnection(connection) || isOllamaConnection(connection) || isManagedLocalConnection(connection)),
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
          } else if (isManagedLocalConnection(connection)) {
            await localModelApi.unload(connection);
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
    if (editingConnection.providerKind === 'chatgpt') {
      await checkProviderConnection(editingConnection, { showStatus: true });
      return;
    }
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
      const llamaCppModels = !lmStudioModels && !ollamaModels && isManagedLocalConnection(editingConnection)
        ? await localModelApi.list(editingConnection)
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
      const compositeModels = !lmStudioModels && !ollamaModels && !llamaCppModels && !openRouterModels && isCompositeConnection(editingConnection)
        ? await window.rpgraph.listCompositeModels(editingConnection)
        : null;
      if (compositeModels) {
        updateCompositeModelCache(editingConnection.id, compositeModels);
      }
      const geminiModels = !lmStudioModels && !ollamaModels && !llamaCppModels && !openRouterModels && !compositeModels && isGeminiConnection(editingConnection)
        ? await window.rpgraph.listGeminiModels(editingConnection)
        : null;
      if (geminiModels) {
        updateGeminiModelCache(editingConnection.id, geminiModels);
      }
      const veniceModels = !lmStudioModels && !ollamaModels && !llamaCppModels && !openRouterModels && !geminiModels && isVeniceConnection(editingConnection)
        ? await window.rpgraph.listVeniceModels(editingConnection)
        : null;
      if (veniceModels) {
        updateVeniceModelCache(editingConnection.id, veniceModels);
      }
      const models = lmStudioModels
        ? lmStudioModels.map((model) => model.id)
        : ollamaModels
          ? ollamaModels.map((model) => model.id)
        : llamaCppModels
          ? llamaCppModels.map((model) => model.id)
        : openRouterModels
          ? openRouterModels.map((model) => model.id)
        : compositeModels
          ? compositeModels.map((model) => model.id)
        : geminiModels
          ? geminiModels.map((model) => model.id)
        : veniceModels
          ? veniceModels.map((model) => model.id)
        : await listGenericModels(editingConnection);
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
            : compositeModels
              ? { text: false, vision: false, image: false, voice: false }
              : geminiModels
              ? { text: false, vision: false, image: false, voice: false }
              : veniceModels
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
      } else if (compositeModels) {
        connection = connectionWithCompositeCapabilities(connection, compositeModels);
      } else if (geminiModels) {
        connection = connectionWithGeminiCapabilities(connection, geminiModels);
      } else if (veniceModels) {
        connection = connectionWithVeniceCapabilities(connection, veniceModels);
        const selectedModel = veniceModels.find((model) => model.id === connection.model);
        if (selectedModel?.supportedVoices.length) {
          connection = {
            ...connection,
            ttsVoice: selectedModel.supportedVoices.includes(connection.ttsVoice ?? '')
              ? connection.ttsVoice
              : selectedModel.supportedVoices[0],
          };
        }
      }
      if (connection.providerKind === 'openai-compatible') connection = connectionWithCompatibleCapabilities(connection);
      const capabilities = lmStudioModels
        ? lmStudioCapabilitiesForConnection(connection, lmStudioModels)
        : ollamaModels
          ? ollamaCapabilitiesForConnection(connection, ollamaModels)
        : llamaCppModels
          ? llamaCppCapabilitiesForConnection(connection, llamaCppModels)
        : openRouterModels
          ? openRouterCapabilitiesForConnection(connection, openRouterModels)
        : compositeModels
          ? compositeCapabilitiesForConnection(connection, compositeModels)
        : geminiModels
          ? geminiCapabilitiesForConnection(connection, geminiModels)
        : veniceModels
          ? veniceCapabilitiesForConnection(connection, veniceModels)
        : connection.providerKind === 'openai-compatible'
          ? compatibleDetails(connection)?.capabilities ?? {}
          : { text: true };
      setAvailableConnectionModels(models);
      setEditingConnection((current) => {
        if (connection.providerKind !== 'openai-compatible') return connection;
        if (current.providerKind !== connection.providerKind || compatibleCacheKey(current) !== compatibleCacheKey(connection)) return current;
        return connectionWithCompatibleCapabilities({
          ...current, model: current.model === editingConnection.model ? connection.model : current.model,
        });
      });
      // See checkProviderConnection: the public OpenRouter model list also
      // loads without an API key, but generation would fail with 401.
      const missingOpenRouterApiKey =
        !!openRouterModels && connection.apiKey.trim().length === 0;
      const missingCompositeApiKey =
        !!compositeModels && connection.apiKey.trim().length === 0;
      updateProviderHealth(connection.id, {
        status: missingOpenRouterApiKey || missingCompositeApiKey ? 'warning' : 'online',
        detail: missingOpenRouterApiKey
          ? 'No API key set. Add your OpenRouter API key.'
          : missingCompositeApiKey
            ? 'No API key set. Add your Composite API key.'
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
        samplerSchedulerOptions,
      ] = await Promise.all([
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'checkpoints' }),
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'loras' }),
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'vae' }),
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'text_encoders' }),
        window.rpgraph.listComfyModels({ baseUrl: connection.baseUrl, category: 'diffusion_models' }),
        window.rpgraph.listComfySamplersAndSchedulers({ baseUrl: connection.baseUrl }),
      ]);
      setAvailableComfyModels({
        checkpoints,
        loras,
        vae,
        text_encoders: textEncoders,
        diffusion_models: diffusionModels,
        samplers: samplerSchedulerOptions.samplers,
        schedulers: samplerSchedulerOptions.schedulers,
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
        samplers: [],
        schedulers: [],
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
      updateProviderHealth(connection.id, {
        ...providerHealthByIdRef.current[connection.id],
        status: providerHealthByIdRef.current[connection.id]?.status ?? 'unknown',
        comfyImageReferences: {
          workflowPath: connection.comfyWorkflowPath ?? '',
          supported: inspection.ok && inspection.supportsImageReferences === true,
        },
      });
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
      updateProviderHealth(connection.id, {
        ...providerHealthByIdRef.current[connection.id],
        status: providerHealthByIdRef.current[connection.id]?.status ?? 'unknown',
        comfyImageReferences: { workflowPath: connection.comfyWorkflowPath ?? '', supported: false },
      });
      if (options.showStatus !== false) {
        setConnectionStatus(`ComfyUI workflow check failed: ${inspection.missing[0]}.`);
      }
      return inspection;
    }
  }

  useEffect(() => {
    inspectComfyWorkflowRef.current = inspectComfyWorkflow;
  });

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
        steps: connection.comfySteps ?? defaultComfySteps,
        cfg: connection.comfyCfg ?? defaultComfyCfg,
        sampler: connection.comfySampler ?? defaultComfySampler,
        scheduler: connection.comfyScheduler ?? defaultComfyScheduler,
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
    const connection = connections.find((entry) => entry.id === request.providerId && isImageGenerationConnection(entry, providerHealthByIdRef.current[entry.id]));
    if (!connection) {
      throw new Error('Choose an image provider first.');
    }
    const missingFields = isComfyImageConnection(connection) ? missingComfySetupFields(connection) : [];
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
    if (!isComfyImageConnection(connection)) {
      const images = await generateImageAssistantImages({
        providerId: connection.id,
        prompt,
        settings: { width: defaultComfyWidth, height: defaultComfyHeight, characterLora: '' },
      });
      return images.map((dataUrl, index) => ({ dataUrl, filename: `generated-image-${index + 1}.png` }));
    }
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
      steps: connection.comfySteps ?? defaultComfySteps,
      cfg: connection.comfyCfg ?? defaultComfyCfg,
      sampler: connection.comfySampler ?? defaultComfySampler,
      scheduler: connection.comfyScheduler ?? defaultComfyScheduler,
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
    settings: { width: number; height: number; characterLora: string; aspectRatio?: string };
    referenceImages?: ImageGenerationReference[];
  }) {
    const connection = connections.find(
      (entry) => entry.id === request.providerId &&
        isImageGenerationConnection(entry, providerHealthByIdRef.current[entry.id]),
    );
    if (!connection) {
      throw new Error('Choose an image provider first.');
    }
    if (request.referenceImages?.length && !supportsImageGenerationReferences(connection, providerHealthByIdRef.current[connection.id])) {
      throw new Error('The selected image provider does not support reference images.');
    }
    const health = providerHealthByIdRef.current[connection.id];
    if (health?.status === 'offline') {
      throw new Error(`${connection.label} is offline${health.detail ? `: ${health.detail}` : '.'}`);
    }
    if (health?.status === 'warning') {
      throw new Error(`${connection.label} is not fully set up${health.detail ? `: ${health.detail}` : '.'}`);
    }
    if (isComfyImageConnection(connection)) {
      const missingFields = missingComfySetupFields(connection);
      if (missingFields.length > 0) {
        const message = comfySetupRequiredMessage(missingFields);
        updateProviderHealth(connection.id, comfySetupHealth(connection, message));
        throw new Error(message);
      }
    } else if (health?.capabilities?.image !== true) {
      throw new Error(`${connection.label} does not report image generation support for the selected model.`);
    }

    setComfyProviderActionActive('generate');
    setImageAssistantModelState(connection.id, 'loading');
    try {
      let images: string[];
      if (isComfyImageConnection(connection)) {
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
          referenceImages: request.referenceImages?.map((image) => image.dataUrl),
          checkpointName: connection.comfyCheckpointName ?? defaultComfyCheckpointName,
          diffusionModelName: connection.comfyDiffusionModelName ?? defaultComfyDiffusionModelName,
          vaeName: connection.comfyVaeName ?? defaultComfyVaeName,
          textEncoderName: connection.comfyTextEncoderName ?? defaultComfyTextEncoderName,
          steps: connection.comfySteps ?? defaultComfySteps,
          cfg: connection.comfyCfg ?? defaultComfyCfg,
          sampler: connection.comfySampler ?? defaultComfySampler,
          scheduler: connection.comfyScheduler ?? defaultComfyScheduler,
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
        images = result.images.map((image) => image.dataUrl);
      } else {
        const result = await generateApiImages({
          connection,
          prompt: request.prompt.trim(),
          referenceImages: request.referenceImages?.map((image) => image.dataUrl),
          aspectRatio: request.settings.aspectRatio || '3:4',
          width: validComfyDimension(request.settings.width, defaultComfyWidth),
          height: validComfyDimension(request.settings.height, defaultComfyHeight),
        });
        images = result.images;
      }
      updateProviderHealth(connection.id, {
        status: 'online',
        detail: `Generated ${images.length} image${images.length === 1 ? '' : 's'}.`,
        capabilities: { ...health?.capabilities, image: true },
        checkedAt: providerCheckedAt(),
      });
      setImageAssistantModelState(connection.id, 'loaded');
      return images;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isComfyImageConnection(connection)) updateProviderHealth(connection.id, {
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
    if (!llmConnection || !isLocalProviderConnection(llmConnection) ||
      !(isLmStudioConnection(llmConnection) || isOllamaConnection(llmConnection) || isLlamaCppConnection(llmConnection))) {
      // Only supported local providers participate in automatic model switching.
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
      } else if (isManagedLocalConnection(llmConnection)) {
        await localModelApi.load(llmConnection);
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
      } else if (isManagedLocalConnection(connection)) {
        await (loaded
          ? localModelApi.load(connection)
          : localModelApi.unload(connection));
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
      !(isLmStudioConnection(connection) || isOllamaConnection(connection) || isManagedLocalConnection(connection))
    ) {
      return;
    }
    let probed: ImageAssistantModelState;
    try {
      const result = isLmStudioConnection(connection)
        ? await window.rpgraph.isLmStudioModelLoaded(connection)
        : isManagedLocalConnection(connection)
          ? await localModelApi.probe(connection)
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
          if (isManagedLocalConnection(connection)) {
            await localModelApi.unload(connection);
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
    if (!isManagedLocalConnection(connection)) return;
    if (!connection.model.trim()) {
      setConnectionStatus('Choose a model ID before loading.');
      return;
    }
    setOllamaModelActionActive('load');
    setConnectionStatus(`Loading local model "${connection.model}" ...`);
    try {
      await localModelApi.load(connection);
      const models = await localModelApi.list(connection);
      updateLlamaCppModelCache(connection.id, models);
      setConnectionStatus(`Loaded "${connection.model}".`);
    } catch (error) {
      setConnectionStatus(`Model load failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOllamaModelActionActive(null);
    }
  }

  async function unloadLlamaCppModels() {
    const connection = connectionFromEditingConnection();
    if (!isManagedLocalConnection(connection)) return;
    setOllamaModelActionActive('unload');
    setConnectionStatus('Unloading local models ...');
    try {
      const result = await localModelApi.unload(connection);
      const models = await localModelApi.list(connection);
      updateLlamaCppModelCache(connection.id, models);
      setConnectionStatus(result.unloadedCount === 0
        ? 'The server did not report any active models.'
        : `Unloaded ${result.unloadedCount} ${result.unloadedCount === 1 ? 'model' : 'models'}.`);
    } catch (error) {
      setConnectionStatus(`Model unload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOllamaModelActionActive(null);
    }
  }

  async function resolveConnection(
    connectionId?: string,
    purpose = 'an LLM node',
    signal?: AbortSignal,
  ): Promise<ConnectionPreset> {
    let connection = connections.find(
      (entry) => entry.id === (connectionId ?? defaultConnectionId),
    );
    if (!connection) {
      throw new Error(`Select an LLM connection for ${purpose} first.`);
    }
    if (!isLlmConnection(connection)) {
      throw new Error(`Select an LLM connection for ${purpose}; "${connection.label}" is not a text generation provider.`);
    }

    if (connection.providerKind === 'chatgpt') {
      connection = await prepareChatGPTConnection(connection);
      let cleanup: (() => void) | undefined;
      let models: string[];
      try {
        models = chatgptModelsRef.current[connection.chatgptProfileId ?? '']?.map(model => model.id)
          ?? await listGenericModels(connection, cancel => {
            if (signal?.aborted) cancel();
            else {
              signal?.addEventListener('abort', cancel, { once: true });
              cleanup = () => signal?.removeEventListener('abort', cancel);
            }
          });
      } finally { cleanup?.(); }
      if (signal?.aborted) throw new Error('The LLM request was cancelled.');
      if (!connection.model || !models.includes(connection.model)) {
        throw new Error('Select a model available to this ChatGPT account in Providers.');
      }
      return connectionWithReasoning(connection);
    }

    if (connection.model.trim() &&
        (connection.providerKind !== 'openai-compatible' || compatibleModelsRef.current[compatibleCacheKey(connection)]) &&
        (!isOpenRouterConnection(connection) || openRouterModelsByConnectionIdRef.current[connection.id]) &&
        (!isLmStudioConnection(connection) || lmStudioModelsByConnectionIdRef.current[connection.id]) &&
        (!isOllamaConnection(connection) || ollamaModelsByConnectionIdRef.current[connection.id])) {
      return connectionWithReasoning(connection);
    }

    if (signal?.aborted) throw new Error('The LLM request was cancelled.');
    let cleanupAbort: (() => void) | undefined;
    const onAbort = (cancel: () => void) => {
      if (!signal) return;
      if (signal.aborted) {
        cancel();
        return;
      }
      signal.addEventListener('abort', cancel, { once: true });
      cleanupAbort = () => signal.removeEventListener('abort', cancel);
    };
    let models: string[];
    try {
      if (isLmStudioConnection(connection)) {
        const details = lmStudioLlmModels(await window.rpgraph.listLmStudioModels(connection, onAbort));
        updateLmStudioModelCache(connection.id, details);
        models = details.map((model) => model.id);
      } else if (isLlamaCppConnection(connection)) {
        const details = await window.rpgraph.listLlamaCppModels(connection, onAbort);
        updateLlamaCppModelCache(connection.id, details);
        models = details.map((model) => model.id);
      } else if (isOllamaConnection(connection)) {
        const details = await window.rpgraph.listOllamaModels(connection, onAbort);
        updateOllamaModelCache(connection.id, details);
        models = details.map((model) => model.id);
      } else if (isOpenRouterConnection(connection)) {
        const details = await window.rpgraph.listOpenRouterModels(connection, onAbort);
        updateOpenRouterModelCache(connection.id, details);
        models = details.map((model) => model.id);
      } else if (isGeminiConnection(connection)) {
        const details = await window.rpgraph.listGeminiModels(connection, onAbort);
        updateGeminiModelCache(connection.id, details);
        models = details.map((model) => model.id);
      } else {
        models = await listGenericModels(connection, onAbort);
      }
    } catch (error) {
      // Metadata discovery is optional when a custom API has a manually configured model.
      if (connection.providerKind === 'openai-compatible' && connection.model.trim() && !signal?.aborted) {
        return connectionWithCompatibleCapabilities(connection);
      }
      throw error;
    } finally {
      cleanupAbort?.();
    }
    if (signal?.aborted) throw new Error('The LLM request was cancelled.');
    if (!isLlmConnection(connection)) {
      throw new Error(`Select a text generation provider for ${purpose}.`);
    }
    if (connection.model.trim()) {
      return connectionWithReasoning(connection);
    }

    if (!models[0]) {
      throw new Error('No model is configured for this provider.');
    }

    const updated = connectionWithDetectedCapabilities({ ...connection, model: models[0] });
    if (!isLlmConnection(updated)) throw new Error(`Select a text generation model for ${purpose}.`);
    setConnections((current) =>
      current.map((entry) =>
        entry.id === connection.id && !entry.model.trim() &&
        entry.baseUrl === connection.baseUrl &&
        llmProviderKind(entry) === llmProviderKind(connection)
          ? connectionWithDetectedCapabilities({ ...entry, model: updated.model })
          : entry,
      ),
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
      samplers: [],
      schedulers: [],
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

  async function prepareChatGPTConnection(connection: ConnectionPreset): Promise<ConnectionPreset> {
    if (connection.chatgptProfileId) return connection;
    const state = await window.rpgraph.chatgpt.state();
    const id = state.lastProfileId ?? state.profiles.find(profile => profile.connected)?.id ?? state.profiles[0]?.id;
    if (!id) return connection;
    const update = (current: ConnectionPreset) => current.id === connection.id && current.providerKind === 'chatgpt' && !current.chatgptProfileId
      ? { ...current, chatgptProfileId: id } : current;
    setConnections(current => current.map(update));
    setEditingConnection(update);
    return { ...connection, chatgptProfileId: id };
  }

  function selectChatGPTProfile(profileId: string, connectionId = editingConnection.id) {
    chatgptCatalogVersionRef.current += 1;
    const catalog = { ...chatgptModelsRef.current };
    delete catalog[profileId];
    chatgptModelsRef.current = catalog;
    setChatGPTModelsByProfileId(catalog);
    const update = (current: ConnectionPreset) => current.id === connectionId && current.providerKind === 'chatgpt'
      ? { ...current, chatgptProfileId: profileId, model: current.chatgptProfileId === profileId ? current.model : '' } : current;
    setConnections(current => current.map(update));
    setEditingConnection(update);
    if (editingConnection.id === connectionId) setAvailableConnectionModels([]);
    void window.rpgraph.chatgpt.selectProfile(profileId).then(() => {
      const selected = connections.find(entry => entry.id === connectionId);
      if (selected) return checkProviderConnection(update(selected), { showStatus: true });
    }).catch(error => setConnectionStatus(providerErrorMessage(error)));
  }

  function refreshChatGPTConnections() {
    chatgptCatalogVersionRef.current += 1;
    chatgptModelsRef.current = {};
    setChatGPTModelsByProfileId({});
    setAvailableConnectionModels([]);
    void checkProviderConnections(connections.filter(connection => connection.providerKind === 'chatgpt'), { showStatus: true });
  }

  function editConnection(field: keyof ConnectionPreset, value: ConnectionPreset[keyof ConnectionPreset]) {
    let nextConnection = { ...editingConnection, [field]: value };
    if (field === 'apiKey' && value !== editingConnection.apiKey) {
      // An explicit key edit replaces recovery data; other edits must preserve it.
      delete nextConnection.apiKeyEncrypted;
    }
    if (nextConnection.providerKind === 'openai-compatible') {
      nextConnection = connectionWithCompatibleCapabilities(nextConnection);
    }
    if (field === 'model' && isLmStudioConnection(nextConnection)) {
      const modelDetails = lmStudioModelsByConnectionIdRef.current[nextConnection.id] ?? [];
      nextConnection = connectionWithLmStudioCapabilities(nextConnection, modelDetails);
      updateProviderHealth(nextConnection.id, {
        ...(providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const }),
        capabilities: lmStudioCapabilitiesForConnection(nextConnection, modelDetails),
      });
    } else if (field === 'model' && isManagedLocalConnection(nextConnection)) {
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
    } else if (field === 'model' && isCompositeConnection(nextConnection)) {
      const modelDetails = compositeModelsByConnectionIdRef.current[nextConnection.id] ?? [];
      nextConnection = connectionWithCompositeCapabilities(nextConnection, modelDetails);
      updateProviderHealth(nextConnection.id, {
        ...(providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const }),
        capabilities: compositeCapabilitiesForConnection(nextConnection, modelDetails),
      });
    } else if (field === 'model' && isGeminiConnection(nextConnection)) {
      const modelDetails = geminiModelsByConnectionIdRef.current[nextConnection.id] ?? [];
      nextConnection = connectionWithGeminiCapabilities(nextConnection, modelDetails);
      updateProviderHealth(nextConnection.id, {
        ...(providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const }),
        capabilities: geminiCapabilitiesForConnection(nextConnection, modelDetails),
      });
    } else if (field === 'model' && isVeniceConnection(nextConnection)) {
      const modelDetails = veniceModelsByConnectionIdRef.current[nextConnection.id] ?? [];
      nextConnection = connectionWithVeniceCapabilities(nextConnection, modelDetails);
      const selectedModel = modelDetails.find((model) => model.id === nextConnection.model);
      nextConnection.ttsVoice = selectedModel?.supportedVoices.length
        ? selectedModel.supportedVoices.includes(nextConnection.ttsVoice ?? '')
          ? nextConnection.ttsVoice
          : selectedModel.supportedVoices[0]
        : undefined;
      updateProviderHealth(nextConnection.id, {
        ...(providerHealthByIdRef.current[nextConnection.id] ?? { status: 'unknown' as const }),
        capabilities: veniceCapabilitiesForConnection(nextConnection, modelDetails),
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
        samplers: [],
        schedulers: [],
      });
      setComfyWorkflowInspection(null);
      setPendingComfyWorkflowRepair(null);
      setComfyWorkflowRepairStatus('');
    }
  }

  const editingCompatibleModel = editingConnection.providerKind === 'openai-compatible'
    ? compatibleModels[compatibleCacheKey(editingConnection)]?.find((model) => model.id === editingConnection.model)
    : undefined;
  const editingConnectionCapabilities = editingConnection.providerKind === 'openai-compatible'
    ? editingCompatibleModel?.capabilities
    : isLmStudioConnection(editingConnection)
    ? lmStudioCapabilitiesForConnection(editingConnection, lmStudioModelsByConnectionId[editingConnection.id] ?? [])
    : isManagedLocalConnection(editingConnection)
      ? llamaCppCapabilitiesForConnection(editingConnection, llamaCppModelsByConnectionId[editingConnection.id] ?? [])
    : isOllamaConnection(editingConnection)
      ? ollamaCapabilitiesForConnection(editingConnection, ollamaModelsByConnectionId[editingConnection.id] ?? [])
      : isOpenRouterConnection(editingConnection)
        ? openRouterCapabilitiesForConnection(editingConnection, openRouterModelsByConnectionId[editingConnection.id] ?? [])
      : isCompositeConnection(editingConnection)
        ? compositeCapabilitiesForConnection(editingConnection, compositeModelsByConnectionId[editingConnection.id] ?? [])
        : isGeminiConnection(editingConnection)
          ? geminiCapabilitiesForConnection(editingConnection, geminiModelsByConnectionId[editingConnection.id] ?? [])
        : isVeniceConnection(editingConnection)
          ? veniceCapabilitiesForConnection(editingConnection, veniceModelsByConnectionId[editingConnection.id] ?? [])
        : providerHealthById[editingConnection.id]?.capabilities;
  const editingConnectionArchitecture = isLmStudioConnection(editingConnection)
    ? lmStudioModelsByConnectionId[editingConnection.id]
        ?.find((model) => model.id === editingConnection.model)
        ?.architecture
    : undefined;
  const editingConnectionVoiceModels = isOpenRouterConnection(editingConnection)
    ? openRouterModelsByConnectionId[editingConnection.id]
    : isCompositeConnection(editingConnection)
      ? compositeModelsByConnectionId[editingConnection.id]
    : isGeminiConnection(editingConnection)
      ? geminiModelsByConnectionId[editingConnection.id]
    : isVeniceConnection(editingConnection)
      ? veniceModelsByConnectionId[editingConnection.id]
      : undefined;
  const editingConnectionSupportedVoices = editingConnectionVoiceModels
        ?.find((model) => model.id === editingConnection.model)
        ?.supportedVoices ?? [];
  const editingConnectionReasoning = editingConnection.providerKind === 'openai-compatible'
    ? editingCompatibleModel?.reasoning
    : isOpenRouterConnection(editingConnection)
    ? editingConnectionVoiceModels?.find((model) => model.id === editingConnection.model)?.reasoning
    : isLmStudioConnection(editingConnection)
      ? lmStudioModelsByConnectionId[editingConnection.id]?.find((model) => model.id === editingConnection.model)?.reasoning
      : isOllamaConnection(editingConnection)
        ? ollamaModelsByConnectionId[editingConnection.id]?.find((model) => model.id === editingConnection.model)?.reasoning
        : undefined;
  const editingConnectionSupportedParameters = editingConnectionVoiceModels
        ?.find((model) => model.id === editingConnection.model)
        ?.supportedParameters ?? [];
  const editingComfyWorkflowPath = comfyWorkflowPathForConnection(editingConnection);
  const comfyWorkflowRepairReady = !!pendingComfyWorkflowRepair && pendingComfyWorkflowRepair.workflowPath === editingComfyWorkflowPath;
  const comfyWorkflowRepairInspection = pendingComfyWorkflowRepair?.workflowPath === editingComfyWorkflowPath
    ? pendingComfyWorkflowRepair.inspection
    : null;
  const modelCapabilitiesSourceLabel = editingCompatibleModel && Object.keys(editingCompatibleModel.capabilities).length
    ? 'model metadata'
    : isLmStudioConnection(editingConnection)
    ? 'LM Studio'
    : isManagedLocalConnection(editingConnection)
      ? 'llama.cpp'
    : isOllamaConnection(editingConnection)
      ? 'Ollama'
      : isOpenRouterConnection(editingConnection)
        ? 'OpenRouter'
      : isCompositeConnection(editingConnection)
        ? 'Composite'
        : isGeminiConnection(editingConnection)
          ? 'Google Gemini'
        : isVeniceConnection(editingConnection)
          ? 'Venice AI'
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
    chatgptModelsByProfileId,
    selectChatGPTProfile,
    refreshChatGPTConnections,
    availableComfyModels,
    comfyWorkflowInspection,
    connectionStatus,
    providerHealthById,
    imageAssistantModelStateById,
    lmStudioModelsByConnectionId,
    openRouterModelsByConnectionId,
    geminiModelsByConnectionId,
    compositeModelsByConnectionId,
    veniceModelsByConnectionId,
    ollamaModelsByConnectionId,
    llamaCppModelsByConnectionId,
    comfyProviderActionActive,
    voiceGenerationActive,
    lmStudioModelActionActive,
    ollamaModelActionActive,
    editingConnectionCapabilities,
    editingConnectionArchitecture,
    editingConnectionReasoning,
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
    checkProviderConnectionById: checkProviderConnectionByIdStable,
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
