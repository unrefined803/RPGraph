import { describe, expect, it } from 'vitest';
import type { Character } from './character';
import {
  buildCharacterRegistry,
  registryAccounts,
  resolveRegistryAccount,
  resolveRegistryCharacter,
  resolveRegistryImage,
  resolveRegistryInitialPost,
  type CharacterRegistryEntry,
} from './registry';
import { validateCandidateCharacterRegistry } from './profiles';

const character = (id: string, options: {
  name?: string;
  accountId?: string;
  username?: string;
  enabled?: boolean;
  bio?: string;
  imageId?: string;
  postId?: string;
  playable?: boolean;
} = {}): Character => {
  const imageId = options.imageId ?? 'shared-image';
  return {
    id,
    name: options.name ?? id,
    description: '',
    personality: '',
    speechStyle: '',
    role: '',
    playable: options.playable ?? true,
    images: [{ id: imageId, name: 'Image', mimeType: 'image/jpeg', size: 3,
      dataUrl: 'data:image/jpeg;base64,YWJj', description: id }],
    apps: { fotogram: { accountId: options.accountId ?? `${id}-fg`, enabled: options.enabled ?? true,
      username: options.username ?? `${id}.photo`, displayName: options.name ?? id, bio: options.bio ?? '',
      initialPosts: [{ id: options.postId ?? 'shared-post', text: `Post from ${id}`, imageId }] } },
  };
};

const entry = (tier: CharacterRegistryEntry['tier'], value: Character, source = `${tier}.json`): CharacterRegistryEntry =>
  ({ tier, character: value, source });

