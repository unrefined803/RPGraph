import { describe, expect, it } from 'vitest';
import { appCharactersFromRegistry } from './appRuntime';
import { buildCharacterRegistry } from './registry';
import type { Character } from './character';
import { characterSearchDirectory, selectCharacterSearchCandidates } from './search';
import { TextMetricsApi } from '../llm/tokenMetrics';

function makeCast() {
  const names = ['Espen Harper', 'Helga Harper', 'Espen Reed', 'Ryan Parker', 'Lena Weber', 'Thomas Carter'];
  return appCharactersFromRegistry(buildCharacterRegistry(names.map((name, index) => ({
    tier: 'bundled' as const, source: name,
    character: {
      id: `person-${index}`, name, gender: index === 3 ? 'man' : 'woman', age: 25,
      description: index === 0 ? 'A university student.' : 'Lives in town.',
      personality: index === 2 ? 'Enjoys trolling online.' : 'Quiet.', speechStyle: 'Direct.',
      role: index === 1 ? 'Older sister' : 'Neighbor',
      agencyTags: index === 3 ? ['comment_troll'] : [],
      relationships: [],
      images: [{ id: 'image', name: 'astronaut', dataUrl: 'SECRET_BLOB', description: 'astronaut', mimeType: 'image/jpeg', size: 1 }],
      apps: {
        fotogram: { enabled: true, accountId: `account-${index}`, profileName: `profile.${index}`, bio: index === 4 ? 'Graduate students welcome.' : '' },
        onlyfriends: { enabled: false, accountId: `disabled-${index}`, profileName: `hidden.${index}`, bio: 'Astronaut' },
      },
    } as Character,
  }))));
}
const names = (plan: string, cast = makeCast()) => selectCharacterSearchCandidates(cast, plan).map((character) => character.name);

