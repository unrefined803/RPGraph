import { Fragment } from 'react';
import { datingAccounts, resolveDatingAccount } from '../chat/datingAccounts';
import type { MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { CharacterName } from './CharacterName';
import './matchMeActivity.css';

/** Compact presentation only; each activity retains its own canonical turn. */
export function MatchMeActivityCard({ messages, characters, characterColors, fontSize }: {
  messages: MessageRecord[];
  characters: StorybookCharacter[];
  fontSize: number;
  characterColors: ReadonlyMap<string, string>;
}) {
  const accounts = datingAccounts(characters, messages);
  const name = (id: string) => resolveDatingAccount(id, accounts)?.name ?? id;
  const renderName = (id: string) => {
    const account = resolveDatingAccount(id, accounts);
    const character = characters.find((entry) => entry.id === account?.characterId);
    // Unassigned accounts inherit the static MatchMe accent. Canonical tokens
    // let CharacterName animate playable characters and keep interacted NPCs flat.
    const color = character ? characterColors.get(character.name) : undefined;
    return <CharacterName color={color}>{name(id)}</CharacterName>;
  };
  const activities = messages.filter((message) => message.matchMeAction);
  return <article className="matchme-activity" style={{ fontSize }} aria-label="MatchMe activity">
    <strong className="matchme-activity-brand">MatchMe <span aria-hidden="true">♥</span></strong>
    <div className="matchme-activity-items">
      {activities.map((message, index) => {
        const action = message.matchMeAction!;
        const repeatSender = activities[index - 1]?.matchMeAction?.from === action.from;
        const superlike = action.decision === 'superlike';
        const matched = message.matchMeMatch?.status === 'active';
        const description = `${name(action.from)} ${superlike ? 'superliked' : 'liked'} ${name(action.to)}${matched ? ' — it’s a match!' : ''}`;
        return <Fragment key={message.id}>
          {index > 0 && <span className="matchme-activity-plus" aria-hidden="true">+</span>}
          <span className={`matchme-activity-entry${matched ? ' matched' : ''}`} aria-label={description} title={description}>
            {!repeatSender && <>
              <strong>{renderName(action.from)}</strong>
              <span className="matchme-activity-arrow" aria-hidden="true">→</span>
            </>}
            <strong>{renderName(action.to)}</strong>
            <span className={`matchme-activity-symbol${superlike ? ' superlike' : ''}`} aria-hidden="true">{superlike ? '★' : '♥'}</span>
            {matched && <span className="matchme-activity-match"><span aria-hidden="true">♥♥</span> Match</span>}
          </span>
        </Fragment>;
      })}
    </div>
  </article>;
}
