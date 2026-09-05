import { describe, expect, it } from 'vitest';
import { defaultRpStorybookCharacterBanking } from '../nodes/rp-storybook/model';
import type { StorybookCharacter } from '../storybook/runtime';
import type { SocialAppKind, SocialDirectMessageRecord } from '../types';
import { buildSocialDirectory, searchSocialDirectory, socialHandleAvailable, type SocialDirectoryUser } from './socialDirectory';
import { parseValidatedSocialReactionsOutput, resolveSocialMessageIdentity } from './socialMessageValidation';
import { socialDirectMessageActor } from './socialMedia';

function character(
  id: string,
  name: string,
  social: StorybookCharacter['social'],
): StorybookCharacter {
  return {
    id,
    name,
    label: name,
    kind: 'character',
    sourceId: id,
    storybookNodeId: 'storybook',
    profile: { name, description: '', personality: '', speechStyle: '', role: '' },
    phoneSettings: { wallpaperId: 'wallpaper-1' },
    banking: defaultRpStorybookCharacterBanking(),
    social,
  };
}

describe('social identity resolution', () => {
  it.each<SocialAppKind>(['fotogram', 'onlyfriends'])(
    'prefers the actual %s account over another character\'s cross-app alias',
    (app) => {
      const ownField = app === 'fotogram' ? 'fotogramUsername' : 'onlyfriendsUsername';
      const otherField = app === 'fotogram' ? 'onlyfriendsUsername' : 'fotogramUsername';
      const alias = character('alias', 'Mira Vale', {
        fotogramUsername: '', onlyfriendsUsername: '',
        [otherField]: 'mira.vale',
      });
      const owner = character('owner', 'Jordan Reed', {
        fotogramUsername: '', onlyfriendsUsername: '',
        [ownField]: 'mira.vale',
      });
      const resolved = resolveSocialMessageIdentity({
        characters: [alias, owner], messages: [], app, identity: '@MIRA.VALE',
      });
      expect(resolved.available).toBe(true);
      expect(resolved.character?.id).toBe(owner.id);
      expect(resolved.name).toBe(owner.name);
    },
  );

  it('still blocks a cross-app alias when that character has no account in the requested app', () => {
    const resolved = resolveSocialMessageIdentity({
      characters: [character('alias', 'Mira Vale', {
        fotogramUsername: '', onlyfriendsUsername: 'private.mira',
      })],
      messages: [], app: 'fotogram', identity: '@private.mira',
    });
    expect(resolved.available).toBe(false);
    expect(resolved.character?.id).toBe('alias');
  });
});

describe('social directory search', () => {
  const users: SocialDirectoryUser[] = [
    { id: 'bundled:fotogram:mira', name: 'Mira Catalog', handles: { fotogram: 'mira.catalog' }, source: 'bundled' },
    { id: 'dynamic:mira', name: 'Mira Contact', handles: { fotogram: 'mira.contact' }, source: 'dynamic' },
    { id: 'storybook:owner', characterId: 'owner', name: 'Mira Player', handles: { fotogram: 'mira.player' }, source: 'storybook' },
  ];

  it('includes NPCs when no viewing character is excluded', () => {
    expect(searchSocialDirectory(users, 'fotogram', 'mira').map((user) => user.id))
      .toEqual(users.map((user) => user.id));
  });

  it('excludes only the viewing character while keeping NPCs', () => {
    expect(searchSocialDirectory(users, 'fotogram', 'mira', 'owner').map((user) => user.id))
      .toEqual(users.slice(0, 2).map((user) => user.id));
  });
});

describe('social account creation', () => {
  const owner = character('owner', 'Mira Player', {
    fotogramUsername: 'mira.player', onlyfriendsUsername: '',
  });
  const other = character('imported', 'Imported Player', {
    fotogramUsername: 'imported.player', onlyfriendsUsername: 'private.player',
  });
  const directory = buildSocialDirectory({
    storyCharacters: [owner, other],
    messages: [],
    savedDynamicUsers: {
      'dynamic:npc': {
        id: 'dynamic:npc', name: 'Saved NPC', source: 'dynamic',
        handles: { fotogram: 'saved.npc' },
      },
    },
  });

  it('reserves handles belonging to imported characters and saved NPCs', () => {
    expect(socialHandleAvailable(directory.users, 'fotogram', ' @IMPORTED.PLAYER ', owner.id)).toBe(false);
    expect(socialHandleAvailable(directory.users, 'fotogram', 'saved.npc', owner.id)).toBe(false);
  });

  it('reserves bundled handles even when the catalog user is not followed', () => {
    const bundled = directory.users.find((user) => user.source === 'bundled' && user.handles.fotogram)!;
    expect(socialHandleAvailable(directory.users, 'fotogram', bundled.handles.fotogram!, owner.id)).toBe(false);
  });

  it('allows the owner to retain its handle and permits independent app namespaces', () => {
    expect(socialHandleAvailable(directory.users, 'fotogram', 'mira.player', owner.id)).toBe(true);
    expect(socialHandleAvailable(directory.users, 'fotogram', 'private.player', owner.id)).toBe(true);
    expect(socialHandleAvailable(directory.users, 'onlyfriends', 'private.player', owner.id)).toBe(false);
    expect(socialHandleAvailable(directory.users, 'fotogram', '@', owner.id)).toBe(false);
  });
});