describe('local character selectors', () => {
  it('prefers full names while supporting shared first names and surnames', () => {
    expect(names('Ask ESPEN HARPER about her job.')).toEqual(['Espen Harper']);
    expect(names('Find Espen.')).toEqual(['Espen Harper', 'Espen Reed']);
    expect(names('Find Harper.')).toEqual(['Espen Harper', 'Helga Harper']);
    expect(names('Espen Harper and Espen Reed')).toEqual(['Espen Harper', 'Espen Reed']);
    expect(names('Espen Harper and the other Harper')).toEqual(['Espen Harper', 'Helga Harper']);
    expect(names('Harperton and Espenly')).toEqual([]);
  });

  it('matches enabled profile names and account IDs literally', () => {
    expect(names('Who is @PROFILE.4?')).toEqual(['Lena Weber']);
    expect(names('Find account-4.')).toEqual(['Lena Weber']);
    expect(names('Find person-4.')).toEqual(['Lena Weber']);
    expect(names('profile.40 account-40 hidden.4 disabled-4')).toEqual([]);
  });

  it('includes incoming and outgoing relationships once without expanding friends of friends', () => {
    const cast = makeCast();
    cast[0].relationships = [{ characterId: cast[1].sourceId, description: 'My sister', apps: { whatsup: true } }];
    cast[3].relationships = [{ characterId: cast[0].id, description: 'A friend', apps: { fotogram: true } }];
    cast[1].relationships = [{ characterId: cast[4].sourceId, description: 'A friend', apps: {} }];
    cast[5].relationships = [{ characterId: cast[3].sourceId, description: 'A colleague', apps: {} }];
    expect(names('Who is Espen Harper friends with?', cast)).toEqual(['Espen Harper', 'Helga Harper', 'Ryan Parker']);
    expect(names('Who knows @profile.0?', cast)).toEqual(['Espen Harper', 'Helga Harper', 'Ryan Parker']);
  });

  it('finds names mentioned in relationship descriptions', () => {
    const cast = makeCast();
    cast[4].relationships = [{ characterId: 'missing', description: 'Espen is my friend.', apps: {} }];
    expect(names('Espen Harper', cast)).toEqual(['Espen Harper', 'Lena Weber']);
  });

  it('uses hash keywords with word-prefix matching across selected text fields', () => {
    expect(names('Find #student candidates.')).toEqual(['Espen Harper', 'Lena Weber']);
    expect(names('Find #sister.')).toEqual(['Helga Harper']);
    expect(names('Find #TROLL.')).toEqual(['Espen Reed', 'Ryan Parker']);
    expect(names('Find #comment_troll.')).toEqual(['Ryan Parker']);
    expect(names('Find #disruptive.')).toEqual(['Ryan Parker']);
    expect(names('Find #man.')).toEqual(['Ryan Parker']);
    expect(names('Find #woman.')).toHaveLength(5);
  });

  it('unions and deduplicates names and keywords without expanding keyword relationships', () => {
    const cast = makeCast();
    cast[0].relationships = [{ characterId: cast[5].sourceId, description: 'An acquaintance', apps: {} }];
    expect(names('Find #student #sister #student.', cast)).toEqual(['Espen Harper', 'Helga Harper', 'Lena Weber']);
    expect(names('Compare Espen Harper with #student candidates.', cast)).toEqual(['Espen Harper', 'Lena Weber', 'Thomas Carter']);
  });

  it('never falls back to the entire registry or searches image blobs and disabled accounts', () => {
    for (const plan of ['', 'Find interesting people', 'Find #astronaut', 'Find #SECRET_BLOB', 'Find *student']) {
      expect(names(plan)).toEqual([]);
    }
  });

  it('resolves relationship target names without loading their full profiles', () => {
    const cast = makeCast();
    cast[0].relationships = [{ characterId: cast[5].sourceId, description: 'A friend', apps: {} }];
    const selected = selectCharacterSearchCandidates(cast, '#student');
    const directory = characterSearchDirectory(selected, [], cast);
    expect(directory).toContain('Thomas Carter [person-5]: A friend');
    expect(directory).not.toContain('Character: Thomas Carter');
    expect(directory).not.toContain('SECRET_BLOB');
  });

  it('reduces the serialized directory for a targeted search in a fifty-character registry', () => {
    const base = makeCast()[0];
    const cast = Array.from({ length: 50 }, (_, index) => ({
      ...base, id: `entry-${index}`, sourceId: `entry-${index}`, name: `Person${index} Family${index}`,
      apps: {}, profile: { ...base.profile, description: 'A detailed fictional character background. '.repeat(80) },
    }));
    const selected = selectCharacterSearchCandidates(cast, 'What does Person17 Family17 do?');
    expect(selected).toHaveLength(1);
    const metrics = new TextMetricsApi();
    expect(metrics.measure(characterSearchDirectory(selected, [], cast)).tokens)
      .toBeLessThan(metrics.measure(characterSearchDirectory(cast, [])).tokens / 40);
  });

  it('ranks all candidates before keeping the best twenty, including a late exact identity', () => {
    const base = makeCast()[0];
    const cast = Array.from({ length: 35 }, (_, index) => ({
      ...base, id: `rank-${index}`, sourceId: `rank-${index}`, name: `Person${index} Family${index}`,
      apps: {}, gender: index === 34 ? 'man' as const : 'woman' as const,
      profile: { ...base.profile, description: index >= 25 ? 'A student who enjoys trolling.' : 'Quiet.' },
    }));
    const selected = selectCharacterSearchCandidates(cast, 'Find #woman #student #troll candidates to contact Person34 Family34.');
    expect(selected).toHaveLength(20);
    expect(selected[0]).toBe(cast[34]);
    expect(selected.slice(1, 10)).toEqual(cast.slice(25, 34));
    expect(selected.slice(10)).toEqual(cast.slice(0, 10));
    expect(selectCharacterSearchCandidates(cast, '#woman')).toEqual(cast.slice(0, 20));
  });

  it('counts each keyword once even when repeated in the plan or multiple fields', () => {
    const cast = makeCast();
    cast[0].profile.description = 'Student student student';
    cast[0].profile.personality = 'Student';
    cast[1].profile.description = 'A student who enjoys trolling.';
    expect(names('#STUDENT #student #troll', cast)).toEqual([
      'Helga Harper', 'Espen Harper', 'Espen Reed', 'Ryan Parker', 'Lena Weber',
    ]);
  });

  it('applies the limit to name matches and relationship neighbors too', () => {
    const base = makeCast()[0];
    const cast = Array.from({ length: 30 }, (_, index) => ({
      ...base, id: `relative-${index}`, sourceId: `relative-${index}`, name: `Relative${index} Harper`, apps: {},
      relationships: index === 29 ? [] : [{ characterId: 'relative-29', description: 'A friend', apps: {} }],
    }));
    const selected = selectCharacterSearchCandidates(cast, 'Who knows Relative29 Harper?');
    expect(selected).toEqual([cast[29], ...cast.slice(0, 19)]);
    expect(selectCharacterSearchCandidates(cast, 'Find Harper.')).toEqual(cast.slice(0, 20));
  });

});
