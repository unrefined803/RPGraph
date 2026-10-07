import { accountLinkIdentity, characterMessageAliases, matchingMessageAliases, messageAliasKey } from './messageAliases';
import { accountHandleMatches } from './character';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import type { WhatsUpAlias } from './character';

const key = messageAliasKey;

/** Every effective character has a stable phone identity, even before a contact is added. */
export function whatsUpAccountId(character: StorybookCharacter) {
  return character.apps?.whatsup?.accountId ?? `character:${character.sourceId}:whatsup`;
}

/** The second WhatsUp name, available while the character's WhatsUp account is enabled. */
export function whatsUpAlias(character: Pick<StorybookCharacter, 'apps'> | undefined): WhatsUpAlias | undefined {
  const account = character?.apps?.whatsup;
  return account?.enabled !== false && account?.alias?.name.trim() ? account.alias : undefined;
}

/** Link identity of the second name. Messages and contacts keep it, so the real name is never implied. */
export function whatsUpAliasAccountId(character: StorybookCharacter) {
  return `${whatsUpAccountId(character)}:alias`;
}

function aliasRecipient(owners: StorybookCharacter[], identity: string) {
  if (owners.length > 1) throw new Error(`Ambiguous WhatsUp recipient "${identity}". Use a unique account ID.`);
  return { name: whatsUpAlias(owners[0])!.name.trim(), characterId: owners[0].sourceId,
    accountId: whatsUpAliasAccountId(owners[0]), alias: true as const };
}

/** The identity a participant was written as: the content of a WhatsUp link, or the bare name or ID. */
function writtenWhatsUpIdentity(identity: string) {
  return accountLinkIdentity(identity, 'whatsup') ?? identity.trim().replace(/^@/, '').trim();
}

/**
 * Spellings a model copies loosely: a link without its leading @, or the
 * history label of a second account ("Name (second account of Owner)").
 */
function looseWhatsUpIdentity(identity: string) {
  return writtenWhatsUpIdentity(identity).replace(/^(?:whatsup|whatsapp):\s*/i, '')
    .replace(/\s*\(second account of [^()]*\)$/i, '').replace(/^@/, '').trim();
}

/** WhatsUp recipients must be exact identities, never fuzzy name guesses. */
export function resolveWhatsUpRecipient(characters: StorybookCharacter[], messages: MessageRecord[], identity: string): {
  name: string; accountId: string; characterId?: string; alias?: true;
} {
  try {
    return resolveWrittenWhatsUpRecipient(characters, messages, identity);
  } catch (error) {
    // Stored account IDs may start with an app name, so the loose form is only a fallback for an unknown identity.
    const loose = looseWhatsUpIdentity(identity);
    if (!loose || loose === writtenWhatsUpIdentity(identity) || !(error instanceof Error) || !error.message.startsWith('Unknown')) throw error;
    try { return resolveWrittenWhatsUpRecipient(characters, messages, loose); } catch { throw error; }
  }
}

function resolveWrittenWhatsUpRecipient(characters: StorybookCharacter[], messages: MessageRecord[], identity: string): {
  name: string; accountId: string; characterId?: string; alias?: true;
} {
  // Generated messages name their participants as account links; a bare name or ID stays valid.
  identity = writtenWhatsUpIdentity(identity);
  // Temporary UI contacts are projections of history, not newly provisioned accounts.
  characters = characters.filter((character) => !(character as StorybookCharacter & { temporaryPhone?: boolean }).temporaryPhone);
  const aliasById = characters.filter((character) => whatsUpAlias(character) && whatsUpAliasAccountId(character) === identity);
  if (aliasById.length) return aliasRecipient(aliasById, identity);
  if (characters.some((character) => whatsUpAliasAccountId(character) === identity)) {
    throw new Error(`Unavailable WhatsUp recipient "${identity}". The second account is absent or disabled.`);
  }
  const canonical = characters.filter((character) => whatsUpAccountId(character) === identity);
  const stable = characters.filter((character) => character.id === identity || character.sourceId === identity ||
    character.identityAliases?.characterIds?.includes(identity) ||
    character.identityAliases?.accountIds?.whatsup?.includes(identity));
  const localCharacters = canonical.length ? canonical : stable.length ? stable : characters.filter((character) =>
    key(character.name) === key(identity) ||
    accountHandleMatches(character.apps?.whatsup, identity));
  // A real name or account handle wins; the second name answers only to itself.
  const aliasByName = localCharacters.length ? [] : matchingMessageAliases(
    characters.filter((character) => whatsUpAlias(character)), identity,
    (character) => [whatsUpAlias(character)!.name]);
  if (aliasByName.length) return aliasRecipient(aliasByName, identity);
  const identityCharacters = localCharacters.length ? localCharacters
    : matchingMessageAliases(characters, identity, characterMessageAliases);
  if (identityCharacters.length > 1) {
    throw new Error(`Ambiguous WhatsUp recipient "${identity}". Use a unique account ID.`);
  }
  const matches = identityCharacters.filter((character) => character.apps?.whatsup?.enabled !== false);
  if (matches.length === 1) {
    const character = matches[0];
    if (characters.filter((entry) => whatsUpAccountId(entry) === whatsUpAccountId(character)).length > 1) {
      throw new Error(`Ambiguous WhatsUp recipient "${identity}". Its account ID belongs to multiple characters.`);
    }
    return { name: character.name, characterId: character.sourceId,
      accountId: whatsUpAccountId(character) };
  }
  if (identityCharacters.length > 0) {
    throw new Error(`Unavailable WhatsUp recipient "${identity}". The matching account is absent or disabled.`);
  }
  const known = messages.flatMap((message) => message.phoneMessage ? [
    { name: message.phoneFrom ?? '', accountId: message.phoneFromAccountId },
    { name: message.phoneTo ?? '', accountId: message.phoneToAccountId },
  ] : []).filter((contact) => !!contact.name).map((contact) => ({
    ...contact, accountId: contact.accountId ?? `whatsup:contact:${encodeURIComponent(contact.name)}`,
  }));
  const byId = known.filter((contact) => contact.accountId === identity);
  const distinct = new Map((byId.length ? byId : matchingMessageAliases(known, identity, (contact) => [contact.name]))
    .map((contact) => [contact.accountId, contact]));
  if (distinct.size === 1) {
    const contact = [...distinct.values()][0];
    // Recorded identities still belong to their owner after a rename. Resolve
    // without history to avoid reviving removed or disabled second accounts.
    if (characters.some((character) => [whatsUpAccountId(character), whatsUpAliasAccountId(character)].includes(contact.accountId))) {
      return resolveWhatsUpRecipient(characters, [], contact.accountId);
    }
    // A recorded alias must not resurrect a currently disabled character account.
    const owner = characters.find((character) => key(character.name) === key(contact.name) ||
      key(character.apps?.whatsup?.alias?.name ?? '') === key(contact.name));
    if (owner?.apps?.whatsup?.enabled === false) {
      throw new Error(`Unavailable WhatsUp recipient "${identity}". The matching account is disabled.`);
    }
    return { name: contact.name, accountId: contact.accountId };
  }
  if (distinct.size > 1) throw new Error(`Ambiguous WhatsUp recipient "${identity}". Use a unique account ID.`);
  throw new Error(`Unknown WhatsUp recipient "${identity}". Use an existing full character name or account ID.`);
}

