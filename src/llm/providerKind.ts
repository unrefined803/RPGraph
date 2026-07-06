import type { ConnectionPreset, LlmProviderKind } from '../types';

const llmProviderKinds = [
  'lm-studio',
  'ollama',
  'openrouter',
  'gemini',
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
  if ((label.includes('lm studio') && isLocal) || matchesLocalDefaultPort(connection, '1234')) {
    return 'lm-studio';
  }
  if ((label.includes('ollama') && isLocal) || matchesLocalDefaultPort(connection, '11434')) {
    return 'ollama';
  }
  const hostname = connectionUrl(connection)?.hostname ?? '';
  const baseUrl = connection.baseUrl.toLowerCase();
  if (label.includes('openrouter') || hostname === 'openrouter.ai' || baseUrl.includes('openrouter.ai')) {
    return 'openrouter';
  }
  if (baseUrl.includes('generativelanguage.googleapis.com')) {
    return 'gemini';
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

export function isOpenRouterConnection(connection: ConnectionPreset): boolean {
  return llmProviderKind(connection) === 'openrouter';
}

export function isGeminiConnection(connection: ConnectionPreset): boolean {
  return llmProviderKind(connection) === 'gemini';
}
