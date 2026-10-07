import { useRef, useState } from 'react';
import { CharacterAvatar } from './CharacterAvatar';
import { ProfilePickDialog } from './ProfilePickDialog';
import type { WhatsUpAlias } from '../characters/character';
import { detectAvatarFaceCrop } from '../characters/faceCrop';
import { portraitDataUrl } from '../characters/portrait';
import { copyTextToClipboard } from '../utils/clipboard';
import type { RpStorybookCharacterImage } from '../nodes/rp-storybook/model';
import './characterAppProfiles.css';

type GalleryImage = { id: string; name?: string; dataUrl: string; width?: number; height?: number };
type FaceStatus = 'idle' | 'detecting' | 'found' | 'full' | 'manual';

function aliasAvatar(alias: WhatsUpAlias | undefined, images: GalleryImage[]) {
  const image = images.find((entry) => entry.id === alias?.avatarImageId);
  return image ? portraitDataUrl(image, alias?.avatarCrop) : undefined;
}

/** One account row: picture, name and the link others use to add it. */
function AccountCard({ label, name, avatarDataUrl, note, action }: {
  label: string; name: string; avatarDataUrl?: string; note: string; action?: { label: string; onClick: () => void };
}) {
  const [copied, setCopied] = useState(false);
  const link = `@whatsup:${name}`;
  return <section className="whatsup-account-card">
    <CharacterAvatar className="whatsup-account-avatar" name={name} profileImageDataUrl={avatarDataUrl} fallback={name.slice(0, 1).toUpperCase()} />
    <div className="whatsup-account-details">
      <span className="social-profile-eyebrow">{label}</span>
      <strong>{name}</strong>
      <button type="button" className="whatsup-account-link" title="Copy this link" onClick={() => {
        void copyTextToClipboard(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }, () => {});
      }}>{copied ? 'Copied' : 'Click to copy'}: <span>{link}</span></button>
      <small>{note}</small>
    </div>
    {action && <button type="button" className="whatsup-account-action" onClick={action.onClick}>{action.label}</button>}
  </section>;
}

/**
 * WhatsUp accounts of one character. The main account always uses the real
 * name and portrait; the optional second account is another name and picture
 * for the same inbox. Images remain gallery references.
 */
export function WhatsUpAccounts({ realName, mainAvatarDataUrl, alias, images, removable = true, onSave, onClose }: {
  realName: string;
  mainAvatarDataUrl?: string;
  alias?: WhatsUpAlias;
  images: GalleryImage[];
  /** False once the second account has chats: it can then be renamed, which renames its chats, but not removed. */
  removable?: boolean;
  /** True when saved; otherwise false or the reason shown in the form. */
  onSave: (alias: WhatsUpAlias | undefined) => boolean | string;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <SecondAccountEditor realName={realName} alias={alias} images={images} removable={removable} onBack={() => setEditing(false)}
      onSave={(next) => { const saved = onSave(next); if (saved === true) setEditing(false); return saved; }} />;
  }
  return <div className="social-profile-editor whatsup-accounts">
    <header className="whatsup-accounts-header">
      <div><span className="social-profile-eyebrow">WhatsUp</span><h2>Your accounts</h2></div>
      <button type="button" className="whatsup-account-action" onClick={onClose}>Done</button>
    </header>
    <AccountCard label="Main account" name={realName} avatarDataUrl={mainAvatarDataUrl}
      note="Uses your name and portrait. Share this link with people who know you." />
    {alias
      ? <AccountCard label="Second account" name={alias.name} avatarDataUrl={aliasAvatar(alias, images)}
        note="Its own name and picture. Messages arrive in the same inbox."
        action={{ label: 'Edit', onClick: () => setEditing(true) }} />
      : <section className="whatsup-account-card whatsup-account-create">
        <div className="whatsup-account-details">
          <strong>Create a second account for work or privacy</strong>
          <small>Give it its own name and picture and share its link instead of your main one. All messages still arrive here in one inbox.</small>
        </div>
        <button type="button" className="whatsup-account-action primary" onClick={() => setEditing(true)}>Create</button>
      </section>}
  </div>;
}

