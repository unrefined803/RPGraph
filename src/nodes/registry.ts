import { coreNodeDefinitions } from './coreDefinitions';
import { isNamespacedPluginTypeId } from './extensions/typeIdPolicy';
import { isNodeVersion } from './nodeVersion';
import type {
  CoreNodeCreationDefinition,
  NodeCreationDefinition,
  NodeTypeId,
} from './types';

const nodeRegistry = new Map<NodeTypeId, NodeCreationDefinition>();

export function registerNode(definition: NodeCreationDefinition) {
  if (!isNodeVersion(definition.dataVersion)) {
    throw new Error(`Node version must use MAJOR.MINOR.PATCH: ${definition.type}`);
  }
  if (definition.origin === 'plugin' && !isNamespacedPluginTypeId(definition.type)) {
    throw new Error(`Plugin node type must be namespaced: ${definition.type}`);
  }
  if (nodeRegistry.has(definition.type)) {
    throw new Error(`Node type is already registered: ${definition.type}`);
  }
  nodeRegistry.set(definition.type, definition);
}

function registerCoreNodes() {
  if (coreNodeDefinitions.every((definition) => nodeRegistry.has(definition.type))) {
    return;
  }
  coreNodeDefinitions.forEach(registerNode);
}

export function getRegisteredNode(type: string) {
  return nodeRegistry.get(type);
}

export function getRegisteredCoreNode(type: string) {
  return nodeRegistry.get(type) as CoreNodeCreationDefinition | undefined;
}

export function getRegisteredCoreNodes() {
  return coreNodeDefinitions.map((definition) => getRegisteredCoreNode(definition.type) ?? definition);
}

registerCoreNodes();
