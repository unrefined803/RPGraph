import type { Character, CharacterAppAccount, CharacterApps } from './character';

export type CharacterApp = keyof CharacterApps;
export type CharacterRegistryTier = 'bundled' | 'user' | 'snapshot' | 'storybook';

export type CharacterRegistryAliases = {
  /** Previously issued stable or node-scoped runtime character IDs. */
  characterIds?: string[];
  /** Previously issued account IDs, grouped by the app that owns them. */
  accountIds?: Partial<Record<CharacterApp, string[]>>;
};

export type CharacterRegistryEntry = {
  character: Character;
  tier: CharacterRegistryTier;
  /** A filename, saved-snapshot key, or Storybook node ID used for diagnostics only. */
  source: string;
  aliases?: CharacterRegistryAliases;
};

export type CharacterRegistryDiagnosticCode =
  | 'duplicate-character-id'
  | 'duplicate-account-id'
  | 'duplicate-username';

export type CharacterRegistryDiagnostic = {
  code: CharacterRegistryDiagnosticCode;
  message: string;
  characterIds: string[];
  app?: CharacterApp;
  identity: string;
  sources: string[];
};

export type EffectiveCharacter = {
  character: Character;
  provenance: Pick<CharacterRegistryEntry, 'tier' | 'source'>;
  aliases: CharacterRegistryAliases;
  /** Only active Storybook characters can be offered as the player character. */
  playerSelectable: boolean;
};

export type EffectiveCharacterRegistry = {
  characters: EffectiveCharacter[];
  diagnostics: CharacterRegistryDiagnostic[];
};

export type RegistryResolution<T> =
  | { status: 'found'; value: T }
  | { status: 'missing' }
  | { status: 'ambiguous'; values: T[] };

export type EffectiveCharacterAccount = {
  app: CharacterApp;
  character: EffectiveCharacter;
  account: CharacterAppAccount;
};

const tierRank: Record<CharacterRegistryTier, number> = {
  bundled: 0,
  user: 1,
  snapshot: 2,
  storybook: 3,
};

const apps: CharacterApp[] = ['whatsup', 'fotogram', 'onlyfriends', 'matchme'];
const normalizedAlias = (value: string) => value.trim().replace(/^@/, '').replace(/\s+/g, ' ').toLowerCase();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

