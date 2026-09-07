const fs = require('node:fs/promises');
const path = require('node:path');
const {
  currentCharacterContainerVersion,
  validateCharacterContainer,
} = require('../shared/character-container.cjs');

function npcLibraryRoots({ isPackaged, resourcesPath, projectRootPath, userDataPath }) {
  return {
    bundled: isPackaged
      ? path.join(resourcesPath, 'npc-characters')
      : path.join(projectRootPath, 'resources', 'npc-characters'),
    user: path.join(userDataPath, 'npc-characters'),
  };
}

function diagnostic(tier, fileName, code, message) {
  return { tier, fileName, code, message };
}

async function scanNpcDirectory(directory, tier) {
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], diagnostics: [], skipped: 0 };
    return { entries: [], diagnostics: [diagnostic(tier, '', 'directory-error',
      `Unable to read the ${tier} NPC directory: ${error instanceof Error ? error.message : String(error)}`)], skipped: 0 };
  }

  const entries = [];
  const diagnostics = [];
  let skipped = 0;
  const candidates = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  for (const file of candidates) {
    let value;
    try {
      value = JSON.parse(await fs.readFile(path.join(directory, file.name), 'utf8'));
    } catch (error) {
      diagnostics.push(diagnostic(tier, file.name, 'invalid-json',
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }
    if (value?.format === 'rpgraph-encrypted-character') {
      skipped += 1;
      continue;
    }
    if (value?.format !== 'rpgraph-character') {
      skipped += 1;
      continue;
    }
    try {
      validateCharacterContainer(value);
      entries.push({ tier, source: `${tier}:${file.name}`, fileName: file.name, character: value.character });
    } catch (error) {
      const code = value?.version === currentCharacterContainerVersion ? 'invalid-container' : 'unsupported-version';
      diagnostics.push(diagnostic(tier, file.name, code,
        error instanceof Error ? error.message : String(error)));
    }
  }
  return { entries, diagnostics, skipped };
}

async function scanNpcLibrary(roots) {
  const [bundled, user] = await Promise.all([
    scanNpcDirectory(roots.bundled, 'bundled'),
    scanNpcDirectory(roots.user, 'user'),
  ]);
  return {
    roots,
    entries: [...bundled.entries, ...user.entries],
    diagnostics: [...bundled.diagnostics, ...user.diagnostics],
    skipped: bundled.skipped + user.skipped,
  };
}

function createNpcLibraryService({ roots, openPath }) {
  let cached = { roots, entries: [], diagnostics: [], skipped: 0 };
  let pendingReload;
  return {
    current: () => cached,
    reload: async () => {
      if (!pendingReload) {
        pendingReload = (async () => {
          try {
            await fs.mkdir(roots.user, { recursive: true });
          } catch {
            // The scan below returns a directory diagnostic without blocking startup.
          }
          cached = await scanNpcLibrary(roots);
          return cached;
        })().finally(() => { pendingReload = undefined; });
      }
      return pendingReload;
    },
    openUserDirectory: async () => {
      await fs.mkdir(roots.user, { recursive: true });
      const error = await openPath(roots.user);
      if (error) throw new Error(`Unable to open the NPC directory: ${error}`);
      return { path: roots.user };
    },
  };
}

module.exports = {
  createNpcLibraryService,
  npcLibraryRoots,
  scanNpcDirectory,
  scanNpcLibrary,
};
