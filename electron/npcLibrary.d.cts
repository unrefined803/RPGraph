export type NpcLibraryRoots = { bundled: string; user: string };
export type NpcLibraryDiagnostic = {
  tier: 'bundled' | 'user';
  fileName: string;
  code: 'directory-error' | 'invalid-json' | 'invalid-container' | 'unsupported-version';
  message: string;
};
export type NpcLibrarySnapshot = {
  roots: NpcLibraryRoots;
  entries: Array<{
    tier: 'bundled' | 'user';
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
    tier: 'bundled' | 'user';
    fileName: string;
    name: string;
    updatedAt: string;
    storage?: 'npc-characters';
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
  onChanged?: (snapshot: NpcLibrarySnapshot) => void;
}): {
  current(): NpcLibrarySnapshot;
  reload(): Promise<NpcLibrarySnapshot>;
  setGamePassword(password: string): Promise<NpcLibrarySnapshot>;
  openUserDirectory(): Promise<{ path: string }>;
};
