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
