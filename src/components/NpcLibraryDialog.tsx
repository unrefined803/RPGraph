import { useMemo } from 'react';
import { buildCharacterRegistry } from '../characters/registry';
import type { NpcLibrarySnapshot } from '../characters/npcLibrary';

type NpcLibraryDialogProps = {
  snapshot: NpcLibrarySnapshot | null;
  loading: boolean;
  status: string;
  onReload: () => void;
  onOpenFolder: () => void;
  onClose: () => void;
};

export function NpcLibraryDialog({ snapshot, loading, status, onReload, onOpenFolder, onClose }: NpcLibraryDialogProps) {
  const registry = useMemo(() => buildCharacterRegistry(snapshot?.entries ?? []), [snapshot]);
  const diagnostics = [
    ...(snapshot?.diagnostics ?? []).map((item) => ({ key: `${item.tier}:${item.fileName}:${item.code}`,
      title: item.fileName || `${item.tier} directory`, detail: item.message })),
    ...registry.diagnostics.map((item, index) => ({ key: `registry:${item.code}:${item.identity}:${index}`,
      title: item.code, detail: item.message })),
  ];

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section className="npc-library-dialog" role="dialog" aria-modal="true" aria-labelledby="npc-library-title"
        onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2 id="npc-library-title">NPC Library</h2>
            <p>Global Character Container V2 discovery</p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close NPC library">×</button>
        </header>
        <div className="npc-library-actions">
          <button type="button" className="primary" onClick={onReload} disabled={loading}>
            {loading ? 'Reloading…' : 'Reload Library'}
          </button>
          <button type="button" onClick={onOpenFolder} disabled={snapshot?.browserLimited}>Open NPC Folder</button>
        </div>
        <dl className="npc-library-roots">
          <div><dt>Built-in</dt><dd>{snapshot?.roots.bundled ?? 'Loading…'}</dd></div>
          <div><dt>User</dt><dd>{snapshot?.roots.user ?? 'Loading…'}</dd></div>
        </dl>
        <div className="npc-library-summary">
          <span>{registry.characters.length} effective NPC{registry.characters.length === 1 ? '' : 's'}</span>
          <span>{snapshot?.entries.length ?? 0} valid file{snapshot?.entries.length === 1 ? '' : 's'}</span>
          <span>{snapshot?.skipped ?? 0} ignored file{snapshot?.skipped === 1 ? '' : 's'}</span>
          <span className={diagnostics.length ? 'warning' : ''}>{diagnostics.length} diagnostic{diagnostics.length === 1 ? '' : 's'}</span>
        </div>
        {status && <p className="npc-library-status" role="status">{status}</p>}
        <div className="npc-library-content">
          <section>
            <h3>Discovered containers</h3>
            {snapshot?.entries.length ? (
              <ul>{snapshot.entries.map((entry) => (
                <li key={`${entry.tier}:${entry.fileName}`}>
                  <strong>{entry.character.name}</strong>
                  <span>{entry.tier} · {entry.fileName} · {entry.character.id}</span>
                </li>
              ))}</ul>
            ) : <p className="npc-library-empty">No valid NPC containers found.</p>}
          </section>
          <section>
            <h3>Diagnostics</h3>
            {diagnostics.length ? (
              <ul>{diagnostics.map((item) => (
                <li key={item.key}><strong>{item.title}</strong><span>{item.detail}</span></li>
              ))}</ul>
            ) : <p className="npc-library-empty">No library problems detected.</p>}
          </section>
        </div>
      </section>
    </div>
  );
}
