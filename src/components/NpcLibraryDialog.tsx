import { characterUsageReasons } from '../characters/lifecycle';
import type { NpcParticipantSnapshots } from '../characters/npcParticipants';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { EffectiveCharacterRegistry } from '../characters/registry';
import type { NpcLibraryEntry, NpcLibrarySnapshot } from '../characters/npcLibrary';
import { characterLibrarySummary, characterProvenanceStages, effectiveLibraryEntry, visibleLibraryEntries } from '../characters/librarySummary';
import { appAvatarDataUrl } from '../characters/portrait';
import type { Character } from '../characters/character';
import { characterContentEqual } from '../characters/contentComparison';

type NpcLibraryDialogProps = {
  snapshot: NpcLibrarySnapshot | null;
  participants?: NpcParticipantSnapshots;
  activity?: unknown;
  busy?: boolean;
  dismissOnEscape?: boolean;
  onRemove?: (characterId: string, nodeId: string) => void;
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
  onOpenStorybook: (nodeId: string) => void;
};

const appLabels = { fotogram: 'Fotogram', whatsup: 'WhatsUp', onlyfriends: 'OnlyFriends', matchme: 'MatchMe' } as const;

type DisplayEntry = {
  character: Character;
  libraryEntry?: NpcLibraryEntry & { editedBuiltIn: boolean };
  inStorybook: boolean;
  storybookEdited: boolean;
  localEdited: boolean;
  playable: boolean;
  nodeId?: string;
  retained: boolean;
  hasActivity: boolean;
  snapshotEdited: boolean;
  diagnosticOnly?: boolean;
};

function CharacterRow({ display, issues, canImport, onImport, onEdit, onRemove }: {
  display: DisplayEntry; issues: string[]; canImport: boolean; onImport: () => void; onEdit: () => void; onRemove?: () => void;
}) {
  const { character, libraryEntry, inStorybook, storybookEdited, localEdited } = display;
  const { apps, used, unused, initials } = useMemo(() => characterLibrarySummary(character), [character]);
  const portrait = useMemo(() => appAvatarDataUrl(character,
    character.images.find((image) => image.id === character.profileImage?.imageId)), [character]);
  const [failedPortrait, setFailedPortrait] = useState('');
  const provenance = characterProvenanceStages({
    tier: libraryEntry?.tier, editedBuiltIn: libraryEntry?.editedBuiltIn,
    localEdited, inStorybook, storybookEdited, retained: display.retained, snapshotEdited: display.snapshotEdited,
  });
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
          <span className="npc-library-provenance" aria-label={`Active character source: ${provenance.map((stage) => stage.label).join(' then ')}`}>
            {provenance.map((stage, index) => <span className="npc-library-provenance-segment" key={stage.label}>
              {index > 0 && <span className="npc-library-provenance-arrow" aria-hidden="true">›</span>}
              <span className={`npc-library-provenance-stage${index === provenance.length - 1 ? ' active' : ''}`}
                title={`${stage.title}${index === provenance.length - 1 ? '. This is the active version.' : ''}`}>
                {stage.label}
              </span>
            </span>)}
          </span>
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
        <button type="button" onClick={onEdit}>{inStorybook ? 'Open Storybook' : display.retained ? 'View RP Character' : 'View / Edit Character'}</button>
        {display.playable ? (
          <button
            type="button"
            className="npc-library-playable-button"
            disabled={!onRemove}
            title={onRemove ? 'Click to remove from playable cast' : 'This character is playable.'}
            onClick={onRemove}
          >
            <span className="label-playable">Playable</span>
            <span className="label-remove">Remove</span>
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={!canImport}
            onClick={onImport}
          >
            Make Playable
          </button>
        )}
      </div>
      {issues.length > 0 && <details className="npc-library-row-issues">
        <summary aria-label={`Diagnostics for ${character.name}: ${issues.length}`} title="Show character diagnostics">ⓘ</summary>
        <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
      </details>}
    </li>
  );
}

