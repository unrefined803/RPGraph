import { describe, expect, it } from 'vitest';
import fixture from './fixtures/stage4-npc.json';
import { appCharacterImage, appCharactersFromRegistry, recipientCharacterContext } from './appRuntime';
import { validateCharacterContainer, type Character } from './character';
import { buildCharacterRegistry, type CharacterRegistryEntry } from './registry';
import { captureNpcParticipants, npcReferencesFromMessages, npcSeedPostKey, npcSnapshotEntries, parseNpcParticipantSnapshots } from './npcParticipants';
import {
  initialCharacterPosts,
  postsWithInitialContent,
  validateCandidateLegacySeedTimeline,
  withPublicationSnapshot,
} from './publications';
import { buildSocialDirectory, searchSocialDirectory } from '../chat/socialDirectory';
import { canSendMatchMeMessage, incomingMatchMeMessage, matchMeLikePolicy, matchMeMessageAllowed, matchMeState } from '../chat/matchMe';
import { parseSocialDirectMessageOutput, socialDirectMessageInputText } from '../chat/socialMedia';
import { resolveSocialMessageIdentity, validateSocialMessengerAccounts } from '../chat/socialMessageValidation';
import { phoneRuntimeCharactersFromMessages } from '../chat/phoneCharacters';
import { whatsUpMessageInputText } from '../chat/phoneReplies';
import type { MessageRecord } from '../types';

const now = '2026-09-07T12:00:00Z';
function npc(id = 'stage4-nova'): Character {
  const value = structuredClone(fixture.character) as Character;
  value.id = id;
  if (id !== 'stage4-nova') for (const [app, account] of Object.entries(value.apps!)) {
    account.accountId = `${id}-${app}`;
    account.username = `${id}.${app}`;
  }
  return value;
}
function entry(character = npc(), tier: CharacterRegistryEntry['tier'] = 'user'): CharacterRegistryEntry {
  return { character, tier, source: 'arbitrary.json' };
}
function setup(extra: CharacterRegistryEntry[] = []) {
  const player = npc('player'); player.name = 'Player'; player.personality = 'SENDER SECRET';
  const entries = [entry(player, 'storybook'), entry(), ...extra];
  const characters = appCharactersFromRegistry(buildCharacterRegistry(entries));
  const state = matchMeState(characters, []);
  const match = matchMeLikePolicy('player-matchme', 'stage4-nova-mm', state, now)!;
  const messages: MessageRecord[] = [{ id: 1, role: 'user', originalText: '', matchMeMatch: match }];
  const active = matchMeState(characters, messages);
  const outgoing = incomingMatchMeMessage('player-matchme', 'stage4-nova-mm', 'What is your Fotogram username?', active, 'question', now)!;
  return { entries, characters, messages, outgoing, active };
}

