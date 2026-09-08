import { describe, expect, it } from 'vitest';
import { characterPayload, validateCharacterPayload } from './character';
import { profileIdentityError, withCharacterAppProfile } from './profiles';
import { initialCharacterPosts, postsWithInitialContent } from './publications';
import { resolveWhatsUpMessageParticipants, resolveWhatsUpRecipient } from './messageIdentity';
import { emptyRpStorybook, normalizeRpStorybook, parseRpStorybookJson, rpStorybookIdentityLockViolations, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { planCharacterCardImport, rpCharacterCardForCharacter } from '../storybook/characterCard';
import { storyCharactersFromNodes } from '../storybook/runtime';
import { resolveSocialMessageIdentity } from '../chat/socialMessageValidation';
import { appStateFromSessionV2, sessionV2FromCurrentState, workflowV2ToWorkflowFile } from '../data-management/sessionStore';
import { currentWorkflowFormatVersion } from '../workflow/version';
import { turnsForStorybookOpeningHistory } from '../storybook/openingHistoryRuntime';
import { withStorybookExternalImagesPruned } from '../storybook/imageLibrary';
import { datingAccountId, resolveDatingAccount } from '../chat/datingAccounts';
import { canSendMatchMeMessage, matchMePairId, matchMeState } from '../chat/matchMe';
import type { MessageRecord, SocialPostRecord, TurnRecord, WorkflowFile, WorkflowNode } from '../types';

const image = { id: 'portrait', name: 'Portrait', mimeType: 'image/jpeg' as const, dataUrl: 'data:image/jpeg;base64,YWJj', size: 3, description: 'A portrait' };
const story = () => normalizeRpStorybook({ ...emptyRpStorybook, characters: [{ id: 'nova', name: 'Nova Testerson', images: [image],
  apps: { fotogram: { accountId: 'nova-fg', enabled: true, username: 'nova.art', displayName: 'Nova', bio: 'Public bio', avatarImageId: image.id },
    matchme: { accountId: 'nova-mm', enabled: true, username: 'nova.date', displayName: 'Nova', bio: 'Public dating bio',
      profile: { name: 'Nova', age: 25, bio: 'Public dating bio', interests: 'Art', photoIds: [image.id], decisions: { 'demo-alex': 'like' } } } } }] });
const node = (storybook = story(), id = 'book'): WorkflowNode => ({ id, position: { x: 0, y: 0 }, data: {
  nodeType: 'rp-storybook', label: 'Storybook', storybookJson: rpStorybookJsonText(storybook),
} } as WorkflowNode);
const ownPost = (): SocialPostRecord => ({ app: 'fotogram', postId: 'fotogram-post-01', author: 'Nova Testerson', authorHandle: 'nova.art',
  authorAccountId: 'nova-fg', authorCharacterId: 'nova', caption: 'Published text', imageId: image.id });

describe('canonical character profiles', () => {
  it('retains gallery media referenced by app profiles and starting posts during pruning', () => {
    const book = story();
    const character = book.characters[0];
    character.images = ['avatar', 'dating', 'seed', 'portrait', 'unused'].map((id) => ({
      ...image, id, receivedFrom: 'Former contact',
    }));
    character.profileImage = { imageId: 'portrait', dataUrl: image.dataUrl };
    character.apps!.fotogram!.avatarImageId = 'avatar';
    character.apps!.fotogram!.initialPosts = [{ id: 'first', text: 'Hello', imageId: 'seed' }];
    character.apps!.matchme!.profile!.photoIds = ['dating'];
    const pruned = withStorybookExternalImagesPruned(book, []);
    expect(pruned.removedCount).toBe(1);
    expect(pruned.storybook.characters[0].images.map((entry) => entry.id)).toEqual(['avatar', 'dating', 'seed', 'portrait']);
    expect(() => validateCharacterPayload(characterPayload(pruned.storybook.characters[0]))).not.toThrow();
  });

  it('uses canonical fields over stale compatibility projections and round-trips edits', () => {
    const character = story().characters[0];
    character.social!.fotogramUsername = 'stale';
    expect(characterPayload(character).apps.fotogram?.username).toBe('nova.art');
    const updated = withCharacterAppProfile(character, 'fotogram', { ...character.apps!.fotogram!, bio: 'New bio', displayName: 'Artist' });
    const saved = parseRpStorybookJson(rpStorybookJsonText({ ...story(), characters: [updated] }));
    expect(saved.characters[0].apps?.fotogram).toMatchObject({ accountId: 'nova-fg', bio: 'New bio', displayName: 'Artist', avatarImageId: 'portrait' });
    expect(saved.characters[0].social?.fotogramUsername).toBe('nova.art');
  });
  it('gives new characters a persistent Fotogram account and leaves other apps optional', () => {
    const character = normalizeRpStorybook({ ...emptyRpStorybook, characters: [{ id: 'new', name: 'New Person', images: [] }] }).characters[0];
    expect(character.apps?.fotogram?.enabled).toBe(true);
    expect(character.apps?.onlyfriends).toBeUndefined();
    expect(characterPayload(character).apps.fotogram?.accountId).toBe(character.apps?.fotogram?.accountId);
  });
  it('locks account IDs and established usernames but permits first-time optional accounts', () => {
    const current = story();
    const next = structuredClone(current);
    next.characters[0].apps!.fotogram!.username = 'changed';
    expect(rpStorybookIdentityLockViolations(current, next).length).toBeGreaterThan(0);
    next.characters[0].apps = structuredClone(current.characters[0].apps);
    delete next.characters[0].apps!.matchme;
    expect(rpStorybookIdentityLockViolations(current, next).length).toBeGreaterThan(0);
    next.characters[0].apps = { ...current.characters[0].apps, onlyfriends: { accountId: 'new-of', enabled: true, username: 'nova.private', displayName: 'Nova', bio: '' } };
    expect(rpStorybookIdentityLockViolations(current, next)).toEqual([]);
    const account = current.characters[0].apps!.fotogram!;
    expect(profileIdentityError(account, { ...account, username: '' }, true)).toContain('locked');
    expect(profileIdentityError(undefined, { ...account, accountId: 'new' }, true)).toBeUndefined();
  });
});

describe('portable publication snapshots', () => {
  it('exports only own publication fields with one gallery image and no live history', () => {
    const character = story().characters[0];
    const before = structuredClone(character);
    const posts = [ownPost(), { ...ownPost(), postId: 'foreign', authorAccountId: 'foreign' }];
    const card = rpCharacterCardForCharacter(character, { includePosts: true, posts });
    expect(card.character.apps.fotogram?.initialPosts).toEqual([{ id: 'fotogram-post-01', text: 'Published text', imageId: 'portrait' }]);
    expect(card.character.images).toHaveLength(1);
    expect(card.character.apps.matchme?.profile?.decisions).toEqual({});
    expect(card.character).not.toHaveProperty('social');
    expect(character).toEqual(before);
    validateCharacterPayload(card.character);
    expect(rpCharacterCardForCharacter(character).character.apps.fotogram).not.toHaveProperty('initialPosts');
  });
  it('includes required external gallery media once and rejects missing media', () => {
    const character = story().characters[0];
    const external = { ...image, id: 'external', receivedFrom: 'Private sender', imageAccess: true as const };
    const posts = [{ ...ownPost(), imageId: 'external' }, { ...ownPost(), postId: 'second', imageId: 'external' }];
    expect(() => rpCharacterCardForCharacter(character, { includePosts: true, posts })).toThrow('missing gallery image');
    const card = rpCharacterCardForCharacter(character, { includePosts: true, posts, gallery: [external] });
    expect(card.character.images.filter((entry) => entry.id === 'external')).toHaveLength(1);
    expect(card.character.images[1]).not.toHaveProperty('receivedFrom');
    expect(card.character.images[1]).not.toHaveProperty('imageAccess');
  });
  it('imports and reexports stable seeds without duplicate posts or accounts', () => {
    const card = rpCharacterCardForCharacter(story().characters[0], { includePosts: true, posts: [ownPost(), ownPost()] });
    const first = planCharacterCardImport(card, emptyRpStorybook).storybook;
    const second = planCharacterCardImport(card, first).storybook;
    expect(second.characters).toHaveLength(1);
    const characters = storyCharactersFromNodes([node(second)]);
    expect(initialCharacterPosts(characters)).toHaveLength(1);
    const live: MessageRecord[] = [{ id: 5, role: 'user', originalText: '', socialPost: ownPost() }];
    expect(postsWithInitialContent(characters, live)).toHaveLength(1);
    const again = rpCharacterCardForCharacter(second.characters[0], { includePosts: true, posts: [ownPost()] });
    expect(again.character.apps.fotogram?.initialPosts).toEqual(card.character.apps.fotogram?.initialPosts);
    expect(again.character.images[0].id).toBe('portrait');
  });
  it('rejects account and post collisions instead of merging different people', () => {
    const card = rpCharacterCardForCharacter(story().characters[0], { includePosts: true, posts: [ownPost()] });
    const other = structuredClone(card); other.character.id = 'other';
    const target = story(); target.characters[0].images = [];
    delete target.characters[0].apps!.fotogram!.avatarImageId;
    expect(() => planCharacterCardImport(other, target)).toThrow('Duplicate account ID');
  });
});

describe('exact recipient identities', () => {
  const characters = storyCharactersFromNodes([node()]);
  it.each(['Nova Testerson', '@NOVA.ART', 'nova-fg', 'nova'])('resolves %s to stable character and account IDs', (identity) => {
    expect(resolveSocialMessageIdentity({ characters, messages: [], app: 'fotogram', identity })).toMatchObject({ available: true, accountId: 'nova-fg', characterId: 'nova' });
  });
  it('rejects unknown recipients, duplicate names, duplicate usernames and name/handle collisions', () => {
    const other = { ...characters[0], id: 'other', sourceId: 'other', apps: { fotogram: { ...characters[0].apps!.fotogram!, accountId: 'other-fg' } } };
    for (const identity of ['Nova Testerson', '@nova.art']) expect(resolveSocialMessageIdentity({ characters: [...characters, other], messages: [], app: 'fotogram', identity }).available).toBe(false);
    expect(resolveSocialMessageIdentity({ characters, messages: [], app: 'fotogram', identity: 'Nova' }).available).toBe(false);
    expect(resolveSocialMessageIdentity({ characters, messages: [], app: 'onlyfriends', identity: '@nova.art' }).available).toBe(false);
    expect(() => resolveWhatsUpRecipient([...characters, other], [], 'Nova Testerson')).toThrow('Ambiguous');
    expect(() => resolveWhatsUpRecipient(characters, [], 'Nova')).toThrow('Unknown');
  });
  it('supports WhatsUp usernames and retains canonical MatchMe identity across node changes', () => {
    const owner = { ...characters[0], apps: { ...characters[0].apps, whatsup: { accountId: 'wa', enabled: true, username: 'nova.phone', displayName: 'Nova', bio: '' } } };
    expect(resolveWhatsUpRecipient([owner], [], '@nova.phone')).toMatchObject({ accountId: 'wa', characterId: 'nova' });
    const moved = storyCharactersFromNodes([node(story(), 'moved')])[0];
    expect(datingAccountId(moved)).toBe(datingAccountId(characters[0]));
    const oldId = datingAccountId(characters[0].id);
    const history: MessageRecord[] = [{ id: 1, role: 'user', originalText: '', matchMeMatch: { id: matchMePairId(oldId, 'demo-alex'), accountIds: [oldId, 'demo-alex'], matchedAt: '2026-09-06T12:00:00Z', status: 'active' } }];
    const state = matchMeState(characters, history);
    expect(canSendMatchMeMessage('nova-mm', 'demo-alex', state)).toBe(true);
    expect(resolveDatingAccount('Nova Testerson', state.accounts)?.id).toBe('nova-mm');
    expect(resolveDatingAccount('@nova.date', state.accounts)?.id).toBe('nova-mm');
  });
  it('resolves both WhatsUp endpoints exactly, including account IDs and historical contacts', () => {
    const owner = { ...characters[0], apps: { ...characters[0].apps,
      whatsup: { accountId: 'nova-wa', enabled: true, username: 'nova.phone', displayName: 'Nova', bio: '' } } };
    const contactHistory: MessageRecord[] = [{ id: 1, role: 'user', originalText: '', phoneMessage: true,
      phoneFrom: 'Known Contact', phoneTo: owner.name, phoneFromAccountId: 'known-wa', phoneToAccountId: 'nova-wa' }];
    expect(resolveWhatsUpMessageParticipants([owner], contactHistory, { from: 'nova-wa', to: 'known-wa' }))
      .toEqual({ from: { name: owner.name, characterId: owner.sourceId, accountId: 'nova-wa' },
        to: { name: 'Known Contact', accountId: 'known-wa' } });
    expect(() => resolveWhatsUpMessageParticipants([owner], [], { from: 'Nova', to: owner.name })).toThrow('Unknown');
    owner.apps!.whatsup!.enabled = false;
    expect(() => resolveWhatsUpMessageParticipants([owner], [], { from: 'nova-wa', to: owner.name })).toThrow('Unavailable');
  });
});

it('retains non-playable Storybook participants without making them player-selectable', () => {
  const value = story();
  value.characters[0].playable = false;
  const character = storyCharactersFromNodes([node(value)])[0];
  expect(character).toMatchObject({ sourceId: 'nova', playerSelectable: false });
  expect(character.apps?.fotogram?.accountId).toBe('nova-fg');
});

it('preserves profiles through Storybook, Opening History and RP save round trips', () => {
  const nodes = [node()];
  const now = '2026-09-06T12:00:00Z';
  const turns: TurnRecord[] = [{ id: 'turn', number: 1, mode: 'user', createdAt: now,
    input: { graphText: '', messages: [{ id: 1, role: 'user', originalText: '', socialPost: ownPost() }] },
    output: { graphText: '', messages: [{ id: 2, role: 'output', originalText: 'Hello', phoneMessage: true, phoneFrom: 'Nova Testerson', phoneTo: 'Known contact', phoneFromAccountId: 'nova-wa', phoneToAccountId: 'contact-wa' }] } }];
  const opening = turnsForStorybookOpeningHistory(turns, nodes);
  const book = { ...story(), openingHistory: { ...story().openingHistory, turns: opening.turns, voiceMedia: opening.voiceMedia } };
  expect(parseRpStorybookJson(rpStorybookJsonText(book)).characters[0].apps).toEqual(story().characters[0].apps);
  const workflow: WorkflowFile = { format: 'rpgraph-workflow', formatVersion: currentWorkflowFormatVersion, savedAt: now, nodes, edges: [] };
  const saved = sessionV2FromCurrentState({ name: 'Test', settings: { englishProcessingEnabled: true, displayLanguage: 'en' }, workflowVariables: {}, turns, turnCheckpoints: [], openingMessages: [] }, workflow, nodes, now);
  const restored = appStateFromSessionV2(JSON.parse(JSON.stringify(saved)));
  expect(restored.turns[0].input.messages[0].socialPost).toEqual(ownPost());
  expect(restored.turns[0].output.messages[0]).toMatchObject({ phoneFromAccountId: 'nova-wa', phoneToAccountId: 'contact-wa' });
  expect(storyCharactersFromNodes(workflowV2ToWorkflowFile(saved.workflow).nodes)[0].apps).toEqual(story().characters[0].apps);
});
