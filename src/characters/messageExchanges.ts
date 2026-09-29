import { resolveMessageAccount, type AccountLinkApp } from '../chat/accountLinks';
import type { MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';

export type MessageContactGrant = { ownerId: string; targetId: string; app: Exclude<AccountLinkApp, 'banking'> };

/** Both directions must resolve to the same two accounts in the same messenger. */
export function reciprocalMessageContacts(messages: MessageRecord[], characters: StorybookCharacter[]): MessageContactGrant[] {
  const grants = new Map<string, MessageContactGrant>();
  const directions = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'output') continue;
    const dm = message.socialDirectMessage;
    if ((!dm && !message.phoneMessage) || dm?.demo) continue;
    const app = dm?.app ?? 'whatsup';
    const sender = resolveMessageAccount(app, dm?.fromAccountId ?? message.phoneFromAccountId,
      dm?.fromHandle || dm?.from || message.phoneFrom, characters);
    const recipient = resolveMessageAccount(app, dm?.toAccountId ?? message.phoneToAccountId,
      dm?.toHandle || dm?.to || message.phoneTo, characters);
    if (!sender || !recipient || sender.characterId === recipient.characterId) continue;
    directions.add(JSON.stringify([app, sender.accountId, recipient.accountId]));
    if (!directions.has(JSON.stringify([app, recipient.accountId, sender.accountId]))) continue;
    for (const [ownerId, targetId] of [[sender.characterId, recipient.characterId], [recipient.characterId, sender.characterId]]) {
      grants.set(JSON.stringify([app, ownerId, targetId]), { ownerId, targetId, app });
    }
  }
  return [...grants.values()];
}

/** Public activity, shared accounts, matches and one-way DMs never confer this status. */
export function interactedNpcIds(messages: MessageRecord[], characters: StorybookCharacter[]): string[] {
  const players = new Set(characters.filter((character) => character.playerSelectable !== false).map((character) => character.sourceId));
  const npcs = new Set(characters.filter((character) => character.playerSelectable === false).map((character) => character.sourceId));
  return [...new Set(reciprocalMessageContacts(messages, characters)
    .filter((grant) => players.has(grant.ownerId) && npcs.has(grant.targetId))
    .map((grant) => grant.targetId))];
}