describe('shared NPC app discovery', () => {
  it('formats Fotogram recipient data readably without leaking other characters or technical payloads', () => {
    const unrelated = npc('unrelated'); unrelated.personality = 'UNRELATED SECRET';
    const { characters, outgoing } = setup([entry(unrelated)]);
    const message = { ...outgoing, app: 'fotogram' as const,
      from: 'Player', fromHandle: 'player.fotogram', fromAccountId: 'player-fotogram',
      to: 'Nova Vale', toHandle: 'nova.vale.art', toAccountId: 'stage4-nova-fg' };
    const context = socialDirectMessageInputText(message, [], characters);
    expect(context).toContain('Sender: Player (@player.fotogram)\nRecipient: Nova Vale (@nova.vale.art)\nReply as: Nova Vale to Player');
    expect(context).toContain('Private characterization\nName: Nova Vale');
    expect(context).toContain(fixture.character.personality);
    expect(context).toContain('Public social profiles\n\n');
    expect(context).toContain('Fotogram\nUsername: @nova.vale.art');
    expect(context).toContain('No account: WhatsUp, OnlyFriends');
    expect(context).not.toContain('Existing conversation');
    expect(context).toContain(`New message:\nPlayer: ${message.text}`);
    for (const hidden of ['SENDER SECRET', 'UNRELATED SECRET', 'data:image', 'accountId', 'privateCharacterization', '[REPLYING CHARACTER CONTEXT]', 'null']) {
      expect(context).not.toContain(hidden);
    }
    const recipient = characters.find((character) => character.sourceId === 'stage4-nova')!;
    expect(context).toContain(recipient.apps!.fotogram!.bio);
    const image = recipient.images?.find((item) => item.id === recipient.apps!.fotogram!.avatarImageId);
    if (image?.description) expect(context).toContain(`Profile photo 1: ${image.description}`);
    const onlyFriends = structuredClone(recipient);
    onlyFriends.apps!.onlyfriends = { ...onlyFriends.apps!.fotogram!, accountId: 'nova-of', username: 'nova.private' };
    const onlyFriendsInput = socialDirectMessageInputText({ ...message, app: 'onlyfriends', toAccountId: 'nova-of' }, [], [onlyFriends]);
    expect(onlyFriendsInput).toContain('Private characterization');
    expect(onlyFriendsInput).toContain('Username: @nova.vale.art');
    const phoneInput = whatsUpMessageInputText('Player', recipient.name, 'What is your Fotogram account?', recipient);
    expect(phoneInput).toContain('Reply as: Nova Vale to Player');
    expect(phoneInput).toContain('Username: @nova.vale.art');
    expect(phoneInput).toContain(fixture.character.personality);
    expect(phoneInput).toContain('New message:\nPlayer: What is your Fotogram account?');
    expect(phoneInput).not.toContain('Existing conversation');
  });

  it('validates the portable fixture and uses its real gallery photos in MatchMe', () => {
    expect(() => validateCharacterContainer(fixture)).not.toThrow();
    const { characters, active } = setup();
    const account = active.accounts.find((account) => account.id === 'stage4-nova-mm')!;
    expect(account.photos?.[0].dataUrl).toBe(fixture.character.images[0].dataUrl);
    expect(account.photos?.[0].dataUrl.startsWith('data:image/jpeg;base64,/9j/')).toBe(true);
    expect(characters.find((character) => character.sourceId === 'stage4-nova')?.storybookNodeId).toBe('');
    expect(buildCharacterRegistry([entry()]).characters[0].playerSelectable).toBe(false);
    expect(phoneRuntimeCharactersFromMessages(characters, [])).toHaveLength(1);
    expect(canSendMatchMeMessage('player-matchme', 'stage4-nova-mm', matchMeState(characters, []))).toBe(false);
  });

  it('shares only the bound recipient context and finds the configured Fotogram username', () => {
    const unrelated = npc('unrelated'); unrelated.personality = 'UNRELATED SECRET';
    const { characters, messages, outgoing, active } = setup([entry(unrelated)]);
    const context = socialDirectMessageInputText(outgoing, messages, characters);
    expect(context).toContain('nova.vale.art');
    expect(context).toContain(fixture.character.personality);
    expect(context).toContain('No account: WhatsUp, OnlyFriends');
    expect(context).not.toContain('SENDER SECRET');
    expect(context).not.toContain('UNRELATED SECRET');
    expect(context).not.toContain('data:image');
    const reply = JSON.stringify({ matchMeApp: [{ from: 'stage4-nova-mm', to: 'player-matchme', message: 'Find me at @nova.vale.art.' }] });
    expect(validateSocialMessengerAccounts({ text: reply, characters, messages, directMessage: outgoing }).issues).toEqual([]);
    expect(matchMeMessageAllowed(parseSocialDirectMessageOutput(reply, outgoing, now).message!, active)).toBe(true);
    const directory = buildSocialDirectory({ storyCharacters: characters, messages });
    expect(searchSocialDirectory(directory.users, 'fotogram', '@nova.vale.art')).toMatchObject([
      { characterId: 'stage4-nova', handles: { fotogram: 'nova.vale.art' } },
    ]);
    const recipient = resolveSocialMessageIdentity({ characters, messages, app: 'fotogram', identity: '@nova.vale.art' });
    expect(recipient).toMatchObject({ available: true, characterId: 'stage4-nova', accountId: 'stage4-nova-fg' });
    const socialReply = JSON.stringify({ fotogramApp: [{ from: 'stage4-nova-fg', to: 'player-fotogram', message: 'Welcome!' }] });
    expect(validateSocialMessengerAccounts({ text: socialReply, characters, messages }).issues).toEqual([]);
    expect(resolveSocialMessageIdentity({ characters, messages, app: 'onlyfriends', identity: 'Nova Vale' }).available).toBe(false);
  });

  it('keeps optional/disabled accounts absent without inventing discovery or contact access', () => {
    for (const app of ['fotogram', 'matchme'] as const) {
      const value = npc(); delete value.apps![app];
      const characters = appCharactersFromRegistry(buildCharacterRegistry([entry(value)]));
      if (app === 'matchme') expect(matchMeState(characters, []).accounts.some((account) => account.characterId === value.id)).toBe(false);
      else expect(searchSocialDirectory(buildSocialDirectory({ storyCharacters: characters, messages: [] }).users, app, 'nova.vale.art')).toEqual([]);
      expect(recipientCharacterContext(characters[0])).toMatch(new RegExp(`No account: .*${app === 'matchme' ? 'MatchMe' : 'Fotogram'}`));
    }
    const value = npc(); value.apps!.fotogram!.enabled = false; value.apps!.matchme!.enabled = false;
    const characters = appCharactersFromRegistry(buildCharacterRegistry([entry(value)]));
    expect(initialCharacterPosts(characters)).toEqual([]);
    expect(matchMeState(characters, []).accounts.some((account) => account.characterId === value.id)).toBe(false);
    expect(phoneRuntimeCharactersFromMessages(characters, [])).toEqual([]);
  });

  it('rejects unknown, ambiguous and unbound delivery while keeping same-name people distinct', () => {
    const duplicate = npc('duplicate');
    const { characters, messages, outgoing } = setup([entry(duplicate)]);
    expect(resolveSocialMessageIdentity({ characters, messages, app: 'fotogram', identity: 'Nova Vale' }).available).toBe(false);
    expect(resolveSocialMessageIdentity({ characters, messages, app: 'fotogram', identity: 'stage4-nova-fg' }).available).toBe(true);
    expect(resolveSocialMessageIdentity({ characters, messages, app: 'fotogram', identity: 'unknown' }).available).toBe(false);
    const wrongReply = JSON.stringify({ matchMeApp: [{ from: 'duplicate-matchme', to: 'player-matchme', message: 'Pretending to reply' }] });
    expect(validateSocialMessengerAccounts({ text: wrongReply, characters, messages, directMessage: outgoing }).issues.length).toBeGreaterThan(0);
    duplicate.apps!.fotogram!.username = 'nova.vale.art';
    const colliding = appCharactersFromRegistry(buildCharacterRegistry([entry(), entry(duplicate)]));
    expect(resolveSocialMessageIdentity({ characters: colliding, messages: [], app: 'fotogram', identity: '@nova.vale.art' }).available).toBe(false);
    duplicate.apps!.fotogram!.accountId = 'stage4-nova-fg';
    duplicate.apps!.fotogram!.username = 'unique.handle';
    expect(resolveSocialMessageIdentity({ characters: appCharactersFromRegistry(buildCharacterRegistry([entry(), entry(duplicate)])), messages: [], app: 'fotogram', identity: '@unique.handle' }).available).toBe(false);
  });

  it('scopes equal seed/image IDs to their owners and exports original seed IDs', () => {
    const second = npc('second'); second.images[0].description = 'Different owner';
    const { characters } = setup([entry(second)]);
    const seeds = initialCharacterPosts(characters).filter((post) => post.authorCharacterId !== 'player');
    expect(new Set(seeds.map((post) => post.postId)).size).toBe(2);
    expect(seeds[0].postId).toBe(npcSeedPostKey('stage4-nova-fg', 'first-post'));
    expect(appCharacterImage(characters, 'lake')).toBeUndefined();
    expect(appCharacterImage(characters, 'lake', 'second-fotogram')?.description).toBe('Different owner');
    const live: MessageRecord = { id: 2, role: 'user', originalText: '', socialPost: { ...seeds[0], postId: 'first-post', caption: 'Live version' } };
    const combined = postsWithInitialContent(characters, [live]);
    expect(combined.filter((message) => message.socialPost?.authorCharacterId === 'stage4-nova')).toHaveLength(1);
    expect(combined.find((message) => message.id === 2)?.socialPost?.caption).toBe('Live version');
    expect(combined.some((message) => message.socialPost?.authorCharacterId === 'second')).toBe(true);
    expect(withPublicationSnapshot(npc(), seeds, []).apps?.fotogram?.initialPosts?.[0].id).toBe('first-post');
    // Existing local Storybook seed keys and their saved likes remain unchanged.
    expect(initialCharacterPosts(characters).find((post) => post.authorCharacterId === 'player')?.postId).toBe('first-post');
  });

  it('does not let another account replace a starting post by reusing its runtime ID', () => {
    const { characters } = setup();
    const seed = initialCharacterPosts(characters).find((post) => post.authorCharacterId === 'stage4-nova')!;
    const foreign: MessageRecord = { id: 2, role: 'user', originalText: '', socialPost: {
      ...seed, author: 'Someone else', authorHandle: 'someone.else',
      authorCharacterId: 'foreign', authorAccountId: 'foreign-fg', caption: 'Unrelated post',
    } };
    const combined = postsWithInitialContent(characters, [foreign]);
    expect(combined.some((message) => message.socialPost?.authorAccountId === seed.authorAccountId)).toBe(true);
    expect(combined.find((message) => message.id === foreign.id)).toEqual(foreign);
  });

  it('rejects a newly imported bare seed ID owned by an existing timeline author', () => {
    const player = npc('player');
    const current = appCharactersFromRegistry(buildCharacterRegistry([entry(player, 'storybook')]));
    const imported = npc('imported');
    const candidate = appCharactersFromRegistry(buildCharacterRegistry([
      entry(player, 'storybook'), entry(imported, 'storybook'),
    ]));
    const existingPost = initialCharacterPosts(current)[0];
    const timeline: MessageRecord[] = [{ id: 9, role: 'user', originalText: '', socialPost: existingPost }];
    expect(() => validateCandidateLegacySeedTimeline(current, candidate, timeline))
      .toThrow('already belongs to another timeline author');
    expect(() => validateCandidateLegacySeedTimeline(current, current, timeline)).not.toThrow();
  });

  it('allows own legacy posts without IDs and checks literal npc-seed-prefixed Storybook IDs', () => {
    const player = npc('player');
    const cast = appCharactersFromRegistry(buildCharacterRegistry([entry(player, 'storybook')]));
    const post = initialCharacterPosts(cast)[0];
    const legacy = { ...post, authorAccountId: undefined, authorCharacterId: undefined };
    expect(() => validateCandidateLegacySeedTimeline([], cast, [{ id: 1, role: 'user', originalText: '', socialPost: legacy }]))
      .not.toThrow();
    player.apps!.fotogram!.initialPosts![0].id = 'npc-seed:literal-source-id';
    const prefixed = appCharactersFromRegistry(buildCharacterRegistry([entry(player, 'storybook')]));
    expect(() => validateCandidateLegacySeedTimeline([], prefixed, [{ id: 1, role: 'user', originalText: '',
      socialPost: { ...legacy, postId: 'npc-seed:literal-source-id', author: 'Other', authorHandle: 'other' } }]))
      .toThrow('timeline author');
  });

  it('keeps apps, context, media and delivery available from pinned snapshots after source deletion/change', () => {
    const { entries, messages, outgoing } = setup();
    const archive = captureNpcParticipants({}, entries, npcReferencesFromMessages(messages));
    const restored = parseNpcParticipantSnapshots(JSON.parse(JSON.stringify(archive)));
    const changed = npc(); changed.apps!.fotogram!.username = 'changed'; changed.personality = 'CHANGED SECRET';
    for (const library of [[], [entry(changed)]]) {
      const characters = appCharactersFromRegistry(buildCharacterRegistry([entries[0], ...library, ...npcSnapshotEntries(restored)]));
      expect(matchMeMessageAllowed(outgoing, matchMeState(characters, messages))).toBe(true);
      expect(socialDirectMessageInputText(outgoing, messages, characters)).toContain('nova.vale.art');
      expect(socialDirectMessageInputText(outgoing, messages, characters)).not.toContain('CHANGED SECRET');
      expect(appCharacterImage(characters, 'lake', 'stage4-nova')?.dataUrl).toBe(fixture.character.images[0].dataUrl);
      expect(initialCharacterPosts(characters).some((post) => post.postId === npcSeedPostKey('stage4-nova-fg', 'first-post'))).toBe(true);
    }
  });
});