function groupBy<T>(values: T[], keyFor: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

function mergedCharacterAliases(entries: CharacterRegistryEntry[], winner: CharacterRegistryEntry) {
  return unique([
    ...(winner.aliases?.characterIds ?? []),
    ...entries.flatMap((entry) => entry.character.id === winner.character.id
      ? (entry.aliases?.characterIds ?? [])
      : []),
  ]).filter((alias) => alias !== winner.character.id);
}

function winnerAliases(entries: CharacterRegistryEntry[], winner: CharacterRegistryEntry): CharacterRegistryAliases {
  const accountIds: CharacterRegistryAliases['accountIds'] = {};
  for (const app of apps) {
    const canonicalId = winner.character.apps?.[app]?.accountId;
    const aliases = unique(winner.aliases?.accountIds?.[app] ?? []).filter((alias) => alias !== canonicalId);
    if (aliases.length) accountIds[app] = aliases;
  }
  return {
    characterIds: mergedCharacterAliases(entries, winner),
    ...(Object.keys(accountIds).length ? { accountIds } : {}),
  };
}

/**
 * Resolve complete characters by stable ID. A higher tier replaces the entire
 * payload; account/profile fields are deliberately never merged across tiers.
 * Ambiguous IDs inside one tier are quarantined at that tier, allowing a valid
 * lower-tier definition to remain effective.
 */
export function buildCharacterRegistry(entries: CharacterRegistryEntry[]): EffectiveCharacterRegistry {
  const diagnostics: CharacterRegistryDiagnostic[] = [];
  const validById = new Map<string, CharacterRegistryEntry[]>();
  const grouped = new Map<string, CharacterRegistryEntry[]>();

  for (const entry of entries) {
    const key = `${entry.tier}\u0000${entry.character.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }
  for (const sameTierEntries of grouped.values()) {
    const { id } = sameTierEntries[0].character;
    if (sameTierEntries.length > 1) {
      diagnostics.push({
        code: 'duplicate-character-id',
        message: `Character ID "${id}" is defined more than once in the ${sameTierEntries[0].tier} tier.`,
        characterIds: [id],
        identity: id,
        sources: sameTierEntries.map((entry) => entry.source),
      });
      continue;
    }
    validById.set(id, [...(validById.get(id) ?? []), sameTierEntries[0]]);
  }

  const characters = [...validById.values()].map((candidates) => {
    const winner = candidates.reduce((current, candidate) =>
      tierRank[candidate.tier] > tierRank[current.tier] ? candidate : current);
    return {
      character: winner.character,
      provenance: { tier: winner.tier, source: winner.source },
      aliases: winnerAliases(candidates, winner),
      playerSelectable: winner.tier === 'storybook' && winner.character.playable !== false,
    } satisfies EffectiveCharacter;
  });

  const accounts = characters.flatMap((character) => apps.flatMap((app) => {
    const account = character.character.apps?.[app];
    return account ? [{ app, character, account } satisfies EffectiveCharacterAccount] : [];
  }));
  for (const app of apps) {
    const appAccounts = accounts.filter((entry) => entry.app === app);
    const byId = groupBy(appAccounts, (entry) => entry.account.accountId);
    for (const [accountId, collisions] of byId) {
      if (collisions.length < 2) continue;
      diagnostics.push({ code: 'duplicate-account-id', app, identity: accountId,
        message: `${app} account ID "${accountId}" belongs to multiple effective characters.`,
        characterIds: collisions.map((entry) => entry.character.character.id),
        sources: collisions.map((entry) => entry.character.provenance.source) });
    }
    const withUsername = appAccounts.filter((entry) => !!entry.account.username.trim());
    const byUsername = groupBy(withUsername, (entry) => normalizedAlias(entry.account.username));
    for (const [username, collisions] of byUsername) {
      if (collisions.length < 2) continue;
      diagnostics.push({ code: 'duplicate-username', app, identity: username,
        message: `${app} username "${username}" belongs to multiple effective characters.`,
        characterIds: collisions.map((entry) => entry.character.character.id),
        sources: collisions.map((entry) => entry.character.provenance.source) });
    }
  }

  return { characters, diagnostics };
}

function resolution<T>(values: T[]): RegistryResolution<T> {
  if (values.length === 1) return { status: 'found', value: values[0] };
  if (values.length > 1) return { status: 'ambiguous', values };
  return { status: 'missing' };
}

export function resolveRegistryCharacter(
  registry: EffectiveCharacterRegistry,
  identity: string,
): RegistryResolution<EffectiveCharacter> {
  const byStableId = registry.characters.filter((entry) => entry.character.id === identity);
  if (byStableId.length) return resolution(byStableId);
  const byLegacyId = registry.characters.filter((entry) => entry.aliases.characterIds?.includes(identity));
  if (byLegacyId.length) return resolution(byLegacyId);
  const key = normalizedAlias(identity);
  return resolution(registry.characters.filter((entry) => normalizedAlias(entry.character.name) === key));
}

export function registryAccounts(
  registry: EffectiveCharacterRegistry,
  app: CharacterApp,
  options: { includeDisabled?: boolean } = {},
): EffectiveCharacterAccount[] {
  return registry.characters.flatMap((character) => {
    const account = character.character.apps?.[app];
    if (!account || (!options.includeDisabled && !account.enabled)) return [];
    return [{ app, character, account }];
  });
}

/** Stable IDs win over presentation aliases; every other match must be unique. */
export function resolveRegistryAccount(
  registry: EffectiveCharacterRegistry,
  app: CharacterApp,
  identity: string,
  options: { includeDisabled?: boolean } = {},
): RegistryResolution<EffectiveCharacterAccount> {
  const accounts = registryAccounts(registry, app, { includeDisabled: true });
  const availableResolution = (matches: EffectiveCharacterAccount[]): RegistryResolution<EffectiveCharacterAccount> => {
    const resolved = resolution(matches);
    if (resolved.status !== 'found' || options.includeDisabled || resolved.value.account.enabled) return resolved;
    return { status: 'missing' };
  };
  const byStableId = accounts.filter((entry) => entry.account.accountId === identity);
  if (byStableId.length) return availableResolution(byStableId);
  const byLegacyId = accounts.filter((entry) => entry.character.aliases.accountIds?.[app]?.includes(identity));
  if (byLegacyId.length) return availableResolution(byLegacyId);
  const key = normalizedAlias(identity);
  return availableResolution(accounts.filter((entry) => normalizedAlias(entry.account.username) === key ||
    normalizedAlias(entry.character.character.name) === key));
}

/** Image IDs are intentionally scoped to their stable character owner. */
export function resolveRegistryImage(
  registry: EffectiveCharacterRegistry,
  ownerCharacterId: string,
  imageId: string,
) {
  const owner = resolveRegistryCharacter(registry, ownerCharacterId);
  if (owner.status !== 'found') return undefined;
  return owner.value.character.images.find((image) => image.id === imageId);
}

/** Initial-post IDs are intentionally scoped to their stable account owner. */
export function resolveRegistryInitialPost(
  registry: EffectiveCharacterRegistry,
  app: CharacterApp,
  ownerAccountId: string,
  postId: string,
) {
  const owner = resolveRegistryAccount(registry, app, ownerAccountId, { includeDisabled: true });
  if (owner.status !== 'found') return undefined;
  return owner.value.account.initialPosts?.find((post) => post.id === postId);
}
