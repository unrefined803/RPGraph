import { characterPayload, validateCharacterContainer, validateCharacterPayload, type CharacterApps } from './character';
import formatVersions from '../storybook/formatVersions.json';

/** Shared public serialization boundary for authored containers and UI exports. */
export function createCharacterContainer(character: Parameters<typeof characterPayload>[0], includePosts = false) {
  const payload = characterPayload(structuredClone(character), true);
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
  const allowed = new Set(['id', 'name', 'description', 'personality', 'speechStyle', 'role', 'playable',
    'age', 'gender', 'images', 'apps', 'profileImage', 'phoneSettings', 'banking', 'comfyConfig', 'voiceConfig']);
  for (const field of Object.keys(source)) {
    if (!allowed.has(field)) throw new Error(`Unsupported authored character field: ${field}`);
  }
  const id = source.id ?? newId();
  const apps: CharacterApps = {};
  for (const [app, account] of Object.entries(source.apps ?? {})) {
    apps[app as keyof CharacterApps] = {
      enabled: true, username: '', displayName: source.name, bio: '',
      ...account, accountId: account.accountId ?? `character:${id}:${app}`,
    };
  }
  const character = { description: '', personality: '', speechStyle: '', role: '', playable: false,
    images: [], ...source, id, apps };
  // Validate before normalization so malformed profiles cannot disappear silently.
  validateCharacterPayload(character);
  return createCharacterContainer(character, true);
}
