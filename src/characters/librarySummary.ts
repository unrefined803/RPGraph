import { migratedProfileName, normalizeCharacterApps, type Character } from './character';
import { withPublicationSnapshot } from './publications';
import { characterContentEqual } from './contentComparison';
import type { SocialPostRecord } from '../types';

/** Collect actual message publications, excluding embedded character and recovery snapshots. */
export function libraryActivityPosts(activity: unknown): SocialPostRecord[] {
  const posts: SocialPostRecord[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'socialPost' && entry && typeof entry === 'object') {
        const post = entry as SocialPostRecord;
        if ((post.app === 'fotogram' || post.app === 'onlyfriends') && typeof post.postId === 'string' &&
          typeof post.author === 'string' && typeof post.authorHandle === 'string' && typeof post.caption === 'string') posts.push(post);
      } else if (!['npcParticipants', 'characters', 'voiceMedia', 'dataUrl', 'graphText', 'nodeSnapshots'].includes(key)) visit(entry);
    }
  };
  visit(activity);
  return posts;
}

/** A display-only publication view; keep timeline activity out of the stored character. */
export function libraryCharacterWithPosts(character: Character, posts: SocialPostRecord[]): Character {
  return withPublicationSnapshot(character, posts, [], { copyExternalImages: false });
}

/** Compare the active publication view to the saved file, allowing export ordering differences. */
export function libraryCharacterContentEqual(active: Parameters<typeof characterContentEqual>[0], saved: Parameters<typeof characterContentEqual>[0]): boolean {
  const ordered = (character: Parameters<typeof characterContentEqual>[0]) => {
    const copy = structuredClone(character);
    for (const account of Object.values(copy.apps ?? {})) {
      account.initialPosts?.sort((a, b) => a.id.localeCompare(b.id));
    }
    return copy;
  };
  return characterContentEqual(ordered(active), ordered(saved));
}

/** Count distinct gallery images referenced by the authored portrait and enabled apps. */
export function characterLibrarySummary(character: Character) {
  const apps = { ...normalizeCharacterApps(character.apps, character.social, character.id, character.name), ...character.apps };
  const usedIds = new Set<string>();
  if (character.profileImage?.imageId) usedIds.add(character.profileImage.imageId);
  if (apps.whatsup?.enabled && apps.whatsup.alias?.avatarImageId) usedIds.add(apps.whatsup.alias.avatarImageId);
  for (const account of Object.values(apps)) {
    if (!account.enabled) continue;
    if (account.avatarImageId) usedIds.add(account.avatarImageId);
    for (const post of account.initialPosts ?? []) {
      if (post.imageId) usedIds.add(post.imageId);
    }
  }
  if (apps.matchme?.enabled) {
    for (const id of apps.matchme.profile?.photoIds ?? []) usedIds.add(id);
  }
  const galleryIds = new Set(character.images.map((image) => image.id));
  const used = [...galleryIds].filter((id) => usedIds.has(id)).length;
  const words = character.name.trim().split(/\s+/).filter(Boolean);
  const initials = [words[0]?.[0], words.length > 1 ? words[words.length - 1]?.[0] : ''].join('').toUpperCase() || '?';
  return { apps, used, unused: galleryIds.size - used, initials };
}

function normalizedLibrarySearchValue(value: string) {
  return value.normalize('NFKC').trim().replace(/^@+/, '').toLocaleLowerCase();
}

/** Match the authored character name or any current and legacy social profile name. */
export function characterMatchesLibrarySearch(character: Character, query: string) {
  const needle = normalizedLibrarySearchValue(query);
  if (!needle) return true;
  const apps = characterLibrarySummary(character).apps;
  const aliases = [
    character.name,
    ...Object.values(apps).flatMap((account) => account ? [
      migratedProfileName(account, character.name),
      account.profileName,
      account.username,
      account.displayName,
      ...(account.legacyHandles ?? []),
    ] : []),
  ];
  return aliases.some((alias) => normalizedLibrarySearchValue(alias ?? '').includes(needle));
}

/** Display the same whole-container winner as the registry; retain ambiguous files for diagnostics. */
export function visibleLibraryEntries(entries: import('./npcLibrary').NpcLibraryEntry[]) {
  const bundledIds = new Set(entries.filter((entry) => entry.tier === 'bundled').map((entry) => entry.character.id));
  return entries.filter((entry) => {
    const winner = effectiveLibraryEntry(entries, entry.character.id);
    const rank = { bundled: 0, 'saved-storybook': 1, user: 2, account: 3 };
    return !winner || rank[entry.tier] >= rank[winner.tier];
  })
    .map((entry) => ({ ...entry, editedBuiltIn: (entry.tier === 'user' || entry.tier === 'account') && bundledIds.has(entry.character.id) }))
    .sort((a, b) => a.character.name.localeCompare(b.character.name) || a.fileName.localeCompare(b.fileName));
}

