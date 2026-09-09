import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateCharacterContainer, type Character } from './character';
import { appCharactersFromRegistry } from './appRuntime';
import { initialCharacterPosts } from './publications';
import { buildCharacterRegistry, type CharacterRegistryEntry } from './registry';
import { buildSocialDirectory, resolveSocialDirectoryUser } from '../chat/socialDirectory';
import { matchMeState } from '../chat/matchMe';

function bundledCharacters() {
  return readdirSync('resources/npc-characters')
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const container = JSON.parse(readFileSync(join('resources/npc-characters', file), 'utf8'));
      validateCharacterContainer(container);
      return { file, character: container.character as Character };
    });
}

const convertedIds = new Set(['ari_blume', 'eden_moss', 'ivy_rowan', 'jordan_lee', 'kit_harlow', 'lena_ford', 'luna_sky', 'max_power', 'maya_brooks', 'mina_park', 'nova_reyes', 'owen_reed', 'sasha_vale']);

describe('Stage 7 bundled discovery replacement', () => {
  it('bundles exactly the thirteen image-backed legacy Fotogram characters with readable filenames', () => {
    const converted = bundledCharacters().filter(({ character }) =>
      convertedIds.has(character.id)
    );
    expect(converted).toHaveLength(13);
    for (const { file, character } of converted) {
      expect(file).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/);
      expect(character.images.length).toBeGreaterThan(0);
      expect(character.description).not.toBe('');
      expect(character.personality).not.toBe('');
      expect(character.speechStyle).not.toBe('');
      expect(character.apps?.fotogram?.bio).not.toBe('');
      expect(character.apps?.fotogram?.initialPosts?.some((post) => !!post.imageId)).toBe(true);
      expect(character.apps?.onlyfriends).toBeUndefined();
      if (!['eden_moss', 'ivy_rowan'].includes(character.id)) expect(character.apps?.matchme).toBeUndefined();
    }
  });

  it('discovers converted accounts through the registry and resolves normalized account IDs', () => {
    const entries: CharacterRegistryEntry[] = bundledCharacters().map(({ file, character }) => ({
      tier: 'bundled', source: `bundled:${file}`, character,
    }));
    const characters = appCharactersFromRegistry(buildCharacterRegistry(entries));
    const converted = characters.filter((character) => convertedIds.has(character.sourceId));
    const directory = buildSocialDirectory({ storyCharacters: characters, messages: [] });
    expect(converted).toHaveLength(13);
    expect(initialCharacterPosts(converted)).toHaveLength(15);
    expect(directory.users.filter((user) =>
      convertedIds.has(user.characterId ?? '')
    )).toHaveLength(13);
    expect(resolveSocialDirectoryUser(directory.users, 'character:luna_sky:fotogram')?.name).toBe('Luna Sky');
    expect(directory.users.some((user) => user.source === 'bundled')).toBe(false);
    expect(matchMeState(characters, []).accounts.some((account) => account.id.startsWith('demo-'))).toBe(false);
  });
});
