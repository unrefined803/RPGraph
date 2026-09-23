import { describe, expect, it, vi } from 'vitest';
import type { Character, CharacterApps } from './character';
import { acquireMessageContacts, messageContactGrants, reconcileNpcMessageContacts } from './messageContacts';
import { historicalContactCheckpoints } from './historicalContactCheckpoints';
import { applyTurnCheckpointToNodes, createTurnCheckpointFromNodesForTurnRecord } from '../data-management/checkpointStore';
import { openingHistoryCheckpointsFromNodes, openingHistoryTurnsFromNodes } from '../storybook/openingHistoryRuntime';
import { appCharactersFromRegistry } from './appRuntime';
import { buildCharacterRegistry, type CharacterRegistryEntry } from './registry';
import { npcSnapshotEntries } from './npcParticipants';
import { openingHistoryNpcParticipantsFromNodes, storybookRegistryEntries } from './npcParticipantRuntime';
import { npcPromotionCard } from './promotion';
import { planCharacterCardImport } from '../storybook/characterCard';
import { storybookWithRetiredCharacter } from './lifecycle';
import { bindAccountLinks } from '../chat/accountLinks';
import { emptyRpStorybook, parseRpStorybookJson, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { currentCoreNodeVersions } from '../nodes/nodeVersion';
import { appStateFromSessionV2, sessionV2FromCurrentState } from '../data-management/sessionStore';
import { isRpgraphSessionV2 } from '../data-management/validation';
import { currentWorkflowFormatVersion } from '../workflow/version';
import type { MessageRecord, TurnRecord, WorkflowNode } from '../types';

const now = '2026-09-15T12:00:00Z';
function person(id: string): Character {
  return { id, name: `Person ${id}`, description: '', personality: '', speechStyle: '', role: '', images: [],
    playable: true, relationships: [], apps: Object.fromEntries(['whatsup', 'fotogram', 'onlyfriends', 'matchme'].map((app) =>
      [app, { accountId: `${id}:${app}`, enabled: true, username: `${id}.${app}`, displayName: `Person ${id}`, bio: '' }])) };
}
function setup() {
  const book = { ...structuredClone(emptyRpStorybook), characters: [person('player')] };
  const nodes: WorkflowNode[] = [{ id: 'book', type: 'workflow', position: { x: 0, y: 0 }, data: {
    nodeType: 'rp-storybook', nodeDataVersion: currentCoreNodeVersions['rp-storybook'], label: 'Book', description: '', preview: '',
    storybookJson: rpStorybookJsonText(book),
  } }];
  const library: CharacterRegistryEntry[] = ['npc', 'third'].map((id) => ({ character: person(id), tier: 'user', source: `${id}.json` }));
  const entries = [...library, ...storybookRegistryEntries(nodes)];
  return { nodes, library, entries, characters: appCharactersFromRegistry(buildCharacterRegistry(entries)) };
}
function dm(app: keyof CharacterApps = 'fotogram', from = 'player', to = 'npc', text = 'Hello'): MessageRecord {
  if (app === 'whatsup') return { id: 1, role: 'output', originalText: text, phoneMessage: true,
    phoneFrom: `Person ${from}`, phoneTo: `Person ${to}`, phoneFromAccountId: `${from}:${app}`, phoneToAccountId: `${to}:${app}` };
  return { id: 1, role: 'output', originalText: text, socialDirectMessage: { app, messageId: 'dm',
    from: `Person ${from}`, to: `Person ${to}`, fromHandle: `${from}.${app}`, toHandle: `${to}.${app}`,
    fromAccountId: `${from}:${app}`, toAccountId: `${to}:${app}`, text, sentAt: now } };
}
const contact = (characterId: string, app: keyof CharacterApps, description = '') => ({ characterId, description, apps: { [app]: true } });

describe('contacts acquired through private messages', () => {
  it.each(['whatsup', 'fotogram', 'onlyfriends', 'matchme'] as const)('requires a reply on %s and retracts NPC contacts when that reply is removed', (app) => {
    const { nodes, entries, characters } = setup();
    const first = { ...dm(app), role: 'user' as const };
    const reply = { ...dm(app, 'npc', 'player'), id: 2 };
    expect(messageContactGrants([first, { ...first, id: 3 }], characters)).toEqual([]);
    const pending = acquireMessageContacts(nodes, {}, entries, [first]);
    expect(pending.nodes).toBe(nodes);
    expect(pending.participants.npc.character.relationships).toEqual([]);
    const answered = acquireMessageContacts(nodes, pending.participants, entries, [first, reply]);
    expect(parseRpStorybookJson(answered.nodes[0].data.storybookJson!).characters[0].relationships).toEqual([contact('npc', app)]);
    expect(answered.participants.npc.character.relationships).toEqual([contact('player', app)]);
    expect(reconcileNpcMessageContacts(answered.participants, entries, [first]).npc.character.relationships).toEqual([]);
  });

  it('does not combine different apps, different recipients or MatchMe matches into a conversation', () => {
    const { characters } = setup();
    expect(messageContactGrants([dm(), dm('onlyfriends', 'npc', 'player'), dm('fotogram', 'third', 'player')], characters)).toEqual([]);
    const match: MessageRecord = { id: 3, role: 'user', originalText: 'Matched', matchMeMatch: {
      id: 'matchme:["npc:matchme","player:matchme"]', accountIds: ['npc:matchme', 'player:matchme'], matchedAt: now, status: 'active',
    } };
    expect(messageContactGrants([match, dm('matchme')], characters)).toEqual([]);
  });

  it('backfills a contact only in the later turn containing the reply', () => {
    const { nodes, entries, characters } = setup();
    const first = dm();
    const reply = { ...dm('fotogram', 'npc', 'player'), id: 2 };
    const turns: TurnRecord[] = [first, reply].map((message, index) => ({ id: `turn-${index}`, number: index + 1, createdAt: now,
      input: { graphText: '', messages: [] }, output: { graphText: '', messages: [message] } }));
    const acquired = acquireMessageContacts(nodes, {}, entries, [first, reply]);
    const history = historicalContactCheckpoints(nodes, acquired.nodes, [first, reply], turns, [], characters);
    expect(history.checkpoints.map((entry) => entry.turnId)).toEqual(['turn-1']);
    const before = applyTurnCheckpointToNodes(history.nodes, history.checkpoints[0], 'before');
    expect(parseRpStorybookJson(before[0].data.storybookJson!).characters[0].relationships).toEqual([]);
    const after = applyTurnCheckpointToNodes(before, history.checkpoints[0], 'after');
    expect(parseRpStorybookJson(after[0].data.storybookJson!).characters[0].relationships).toEqual([contact('npc', 'fotogram')]);
  });

  it('backfills old Opening History checkpoints and replaces the shared contact on regeneration', () => {
    const { nodes, library } = setup();
    const first = dm('whatsup', 'npc', 'player', '@fotogram:Person third');
    const turn: TurnRecord = { id: 'old-turn', number: 1, createdAt: now,
      input: { graphText: '', messages: [] }, output: { graphText: '', messages: [first] } };
    const book = parseRpStorybookJson(nodes[0].data.storybookJson!);
    book.characters[0].relationships = [contact('npc', 'onlyfriends', 'An existing contact.')];
    book.openingHistory.turns = [turn];
    const initial = [{ ...nodes[0], data: { ...nodes[0].data, storybookJson: rpStorybookJsonText(book) } }];
    const turns = openingHistoryTurnsFromNodes(initial);
    const messages = turns.flatMap((entry) => entry.output.messages);
    const entries = [...library, ...storybookRegistryEntries(initial)];
    const acquired = acquireMessageContacts(initial, {}, entries, messages);
    const history = historicalContactCheckpoints(initial, acquired.nodes, messages, turns, [],
      appCharactersFromRegistry(buildCharacterRegistry(entries)));
    expect(history.checkpoints).toHaveLength(1);
    const reverted = applyTurnCheckpointToNodes(history.nodes, history.checkpoints[0], 'before');
    expect(parseRpStorybookJson(reverted[0].data.storybookJson!).characters[0].relationships)
      .toEqual([contact('npc', 'onlyfriends', 'An existing contact.')]);
    // The migrated checkpoint is also present in a saved standalone Storybook.
    const portable = openingHistoryCheckpointsFromNodes(history.nodes);
    expect(portable).toHaveLength(1);
    expect(applyTurnCheckpointToNodes(history.nodes, portable[0], 'before')).toEqual(reverted);
    const replacement = dm('whatsup', 'npc', 'player', '@fotogram:Person npc');
    const regenerated = acquireMessageContacts(reverted, acquired.participants,
      [...library, ...storybookRegistryEntries(reverted)], [replacement]);
    const relationships = parseRpStorybookJson(regenerated.nodes[0].data.storybookJson!).characters[0].relationships;
    expect(relationships).toEqual([{ characterId: 'npc', description: 'An existing contact.',
      apps: { onlyfriends: true, fotogram: true } }]);
    const nextCheckpoint = createTurnCheckpointFromNodesForTurnRecord({ ...turn, output: { graphText: '', messages: [replacement] } },
      reverted, regenerated.nodes);
    expect(parseRpStorybookJson(applyTurnCheckpointToNodes(regenerated.nodes, nextCheckpoint, 'before')[0].data.storybookJson!).characters[0].relationships)
      .toEqual([contact('npc', 'onlyfriends', 'An existing contact.')]);
  });

  it('keeps earlier contacts across repeated historical messages and preserves unrelated checkpoint state', () => {
    const { nodes, entries, characters } = setup();
    const turns: TurnRecord[] = [1, 2].map((id) => ({ id: `turn-${id}`, number: id, createdAt: now,
      input: { graphText: '', messages: [] }, output: { graphText: '', messages: id === 1 ? [{ ...dm(), id }, { ...dm('fotogram', 'npc', 'player'), id: 10 }] : [{ ...dm(), id }] } }));
    const messages = turns.flatMap((turn) => turn.output.messages);
    const acquired = acquireMessageContacts(nodes, {}, entries, messages);
    const original = { turnId: turns[1].id, createdTimelineEntryIds: ['keep'], nodeSnapshots: {},
      workflowVariables: { before: { weather: 'sun' }, after: { weather: 'rain' } } };
    const history = historicalContactCheckpoints(nodes, acquired.nodes, messages, turns, [original], characters);
    const second = history.checkpoints.find((checkpoint) => checkpoint.turnId === turns[1].id)!;
    expect(second.workflowVariables).toEqual(original.workflowVariables);
    const revertedSecond = applyTurnCheckpointToNodes(history.nodes, second, 'before');
    expect(parseRpStorybookJson(revertedSecond[0].data.storybookJson!).characters[0].relationships).toEqual([contact('npc', 'fotogram')]);
    const revertedFirst = applyTurnCheckpointToNodes(revertedSecond, history.checkpoints.find((checkpoint) => checkpoint.turnId === turns[0].id)!, 'before');
    expect(parseRpStorybookJson(revertedFirst[0].data.storybookJson!).characters[0].relationships).toEqual([]);
  });

  it('reconciles NPC contacts on undo, replacement and a cancelled replacement without touching authored contacts', () => {
    const { nodes, entries } = setup();
    entries.find((entry) => entry.character.id === 'npc')!.character.relationships = [contact('player', 'onlyfriends', 'An old friend.')];
    const original = dm('whatsup', 'player', 'npc', '@fotogram:Person third');
    const acquired = acquireMessageContacts(nodes, {}, entries, [original]);
    const retained = { ...dm('whatsup', 'player', 'npc'), id: 2 };
    const withoutLink = reconcileNpcMessageContacts(acquired.participants, entries, [retained]);
    expect(withoutLink.npc.character.relationships).toEqual([{ characterId: 'player', description: 'An old friend.', apps: { onlyfriends: true } }]);
    const undone = reconcileNpcMessageContacts(withoutLink, entries, []);
    expect(undone.npc.character.relationships).toEqual([contact('player', 'onlyfriends', 'An old friend.')]);
    const replacement = dm('whatsup', 'player', 'npc', '@fotogram:Person player');
    const regenerated = acquireMessageContacts(nodes, undone, entries, [replacement]);
    expect(regenerated.participants.npc.character.relationships).toEqual([{ characterId: 'player', description: 'An old friend.',
      apps: { onlyfriends: true, fotogram: true } }]);
    const cancelled = reconcileNpcMessageContacts(regenerated.participants, entries, [original]);
    expect(cancelled.npc.character.relationships).toEqual(acquired.participants.npc.character.relationships);
    expect(reconcileNpcMessageContacts(cancelled, entries, [original])).toBe(cancelled);
  });

  it.each(['whatsup', 'fotogram', 'onlyfriends', 'matchme'] as const)('writes reciprocal %s contacts into Storybook and NPC copies', (app) => {
    const { nodes, entries, library } = setup();
    const before = structuredClone({ nodes, library });
    const result = acquireMessageContacts(nodes, {}, entries, [dm(app), dm(app, 'npc', 'player')]);
    expect(parseRpStorybookJson(result.nodes[0].data.storybookJson!).characters[0].relationships).toEqual([contact('npc', app)]);
    expect(result.participants.npc.character.relationships).toEqual([contact('player', app)]);
    expect(result.participants.player).toBeUndefined();
    expect(result.participants.third).toBeUndefined();
    expect({ nodes, library }).toEqual(before);
    const repeated = acquireMessageContacts(result.nodes, result.participants,
      [...library, ...storybookRegistryEntries(result.nodes)], [dm(app), dm(app, 'npc', 'player')]);
    expect(repeated.nodes).toBe(result.nodes);
    expect(repeated.participants).toBe(result.participants);
  });

  it('keeps descriptions and other app flags while merging contacts by stable character ID', () => {
    const { nodes, entries } = setup();
    const npc = entries.find((entry) => entry.character.id === 'npc')!;
    npc.character.relationships = [contact('player', 'whatsup', 'A trusted colleague.')];
    const result = acquireMessageContacts(nodes, {}, entries, [dm(), dm('fotogram', 'npc', 'player'), dm('onlyfriends'), dm('onlyfriends', 'npc', 'player')]);
    expect(result.participants.npc.character.relationships).toEqual([{ characterId: 'player',
      description: 'A trusted colleague.', apps: { whatsup: true, fotogram: true, onlyfriends: true } }]);
    expect(npc.character.relationships).toEqual([contact('player', 'whatsup', 'A trusted colleague.')]);
  });

  it.each(['whatsup', 'fotogram', 'onlyfriends'] as const)('delivers a third-party %s link only to its recipient without a click', (app) => {
    const { nodes, entries, characters } = setup();
    const message = dm('whatsup', 'npc', 'player', `Here: @${app}:Person third`);
    message.accountLinks = bindAccountLinks(message.originalText, characters);
    const result = acquireMessageContacts(nodes, {}, entries, [message]);
    const player = parseRpStorybookJson(result.nodes[0].data.storybookJson!).characters[0];
    expect(player.relationships).toEqual([contact('third', app)]);
    expect(result.participants.npc.character.relationships).toEqual([]);
    expect(result.participants.third.character.relationships).toEqual([]);
  });

  it.each(['user', 'output'] as const)('stores a shared personal account for a %s message without connecting unrelated apps', (role) => {
    const { nodes, entries } = setup();
    const from = role === 'user' ? 'player' : 'npc';
    const to = role === 'user' ? 'npc' : 'player';
    const message = { ...dm('whatsup', from, to, `@fotogram:Person ${from}`), role };
    const result = acquireMessageContacts(nodes, {}, entries, [message]);
    const player = parseRpStorybookJson(result.nodes[0].data.storybookJson!).characters[0];
    const sender = from === 'player' ? player : result.participants.npc.character;
    const recipient = to === 'player' ? player : result.participants.npc.character;
    expect(sender.relationships).toEqual([]);
    expect(recipient.relationships).toEqual([{ characterId: from, description: '', apps: { fotogram: true } }]);
  });

  it('supports NPC-to-NPC messages, legacy handles and renamed bound accounts', () => {
    const { nodes, entries, characters } = setup();
    const message = dm('fotogram', 'npc', 'third', '@onlyfriends:Person player');
    message.socialDirectMessage!.accountLinks = bindAccountLinks(message.socialDirectMessage!.text, characters);
    entries.find((entry) => entry.character.id === 'player')!.character.name = 'Renamed player';
    delete message.socialDirectMessage!.fromAccountId;
    delete message.socialDirectMessage!.toAccountId;
    const result = acquireMessageContacts(nodes, {}, entries, [message]);
    expect(result.participants.npc.character.relationships).toEqual([]);
    expect(result.participants.third.character.relationships).toEqual([contact('player', 'onlyfriends')]);
  });

  it('does not create personal contacts from public text, errors, unknown accounts, self-DMs or unanswered MatchMe messages', () => {
    const { characters } = setup();
    const text: MessageRecord = { id: 1, role: 'output', originalText: 'Person npc @fotogram:Person third' };
    for (const message of [text, { ...dm(), role: 'error' as const }, dm('fotogram', 'unknown'),
      dm('fotogram', 'npc', 'npc'), dm('matchme'), dm('matchme', 'npc', 'player', '@matchme:Person third')]) {
      expect(messageContactGrants([message], characters)).toEqual([]);
    }
    characters.find((entry) => entry.sourceId === 'npc')!.apps!.fotogram!.enabled = false;
    expect(messageContactGrants([dm()], characters)).toEqual([]);
    const duplicate = structuredClone(characters.find((entry) => entry.sourceId === 'player')!);
    expect(messageContactGrants([dm('whatsup')], [...characters, duplicate])).toEqual([]);
  });

  it('does not rebind a stored account ID to another character with that name', () => {
    const { characters } = setup();
    const npc = characters.find((entry) => entry.sourceId === 'npc')!;
    npc.apps!.fotogram!.accountId = 'new-account';
    npc.name = 'npc:fotogram';
    expect(messageContactGrants([dm('fotogram', 'player', 'npc', '@onlyfriends:Person third')], characters)).toEqual([]);
  });

  it('round-trips acquired containers through RP saves and Opening History and keeps promotion edits', () => {
    const { nodes, entries, library } = setup();
    const message = dm('onlyfriends', 'npc', 'player', '@fotogram:Person third');
    const acquired = acquireMessageContacts(nodes, {}, entries, [message, dm('onlyfriends', 'player', 'npc')]);
    const turn: TurnRecord = { id: 'turn', number: 1, createdAt: now,
      input: { graphText: '', messages: [] }, output: { graphText: '', messages: [message] } };
    const session = sessionV2FromCurrentState({ name: 'Contacts', settings: { englishProcessingEnabled: true, displayLanguage: 'en' },
      workflowVariables: {}, turns: [turn], turnCheckpoints: [], openingMessages: [], npcParticipants: acquired.participants,
    }, { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion, savedAt: now, nodes: acquired.nodes, edges: [] }, acquired.nodes, now);
    expect(isRpgraphSessionV2(session)).toBe(true);
    const restored = appStateFromSessionV2(JSON.parse(JSON.stringify(session)));
    expect(restored.npcParticipants).toEqual(acquired.participants);
    const book = parseRpStorybookJson(acquired.nodes[0].data.storybookJson!);
    expect(parseRpStorybookJson(restored.currentRuntime.nodes.book.storybookJson as string).characters[0].relationships)
      .toEqual(book.characters[0].relationships);
    const withoutLibrary = acquireMessageContacts(acquired.nodes, restored.npcParticipants,
      storybookRegistryEntries(acquired.nodes), [message]);
    expect(withoutLibrary.nodes).toBe(acquired.nodes);
    expect(withoutLibrary.participants).toBe(restored.npcParticipants);
    const openingNodes = [{ ...acquired.nodes[0], data: { ...acquired.nodes[0].data, storybookJson: rpStorybookJsonText({ ...book,
      openingHistory: { ...book.openingHistory, npcParticipants: restored.npcParticipants, turns: [turn] } }) } }];
    expect(openingHistoryNpcParticipantsFromNodes(openingNodes)).toEqual(acquired.participants);
    const registry = buildCharacterRegistry([...library, ...storybookRegistryEntries(acquired.nodes), ...npcSnapshotEntries(restored.npcParticipants)]);
    const promoted = planCharacterCardImport(npcPromotionCard(registry, 'npc'), book).character;
    expect(promoted.relationships).toEqual([contact('player', 'onlyfriends')]);
    const promotedRegistry = buildCharacterRegistry([...library, { character: promoted, tier: 'storybook', source: 'book' }]);
    const retired = storybookWithRetiredCharacter({ ...book, characters: [...book.characters, promoted] },
      promotedRegistry.characters.find((entry) => entry.character.id === 'npc')!);
    expect(retired.openingHistory.npcParticipants!.npc.character.relationships).toEqual(promoted.relationships);
    expect(library.every((entry) => entry.character.relationships?.length === 0)).toBe(true);
  });
});

it('does not parse or serialize the storybook again for an established phone contact', () => {
  const { nodes, entries, library } = setup();
  const message = dm('whatsup');
  const first = acquireMessageContacts(nodes, {}, entries, [message, dm('whatsup', 'npc', 'player')]);
  expect(first.nodes).not.toBe(nodes);
  const refreshedEntries = [...library, ...storybookRegistryEntries(first.nodes)];
  const parse = vi.spyOn(JSON, 'parse');
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
    for (let index = 0; index < 10; index++) {
      const next = acquireMessageContacts(first.nodes, first.participants, refreshedEntries,
        [{ ...message, id: index + 2, originalText: `Next message ${index}` }]);
      expect(next.nodes).toBe(first.nodes);
      expect(next.participants).toBe(first.participants);
    }
    expect(parse.mock.calls.some(([text]) => text === first.nodes[0].data.storybookJson)).toBe(false);
    expect(stringify.mock.calls.some(([value]) => value && typeof value === 'object' &&
      'format' in value && value.format === 'rpgraph-storybook')).toBe(false);
  } finally { parse.mockRestore(); stringify.mockRestore(); }
  const added = acquireMessageContacts(first.nodes, first.participants, refreshedEntries, [dm('whatsup', 'player', 'third'), dm('whatsup', 'third', 'player')]);
  expect(added.nodes).not.toBe(first.nodes);
  expect(parseRpStorybookJson(added.nodes[0].data.storybookJson!).characters[0].relationships)
    .toEqual(expect.arrayContaining([expect.objectContaining({ characterId: 'third', apps: expect.objectContaining({ whatsup: true }) })]));
});
