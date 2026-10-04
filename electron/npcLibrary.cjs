const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { legacyStoryNpcIds } = require('../shared/storyNpcReferences.cjs');
const { selectNpcSources } = require('../shared/npcSourceSelection.cjs');
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
const { sessionMetadata } = require('./sessionFormat.cjs');
const { rehydratedMediaJson } = require('../shared/mediaPool.cjs');

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

async function scanNpcDirectory(directory, tier, unlock, displayFileName) {
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
        name: displayFileName ? await displayFileName(file.name, character?.name || metadata.characterName, path.join(directory, file.name))
          : character?.name || metadata.characterName || path.basename(file.name, path.extname(file.name)),
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

const socialPublicationApps = new Set(['fotogram', 'onlyfriends']);

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validSocialPost(post) {
  return isRecord(post) && socialPublicationApps.has(post.app) && typeof post.postId === 'string' &&
    typeof post.author === 'string' && typeof post.authorHandle === 'string' && typeof post.caption === 'string';
}

function openingHistoryPosts(storybook) {
  const turns = Array.isArray(storybook.openingHistory?.turns) ? storybook.openingHistory.turns : [];
  return turns.flatMap((turn) => [turn?.input?.messages, turn?.output?.messages]
    .flatMap((messages) => Array.isArray(messages) ? messages : [])
    .flatMap((message) => validSocialPost(message?.socialPost) ? [message.socialPost] : []));
}

// The saved timeline already contains the opening messages; never append Opening History again.
function timelinePosts(session) {
  return session.timeline.flatMap((entry) =>
    entry?.kind === 'message' && validSocialPost(entry.socialPost) ? [entry.socialPost] : []);
}

/**
 * One publication source: the playable cast of a Storybook state plus the
 * publication records and referenced gallery images of that same state.
 * Imported library NPCs and archived NPC participants never become sources.
 */
function publicationSource(storybook, posts, fileName, diagnostics) {
  const source = { characters: new Map(), posts, gallery: new Map(), loaded: true, valid: true, cast: [],
    characterIds: storybook.characters.flatMap((character) => typeof character?.id === 'string' ? [character.id] : []) };
  for (const character of storybook.characters) {
    if (character?.playable === false) continue;
    try {
      validateCharacterPayload(character);
      source.characters.set(character.id, character);
    } catch (error) {
      diagnostics.push(diagnostic('saved-storybook', fileName, 'invalid-container',
        `Invalid Storybook character: ${error instanceof Error ? error.message : String(error)}`));
      source.valid = false;
    }
  }
  source.cast = [...source.characters.values()].map((character) => ({ id: character.id, name: character.name }));
  const referenced = new Set(posts.flatMap((post) => typeof post.imageId === 'string' ? [post.imageId] : []));
  for (const character of storybook.characters) {
    for (const image of Array.isArray(character?.images) ? character.images : []) {
      if (isRecord(image) && referenced.has(image.id) && !source.gallery.has(image.id)) {
        source.gallery.set(image.id, { image, ownerId: character.id });
      }
    }
  }
  return source;
}

function releaseSource(source) {
  source.characters.clear();
  source.gallery.clear();
  source.posts = [];
  source.loaded = false;
}

/**
 * Source matching, isolated from publication extraction: a save belongs to a
 * stored Storybook only through the filename it recorded for one Storybook
 * node. Replace this function to match by a stable Storybook ID later.
 */
function sessionStorybookAssociations(session) {
  const names = session.metadata?.storybookFileNames;
  const nodeIdsByFileName = new Map();
  if (!isRecord(names)) return nodeIdsByFileName;
  for (const [nodeId, fileName] of Object.entries(names)) {
    if (typeof fileName !== 'string' || !fileName) continue;
    nodeIdsByFileName.set(fileName, [...(nodeIdsByFileName.get(fileName) ?? []), nodeId]);
  }
  return nodeIdsByFileName;
}

function readSessionSources(session, fileName, record) {
  const unusable = (message, code = 'unusable-source') =>
    record.diagnostics.push(diagnostic('saved-storybook', fileName, code, message));
  if (!sessionMetadata(session).compatible) {
    unusable('Unsupported or malformed RP Save.', 'unsupported-version');
    return;
  }
  record.savedAt = typeof session.savedAt === 'string' ? Date.parse(session.savedAt) : NaN;
  if (!Number.isFinite(record.savedAt)) {
    unusable('RP Save has no valid save time and is not used as a publication source.');
    return;
  }
  record.savedAtText = session.savedAt;
  record.name = typeof session.name === 'string' && session.name.trim() ? session.name.trim() : undefined;
  record.participantIds = [];
  try {
    const importsJson = session.runtime.current.importedNpcsJson;
    if (typeof importsJson === 'string') {
      const imports = JSON.parse(rehydratedMediaJson(importsJson, session.entities?.mediaData));
      record.participantIds.push(...legacyStoryNpcIds(session.timeline.filter((entry) => entry.kind === 'message')
        .map((entry) => ({ ...entry, phoneMessage: !!entry.phone,
          phoneFromAccountId: entry.phone?.fromAccountId, phoneToAccountId: entry.phone?.toAccountId,
          phoneFrom: entry.phone?.from, phoneTo: entry.phone?.to })), Object.values(imports).map((entry) => entry.character)));
    }
    const participantsJson = session.runtime.current.npcParticipantsJson;
    if (typeof participantsJson === 'string') {
      record.participantIds.push(...Object.keys(JSON.parse(rehydratedMediaJson(participantsJson, session.entities?.mediaData))));
    }
  } catch {
    record.previewUnavailable = true;
  }
  const posts = timelinePosts(session);
  for (const [storybookFileName, nodeIds] of sessionStorybookAssociations(session)) {
    if (nodeIds.length !== 1) {
      unusable(`RP Save links several Storybook nodes to "${storybookFileName}" and is not used as its publication source.`, 'ambiguous-source');
      continue;
    }
    // The runtime state is the effective saved state; its media lives in the save's pool.
    const runtimeJson = session.runtime.current.nodes?.[nodeIds[0]]?.storybookJson;
    const json = typeof runtimeJson === 'string' ? runtimeJson
      : session.workflow.graph.nodes.find((node) => node?.id === nodeIds[0])?.data?.storybookJson;
    if (typeof json !== 'string' || !json) {
      unusable(`RP Save has no Storybook state for "${storybookFileName}".`);
      continue;
    }
    let storybook;
    try {
      storybook = JSON.parse(rehydratedMediaJson(json, session.entities?.mediaData));
    } catch (error) {
      unusable(`RP Save Storybook state for "${storybookFileName}" is unreadable: ${error instanceof Error ? error.message : String(error)}`, 'missing-media');
      continue;
    }
    const metadata = storybookMetadata(storybook);
    if (!metadata.compatible || metadata.legacy || !Array.isArray(storybook.characters)) {
      unusable(`RP Save Storybook state for "${storybookFileName}" is unsupported or needs an update.`, 'unsupported-version');
      continue;
    }
    const source = publicationSource(storybook, posts, fileName, record.diagnostics);
    if (source.valid) record.sources.set(storybookFileName, source);
  }
}

// Reads one file of the Storybook directory. Characters keep their payload only
// while this file provides the library entry for their ID.
async function readStorybookRecord(filePath, fileName, stats, displayFileName) {
  const record = { mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size,
    updatedAt: stats.mtime.toISOString(), kind: 'other', sources: new Map(), diagnostics: [] };
  let value;
  try {
    value = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    record.diagnostics.push(diagnostic('saved-storybook', fileName, 'invalid-json', String(error)));
    return record;
  }
  // Never attempt to decrypt Storybooks or RP Saves, even when a game password is available.
  if (value?.format === 'rpgraph-encrypted-storybook' || value?.format === 'rpgraph-encrypted-session') {
    record.kind = 'protected';
    return record;
  }
  if (value?.format === 'rpgraph-session') {
    record.kind = 'session';
    readSessionSources(value, fileName, record);
    if (record.sources.size && !record.name) record.name = await sourceDisplayName(displayFileName, fileName, filePath);
    return record;
  }
  if (value?.format !== 'rpgraph-storybook') return record;
  if (!storybookMetadata(value).compatible || !Array.isArray(value.characters)) {
    record.diagnostics.push(diagnostic('saved-storybook', fileName, 'invalid-container', 'Unsupported or malformed Storybook.'));
    return record;
  }
  record.kind = 'storybook';
  record.participantIds = Object.keys(value.openingHistory?.npcParticipants ?? {});
  record.name = await sourceDisplayName(displayFileName, fileName, filePath);
  record.sources.set(fileName, publicationSource(value, openingHistoryPosts(value), fileName, record.diagnostics));
  return record;
}

async function sourceDisplayName(displayFileName, fileName, filePath) {
  return (displayFileName ? await displayFileName(fileName, undefined, filePath) : '') ||
    path.basename(fileName, path.extname(fileName));
}

/** Compact metadata survives releasing the large publication/media payloads. */
function sourceIndex(records) {
  return records.map(({ fileName, record }) => ({ fileName, kind: record.kind,
    mtimeMs: record.mtimeMs, savedAt: record.savedAt,
    participantIds: record.participantIds, previewUnavailable: record.previewUnavailable,
    sources: [...record.sources].map(([storybookFileName, source]) => ({
      storybookFileName, characters: source.cast, characterIds: source.characterIds,
    })),
  }));
}

// Storybooks and RP Saves are read-only sources: rebuilding the scan also removes deleted characters.
// `cache` (file path -> record) lets a later scan skip unchanged files. It only
// ever holds what plain files already expose; nothing here is decrypted. The
// cache is independent of `activeStorybookFileNames` and `sourcePreferences`, which only steer selection.
async function scanStorybookDirectory(directory, cache = new Map(), displayFileName, activeStorybookFileNames = [], sourcePreferences = {}) {
  const result = { entries: [], files: [], diagnostics: [], skipped: 0, publicationSources: [], protectedSources: 0 };
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
  const records = [];
  for (const file of candidates) {
    const filePath = path.join(directory, file.name);
    try {
      const stats = await fs.stat(filePath);
      let record = cache.get(filePath);
      if (!record || record.mtimeMs !== stats.mtimeMs || record.ctimeMs !== stats.ctimeMs || record.size !== stats.size) {
        record = await readStorybookRecord(filePath, file.name, stats, displayFileName);
        cache.set(filePath, record);
      }
      records.push({ filePath, fileName: file.name, record });
    } catch (error) {
      cache.delete(filePath);
      result.diagnostics.push(diagnostic('saved-storybook', file.name, 'invalid-json', String(error)));
    }
  }
  const present = new Set(records.map(({ filePath }) => filePath));
  for (const filePath of cache.keys()) {
    if (path.dirname(filePath) === directory && !present.has(filePath)) cache.delete(filePath);
  }
  for (const { record } of records) {
    result.diagnostics.push(...record.diagnostics);
    if (record.kind === 'protected') result.protectedSources += 1;
  }
  // Each Storybook contributes exactly one lineage: its latest usable matching
  // RP Save, or the stored Storybook with its Opening History. Alternate saves
  // are never merged. The active Storybook is not an external source.
  const index = sourceIndex(records);
  result.previewIndex = index;
  const byName = new Map(records.map((record) => [record.fileName, record]));
  const lineages = selectNpcSources(index, activeStorybookFileNames, sourcePreferences).map((selection) => ({
    storybook: byName.get(selection.storybookFileName), origin: byName.get(selection.originFileName),
    ids: selection.characters.map((character) => character.id),
  }));
  for (const lineage of lineages) {
    if (!lineage.ids.length) continue;
    const { storybook, origin } = lineage;
    let source = origin.record.sources.get(storybook.fileName);
    if (!source.loaded || lineage.ids.some((id) => !source.characters.has(id))) {
      // This file was released during an earlier scan and is needed again.
      try {
        origin.record = await readStorybookRecord(origin.filePath, origin.fileName, await fs.stat(origin.filePath), displayFileName);
        cache.set(origin.filePath, origin.record);
      } catch {
        cache.delete(origin.filePath);
        continue;
      }
      source = origin.record.sources.get(storybook.fileName);
      if (!source) continue;
    }
    const shipped = lineage.ids.filter((id) => source.characters.has(id));
    if (!shipped.length) continue;
    const fromSave = origin !== storybook;
    result.publicationSources.push({
      key: storybook.fileName,
      revision: [storybook.record.mtimeMs, storybook.record.size, origin.fileName, origin.record.mtimeMs, origin.record.size].join(':'),
      storybookFileName: storybook.fileName,
      storybookName: storybook.record.name,
      kind: fromSave ? 'save' : 'storybook',
      ...(fromSave ? { saveFileName: origin.fileName, saveName: origin.record.name, savedAt: origin.record.savedAtText } : {}),
      posts: source.posts,
      // Winners carry their own galleries; ship only referenced images owned by others.
      gallery: [...source.gallery.values()].filter(({ ownerId }) => !shipped.includes(ownerId)).map(({ image }) => image),
    });
    for (const id of shipped) {
      const character = source.characters.get(id);
      const fileName = `${storybook.fileName}#${id}`;
      result.entries.push({ tier: 'saved-storybook', source: `saved-storybook:${fileName}`, fileName, character,
        publicationSource: storybook.fileName });
      result.files.push({ tier: 'saved-storybook', fileName, name: character.name, updatedAt: storybook.record.updatedAt,
        type: 'character-card', protection: 'plain', formatVersion: currentCharacterContainerVersion, compatible: true });
    }
    lineage.source = source;
  }
  // Unselected saves and superseded copies would otherwise keep their embedded images in memory.
  const used = new Map(lineages.filter((lineage) => lineage.source).map((lineage) => [lineage.source, lineage.ids]));
  for (const { record } of records) {
    for (const source of record.sources.values()) {
      const ids = used.get(source);
      if (!ids) {
        if (source.loaded) releaseSource(source);
        continue;
      }
      for (const id of source.characters.keys()) {
        if (!ids.includes(id)) source.characters.delete(id);
      }
    }
  }
  return result;
}

function normalizedStorybookFileNames(value) {
  return Array.isArray(value) ? [...new Set(value.filter((name) => typeof name === 'string' && name))].sort() : [];
}

function normalizedSourcePreferences(value) {
  const record = isRecord(value) ? value : {};
  const fileName = (name) => typeof name === 'string' && name ? [path.basename(name)] : [];
  return {
    origins: Object.fromEntries(Object.entries(isRecord(record.origins) ? record.origins : {})
      .flatMap(([book, origin]) => book ? fileName(origin).map((name) => [book, name]) : [])),
    priority: [...new Set((Array.isArray(record.priority) ? record.priority : []).flatMap(fileName))],
  };
}

async function scanNpcLibrary(roots, unlock, displayFileName, storybookCache, activeStorybookFileNames = [], sourcePreferences = {}) {
  // Serialize decryptions across both tiers, including identical encrypted copies.
  const bundled = await scanNpcDirectory(roots.bundled, 'bundled', unlock, displayFileName);
  const user = await scanNpcDirectory(roots.user, 'user', unlock, displayFileName);
  const account = roots.account ? await scanNpcDirectory(roots.account, 'account', unlock, displayFileName)
    : { entries: [], files: [], diagnostics: [], skipped: 0 };
  const storybooks = await scanStorybookDirectory(roots.storybooks, storybookCache, displayFileName, activeStorybookFileNames, sourcePreferences);
  return {
    roots,
    entries: [...bundled.entries, ...storybooks.entries, ...user.entries, ...account.entries],
    files: [...bundled.files, ...storybooks.files, ...user.files, ...account.files],
    diagnostics: [...bundled.diagnostics, ...storybooks.diagnostics, ...user.diagnostics, ...account.diagnostics],
    skipped: bundled.skipped + user.skipped + account.skipped,
    publicationSources: storybooks.publicationSources,
    previewIndex: storybooks.previewIndex,
    protectedSources: storybooks.protectedSources,
    activeStorybookFileNames,
  };
}

function createNpcLibraryService({ roots, openPath, decryptCharacter, displayFileName, accountPassword = '', onChanged = () => {},
  sourcePreferences: initialSourcePreferences, saveSourcePreferences }) {
  let cached = { roots, entries: [], files: [], diagnostics: [], skipped: 0, publicationSources: [], protectedSources: 0, activeStorybookFileNames: [] };
  // Selection context only; the file cache below stays valid across Storybook switches.
  let activeStorybookFileNames = [];
  // The user's choice of source file per Storybook and of Storybook per shared character.
  let sourcePreferences = normalizedSourcePreferences(initialSourcePreferences);
  const scan = () => scanNpcLibrary(roots, unlock, displayFileName, storybookCache, activeStorybookFileNames, sourcePreferences);
  const useActiveStorybooks = (names) => {
    if (names !== undefined) activeStorybookFileNames = normalizedStorybookFileNames(names);
  };
  let queue = Promise.resolve();
  const storybookCache = new Map();
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
    preview: () => enqueue(async () => {
      const snapshot = await scan();
      return { files: snapshot.previewIndex ?? [], preferences: sourcePreferences,
        overriddenIds: snapshot.entries.filter((entry) => entry.tier === 'user' || entry.tier === 'account')
          .map((entry) => entry.character.id) };
    }),
    /** Return the snapshot selected for these active Storybooks, rescanning only when they changed. */
    forActiveStorybooks: (names) => enqueue(async () => {
      const next = normalizedStorybookFileNames(names);
      if (next.join('\u0000') !== cached.activeStorybookFileNames.join('\u0000')) {
        activeStorybookFileNames = next;
        cached = await scan();
      }
      return cached;
    }),
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
        cached = await scan();
        onChanged(cached);
        return cached;
      });
    },
    /**
     * Let one stored file share its whole cast: it becomes the source of its
     * Storybook, and that Storybook wins characters other Storybooks also have.
     */
    preferSource: (fileName) => {
      if (typeof fileName !== 'string' || !fileName) throw new Error('Invalid NPC source.');
      return enqueue(async () => {
        const file = ((await scan()).previewIndex ?? []).find((entry) => entry.fileName === fileName);
        const books = file?.kind === 'storybook' ? [file.fileName]
          : file?.kind === 'session' ? file.sources.map((source) => source.storybookFileName) : [];
        if (!books.length) throw new Error('This file cannot share NPCs.');
        sourcePreferences = normalizedSourcePreferences({
          origins: { ...sourcePreferences.origins, ...Object.fromEntries(books.map((book) => [book, fileName])) },
          priority: [...books, ...sourcePreferences.priority],
        });
        if (saveSourcePreferences) await saveSourcePreferences(sourcePreferences);
        cached = await scan();
        onChanged(cached);
        return cached;
      });
    },
    reload: (names) => {
      return enqueue(async () => {
        useActiveStorybooks(names);
        try {
          await fs.mkdir(roots.user, { recursive: true });
        } catch {
          // The scan below returns a directory diagnostic without blocking startup.
        }
        cached = await scan();
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
