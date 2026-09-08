import { resolveWhatsUpRecipient } from '../characters/messageIdentity';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';

export const accountLinkApps = ['whatsup', 'fotogram', 'onlyfriends', 'matchme'] as const;
export type AccountLinkApp = typeof accountLinkApps[number];
export type AccountLink = { token: string; app: AccountLinkApp; accountId: string; characterId: string };
export type AccountLinkTarget = AccountLink & { name: string; username: string; character: StorybookCharacter };
export type ParsedAccountLink = AccountLinkTarget & { start: number; end: number };
const appAliases: Record<string, AccountLinkApp> = {
  whatsup: 'whatsup', whatsapp: 'whatsup', fotogram: 'fotogram', photogram: 'fotogram',
  onlyfriends: 'onlyfriends', matchme: 'matchme',
};
const key = (text: string) => text.trim().replace(/^@/, '').replace(/\s+/g, ' ').toLowerCase();

export function accountLinkTargets(characters: StorybookCharacter[]) {
  return characters.flatMap((character) => accountLinkApps.flatMap<AccountLinkTarget>((app) => {
    const account = character.apps?.[app];
    if (app === 'whatsup') {
      try {
        const phone = resolveWhatsUpRecipient(characters, [], character.sourceId);
        return [{ token: '', app, accountId: phone.accountId, characterId: character.sourceId,
          name: account?.displayName || character.name, username: account?.username ?? '', character }];
      } catch { return []; }
    }
    if (!account?.enabled) return [];
    return [{ token: '', app, accountId: account.accountId, characterId: character.sourceId,
      name: account.displayName || character.name, username: account.username, character }];
  }));
}

export function resolveAccountLink(app: AccountLinkApp, identity: string, characters: StorybookCharacter[]) {
  if (app === 'whatsup') {
    try {
      const phone = resolveWhatsUpRecipient(characters, [], identity);
      return accountLinkTargets(characters).find((target) => target.app === app &&
        target.accountId === phone.accountId && target.characterId === phone.characterId);
    } catch { return undefined; }
  }
  const canonical = characters.filter((character) => character.apps?.[app]?.accountId === identity.trim());
  const owners = canonical.length ? canonical : characters.filter((character) =>
    [character.name, character.apps?.[app]?.displayName, character.apps?.[app]?.username,
      ...(character.identityAliases?.accountIds?.[app] ?? [])].some((alias) => !!alias && key(alias) === key(identity)));
  if (owners.length !== 1) return undefined;
  const target = accountLinkTargets(owners).find((entry) => entry.app === app);
  if (target && characters.filter((character) => character.apps?.[app]?.accountId === target.accountId).length === 1) return target;
}

/** Longest complete known identity wins. Never guess partial names or ambiguous aliases. */
export function parseAccountLinks(text: string, characters: StorybookCharacter[], bindings?: AccountLink[]): ParsedAccountLink[] {
  const links: ParsedAccountLink[] = [];
  const targets = accountLinkTargets(characters);
  const prefix = /@(whatsup|whatsapp|fotogram|photogram|onlyfriends|matchme):/gi;
  for (const match of text.matchAll(prefix)) {
    const start = match.index;
    if (start > 0 && /[\p{L}\p{N}_@]/u.test(text[start - 1])) continue;
    if (links.some((link) => start < link.end)) continue;
    const app = appAliases[match[1].toLowerCase()];
    const tail = text.slice(start + match[0].length);
    const candidates = targets.filter((target) => target.app === app).flatMap((target) =>
      [target.accountId, target.character.name, target.name, target.username,
        ...(target.character.identityAliases?.accountIds?.[app] ?? [])]);
    const bound = bindings?.filter((link) => link.app === app && text.startsWith(link.token, start))
      .sort((a, b) => b.token.length - a.token.length)[0];
    if (bound) {
      const target = resolveAccountLink(app, bound.accountId, characters);
      if (target && target.characterId === bound.characterId) links.push({ ...target, token: bound.token, start, end: start + bound.token.length });
      continue;
    }
    // Preserve every stored binding above, but resolve previously unrecognized
    // tokens too (older saves can have empty or incomplete binding lists).
    const aliases = [...new Set(candidates.filter(Boolean))].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const escaped = alias.trim().replace(/^@/, '').split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[ \\t]+');
      const identity = new RegExp(`^@?${escaped}(?![\\p{L}\\p{N}_:@-]|[.][\\p{L}\\p{N}_])`, 'iu').exec(tail)?.[0];
      if (!identity) continue;
      const target = resolveAccountLink(app, identity, characters);
      if (target) {
        const end = start + match[0].length + identity.length;
        links.push({ ...target, token: text.slice(start, end), start, end });
      }
      // An ambiguous longest alias must never fall back to a shorter identity.
      break;
    }
  }
  return links;
}

export function bindAccountLinks(text: string, characters: StorybookCharacter[]): AccountLink[] {
  return parseAccountLinks(text, characters).map(({ token, app, accountId, characterId }) => ({ token, app, accountId, characterId }));
}

export function messageAccountLinks(message: MessageRecord, characters: StorybookCharacter[]) {
  const text = message.socialDirectMessage?.text ?? message.originalText;
  return parseAccountLinks(text, characters, message.socialDirectMessage?.accountLinks ?? message.accountLinks);
}

/** User-sent DMs are received by the simulation; player recipients of generated DMs must click. */
export function automaticAccountLinkGrants(messages: MessageRecord[], characters: StorybookCharacter[]) {
  return messages.flatMap((message) => {
    const dm = message.socialDirectMessage;
    if (!dm && !message.phoneMessage) return [];
    const app = dm?.app ?? 'whatsup';
    const identity = dm?.toAccountId ?? message.phoneToAccountId ?? dm?.to ?? message.phoneTo;
    const recipient = identity ? resolveAccountLink(app, identity, characters)?.character : undefined;
    if (!recipient || (message.role !== 'user' && recipient.playerSelectable !== false)) return [];
    return messageAccountLinks(message, characters).filter((link) => link.characterId !== recipient.sourceId)
      .map((link) => ({ owner: recipient, link }));
  });
}

/** Optional additive save metadata; older messages have no bindings. */
export function validAccountLinkBindings(value: unknown): boolean {
  return value === undefined || Array.isArray(value) && value.every((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const link = entry as Record<string, unknown>;
    return typeof link.app === 'string' && accountLinkApps.includes(link.app as AccountLinkApp) &&
      ['token', 'accountId', 'characterId'].every((field) => typeof link[field] === 'string' && !!link[field]);
  });
}

/** Names and handles inside account links must not be rewritten by translation. */
export function shieldTranslationAccountLinks(text: string, characters: StorybookCharacter[]) {
  const links = parseAccountLinks(text, characters);
  let shielded = text;
  for (let index = links.length - 1; index >= 0; index--) {
    const link = links[index];
    shielded = `${shielded.slice(0, link.start)}[[RPGRAPH_ACCOUNT_LINK_${index}]]${shielded.slice(link.end)}`;
  }
  return { shielded, tokens: links.map((link) => link.token) };
}

export function restoreTranslationAccountLinks(text: string, tokens: string[]) {
  return text.replace(/\[\[\s*RPGRAPH_ACCOUNT_LINK_(\d+)\s*\]\]/gi, (match, digits: string) => tokens[Number(digits)] ?? match);
}
