import { Fragment } from 'react';
import { migratedProfileName, type CharacterApps } from '../characters/character';

/** Compact marker for a Fotogram or OnlyFriends account that hides the real name. */
export function PrivacyModeBadge() {
  return <span className="privacy-mode-badge" aria-label="Privacy Mode on">P</span>;
}

type PhoneAppMark = { app: 'whatsup' | 'fotogram' | 'onlyfriends' | 'matchme'; label: string; enabled: boolean;
  second: boolean; privacy: boolean; tooltip: string };

/** Account marks shared by the Storybook character cards; the tooltip spells out what each mark means. */
export function characterPhoneAppMarks(apps: CharacterApps | undefined, characterName: string): PhoneAppMark[] {
  const alias = apps?.whatsup?.alias?.name.trim();
  const social = (app: 'fotogram' | 'onlyfriends' | 'matchme', label: string, enabled: boolean): PhoneAppMark => {
    const account = apps?.[app];
    const name = account ? migratedProfileName(account, characterName) : '';
    const supportsPrivacy = app !== 'matchme';
    const privacy = supportsPrivacy && enabled && account?.privacyMode === true;
    return { app, label, enabled, second: false, privacy, tooltip: !enabled ? `${label}: no account`
      : `${label}: ${name ? `@${name}` : characterName}${supportsPrivacy ? ` · Privacy Mode ${privacy ? 'on (real name hidden)' : 'off'}` : ''}` };
  };
  return [
    { app: 'whatsup', label: 'WhatsUp', enabled: true, second: !!alias, privacy: false,
      tooltip: `WhatsUp: ${characterName}${alias ? ` · Second account: ${alias}` : ' · No second account'}` },
    social('fotogram', 'Fotogram', true),
    social('onlyfriends', 'OnlyFriends', !!apps?.onlyfriends?.enabled),
    social('matchme', 'MatchMe', !!apps?.matchme?.enabled),
  ];
}

export function CharacterPhoneAppMarks({ apps, characterName }: { apps?: CharacterApps; characterName: string }) {
  return <>
    {characterPhoneAppMarks(apps, characterName).map((mark) => <Fragment key={mark.app}>
      <span className="character-phone-summary-separator" aria-hidden="true">·</span>
      <span className="character-phone-app" title={mark.tooltip}>
        {mark.label}{' '}
        <span className={`character-phone-account-status${mark.enabled ? ' created' : ''}`}
          aria-label={!mark.enabled ? 'Account not created' : mark.second ? 'Main and second account' : 'Account created'}>
          {mark.enabled ? mark.second ? '✓✓' : '✓' : '×'}
        </span>
        {mark.privacy && <PrivacyModeBadge />}
      </span>
    </Fragment>)}
  </>;
}
