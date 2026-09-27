import { normalizeReasoningEffort } from '../../shared/reasoning.cjs';
import {
  isCompositeConnection,
  isGeminiConnection,
  isLmStudioConnection,
  isManagedLocalConnection,
  isOllamaConnection,
  isOpenRouterConnection,
  isVeniceConnection,
} from '../llm/providerKind';
import type {
  ConnectionPreset,
  CompositeModelInfo,
  GeminiModelInfo,
  LmStudioModelInfo,
  LlamaCppModelInfo,
  OllamaModelInfo,
  OpenRouterModelInfo,
  ProviderConnectionCapabilities,
  ProviderConnectionHealth,
  VeniceModelInfo,
} from '../types';

type ModelCapabilityInfo = {
  id: string;
  text?: boolean;
  vision?: boolean;
  image?: boolean;
  voice?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
};

export function lmStudioLlmModels(models: LmStudioModelInfo[]) {
  return models.filter((model) =>
    model.type === undefined || model.type === 'llm' || model.type === 'vlm',
  );
}

function selectedLmStudioModel(
  connection: ConnectionPreset,
  models: LmStudioModelInfo[],
) {
  const selectedModelId = connection.model.trim();
  if (!selectedModelId) {
    return undefined;
  }
  return models.find((model) => model.id === selectedModelId);
}

function selectedCapabilityModel<T extends ModelCapabilityInfo>(
  connection: ConnectionPreset,
  models: T[],
) {
  const selectedModelId = connection.model.trim();
  if (!selectedModelId) {
    return undefined;
  }
  return models.find((model) => model.id === selectedModelId);
}

const selectedOpenRouterModel = selectedCapabilityModel<OpenRouterModelInfo>;
const selectedCompositeModel = selectedCapabilityModel<CompositeModelInfo>;
const selectedGeminiModel = selectedCapabilityModel<GeminiModelInfo>;
const selectedVeniceModel = selectedCapabilityModel<VeniceModelInfo>;

function selectedOllamaModel(
  connection: ConnectionPreset,
  models: OllamaModelInfo[],
) {
  const selectedModelId = connection.model.trim();
  if (!selectedModelId) {
    return undefined;
  }
  return models.find((model) => model.id === selectedModelId);
}

export function llamaCppCapabilitiesForConnection(
  connection: ConnectionPreset,
  models: LlamaCppModelInfo[],
): ProviderConnectionCapabilities {
  const model = selectedCapabilityModel(connection, models);
  return {
    text: model?.text === true,
    vision: model?.vision === true,
  };
}

export function lmStudioCapabilitiesForConnection(
  connection: ConnectionPreset,
  models: LmStudioModelInfo[],
): ProviderConnectionCapabilities {
  const model = selectedLmStudioModel(connection, models);
  return {
    reasoning: model?.reasoning?.supportedEfforts?.some((effort) => effort !== 'none') === true,
    text: !!model || models.length > 0,
    vision: model?.vision === true,
    tools: model?.trainedForToolUse === true,
  };
}

export function openRouterCapabilitiesForConnection(
  connection: ConnectionPreset,
  models: OpenRouterModelInfo[],
): ProviderConnectionCapabilities {
  const model = selectedOpenRouterModel(connection, models);
  const inputModalities = model?.inputModalities ?? [];
  const outputModalities = model?.outputModalities ?? [];
  return {
    reasoning: !!model?.reasoning || model?.supportedParameters?.includes('reasoning') === true,
    text: model ? model.text === true || outputModalities.includes('text') : models.length > 0,
    vision: model?.vision === true || inputModalities.includes('image'),
    image: model?.image === true || outputModalities.includes('image'),
    voice: model?.voice === true || outputModalities.includes('audio') || outputModalities.includes('speech'),
  };
}

export function compositeCapabilitiesForConnection(
  connection: ConnectionPreset,
  models: CompositeModelInfo[],
): ProviderConnectionCapabilities {
  const model = selectedCompositeModel(connection, models);
  const inputModalities = model?.inputModalities ?? [];
  const outputModalities = model?.outputModalities ?? [];
  return {
    text: model ? model.text === true || outputModalities.includes('text') : models.length > 0,
    vision: model?.vision === true || inputModalities.includes('image'),
    image: model?.image === true || outputModalities.includes('image'),
    voice: model?.voice === true || outputModalities.includes('audio') || outputModalities.includes('speech'),
  };
}

