import { matchMePairId } from '../chat/matchMe';
import { currentCoreNodeVersions } from '../nodes/nodeVersion';
import { describe, expect, it } from 'vitest';
import type { Character } from './character';
import {
  captureNpcParticipants, npcReferencesFromMessages, npcSeedPostKey, npcSnapshotEntries,
  parseNpcParticipantSnapshots,
} from './npcParticipants';
import {
  buildCharacterRegistry, resolveRegistryAccount, resolveRegistryImage, resolveRegistryInitialPost,
  type CharacterRegistryEntry,
} from './registry';
import { openingHistoryNpcParticipantsFromNodes, storybookRegistryEntries } from './npcParticipantRuntime';
import {
  emptyRpStorybook, parseRpStorybookJson, rpStorybookJsonText, rpStorybookPromptJsonText,
  type RpStorybook,
} from '../nodes/rp-storybook/model';
import { appStateFromSessionV2, sessionV2FromCurrentState } from '../data-management/sessionStore';
import { isRpgraphSessionV2 } from '../data-management/validation';
import { applyTurnCheckpointToNodes, createTurnCheckpointFromNodesForTurnRecord } from '../data-management/checkpointStore';
import { hydrateLoadedWorkflow } from '../app/workflowHydration';
import { currentWorkflowFormatVersion } from '../workflow/version';
import type { MessageRecord, TurnRecord, WorkflowFile, WorkflowNode } from '../types';

const now = '2026-09-07T12:00:00Z';
const image = { id: 'portrait', name: 'Portrait', mimeType: 'image/jpeg' as const, size: 3,
  dataUrl: 'data:image/jpeg;base64,YWJj', description: 'Fictional portrait' };
function character(id = 'nova'): Character {
  return { id, name: 'Nova', description: 'Artist', personality: 'Original personality', speechStyle: 'Warm',
    role: 'NPC', playable: true, images: [structuredClone(image)],
    profileImage: { imageId: image.id, dataUrl: image.dataUrl, crop: { x: 0, y: 0, size: 1 } },
    apps: {
      fotogram: { accountId: `${id}-fg`, enabled: true, username: `${id}.art`, displayName: 'Nova', bio: 'Original bio',
        avatarImageId: image.id, initialPosts: [{ id: 'seed', text: 'First post', imageId: image.id }] },
      matchme: { accountId: `${id}-mm`, enabled: true, username: `${id}.date`, displayName: 'Nova', bio: 'Hello' },
    } };
}
const entry = (value = character()): CharacterRegistryEntry => ({ character: value, tier: 'user', source: 'arbitrary.json' });
const match: MessageRecord = { id: 1, role: 'user', originalText: '', matchMeMatch: {
  id: matchMePairId('player-mm', 'nova-mm'), accountIds: ['player-mm', 'nova-mm'], matchedAt: now, status: 'active',
} };
const turn: TurnRecord = { id: 'turn', number: 1, createdAt: now,
  input: { graphText: '', messages: [match] }, output: { graphText: '', messages: [] } };
const node = (book: RpStorybook = emptyRpStorybook, nodeType = 'rp-storybook'): WorkflowNode => ({
  id: 'book', type: 'workflow', position: { x: 0, y: 0 }, data: { nodeType,
    nodeDataVersion: currentCoreNodeVersions[nodeType as 'rp-storybook' | 'rp-storybook-editor'],
    label: 'Book', description: '', preview: '', storybookJson: rpStorybookJsonText(book) },
} as WorkflowNode);
const workflow = (nodes: WorkflowNode[]): WorkflowFile => ({ format: 'rpgraph-workflow',
  formatVersion: currentWorkflowFormatVersion, savedAt: now, nodes, edges: [] });
const pin = (value = character()) => captureNpcParticipants({}, [entry(value)], npcReferencesFromMessages([match]));
const save = (snapshots = pin(), nodes = [node()], turns = [turn]) => sessionV2FromCurrentState({
  name: 'Snapshot test', settings: { englishProcessingEnabled: true, displayLanguage: 'en' },
  workflowVariables: {}, turns, turnCheckpoints: [], openingMessages: [], npcParticipants: snapshots,
  socialConnectionsByCharacter: { player: { fotogram: ['nova-fg'] } },
  socialLikesByAccount: { 'player/fotogram': [npcSeedPostKey('nova-fg', 'seed')] },
}, workflow(nodes), nodes, now);

