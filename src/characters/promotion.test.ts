import { describe, expect, it } from 'vitest';
import fixture from './fixtures/stage4-npc.json';
import { type Character } from './character';
import { npcPromotionCard, planCharacterImportToNode } from './promotion';
import { appCharacterImage, appCharactersFromRegistry } from './appRuntime';
import { buildCharacterRegistry, resolveRegistryAccount, type CharacterRegistryEntry } from './registry';
import { captureNpcParticipants, npcReferencesFromMessages, npcSnapshotEntries } from './npcParticipants';
import { storybookRegistryEntries } from './npcParticipantRuntime';
import { initialCharacterPosts, postsWithInitialContent } from './publications';
import { buildSocialDirectory, resolveSocialDirectoryUser, searchSocialDirectory,
  socialConnectionIds, withSocialDirectoryConnectionAdded } from '../chat/socialDirectory';
import { incomingMatchMeMessage, matchMeLikePolicy, matchMeMessageAllowed, matchMePairId, matchMeState } from '../chat/matchMe';
import { socialDirectMessageInputText } from '../chat/socialMedia';
import { validateSocialMessengerAccounts } from '../chat/socialMessageValidation';
import { emptyRpStorybook, parseRpStorybookJson, rpStorybookJsonText, type RpStorybook } from '../nodes/rp-storybook/model';
import { currentCoreNodeVersions } from '../nodes/nodeVersion';
import { appStateFromSessionV2, sessionV2FromCurrentState, workflowV2ToWorkflowFile } from '../data-management/sessionStore';
import { currentWorkflowFormatVersion } from '../workflow/version';
import type { MessageRecord, WorkflowNode } from '../types';

const now = '2026-09-07T12:00:00Z';
const npc = () => structuredClone(fixture.character) as Character;
const library = (): CharacterRegistryEntry => ({ character: npc(), tier: 'user', source: 'renamable.json',
  aliases: { characterIds: ['old-node:nova'], accountIds: { matchme: ['old-nova-mm'], fotogram: ['old-nova-fg'] } } });
const node = (book = emptyRpStorybook, nodeType = 'rp-storybook', id = 'book'): WorkflowNode => ({
  id, type: 'workflow', position: { x: 0, y: 0 }, data: { nodeType,
    nodeDataVersion: currentCoreNodeVersions[nodeType as 'rp-storybook' | 'rp-storybook-editor'],
    label: 'Book', description: '', preview: '', storybookJson: rpStorybookJsonText(book) },
} as WorkflowNode);
function playerBook(): RpStorybook {
  const player = npc(); player.id = 'player'; player.name = 'Player'; player.images[0].id = 'player-lake';
  delete player.profileImage;
  for (const [app, account] of Object.entries(player.apps!)) {
    account.accountId = `player-${app}`; account.username = `player.${app}`;
    delete account.avatarImageId; delete account.initialPosts;
  }
  player.apps!.matchme!.profile!.photoIds = ['player-lake'];
  return { ...emptyRpStorybook, characters: [player] };
}