describe('effective character registry', () => {
  it('uses fresh and saved-game precedence without merging whole-character overrides', () => {
    const bundled = character('nova', { bio: 'bundled' });
    const user = character('nova', { bio: 'user' });
    const snapshot = character('nova', { bio: 'snapshot' });
    const storybook = character('nova', { bio: 'storybook' });
    delete storybook.apps!.fotogram;

    const fresh = buildCharacterRegistry([entry('bundled', bundled), entry('user', user)]);
    expect(fresh.characters[0]).toMatchObject({ provenance: { tier: 'user' }, playerSelectable: false });
    expect(fresh.characters[0].character.apps?.fotogram?.bio).toBe('user');

    const saved = buildCharacterRegistry([
      entry('bundled', bundled), entry('user', user), entry('snapshot', snapshot), entry('storybook', storybook),
    ]);
    expect(saved.characters).toHaveLength(1);
    expect(saved.characters[0]).toMatchObject({ provenance: { tier: 'storybook' }, playerSelectable: true });
    expect(saved.characters[0].character.apps?.fotogram).toBeUndefined();
    expect(registryAccounts(saved, 'fotogram')).toEqual([]);
  });

  it('never makes a library export player-selectable', () => {
    const registry = buildCharacterRegistry([entry('user', character('player', { playable: true }))]);
    expect(registry.characters[0].character.playable).toBe(true);
    expect(registry.characters[0].playerSelectable).toBe(false);
  });

  it('quarantines same-tier duplicate IDs and reports their sources', () => {
    const registry = buildCharacterRegistry([
      entry('bundled', character('nova', { bio: 'fallback' }), 'built-in.json'),
      entry('user', character('nova'), 'first.json'),
      entry('user', character('nova'), 'second.json'),
    ]);
    expect(registry.characters).toHaveLength(1);
    expect(registry.characters[0].provenance).toEqual({ tier: 'bundled', source: 'built-in.json' });
    expect(registry.diagnostics).toContainEqual(expect.objectContaining({
      code: 'duplicate-character-id', identity: 'nova', sources: ['first.json', 'second.json'],
    }));
  });

  it('hides a different library identity when a Storybook character uses its name', () => {
    const libraryEntry = entry('user', character('one', { name: 'Same Name' }));
    const current = buildCharacterRegistry([libraryEntry]);
    const registry = buildCharacterRegistry([
      libraryEntry,
      entry('storybook', character('two', { name: 'Same Name' })),
    ]);
    expect(registry.characters).toHaveLength(1);
    expect(registry.characters[0]).toMatchObject({ character: { id: 'two' }, provenance: { tier: 'storybook' } });
    expect(resolveRegistryCharacter(registry, 'Same Name')).toMatchObject({ status: 'found' });
    expect(resolveRegistryCharacter(registry, 'one')).toEqual({ status: 'missing' });
    expect(registry.diagnostics).toContainEqual(expect.objectContaining({
      code: 'shadowed-character-name', identity: 'same name', characterIds: ['two', 'one'],
    }));
    expect(validateCandidateCharacterRegistry(current, registry)).toEqual([
      expect.objectContaining({ code: 'shadowed-character-name' }),
    ]);
  });

  it('reports duplicate names across Storybook characters as a blocking conflict', () => {
    const current = buildCharacterRegistry([]);
    const candidate = buildCharacterRegistry([
      entry('storybook', character('one', { name: 'Same Name' }), 'storybook-a'),
      entry('storybook', character('two', { name: ' same   name ' }), 'storybook-b'),
    ]);
    expect(candidate.diagnostics).toContainEqual(expect.objectContaining({
      code: 'duplicate-character-name', identity: 'same name', characterIds: ['one', 'two'],
    }));
    expect(() => validateCandidateCharacterRegistry(current, candidate)).toThrow('Character names must be unique');
  });

  it('reports account and username collisions and never guesses an ambiguous alias', () => {
    const registry = buildCharacterRegistry([
      entry('user', character('one', { accountId: 'shared-account', username: 'first' })),
      entry('user', character('two', { accountId: 'shared-account', username: 'second' })),
      entry('user', character('three', { accountId: 'third-account', username: 'FIRST' })),
    ]);
    expect(registry.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'duplicate-account-id', 'duplicate-username',
    ]));
    expect(resolveRegistryAccount(registry, 'fotogram', 'shared-account')).toMatchObject({ status: 'ambiguous' });
    expect(resolveRegistryAccount(registry, 'fotogram', '@first')).toMatchObject({ status: 'ambiguous' });
  });

  it('retains explicit legacy aliases but does not restore an overridden account', () => {
    const library = entry('user', character('nova', { accountId: 'old-account' }));
    library.aliases = { characterIds: ['old-node:nova'], accountIds: { fotogram: ['storybook:old-node:nova'] } };
    const promoted = entry('storybook', character('nova', { accountId: 'nova-fg' }));
    promoted.aliases = { characterIds: ['new-node:nova'], accountIds: { fotogram: ['storybook:new-node:nova'] } };
    const registry = buildCharacterRegistry([library, promoted]);

    expect(resolveRegistryCharacter(registry, 'old-node:nova')).toMatchObject({ status: 'found' });
    expect(resolveRegistryAccount(registry, 'fotogram', 'storybook:new-node:nova')).toMatchObject({ status: 'found' });
    expect(resolveRegistryAccount(registry, 'fotogram', 'storybook:old-node:nova')).toEqual({ status: 'missing' });
    expect(resolveRegistryAccount(registry, 'fotogram', 'old-account')).toEqual({ status: 'missing' });
    expect(registryAccounts(registry, 'fotogram')).toHaveLength(1);
  });

  it('scopes equal image and seed IDs by stable owner identities', () => {
    const registry = buildCharacterRegistry([
      entry('user', character('one', { accountId: 'one-fg' })),
      entry('user', character('two', { accountId: 'two-fg' })),
    ]);
    expect(resolveRegistryImage(registry, 'one', 'shared-image')?.description).toBe('one');
    expect(resolveRegistryImage(registry, 'two', 'shared-image')?.description).toBe('two');
    expect(resolveRegistryInitialPost(registry, 'fotogram', 'one-fg', 'shared-post')?.text).toBe('Post from one');
    expect(resolveRegistryInitialPost(registry, 'fotogram', 'two-fg', 'shared-post')?.text).toBe('Post from two');
  });

  it('keeps configured disabled identities out of default discovery', () => {
    const registry = buildCharacterRegistry([entry('user', character('nova', { enabled: false }))]);
    expect(resolveRegistryAccount(registry, 'fotogram', 'nova-fg')).toEqual({ status: 'missing' });
    expect(resolveRegistryAccount(registry, 'fotogram', 'nova-fg', { includeDisabled: true })).toMatchObject({ status: 'found' });
  });

  it('does not route a stable ID that is also owned by a disabled account', () => {
    const registry = buildCharacterRegistry([
      entry('user', character('active', { accountId: 'shared-account' })),
      entry('user', character('disabled', { accountId: 'shared-account', enabled: false })),
    ]);
    expect(resolveRegistryAccount(registry, 'fotogram', 'shared-account')).toMatchObject({ status: 'ambiguous' });
  });

  it('rejects newly introduced effective conflicts but ignores unrelated existing diagnostics', () => {
    const first = character('first', { username: 'taken' });
    const duplicateA = character('duplicate-a', { username: 'already-broken' });
    const duplicateB = character('duplicate-b', { username: 'ALREADY-BROKEN' });
    const current = buildCharacterRegistry([
      entry('user', first), entry('user', duplicateA), entry('user', duplicateB),
      entry('storybook', character('player', { username: 'player' })),
    ]);
    const safe = buildCharacterRegistry([
      entry('user', first), entry('user', duplicateA), entry('user', duplicateB),
      entry('storybook', character('player', { username: 'still-safe' })),
    ]);
    expect(() => validateCandidateCharacterRegistry(current, safe)).not.toThrow();
    const conflicting = buildCharacterRegistry([
      entry('user', first), entry('user', duplicateA), entry('user', duplicateB),
      entry('storybook', character('player', { username: 'TAKEN' })),
    ]);
    expect(() => validateCandidateCharacterRegistry(current, conflicting)).toThrow('username');
  });

  it('rejects raw account IDs reused across different apps', () => {
    const library = character('library');
    const player = character('player');
    player.apps!.whatsup = { ...player.apps!.fotogram!, accountId: library.apps!.fotogram!.accountId };
    const current = buildCharacterRegistry([entry('user', library)]);
    const candidate = buildCharacterRegistry([entry('user', library), entry('storybook', player)]);
    expect(() => validateCandidateCharacterRegistry(current, candidate)).toThrow('Duplicate account ID');
  });
});
