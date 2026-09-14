import { useMemo, useState } from 'react';
import type { EffectiveCharacterRegistry } from '../characters/registry';
import type { NpcLibraryEntry, NpcLibrarySnapshot } from '../characters/npcLibrary';
import { characterLibrarySummary, visibleLibraryEntries } from '../characters/librarySummary';
import { appAvatarDataUrl } from '../characters/portrait';
import { characterPayload, type Character } from '../characters/character';

type NpcLibraryDialogProps = {
  snapshot: NpcLibrarySnapshot | null;
  activeRegistry: EffectiveCharacterRegistry;
  loading: boolean;
  status: string;
  storybookNodeId?: string;
  onAddToStorybook: (characterId: string, nodeId: string) => void;
  onReload: () => void;
  onOpenFolder: () => void;
  onClose: () => void;
  onCreateCharacter: () => void;
  onEditCharacter: (entry: NpcLibraryEntry) => void;
  onOpenStorybook: () => void;
};

const appLabels = { fotogram: 'Fotogram', whatsup: 'WhatsUp', onlyfriends: 'OnlyFriends', matchme: 'MatchMe' } as const;

type DisplayEntry = {
  character: Character;
  libraryEntry?: NpcLibraryEntry & { editedBuiltIn: boolean };
  inStorybook: boolean;
  storybookEdited: boolean;
};

function comparableCharacter(character: Character) {
  return characterPayload({ ...structuredClone(character), playable: false }, true);
}

function CharacterRow({ display, issues, canImport, onImport, onEdit }: {
  display: DisplayEntry; issues: string[]; canImport: boolean; onImport: () => void; onEdit: () => void;
}) {
  const { character, libraryEntry, inStorybook, storybookEdited } = display;
  const { apps, used, unused, initials } = useMemo(() => characterLibrarySummary(character), [character]);
  const portrait = useMemo(() => appAvatarDataUrl(character,
    character.images.find((image) => image.id === character.profileImage?.imageId)), [character]);
  const [failedPortrait, setFailedPortrait] = useState('');
  return (
    <li className="npc-library-row">
      <div className="npc-library-avatar" aria-hidden="true">
        {portrait && portrait !== failedPortrait
          ? <img src={portrait} alt="" loading="lazy" onError={() => setFailedPortrait(portrait)} />
          : initials}
      </div>
      <div className="npc-library-identity">
        <h3>{character.name}</h3>
        <div className="npc-library-badges">
          <span className={`npc-library-origin ${libraryEntry?.tier ?? 'storybook'}`}>
            {!libraryEntry ? 'Storybook only' : libraryEntry.editedBuiltIn ? 'Built-in → Local edit' : libraryEntry.tier === 'bundled' ? 'Built-in' : 'User-created'}
          </span>
          {inStorybook && <span className="npc-library-origin in-storybook">Playable</span>}
          {storybookEdited && <span className="npc-library-origin storybook-edited">Storybook edited</span>}
        </div>
      </div>
      <div className="npc-library-accounts">
        {Object.entries(appLabels).map(([key, label]) => {
          const app = key as keyof typeof appLabels;
          const account = apps[app];
          const posts = account?.initialPosts?.length ?? 0;
          const photos = app === 'matchme' ? apps.matchme?.profile?.photoIds.length ?? 0 : 0;
          const enabled = account?.enabled;
          const populated = enabled && (posts > 0 || photos > 0);
          const activity = !account ? 'No account' : !enabled ? 'Disabled' : app === 'matchme'
            ? (photos ? `${photos} profile photo${photos === 1 ? '' : 's'}` : 'No profile photos')
            : app === 'whatsup' ? 'Account ready' : posts ? `${posts} post${posts === 1 ? '' : 's'}` : 'No posts';
          return <div key={app} className={`npc-library-account ${enabled ? populated || app === 'whatsup' ? 'published' : 'ready' : 'inactive'}`}>
            <span className="npc-library-account-mark" aria-hidden="true">{enabled ? populated ? '✓✓' : '✓' : '—'}</span>
            <div><strong>{label}</strong><span className="npc-library-handle">{account?.username ? `@${account.username.replace(/^@/, '')}` : '—'}</span>
              <small>{activity}</small></div>
          </div>;
        })}
      </div>
      <div className="npc-library-images" title="Distinct images in this character file. Used includes the portrait, enabled app avatars, initial posts and MatchMe profile photos. Unused images are available for future sharing or posts.">
        <span>Images</span><strong>{used} <small>used</small></strong><strong>{unused} <small>unused</small></strong>
      </div>
      <div className="npc-library-row-actions">
        <button type="button" onClick={onEdit}>{inStorybook ? 'Open Storybook' : 'View / Edit Character'}</button>
        <button type="button" className="primary" disabled={!canImport} onClick={onImport}>{inStorybook ? 'Playable' : 'Add as Playable'}</button>
      </div>
      {issues.length > 0 && <details className="npc-library-row-issues">
        <summary aria-label={`Diagnostics for ${character.name}: ${issues.length}`} title="Show character diagnostics">ⓘ</summary>
        <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
      </details>}
    </li>
  );
}

