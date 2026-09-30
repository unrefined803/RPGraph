const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  currentCharacterContainerVersion,
  validateCharacterContainer,
  validateCharacterPayload,
} = require('../shared/character-container.cjs');
const {
  characterCardMetadata,
  encryptedCharacterCardMetadata,
} = require('./characterCardFormat.cjs');

const { storybookMetadata } = require('./storybookFormat.cjs');

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

async function scanNpcDirectory(directory, tier, unlock) {
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: [], files: [], diagnostics: [], skipped: 0 };
    return { entries: [], files: [], diagnostics: [diagnostic(tier, '', 'directory-error',
      `Unable to read the ${tier} NPC directory: ${error instanceof Error ? error.message : String(error)}`)], skipped: 0 };
  }

  const entries = [];
  const files = [];
  const diagnostics = [];
  let skipped = 0;
  const candidates = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  for (const file of candidates) {
    let value;
    let stats;
    try {
      const filePath = path.join(directory, file.name);
      [value, stats] = await Promise.all([
        fs.readFile(filePath, 'utf8').then(JSON.parse),
        fs.stat(filePath),
      ]);
    } catch (error) {
      diagnostics.push(diagnostic(tier, file.name, 'invalid-json',
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }
    if (value?.format === 'rpgraph-encrypted-character') {
      const metadata = encryptedCharacterCardMetadata(value);
      const character = metadata.compatible && unlock ? await unlock(value) : undefined;
      if (character) entries.push({ tier, source: `${tier}:${file.name}`, fileName: file.name, character });
      files.push({
        tier,
        fileName: file.name,
        name: metadata.characterName || path.basename(file.name, path.extname(file.name)),
        updatedAt: stats.mtime.toISOString(),
        storage: tier === 'account' ? 'account-npc-characters' : tier === 'user' ? 'npc-characters' : undefined,
        ...metadata,
        unlocked: !!character,
      });
      continue;
    }
    if (value?.format !== 'rpgraph-character') {
      skipped += 1;
      continue;
    }
    const metadata = characterCardMetadata(value);
    files.push({
      tier,
      fileName: file.name,
      name: typeof value.character?.name === 'string'
        ? value.character.name
        : path.basename(file.name, path.extname(file.name)),
      updatedAt: stats.mtime.toISOString(),
      storage: tier === 'account' ? 'account-npc-characters' : tier === 'user' ? 'npc-characters' : undefined,
      ...metadata,
    });
    try {
      validateCharacterContainer(value);
      entries.push({ tier, source: `${tier}:${file.name}`, fileName: file.name, character: value.character });
    } catch (error) {
      const code = value?.version === currentCharacterContainerVersion ? 'invalid-container' : 'unsupported-version';
      diagnostics.push(diagnostic(tier, file.name, code,
        error instanceof Error ? error.message : String(error)));
    }
  }
  return { entries, files, diagnostics, skipped };
}

// Storybooks are read-only sources: rebuilding the scan also removes deleted characters.
async function scanStorybookDirectory(directory) {
  const result = { entries: [], files: [], diagnostics: [], skipped: 0 };
  if (!directory) return result;
  let candidates;
  try {
    candidates = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error?.code !== 'ENOENT') result.diagnostics.push(diagnostic('saved-storybook', '', 'directory-error', String(error)));
    return result;
  }
  const byId = new Map();
  for (const file of candidates) {
    try {
      const filePath = path.join(directory, file.name);
      const [value, stats] = await Promise.all([fs.readFile(filePath, 'utf8').then(JSON.parse), fs.stat(filePath)]);
      // Never attempt to decrypt Storybooks, even when a game password is available.
      if (value?.format !== 'rpgraph-storybook') continue;
      if (!storybookMetadata(value).compatible || !Array.isArray(value.characters)) {
        result.diagnostics.push(diagnostic('saved-storybook', file.name, 'invalid-container', 'Unsupported or malformed Storybook.'));
        continue;
      }
      for (const character of value.characters) {
        try {
          validateCharacterPayload(character);
          // A character can occur in several saved Storybooks. Prefer the newest
          // file, with sorted filenames providing a stable tie-breaker.
          if ((byId.get(character.id)?.mtime ?? -Infinity) >= stats.mtimeMs) continue;
          const fileName = `${file.name}#${character.id}`;
          byId.set(character.id, {
            mtime: stats.mtimeMs,
            entry: { tier: 'saved-storybook', source: `saved-storybook:${fileName}`, fileName, character },
            file: { tier: 'saved-storybook', fileName, name: character.name, updatedAt: stats.mtime.toISOString(),
              type: 'character-card', protection: 'plain', formatVersion: currentCharacterContainerVersion, compatible: true },
          });
        } catch (error) {
          result.diagnostics.push(diagnostic('saved-storybook', file.name, 'invalid-container',
            `Invalid Storybook character: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
    } catch (error) {
      result.diagnostics.push(diagnostic('saved-storybook', file.name, 'invalid-json', String(error)));
    }
  }
  for (const { entry, file } of byId.values()) {
    result.entries.push(entry);
    result.files.push(file);
  }
  return result;
}

async function scanNpcLibrary(roots, unlock) {
  // Serialize decryptions across both tiers, including identical encrypted copies.
  const bundled = await scanNpcDirectory(roots.bundled, 'bundled', unlock);
  const user = await scanNpcDirectory(roots.user, 'user', unlock);
  const account = roots.account ? await scanNpcDirectory(roots.account, 'account', unlock)
    : { entries: [], files: [], diagnostics: [], skipped: 0 };
  const storybooks = await scanStorybookDirectory(roots.storybooks);
  return {
    roots,
    entries: [...bundled.entries, ...storybooks.entries, ...user.entries, ...account.entries],
    files: [...bundled.files, ...storybooks.files, ...user.files, ...account.files],
    diagnostics: [...bundled.diagnostics, ...storybooks.diagnostics, ...user.diagnostics, ...account.diagnostics],
    skipped: bundled.skipped + user.skipped + account.skipped,
  };
}

function createNpcLibraryService({ roots, openPath, decryptCharacter, accountPassword = '', onChanged = () => {} }) {
  let cached = { roots, entries: [], files: [], diagnostics: [], skipped: 0 };
  let queue = Promise.resolve();
  // Application-session memory only. Never serialize passwords or attempt records.
  const passwords = new Set(accountPassword ? [accountPassword] : []);
  let gamePassword = '';
  const attempts = new Map();
  async function unlock(envelope) {
    if (!decryptCharacter) return undefined;
    const fingerprint = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
    let record = attempts.get(fingerprint);
    if (!record) {
      record = { tried: new Set(), character: undefined };
      attempts.set(fingerprint, record);
    }
    if (record.character) return record.character;
    for (const password of passwords) {
      if (record.tried.has(password)) continue;
      record.tried.add(password);
      try {
        const container = await decryptCharacter(envelope, password);
        validateCharacterContainer(container);
        record.character = container.character;
        return record.character;
      } catch {
        // A mismatch leaves this file locked; other files and passwords still work.
      }
    }
    return undefined;
  }
  const service = {
    current: () => cached,
    setGamePassword: (password) => {
      if (typeof password !== 'string') throw new Error('Invalid game password.');
      return enqueue(async () => {
        if (password !== gamePassword) {
          passwords.clear();
          if (accountPassword) passwords.add(accountPassword);
          attempts.clear();
          gamePassword = password;
          if (password) passwords.add(password);
        }
        cached = await scanNpcLibrary(roots, unlock);
        onChanged(cached);
        return cached;
      });
    },
    reload: () => {
      return enqueue(async () => {
        try {
          await fs.mkdir(roots.user, { recursive: true });
        } catch {
          // The scan below returns a directory diagnostic without blocking startup.
        }
        cached = await scanNpcLibrary(roots, unlock);
        onChanged(cached);
        return cached;
      });
    },
    openUserDirectory: async () => {
      await fs.mkdir(roots.user, { recursive: true });
      const error = await openPath(roots.user);
      if (error) throw new Error(`Unable to open the NPC directory: ${error}`);
      return { path: roots.user };
    },
  };
  function enqueue(action) {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  }
  return service;
}

module.exports = {
  createNpcLibraryService,
  npcLibraryRoots,
  scanNpcLibrary,
};
