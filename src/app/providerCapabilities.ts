import {
  isGeminiConnection,
  isLmStudioConnection,
  isOllamaConnection,
  isOpenRouterConnection,
} from '../llm/providerKind';
import type {
  ConnectionPreset,
  GeminiModelInfo,
  LmStudioModelInfo,
  OllamaModelInfo,
  OpenRouterModelInfo,
  ProviderConnectionCapabilities,
  ProviderConnectionHealth,
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
const selectedGeminiModel = selectedCapabilityModel<GeminiModelInfo>;

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

export function lmStudioCapabilitiesForConnection(
  connection: ConnectionPreset,
  models: LmStudioModelInfo[],
): ProviderConnectionCapabilities {
  const model = selectedLmStudioModel(connection, models);
  return {
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

export function ollamaCapabilitiesForConnection(
  connection: ConnectionPreset,
  models: OllamaModelInfo[],
): ProviderConnectionCapabilities {
  const model = selectedOllamaModel(connection, models);
  return {
    text: !!model || models.length > 0,
    vision: model?.vision === true,
    tools: model?.trainedForToolUse === true,
  };
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
    ...connection,
    vision: capabilities.vision === true,
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
    ...connection,
    vision: capabilities.vision === true,
    ttsVoice: capabilities.voice === true && capabilities.text !== true && supportedVoices.length > 0
      ? supportedVoices.includes(connection.ttsVoice ?? '')
        ? connection.ttsVoice
        : supportedVoices[0]
      : connection.ttsVoice,
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
  return {
    ...connection,
    vision: capabilities.vision === true,
  };
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
    ...connection,
    vision: capabilities.vision === true,
  };
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
