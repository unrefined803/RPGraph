import { accountHandle, migratedProfileName } from './character';
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
  const introduced = candidate.diagnostics.filter((diagnostic) => !existing.has(registryDiagnosticKey(diagnostic)));
  const conflict = introduced.find((diagnostic) => diagnostic.code !== 'shadowed-character-name');
  if (conflict) throw new Error(conflict.message);
  return introduced.filter((diagnostic) => diagnostic.code === 'shadowed-character-name');
}

/** Update the canonical account and immediately refresh the legacy runtime projection. */
export function withCharacterAppProfile(character: Character, app: keyof CharacterApps, account: CharacterAppAccount & { profile?: DatingProfile }): Character {
  const current = normalizeCharacterApps(character.apps, character.social, character.id, character.name);
  const previous = current[app];
  const privacyMode = account.privacyMode ?? previous?.privacyMode;
  const updated = { ...account,
    ...(privacyMode !== undefined ? { privacyMode } : {}),
    legacyHandles: [...new Set([
    ...(previous?.legacyHandles ?? []), accountHandle(previous), ...(account.legacyHandles ?? []),
  ].filter(Boolean))] };
  const apps = normalizeCharacterApps({ ...current, [app]: updated }, undefined, character.id, character.name);
  const selected = [account.portraitId, app === 'whatsup' ? (account as NonNullable<CharacterApps['whatsup']>).alias?.portraitId : undefined];
  if (selected.some((id) => id && id !== 'character' && !character.customPortraits?.[id])) {
    throw new Error('Create this portrait in the character gallery first.');
  }
  return { ...character, apps, social: socialFromCharacterApps(apps) };
}

export function profileIdentityError(current: CharacterAppAccount | undefined, next: CharacterAppAccount, locked: boolean) {
  if (locked && current && (next.accountId !== current.accountId ||
    (current.enabled && !next.enabled))) {
    return 'This account identity is locked while the story has chat or Opening History.';
  }
  if (!migratedProfileName(next).trim() || migratedProfileName(next).length > 60) return 'Use a profile name containing 1–60 characters.';
  return undefined;
}

/** Keep canonical account and post identities unique; WhatsUp display handles may be shared names. */
export function validateCharacterAccountDirectory(characters: Character[]) {
  const ids = new Set<string>();
  const names = new Set<string>();
  const handles = new Set<string>();
  const posts = new Set<string>();
  for (const character of characters) {
    const name = character.name.trim().replace(/\s+/g, ' ').toLowerCase();
    if (name && names.has(name)) {
      throw new Error(`Character name "${character.name.trim()}" is already used in this Storybook. Character names must be unique.`);
    }
    if (name) names.add(name);
    for (const [app, account] of Object.entries(character.apps ?? {})) {
      if (ids.has(account.accountId)) throw new Error(`Duplicate account ID: ${account.accountId}`);
      ids.add(account.accountId);
      const handle = `${app}/${(account.profileName ?? accountHandle(account)).trim().toLowerCase()}`;
      if (account.enabled && accountHandle(account)) {
        if (app !== 'whatsup' && handles.has(handle)) throw new Error(`Ambiguous ${app} username: @${accountHandle(account)}`);
        handles.add(handle);
      }
      for (const post of account.initialPosts ?? []) {
        const key = `${app}/${post.id}`;
        if (posts.has(key)) throw new Error(`Conflicting ${app} initial post ID: ${post.id}`);
        posts.add(key);
      }
    }
  }
  // A second WhatsUp name is a link target, so it must not collide with a real name or another second name.
  const directory = characters.map((entry) => ({ id: entry.id, name: entry.name, alias: entry.apps?.whatsup?.alias?.name }));
  for (const character of characters) {
    const conflict = whatsUpAliasConflict(character.apps?.whatsup?.alias?.name ?? '', character.id, directory);
    if (conflict) throw new Error(conflict);
  }
}

/**
 * Why a second WhatsUp name cannot be used, or undefined when it is free. Names
 * are compared the way message participants are resolved, so spellings that
 * differ only in case, spaces, dots, underscores or hyphens count as the same.
 */
export function whatsUpAliasConflict(alias: string, ownerId: string,
  directory: Array<{ id: string; name: string; alias?: string }>) {
  const key = (value: string | undefined) => (value ?? '').trim().toLowerCase().replace(/[\s._-]+/g, '');
  const aliasKey = key(alias);
  if (!aliasKey) return undefined;
  const taken = directory.find((entry) => key(entry.name) === aliasKey) ??
    directory.find((entry) => entry.id !== ownerId && key(entry.alias) === aliasKey);
  if (!taken) return undefined;
  const holder = key(taken.name) === aliasKey
    ? taken.id === ownerId ? 'this character’s own name' : `the name of ${taken.name.trim()}`
    : `the second WhatsUp name of ${taken.name.trim()}`;
  return `The second WhatsUp name "${alias.trim()}" is already used as a name: it matches ${holder}. Choose a different name.`;
}