describe('NPC prompt execution boundary', () => {
  it('uses registry identities in the actual prompt and accepts only the bound reply', async () => {
    const { executeLlmPromptNode } = await import('../nodes/llm-prompt/execute');
    const { characters, messages, outgoing } = setup();
    const prompts: string[] = [];
    const reply = JSON.stringify({ matchMeApp: [{ from: 'stage4-nova-mm', to: 'player-matchme', message: 'My Fotogram is @nova.vale.art.' }] });
    const context = {
      nodes: [], edges: [], appCharacters: characters, matchMeDirectMessage: outgoing,
      historyMessages: messages, runScratch: new Map(),
      referenceImages: { enabled: false, maxImages: 0, turnLookback: 0 },
      comfyProviderIds: [], providerHealthById: {}, settingsValueDefinitions: [], settingsValues: {},
      textMetrics: { bytesPerToken: 4 }, retryFormatErrorsEnabled: false,
      executeInput: async () => '', updateRuntimeData: () => {}, reportWarning: () => {}, reportFormatResult: () => {},
      llm: { supportsVision: async () => false, complete: async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt); return { text: reply, connection: { label: 'Test LLM' } };
      } },
    } as unknown as import('../nodes/types').ExecuteContext;
    const node = { id: 'prompt', type: 'workflow', position: { x: 0, y: 0 }, data: {
      nodeType: 'llm-prompt', label: 'Reply', connectionId: 'test', llmPromptBefore: '', llmPromptAfter: '',
    } } as import('../types').WorkflowNode;
    const inputValue = socialDirectMessageInputText(outgoing, messages, characters);
    const result = await executeLlmPromptNode({ node, context, inputValue, images: [], referenceImages: [], streamsVisibleOutput: false });
    expect(prompts[0]).toBe(inputValue);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('nova.vale.art');
    expect(prompts[0]).not.toContain('SENDER SECRET');
    expect(result).toContain('stage4-nova-mm');
  });
});