export function geminiCapabilitiesForConnection(
  connection: ConnectionPreset,
  models: GeminiModelInfo[],
): ProviderConnectionCapabilities {
  const model = selectedGeminiModel(connection, models);
  const inputModalities = model?.inputModalities ?? [];
  const outputModalities = model?.outputModalities ?? [];
  return {
    text: model ? model.text === true || outputModalities.includes('text') : models.length > 0,
    vision: model?.vision === true || inputModalities.includes('image'),
    image: model?.image === true || outputModalities.includes('image'),
    voice: model?.voice === true || outputModalities.includes('audio') || outputModalities.includes('speech'),
  };
}

export function veniceCapabilitiesForConnection(
  connection: ConnectionPreset,
  models: VeniceModelInfo[],
): ProviderConnectionCapabilities {
  const model = selectedVeniceModel(connection, models);
  const inputModalities = model?.inputModalities ?? [];
  const outputModalities = model?.outputModalities ?? [];
  return {
    text: model ? model.text === true || outputModalities.includes('text') : models.length > 0,
    vision: model?.vision === true || inputModalities.includes('image'),
    image: model?.image === true || outputModalities.includes('image'),
    voice: model?.voice === true || outputModalities.includes('audio') || outputModalities.includes('speech'),
    tools: model?.supportedParameters?.includes('tools') === true,
  };
}

export function ollamaCapabilitiesForConnection(
  connection: ConnectionPreset,
  models: OllamaModelInfo[],
): ProviderConnectionCapabilities {
  const model = selectedOllamaModel(connection, models);
  return {
    reasoning: model?.reasoning
      ? model.reasoning.supportedEfforts?.some((effort) => effort !== 'none') === true || model.reasoning.defaultEnabled === true
      : model?.thinkingSupported === true,
    text: !!model || models.length > 0,
    vision: model?.vision === true,
    tools: model?.trainedForToolUse === true,
  };
}

export function connectionWithLmStudioReasoning(
  connection: ConnectionPreset,
  models: LmStudioModelInfo[],
): ConnectionPreset {
  if (!isLmStudioConnection(connection)) return connection;
  const reasoning = selectedLmStudioModel(connection, models)?.reasoning;
  return { ...connection, reasoningCapabilities: reasoning,
    reasoningEffort: normalizeReasoningEffort(connection.reasoningEffort, reasoning) };
}

export function connectionWithLmStudioCapabilities(
  connection: ConnectionPreset,
  models: LmStudioModelInfo[],
): ConnectionPreset {
  if (!isLmStudioConnection(connection)) {
    return connection;
  }
  const capabilities = lmStudioCapabilitiesForConnection(connection, models);
  return {
    ...connectionWithLmStudioReasoning(connection, models),
    vision: capabilities.vision === true,
  };
}

export function connectionWithOpenRouterReasoning(
  connection: ConnectionPreset,
  models: OpenRouterModelInfo[],
): ConnectionPreset {
  if (!isOpenRouterConnection(connection)) return connection;
  const model = selectedOpenRouterModel(connection, models);
  return {
    ...connection,
    reasoningCapabilities: model?.reasoning,
    reasoningEffort: normalizeReasoningEffort(connection.reasoningEffort, model?.reasoning),
  };
}

export function connectionWithOpenRouterCapabilities(
  connection: ConnectionPreset,
  models: OpenRouterModelInfo[],
): ConnectionPreset {
  if (!isOpenRouterConnection(connection)) {
    return connection;
  }
  const capabilities = openRouterCapabilitiesForConnection(connection, models);
  const model = selectedOpenRouterModel(connection, models);
  const supportedVoices = model?.supportedVoices ?? [];
  return {
    ...connectionWithOpenRouterReasoning(connection, models),
    vision: capabilities.vision === true,
    ttsVoice: capabilities.voice === true && capabilities.text !== true && supportedVoices.length > 0
      ? supportedVoices.includes(connection.ttsVoice ?? '')
        ? connection.ttsVoice
        : supportedVoices[0]
      : connection.ttsVoice,
  };
}

