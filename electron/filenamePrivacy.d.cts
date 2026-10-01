export type PrivateFileType = 'workflow' | 'session' | 'character-card' | 'storybook';
export type FilenameEncryptionMetadata = { format: 'rpgraph-filename-v2'; salt: string; iv: string };
export function privateFileType(value: unknown): PrivateFileType | undefined;
export function createFilenameCipher(password: string, salt: Buffer): {
  encode(name: string, type: PrivateFileType): Promise<string>;
  encodeCompact(name: string, type: PrivateFileType): Promise<{ fileName: string; metadata: FilenameEncryptionMetadata }>;
  decode(fileName: string, metadata?: FilenameEncryptionMetadata | null): Promise<string | undefined>;
  dispose(): void;
};