describe('social DM player selection', () => {
  const first = character('first', 'Mira Vale', {
    fotogramUsername: 'mira.first', onlyfriendsUsername: '',
  });
  const second = character('second', 'Mira Vale', {
    fotogramUsername: 'mira.second', onlyfriendsUsername: 'mira.private',
  });
  const message: SocialDirectMessageRecord = {
    app: 'fotogram', messageId: 'dm-1', from: 'Mira Vale', fromHandle: '@MIRA.SECOND',
    to: 'NPC', toHandle: 'npc', text: 'Hello', sentAt: '2026-09-05T10:00:00Z',
  };

  it('uses the selected character ID when character names are identical', () => {
    expect(socialDirectMessageActor([first, second], second.id, message)).toBe(second);
  });

  it('rejects deleted owners, stale handles and accounts from the wrong app', () => {
    expect(socialDirectMessageActor([first, second], 'deleted', message)).toBeUndefined();
    expect(socialDirectMessageActor([first, second], first.id, message)).toBeUndefined();
    expect(socialDirectMessageActor([first, second], second.id, {
      ...message, fromHandle: 'mira.private',
    })).toBeUndefined();
  });

  it('recovers the owner of an older DM by app handle and rejects ambiguous ownership', () => {
    expect(socialDirectMessageActor([first, second], undefined, message)).toBe(second);
    expect(socialDirectMessageActor([
      { ...first, social: second.social }, second,
    ], undefined, message)).toBeUndefined();
  });
});

describe('social reaction account validation', () => {
  const characters = [
    character('no-account', 'Mira Vale', { fotogramUsername: 'mira.public', onlyfriendsUsername: '' }),
    character('account', 'Jordan Reed', { fotogramUsername: '', onlyfriendsUsername: 'jordan.private' }),
  ];

  it.each([false, true])('validates comments before saving reactions (append=%s)', (append) => {
    const result = parseValidatedSocialReactionsOutput(JSON.stringify({
      reactions: {
        likes: 7,
        additionalLikes: 2,
        comments: [
          { from: 'Mira Vale', handle: 'invented.private', text: 'Must not appear.' },
          { from: '@mira.public', text: 'Cross-app aliases must not bypass the check.' },
          { from: 'Jordan Reed', handle: 'invented.jordan', text: 'Use my real account.' },
          { from: 'A nickname', handle: 'jordan.private', text: 'Use my real name.' },
          { from: 'New NPC', handle: 'new.npc', text: 'Keep this NPC.' },
        ],
      },
      summary: 'Mira commented on the post.',
      onlyFriendsApp: [{ from: 'New NPC', to: 'Jordan Reed', message: 'Keep this DM.' }],
    }), { app: 'onlyfriends', postId: 'post-1', append }, { characters, messages: [] });

    expect(result.reactions?.comments).toEqual([
      { from: 'Jordan Reed', handle: 'jordan.private', text: 'Use my real account.' },
      { from: 'Jordan Reed', handle: 'jordan.private', text: 'Use my real name.' },
      { from: 'New NPC', handle: 'new.npc', text: 'Keep this NPC.' },
    ]);
    expect(result.reactions?.likes).toBe(append ? 2 : 7);
    expect(result.reactions?.append).toBe(append || undefined);
    expect(result.warnings).toHaveLength(2);
    expect(result.historySummary).toBeUndefined();
    expect(result.directMessages).toHaveLength(1);
    const directory = buildSocialDirectory({
      storyCharacters: characters,
      messages: [{ id: 1, role: 'output', originalText: '', socialReactions: result.reactions }],
    });
    expect(directory.users.some((user) => user.handles.onlyfriends === 'invented.private')).toBe(false);
    expect(directory.users.find((user) => user.characterId === 'no-account')?.handles.onlyfriends).toBeUndefined();
  });

  it('preserves valid summaries and distinct NPC handles sharing a display name', () => {
    const result = parseValidatedSocialReactionsOutput(JSON.stringify({
      likes: 1,
      comments: [
        { from: 'New NPC', handle: 'npc.first', text: 'First.' },
        { from: 'New NPC', handle: 'npc.second', text: 'Second.' },
      ],
      summary: 'Two people commented.',
    }), { app: 'fotogram', postId: 'post-1', append: true }, { characters, messages: [] });
    expect(result.reactions?.comments.map((comment) => comment.handle)).toEqual(['npc.first', 'npc.second']);
    expect(result.historySummary).toBe('Two people commented.');
    expect(result.warnings).toEqual([]);
  });
});
