import { appCharactersFromRegistry, recipientCharacterContext } from './appRuntime';
import { buildCharacterRegistry, resolveRegistryAccount } from './registry';
import { resolveWhatsUpRecipient } from './messageIdentity';
import { describe, expect, it } from 'vitest';
import { browserNpcLibrarySnapshot } from './npcLibrary';

const authoredMatchMeCharacters = {
  'avery_hart': { name: 'Avery Hart', fotogram: 'avery.afterfive', matchme: 'avery.hart' },
  'chloe_lane': { name: 'Chloe Lane', fotogram: 'chloe.onrepeat', matchme: 'chloe.lane' },
  'nika_brooks': { name: 'Nika Brooks', fotogram: 'nika.lines', matchme: 'nika.brooks' },
  'maya_quinn': { name: 'Maya Quinn', fotogram: 'maya.inframe', matchme: 'maya.quinn' },
  'luca_reed': { name: 'Luca Reed', fotogram: 'luca.moving', matchme: 'luca.reed' },
  'eli_ward': { name: 'Eli Ward', fotogram: 'eli.offgrid', matchme: 'eli.ward' },
  'noah_blake': { name: 'Noah Blake', fotogram: 'noah.citynotes', matchme: 'noah.blake' },
} as const;
const authoredMatchMeIds = Object.keys(authoredMatchMeCharacters);

describe('bundled authored MatchMe characters', () => {
  it('discovers each character with valid MatchMe and Fotogram media', async () => {
    const snapshot = await browserNpcLibrarySnapshot();
    expect(snapshot.diagnostics).toEqual([]);
    const characters = snapshot.entries
      .filter(({ character }) => authoredMatchMeIds.includes(character.id))
      .map(({ character }) => character);
    expect(characters.map(({ id }) => id).sort()).toEqual([...authoredMatchMeIds].sort());

    const characterIds = new Set<string>();
    const accountIds = new Set<string>();
    const usernames = new Set<string>();
    for (const character of characters) {
      const expected = authoredMatchMeCharacters[character.id as keyof typeof authoredMatchMeCharacters];
      expect(character.name).toBe(expected.name);
      expect(character.playable).toBe(false);
      expect(characterIds.has(character.id)).toBe(false);
      characterIds.add(character.id);
      expect(character.images.length).toBeGreaterThan(0);
      for (const image of character.images) {
        expect(image.mimeType).toBe('image/jpeg');
        expect(image.width! * image.height!).toBeLessThanOrEqual(1_000_000);
        expect(image.size).toBeLessThanOrEqual(250 * 1024);
      }

      const fotogram = character.apps?.fotogram;
      const matchme = character.apps?.matchme;
      expect(fotogram).toMatchObject({ enabled: true, profileName: expect.any(String) });
      expect(matchme).toMatchObject({ enabled: true, profileName: expect.any(String) });
      expect(fotogram?.profileName).toBe(expected.fotogram);
      expect(matchme?.profileName).toBe(character.name);
      expect(matchme?.legacyHandles).toContain(expected.matchme);
      expect(matchme?.profile).not.toHaveProperty('name');
      expect(matchme?.profile).not.toHaveProperty('username');
      expect(fotogram?.avatarImageId).toBeTruthy();
      expect(matchme?.profile?.photoIds.length).toBeGreaterThanOrEqual(1);
      expect(matchme?.profile?.gender).toBe(character.gender);
      expect(matchme?.profile?.seeking).toEqual(character.gender === 'woman' ? ['man'] : ['woman']);
      expect(Array.isArray(fotogram?.initialPosts)).toBe(true);
      expect(character.hiddenAgency?.trim()).toBeTruthy();
      for (const account of [fotogram!, matchme!]) {
        expect(accountIds.has(account.accountId)).toBe(false);
        expect(usernames.has((account.profileName ?? account.username ?? ''))).toBe(false);
        accountIds.add(account.accountId);
        usernames.add((account.profileName ?? account.username ?? ''));
      }
    }
  });
});

it('ships developed NPCs with compatible tags, deliberate privacy and consistent dating profiles', async () => {
  const snapshot = await browserNpcLibrarySnapshot();
  expect(snapshot.diagnostics).toEqual([]);
  for (const { character } of snapshot.entries) {
    expect(character.agencyTags).toHaveLength(2);
    expect(character.hiddenAgency?.trim()).toBeTruthy();
    expect(character.age).toBeGreaterThanOrEqual(18);
    for (const [app, account] of Object.entries(character.apps ?? {})) {
      if (!account.enabled) continue;
      expect(account.agencyTags?.length).toBeGreaterThanOrEqual(1);
      expect(account.agencyTags!.every((tag) => character.agencyTags!.includes(tag))).toBe(true);
      if (app === 'fotogram' || app === 'onlyfriends') {
        expect(['user', 'creator']).toContain(account.accountRole);
        expect(typeof account.privacyMode).toBe('boolean');
      }
      if (app === 'onlyfriends') {
        expect(account.privacyMode).toBe(account.accountRole === 'user');
        if (account.privacyMode) {
          for (const name of character.name.toLowerCase().split(/\s+/)) {
            expect(account.profileName?.toLowerCase()).not.toContain(name);
            expect(account.bio.toLowerCase()).not.toContain(name);
          }
        }
      }
    }
    const matchme = character.apps?.matchme;
    if (matchme?.enabled) {
      expect(matchme.profileName).toBe(character.name);
      expect(['woman', 'man']).toContain(character.gender);
      expect(matchme.profile?.gender).toBe(character.gender);
      expect(matchme.profile?.age).toBe(character.age);
      expect(matchme.profile?.interests.trim()).toBeTruthy();
      expect(matchme.profile?.bio).toBe(matchme.bio);
      expect(matchme.profile?.seeking).toEqual(character.gender === 'woman' ? ['man'] : ['woman']);
      expect(matchme.profile).not.toHaveProperty('name');
      expect(matchme.profile).not.toHaveProperty('username');
    }
    if (character.name === 'Ivy Rowan') {
      expect(character.gender).toBe('man');
      expect(matchme?.profile?.gender).toBe('man');
      expect(matchme?.profile?.seeking).toEqual(['woman']);
    }
  }
});

it('provides Eli Ward with a stable authored WhatsUp account', async () => {
  const snapshot = await browserNpcLibrarySnapshot();
  const entry = snapshot.entries.find(({ character }) => character.name === 'Eli Ward')!;
  expect(entry.character.apps?.whatsup?.accountId).toBe('character:eli_ward:whatsup');
  const registry = buildCharacterRegistry([entry]);
  const characters = appCharactersFromRegistry(registry);
  const context = recipientCharacterContext(characters[0]);
  expect(context).toContain('WhatsUp\nAccount: Present\nProfile photo');
  expect(context).toContain('No account: OnlyFriends');
  expect(resolveRegistryAccount(registry, 'whatsup', 'Eli Ward').status).toBe('found');
  expect(resolveWhatsUpRecipient(characters, [], 'Eli Ward').accountId).toBe('character:eli_ward:whatsup');
  expect(entry.character.apps?.whatsup?.accountId).toBe('character:eli_ward:whatsup');
});
