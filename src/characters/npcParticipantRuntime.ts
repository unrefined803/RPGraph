import { parseRpStorybookJson, parseNodeStorybookJson, storybookCharacterId, storybookNeedsUpdate } from '../nodes/rp-storybook/model';
import { isStorybookSourceNode } from '../storybook/runtime';
import type { WorkflowNode } from '../types';
import { buildCharacterRegistry, type CharacterRegistryEntry } from './registry';
import type { Character } from './character';
import { npcSnapshotEntries, parseNpcParticipantSnapshots, type NpcParticipantSnapshots } from './npcParticipants';

export type StorybookRegistryCandidateOptions = {
  replaceExisting?: boolean;
  openingSnapshots?: NpcParticipantSnapshots;
};

/** Model the registry that will exist after the Storybook and session update. */
export function candidateStorybookRegistry(
  entries: CharacterRegistryEntry[],
  snapshots: NpcParticipantSnapshots,
  nodeId: string,
  characters: Character[],
  options?: StorybookRegistryCandidateOptions,
) {
  return buildCharacterRegistry([
    ...entries.filter((entry) => entry.tier !== 'storybook' || entry.source !== nodeId),
    ...storybookRegistryEntriesForCharacters(nodeId, characters),
    ...npcSnapshotEntries({ ...parseNpcParticipantSnapshots(options?.openingSnapshots),
      ...(options?.replaceExisting ? {} : snapshots) }),
  ]);
}

export function storybookRegistryEntries(nodes: WorkflowNode[]): CharacterRegistryEntry[] {
  return nodes.flatMap((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson || storybookNeedsUpdate(node.data.storybookJson)) return [];
    const storybook = parseNodeStorybookJson(node.data.storybookJson);
    if (!storybook) return [];
    return storybookRegistryEntriesForCharacters(node.id, storybook.characters);
  });
}

function storybookRegistryEntriesForCharacters(
  nodeId: string,
  characters: Character[],
): CharacterRegistryEntry[] {
  return characters.map((character, index) => ({
    character,
    tier: 'storybook',
    source: nodeId,
    aliases: { characterIds: [storybookCharacterId(nodeId, character.id, index)] },
  }));
}

export function openingHistoryNpcParticipantsFromNodes(nodes: WorkflowNode[]): NpcParticipantSnapshots {
  const snapshots: NpcParticipantSnapshots = {};
  for (const node of nodes) {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson || storybookNeedsUpdate(node.data.storybookJson)) continue;
    const incoming = parseRpStorybookJson(node.data.storybookJson).openingHistory.npcParticipants ?? {};
    for (const [id, snapshot] of Object.entries(incoming)) {
      if (Object.prototype.hasOwnProperty.call(snapshots, id) && JSON.stringify(snapshots[id]) !== JSON.stringify(snapshot)) {
        throw new Error(`Conflicting Opening History NPC revisions for ${id}.`);
      }
      Object.defineProperty(snapshots, id, { value: snapshot, enumerable: true, configurable: true });
    }
  }
  return parseNpcParticipantSnapshots(snapshots);
}
