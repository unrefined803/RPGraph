import type { Character } from './character';
import { validateCharacterContainer } from './character';
import type { CharacterRegistryEntry } from './registry';
import type { SavedFileSummary } from '../types';

type NpcLibraryTier = 'bundled' | 'user';
type NpcLibraryDiagnostic = {
  tier: NpcLibraryTier;
  fileName: string;
  code: 'directory-error' | 'invalid-json' | 'invalid-container' | 'unsupported-version';
  message: string;
};
export type NpcLibraryEntry = CharacterRegistryEntry & {
  tier: NpcLibraryTier;
  fileName: string;
  character: Character;
};
export type NpcLibraryFileSummary = Omit<SavedFileSummary, 'storage'> & {
  tier: NpcLibraryTier;
  storage?: 'npc-characters';
  unlocked?: boolean;
};
export type NpcLibrarySnapshot = {
  roots: { bundled: string; user: string };
  entries: NpcLibraryEntry[];
  files: NpcLibraryFileSummary[];
  diagnostics: NpcLibraryDiagnostic[];
  skipped: number;
  browserLimited?: boolean;
};

// Keep base64-heavy fallback containers out of the renderer entry chunk. Desktop
// discovery uses IPC, so these modules are loaded only by the browser fallback.
const bundledSourceLoaders = import.meta.glob('../../resources/npc-characters/*.json', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/** Browser development can read bundled assets, but never arbitrary user-data files. */
export async function browserNpcLibrarySnapshot(): Promise<NpcLibrarySnapshot> {
  const entries: NpcLibraryEntry[] = [];
  const files: NpcLibraryFileSummary[] = [];
  const diagnostics: NpcLibraryDiagnostic[] = [];
  for (const [sourcePath, load] of Object.entries(bundledSourceLoaders).sort(([left], [right]) => left.localeCompare(right))) {
    const fileName = sourcePath.split('/').pop() ?? sourcePath;
    try {
      const contents = await load();
      const container = JSON.parse(contents) as { version?: string; character?: Character };
      validateCharacterContainer(container);
      entries.push({ tier: 'bundled', source: `bundled:${fileName}`, fileName,
        character: container.character! });
      files.push({ tier: 'bundled', fileName, name: container.character!.name, updatedAt: '',
        type: 'character-card', protection: 'plain', formatVersion: String(container.version ?? ''), compatible: true });
    } catch (error) {
      diagnostics.push({ tier: 'bundled', fileName, code: 'invalid-container',
        message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    roots: { bundled: 'Bundled application resources', user: 'Unavailable in browser mode' },
    entries,
    files,
    diagnostics,
    skipped: 0,
    browserLimited: true,
  };
}
