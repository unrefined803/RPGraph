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
              <p>Deletes this character from the Storybook and current RP. NPC Library files stay unchanged.</p>
              {info.reasons.length > 0 && (
                <p className="character-removal-reason">
                  Cannot delete: {info.reasons.join(' ')} Keep as an NPC to preserve these references.
                </p>
              )}
            </div>
            <button type="button" className="character-delete-button" disabled={deleteBlocked}
              onClick={() => void apply('delete')}>Delete</button>
          </div>

          <div className="character-removal-option-card">
            <div className="character-removal-option-details">
              <div className="character-removal-option-title">
                {info.matchesLibrary ? 'Make NPC' : 'Keep as NPC in this RP'}
              </div>
              <p>
                {info.matchesLibrary
                  ? 'Removes player control and keeps this version as an NPC in RP and Storybook saves.'
                  : 'Removes player control and keeps this NPC in RP and Storybook saves, without saving to the NPC Library.'}
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
