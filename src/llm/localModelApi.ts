import type { ConnectionPreset } from '../types';
import { llmProviderKind } from './providerKind';

// The router-style local providers share discovery and lifecycle UI, not endpoints.
export const localModelApi = {
  list: (connection: ConnectionPreset) => llmProviderKind(connection) === 'unsloth'
    ? window.rpgraph.listUnslothModels({ ...connection, providerKind: 'unsloth' }) : window.rpgraph.listLlamaCppModels(connection),
  load: (connection: ConnectionPreset) => llmProviderKind(connection) === 'unsloth'
    ? window.rpgraph.loadUnslothModel({ ...connection, providerKind: 'unsloth' }) : window.rpgraph.loadLlamaCppModel(connection),
  unload: (connection: ConnectionPreset) => llmProviderKind(connection) === 'unsloth'
    ? window.rpgraph.unloadUnslothModels({ ...connection, providerKind: 'unsloth' }) : window.rpgraph.unloadLlamaCppModels(connection),
  probe: (connection: ConnectionPreset) => llmProviderKind(connection) === 'unsloth'
    ? window.rpgraph.isUnslothModelLoaded({ ...connection, providerKind: 'unsloth' }) : window.rpgraph.isLlamaCppModelLoaded(connection),
};
