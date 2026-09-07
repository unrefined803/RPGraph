import { describe, expect, it } from 'vitest';
import { browserNpcLibrarySnapshot } from './npcLibrary';

const authoredMatchMeCharacters = {
  'authored-matchme-f1': { name: 'Avery Hart', fotogram: 'avery.afterfive', matchme: 'avery.hart' },
  'authored-matchme-f2': { name: 'Chloe Lane', fotogram: 'chloe.onrepeat', matchme: 'chloe.lane' },
  'authored-matchme-f3': { name: 'Nika Brooks', fotogram: 'nika.lines', matchme: 'nika.brooks' },
  'authored-matchme-f4': { name: 'Maya Quinn', fotogram: 'maya.inframe', matchme: 'maya.quinn' },
  'authored-matchme-m1': { name: 'Luca Reed', fotogram: 'luca.moving', matchme: 'luca.reed' },
  'authored-matchme-m2': { name: 'Eli Ward', fotogram: 'eli.offgrid', matchme: 'eli.ward' },
  'authored-matchme-m3': { name: 'Noah Blake', fotogram: 'noah.citynotes', matchme: 'noah.blake' },
} as const;
const authoredMatchMeIds = Object.keys(authoredMatchMeCharacters);

describe('bundled authored MatchMe characters', () => {
  it('discovers each character with valid MatchMe and Fotogram media', () => {
    const snapshot = browserNpcLibrarySnapshot();
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
      expect(matchme?.profile?.photoIds.length).toBe(character.images.length);
      expect(fotogram?.initialPosts).toHaveLength(character.images.length);
      for (const account of [fotogram!, matchme!]) {
        expect(accountIds.has(account.accountId)).toBe(false);
        expect(usernames.has(account.username)).toBe(false);
        accountIds.add(account.accountId);
        usernames.add(account.username);
      }
    }
  });
});