export function connectionWithCompositeCapabilities(
  connection: ConnectionPreset,
  models: CompositeModelInfo[],
): ConnectionPreset {
  if (!isCompositeConnection(connection)) {
    return connection;
  }
  const capabilities = compositeCapabilitiesForConnection(connection, models);
  return {
    ...connection,
    vision: capabilities.vision === true,
  };
}

export function connectionWithGeminiCapabilities(
  connection: ConnectionPreset,
  models: GeminiModelInfo[],
): ConnectionPreset {
  if (!isGeminiConnection(connection)) {
    return connection;
  }
  const capabilities = geminiCapabilitiesForConnection(connection, models);
  const model = selectedGeminiModel(connection, models);
  const supportedVoices = model?.supportedVoices ?? [];
  return {
    ...connection,
    reasoningEffort: 'auto',
    reasoningCapabilities: undefined,
    vision: capabilities.vision === true,
    ttsVoice: capabilities.voice === true && capabilities.text !== true && supportedVoices.length > 0
      ? supportedVoices.includes(connection.ttsVoice ?? '')
        ? connection.ttsVoice
        : supportedVoices[0]
      : connection.ttsVoice,
  };
}

export function connectionWithVeniceCapabilities(
  connection: ConnectionPreset,
  models: VeniceModelInfo[],
): ConnectionPreset {
  if (!isVeniceConnection(connection)) {
    return connection;
  }
  const capabilities = veniceCapabilitiesForConnection(connection, models);
  const model = selectedVeniceModel(connection, models);
  const supportedVoices = model?.supportedVoices ?? [];
  return {
    ...connection,
    vision: capabilities.vision === true,
    ttsVoice: capabilities.voice === true && capabilities.text !== true && supportedVoices.length > 0
      ? supportedVoices.includes(connection.ttsVoice ?? '')
        ? connection.ttsVoice
        : supportedVoices[0]
      : connection.ttsVoice,
  };
}

export function connectionWithOllamaReasoning(
  connection: ConnectionPreset,
  models: OllamaModelInfo[],
): ConnectionPreset {
  if (!isOllamaConnection(connection)) return connection;
  const reasoning = selectedOllamaModel(connection, models)?.reasoning;
  return { ...connection, reasoningCapabilities: reasoning,
    reasoningEffort: normalizeReasoningEffort(connection.reasoningEffort, reasoning) };
}

export function connectionWithOllamaCapabilities(
  connection: ConnectionPreset,
  models: OllamaModelInfo[],
): ConnectionPreset {
  if (!isOllamaConnection(connection)) {
    return connection;
  }
  const capabilities = ollamaCapabilitiesForConnection(connection, models);
  return {
    ...connectionWithOllamaReasoning(connection, models),
    vision: capabilities.vision === true,
  };
}

export function connectionWithLlamaCppCapabilities(
  connection: ConnectionPreset,
  models: LlamaCppModelInfo[],
): ConnectionPreset {
  if (!isManagedLocalConnection(connection)) return connection;
  return { ...connection, vision: llamaCppCapabilitiesForConnection(connection, models).vision === true };
}

export function providerErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function providerCheckConnectionStatus(
  connection: ConnectionPreset,
  health: ProviderConnectionHealth,
) {
  const name = connection.label || connection.baseUrl;
  if (health.status === 'online') {
    return `${name}: ${health.detail ?? 'Connected.'}`;
  }
  if (health.status === 'checking') {
    return `${name}: Checking ...`;
  }
  if (health.status === 'warning') {
    return `${name}: ${health.detail ?? 'Setup incomplete.'}`;
  }
  if (health.status === 'offline') {
    return `${name}: ${health.detail ?? 'Offline.'}`;
  }
  return `${name}: Not checked yet.`;
}

export function providerModelCountDetail(count: number) {
  return count === 1 ? 'Connected. 1 model found.' : `Connected. ${count} models found.`;
}

export function providerCheckedAt() {
  return Date.now();
}

export function createProviderConnectionId() {
  return `connection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
