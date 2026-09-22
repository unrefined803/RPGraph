import { characterPayload, validateCharacterContainer, validateCharacterPayload, migratedProfileName, normalizeCharacterApps, type CharacterApps } from './character';
import formatVersions from '../storybook/formatVersions.json';

/** Shared public serialization boundary for authored containers and UI exports. */
export function createCharacterContainer(character: Parameters<typeof characterPayload>[0], includePosts = false, includeReceivedImages = false) {
  const copy = structuredClone(character);
  copy.apps = normalizeCharacterApps(copy.apps, copy.social, copy.id, copy.name);
  if (!includeReceivedImages) {
    const excluded = new Set(copy.images.filter((image) => image.receivedFrom || image.imageAccess).map((image) => image.id));
    copy.images = copy.images.filter((image) => !excluded.has(image.id));
    if (copy.profileImage && excluded.has(copy.profileImage.imageId)) delete copy.profileImage;
    for (const account of Object.values(copy.apps ?? {})) {
      if (account.avatarImageId && excluded.has(account.avatarImageId)) delete account.avatarImageId;
      for (const post of account.initialPosts ?? []) {
        if (post.imageId && excluded.has(post.imageId)) delete post.imageId;
      }
    }
    const matchme = copy.apps.matchme;
    if (matchme?.profile) {
      matchme.profile.photoIds = matchme.profile.photoIds.filter((id) => !excluded.has(id));
      if (!matchme.profile.photoIds.length) matchme.enabled = false;
    }
  }
  const payload = characterPayload(copy, true);
  for (const [app, account] of Object.entries(payload.apps)) {
    if (!includePosts || (app !== 'fotogram' && app !== 'onlyfriends')) delete account.initialPosts;
  }
  const container = { format: 'rpgraph-character' as const, version: formatVersions.characterCard, character: payload };
  validateCharacterContainer(container);
  return container;
}

type AuthoredAccount = Partial<NonNullable<CharacterApps['matchme']>>;
export type CharacterSpecification = Omit<Partial<Parameters<typeof characterPayload>[0]>, 'apps'> & {
  name: string;
  apps?: Partial<Record<keyof CharacterApps, AuthoredAccount>>;
};

/** IDs depend on an explicit identity, never a name, filename or array order. */
export function createAuthoredCharacter(specification: CharacterSpecification, newId: () => string) {
  const source = structuredClone(specification);
  const allowed = new Set(['id', 'name', 'description', 'personality', 'speechStyle', 'hiddenAgency', 'agencyTags', 'relationships', 'role', 'playable',
    'age', 'gender', 'images', 'apps', 'profileImage', 'phoneSettings', 'banking', 'comfyConfig', 'voiceConfig']);
  for (const field of Object.keys(source)) {
    if (!allowed.has(field)) throw new Error(`Unsupported authored character field: ${field}`);
  }
  const id = source.id ?? newId();
  const apps: CharacterApps = {};
  for (const [app, account] of Object.entries(source.apps ?? {})) {
    apps[app as keyof CharacterApps] = {
      enabled: true, bio: '',
      ...account,
      ...(app !== 'whatsup' ? { profileName: app === 'matchme'
        ? account.profileName ?? account.displayName ?? account.profile?.name ?? source.name
        : migratedProfileName(account, source.name, account.profile?.name ?? '') } : {}),
      accountId: account.accountId ?? `character:${id}:${app}`,
    };
  }
  const character = { description: '', personality: '', speechStyle: '', role: '', playable: false,
    images: [], relationships: [], ...source, id, apps };
  // Validate before normalization so malformed profiles cannot disappear silently.
  validateCharacterPayload(character);
  return createCharacterContainer(character, true);
}
