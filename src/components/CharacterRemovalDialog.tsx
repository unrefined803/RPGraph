import { useState } from 'react';
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
  async function apply(mode: 'delete' | 'npc' | 'save', overwrite = false) {
    setBusy(true); setStatus('');
    try { await onRemove(mode, overwrite); onClose(); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="dialog-backdrop character-removal-backdrop" onClick={() => { if (!busy) onClose(); }}>
    <section className="character-removal-dialog" role="dialog" aria-modal="true" aria-labelledby="character-removal-title"
      onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }}>
      <h2 id="character-removal-title">Remove {info.name}</h2>
      <p>Choose what happens to this character when it leaves the playable cast.</p>
      {info.reasons.length > 0 && <p>{info.reasons.join(' ')} Deleting is unavailable; keeping an NPC preserves its history and accounts.</p>}
      <div className="character-removal-options">
        <button type="button" className="character-delete-button" disabled={busy || blocked || info.reasons.length > 0}
          onClick={() => void apply('delete')}>Delete from Storybook</button>
        <p>Deletes this Storybook character and its unused RP copy. Library files are unchanged.</p>
        <button type="button" disabled={busy || blocked} onClick={() => void apply('npc')}>
          {info.matchesLibrary ? 'Make NPC' : 'Keep as temporary NPC'}
        </button>
        <p>{info.matchesLibrary ? 'The character matches its library file. Its RP revision remains available as an NPC.'
          : 'Keep this version in the current RP and Storybook, including future saves. No library file is written.'}</p>
        {!info.matchesLibrary && <>
          <button type="button" disabled={busy || blocked || !canSave} onClick={() => void apply('save', !!info.localFileName)}>
            {info.localFileName ? 'Overwrite local NPC and remove' : 'Save to NPC Folder and remove'}
          </button>
          <p>{info.localFileName ? `Updates ${info.localFileName} with this version. The RP copy is also retained.`
            : 'Save this version as an NPC character container. The RP copy is also retained.'}</p>
        </>}
      </div>
      {blocked && <p>Wait for the current generation to finish.</p>}
      {status && <p role="alert">{status}</p>}
      <button type="button" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
    </section>
  </div>;
}
