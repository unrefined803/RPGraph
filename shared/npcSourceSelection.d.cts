export type NpcSourceIndexFile = {
  fileName: string;
  kind: string;
  mtimeMs: number;
  savedAt?: number;
  participantIds?: string[];
  previewUnavailable?: boolean;
  sources: { storybookFileName: string; characters: { id: string; name: string }[]; characterIds: string[] }[];
};
export type NpcImportPreviewIndex = { files: NpcSourceIndexFile[]; overriddenIds: string[] };
export function selectNpcSources(files: NpcSourceIndexFile[], activeStorybookFileNames?: readonly string[]): {
  storybookFileName: string; originFileName: string; characters: { id: string; name: string }[];
}[];
