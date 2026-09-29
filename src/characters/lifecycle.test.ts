import { describe, expect, it } from 'vitest';
import { characterUsageReasons, characterRemovalInfo, characterStoryTextWarnings, storybookWithRetiredCharacter } from './lifecycle';
import { normalizeRpStorybook, parseRpStorybookJson, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { buildCharacterRegistry, resolveRegistryAccount, type CharacterRegistryEntry } from './registry';
import { npcSnapshotEntries, parseNpcParticipantSnapshots } from './npcParticipants';
import { appCharactersFromRegistry } from './appRuntime';
import { initialCharacterPosts } from './publications';
import { planCharacterCardImport } from '../storybook/characterCard';
import { createCharacterContainer } from './creator';
import { appStateFromSessionV2, sessionV2FromCurrentState } from '../data-management/sessionStore';
import { currentWorkflowFormatVersion } from '../workflow/version';
import { currentCoreNodeVersions } from '../nodes/nodeVersion';
import { applyTurnCheckpointToNodes, createTurnCheckpointFromNodesForTurnRecord } from '../data-management/checkpointStore';
import { restoreTurnRuntime } from '../chat/turns';
import { storybookRegistryEntries } from './npcParticipantRuntime';
import type { TurnRecord, MessageRecord, WorkflowNode, WorkflowFile } from '../types';

const book = () => normalizeRpStorybook({ characters: [{ id: 'ari', name: 'Ari Blume', description: 'Artist',
  personality: 'Curious', speechStyle: 'Warm', role: 'Friend', playable: true,
  images: [{ id: 'ari-image', name: 'Portrait', mimeType: 'image/jpeg', size: 3, dataUrl: 'data:image/jpeg;base64,YWJj', description: 'Portrait' }],
  apps: { fotogram: { accountId: 'ari-fg', enabled: true, username: 'ari.art', displayName: 'Ari', bio: 'Art',
    initialPosts: [{ id: 'post', text: 'Hello', imageId: 'ari-image' }] } } }] });
const entries = (npcOrigin?: boolean): CharacterRegistryEntry[] => [{ character: book().characters[0], tier: 'storybook', source: 'book',
  aliases: { characterIds: ['book:character:ari'] } }, ...(npcOrigin ? [{ character: book().characters[0], tier: 'snapshot' as const, source: 'old' }] : [])];

it('allows an unused character despite unrelated chat, generated context and a promotion snapshot', () => {
  const character = book().characters[0];
  expect(characterUsageReasons(character, {}, { messages: [{ originalText: 'Espen says hello.' }],
    graphText: 'Character: Ari Blume', npcParticipants: { ari: { character } } })).toEqual([]);
  expect(characterRemovalInfo(character, structuredClone(character), []).matchesLibrary).toBe(true);
  expect(characterRemovalInfo({ ...character, description: 'Changed' }, character, []).matchesLibrary).toBe(false);
});

it('warns for individual character name parts without matching partial words', () => {
  const storybook = book();
  storybook.introduction = 'Ari arrives with a suitcase.';
  storybook.scenario.summary = 'Ari Blumenthal owns the hotel.';
  storybook.scenario.openingSituation = 'BLUME waits in the lobby.';
  storybook.scenario.currentSituation = 'The lobby is quiet.';

  expect(characterStoryTextWarnings(storybook, 'Ari Blume')).toEqual([
    '“Ari” is still mentioned in Introduction, Scenario Summary. Review the story text with “Check Story Logic” in the Storybook assistant.',
    '“Blume” is still mentioned in Opening Situation. Review the story text with “Check Story Logic” in the Storybook assistant.',
  ]);
});

it.each([
  { phoneToAccountId: 'character:ari:whatsup' },
  { socialDirectMessage: { toAccountId: 'ari-fg' } },
  { originalText: 'I spoke with Ari Blume yesterday.' },
  { matchMeMatch: { accountIds: ['ari-fg'] } },
  { likes: { 'someone/fotogram': ['npc-seed:["ari-fg","post"]'] } },
  { notes: { 'book:character:ari': ['Note'] } },
  { connections: { other: { fotogram: ['storybook:ari'] } } },
  { connections: { other: { onlyfriends: ['storybook:book:character:ari'] } } },
  { connections: { other: { fotogram: ['storybook:ari-fg'] } } },
  { phoneImageIds: ['ari-image'] },
])('blocks deletion for retained references: %j', (history) => {
  expect(characterUsageReasons(book().characters[0], { characterIds: ['book:character:ari'] }, history)).toHaveLength(1);
});

it('does not treat authored relationships as retained activity', () => {
  const character = book().characters[0];
  expect(characterUsageReasons(character, {}, [])).toEqual([]);
});

describe.each([false, true])('retiring a character with NPC origin %s', (npcOrigin) => {
  it('preserves runtime and post identities across retirement, library deletion and promotion', () => {
    const before = buildCharacterRegistry(entries(npcOrigin));
    const retired = storybookWithRetiredCharacter(book(), before.characters[0]);
    const restored = parseRpStorybookJson(rpStorybookJsonText(retired));
    expect(restored.characters).toHaveLength(0);
    const archive = parseNpcParticipantSnapshots(restored.openingHistory.npcParticipants);
    const after = buildCharacterRegistry(npcSnapshotEntries(archive));
    expect(after.characters[0].playerSelectable).toBe(false);
    expect(after.characters[0].character.description).toBe('Artist');
    expect(appCharactersFromRegistry(after)[0].id).toBe(appCharactersFromRegistry(before)[0].id);
    expect(initialCharacterPosts(appCharactersFromRegistry(after))).toEqual(initialCharacterPosts(appCharactersFromRegistry(before)));
    expect(resolveRegistryAccount(after, 'fotogram', 'ari-fg').status).toBe('found');
    const plan = planCharacterCardImport(createCharacterContainer(after.characters[0].character, true), restored);
    const promoted = buildCharacterRegistry([...npcSnapshotEntries(archive), { ...entries()[0], character: plan.character }]);
    expect(promoted.characters[0].playerSelectable).toBe(true);
    expect(initialCharacterPosts(appCharactersFromRegistry(promoted))).toEqual(initialCharacterPosts(appCharactersFromRegistry(before)));
  });

  it('round trips the retired character and its media through an RP save without library files', () => {
    const retired = storybookWithRetiredCharacter(book(), buildCharacterRegistry(entries(npcOrigin)).characters[0]);
    const node = { id: 'book', type: 'workflow', position: { x: 0, y: 0 }, data: { nodeType: 'rp-storybook',
      nodeDataVersion: currentCoreNodeVersions['rp-storybook'], label: 'Book', description: '', preview: '', storybookJson: rpStorybookJsonText(retired) } } as WorkflowNode;
    const workflow: WorkflowFile = { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion, savedAt: '2026-09-14T00:00:00Z', nodes: [node], edges: [] };
    const save = sessionV2FromCurrentState({ name: 'Retirement', settings: { englishProcessingEnabled: true, displayLanguage: 'en' },
      workflowVariables: {}, turns: [], turnCheckpoints: [], openingMessages: [], npcParticipants: retired.openingHistory.npcParticipants }, workflow, [node], workflow.savedAt);
    const loaded = appStateFromSessionV2(JSON.parse(JSON.stringify(save)));
    expect(loaded.npcParticipants.ari.npcOrigin).toBe(npcOrigin);
    expect(loaded.npcParticipants.ari.character.images[0].dataUrl).toBe('data:image/jpeg;base64,YWJj');
    expect(buildCharacterRegistry(npcSnapshotEntries(loaded.npcParticipants)).characters[0].playerSelectable).toBe(false);
  });
});

it('undoes two turns after retirement and reloads without restoring playability or losing media', () => {
  const makeNode = (value: ReturnType<typeof book>): WorkflowNode => ({ id: 'book', type: 'workflow', position: { x: 0, y: 0 },
    data: { nodeType: 'rp-storybook', nodeDataVersion: currentCoreNodeVersions['rp-storybook'], label: 'Book',
      description: '', preview: '', storybookJson: rpStorybookJsonText(value) } });
  const original = book();
  const first = { ...original, title: 'Turn one' };
  const second = { ...first, title: 'Turn two' };
  const turnOne: TurnRecord = { id: 'one', number: 1, createdAt: '2026-09-14T00:00:00Z',
    input: { graphText: '', messages: [] }, output: { graphText: '', messages: [] } };
  const post: MessageRecord = { id: 1, role: 'user', originalText: 'Published a post',
    socialPost: { postId: 'live-post', app: 'fotogram', author: 'Ari Blume', authorHandle: 'ari.art',
      caption: 'Hello', imageIds: ['ari-image'] } as MessageRecord['socialPost'] };
  const turnTwo: TurnRecord = { ...turnOne, id: 'two', number: 2, input: { graphText: '', messages: [post] } };
  const checkpoints = [createTurnCheckpointFromNodesForTurnRecord(turnOne, [makeNode(original)], [makeNode(first)]),
    createTurnCheckpointFromNodesForTurnRecord(turnTwo, [makeNode(first)], [makeNode(second)])];
  const retired = storybookWithRetiredCharacter(second, buildCharacterRegistry(entries()).characters[0]);
  let nodes = [makeNode(retired)];
  for (const checkpoint of [...checkpoints].reverse()) nodes = applyTurnCheckpointToNodes(nodes, JSON.parse(JSON.stringify(checkpoint)), 'before');
  const workflow: WorkflowFile = { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion,
    savedAt: turnOne.createdAt, nodes, edges: [] };
  const saved = sessionV2FromCurrentState({ name: 'Undo retirement', settings: { englishProcessingEnabled: false, displayLanguage: 'en' },
    workflowVariables: {}, turns: [], turnCheckpoints: [], openingMessages: [], npcParticipants: retired.openingHistory.npcParticipants }, workflow, nodes);
  const loaded = appStateFromSessionV2(JSON.parse(JSON.stringify(saved)));
  const restored = restoreTurnRuntime(nodes, loaded.currentRuntime);
  const registry = buildCharacterRegistry([...storybookRegistryEntries(restored), ...npcSnapshotEntries(loaded.npcParticipants)]);
  expect(loaded.turns).toEqual([]);
  expect(characterUsageReasons(registry.characters[0].character, registry.characters[0].aliases, loaded.turns)).toEqual([]);
  expect(registry.characters).toHaveLength(1);
  expect(registry.characters[0].playerSelectable).toBe(false);
  expect(registry.characters[0].character.apps?.fotogram?.accountId).toBe('ari-fg');
  expect(registry.characters[0].character.images[0].dataUrl).toBe('data:image/jpeg;base64,YWJj');
  expect(parseRpStorybookJson(restored[0].data.storybookJson!).title).toBe(original.title);
});