function SecondAccountEditor({ realName, alias, images, removable, onSave, onBack }: {
  realName: string; alias?: WhatsUpAlias; images: GalleryImage[]; removable: boolean;
  onSave: (alias: WhatsUpAlias | undefined) => boolean | string; onBack: () => void;
}) {
  const [draft, setDraft] = useState<WhatsUpAlias>(() => alias ?? { name: '' });
  const [faceStatus, setFaceStatus] = useState<FaceStatus>(alias?.avatarImageId ? (alias.avatarCrop ? 'found' : 'full') : 'idle');
  const [manualCrop, setManualCrop] = useState(false);
  const [error, setError] = useState('');
  const detection = useRef(0);
  const image = images.find((entry) => entry.id === draft.avatarImageId);
  const name = draft.name.trim();

  async function choosePhoto(imageId: string | undefined) {
    const run = ++detection.current;
    const selected = images.find((entry) => entry.id === imageId);
    setDraft((current) => ({ name: current.name, ...(selected ? { avatarImageId: selected.id } : {}) }));
    if (!selected) { setFaceStatus('idle'); return; }
    setFaceStatus('detecting');
    const crop = await detectAvatarFaceCrop(selected);
    // A later selection supersedes this result.
    if (run !== detection.current) return;
    setDraft((current) => current.avatarImageId === selected.id
      ? { name: current.name, avatarImageId: selected.id, ...(crop ? { avatarCrop: crop } : {}) } : current);
    setFaceStatus(crop ? 'found' : 'full');
  }

  return <form className="social-profile-editor whatsup-accounts" onSubmit={(event) => {
    event.preventDefault();
    if (!name) { setError('Add a name for the second account.'); return; }
    if (name.toLowerCase() === realName.trim().toLowerCase()) { setError('Choose a name that differs from your main account.'); return; }
    if (faceStatus === 'detecting') { setError('Still looking for a face. Try again in a moment.'); return; }
    const saved = onSave({ ...draft, name });
    if (saved !== true) setError(typeof saved === 'string' ? saved : 'Could not save the second account.');
  }}>
    <header className="whatsup-accounts-header">
      <div><span className="social-profile-eyebrow">WhatsUp / Second account</span><h2>{alias ? 'Edit account' : 'New account'}</h2></div>
      <button type="button" className="whatsup-account-action" onClick={onBack}>← Accounts</button>
    </header>
    <section className="whatsup-account-card">
      <CharacterAvatar className="whatsup-account-avatar" name={name || 'Second account'} profileImageDataUrl={aliasAvatar(draft, images)} fallback={(name || '?').slice(0, 1).toUpperCase()} />
      <label className="whatsup-account-details">Name
        <input required maxLength={60} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="For example your work name" />
      </label>
    </section>
    <section className="whatsup-account-picture">
      <div className="whatsup-account-picture-heading">
        <strong>Profile picture</strong>
        {faceStatus !== 'idle' && <span className={`whatsup-alias-face-status ${faceStatus}`} role="status">
          {faceStatus === 'detecting' ? 'Looking for a face…'
            : faceStatus === 'found' ? '✓ Face detected'
              : faceStatus === 'manual' ? '✓ Set manually'
                : 'No face found, showing the whole picture'}
        </span>}
        {image && faceStatus !== 'detecting' && <button type="button" className="whatsup-account-manual" onClick={() => setManualCrop(true)}>Set manually</button>}
      </div>
      <div className="whatsup-account-photos">
        <button type="button" className="social-profile-photo" aria-pressed={!draft.avatarImageId} onClick={() => { void choosePhoto(undefined); }}>
          <span className="social-profile-photo-fallback">{(name || '?').slice(0, 1).toUpperCase()}</span><span>None</span>
        </button>
        {images.map((entry) => <button key={entry.id} type="button" className="social-profile-photo" aria-pressed={draft.avatarImageId === entry.id} onClick={() => { void choosePhoto(entry.id); }}>
          <img src={entry.dataUrl} alt={entry.name || 'Album photo'} loading="lazy" /><span>{entry.name || 'Album photo'}</span>
        </button>)}
      </div>
    </section>
    {error && <p className="social-profile-error" role="alert">{error}</p>}
    <footer className="social-profile-actions">
      {alias && removable && <button type="button" className="whatsup-alias-remove" onClick={() => {
        const removed = onSave(undefined);
        if (removed !== true) setError(typeof removed === 'string' ? removed : 'Could not remove the second account.');
      }}>Remove</button>}
      {alias && !removable && <small className="whatsup-alias-remove-note">This account has chats and can only be renamed. Its chats follow the new name.</small>}
      <button type="button" onClick={onBack}>Cancel</button>
      <button className="social-profile-save" type="submit">Save <span aria-hidden="true">→</span></button>
    </footer>
    {manualCrop && image && <ProfilePickDialog
      characterName={name || 'Second account'}
      image={{ description: '', mimeType: 'image/jpeg', size: 0, ...image, name: image.name ?? '' } as RpStorybookCharacterImage}
      currentProfileImage={draft.avatarCrop ? { imageId: image.id, dataUrl: image.dataUrl, crop: draft.avatarCrop } : undefined}
      onClose={() => setManualCrop(false)}
      onApply={(profileImage) => {
        setDraft({ name: draft.name, avatarImageId: image.id, ...(profileImage.crop ? { avatarCrop: profileImage.crop } : {}) });
        setFaceStatus(profileImage.crop ? 'manual' : 'full');
        setManualCrop(false);
      }} />}
  </form>;
}
