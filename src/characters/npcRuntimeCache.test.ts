import { expect, it } from 'vitest';
import { createNpcRuntimeCache } from './npcRuntimeCache';
import { emptyRpStorybook, normalizeRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import type { WorkflowNode } from '../types';
import type { CharacterRegistryEntry } from './registry';
import type { NpcParticipantSnapshots } from './npcParticipants';

it('reuses character projections across runtime updates and invalidates changed character sources', () => {
  const read = createNpcRuntimeCache();
  const library: CharacterRegistryEntry[] = [];
  const snapshots: NpcParticipantSnapshots = {};
  const book = (name: string) => rpStorybookJsonText(normalizeRpStorybook({ ...emptyRpStorybook,
    characters: [{ id: 'player', name, playable: true }] }));
  const nodes = [{ id: 'book', data: { nodeType: 'rp-storybook', storybookJson: book('Player') } },
    { id: 'llm', data: { nodeType: 'llm-prompt' } }] as WorkflowNode[];
  const initial = read(nodes, library, snapshots);
  expect(initial.characters[0].name).toBe('Player');
  const streaming = nodes.map((node) => ({ ...node, position: { x: 20, y: 30 },
    data: { ...node.data, llmActiveReasoningTokens: 25 } }));
  expect(read(streaming, library, snapshots)).toBe(initial);
  const edited = [{ ...nodes[0], data: { ...nodes[0].data, storybookJson: book('Changed') } }, nodes[1]];
  const updated = read(edited, library, snapshots);
  expect(updated).not.toBe(initial);
  expect(updated.characters[0].name).toBe('Changed');
  const reloaded = read(edited, [...library], snapshots);
  expect(reloaded).not.toBe(updated);
  expect(read(edited, reloaded.library, { ...snapshots })).not.toBe(reloaded);
  expect(read([nodes[1]], library, snapshots).characters).toEqual([]);
});
