import type { ConnectionPreset, LlmProviderKind } from '../types';

const llmProviderKinds = [
  'lm-studio',
  'unsloth',
  'llama-cpp',
  'ollama',
  'openrouter',
  'gemini',
  'composite',
  'venice',
  'openai-compatible',
] as const satisfies readonly LlmProviderKind[];

export function validLlmProviderKind(value: unknown): LlmProviderKind | undefined {
  return llmProviderKinds.includes(value as LlmProviderKind)
    ? value as LlmProviderKind
    : undefined;
}

function connectionUrl(connection: ConnectionPreset): URL | null {
  try {
    return new URL(connection.baseUrl);
  } catch {
    return null;
  }
}

export function isLocalProviderConnection(connection: ConnectionPreset): boolean {
  const url = connectionUrl(connection);
  if (url) {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  }
  return connection.baseUrl.includes('localhost') || connection.baseUrl.includes('127.0.0.1');
}

function matchesLocalDefaultPort(connection: ConnectionPreset, port: string): boolean {
  const url = connectionUrl(connection);
  return !!url &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    url.port === port;
}

// Heuristic only: used as the default when a preset has no explicit
// providerKind yet (legacy stored presets, freshly typed base URLs).
export function inferredProviderKind(connection: ConnectionPreset): LlmProviderKind {
  const label = connection.label.toLowerCase();
  const isLocal = isLocalProviderConnection(connection);
  if ((label.includes('unsloth') && isLocal) || matchesLocalDefaultPort(connection, '8888')) return 'unsloth';
  if ((label.includes('lm studio') && isLocal) || matchesLocalDefaultPort(connection, '1234')) {
    return 'lm-studio';
  }
  if ((label.includes('ollama') && isLocal) || matchesLocalDefaultPort(connection, '11434')) {
    return 'ollama';
  }
  if (label.includes('llama.cpp') || label.includes('llama cpp')) {
    return 'llama-cpp';
  }
  const hostname = connectionUrl(connection)?.hostname ?? '';
  const baseUrl = connection.baseUrl.toLowerCase();
  if (label.includes('openrouter') || hostname === 'openrouter.ai' || baseUrl.includes('openrouter.ai')) {
    return 'openrouter';
  }
  if (baseUrl.includes('generativelanguage.googleapis.com')) {
    return 'gemini';
  }
  if (label.includes('composite') || hostname === 'composite.lucidity.sh' || baseUrl.includes('composite.lucidity.sh')) {
    return 'composite';
  }
  if (label.includes('venice') || hostname === 'api.venice.ai' || baseUrl.includes('venice.ai')) {
    return 'venice';
  }
  return 'lm-studio';
}

export function llmProviderKind(connection: ConnectionPreset): LlmProviderKind | null {
  if (connection.kind === 'comfyui') {
    return null;
  }
  return validLlmProviderKind(connection.providerKind) ?? inferredProviderKind(connection);
}

export function isLmStudioConnection(connection: ConnectionPreset): boolean {
  return llmProviderKind(connection) === 'lm-studio';
}

export function isOllamaConnection(connection: ConnectionPreset): boolean {
  return llmProviderKind(connection) === 'ollama';
}

export function isLlamaCppConnection(connection: ConnectionPreset): boolean {
  return llmProviderKind(connection) === 'llama-cpp';
}

export function isManagedLocalConnection(connection: ConnectionPreset): boolean {
  return isLlamaCppConnection(connection) || llmProviderKind(connection) === 'unsloth';
}

export function isOpenRouterConnection(connection: ConnectionPreset): boolean {
  return llmProviderKind(connection) === 'openrouter';
}

export function isGeminiConnection(connection: ConnectionPreset): boolean {
  return llmProviderKind(connection) === 'gemini';
}

export function isCompositeConnection(connection: ConnectionPreset): boolean {
  return llmProviderKind(connection) === 'composite';
}

export function isVeniceConnection(connection: ConnectionPreset): boolean {
  return llmProviderKind(connection) === 'venice';
}
