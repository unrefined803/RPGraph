import type { DatingProfile } from '../chat/datingProfile';
import { normalizeCharacterApps, socialFromCharacterApps, type Character, type CharacterAppAccount, type CharacterApps } from './character';
import type { CharacterRegistryDiagnostic, EffectiveCharacterRegistry } from './registry';

const registryDiagnosticKey = (diagnostic: CharacterRegistryDiagnostic) => JSON.stringify([
  diagnostic.code,
  diagnostic.app ?? '',
  diagnostic.identity,
  [...diagnostic.characterIds].sort(),
  diagnostic.code === 'duplicate-character-id' ? [...diagnostic.sources].sort() : undefined,
]);

/** Reject only conflicts introduced by a candidate; unrelated existing library diagnostics remain visible but non-blocking. */
export function validateCandidateCharacterRegistry(
  current: EffectiveCharacterRegistry,
  candidate: EffectiveCharacterRegistry,
) {
  const existing = new Set(current.diagnostics.map(registryDiagnosticKey));
  const conflict = candidate.diagnostics.find((diagnostic) => !existing.has(registryDiagnosticKey(diagnostic)));
  if (conflict) throw new Error(conflict.message);
}

/** Update the canonical account and immediately refresh the legacy runtime projection. */
export function withCharacterAppProfile(character: Character, app: keyof CharacterApps, account: CharacterAppAccount & { profile?: DatingProfile }): Character {
  const apps = { ...normalizeCharacterApps(character.apps, character.social, character.id, character.name), [app]: account };
  if (account.avatarImageId && !character.images.some((image) => image.id === account.avatarImageId)) {
    throw new Error('Choose an avatar from this character’s gallery.');
  }
  return { ...character, apps, social: socialFromCharacterApps(apps) };
}

export function profileIdentityError(current: CharacterAppAccount | undefined, next: CharacterAppAccount, locked: boolean) {
  if (locked && current && (next.accountId !== current.accountId ||
    (current.enabled && !next.enabled) || (current.username && next.username !== current.username))) {
    return 'This account identity is locked while the story has chat or Opening History.';
  }
  if (!next.username.trim() || !/^[a-zA-Z0-9._-]+$/.test(next.username)) return 'Use a username containing letters, numbers, dots, underscores or hyphens.';
  return undefined;
}

/** Do not merge people through duplicate account aliases or imported post IDs. */
export function validateCharacterAccountDirectory(characters: Character[]) {
  const ids = new Set<string>();
  const handles = new Set<string>();
  const posts = new Set<string>();
  for (const character of characters) {
    for (const [app, account] of Object.entries(character.apps ?? {})) {
      if (ids.has(account.accountId)) throw new Error(`Duplicate account ID: ${account.accountId}`);
      ids.add(account.accountId);
      const handle = `${app}/${account.username.trim().toLowerCase()}`;
      if (account.enabled && account.username) {
        if (handles.has(handle)) throw new Error(`Ambiguous ${app} username: @${account.username}`);
        handles.add(handle);
      }
      for (const post of account.initialPosts ?? []) {
        const key = `${app}/${post.id}`;
        if (posts.has(key)) throw new Error(`Conflicting ${app} initial post ID: ${post.id}`);
        posts.add(key);
      }
    }
  }
}
