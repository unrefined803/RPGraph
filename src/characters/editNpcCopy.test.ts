import { expect, it } from 'vitest';
import { planNpcCopyEdit } from './editNpcCopy';
import { newAssistantCharacter } from './assistant';
import { npcSnapshotEntries, type NpcParticipantSnapshots } from './npcParticipants';
import { buildCharacterRegistry } from './registry';
import { emptyRpStorybook, parseRpStorybookJson, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { appStateFromSessionV2, sessionV2FromCurrentState } from '../data-management/sessionStore';
import { currentWorkflowFormatVersion } from '../workflow/version';
import type { WorkflowFile, WorkflowNode } from '../types';

function setup() {
  const character = { ...newAssistantCharacter(), name: 'Alex', role: 'Friend', images: [{ id: 'portrait', name: 'Portrait',
    mimeType: 'image/jpeg' as const, size: 3, dataUrl: 'data:image/jpeg;base64,YWJj', description: 'Original portrait' }] };
  const snapshots: NpcParticipantSnapshots = { [character.id]: { character, source: 'original.json', npcOrigin: true,
    aliases: { characterIds: ['old-alias'] } } };
  const nodes: WorkflowNode[] = ['one', 'two'].map((id) => ({ id, type: 'workflow', position: { x: 0, y: 0 },
    data: { nodeType: 'rp-storybook', label: 'Book', description: '', preview: '', storybookJson: rpStorybookJsonText({ ...emptyRpStorybook,
      openingHistory: { ...emptyRpStorybook.openingHistory, npcParticipants: snapshots } }) } }));
  const registry = buildCharacterRegistry([{ character, tier: 'bundled', source: 'original.json' }, ...npcSnapshotEntries(snapshots)]);
  return { character, snapshots, nodes, registry, expected: snapshots[character.id] };
}

it('applies an RP edit to every portable copy, preserving provenance and the library version across save/load', () => {
  const { character, snapshots, nodes, registry, expected } = setup();
  const draft = { ...character, role: 'Rival' };
  const plan = planNpcCopyEdit(nodes, snapshots, registry, expected, draft, []);
  expect(character.role).toBe('Friend');
  expect(snapshots[character.id]).toBe(expected);
  expect(plan.participants[character.id]).toMatchObject({ source: 'original.json', npcOrigin: true,
    aliases: { characterIds: ['old-alias'] }, character: { role: 'Rival', playable: false } });
  for (const node of plan.nodes) {
    const book = parseRpStorybookJson(node.data.storybookJson!);
    expect(book.characters).toEqual([]);
    expect(book.openingHistory.npcParticipants![character.id].character.role).toBe('Rival');
  }
  const workflow: WorkflowFile = { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion,
    savedAt: '2026-09-14T00:00:00Z', nodes: plan.nodes, edges: [] };
  const saved = sessionV2FromCurrentState({ name: 'Edited NPC', settings: { englishProcessingEnabled: false, displayLanguage: 'en' },
    workflowVariables: {}, turns: [], turnCheckpoints: [], openingMessages: [], npcParticipants: plan.participants }, workflow, plan.nodes);
  const loaded = appStateFromSessionV2(JSON.parse(JSON.stringify(saved)));
  expect(loaded.npcParticipants[character.id].character).toMatchObject({ role: 'Rival', images: character.images });
  expect(buildCharacterRegistry(npcSnapshotEntries(loaded.npcParticipants)).characters[0].playerSelectable).toBe(false);
});

it('rejects stale sessions and a character that has become playable', () => {
  const { character, snapshots, nodes, registry, expected } = setup();
  expect(() => planNpcCopyEdit(nodes, structuredClone(snapshots), registry, expected, character, [])).toThrow('Reopen');
  const promoted = buildCharacterRegistry([...npcSnapshotEntries(snapshots), { character, tier: 'storybook', source: 'book' }]);
  expect(() => planNpcCopyEdit(nodes, snapshots, promoted, expected, character, [])).toThrow('Reopen');
});

it('rejects identity and media changes without mutating the RP', () => {
  const { character, snapshots, nodes, registry, expected } = setup();
  const original = JSON.stringify({ nodes, snapshots });
  for (const draft of [{ ...character, id: 'other' }, { ...character, name: 'Renamed' },
    { ...character, images: [] }, { ...character, images: [{ ...character.images[0], dataUrl: 'data:image/jpeg;base64,ZGVm' }] }]) {
    expect(() => planNpcCopyEdit(nodes, snapshots, registry, expected, draft, [])).toThrow();
    expect(JSON.stringify({ nodes, snapshots })).toBe(original);
  }
});

it('rejects changed account IDs and newly broken relationships', () => {
  const { character, snapshots, nodes, registry, expected } = setup();
  const account = character.apps!.whatsup!;
  expect(() => planNpcCopyEdit(nodes, snapshots, registry, expected, { ...character,
    apps: { ...character.apps, whatsup: { ...account, accountId: 'changed-account' } } }, [])).toThrow('account identity');
  expect(() => planNpcCopyEdit(nodes, snapshots, registry, expected, { ...character,
    relationships: [{ characterId: 'missing', description: 'Friend', apps: {} }] }, [])).toThrow();
});
