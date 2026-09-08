import { characterPayload } from './character';
import { buildCharacterRegistry, type EffectiveCharacterRegistry } from './registry';
import type { NpcParticipantSnapshots } from './npcParticipants';
import { validateCandidateCharacterRegistry } from './profiles';
import { storybookRegistryEntries } from './npcParticipantRuntime';
import { isStorybookSourceNode } from '../storybook/runtime';
import { planCharacterCardImport } from '../storybook/characterCard';
import { emptyRpStorybook, normalizeRpStorybookCharacter, parseRpStorybookJson,
  rpStorybookIdentityLockViolations, storybookNeedsUpdate } from '../nodes/rp-storybook/model';
import type { WorkflowNode } from '../types';
import versions from '../storybook/formatVersions.json';

/** Promote the effective (possibly pinned) revision, including its starting publications. */
export function npcPromotionCard(registry: EffectiveCharacterRegistry, characterId: string) {
  const entry = registry.characters.find((entry) => entry.character.id === characterId);
  if (!entry) throw new Error(`NPC ${characterId} is no longer available. Reload the library and retry.`);
  return { format: 'rpgraph-character', version: versions.characterCard,
    character: characterPayload(entry.character, true) };
}

/** Shared preflight for file imports and library promotion, before any runtime mutation. */
export function planCharacterImportToNode(options: {
  nodes: WorkflowNode[]; nodeId: string; card: unknown;
  snapshots: NpcParticipantSnapshots; registry: EffectiveCharacterRegistry;
}) {
  const { nodes, nodeId, snapshots, registry } = options;
  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node || !isStorybookSourceNode(node)) throw new Error('Select a Storybook node before importing a character.');
  if (storybookNeedsUpdate(node.data.storybookJson)) throw new Error('Update the Storybook before importing a character.');
  const book = node.data.storybookJson ? parseRpStorybookJson(node.data.storybookJson) : emptyRpStorybook;
  const plan = planCharacterCardImport(options.card, book);
  if (storybookRegistryEntries(nodes).some((entry) => entry.source !== nodeId && entry.character.id === plan.character.id)) {
    throw new Error('This character already belongs to another Storybook node. Select that Storybook to replace it.');
  }
  const others = registry.characters.filter((entry) => entry.character.id !== plan.character.id);
  validateCandidateCharacterRegistry(registry, buildCharacterRegistry([
    ...others.map((entry) => ({ character: entry.character, ...entry.provenance, aliases: entry.aliases })),
    { character: plan.character, tier: 'storybook', source: nodeId },
  ]));
  const pinned = snapshots[plan.character.id]?.character;
  if (pinned) {
    const violations = rpStorybookIdentityLockViolations(
      { ...emptyRpStorybook, characters: [normalizeRpStorybookCharacter(pinned, 0, new Set())] },
      { ...emptyRpStorybook, characters: [plan.character] });
    if (violations.length) throw new Error(violations.join(' '));
    // Historical media and immutable seeds must remain resolvable after promotion.
    for (const image of pinned.images) {
      if (!plan.character.images.some((next) => next.id === image.id && next.dataUrl === image.dataUrl)) {
        throw new Error(`Cannot replace saved NPC media ${image.id} during import.`);
      }
    }
    for (const app of ['fotogram', 'onlyfriends'] as const) {
      for (const post of pinned.apps?.[app]?.initialPosts ?? []) {
        if (!plan.character.apps?.[app]?.initialPosts?.some((next) =>
          next.id === post.id && next.text === post.text && next.imageId === post.imageId)) {
          throw new Error(`Cannot replace saved NPC starting post ${post.id} during import.`);
        }
      }
    }
  }
  return plan;
}
