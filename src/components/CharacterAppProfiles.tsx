import { useState } from 'react';
import { socialFromCharacterApps, type Character } from '../characters/character';
import { validateCharacterAccountDirectory, withCharacterAppProfile } from '../characters/profiles';
import { defaultRpStorybookCharacterBanking, defaultRpStorybookCharacterPhoneSettings } from '../nodes/rp-storybook/model';
import { SocialProfileEditor } from './phone-social/SocialProfileEditor';
import { PhoneDatingScreen } from './phone-dating/PhoneDatingScreen';

/** Account management shared by both Storybook editors, using the phone profile forms. */
export function CharacterAppProfiles({ character, characters, locked, onChange }: {
  character: Character; characters: Character[]; locked: boolean; onChange: (character: Character) => boolean;
}) {
  const socialApps = ['fotogram', 'onlyfriends', 'matchme'] as const;
  type SocialApp = (typeof socialApps)[number];
  const [selectedApp, setSelectedApp] = useState<SocialApp | null>(null);
  const [error, setError] = useState('');
  const apps = character.apps ?? {};

  function appName(app: SocialApp) {
    return app === 'fotogram' ? 'Photogram' : app === 'onlyfriends' ? 'OnlyFriends' : 'MatchMe';
  }

  function accountCreated(app: SocialApp) {
    return Boolean(apps[app]?.enabled);
  }

  function save(next: Character) {
    try {
      validateCharacterAccountDirectory(characters.map((entry) => entry.id === next.id ? next : entry));
      if (!onChange(next)) return false;
      setError(''); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
  }
  return <div className="character-voice-card character-social-accounts-card">
    <div className="character-voice-card-header">
      <span className="character-voice-card-title">SOCIAL ACCOUNTS</span>
      <span className="character-social-account-note">Choose an account to view its profile.</span>
    </div>
    <div className="character-account-tabs" role="tablist" aria-label="Social accounts">
      {socialApps.map((app) => {
        const created = accountCreated(app);
        return <button
          key={app}
          type="button"
          role="tab"
          aria-selected={selectedApp === app}
          aria-controls={selectedApp === app ? `character-account-panel-${app}` : undefined}
          className={selectedApp === app ? 'active' : ''}
          onClick={() => { setSelectedApp(app); setError(''); }}
        >
          <span className="character-account-tab-name">{appName(app)}</span>
          <span className={`character-account-status${created ? ' created' : ''}`} aria-hidden="true">{created ? '✓' : '×'}</span>
          <span className={`character-account-status-label${created ? ' created' : ''}`}>
            {created ? 'Account created' : 'Account not created'}
          </span>
        </button>;
      })}
    </div>
    {!selectedApp && <div className="character-account-overview">
      <strong>Phone app accounts</strong>
      <p>Select an app above to open its profile setup.</p>
    </div>}
    {error && <p role="alert">{error}</p>}
    {(selectedApp === 'fotogram' || selectedApp === 'onlyfriends') && <div id={`character-account-panel-${selectedApp}`} role="tabpanel">
      <SocialProfileEditor key={selectedApp} app={selectedApp}
        account={apps[selectedApp]} accountId={`character:${character.id}:${selectedApp}`} name={character.name}
        images={character.images} profileImage={character.profileImage} locked={locked} onCancel={() => setSelectedApp(null)}
        onSave={(account) => { const saved = save(withCharacterAppProfile(character, selectedApp, account)); if (saved) setSelectedApp(null); return saved; }} />
    </div>}
    {selectedApp === 'matchme' && <div id="character-account-panel-matchme" role="tabpanel"><PhoneDatingScreen key="profile" profileOnly
      owner={{ id: character.id, sourceId: character.id, storybookNodeId: '', kind: 'character', name: character.name,
        label: character.name, profile: character, apps, social: socialFromCharacterApps(apps),
        phoneSettings: character.phoneSettings ?? defaultRpStorybookCharacterPhoneSettings(), banking: character.banking ?? defaultRpStorybookCharacterBanking() }}
      characters={[]} history={[]} unread={{}} onMarkSeen={() => {}} isRunning={false}
      onSendMessage={async () => false} emojiOptions={[]} recentlyUsedEmojis={[]}
      images={character.images} onImportImage={async () => undefined} onBack={() => setSelectedApp(null)}
      onSave={(_, profile) => {
        const current = apps.matchme;
        const username = profile.username ?? current?.username ?? '';
        if (locked && current?.username && username !== current.username) { setError('The MatchMe username is locked.'); return false; }
        if (username && !/^[a-zA-Z0-9._-]+$/.test(username)) { setError('Choose a valid MatchMe username.'); return false; }
        const saved = save(withCharacterAppProfile(character, 'matchme', {
          accountId: current?.accountId ?? `character:${character.id}:matchme`,
          ...current, enabled: true, username, displayName: profile.name, bio: profile.bio, profile,
        }));
        if (saved) setSelectedApp(null);
        return saved;
      }} /></div>}
  </div>;
}
