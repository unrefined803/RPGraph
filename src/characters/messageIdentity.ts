import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';

const key = (value: string) => value.trim().replace(/^@/, '').replace(/\s+/g, ' ').toLowerCase();

/** WhatsUp recipients must be exact identities, never fuzzy name guesses. */
export function resolveWhatsUpRecipient(characters: StorybookCharacter[], messages: MessageRecord[], identity: string) {
  // Temporary UI contacts are projections of history, not newly provisioned accounts.
  characters = characters.filter((character) => !(character as StorybookCharacter & { temporaryPhone?: boolean }).temporaryPhone);
  const accountId = (character: StorybookCharacter) => character.apps?.whatsup?.accountId ??
    `character:${character.sourceId}:whatsup`;
  const canonical = characters.filter((character) => accountId(character) === identity);
  const stable = characters.filter((character) => character.id === identity || character.sourceId === identity ||
    character.identityAliases?.characterIds?.includes(identity) ||
    character.identityAliases?.accountIds?.whatsup?.includes(identity));
  const identityCharacters = canonical.length ? canonical : stable.length ? stable : characters.filter((character) =>
    key(character.name) === key(identity) ||
    (!!character.apps?.whatsup?.username && key(character.apps.whatsup.username) === key(identity)));
  if (identityCharacters.length > 1) {
    throw new Error(`Ambiguous WhatsUp recipient "${identity}". Use a unique account ID.`);
  }
  const matches = identityCharacters.filter((character) => character.apps?.whatsup?.enabled !== false &&
    (!character.libraryNpc || !!character.apps?.whatsup));
  if (matches.length === 1) {
    const character = matches[0];
    if (characters.filter((entry) => accountId(entry) === accountId(character)).length > 1) {
      throw new Error(`Ambiguous WhatsUp recipient "${identity}". Its account ID belongs to multiple characters.`);
    }
    return { name: character.name, characterId: character.sourceId,
      accountId: accountId(character) };
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
  const distinct = new Map((byId.length ? byId : known.filter((contact) => key(contact.name) === key(identity)))
    .map((contact) => [contact.accountId, contact]));
  if (distinct.size === 1) {
    const contact = [...distinct.values()][0];
    // A recorded alias must not resurrect a currently disabled character account.
    const owner = characters.find((character) => key(character.name) === key(contact.name));
    if (owner?.apps?.whatsup?.enabled === false) {
      throw new Error(`Unavailable WhatsUp recipient "${identity}". The matching account is disabled.`);
    }
    return { name: contact.name, accountId: contact.accountId };
  }
  if (distinct.size > 1) throw new Error(`Ambiguous WhatsUp recipient "${identity}". Use a unique account ID.`);
  throw new Error(`Unknown WhatsUp recipient "${identity}". Use an existing full character name or WhatsUp username.`);
}

/** Resolve both endpoints before a phone message can create any side effect. */
export function resolveWhatsUpMessageParticipants(
  characters: StorybookCharacter[],
  messages: MessageRecord[],
  message: { from: string; to: string },
) {
  return {
    from: resolveWhatsUpRecipient(characters, messages, message.from),
    to: resolveWhatsUpRecipient(characters, messages, message.to),
  };
}
