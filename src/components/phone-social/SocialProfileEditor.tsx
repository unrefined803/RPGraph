import { useState } from 'react';
import { appAvatarDataUrl } from '../../characters/portrait';
import type { RpStorybookCharacterProfileImage } from '../../nodes/rp-storybook/model';
import type { CharacterAppAccount } from '../../characters/character';
import { profileIdentityError } from '../../characters/profiles';
import '../characterAppProfiles.css';

/** Shared by Character Setup and the phone apps. Images remain gallery references. */
export function SocialProfileEditor({ account, accountId, name, images, profileImage, locked, app = 'fotogram', onSave, onCancel }: {
  account?: CharacterAppAccount; accountId: string; name: string;
  app?: 'fotogram' | 'onlyfriends';
  profileImage?: RpStorybookCharacterProfileImage;
  images: Array<{ id: string; name: string; dataUrl: string }>;
  locked: boolean; onSave: (account: CharacterAppAccount) => boolean; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CharacterAppAccount>(() => ({
    ...account, accountId: account?.accountId ?? accountId, enabled: true,
    username: account?.username || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'character'}.${accountId.replace(/[^a-zA-Z0-9]/g, '')}`,
    displayName: account?.displayName || name, bio: account?.bio ?? '',
  }));
  const avatar = appAvatarDataUrl({ profileImage }, images.find((image) => image.id === draft.avatarImageId));
  const portrait = appAvatarDataUrl({ profileImage });
  const [error, setError] = useState('');
  const creating = !account?.enabled && app === 'onlyfriends';
  const appName = app === 'fotogram' ? 'Photogram' : 'OnlyFriends';
  return <form className={`social-profile-editor social-profile-editor--${app}`} onSubmit={(event) => {
    event.preventDefault();
    const next = { ...draft, displayName: draft.displayName.trim() };
    if (!next.displayName) { setError('Add a display name for your profile.'); return; }
    const reason = profileIdentityError(account, next, locked);
    if (reason) { setError(reason); return; }
    if (!onSave(next)) setError('Could not save the profile. Please check the account identity and try again.');
  }}>
    <header className="social-profile-heading">
      <span className="social-profile-eyebrow">{appName} / {creating ? 'Your debut' : 'Your profile'}</span>
      <h2>{creating ? 'Make yourself at home.' : 'A little more you.'}</h2>
      <p>{creating ? 'Set the scene for your first post.' : 'Give your profile a fresh look.'} Choose a photo, a display name, and a few words about yourself.</p>
    </header>
    <section className="social-profile-preview" aria-label="Live profile preview">
      <div className="social-profile-avatar">{avatar ? <img src={avatar} alt="Profile preview" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}</div>
      <div><span className="social-profile-eyebrow">Profile preview</span><h3>{draft.displayName.trim() || name}</h3><p>{draft.bio || 'Your story starts here.'}</p></div>
    </section>
    <section className="social-profile-section">
      <h3><span aria-hidden="true">01</span> The essentials</h3>
      <label>Display name<input required maxLength={60} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} placeholder="How you appear on your profile" /></label>
      <label>Bio<textarea rows={4} maxLength={500} value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} placeholder="A few words, a little personality…" /><small className="social-profile-count">{draft.bio.length} / 500</small></label>
    </section>
    <section className="social-profile-section">
      <h3><span aria-hidden="true">02</span> Your profile photo</h3>
      <p>Choose your character portrait or a photo from your album.</p>
      <div className="social-profile-photos">
        <button type="button" className="social-profile-photo" aria-pressed={!draft.avatarImageId} onClick={() => setDraft({ ...draft, avatarImageId: undefined })}>
          {portrait ? <img src={portrait} alt="Character portrait" /> : <span className="social-profile-photo-fallback">{name.slice(0, 1).toUpperCase()}</span>}<span>Portrait</span>
        </button>
        {images.map((image) => <button key={image.id} type="button" className="social-profile-photo" aria-pressed={draft.avatarImageId === image.id} onClick={() => setDraft({ ...draft, avatarImageId: image.id })}>
          <img src={image.dataUrl} alt={image.name || 'Album photo'} loading="lazy" /><span>{image.name || 'Album photo'}</span>
        </button>)}
      </div>
    </section>
    {error && <p className="social-profile-error" role="alert">{error}</p>}
    <footer className="social-profile-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="social-profile-save" type="submit">{creating ? 'Create profile' : 'Save changes'} <span aria-hidden="true">→</span></button></footer>
  </form>;
}
