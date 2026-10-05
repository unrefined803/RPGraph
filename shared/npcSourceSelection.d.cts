export type NpcSourceIndexFile = {
  fileName: string;
  kind: string;
  mtimeMs: number;
  savedAt?: number;
  participantIds?: string[];
  previewUnavailable?: boolean;
  sources: { storybookFileName: string; characters: { id: string; name: string }[]; characterIds: string[] }[];
};
/** The user's choice of NPC sources; anything that no longer applies is ignored. */
export type NpcSourcePreferences = {
  /** Storybook file -> the file chosen to provide its cast: itself or one of its RP Saves. */
  origins?: Record<string, string>;
  /** Storybook files that win characters several Storybooks provide, most preferred first. */
  priority?: string[];
};
export type NpcImportPreviewIndex = {
  files: NpcSourceIndexFile[];
  overriddenIds: string[];
  preferences?: NpcSourcePreferences;
};
export function selectNpcSources(files: NpcSourceIndexFile[], activeStorybookFileNames?: readonly string[],
  preferences?: NpcSourcePreferences): {
  storybookFileName: string; originFileName: string; characters: { id: string; name: string }[];
  /** Characters of this source that another Storybook currently provides. */
  yielded: { id: string; name: string; originFileName: string }[];
  /** The other files that could provide this Storybook's cast. */
  alternates: { fileName: string; characters: { id: string; name: string }[] }[];
}[];
