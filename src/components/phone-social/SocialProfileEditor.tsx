import { migratedProfileName } from '../../characters/character';
import { useState } from 'react';
import { portraitDataUrl, socialAvatarDataUrl } from '../../characters/portrait';
import type { RpStorybookCharacterProfileImage } from '../../nodes/rp-storybook/model';
import type { CharacterAppAccount } from '../../characters/character';
import { profileIdentityError } from '../../characters/profiles';
import '../characterAppProfiles.css';

/** Shared by Character Setup and the phone apps. Images remain gallery references. */
export function SocialProfileEditor({ account, accountId, name, images, profileImage, locked, app = 'fotogram', onSave, onCancel }: {
  account?: CharacterAppAccount; accountId: string; name: string;
  app?: 'fotogram' | 'onlyfriends';
  profileImage?: RpStorybookCharacterProfileImage;
  images: Array<{ id: string; name: string; dataUrl: string; width?: number; height?: number }>;
  locked: boolean; onSave: (account: CharacterAppAccount) => boolean; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CharacterAppAccount>(() => ({
    ...account, accountId: account?.accountId ?? accountId, enabled: true,
    profileName: account ? migratedProfileName(account, name) : name, bio: account?.bio ?? '',
  }));
  const portraitImage = images.find((image) => image.id === profileImage?.imageId);
  const portrait = portraitImage ? portraitDataUrl(portraitImage, profileImage?.crop) : profileImage?.dataUrl;
  const avatar = socialAvatarDataUrl({ profileImage: profileImage && { ...profileImage, dataUrl: portrait } },
    images.find((image) => image.id === draft.avatarImageId));
  const [error, setError] = useState('');
  const creating = !account?.enabled && app === 'onlyfriends';
  const appName = app === 'fotogram' ? 'Photogram' : 'OnlyFriends';
  const isPrivate = draft.privacyMode === true;
  const [showPrivacyInfo, setShowPrivacyInfo] = useState(false);
  return <form className={`social-profile-editor social-profile-editor--${app}`} onSubmit={(event) => {
    event.preventDefault();
    const next = { ...draft, profileName: (draft.profileName ?? '').trim() };
    if (!next.profileName) { setError('Add a profile name for your profile.'); return; }
    const reason = profileIdentityError(account, next, locked);
    if (reason) { setError(reason); return; }
    if (!onSave(next)) setError('Could not save the profile. Please check the account identity and try again.');
  }}>
    <header className="social-profile-heading">
      <span className="social-profile-eyebrow">{appName} / {creating ? 'Your debut' : 'Your profile'}</span>
      <h2>{creating ? 'Make yourself at home.' : 'A little more you.'}</h2>
      <p>{creating ? 'Set the scene for your first post.' : 'Give your profile a fresh look.'} Choose a photo, a profile name, and a few words about yourself.</p>
    </header>
    <section className="social-profile-preview" aria-label="Live profile preview">
      <div className="social-profile-avatar">{!isPrivate && avatar ? <img src={avatar} alt="Profile preview" /> : <span>{(draft.profileName || name).slice(0, 1).toUpperCase()}</span>}</div>
      <div><span className="social-profile-eyebrow">Profile preview</span><h3>{isPrivate ? draft.profileName : name}</h3><p>@{(draft.profileName ?? '').trim().replace(/^@/, '')}</p><p>{draft.bio || 'Your story starts here.'}</p></div>
    </section>
    <section className="social-profile-section">
      <h3><span aria-hidden="true">01</span> The essentials</h3>
      <div className="social-profile-identity-row">
        <label>Profile name<input required maxLength={60} value={draft.profileName} onChange={(event) => setDraft({ ...draft, profileName: event.target.value })} placeholder="How you appear on your profile" /></label>
        <div className="social-profile-visibility-wrap">
          <label className="social-profile-visibility">
            <input type="checkbox" checked={isPrivate} onChange={(event) => setDraft({ ...draft, privacyMode: event.target.checked })} />
            <span>Privacy mode</span>
          </label>
          <div
            className={`social-profile-info-trigger${showPrivacyInfo ? ' active' : ''}`}
            tabIndex={0}
            role="button"
            aria-label="Privacy mode details"
            title="Privacy mode details"
            onClick={() => setShowPrivacyInfo((v) => !v)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setShowPrivacyInfo((v) => !v); } }}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" />
              <line x1="8" y1="7.2" x2="8" y2="11.5" />
              <circle cx="8" cy="4.5" r="0.6" fill="currentColor" stroke="none" />
            </svg>
            <div className="social-profile-info-bubble" role="tooltip">
              When enabled, your character name and profile photo are hidden across this app, using only your profile name.
            </div>
          </div>
        </div>
      </div>
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
