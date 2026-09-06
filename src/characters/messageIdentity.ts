import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';

const key = (value: string) => value.trim().replace(/^@/, '').replace(/\s+/g, ' ').toLowerCase();

/** WhatsUp recipients must be exact identities, never fuzzy name guesses. */
export function resolveWhatsUpRecipient(characters: StorybookCharacter[], messages: MessageRecord[], identity: string) {
  const matches = characters.filter((character) => character.id === identity || character.sourceId === identity ||
    character.apps?.whatsup?.accountId === identity || key(character.name) === key(identity) ||
    (!!character.apps?.whatsup?.enabled && !!character.apps.whatsup.username && key(character.apps.whatsup.username) === key(identity)));
  if (matches.length === 1) {
    const character = matches[0];
    return { name: character.name, characterId: character.sourceId,
      accountId: character.apps?.whatsup?.accountId ?? `character:${character.sourceId}:whatsup` };
  }
  if (matches.length > 1) throw new Error(`Ambiguous WhatsUp recipient "${identity}". Use a unique account ID.`);
  const known = new Set(messages.flatMap((message) => message.phoneMessage ? [message.phoneFrom ?? '', message.phoneTo ?? ''] : [])
    .filter((name) => !!name && key(name) === key(identity)));
  if (known.size === 1) { const name = [...known][0]; return { name, accountId: `whatsup:contact:${encodeURIComponent(name)}` }; }
  throw new Error(`Unknown WhatsUp recipient "${identity}". Use an existing full character name or WhatsUp username.`);
}
