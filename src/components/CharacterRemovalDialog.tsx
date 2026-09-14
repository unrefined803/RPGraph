import { useEffect, useState } from 'react';
import type { CharacterRemovalInfo } from '../characters/lifecycle';

export function CharacterRemovalDialog({ info, blocked, canSave, onRemove, onClose }: {
  info: CharacterRemovalInfo & { localFileName?: string };
  blocked: boolean;
  canSave: boolean;
  onRemove: (mode: 'delete' | 'npc' | 'save', overwrite?: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  async function apply(mode: 'delete' | 'npc' | 'save', overwrite = false) {
    setBusy(true); setStatus('');
    try { await onRemove(mode, overwrite); onClose(); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const deleteBlocked = busy || blocked || info.reasons.length > 0;

  return (
    <div className="dialog-backdrop character-removal-backdrop" onClick={() => { if (!busy) onClose(); }}>
      <section className="character-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="character-removal-title"
        onClick={(event) => event.stopPropagation()}>
        <header className="character-removal-header">
          <div>
            <h2 id="character-removal-title">Remove {info.name}</h2>
            <p className="character-removal-subtitle">Choose what happens to this character when it leaves the playable cast.</p>
          </div>
        </header>

        <div className="character-removal-options">
          <div className={`character-removal-option-card${deleteBlocked ? ' disabled' : ''}`}>
            <div className="character-removal-option-details">
              <div className="character-removal-option-title">Delete from Storybook</div>
              <p>Deletes this Storybook character and its unused RP copy. Library files are unchanged.</p>
              {info.reasons.length > 0 && (
                <p className="character-removal-reason">
                  {info.reasons.join(' ')} Deleting is unavailable; keeping an NPC preserves its history and accounts.
                </p>
              )}
            </div>
            <button type="button" className="character-delete-button" disabled={deleteBlocked}
              onClick={() => void apply('delete')}>Delete</button>
          </div>

          <div className="character-removal-option-card">
            <div className="character-removal-option-details">
              <div className="character-removal-option-title">
                {info.matchesLibrary ? 'Make NPC' : 'Keep as temporary NPC'}
              </div>
              <p>
                {info.matchesLibrary
                  ? 'The character matches its library file. Its RP revision remains available as an NPC.'
                  : 'Keep this version in the current RP and Storybook, including future saves. No library file is written.'}
              </p>
            </div>
            <button type="button" className="character-removal-action-button" disabled={busy || blocked}
              onClick={() => void apply('npc')}>
              {info.matchesLibrary ? 'Make NPC' : 'Keep NPC'}
            </button>
          </div>

          {!info.matchesLibrary && (
            <div className="character-removal-option-card">
              <div className="character-removal-option-details">
                <div className="character-removal-option-title">
                  {info.localFileName ? 'Overwrite local NPC and remove' : 'Save to NPC Folder and remove'}
                </div>
                <p>
                  {info.localFileName
                    ? `Updates ${info.localFileName} with this version. The RP copy is also retained.`
                    : 'Save this version as an NPC character container. The RP copy is also retained.'}
                </p>
              </div>
              <button type="button" className="character-removal-action-button primary" disabled={busy || blocked || !canSave}
                onClick={() => void apply('save', !!info.localFileName)}>
                {info.localFileName ? 'Overwrite' : 'Save & Remove'}
              </button>
            </div>
          )}
        </div>

        {blocked && <p className="character-removal-warning">Wait for the current generation to finish.</p>}
        {status && <p className="character-removal-error" role="alert">{status}</p>}

        <footer className="character-removal-footer">
          <button type="button" className="character-removal-cancel" autoFocus disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}