export function NpcLibraryDialog({ snapshot, participants = {}, activity, busy = false, dismissOnEscape = true, onRemove, activeRegistry, loading, status, storybookNodeId, onAddToStorybook, onReload, onOpenFolder, onClose, onCreateCharacter, onEditCharacter, onOpenStorybook }: NpcLibraryDialogProps) {
  const [importStatus, setImportStatus] = useState('');
  const targetNodeId = storybookNodeId ?? '';
  const libraryEntries = useMemo(() => visibleLibraryEntries(snapshot?.entries ?? []), [snapshot]);
  const entries = useMemo(() => {
    const bundledById = new Map((snapshot?.entries ?? []).filter((entry) => entry.tier === 'bundled')
      .map((entry) => [entry.character.id, entry.character]));
    const display: DisplayEntry[] = activeRegistry.characters.map((effective) => {
      const character = effective.character;
      const libraryEntry = effectiveLibraryEntry(libraryEntries, character.id);
      const bundled = bundledById.get(character.id);
      const saved = participants[character.id]?.character;
      const inStorybook = effective.provenance.tier === 'storybook';
      const source = saved ?? libraryEntry?.character;
      return { character, libraryEntry, inStorybook,
        playable: effective.playerSelectable, nodeId: inStorybook ? effective.provenance.source : undefined,
        retained: !!saved || effective.provenance.tier === 'snapshot',
        hasActivity: characterUsageReasons(character, effective.aliases, activity).length > 0,
        snapshotEdited: !!saved && !!libraryEntry && !characterContentEqual(saved, libraryEntry.character),
        storybookEdited: inStorybook && !!source && !characterContentEqual(character, source),
        localEdited: !!libraryEntry?.editedBuiltIn && !!bundled && !characterContentEqual(libraryEntry.character, bundled),
      };
    });
    // Keep quarantined files accessible for diagnostics.
    display.push(...libraryEntries.filter((entry) => !display.some((row) => row.libraryEntry === entry)).map((entry) => ({
      character: entry.character, libraryEntry: entry, inStorybook: false, storybookEdited: false,
      localEdited: !!entry.editedBuiltIn && !!bundledById.get(entry.character.id) &&
        !characterContentEqual(entry.character, bundledById.get(entry.character.id)!),
      playable: false, retained: false, hasActivity: false, snapshotEdited: false, diagnosticOnly: true,
    })));
    return display.sort((left, right) => {
      const leftGroup = left.playable ? 0 : left.hasActivity ? 1 : 2;
      const rightGroup = right.playable ? 0 : right.hasActivity ? 1 : 2;
      return leftGroup - rightGroup || left.character.name.localeCompare(right.character.name);
    });
  }, [activeRegistry, libraryEntries, snapshot, participants, activity]);

  const sections = useMemo(() => {
    const playable = entries.filter((entry) => entry.playable);
    const interacted = entries.filter((entry) => !entry.playable && entry.hasActivity);
    const available = entries.filter((entry) => !entry.playable && !entry.hasActivity);

    return [
      { id: 'playable', title: 'Playable Characters', entries: playable },
      { id: 'interacted', title: 'Interacted Characters', entries: interacted },
      { id: 'available', title: 'Available Characters', entries: available },
    ].filter((section) => section.entries.length > 0);
  }, [entries]);

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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && dismissOnEscape) {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dismissOnEscape, onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section className="npc-library-dialog" role="dialog" aria-modal="true" aria-labelledby="npc-library-title"
        onClick={(event) => event.stopPropagation()}>
        <main className="npc-library-main" aria-label="Library characters" aria-busy={loading}>
          {entries.length ? (
            <ul className="npc-library-list">
              {sections.map((section) => (
                <Fragment key={section.id}>
                  <li className="npc-library-section-divider" role="separator" aria-label={section.title}>
                    <span>{section.title}</span>
                  </li>
                  {section.entries.map((display) => {
                    const entry = display.libraryEntry;
                    const effective = activeRegistry.characters.find((item) => item.character.id === display.character.id);
                    const available = effective && !effective.playerSelectable && !display.diagnosticOnly;
                    const target = display.nodeId ?? targetNodeId;
                    return (
                      <CharacterRow
                        key={`${display.diagnosticOnly ? entry?.source : 'effective'}:${display.character.id}`}
                        display={display}
                        onEdit={() => display.inStorybook ? onOpenStorybook(display.nodeId!) : onEditCharacter(display.retained
                          ? { character: display.character, tier: 'user', source: `snapshot:${display.character.id}`, fileName: `${display.character.name}.json` }
                          : entry!)}
                        issues={entry ? issuesFor(entry) : []}
                        onRemove={onRemove && display.nodeId && !busy ? () => onRemove(display.character.id, display.nodeId!) : undefined}
                        canImport={!!available && !loading && !busy && !!target}
                        onImport={() => {
                          try {
                            onAddToStorybook(display.character.id, target);
                            setImportStatus(`Added ${display.character.name} as a playable Storybook character. Save the Storybook or RP to keep this change.`);
                          } catch (error) {
                            setImportStatus(`Character import failed: ${error instanceof Error ? error.message : String(error)}`);
                          }
                        }}
                      />
                    );
                  })}
                </Fragment>
              ))}
            </ul>
          ) : (
            <p className="npc-library-empty">{loading ? 'Loading characters…' : 'No characters found. Add character files to your NPC folder and reload the library.'}</p>
          )}
        </main>
        <aside className="npc-library-sidebar">
          <header><div><h2 id="npc-library-title">NPC Library</h2><p>Your character collection</p></div>
            <button type="button" className="close-button" onClick={onClose} autoFocus>Close</button></header>
          <div className="npc-library-actions">
            <button type="button" className="primary" onClick={onCreateCharacter}>Create Character</button>
            <button type="button" className="primary" onClick={onReload} disabled={loading}>{loading ? 'Reloading…' : 'Reload Library'}</button>
            <button type="button" onClick={onOpenFolder} disabled={!snapshot || snapshot.browserLimited}>Open NPC Folder</button>
          </div>
          <section className="npc-library-statistics"><h3>Statistics</h3>
            <dl>{[
              ['Characters', entries.length],
              ['Playable', entries.filter((entry) => entry.playable).length],
              ['Interacted', entries.filter((entry) => !entry.playable && entry.hasActivity).length],
              ['RP copies', entries.filter((entry) => entry.retained).length],
              ['Built-in', libraryEntries.filter((entry) => entry.tier === 'bundled' || entry.editedBuiltIn).length],
              ['Library files', libraryEntries.filter((entry) => entry.tier === 'user').length],
              ['Ignored files', snapshot?.skipped ?? 0],
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