describe('saved NPC revisions', () => {
  it('captures a match once, without retaining mutable library objects or copying activity', () => {
    const source = character();
    const snapshots = pin(source);
    source.personality = 'Changed';
    source.images[0].dataUrl = 'data:image/jpeg;base64,ZGVm';
    expect(snapshots.nova.character.personality).toBe('Original personality');
    expect(snapshots.nova.character.images[0].dataUrl).toBe(image.dataUrl);
    expect(captureNpcParticipants(snapshots, [entry(source)], npcReferencesFromMessages([match]))).toBe(snapshots);
    expect(Object.keys(snapshots)).toEqual(['nova']);
    expect(snapshots.nova).not.toHaveProperty('matchMeMatch');
  });

  it('keeps snapshots over changed/deleted sources, and Storybook over snapshots', () => {
    const snapshots = pin();
    const changed = character(); changed.personality = 'Changed';
    for (const library of [[], [entry(changed)]]) {
      const registry = buildCharacterRegistry([...library, ...npcSnapshotEntries(snapshots)]);
      expect(registry.characters[0].character.personality).toBe('Original personality');
      expect(registry.characters[0].playerSelectable).toBe(false);
      expect(resolveRegistryImage(registry, 'nova', 'portrait')).toEqual(image);
      expect(resolveRegistryInitialPost(registry, 'fotogram', 'nova-fg', 'seed')?.imageId).toBe('portrait');
    }
    const registry = buildCharacterRegistry([...npcSnapshotEntries(snapshots),
      ...storybookRegistryEntries([node({ ...emptyRpStorybook, characters: [changed] })])]);
    expect(registry.characters).toHaveLength(1);
    expect(registry.characters[0].character.personality).toBe('Changed');
    expect(captureNpcParticipants({}, storybookRegistryEntries([node({ ...emptyRpStorybook, characters: [changed] })]),
      npcReferencesFromMessages([match]))).toEqual({});
  });

  it('pins connections, seeded-post actions and messages, but not free text or ambiguous seeds', () => {
    const entries = [entry(), entry(character('other'))];
    expect(captureNpcParticipants({}, entries, [{ kind: 'account', app: 'fotogram', id: 'nova-fg' }])).toHaveProperty('nova');
    expect(captureNpcParticipants({}, entries, [{ kind: 'post', app: 'fotogram', id: 'seed' }])).toEqual({});
    expect(Object.keys(captureNpcParticipants({}, entries, [{ kind: 'post', app: 'fotogram',
      id: npcSeedPostKey('other-fg', 'seed') }]))).toEqual(['other']);
    expect(captureNpcParticipants({}, entries, [{ kind: 'character', id: 'Nova' }])).toEqual({});
    expect(captureNpcParticipants({}, entries, [{ kind: 'account', app: 'fotogram', id: 'Nova' }])).toEqual({});
    expect(captureNpcParticipants({}, entries, [{ kind: 'account', app: 'fotogram', id: 'nova.art', canonical: true }])).toEqual({});
    expect(npcReferencesFromMessages([{ id: 3, role: 'user', originalText: 'I matched nova-mm and liked seed' }])).toEqual([]);
    const dm: MessageRecord = { id: 4, role: 'output', originalText: '', socialDirectMessage: {
      app: 'fotogram', messageId: 'dm', from: 'Nova', fromHandle: 'nova.art', fromAccountId: 'nova-fg',
      to: 'Player', toHandle: 'player', toAccountId: 'player-fg', text: 'Hi', sentAt: now,
    } };
    expect(Object.keys(captureNpcParticipants({}, entries, npcReferencesFromMessages([dm])))).toEqual(['nova']);
    const thread: MessageRecord = { id: 5, role: 'user', originalText: '', socialThreadAction: {
      actionId: 'comment', action: 'comment', app: 'fotogram', postId: 'seed', postAuthor: 'Nova',
      postAuthorHandle: 'other.art', postCaption: 'First post', actor: 'Player', actorHandle: 'player', commentText: 'Hi',
    } };
    expect(Object.keys(captureNpcParticipants({}, entries, npcReferencesFromMessages([thread])))).toEqual(['other']);
  });

  it('pools media and restores IDs, gallery, profiles, matches, likes and connections from JSON', () => {
    const other = character('other');
    const snapshots = captureNpcParticipants(pin(), [entry(other)], [{ kind: 'character', id: 'other' }]);
    const stored = JSON.parse(JSON.stringify(save(snapshots)));
    expect(isRpgraphSessionV2(stored)).toBe(true);
    expect(Object.values(stored.entities.mediaData)).toEqual([image.dataUrl]);
    expect(stored.runtime.current.npcParticipantsJson).not.toContain(image.dataUrl);
    const loaded = appStateFromSessionV2(stored);
    expect(loaded.npcParticipants).toEqual(snapshots);
    expect(loaded.turns[0].input.messages[0].matchMeMatch).toEqual(match.matchMeMatch);
    expect(loaded.socialConnectionsByCharacter.player.fotogram).toEqual(['nova-fg']);
    expect(loaded.socialLikesByAccount['player/fotogram']).toEqual([npcSeedPostKey('nova-fg', 'seed')]);
    const registry = buildCharacterRegistry(npcSnapshotEntries(loaded.npcParticipants));
    expect(resolveRegistryAccount(registry, 'matchme', 'nova-mm').status).toBe('found');
  });

  it('rejects corrupted pooled media, malformed archives, wrong keys and dangling images', () => {
    const stored = save();
    delete stored.entities.mediaData;
    expect(isRpgraphSessionV2(stored)).toBe(false);
    expect(() => appStateFromSessionV2(stored)).toThrow('media reference');
    expect(() => parseNpcParticipantSnapshots(null)).toThrow();
    expect(() => parseNpcParticipantSnapshots({ wrong: pin().nova })).toThrow('identity');
    const bad = pin(); bad.nova.character.images = [];
    expect(() => parseNpcParticipantSnapshots(bad)).toThrow('gallery');
    const badStored = save(); badStored.runtime.current.npcParticipantsJson = '[]';
    expect(isRpgraphSessionV2(badStored)).toBe(false);
  });

  it('loads old saves without snapshots and gives independent stories independent revisions', () => {
    const old = save(); delete old.runtime.current.npcParticipantsJson;
    expect(isRpgraphSessionV2(old)).toBe(true);
    expect(appStateFromSessionV2(old).npcParticipants).toEqual({});
    const first = pin();
    const changed = character(); changed.personality = 'Latest revision';
    const second = pin(changed);
    expect(first.nova.character.personality).toBe('Original personality');
    expect(second.nova.character.personality).toBe('Latest revision');
    expect(save({}, [node()], []).timeline).toEqual([]);
    expect(captureNpcParticipants({}, [entry(changed)], [])).toEqual({});
  });

  it.each(['rp-storybook', 'rp-storybook-editor'])('retains a self-contained Opening History in %s', (type) => {
    const book: RpStorybook = { ...emptyRpStorybook, openingHistory: {
      ...emptyRpStorybook.openingHistory, npcParticipants: pin(), turns: [turn],
      socialLikes: { 'player/fotogram': [npcSeedPostKey('nova-fg', 'seed')] },
    } };
    const savedBook = parseRpStorybookJson(rpStorybookJsonText(book));
    expect(savedBook.characters).toEqual([]);
    expect(savedBook.openingHistory.npcParticipants).toEqual(pin());
    const nodes = [node(savedBook, type)];
    expect(openingHistoryNpcParticipantsFromNodes(nodes)).toEqual(pin());
    const hydrated = hydrateLoadedWorkflow({ workflow: workflow(nodes), defaultConnectionId: '', connectionIds: new Set() });
    expect(hydrated.openingNpcParticipants).toEqual(pin());
    expect(hydrated.openingTurns[0].input.messages[0].matchMeMatch).toEqual(match.matchMeMatch);
    const stored = save(pin(), nodes);
    const restored = appStateFromSessionV2(JSON.parse(JSON.stringify(stored)));
    expect(restored.npcParticipants).toEqual(pin());
    expect(Object.values(stored.entities.mediaData!)).toEqual([image.dataUrl]);
    const prompt = rpStorybookPromptJsonText(book);
    expect(prompt).not.toContain('Original personality');
    expect(prompt).not.toContain(image.dataUrl);
    const cleared = { ...book, openingHistory: emptyRpStorybook.openingHistory };
    expect(openingHistoryNpcParticipantsFromNodes([node(cleared, type)])).toEqual({});
  });


  it('validates Opening History media before workflow state can be committed', () => {
    const bad = pin(); bad.nova.character.images = [];
    const book = { ...emptyRpStorybook, openingHistory: { ...emptyRpStorybook.openingHistory, npcParticipants: bad } };
    expect(() => hydrateLoadedWorkflow({ workflow: workflow([node(book)]),
      defaultConnectionId: '', connectionIds: new Set() })).toThrow('gallery');
  });

  it('retains the pinned revision across saved checkpoint undo/redo without resurrecting matches', () => {
    const before = node();
    const after = node({ ...emptyRpStorybook, title: 'After turn' });
    const checkpoint = createTurnCheckpointFromNodesForTurnRecord(turn, [before], [after]);
    const stored = sessionV2FromCurrentState({ name: 'Undo', settings: { englishProcessingEnabled: true, displayLanguage: 'en' },
      workflowVariables: {}, turns: [turn], turnCheckpoints: [checkpoint], openingMessages: [], npcParticipants: pin(),
    }, workflow([after]), [after], now);
    const loaded = appStateFromSessionV2(JSON.parse(JSON.stringify(stored)));
    const undone = applyTurnCheckpointToNodes([after], loaded.turnCheckpoints[0], 'before');
    expect(undone[0].data.storybookJson).toBe(before.data.storybookJson);
    const rolledBack = appStateFromSessionV2(save(loaded.npcParticipants, undone, []));
    expect(rolledBack.turns).toEqual([]);
    expect(rolledBack.npcParticipants).toEqual(pin());
    const redone = applyTurnCheckpointToNodes(undone, loaded.turnCheckpoints[0], 'after');
    expect(redone[0].data.storybookJson).toBe(after.data.storybookJson);
    const registry = buildCharacterRegistry([...npcSnapshotEntries(rolledBack.npcParticipants), ...storybookRegistryEntries(redone)]);
    expect(resolveRegistryImage(registry, 'nova', 'portrait')).toEqual(image);
    expect(appStateFromSessionV2(save(rolledBack.npcParticipants, redone)).turns[0].input.messages[0].matchMeMatch).toEqual(match.matchMeMatch);
  });
});
