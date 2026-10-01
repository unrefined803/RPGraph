export type NpcLibraryRoots = { bundled: string; user: string; storybooks?: string; account?: string };
export type NpcLibraryDiagnostic = {
  tier: 'bundled' | 'saved-storybook' | 'user' | 'account';
  fileName: string;
  code: 'directory-error' | 'invalid-json' | 'invalid-container' | 'unsupported-version';
  message: string;
};
export type NpcLibrarySnapshot = {
  roots: NpcLibraryRoots;
  entries: Array<{
    tier: 'bundled' | 'saved-storybook' | 'user' | 'account';
    source: string;
    fileName: string;
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
};

export function npcLibraryRoots(options: {
  isPackaged: boolean;
  resourcesPath: string;
  projectRootPath: string;
  userDataPath: string;
}): NpcLibraryRoots;
export function scanNpcLibrary(roots: NpcLibraryRoots): Promise<NpcLibrarySnapshot>;
export function createNpcLibraryService(options: {
  roots: NpcLibraryRoots;
  openPath: (directory: string) => Promise<string>;
  decryptCharacter?: (envelope: unknown, password: string) => Promise<unknown>;
  displayFileName?: (fileName: string, fallback?: string, filePath?: string) => Promise<string>;
  accountPassword?: string;
  onChanged?: (snapshot: NpcLibrarySnapshot) => void;
}): {
  current(): NpcLibrarySnapshot;
  reload(): Promise<NpcLibrarySnapshot>;
  setGamePassword(password: string): Promise<NpcLibrarySnapshot>;
  openUserDirectory(): Promise<{ path: string }>;
};
