import { selectNpcSources, type NpcImportPreviewIndex } from '../../shared/npcSourceSelection.cjs';

function previewSelection(index: NpcImportPreviewIndex, targetFileName: string) {
  const target = index.files.find((file) => file.fileName === targetFileName);
  if (!target || !['storybook', 'session'].includes(target.kind) || !target.sources.length || target.previewUnavailable) return null;
  const activeFiles = target.kind === 'storybook' ? [target.fileName] : target.sources.map((source) => source.storybookFileName);
  const activeIds = new Set(target.sources.flatMap((source) => source.characterIds));
  const overrides = new Set([...index.overriddenIds, ...(target.participantIds ?? [])]);
  return { sources: selectNpcSources(index.files, activeFiles, index.preferences),
    imported: (character: { id: string }) => !activeIds.has(character.id) && !overrides.has(character.id) };
}

/** Uses the scanner's compact metadata only; selecting a row never reads or exports files. */
export function npcImportPreview(index: NpcImportPreviewIndex, targetFileName: string) {
  const selection = previewSelection(index, targetFileName);
  if (!selection) return null;
  const rows: Record<string, string[]> = {};
  for (const source of selection.sources) {
    for (const character of source.characters.filter(selection.imported)) {
      (rows[source.originFileName] ??= []).push(character.name);
    }
  }
  return rows;
}

/**
 * Files that could share NPCs instead of the current sources: another file of
 * the same Storybook, or a Storybook whose characters another one provides.
 * Each maps to the files that would hand their NPCs over.
 */
export function npcSourceSwitches(index: NpcImportPreviewIndex, targetFileName: string) {
  const switches: Record<string, string[]> = {};
  const selection = previewSelection(index, targetFileName);
  const add = (fileName: string, from: string[]) => {
    switches[fileName] = [...new Set([...(switches[fileName] ?? []), ...from])].filter((name) => name !== fileName);
  };
  for (const source of selection?.sources ?? []) {
    const yielded = source.yielded.filter(selection!.imported);
    if (yielded.length) add(source.originFileName, yielded.map((character) => character.originFileName));
    for (const alternate of source.alternates) {
      if (alternate.characters.some(selection!.imported)) add(alternate.fileName, [source.originFileName]);
    }
  }
  return switches;
}
