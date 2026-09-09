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
        expect(image.size).toBeLessThanOrEqual(200 * 1024);
      }

      const fotogram = character.apps?.fotogram;
      const matchme = character.apps?.matchme;
      expect(fotogram).toMatchObject({ enabled: true, displayName: character.name });
      expect(matchme).toMatchObject({ enabled: true, displayName: character.name });
      expect(fotogram?.username).toBe(expected.fotogram);
      expect(matchme?.username).toBe(expected.matchme);
      expect(matchme?.profile).toMatchObject({ name: expected.name, username: expected.matchme });
      expect(fotogram?.avatarImageId).toBeTruthy();
      expect(matchme?.profile?.photoIds).toHaveLength(1);
      expect(fotogram?.initialPosts).toHaveLength(['avery_hart', 'chloe_lane', 'luca_reed'].includes(character.id) ? 1 : 0);
      expect(character.hiddenAgency).toBe('');
      for (const account of [fotogram!, matchme!]) {
        expect(accountIds.has(account.accountId)).toBe(false);
        expect(usernames.has(account.username)).toBe(false);
        accountIds.add(account.accountId);
        usernames.add(account.username);
      }
    }
  });
});

it('provides Eli Ward with a stable authored WhatsUp account', async () => {
  const snapshot = await browserNpcLibrarySnapshot();
  const entry = snapshot.entries.find(({ character }) => character.name === 'Eli Ward')!;
  expect(entry.character.apps?.whatsup?.accountId).toBe('character:eli_ward:whatsup');
  const registry = buildCharacterRegistry([entry]);
  const characters = appCharactersFromRegistry(registry);
  const context = recipientCharacterContext(characters[0]);
  expect(context).toContain('WhatsUp\nUsername: @Eli Ward');
  expect(context).toContain('No account: OnlyFriends');
  expect(resolveRegistryAccount(registry, 'whatsup', 'Eli Ward').status).toBe('found');
  expect(resolveWhatsUpRecipient(characters, [], 'Eli Ward').accountId).toBe('character:eli_ward:whatsup');
  expect(entry.character.apps?.whatsup?.accountId).toBe('character:eli_ward:whatsup');
});
