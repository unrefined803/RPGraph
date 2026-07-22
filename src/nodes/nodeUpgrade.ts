import { getRegisteredCoreNode } from './registry';
import { isStorybookSourceNode } from '../storybook/runtime';
import type { CreateNodeContext, HydrateContext } from './types';
import type { WorkflowNode, WorkflowNodeData } from '../types';

/**
 * True when upgrading `node` (an incompatible-core-node placeholder) would produce
 * a second *live* instance that breaks a uniqueness rule: the storybook-source XOR
 * (a graph holds at most one `rp-storybook` / `rp-storybook-editor`) or a
 * singleton node type.
 *
 * Incompatible placeholders are never counted as live nodes — `isStorybookSourceNode`
 * ignores `kind !== undefined`, and the singleton add-guard only looks at live nodes —
 * so a file can legitimately hold an incompatible storybook/singleton node alongside a
 * live peer. Upgrading turns the placeholder into a live node, which would then collide
 * with that peer and make the saved file fail to reload ("more than one storybook
 * source"). Callers must abort the upgrade when this returns true.
 */
export function storybookOrSingletonUpgradeConflict(
  node: WorkflowNode,
  nodes: WorkflowNode[],
): boolean {
  if (node.data.kind !== 'incompatible-core-node') {
    return false;
  }
  const nodeType = node.data.nodeType;
  const definition = getRegisteredCoreNode(nodeType);
  if (!definition) {
    return false;
  }
  const isStorybookType =
    nodeType === 'rp-storybook' || nodeType === 'rp-storybook-editor';
  if (isStorybookType) {
    return nodes.some((other) => other.id !== node.id && isStorybookSourceNode(other));
  }
  return (
    !!definition.singleton &&
    nodes.some(
      (other) =>
        other.id !== node.id &&
        other.data.kind === undefined &&
        other.data.nodeType === nodeType,
    )
  );
}

export type UpgradeNodeContext = {
  createContext: CreateNodeContext;
  hydrateContext: HydrateContext;
};

/**
 * Replace an incompatible-core-node placeholder with a fresh, current-version node of
 * the same type, carrying over every field the current version still recognizes.
 *
 * The shell comes from the definition's own `create()` — giving it the current default
 * style and, critically, none of the stale saved `width`/`height`/`measured` that make
 * the placeholder's wrapper an oversized invisible drag target. Its data comes from the
 * definition's own `hydrateData(storedData)` — the exact loader compatible nodes run
 * (`workflow/persistence.ts`) — so the copied fields are validated (a dangling
 * `connectionId` falls back to the default), normalized, whitelisted to current fields
 * (removed fields dropped, new fields defaulted) and stamped with the current
 * `nodeDataVersion`. Malformed stored data (e.g. unparseable `storybookJson`, which
 * throws) falls back to the fresh defaults instead of failing the upgrade.
 *
 * The id and position are preserved so the node doesn't jump; incompatible nodes carry
 * no edges (stripped at load), so reusing the id is safe.
 *
 * Returns null when `node` isn't an incompatible placeholder or its type is no longer
 * registered (nothing to upgrade to).
 */
export function buildUpgradedNode(
  node: WorkflowNode,
  { createContext, hydrateContext }: UpgradeNodeContext,
): WorkflowNode | null {
  if (node.data.kind !== 'incompatible-core-node') {
    return null;
  }
  const definition = getRegisteredCoreNode(node.data.nodeType);
  if (!definition) {
    return null;
  }

  const shell = definition.create(createContext);

  let data: WorkflowNodeData;
  try {
    data = definition.hydrateData(node.data.storedData as WorkflowNodeData, hydrateContext);
  } catch {
    data = shell.data;
  }

  return { ...shell, id: node.id, position: node.position, data };
}
