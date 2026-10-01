export function createLocalAccounts(userData: string): {
  list(): Promise<{ username: string }[]>;
  create(username: string, password: string): Promise<{ username: string }>;
  unlock(username: string, password: string): Promise<{ username: string }>;
  useLocal(): Promise<void>;
  prepare(): void;
  delete(password: string): Promise<{ username: string }>;
  setFilenamePrivacy(enabled: boolean): Promise<boolean>;
  encodeFileName(name: string, type: import('./filenamePrivacy.cjs').PrivateFileType): Promise<string>;
  filenameMetadata(fileName: string): import('./filenamePrivacy.cjs').FilenameEncryptionMetadata | undefined;
  decodeFileName(fileName: string, password?: string, metadata?: import('./filenamePrivacy.cjs').FilenameEncryptionMetadata | null): Promise<string | undefined>;
  ownsFileName(fileName: string, metadata?: import('./filenamePrivacy.cjs').FilenameEncryptionMetadata | null): Promise<boolean>;
  readonly root: string;
  readonly active: boolean;
  readonly password: string;
  readonly filenamePrivacy: boolean;
};
