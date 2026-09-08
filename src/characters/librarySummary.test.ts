import { describe, expect, it } from 'vitest';
import type { Character, CharacterAppAccount } from './character';
import { characterLibrarySummary } from './librarySummary';

const account = (extra: Partial<CharacterAppAccount> = {}): CharacterAppAccount => ({
  accountId: 'account', enabled: true, username: 'alex', displayName: 'Alex', bio: '', ...extra,
});
const character = (): Character => ({
  id: 'alex', name: 'Alex Morgan', description: '', personality: '', speechStyle: '', role: '',
  images: ['portrait', 'post', 'dating', 'reserve'].map((id) => ({
    id, name: id, mimeType: 'image/jpeg', size: 0, dataUrl: '', description: '',
  })),
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