/** Resolve both endpoints before a phone message can create any side effect. */
export function resolveWhatsUpMessageParticipants(
  characters: StorybookCharacter[],
  messages: MessageRecord[],
  message: { from: string; to: string },
) {
  const from = resolveWhatsUpRecipient(characters, messages, message.from);
  const to = resolveWhatsUpRecipient(characters, messages, message.to);
  return {
    from: knownWhatsUpName(characters, messages, from, to, message.from),
    to: knownWhatsUpName(characters, messages, to, from, message.to),
  };
}

/**
 * A character with a second name stays hidden from people who know only that
 * name: a message written under the real name then continues the second name.
 * The second name itself is always a deliberate choice, and so is an exact
 * account ID; neither is rewritten.
 */
function knownWhatsUpName(
  characters: StorybookCharacter[],
  messages: MessageRecord[],
  side: ReturnType<typeof resolveWhatsUpRecipient>,
  other: ReturnType<typeof resolveWhatsUpRecipient>,
  identity: string,
) {
  const owner = 'characterId' in side ? characters.find((character) => character.sourceId === side.characterId) : undefined;
  if (!owner || !whatsUpAlias(owner) || 'alias' in side || writtenWhatsUpIdentity(identity) === side.accountId) return side;
  return whatsUpNameKnownBy(owner, other.name, messages, other.accountId) === 'alias' ? aliasRecipient([owner], identity) : side;
}

/** The owner's names a contact has exchanged messages with, and the one their latest message used. */
export function whatsUpNamesUsedWith(owner: StorybookCharacter, contactName: string, messages: MessageRecord[], contactAccountId?: string) {
  const alias = whatsUpAlias(owner);
  const known = new Set<'real' | 'alias'>();
  let latest: 'real' | 'alias' | undefined;
  let count = 0;
  if (!alias) return { known, latest, count };
  const contactKey = key(contactName);
  for (const message of messages) {
    if (!message.phoneMessage) continue;
    const endpoints = [
      { name: message.phoneFrom ?? '', id: message.phoneFromAccountId },
      { name: message.phoneTo ?? '', id: message.phoneToAccountId },
    ];
    const contactIndex = endpoints.findIndex((endpoint) => endpoint.id && contactAccountId
      ? endpoint.id === contactAccountId : key(endpoint.name) === contactKey);
    if (contactIndex < 0) continue;
    const endpoint = endpoints[1 - contactIndex];
    const used = endpoint.id
      ? endpoint.id === whatsUpAliasAccountId(owner) ? 'alias' : endpoint.id === whatsUpAccountId(owner) ? 'real' : undefined
      : key(endpoint.name) === key(alias.name) ? 'alias' : key(endpoint.name) === key(owner.name) ? 'real' : undefined;
    if (!used) continue;
    known.add(used);
    latest = used;
    count += 1;
  }
  return { known, latest, count };
}

/** Which of the owner's two names a contact has seen so far; undefined when neither or both were used. */
export function whatsUpNameKnownBy(owner: StorybookCharacter, contactName: string, messages: MessageRecord[], contactAccountId?: string) {
  const { known } = whatsUpNamesUsedWith(owner, contactName, messages, contactAccountId);
  return known.size === 1 ? [...known][0] : undefined;
}

/** The second-name owner behind a stored WhatsUp identity, or undefined for a real name. */
export function whatsUpAliasOwner(characters: StorybookCharacter[], accountId: string | undefined, name: string) {
  const owners = characters.filter((character) => {
    const alias = whatsUpAlias(character);
    return !!alias && (accountId ? whatsUpAliasAccountId(character) === accountId : key(alias.name) === key(name));
  });
  return owners.length === 1 ? owners[0] : undefined;
}
