import { describe, expect, it } from 'vitest';
import { characterUsageReasons, characterRemovalInfo, storybookWithRetiredCharacter } from './lifecycle';
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
import type { WorkflowNode, WorkflowFile } from '../types';

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

it('blocks relationships without treating an unreferenced snapshot as activity', () => {
  const character = book().characters[0];
  expect(characterUsageReasons(character, {}, [], [{ ...character, id: 'other', relationships: [{ characterId: 'ari', description: 'Friend', apps: {} }] }])).toHaveLength(1);
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