/** Select the same library tier as the registry without choosing an ambiguous file. */
export function effectiveLibraryEntry<T extends import('./npcLibrary').NpcLibraryEntry>(entries: T[], characterId: string): T | undefined {
  for (const tier of ['account', 'user', 'saved-storybook', 'bundled'] as const) {
    const matches = entries.filter((entry) => entry.character.id === characterId && entry.tier === tier);
    if (matches.length === 1) return matches[0];
  }
}

/** Update the existing writable tier before using the preferred export destination. */
export function npcSaveDestination(entries: import('./npcLibrary').NpcLibraryEntry[], characterId: string,
  preferred: 'npc-characters' | 'account-npc-characters') {
  if (entries.some((entry) => entry.character.id === characterId && entry.tier === 'account')) return 'account-npc-characters';
  if (entries.some((entry) => entry.character.id === characterId && entry.tier === 'user')) return 'npc-characters';
  return preferred;
}

export type CharacterProvenanceStage = { label: string; title: string };

/** Ordered resolution layers for the compact NPC Library provenance chain. */
export function characterProvenanceStages(options: {
  tier?: 'bundled' | 'saved-storybook' | 'user' | 'account'; editedBuiltIn?: boolean; localEdited?: boolean;
  inStorybook: boolean; storybookEdited: boolean; retained?: boolean; snapshotEdited?: boolean;
}): CharacterProvenanceStage[] {
  const stages: CharacterProvenanceStage[] = [];
  if (options.editedBuiltIn) {
    stages.push(
      { label: 'Built-in', title: 'Bundled application character' },
      options.localEdited
        ? { label: 'Local NPC', title: 'Local NPC Library file differs from the built-in character' }
        : { label: 'Local NPC', title: 'Local NPC Library file matches the built-in character' },
    );
  } else if (options.tier === 'bundled') {
    stages.push({ label: 'Built-in', title: 'Bundled application character' });
  } else if (options.tier === 'saved-storybook' && !options.inStorybook) {
    stages.push({ label: 'From Storybook', title: 'Automatically loaded from a saved, unencrypted Storybook. No separate NPC file is created.' });
  } else if (options.tier === 'account') {
    stages.push({ label: 'Account NPC', title: 'Character file in your account NPC Library folder' });
  } else if (options.tier === 'user') {
    stages.push({ label: 'Local NPC', title: 'Character file in the local NPC Library folder' });
  }
  if (options.retained && !options.inStorybook) {
    stages.push({ label: 'Story NPC',
      title: `${options.tier
        ? options.snapshotEdited ? 'RP copy differs from the NPC Library version. ' : 'RP copy matches the NPC Library version. '
        : ''}Character revision retained in this RP and included in future saves, even if its library file is missing` });
  }
  if (options.inStorybook) {
    if (!stages.length) {
      stages.push({ label: 'Storybook', title: 'Character version from the active Storybook. Takes priority over automatically scanned saved Storybook copies.' });
    } else {
      stages.push(options.storybookEdited
        ? { label: 'Storybook', title: 'The active Storybook version takes priority and differs from the NPC Library source' }
        : { label: 'Storybook', title: 'The active Storybook version takes priority and matches the NPC Library source' });
    }
  }
  return stages;
}


/** Describe where the current character payload is included, not whether it was saved to disk. */
export function characterStorageBadge(options: {
  inStorybook: boolean;
  retained: boolean;
  character: Character;
  openingCharacter?: Character;
}): CharacterProvenanceStage | undefined {
  if (options.inStorybook) return {
    label: 'SB', title: 'Included when saving the Storybook. Also carried by RP saves. This badge does not indicate unsaved changes.',
  };
  if (!options.retained) return undefined;
  if (options.openingCharacter && characterContentEqual(options.character, options.openingCharacter)) return {
    label: 'SB', title: 'This NPC version is included in the Storybook Opening History and is saved with the Storybook. Also carried by RP saves. This badge does not indicate unsaved changes.',
  };
  return { label: 'RP', title: options.openingCharacter
    ? 'Save the RP to preserve the current NPC version. The Storybook Opening History contains a different version; update it to include this version in Storybook saves.'
    : 'Included when saving the RP. Import the current session into Opening History to include this NPC version in Storybook saves.' };
}
