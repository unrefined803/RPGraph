import { normalizeCharacterApps, type Character } from './character';

/** Count distinct gallery images referenced by the authored portrait and enabled apps. */
export function characterLibrarySummary(character: Character) {
  const apps = { ...normalizeCharacterApps(character.apps, character.social, character.id, character.name), ...character.apps };
  const usedIds = new Set<string>();
  if (character.profileImage?.imageId) usedIds.add(character.profileImage.imageId);
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

/** Display the same whole-container winner as the registry; retain ambiguous files for diagnostics. */
export function visibleLibraryEntries(entries: import('./npcLibrary').NpcLibraryEntry[]) {
  const bundledIds = new Set(entries.filter((entry) => entry.tier === 'bundled').map((entry) => entry.character.id));
  const userCounts = new Map<string, number>();
  for (const entry of entries) if (entry.tier === 'user') userCounts.set(entry.character.id, (userCounts.get(entry.character.id) ?? 0) + 1);
  return entries.filter((entry) => entry.tier !== 'bundled' || userCounts.get(entry.character.id) !== 1)
    .map((entry) => ({ ...entry, editedBuiltIn: entry.tier === 'user' && bundledIds.has(entry.character.id) }))
    .sort((a, b) => a.character.name.localeCompare(b.character.name) || a.fileName.localeCompare(b.fileName));
}

export type CharacterProvenanceStage = { label: string; title: string };

/** Ordered resolution layers for the compact NPC Library provenance chain. */
export function characterProvenanceStages(options: {
  tier?: 'bundled' | 'user'; editedBuiltIn?: boolean; localEdited?: boolean;
  inStorybook: boolean; storybookEdited: boolean; retained?: boolean; snapshotEdited?: boolean;
}): CharacterProvenanceStage[] {
  const stages: CharacterProvenanceStage[] = [];
  if (options.editedBuiltIn) {
    stages.push(
      { label: 'Built-in', title: 'Bundled application character' },
      options.localEdited
        ? { label: 'Local edit', title: 'Locally edited NPC file overrides the built-in character' }
        : { label: 'Local copy', title: 'Local NPC file matches the built-in character' },
    );
  } else if (options.tier === 'bundled') {
    stages.push({ label: 'Built-in', title: 'Bundled application character' });
  } else if (options.tier === 'user') {
    stages.push({ label: 'User-created', title: 'Character from the local NPC Library folder' });
  }
  if (options.retained) {
    stages.push({ label: options.snapshotEdited ? 'RP edit' : 'RP snapshot',
      title: 'Character revision retained in this RP and included in future saves, even if its library file is missing' });
  }
  if (options.inStorybook) {
    if (!stages.length) {
      stages.push({ label: 'Storybook original', title: 'Character exists only in the Storybook' });
    } else {
      stages.push(options.storybookEdited
        ? { label: 'Storybook edit', title: 'The active Storybook character differs from its library source' }
        : { label: 'In Storybook', title: 'The active Storybook character matches its library source' });
    }
  }
  return stages;
}
