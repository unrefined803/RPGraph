import { parseRpStorybookJson, parseNodeStorybookJson, storybookCharacterId, storybookNeedsUpdate } from '../nodes/rp-storybook/model';
import { isStorybookSourceNode } from '../storybook/runtime';
import type { WorkflowNode } from '../types';
import type { CharacterRegistryEntry } from './registry';
import { parseNpcParticipantSnapshots, type NpcParticipantSnapshots } from './npcParticipants';

export function storybookRegistryEntries(nodes: WorkflowNode[]): CharacterRegistryEntry[] {
  return nodes.flatMap((node) => {
    if (!isStorybookSourceNode(node) || !node.data.storybookJson || storybookNeedsUpdate(node.data.storybookJson)) return [];
    const storybook = parseNodeStorybookJson(node.data.storybookJson);
    if (!storybook) return [];
    return storybook.characters.map((character, index) => ({
      character, tier: 'storybook', source: node.id,
      aliases: { characterIds: [storybookCharacterId(node.id, character.id, index)] },
    }));
  });
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
