import { selectNpcSources, type NpcImportPreviewIndex } from '../../shared/npcSourceSelection.cjs';

/** Uses the scanner's compact metadata only; selecting a row never reads or exports files. */
export function npcImportPreview(index: NpcImportPreviewIndex, targetFileName: string) {
  const target = index.files.find((file) => file.fileName === targetFileName);
  if (!target || !['storybook', 'session'].includes(target.kind) || !target.sources.length || target.previewUnavailable) return null;
  const activeFiles = target.kind === 'storybook' ? [target.fileName] : target.sources.map((source) => source.storybookFileName);
  const activeIds = new Set(target.sources.flatMap((source) => source.characterIds));
  const overrides = new Set([...index.overriddenIds, ...(target.participantIds ?? [])]);
  const rows: Record<string, string[]> = {};
  const add = (fileName: string, name: string) => { (rows[fileName] ??= []).push(name); };
  for (const source of selectNpcSources(index.files, activeFiles)) {
    for (const character of source.characters) {
      if (!activeIds.has(character.id) && !overrides.has(character.id)) {
        add(source.originFileName, character.name);
      }
    }
  }
  return rows;
}
