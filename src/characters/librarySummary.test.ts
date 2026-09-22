import { describe, expect, it } from 'vitest';
import type { Character, CharacterAppAccount } from './character';
import { characterLibrarySummary, libraryActivityPosts, libraryCharacterWithPosts, libraryCharacterContentEqual } from './librarySummary';
import { rpCharacterCardForCharacter } from '../storybook/characterCard';
import type { SocialPostRecord } from '../types';

const account = (extra: Partial<CharacterAppAccount> = {}): CharacterAppAccount => ({
  accountId: 'account', enabled: true, username: 'alex', displayName: 'Alex', bio: '', ...extra,
});
const character = (): Character => ({
  id: 'alex', name: 'Alex Morgan', description: '', personality: '', speechStyle: '', role: '',
  images: ['portrait', 'post', 'dating', 'reserve'].map((id) => ({
    id, name: id, mimeType: 'image/jpeg', size: 3, dataUrl: 'data:image/jpeg;base64,YWJj', description: '',
  })),
});

describe('NPC library publication view', () => {
  const post = (extra: Partial<SocialPostRecord> = {}): SocialPostRecord => ({
    app: 'fotogram', postId: 'published', author: 'Alex Morgan', authorHandle: 'alex',
    authorAccountId: 'account', authorCharacterId: 'alex', caption: 'Hello', imageId: 'post', ...extra,
  });
  const source = () => ({ ...character(), apps: { fotogram: account() } });

  it('recognizes an own-post export as the same Storybook content and counts opening and live posts once', () => {
    const npc = source();
    const before = structuredClone(npc);
    const message = { socialPost: post() };
    const posts = libraryActivityPosts([{ turns: [{ input: { messages: [message] }, output: { messages: [] } }] },
      [message, { socialPost: post({ authorAccountId: 'someone-else', postId: 'foreign' }) }]]);
    const view = libraryCharacterWithPosts(npc, posts);
    const exported = rpCharacterCardForCharacter(npc, { includePosts: true, posts }).character;
    expect(characterLibrarySummary(view).apps.fotogram?.initialPosts).toHaveLength(1);
    expect(characterLibrarySummary(view).used).toBe(1);
    expect(libraryCharacterContentEqual(view, exported)).toBe(true);
    expect(npc).toEqual(before);
    expect(characterLibrarySummary(npc).apps.fotogram?.initialPosts ?? []).toHaveLength(0);
  });

  it('keeps actual profile edits and additional publications different from the saved export', () => {
    const npc = source();
    const exported = rpCharacterCardForCharacter(npc, { includePosts: true, posts: [post()] }).character;
    const view = libraryCharacterWithPosts(npc, [post()]);
    expect(libraryCharacterContentEqual({ ...view, description: 'Changed' }, exported)).toBe(false);
    expect(libraryCharacterContentEqual(libraryCharacterWithPosts(npc, [post(), post({ postId: 'second' })]), exported)).toBe(false);
  });

  it('deduplicates NPC seed IDs, uses the latest caption and ignores publication ordering', () => {
    const npc = source();
    npc.apps.fotogram.initialPosts = [{ id: 'published', text: 'Old', imageId: 'post' }, { id: 'another', text: 'Other' }];
    const view = libraryCharacterWithPosts(npc, [post({ postId: 'npc-seed:["account","published"]' }), post({ caption: 'Latest' })]);
    expect(view.apps?.fotogram?.initialPosts).toHaveLength(2);
    expect(view.apps?.fotogram?.initialPosts?.[0].text).toBe('Latest');
    const reversed = structuredClone(view);
    reversed.apps!.fotogram!.initialPosts!.reverse();
    expect(libraryCharacterContentEqual(view, reversed)).toBe(true);
  });

  it('handles text-only OnlyFriends posts and external media without copying unavailable images', () => {
    const npc = { ...source(), apps: { onlyfriends: account() } };
    const view = libraryCharacterWithPosts(npc, [post({ app: 'onlyfriends', imageId: undefined }),
      post({ app: 'onlyfriends', postId: 'external', imageId: 'external-image' })]);
    expect(characterLibrarySummary(view).apps.onlyfriends?.initialPosts).toHaveLength(2);
    expect(view.images).toEqual(npc.images);
  });

  it('ignores posts inside archived participants and node snapshots', () => {
    expect(libraryActivityPosts({ npcParticipants: { x: { socialPost: post() } },
      nodeSnapshots: [{ socialPost: post() }], turns: [{ input: { messages: [{ socialPost: post() }] } }] })).toEqual([post()]);
  });
});

describe('NPC library image inventory', () => {
  it('counts shared portraits and post images once, includes dating photos, and leaves reserve images unused', () => {
    const npc = character();
    npc.profileImage = { imageId: 'portrait', dataUrl: '' };
    npc.apps = {
      fotogram: account({ avatarImageId: 'portrait', initialPosts: [
        { id: 'one', text: '', imageId: 'post' }, { id: 'two', text: '', imageId: 'post' },
      ] }),
      matchme: { ...account(), profile: { name: 'Alex', age: 25, bio: 'Hello', interests: '',
        photoIds: ['dating', 'portrait'], decisions: {} } },
    };
    expect(characterLibrarySummary(npc)).toMatchObject({ used: 3, unused: 1, initials: 'AM' });
  });

  it('does not mark disabled app media as used or count missing gallery references', () => {
    const npc = character();
    npc.apps = {
      onlyfriends: account({ enabled: false, avatarImageId: 'reserve', initialPosts: [{ id: 'one', text: '', imageId: 'post' }] }),
      fotogram: account({ avatarImageId: 'missing', initialPosts: [{ id: 'text-only', text: 'Hello' }] }),
    };
    expect(characterLibrarySummary(npc)).toMatchObject({ used: 0, unused: 4 });
  });

  it('provides standard accounts and sensible initials for characters without profiles', () => {
    const npc = character();
    npc.name = ' Alex ';
    const summary = characterLibrarySummary(npc);
    expect(summary.initials).toBe('A');
    expect(summary.apps.fotogram?.enabled).toBe(true);
    expect(summary.apps.whatsup?.enabled).toBe(true);
    expect(summary.apps.onlyfriends).toBeUndefined();
    expect(summary.apps.matchme).toBeUndefined();
  });
});
