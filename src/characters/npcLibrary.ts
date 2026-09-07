import type { Character } from './character';
import { validateCharacterContainer } from './character';
import type { CharacterRegistryEntry } from './registry';

export type NpcLibraryTier = 'bundled' | 'user';
export type NpcLibraryDiagnostic = {
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
export type NpcLibrarySnapshot = {
  roots: { bundled: string; user: string };
  entries: NpcLibraryEntry[];
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
  const diagnostics: NpcLibraryDiagnostic[] = [];
  for (const [sourcePath, load] of Object.entries(bundledSourceLoaders).sort(([left], [right]) => left.localeCompare(right))) {
    const fileName = sourcePath.split('/').pop() ?? sourcePath;
    try {
      const contents = await load();
      const container = JSON.parse(contents) as { character?: Character };
      validateCharacterContainer(container);
      entries.push({ tier: 'bundled', source: `bundled:${fileName}`, fileName,
        character: container.character! });
    } catch (error) {
      diagnostics.push({ tier: 'bundled', fileName, code: 'invalid-container',
        message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    roots: { bundled: 'Bundled application resources', user: 'Unavailable in browser mode' },
    entries,
    diagnostics,
    skipped: 0,
    browserLimited: true,
  };
}