export function NpcLibraryDialog({ snapshot, activeRegistry, loading, status, storybookNodeId, onAddToStorybook, onReload, onOpenFolder, onClose, onCreateCharacter, onEditCharacter, onOpenStorybook }: NpcLibraryDialogProps) {
  const [importStatus, setImportStatus] = useState('');
  const targetNodeId = storybookNodeId ?? '';
  const libraryEntries = useMemo(() => visibleLibraryEntries(snapshot?.entries ?? []), [snapshot]);
  const entries = useMemo(() => {
    const byId = new Map(libraryEntries.map((entry) => [entry.character.id, entry]));
    const storybookCharacters = activeRegistry.characters.filter((entry) => entry.provenance.tier === 'storybook');
    const storybookIds = new Set(storybookCharacters.map((entry) => entry.character.id));
    const display: DisplayEntry[] = storybookCharacters.map((entry) => {
      const libraryEntry = byId.get(entry.character.id);
      return {
        character: entry.character,
        libraryEntry,
        inStorybook: true,
        storybookEdited: !!libraryEntry && JSON.stringify(comparableCharacter(entry.character)) !==
          JSON.stringify(comparableCharacter(libraryEntry.character)),
      };
    });
    display.push(...libraryEntries.filter((entry) => !storybookIds.has(entry.character.id)).map((entry) => ({
      character: entry.character, libraryEntry: entry, inStorybook: false, storybookEdited: false,
    })));
    return display.sort((left, right) => Number(right.inStorybook) - Number(left.inStorybook) ||
      left.character.name.localeCompare(right.character.name));
  }, [activeRegistry, libraryEntries]);
  const issuesFor = (entry: NpcLibraryEntry) => [
    ...(snapshot?.diagnostics ?? []).filter((item) => item.tier === entry.tier && item.fileName === entry.fileName).map((item) => item.message),
    ...activeRegistry.diagnostics.filter((item) => item.characterIds.includes(entry.character.id)).map((item) => item.message),
  ];
  const generalIssues = [
    ...(snapshot?.diagnostics ?? []).filter((item) => !libraryEntries.some((entry) => entry.tier === item.tier && entry.fileName === item.fileName))
      .map((item) => `${item.fileName || `${item.tier} directory`}: ${item.message}`),
    ...activeRegistry.diagnostics.filter((item) => !entries.some((entry) => item.characterIds.includes(entry.character.id))).map((item) => item.message),
  ];
  const diagnosticCount = (snapshot?.diagnostics.length ?? 0) + activeRegistry.diagnostics.length;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section className="npc-library-dialog" role="dialog" aria-modal="true" aria-labelledby="npc-library-title"
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
        <main className="npc-library-main" aria-label="Library characters" aria-busy={loading}>
          {entries.length ? <ul className="npc-library-list">{entries.map((display) => {
            const entry = display.libraryEntry;
            const effective = activeRegistry.characters.find((item) => item.character.id === display.character.id);
            const available = entry && effective && effective.provenance.tier !== 'storybook' &&
              (effective.provenance.tier === 'snapshot' || (effective.provenance.tier === entry.tier && effective.provenance.source === entry.source));
            return <CharacterRow key={`${display.inStorybook ? 'storybook' : entry?.tier}:${display.character.id}`} display={display}
              onEdit={() => display.inStorybook ? onOpenStorybook() : entry && onEditCharacter(entry)} issues={entry ? issuesFor(entry) : []}
              canImport={!!available && !loading && !!targetNodeId} onImport={() => {
                try {
                  onAddToStorybook(display.character.id, targetNodeId);
                  setImportStatus(`Added ${display.character.name} as a playable Storybook character. Save the Storybook or RP to keep this change.`);
                } catch (error) {
                  setImportStatus(`Character import failed: ${error instanceof Error ? error.message : String(error)}`);
                }
              }} />;
          })}</ul> : <p className="npc-library-empty">{loading ? 'Loading characters…' : 'No characters found. Add character files to your NPC folder and reload the library.'}</p>}
        </main>
        <aside className="npc-library-sidebar">
          <header><div><h2 id="npc-library-title">NPC Library</h2><p>Your character collection</p></div>
            <button type="button" className="dialog-close" onClick={onClose} aria-label="Close NPC library" autoFocus>×</button></header>
          <div className="npc-library-actions">
            <button type="button" className="primary" onClick={onCreateCharacter}>Create Character</button>
            <button type="button" className="primary" onClick={onReload} disabled={loading}>{loading ? 'Reloading…' : 'Reload Library'}</button>
            <button type="button" onClick={onOpenFolder} disabled={!snapshot || snapshot.browserLimited}>Open NPC Folder</button>
          </div>
          <section className="npc-library-statistics"><h3>Statistics</h3>
            <dl>{[
              ['Characters', entries.length], ['Playable', entries.filter((entry) => entry.inStorybook).length],
              ['Built-in', libraryEntries.filter((entry) => entry.tier === 'bundled' || entry.editedBuiltIn).length],
              ['User-created', libraryEntries.filter((entry) => entry.tier === 'user' && !entry.editedBuiltIn).length], ['Ignored files', snapshot?.skipped ?? 0],
            ].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>
            <span className={diagnosticCount ? 'npc-library-warning' : 'npc-library-muted'}>{diagnosticCount} diagnostic{diagnosticCount === 1 ? '' : 's'}{diagnosticCount > 0 ? ' · Check the info icons' : ''}</span>
            {generalIssues.length > 0 && <details className="npc-library-general-issues"><summary>ⓘ File and library issues ({generalIssues.length})</summary>
              <ul>{generalIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
          </section>
          {!targetNodeId && <p>Add a Storybook node to import characters.</p>}
          {(status || importStatus) && <div className="npc-library-status" role="status">{status && <p>{status}</p>}{importStatus && <p>{importStatus}</p>}</div>}
          <details className="npc-library-roots"><summary>Library folders</summary><dl>
            <div><dt>Built-in</dt><dd>{snapshot?.roots.bundled ?? 'Loading…'}</dd></div>
            <div><dt>User</dt><dd>{snapshot?.roots.user ?? 'Loading…'}</dd></div>
          </dl></details>
        </aside>
      </section>
    </div>
  );
}
