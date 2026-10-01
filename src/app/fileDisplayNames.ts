import type { SavedFileSummary } from '../types';

function isProtectedFileName(fileName: string) {
  return /^(WF|RP|CH|SB)[12]xQ[A-Za-z0-9_-]+\.json$/.test(fileName);
}

export function readableFileName(
  fileName: string | null | undefined,
  unlockedNames: Readonly<Record<string, string>>,
  files: readonly SavedFileSummary[],
) {
  if (!fileName) return undefined;
  const unlocked = Object.prototype.hasOwnProperty.call(unlockedNames, fileName) ? unlockedNames[fileName] : undefined;
  if (unlocked) return unlocked;
  const listed = files.find(file => file.fileName === fileName)?.name;
  if (listed && !listed.endsWith(' (open to unlock)')) return listed;
  return isProtectedFileName(fileName) ? undefined : fileName.replace(/(\.rpgraph-storybook|\.rpgraph-character|\.rpgraph-session|\.rpgraph)?\.json$/i, '');
}

/** Keep opaque protected filenames out of status text. */
export function fileNameLabel(fileName: string, name: string) {
  return isProtectedFileName(fileName) ? name : fileName;
}
