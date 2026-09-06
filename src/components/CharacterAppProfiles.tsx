import { useState } from 'react';
import { socialFromCharacterApps, type Character, type CharacterApps } from '../characters/character';
import { validateCharacterAccountDirectory, withCharacterAppProfile } from '../characters/profiles';
import { defaultRpStorybookCharacterBanking, defaultRpStorybookCharacterPhoneSettings } from '../nodes/rp-storybook/model';
import { SocialProfileEditor } from './phone-social/SocialProfileEditor';
import { PhoneDatingScreen } from './phone-dating/PhoneDatingScreen';

/** Account management shared by both Storybook editors, using the phone profile forms. */
export function CharacterAppProfiles({ character, characters, locked, onChange }: {
  character: Character; characters: Character[]; locked: boolean; onChange: (character: Character) => boolean;
}) {
  const [editingApp, setEditingApp] = useState<keyof CharacterApps | null>(null);
  const [error, setError] = useState('');
  const apps = character.apps ?? {};
  function save(next: Character) {
    try {
      validateCharacterAccountDirectory(characters.map((entry) => entry.id === next.id ? next : entry));
      if (!onChange(next)) return false;
      setError(''); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
  }
  return <div className="character-voice-card">
    <span className="character-voice-card-title">SOCIAL ACCOUNTS</span>
    <p>Fotogram is included. Other accounts can be created at any time.</p>
    {(['fotogram', 'onlyfriends', 'matchme'] as const).map((app) => <div key={app} className="character-account-row">
      <strong>{app === 'fotogram' ? 'Fotogram' : app === 'onlyfriends' ? 'OnlyFriends' : 'MatchMe'}</strong>
      <span>{apps[app]?.enabled ? ` — ${apps[app]?.displayName} ${apps[app]?.username ? `(@${apps[app]?.username})` : ''}` : ' — Not configured'}</span>
      <button type="button" onClick={() => setEditingApp(app)}>{apps[app]?.enabled ? 'Open / edit profile' : 'Set up profile'}</button>
    </div>)}
    {error && <p role="alert">{error}</p>}
    {editingApp && editingApp !== 'matchme' && <SocialProfileEditor key={editingApp}
      account={apps[editingApp]} accountId={`character:${character.id}:${editingApp}`} name={character.name}
      images={character.images} locked={locked} onCancel={() => setEditingApp(null)}
      onSave={(account) => save(withCharacterAppProfile(character, editingApp, account))} />}
    {editingApp === 'matchme' && <PhoneDatingScreen key="profile" profileOnly identityLocked={locked}
      owner={{ id: character.id, sourceId: character.id, storybookNodeId: '', kind: 'character', name: character.name,
        label: character.name, profile: character, apps, social: socialFromCharacterApps(apps),
        phoneSettings: character.phoneSettings ?? defaultRpStorybookCharacterPhoneSettings(), banking: character.banking ?? defaultRpStorybookCharacterBanking() }}
      characters={[]} history={[]} unread={{}} onMarkSeen={() => {}} isRunning={false}
      onSendMessage={async () => false} emojiOptions={[]} recentlyUsedEmojis={[]}
      images={character.images} onImportImage={async () => undefined} onBack={() => setEditingApp(null)}
      onSave={(_, profile) => {
        const current = apps.matchme;
        const username = profile.username ?? current?.username ?? '';
        if (locked && current?.username && username !== current.username) { setError('The MatchMe username is locked.'); return false; }
        if (username && !/^[a-zA-Z0-9._-]+$/.test(username)) { setError('Choose a valid MatchMe username.'); return false; }
        const saved = save(withCharacterAppProfile(character, 'matchme', {
          accountId: current?.accountId ?? `character:${character.id}:matchme`, enabled: true,
          ...current, username, displayName: profile.name, bio: profile.bio, profile,
        }));
        if (saved) setEditingApp(null);
        return saved;
      }} />}
  </div>;
}
