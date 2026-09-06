import '../characterAppProfiles.css';
import { useState } from 'react';
import type { CharacterAppAccount } from '../../characters/character';
import { profileIdentityError } from '../../characters/profiles';

/** Shared by Character Setup and the phone apps. Images remain gallery references. */
export function SocialProfileEditor({ account, accountId, name, images, locked, onSave, onCancel }: {
  account?: CharacterAppAccount; accountId: string; name: string;
  images: Array<{ id: string; name: string; dataUrl: string }>;
  locked: boolean; onSave: (account: CharacterAppAccount) => boolean; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CharacterAppAccount>(account ?? { accountId, enabled: true, username: '', displayName: name, bio: '' });
  const [error, setError] = useState('');
  return <form className="character-voice-card character-app-profile-editor" onSubmit={(event) => {
    event.preventDefault();
    const reason = profileIdentityError(account, draft, locked);
    if (reason) { setError(reason); return; }
    if (!onSave(draft)) { setError('Could not save the profile. Check the username and story identity restrictions.'); return; }
    onCancel();
  }}>
    <label>Username<input required value={draft.username} disabled={locked && !!account?.username}
      onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label>
    <label>Display name<input required value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
    <label>Bio<textarea value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></label>
    <label>Profile image<select value={draft.avatarImageId ?? ''} onChange={(event) => setDraft({ ...draft, avatarImageId: event.target.value || undefined })}>
      <option value="">Character portrait</option>{images.map((image) => <option key={image.id} value={image.id}>{image.name || image.id}</option>)}
    </select></label>
    {draft.avatarImageId && <img width="80" src={images.find((image) => image.id === draft.avatarImageId)?.dataUrl} alt="Profile" />}
    {error && <p role="alert">{error}</p>}
    <button type="submit">Save profile</button><button type="button" onClick={onCancel}>Cancel</button>
  </form>;
}
