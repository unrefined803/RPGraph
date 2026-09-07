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
  diagnostics: NpcLibraryDiagnostic[];
  skipped: number;
};

export function npcLibraryRoots(options: {
  isPackaged: boolean;
  resourcesPath: string;
  projectRootPath: string;
  userDataPath: string;
}): NpcLibraryRoots;
export function scanNpcDirectory(directory: string, tier: 'bundled' | 'user'): Promise<Omit<NpcLibrarySnapshot, 'roots'>>;
export function scanNpcLibrary(roots: NpcLibraryRoots): Promise<NpcLibrarySnapshot>;
export function createNpcLibraryService(options: {
  roots: NpcLibraryRoots;
  openPath: (directory: string) => Promise<string>;
}): {
  current(): NpcLibrarySnapshot;
  reload(): Promise<NpcLibrarySnapshot>;
  openUserDirectory(): Promise<{ path: string }>;
};
