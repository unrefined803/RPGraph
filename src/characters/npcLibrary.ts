import type { Character } from './character';
import { validateCharacterContainer } from './character';
import type { CharacterRegistryEntry } from './registry';
import type { SavedFileSummary, SocialPostRecord } from '../types';

type NpcLibraryTier = 'bundled' | 'saved-storybook' | 'user' | 'account';
export type NpcLibraryDiagnostic = {
  tier: NpcLibraryTier;
  fileName: string;
  code: 'directory-error' | 'invalid-json' | 'invalid-container' | 'unsupported-version'
    | 'unusable-source' | 'ambiguous-source' | 'missing-media';
  message: string;
};
/** Where an external Storybook character and its publications were taken from. */
export type NpcPublicationProvenance = {
  storybookFileName: string;
  storybookName: string;
  /** `save`: the Storybook's latest usable RP Save; `storybook`: the stored Storybook and its Opening History. */
  kind: 'save' | 'storybook';
  saveFileName?: string;
  saveName?: string;
  savedAt?: string;
  /** The current RP keeps this imported revision instead of the live source. */
  pinned?: boolean;
};
/** The one selected source of an external stored Storybook, read once per refresh. */
export type NpcPublicationSource = Omit<NpcPublicationProvenance, 'pinned'> & {
  key: string;
  /** Changes whenever the Storybook file or its selected source changes. */
  revision: string;
  posts: SocialPostRecord[];
  /** Images referenced by posts that no shipped character of this source owns. */
  gallery: Character['images'];
};
export type NpcLibraryEntry = CharacterRegistryEntry & {
  tier: NpcLibraryTier;
  fileName: string;
  character: Character;
  /** Key of the publication source providing this unprepared saved-Storybook character. */
  publicationSource?: string;
  /** Present once the character was prepared as an NPC copy with its own posts. */
  publication?: NpcPublicationProvenance;
};
export type NpcLibraryFileSummary = Omit<SavedFileSummary, 'storage'> & {
  tier: NpcLibraryTier;
  storage?: 'npc-characters' | 'account-npc-characters';
  unlocked?: boolean;
};
export type NpcLibrarySnapshot = {
  roots: { bundled: string; user: string; storybooks?: string; account?: string };
  entries: NpcLibraryEntry[];
  files: NpcLibraryFileSummary[];
  diagnostics: NpcLibraryDiagnostic[];
  skipped: number;
  publicationSources?: NpcPublicationSource[];
  /** Encrypted Storybooks and RP Saves skipped without decryption. */
  protectedSources?: number;
  /** The active Storybook files this snapshot's source selection excluded. */
  activeStorybookFileNames?: string[];
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
