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

const bundledSources = import.meta.glob('../../resources/npc-characters/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** Browser development can read bundled assets, but never arbitrary user-data files. */
export function browserNpcLibrarySnapshot(): NpcLibrarySnapshot {
  const entries: NpcLibraryEntry[] = [];
  const diagnostics: NpcLibraryDiagnostic[] = [];
  for (const [sourcePath, contents] of Object.entries(bundledSources)) {
    const fileName = sourcePath.split('/').pop() ?? sourcePath;
    try {
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
