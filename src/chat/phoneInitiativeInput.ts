import { migratedProfileName } from '../characters/character';
import { relationshipApps, relationshipTarget } from '../characters/relationships';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import { datingAccountId, resolveDatingAccount } from './datingAccounts';
import { canSendMatchMeMessage, matchMeDecision, matchMeState } from './matchMe';

const compact = (text: string) => text.replace(/\s+/g, ' ').trim();

const appLabels = { whatsup: 'WhatsUp', fotogram: 'Fotogram', onlyfriends: 'OnlyFriends', matchme: 'MatchMe' };

/** Compact author context for the selected player's phone initiative; never include media. */
export function phoneInitiativeCharacterContext(
  selected: StorybookCharacter | undefined,
  characters: StorybookCharacter[],
  messages: MessageRecord[],
) {
  if (!selected) return '';
  const owner = relationshipTarget(characters, selected.sourceId) ?? selected;
  const state = matchMeState(characters, messages);
  const ownerAccount = owner.apps?.matchme?.enabled
    ? resolveDatingAccount(datingAccountId(owner), state.accounts) : undefined;
  const accounts = (character: StorybookCharacter, connected = relationshipApps as readonly string[]) =>
    relationshipApps.flatMap((app) => {
      const account = character.apps?.[app];
      if (!connected.includes(app) || !account?.enabled) return [];
      const name = compact(migratedProfileName(account, character.name));
      return [app === 'whatsup' ? 'WhatsUp' : `${appLabels[app]}: ${name}`];
    });
  const contacts = (owner.relationships ?? []).flatMap((relation) => {
    const target = relationshipTarget(characters, relation.characterId);
    if (!target) return [];
    const connected = relationshipApps.filter((app) => relation.apps[app] && owner.apps?.[app]?.enabled &&
      (app !== 'matchme' || (ownerAccount && target && canSendMatchMeMessage(ownerAccount.id, datingAccountId(target), state))));
    return [`- ${compact(target.name)}${compact(relation.description) ? ` — ${compact(relation.description)}` : ''}${accounts(target, connected).length ? ` | ${accounts(target, connected).join('; ')}` : ''}`];
  });
  const likes = ownerAccount ? state.accounts.flatMap((target) => {
    const decision = matchMeDecision(ownerAccount.decisions, target.id, state);
    if ((decision !== 'like' && decision !== 'superlike') || target.id === ownerAccount.id) return [];
    return [`${compact(target.name)} (${decision}${canSendMatchMeMessage(ownerAccount.id, target.id, state) ? ', matched' : ', unmatched'})`];
  }) : [];
  const matches = ownerAccount ? state.accounts.filter((target) =>
    canSendMatchMeMessage(ownerAccount.id, target.id, state))
    .filter((target) => {
      const decision = matchMeDecision(ownerAccount.decisions, target.id, state);
      return decision !== 'like' && decision !== 'superlike';
    }).map((target) => compact(target.name)) : [];
  return [
    `Character: ${compact(owner.name)}`,
    ...(compact(owner.profile.description) ? [`Description: ${compact(owner.profile.description)}`] : []),
    ...(contacts.length ? ['Contacts & relationships:', ...contacts] : []),
    ...(likes.length ? [`MatchMe likes given: ${likes.join('; ')}`] : []),
    ...(matches.length ? [`MatchMe other active matches: ${matches.join('; ')}`] : []),
    'Private context; contacts are directed. Ask character information for missing details.',
  ].join('\n');
}
