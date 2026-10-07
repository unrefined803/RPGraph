import { useState } from 'react';
import { CharacterAvatar } from './CharacterAvatar';
import { PortraitSelector } from './PortraitManager';
import { accountPortraitUrl, type PortraitOwner } from '../characters/portraits';
import type { PortraitId, WhatsUpAlias } from '../characters/character';
import { copyTextToClipboard } from '../utils/clipboard';
import './characterAppProfiles.css';

/** One account row: picture, name and the link others use to add it. */
function AccountCard({ label, name, avatarDataUrl, note, action }: {
  label: string; name: string; avatarDataUrl?: string; note: string; action?: { label: string; onClick: () => void };
}) {
  const [copied, setCopied] = useState(false);
  const link = `@whatsup:${name}`;
  return <section className="whatsup-account-card stacked">
    <div className="whatsup-account-head">
      <CharacterAvatar className="whatsup-account-avatar" name={name} profileImageDataUrl={avatarDataUrl} fallback={name.slice(0, 1).toUpperCase()} />
      <div className="whatsup-account-details">
        <span className="social-profile-eyebrow">{label}</span>
        <strong>{name}</strong>
      </div>
      {action && <button type="button" className="whatsup-account-action" onClick={action.onClick}>{action.label}</button>}
    </div>
    <div className="whatsup-account-body">
      <button type="button" className="whatsup-account-link" title="Copy this link" onClick={() => {
        void copyTextToClipboard(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }, () => {});
      }}><small>{copied ? 'Copied' : 'Click to copy'}</small><span>{link}</span></button>
      <small>{note}</small>
    </div>
  </section>;
}

/**
 * WhatsUp accounts of one character. The main account always uses the real
 * name; both accounts independently select a prepared portrait for the same inbox.
 */
export function WhatsUpAccounts({ realName, alias, owner, removable = true, onSave, onClose }: {
  realName: string;
  alias?: WhatsUpAlias;
  owner: PortraitOwner;
  /** False once the second account has chats: it can then be renamed, which renames its chats, but not removed. */
  removable?: boolean;
  /** True when saved; otherwise false or the reason shown in the form. */
  onSave: (alias: WhatsUpAlias | undefined, portraitId?: PortraitId) => boolean | string;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [pickingPortrait, setPickingPortrait] = useState(false);
  if (editing) {
    return <SecondAccountEditor realName={realName} alias={alias} owner={owner} removable={removable} onBack={() => setEditing(false)}
      onSave={(next) => { const saved = onSave(next); if (saved === true) setEditing(false); return saved; }} />;
  }
  return <div className="social-profile-editor whatsup-accounts">
    <header className="whatsup-accounts-header">
      <div><span className="social-profile-eyebrow">WhatsUp</span><h2>Your accounts</h2></div>
      <button type="button" className="whatsup-account-action" onClick={onClose}>Done</button>
    </header>
    <AccountCard label="Main account" name={realName} avatarDataUrl={accountPortraitUrl(owner, owner.apps?.whatsup)}
      note="Uses your real name and one of your prepared portraits."
      action={{ label: pickingPortrait ? 'Cancel' : 'Edit', onClick: () => setPickingPortrait(!pickingPortrait) }} />
    {/* Choosing a portrait saves it and folds the choices away again. */}
    {pickingPortrait && <PortraitSelector owner={owner} value={owner.apps?.whatsup?.portraitId} onChange={(id) => {
      if (id === 'none') return;
      const saved = onSave(alias, id);
      setError(saved === true ? '' : typeof saved === 'string' ? saved : 'Could not save the portrait selection.');
      if (saved === true) setPickingPortrait(false);
    }} />}
    {error && <p className="social-profile-error" role="alert">{error}</p>}
    {alias
      ? <AccountCard label="Second account" name={alias.name} avatarDataUrl={accountPortraitUrl(owner, alias)}
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

function SecondAccountEditor({ realName, alias, owner, removable, onSave, onBack }: {
  realName: string; alias?: WhatsUpAlias; owner: PortraitOwner; removable: boolean;
  onSave: (alias: WhatsUpAlias | undefined, portraitId?: PortraitId) => boolean | string; onBack: () => void;
}) {
  // A new second account starts without a picture.
  const [draft, setDraft] = useState<WhatsUpAlias>(() => alias ?? { name: '', portraitId: 'none' });
  const hasPicture = draft.portraitId !== 'none';
  const [error, setError] = useState('');
  const name = draft.name.trim();

  return <form className="social-profile-editor whatsup-accounts" onSubmit={(event) => {
    event.preventDefault();
    if (!name) { setError('Add a name for the second account.'); return; }
    if (name.toLowerCase() === realName.trim().toLowerCase()) { setError('Choose a name that differs from your main account.'); return; }
    const saved = onSave({ ...draft, name });
    if (saved !== true) setError(typeof saved === 'string' ? saved : 'Could not save the second account.');
  }}>
    <header className="whatsup-accounts-header">
      <div><span className="social-profile-eyebrow">WhatsUp / Second account</span><h2>{alias ? 'Edit account' : 'New account'}</h2></div>
      <button type="button" className="whatsup-account-action" onClick={onBack}>← Accounts</button>
    </header>
    <section className="whatsup-account-card">
      <CharacterAvatar className="whatsup-account-avatar" name={name || 'Second account'} profileImageDataUrl={accountPortraitUrl(owner, draft)} fallback={(name || '?').slice(0, 1).toUpperCase()} />
      <label className="whatsup-account-details">Name
        <input required maxLength={60} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="For example your work name" />
      </label>
    </section>
    <section className="whatsup-account-picture">
      <label className="social-profile-visibility">
        <input type="checkbox" checked={hasPicture} onChange={(event) => setDraft({ name: draft.name, portraitId: event.target.checked ? 'character' : 'none' })} />
        <span>Set profile picture</span>
      </label>
      {hasPicture && <PortraitSelector owner={owner} value={draft.portraitId} onChange={(portraitId) => setDraft({ name: draft.name, portraitId })} />}
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

  </form>;
}
