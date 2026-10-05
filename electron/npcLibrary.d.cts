export type NpcLibraryRoots = { bundled: string; user: string; storybooks?: string; account?: string };
export type NpcLibraryDiagnostic = {
  tier: 'bundled' | 'saved-storybook' | 'user' | 'account';
  fileName: string;
  code: 'directory-error' | 'invalid-json' | 'invalid-container' | 'unsupported-version'
    | 'unusable-source' | 'ambiguous-source' | 'missing-media';
  message: string;
};
export type NpcLibrarySnapshot = {
  roots: NpcLibraryRoots;
  entries: Array<{
    tier: 'bundled' | 'saved-storybook' | 'user' | 'account';
    source: string;
    fileName: string;
    /** Key of the publication source that provides this saved-Storybook character. */
    publicationSource?: string;
    character: {
      id: string;
      name: string;
      apps?: Record<string, { bio?: string }>;
      [key: string]: unknown;
    };
  }>;
  files: Array<{
    tier: 'bundled' | 'saved-storybook' | 'user' | 'account';
    fileName: string;
    name: string;
    updatedAt: string;
    storage?: 'npc-characters' | 'account-npc-characters';
    type: 'character-card';
    protection: 'plain' | 'encrypted';
    envelopeFormatVersion?: string;
    formatVersion?: string;
    characterName?: string;
    compatible: boolean;
    unlocked?: boolean;
  }>;
  diagnostics: NpcLibraryDiagnostic[];
  skipped: number;
  /** One selected source per external stored Storybook that provides at least one character. */
  publicationSources: Array<{
    key: string;
    revision: string;
    storybookFileName: string;
    storybookName: string;
    kind: 'save' | 'storybook';
    saveFileName?: string;
    saveName?: string;
    savedAt?: string;
    posts: Array<Record<string, unknown>>;
    gallery: Array<Record<string, unknown>>;
  }>;
  /** Encrypted Storybooks and RP Saves that were skipped without decryption. */
  protectedSources: number;
  activeStorybookFileNames: string[];
};

export function npcLibraryRoots(options: {
  isPackaged: boolean;
  resourcesPath: string;
  projectRootPath: string;
  userDataPath: string;
}): NpcLibraryRoots;
export function scanNpcLibrary(
  roots: NpcLibraryRoots,
  unlock?: (envelope: unknown) => Promise<unknown>,
  displayFileName?: (fileName: string, fallback?: string, filePath?: string) => Promise<string>,
  storybookCache?: Map<string, unknown>,
  activeStorybookFileNames?: string[],
  sourcePreferences?: import('../shared/npcSourceSelection.cjs').NpcSourcePreferences,
): Promise<NpcLibrarySnapshot>;
export function createNpcLibraryService(options: {
  roots: NpcLibraryRoots;
  openPath: (directory: string) => Promise<string>;
  decryptCharacter?: (envelope: unknown, password: string) => Promise<unknown>;
  displayFileName?: (fileName: string, fallback?: string, filePath?: string) => Promise<string>;
  accountPassword?: string;
  onChanged?: (snapshot: NpcLibrarySnapshot) => void;
  sourcePreferences?: unknown;
  saveSourcePreferences?: (preferences: Required<import('../shared/npcSourceSelection.cjs').NpcSourcePreferences>) => Promise<void>;
}): {
  current(): NpcLibrarySnapshot;
  preview(): Promise<import('../shared/npcSourceSelection.cjs').NpcImportPreviewIndex>;
  forActiveStorybooks(activeStorybookFileNames: unknown): Promise<NpcLibrarySnapshot>;
  preferSource(fileName: string): Promise<NpcLibrarySnapshot>;
  reload(activeStorybookFileNames?: unknown): Promise<NpcLibrarySnapshot>;
  setGamePassword(password: string): Promise<NpcLibrarySnapshot>;
  openUserDirectory(): Promise<{ path: string }>;
};