describe('Storybook NPC promotion', () => {
  it.each(['rp-storybook', 'rp-storybook-editor'])('preserves the full app/save round trip through %s', (nodeType) => {
    const nodes = [node(playerBook(), nodeType)];
    parseRpStorybookJson(nodes[0].data.storybookJson!);
    const entries = [...storybookRegistryEntries(nodes), library()];
    const initialRegistry = buildCharacterRegistry(entries);
    const characters = appCharactersFromRegistry(initialRegistry);
    const initialState = matchMeState(characters, []);
    expect(initialState.accounts.map((account) => account.id)).toContain('player-matchme');
    const match = matchMeLikePolicy('player-matchme', 'stage4-nova-mm', initialState, now)!;
    const messages: MessageRecord[] = [{ id: 1, role: 'user', originalText: '', matchMeMatch: match }];
    const outgoing = incomingMatchMeMessage('player-matchme', 'stage4-nova-mm', 'What is your Fotogram?', matchMeState(characters, messages), 'question', now)!;
    messages.push({ id: 2, role: 'user', originalText: '', socialDirectMessage: outgoing });
    expect(socialDirectMessageInputText(outgoing, messages, characters)).toContain('nova.vale.art');
    const directory = buildSocialDirectory({ storyCharacters: characters, messages }).users;
    const novaUser = searchSocialDirectory(directory, 'fotogram', '@nova.vale.art')[0];
    const player = characters.find((character) => character.sourceId === 'player')!;
    const connections = withSocialDirectoryConnectionAdded({}, directory, player.id, 'fotogram', novaUser.id);
    const seed = initialCharacterPosts(characters)[0];
    const snapshots = captureNpcParticipants({}, entries, npcReferencesFromMessages(messages));
    const card = npcPromotionCard(buildCharacterRegistry([...entries, ...npcSnapshotEntries(snapshots)]), fixture.character.id);
    for (let repeat = 0; repeat < 2; repeat++) {
      const plan = planCharacterImportToNode({ nodes, nodeId: 'book', card, snapshots,
        registry: buildCharacterRegistry([library(), ...storybookRegistryEntries(nodes), ...npcSnapshotEntries(snapshots)]) });
      expect(plan.character.playable).toBe(true);
      nodes[0] = node(plan.storybook, nodeType);
      expect(plan.storybook.characters).toHaveLength(2);
    }
    const saved = sessionV2FromCurrentState({ name: 'Promotion',
      settings: { englishProcessingEnabled: true, displayLanguage: 'en' }, workflowVariables: {},
      turns: [{ id: 'turn', number: 1, createdAt: now, input: { graphText: '', messages }, output: { graphText: '', messages: [] } }],
      turnCheckpoints: [], openingMessages: [], npcParticipants: snapshots,
      socialConnectionsByCharacter: connections, socialLikesByAccount: { player: [seed.postId] },
    }, { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion, savedAt: now, nodes, edges: [] }, nodes, now);
    const stored = JSON.parse(JSON.stringify(saved));
    const loaded = appStateFromSessionV2(stored);
    const restoredNodes = workflowV2ToWorkflowFile(stored.workflow).nodes;
    const changed = library(); changed.character.name = 'Changed source'; changed.character.images = [];
    for (const sources of [[], [changed]]) {
      const registry = buildCharacterRegistry([...sources, ...storybookRegistryEntries(restoredNodes), ...npcSnapshotEntries(loaded.npcParticipants)]);
      const current = appCharactersFromRegistry(registry);
      expect(current).toHaveLength(2);
      const nova = current.find((character) => character.sourceId === fixture.character.id)!;
      expect(nova.libraryNpc).toBe(false);
      expect(registry.characters.find((character) => character.character.id === fixture.character.id)?.provenance.tier).toBe('storybook');
      expect(appCharacterImage(current, 'lake', fixture.character.id)?.dataUrl).toBe(fixture.character.images[0].dataUrl);
      expect(initialCharacterPosts(current)).toEqual([seed]);
      const live = { id: 3, role: 'user' as const, originalText: '', socialPost: { ...seed, caption: 'Timeline wins' } };
      expect(postsWithInitialContent(current, [...messages, live]).filter((message) => message.socialPost)).toEqual([live]);
      const users = buildSocialDirectory({ storyCharacters: current, messages }).users;
      expect(searchSocialDirectory(users, 'fotogram', '@nova.vale.art')).toHaveLength(1);
      expect(resolveSocialDirectoryUser(users, novaUser.id)?.characterId).toBe(nova.id);
      expect(resolveSocialDirectoryUser(users, 'storybook:old-node:nova')?.characterId).toBe(nova.id);
      expect(socialConnectionIds(loaded.socialConnectionsByCharacter, nova.id, 'fotogram', current)).toContain(directory.find((user) => user.characterId === player.id)!.id);
      expect(loaded.socialLikesByAccount.player).toEqual([seed.postId]);
      expect(matchMeMessageAllowed(outgoing, matchMeState(current, messages))).toBe(true);
      const legacyMessages = [{ ...messages[0], matchMeMatch: { ...match, id: matchMePairId('player-matchme', 'old-nova-mm'), accountIds: ['player-matchme', 'old-nova-mm'] as [string, string] } }];
      expect(matchMeMessageAllowed(outgoing, matchMeState(current, legacyMessages))).toBe(true);
      expect(resolveRegistryAccount(registry, 'fotogram', 'old-nova-fg').status).toBe('found');
      const reply = JSON.stringify({ matchMeApp: [{ from: 'stage4-nova-mm', to: 'player-matchme', message: '@nova.vale.art' }] });
      expect(validateSocialMessengerAccounts({ text: reply, characters: current, messages, directMessage: outgoing }).issues).toEqual([]);
      expect(loaded.turns[0].input.messages).toMatchObject(messages);
    }
  });

  it('keeps same-name library people and their owner-scoped seeds independent', () => {
    const other = library(); other.character.id = 'other';
    for (const [app, account] of Object.entries(other.character.apps!)) {
      account.accountId = `other-${app}`; account.username = `other.${app}`;
    }
    const registry = buildCharacterRegistry([library(), other]);
    const card = npcPromotionCard(registry, fixture.character.id);
    const plan = planCharacterImportToNode({ nodes: [node()], nodeId: 'book', card, snapshots: {}, registry });
    const current = appCharactersFromRegistry(buildCharacterRegistry([library(), other,
      ...storybookRegistryEntries([node(plan.storybook)])]));
    expect(current.filter((character) => character.name === 'Nova Vale')).toHaveLength(2);
    const posts = initialCharacterPosts(current);
    expect(posts).toHaveLength(2);
    expect(new Set(posts.map((post) => post.postId)).size).toBe(2);
    expect(posts.find((post) => post.authorCharacterId === fixture.character.id)?.postId).toBe('first-post');
  });

  it('retains legacy private MatchMe state on repeated public import', () => {
    const registry = buildCharacterRegistry([library()]);
    const card = npcPromotionCard(registry, fixture.character.id);
    const first = planCharacterImportToNode({ nodes: [node()], nodeId: 'book', card, snapshots: {}, registry });
    const profile = first.character.apps!.matchme!.profile!;
    profile.decisions = { 'old-nova-mm': 'like' };
    profile.historyVersion = 1;
    profile.messages = [{ id: 'legacy', matchId: 'other', sender: 'owner', text: 'Retain me', sentAt: now }];
    const nodes = [node(first.storybook)];
    const again = planCharacterImportToNode({ nodes, nodeId: 'book', card, snapshots: {},
      registry: buildCharacterRegistry(storybookRegistryEntries(nodes)) });
    expect(again.character.apps?.matchme?.profile).toMatchObject({ decisions: profile.decisions,
      messages: profile.messages, historyVersion: 1 });
    expect(card.character.apps.matchme?.profile?.messages).toBeUndefined();
  });

  it('rejects destructive revisions and duplicate Storybook ownership before committing', () => {
    const source = library();
    const snapshots = captureNpcParticipants({}, [source], [{ kind: 'character', id: source.character.id }]);
    const nodes = [node()];
    const registry = buildCharacterRegistry([source, ...npcSnapshotEntries(snapshots)]);
    const options = { nodes, nodeId: 'book', snapshots, registry };
    for (const change of ['account', 'media', 'post']) {
      const card = npcPromotionCard(registry, source.character.id);
      if (change === 'account') card.character.apps.fotogram!.accountId = 'replacement';
      if (change === 'media') card.character.images[0].dataUrl = 'data:image/jpeg;base64,YWJj';
      if (change === 'post') card.character.apps.fotogram!.initialPosts = [];
      expect(() => planCharacterImportToNode({ ...options, card })).toThrow();
      expect(nodes).toEqual([node()]);
    }
    const card = npcPromotionCard(registry, source.character.id);
    const plan = planCharacterImportToNode({ ...options, card });
    expect(() => planCharacterImportToNode({ ...options, nodes: [...nodes, node(plan.storybook, 'rp-storybook-editor', 'other')], card })).toThrow('another Storybook');
    const duplicate = npcPromotionCard(registry, source.character.id); duplicate.character.id = 'different-person';
    expect(() => planCharacterImportToNode({ ...options, card: duplicate })).toThrow();
  });
});
