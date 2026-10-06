import { resolveMessageAccount, type AccountLinkApp, type AccountLinkTarget } from '../chat/accountLinks';
import { whatsUpAccountId } from './messageIdentity';
import type { MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';

/** True for a WhatsUp identity that is its owner's second name rather than the real account. */
export function reachedByWhatsUpAlias(target: Pick<AccountLinkTarget, 'app' | 'accountId' | 'character'>) {
  return target.app === 'whatsup' && target.accountId !== whatsUpAccountId(target.character);
}

export type MessageContactGrant = { ownerId: string; targetId: string; app: Exclude<AccountLinkApp, 'banking'> };

/** Both directions must resolve to the same two accounts in the same messenger. */
export function reciprocalMessageContacts(messages: MessageRecord[], characters: StorybookCharacter[]): MessageContactGrant[] {
  return reciprocalExchanges(messages, characters).filter((grant) => !grant.viaAlias)
    .map(({ ownerId, targetId, app }) => ({ ownerId, targetId, app }));
}

/** Every two-way exchange, marking targets that were reached under a second WhatsUp name. */
function reciprocalExchanges(messages: MessageRecord[], characters: StorybookCharacter[]) {
  const grants = new Map<string, MessageContactGrant & { viaAlias: boolean }>();
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
    for (const [owner, target] of [[sender, recipient], [recipient, sender]]) {
      // Someone reached under a second WhatsUp name does not become a contact under the real name.
      const key = JSON.stringify([app, owner.characterId, target.characterId]);
      const viaAlias = reachedByWhatsUpAlias(target) && grants.get(key)?.viaAlias !== false;
      grants.set(key, { ownerId: owner.characterId, targetId: target.characterId, app, viaAlias });
    }
  }
  return [...grants.values()];
}

/**
 * Public activity, shared accounts, matches and one-way DMs never confer this status.
 * An exchange under a second WhatsUp name counts: it is the same character.
 */
export function interactedNpcIds(messages: MessageRecord[], characters: StorybookCharacter[]): string[] {
  const players = new Set(characters.filter((character) => character.playerSelectable !== false).map((character) => character.sourceId));
  const npcs = new Set(characters.filter((character) => character.playerSelectable === false).map((character) => character.sourceId));
  return [...new Set(reciprocalExchanges(messages, characters)
    .filter((grant) => players.has(grant.ownerId) && npcs.has(grant.targetId))
    .map((grant) => grant.targetId))];
}
