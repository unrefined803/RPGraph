import { accountHandle, migratedProfileName } from '../characters/character';
import { resolveWhatsUpRecipient } from '../characters/messageIdentity';
import { normalizePhoneName } from './phoneMessages';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';

const accountLinkApps = ['whatsup', 'fotogram', 'onlyfriends', 'matchme', 'banking'] as const;
export type AccountLinkApp = typeof accountLinkApps[number];
export type AccountLink = { token: string; app: AccountLinkApp; accountId: string; characterId: string };
export type AccountLinkTarget = AccountLink & { name: string; username: string; character: StorybookCharacter };
export type ParsedAccountLink = AccountLinkTarget & { start: number; end: number };
const appAliases: Record<string, AccountLinkApp> = {
  whatsup: 'whatsup', whatsapp: 'whatsup', fotogram: 'fotogram', photogram: 'fotogram',
  onlyfriends: 'onlyfriends', matchme: 'matchme',
  bank: 'banking', banking: 'banking',
};
const identityContinuation = /^[\p{L}\p{N}_:@-]|^[.][\p{L}\p{N}_]/u;
const key = (text: string) => text.trim().replace(/^@/, '').replace(/\s+/g, ' ').toLowerCase();

function accountLinkTargets(characters: StorybookCharacter[]) {
  return characters.flatMap((character) => accountLinkApps.flatMap<AccountLinkTarget>((app) => {
    if (app === 'banking') {
      return [{ token: '', app, accountId: character.name, characterId: character.sourceId,
        name: character.name, username: character.name, character }];
    }
    const account = character.apps?.[app];
    if (app === 'whatsup') {
      try {
        const phone = resolveWhatsUpRecipient(characters, [], character.sourceId);
        return [{ token: '', app, accountId: phone.accountId, characterId: character.sourceId,
          name: character.name, username: accountHandle(account) ?? '', character }];
      } catch { return []; }
    }
    if (!account?.enabled) return [];
    return [{ token: '', app, accountId: account.accountId, characterId: character.sourceId,
      name: migratedProfileName(account) || character.name, username: accountHandle(account), character }];
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
  if (app === 'banking') {
    const trimmed = identity.trim().replace(/^@/, '');
    const byId = characters.filter((character) => character.id === trimmed || character.sourceId === trimmed);
    const canonical = byId.length ? byId : characters.filter((character) =>
      normalizePhoneName(character.name) === normalizePhoneName(trimmed) ||
      character.identityAliases?.characterIds?.includes(trimmed)
    );
    if (canonical.length !== 1) return undefined;
    const character = canonical[0];
    return { token: '', app: 'banking' as const, accountId: character.name, characterId: character.sourceId,
      name: character.name, username: character.name, character };
  }
  const canonical = characters.filter((character) => character.apps?.[app]?.accountId === identity.trim());
  const owners = canonical.length ? canonical : characters.filter((character) =>
    [character.name, character.apps?.[app]?.profileName, accountHandle(character.apps?.[app]),
      ...(character.apps?.[app]?.legacyHandles ?? []),
      ...(character.identityAliases?.accountIds?.[app] ?? [])].some((alias) => !!alias && key(alias) === key(identity)));
  if (owners.length !== 1) return undefined;
  const target = accountLinkTargets(owners).find((entry) => entry.app === app);
  if (target && characters.filter((character) => character.apps?.[app]?.accountId === target.accountId).length === 1) return target;
}

/** Longest complete known identity wins. Never guess partial names or ambiguous aliases. */
export function parseAccountLinks(text: string, characters: StorybookCharacter[], bindings?: AccountLink[]): ParsedAccountLink[] {
  const links: ParsedAccountLink[] = [];
  const targets = accountLinkTargets(characters);
  const prefix = /@(whatsup|whatsapp|fotogram|photogram|onlyfriends|matchme|banking|bank):/gi;
  for (const match of text.matchAll(prefix)) {
    const start = match.index;
    if (start > 0 && /[\p{L}\p{N}_@]/u.test(text[start - 1])) continue;
    if (links.some((link) => start < link.end)) continue;
    const app = appAliases[match[1].toLowerCase()];
    const tail = text.slice(start + match[0].length);
    const candidates = targets.filter((target) => target.app === app).flatMap((target) =>
      [target.accountId, target.character.name, target.name, target.username,
        ...(app !== 'banking' ? (target.character.apps?.[app]?.legacyHandles ?? []) : []),
        ...(app !== 'banking' ? (target.character.identityAliases?.accountIds?.[app] ?? []) : [])]);
    const bound = bindings?.filter((link) => link.app === app && text.startsWith(link.token, start) &&
      !identityContinuation.test(text.slice(start + link.token.length)))
      .sort((a, b) => b.token.length - a.token.length)[0];
    if (bound) {
      const target = resolveAccountLink(app, app === 'banking' ? bound.characterId : bound.accountId, characters);
      if (target && target.characterId === bound.characterId) links.push({ ...target, token: bound.token, start, end: start + bound.token.length });
      continue;
    }
    // Preserve every stored binding above, but resolve previously unrecognized
    // tokens too (older saves can have empty or incomplete binding lists).
    const aliases = [...new Set(candidates.filter(Boolean))].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const escaped = alias.trim().replace(/^@/, '').split(/\s+/).map((part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[ \\t]+');
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

/** Stored account IDs must not be rebound through a coincidentally matching display name. */
export function resolveMessageAccount(app: AccountLinkApp, accountId: string | undefined, identity: string | undefined,
  characters: StorybookCharacter[]) {
  const value = accountId ?? identity;
  if (!value) return undefined;
  const target = resolveAccountLink(app, value, characters);
  if (accountId && target?.accountId !== accountId &&
    (app === 'banking' || !target?.character.identityAliases?.accountIds?.[app]?.includes(accountId))) return undefined;
  return target;
}

function messageAccountLinks(message: MessageRecord, characters: StorybookCharacter[]) {
  const text = message.socialDirectMessage?.text ?? message.originalText;
  return parseAccountLinks(text, characters, message.socialDirectMessage?.accountLinks ?? message.accountLinks);
}

/** Delivered account links grant contacts to the recipient, including playable characters. */
export function automaticAccountLinkGrants(messages: MessageRecord[], characters: StorybookCharacter[]) {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'output') return [];
    const dm = message.socialDirectMessage;
    if (!dm && !message.phoneMessage) return [];
    const app = dm?.app ?? 'whatsup';
    const recipient = resolveMessageAccount(app, dm?.toAccountId ?? message.phoneToAccountId,
      dm?.toHandle || dm?.to || message.phoneTo, characters)?.character;
    if (!recipient) return [];
    // MatchMe retains its existing behavior; sharing a profile never creates a match.
    return messageAccountLinks(message, characters).filter((link) => link.characterId !== recipient.sourceId)
      .filter((link) => link.app !== 'matchme' || message.role === 'user' || recipient.playerSelectable === false)
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
