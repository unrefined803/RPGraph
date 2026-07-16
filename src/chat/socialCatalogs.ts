import fotogramCatalogValue from './catalogs/fotogram-users.json';
import onlyFriendsCatalogValue from './catalogs/onlyfriends-users.json';
import type { SocialAppKind } from '../types';

export type BundledSocialIdentity = {
  name: string;
  handle: string;
};

type SocialCatalogTuple = [name: string, handle: string];

function socialCatalogTuples(value: unknown): SocialCatalogTuple[] {
  return Array.isArray(value)
    ? value.flatMap((entry) =>
        Array.isArray(entry) && entry.length === 2 &&
        typeof entry[0] === 'string' && typeof entry[1] === 'string' &&
        entry[0].trim() && entry[1].trim()
          ? [[entry[0].trim(), entry[1].trim().replace(/^@/, '')] as SocialCatalogTuple]
          : []
      )
    : [];
}

function socialIdentities(value: unknown): BundledSocialIdentity[] {
  return socialCatalogTuples(value).map(([name, handle]) => ({ name, handle }));
}

export const bundledSocialIdentities: Record<SocialAppKind, BundledSocialIdentity[]> = {
  fotogram: socialIdentities(fotogramCatalogValue),
  onlyfriends: socialIdentities(onlyFriendsCatalogValue),
};

/** Whether a handle exactly belongs to the bundled catalog for this app. */
export function isBundledSocialHandle(app: SocialAppKind, handle: string) {
  const normalizedHandle = handle.trim().replace(/^@/, '').toLowerCase();
  return !!normalizedHandle && bundledSocialIdentities[app].some(
    (identity) => identity.handle.toLowerCase() === normalizedHandle,
  );
}

function normalizedSocialName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Preserve an explicit handle or recover the exact bundled handle for a known catalog name. */
export function socialHandleFromCatalogIdentity(
  app: SocialAppKind,
  name: string,
  explicitHandle?: string,
) {
  const cleanHandle = explicitHandle?.trim().replace(/^@/, '').toLowerCase();
  if (cleanHandle) {
    return cleanHandle;
  }
  const normalizedName = normalizedSocialName(name);
  return bundledSocialIdentities[app].find((identity) =>
    normalizedSocialName(identity.name) === normalizedName
  )?.handle;
}

/** Exact built-in identities the LLM may use for background comments and post DMs. */
export function bundledSocialIdentityContext(app: SocialAppKind) {
  return [
    '[AVAILABLE VIRTUAL SOCIAL USERS]',
    'Use these exact name and handle pairs for newly introduced background commenters or post-related fans:',
    ...bundledSocialIdentities[app].map(({ name, handle }) => `- ${name} (@${handle})`),
    'Do not invent a different background social identity. Existing Storybook characters and established conversation participants may still appear when the app rules allow them.',
    '[/AVAILABLE VIRTUAL SOCIAL USERS]',
  ];
}

export function withBundledSocialIdentityContext(input: string, app: SocialAppKind) {
  return [input, ...bundledSocialIdentityContext(app)].join('\n');
}
