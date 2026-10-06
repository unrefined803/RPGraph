import type { StorybookCharacter } from '../storybook/runtime';

export const messageAliasKey = (value: string) =>
  value.trim().replace(/^@/, '').trim().replace(/\s+/g, ' ').toLowerCase();

export const accountLinkAppAliases = {
  whatsup: 'whatsup', whatsapp: 'whatsup', fotogram: 'fotogram', photogram: 'fotogram',
  onlyfriends: 'onlyfriends', matchme: 'matchme', bank: 'banking', banking: 'banking',
} as const;

/**
 * A message participant written as an account link (`@app:Identity`): the
 * identity without its prefix. Undefined for a bare name or another app's link.
 */
export function accountLinkIdentity(value: string, app: (typeof accountLinkAppAliases)[keyof typeof accountLinkAppAliases]) {
  // The leading @ is required: stored account IDs may themselves start with an app name.
  const match = /^@([a-z]+):\s*(.+)$/is.exec(value.trim());
  const linked = match && (accountLinkAppAliases as Record<string, string>)[match[1].toLowerCase()];
  return linked === app ? match![2].trim().replace(/^@/, '').trim() : undefined;
}

/** Presentation aliases identify an owner; delivery still requires a target-app account. */
export function characterMessageAliases(character: StorybookCharacter): string[] {
  const accounts = Object.values(character.apps ?? {});
  return [character.name, ...accounts.flatMap((account) => account ? [
    account.profileName ?? '', account.displayName ?? '', account.username ?? '', ...(account.legacyHandles ?? []),
  ] : []), ...(!character.apps ? [character.social.fotogramUsername, character.social.onlyfriendsUsername,
    character.social.plotTwist?.name ?? ''] : [])].filter((alias): alias is string => !!alias?.trim());
}

/** Exact presentation aliases win; relaxed separators must still identify one owner. */
export function matchingMessageAliases<T>(entries: T[], identity: string, aliases: (entry: T) => string[]): T[] {
  const key = messageAliasKey(identity);
  if (!key) return [];
  const exact = entries.filter((entry) => aliases(entry).some((alias) => messageAliasKey(alias) === key));
  if (exact.length) return exact;
  const compact = (value: string) => messageAliasKey(value).replace(/[\s._-]+/g, '');
  const compactKey = compact(identity);
  if (!compactKey || key.includes(':')) return [];
  return entries.filter((entry) => aliases(entry).some((alias) =>
    !!alias && !alias.includes(':') && compact(alias) === compactKey));
}
