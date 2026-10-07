import { afterEach, expect, it, vi } from 'vitest';
import fsSync, { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const main = readFileSync(new URL('./main.cjs', import.meta.url), 'utf8');
const source = main.slice(main.indexOf('async function deriveFileKey('), main.indexOf('async function readRpgraphFile('));
const keys: Buffer[] = [];
const trackedCrypto = {
  ...crypto,
  scrypt: (password: string, salt: Buffer, length: number, options: crypto.ScryptOptions,
    callback: (error: Error | null, key: Buffer) => void) => crypto.scrypt(password, salt, length, options, (error, key) => {
    if (key) keys.push(key);
    callback(error, key);
  }),
};
const api = runInNewContext(`${source}; ({ encryptSession, decryptSession, encryptWorkflow, decryptWorkflow,
  encryptStorybook, decryptStorybook, encryptCharacterCard, decryptCharacterCard, createFileCipher, decryptedFileJson })`, {
  crypto: trackedCrypto, Buffer,
  ...require('./encryptionFormat.cjs'),
  ...require('./sessionFormat.cjs'),
  ...require('./workflowFormat.cjs'),
  ...require('./storybookFormat.cjs'),
  ...require('./characterCardFormat.cjs'),
  sessionCipherAad: Buffer.from('rpgraph-encrypted-session:v3.0'),
  workflowCipherAad: Buffer.from('rpgraph-encrypted-workflow:v3.0'),
  storybookCipherAad: Buffer.from('rpgraph-encrypted-storybook:v2.0'),
  characterCardCipherAad: Buffer.from('rpgraph-encrypted-character:v2.0'),
  unsupportedSessionFormatError: () => new Error('Unsupported session'),
  unsupportedWorkflowFormatError: () => new Error('Unsupported workflow'),
  unsupportedStorybookFormatError: () => new Error('Unsupported storybook'),
  unsupportedCharacterCardFormatError: () => new Error('Unsupported character'),
});

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function filesystemHarness(accountPassword?: string) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'rpgraph-encrypted-paths-'));
  temporary.push(userData);
  const localAccounts = require('./localAccounts.cjs').createLocalAccounts(userData);
  if (accountPassword) await localAccounts.create('alice', accountPassword);
  else await localAccounts.useLocal();
  const root = localAccounts.root;
  const handlers: Record<string, (event: object, request: object) => Promise<{ filePath: string }>> = {};
  const writes: { filePath: string; contents: string }[] = [];
  const between = (start: string, end: string) => main.slice(main.indexOf(start), main.indexOf(end));
  const context = {
    ...api,
    decryptWorkflow: vi.fn(api.decryptWorkflow),
    decryptStorybook: vi.fn(api.decryptStorybook),
    decryptSession: vi.fn(api.decryptSession),
    decryptCharacterCard: vi.fn(api.decryptCharacterCard),
    ...require('./sessionFormat.cjs'), ...require('./workflowFormat.cjs'),
    ...require('./storybookFormat.cjs'), ...require('./characterCardFormat.cjs'),
    ...require('./fileNames.cjs'), ...require('./filenamePrivacy.cjs'),
    fs: { ...fs, writeFile: async (filePath: string, contents: string, options: Parameters<typeof fs.writeFile>[2]) => {
      writes.push({ filePath, contents });
      return fs.writeFile(filePath, contents, options);
    } },
    fsSync, path, crypto, process, console, Buffer,
    jsonFileExtension: '.json',
    ipcMain: { handle: (channel: string, handler: typeof handlers[string]) => { handlers[channel] = handler; } },
    localAccounts,
    workspaceOperations: require('./workspaceOperations.cjs').createWorkspaceOperations(),
    workspaceProtection: require('./workspaceProtection.cjs').createWorkspaceProtection(),
    npcLibraryService: { reload: vi.fn(async () => {}) },
    filesDirectory: () => path.join(root, 'files'),
    storedFileDirectory: (storage: string) => path.join(root, storage),
    workflowStateFilePath: () => path.join(root, 'workflow-state.json'),
    importedDefaultFileNamesFromState: () => [],
    validatedStoredFileName: (name: string) => path.basename(name),
    safeSessionBaseName: (name: string) => name,
    approveWorkflowPath: (value: string) => value,
    validateWorkflowPath: (value: string) => value,
    approveFilePath: (value: string) => value,
    validateFilePath: (value: string) => value,
    normalizedFilePath: (value: string) => value,
    isStoredFilePath: () => false,
    dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })), showSaveDialog: async ({ defaultPath }: { defaultPath: string }) => ({
      canceled: false, filePath: path.join(root, 'external', path.basename(defaultPath)),
    }) },
  };
  const helpers = between('function handleWorkspace(', 'function makeNpcLibraryService(') +
    between('function storedJsonName(', 'async function assertOverwriteType(') +
    between('async function listedFilesInDirectory(', 'function isStoredFilePath(') +
    between('async function assertOverwriteType(', 'async function workflowFiles(') +
    between('async function readRpgraphFile(', '\nfunction endpoint(');
  const routes = between("handleWorkspace('workflow:save-named'", "ipcMain.handle('text-file:load'") +
    between("handleWorkspace('workflow:save-current'", "handleWorkspace('settings:load'") +
    between("handleWorkspace('session:save'", "ipcMain.handle('image:select'") +
    between('async function loadStoredFileRequest(', "ipcMain.handle('window:minimize'");
  const loaded = runInNewContext(`${helpers}${routes}; ({ read: readRpgraphFile, list: listedFilesInDirectory,
    display: storedDisplayName, filenameParameters: filenameEncryptionMetadata })`, context);
  return { root, handlers, writes, localAccounts, context, ...loaded };
}

const cases = [
  { kind: 'Session', payload: { format: 'rpgraph-session', formatVersion: require('./sessionFormat.cjs').currentSessionFormatVersion,
    metadata: { workflowDisplayName: 'Private workflow title', storybookDisplayNames: { book: 'Private storybook title' } },
    workflow: { formatVersion: require('./sessionFormat.cjs').currentSessionWorkflowFormatVersion }, timeline: [] } },
  { kind: 'Workflow', payload: { format: 'rpgraph-workflow', formatVersion: require('./workflowFormat.cjs').currentWorkflowFormatVersion } },
  { kind: 'Storybook', payload: { format: 'rpgraph-storybook', version: require('./storybookFormat.cjs').currentStorybookFormatVersion } },
  { kind: 'CharacterCard', payload: { format: 'rpgraph-character', version: require('./characterCardFormat.cjs').currentCharacterCardFormatVersion,
    character: { id: 'character', name: 'Public character name' } } },
];

it.each(cases.flatMap(value => [false, true].map(chosenPath => ({ ...value, chosenPath }))))(
  'protects $kind filenames in account save/list/load/overwrite/delete paths (chosen path: $chosenPath)',
  async ({ kind, payload, chosenPath }) => {
    const password = 'account-secret';
    const disk = await filesystemHarness(password);
    const fileKind = kind === 'CharacterCard' ? 'character' : kind.toLowerCase();
    const field = kind === 'CharacterCard' ? 'characterCard' : fileKind;
    const channel = chosenPath ? 'file:save-to-path' : kind === 'Workflow' ? 'workflow:save-named' : `${fileKind}:save`;
    const request = { name: 'Confidential-title', kind: fileKind, [field]: payload, protection: 'encrypted', password };
    const saved = await disk.handlers[channel]({}, request);
    const prefix = { Session: 'RP2xQ', Workflow: 'WF2xQ', Storybook: 'SB2xQ', CharacterCard: 'CH2xQ' }[kind];
    const fileName = path.basename(saved.filePath);
    expect(fileName).toMatch(new RegExp(`^${prefix}[A-Za-z0-9_-]+\\.json$`));
    expect(fileName).not.toContain(request.name);
    const folder = path.dirname(saved.filePath);
    const storage = kind === 'CharacterCard' && !chosenPath ? 'characters' : 'files';
    const files = await disk.list(folder, storage);
    expect(files[0]).toMatchObject({ fileName, name: request.name, compatible: true });
    for (const decrypt of [disk.context.decryptWorkflow, disk.context.decryptStorybook,
      disk.context.decryptSession, disk.context.decryptCharacterCard]) expect(decrypt).not.toHaveBeenCalled();
    const contents = await fs.readFile(saved.filePath, 'utf8');
    expect(contents).not.toContain(request.name);
    if (kind === 'Session') {
      expect(contents).not.toContain(payload.metadata!.workflowDisplayName);
      expect(contents).not.toContain(payload.metadata!.storybookDisplayNames.book);
    }
    if (kind === 'CharacterCard') expect(contents).not.toContain(payload.character!.name);
    if (kind === 'Workflow' && !chosenPath) {
      const state = await fs.readFile(path.join(disk.root, 'workflow-state.json'), 'utf8');
      expect(state).toContain(fileName);
      expect(state).not.toContain(request.name);
    }
    // Loading via the actual IPC path uses the physical name and returns the
    // decrypted name without serializing either the password or plaintext.
    if (!chosenPath) {
      const loaded = await disk.handlers['file:load']({}, { fileName, storage, password });
      expect(loaded).toMatchObject({ name: request.name, value: payload });
      const conflict = await disk.handlers[channel]({}, request);
      expect(conflict).toMatchObject({ conflict: true, fileName, name: request.name });
    }
    const overwrite = await disk.handlers[channel]({}, { ...request, overwrite: true });
    expect(overwrite.filePath).toBe(saved.filePath);
    expect((await fs.readdir(folder)).filter(name => name.endsWith('.json'))).toHaveLength(1);
    expect(await disk.read(saved.filePath, password)).toMatchObject({ value: payload });
    if (!chosenPath) {
      await disk.handlers['file:delete']({}, { fileName, storage });
      await expect(fs.readFile(saved.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  },
);

it('requires confirmation before replacing a different resolved file in a chosen folder', async () => {
  const disk = await filesystemHarness('account-secret');
  const request = { kind: 'workflow', name: 'Existing-story', workflow: cases[1].payload,
    protection: 'encrypted', password: 'account-secret' };
  const save = disk.handlers['file:save-to-path'];
  const first = await save({}, request);
  const original = await fs.readFile(first.filePath, 'utf8');
  expect(disk.context.dialog.showMessageBox).not.toHaveBeenCalled();
  const changed = { ...request, workflow: { ...request.workflow, privateText: 'Updated content' } };
  disk.context.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });

  expect(await save({}, changed)).toEqual({ canceled: true });
  expect(await fs.readFile(first.filePath, 'utf8')).toBe(original);
  expect(disk.context.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
    buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0,
  }));

  expect(await save({}, changed)).toMatchObject({ filePath: first.filePath });
  expect(await disk.read(first.filePath, 'account-secret')).toMatchObject({ value: changed.workflow });
  expect(await fs.readdir(path.dirname(first.filePath))).toHaveLength(1);
});

it('keeps plaintext names for disabled account privacy, manual passwords, and plain exports', async () => {
  const disk = await filesystemHarness('account-secret');
  const request = { name: 'Readable-title', workflow: cases[1].payload, protection: 'encrypted', password: 'manual-secret' };
  const save = disk.handlers['workflow:save-named'];
  expect(await save({}, request)).toMatchObject({ filePath: path.join(disk.root, 'files', 'Readable-title.json') });
  await disk.localAccounts.setFilenamePrivacy(false);
  expect(await save({}, { ...request, name: 'Disabled-title', password: 'account-secret' })).toMatchObject({
    filePath: path.join(disk.root, 'files', 'Disabled-title.json'),
  });
  await disk.localAccounts.setFilenamePrivacy(true);
  expect(await save({}, { ...request, name: 'Plain-title', protection: 'plain' })).toMatchObject({
    filePath: path.join(disk.root, 'files', 'Plain-title.json'),
  });
  // An existing file is not silently renamed by changing the account preference.
  expect(await save({}, { ...request, name: 'Disabled-title', password: 'account-secret', overwrite: true })).toMatchObject({
    filePath: path.join(disk.root, 'files', 'Disabled-title.json'),
  });
});

it('keeps foreign filenames locked until manual unlock and rekeys them when saving with the account password', async () => {
  const disk = await filesystemHarness('account-secret');
  const foreign = require('./filenamePrivacy.cjs').createFilenameCipher('foreign-secret', crypto.randomBytes(16));
  const fileName = await foreign.encode('Foreign-title', 'workflow');
  foreign.dispose();
  const folder = path.join(disk.root, 'files');
  const filePath = path.join(folder, fileName);
  await fs.writeFile(filePath, JSON.stringify(await api.encryptWorkflow(cases[1].payload, 'foreign-secret')));
  expect((await disk.list(folder, 'files'))[0].name).toBe('Encrypted Workflow (open to unlock)');
  const loaded = await disk.handlers['file:load']({}, { fileName, storage: 'files', password: 'foreign-secret' });
  expect(loaded).toMatchObject({ name: 'Foreign-title', value: cases[1].payload });
  expect((await disk.list(folder, 'files'))[0].name).toBe('Foreign-title');
  const saved = await disk.handlers['workflow:save-named']({}, { name: fileName, workflow: cases[1].payload,
    protection: 'encrypted', password: 'account-secret', overwrite: true });
  expect(saved.filePath).not.toBe(filePath);
  await expect(fs.readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await disk.read(saved.filePath, 'account-secret')).toMatchObject({ value: cases[1].payload });
  disk.localAccounts.prepare();
  await disk.localAccounts.unlock('alice', 'account-secret');
  expect((await disk.list(folder, 'files'))[0].name).toBe('Foreign-title');
});

it('serializes same-name saves and handles long Unicode names without oversized temporary filenames', async () => {
  const disk = await filesystemHarness('account-secret');
  const request = { name: 'é'.repeat(64), workflow: cases[1].payload, protection: 'encrypted', password: 'account-secret' };
  const saved = await Promise.all([disk.handlers['workflow:save-named']({}, request), disk.handlers['workflow:save-named']({}, request)]);
  expect(saved.filter(value => 'conflict' in value)).toHaveLength(1);
  const files = await disk.list(path.join(disk.root, 'files'), 'files');
  expect(files).toHaveLength(1);
  expect(files[0].name).toBe(request.name);
  for (const write of disk.writes) expect(Buffer.byteLength(path.basename(write.filePath))).toBeLessThan(255);
});

it('rekeys foreign RP quick saves and returns their replacement physical path', async () => {
  const disk = await filesystemHarness('account-secret');
  const foreign = require('./filenamePrivacy.cjs').createFilenameCipher('foreign-secret', crypto.randomBytes(16));
  const fileName = await foreign.encode('Foreign-RP', 'session');
  foreign.dispose();
  const filePath = path.join(disk.root, 'files', fileName);
  await fs.writeFile(filePath, JSON.stringify(await api.encryptSession(cases[0].payload, 'foreign-secret')));
  await disk.handlers['file:load']({}, { fileName, storage: 'files', password: 'foreign-secret' });
  const saved = await disk.handlers['session:save-current']({}, { filePath, session: cases[0].payload,
    protection: 'encrypted', password: 'account-secret' });
  expect(saved).toMatchObject({ name: 'Foreign-RP' });
  expect(saved.filePath).not.toBe(filePath);
  await expect(fs.readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await disk.read(saved.filePath, 'account-secret')).toMatchObject({ value: cases[0].payload });
});

it('refuses ambiguous display-name overwrites and rekey collisions without changing sources', async () => {
  const disk = await filesystemHarness('account-secret');
  const folder = path.join(disk.root, 'files');
  const request = { name: 'Duplicate', workflow: cases[1].payload, protection: 'encrypted', password: 'account-secret' };
  const first = await disk.handlers['workflow:save-named']({}, request);
  const secondName = await disk.localAccounts.encodeFileName('Duplicate', 'workflow');
  const before = await fs.readFile(first.filePath, 'utf8');
  await fs.writeFile(path.join(folder, secondName), JSON.stringify({ ...JSON.parse(before),
    filenameEncryption: disk.localAccounts.filenameMetadata(secondName) }));
  await expect(disk.handlers['workflow:save-named']({}, { ...request, overwrite: true })).rejects.toThrow('Several files');
  expect(await fs.readFile(first.filePath, 'utf8')).toBe(before);
  await disk.handlers['workflow:save-named']({}, { ...request, name: secondName, overwrite: true });
  const foreign = require('./filenamePrivacy.cjs').createFilenameCipher('foreign-secret', crypto.randomBytes(16));
  const foreignName = await foreign.encode('Existing', 'workflow');
  foreign.dispose();
  const foreignPath = path.join(folder, foreignName);
  await fs.writeFile(foreignPath, JSON.stringify(await api.encryptWorkflow(cases[1].payload, 'foreign-secret')));
  await fs.writeFile(path.join(folder, 'Existing.json'), JSON.stringify(cases[1].payload));
  await disk.handlers['file:load']({}, { fileName: foreignName, storage: 'files', password: 'foreign-secret' });
  await disk.localAccounts.setFilenamePrivacy(false);
  await expect(disk.handlers['workflow:save-named']({}, { ...request, name: foreignName, overwrite: true })).rejects.toThrow('replacement filename already exists');
  expect(await disk.read(foreignPath, 'foreign-secret')).toMatchObject({ value: cases[1].payload });
  expect(JSON.parse(await fs.readFile(path.join(folder, 'Existing.json'), 'utf8'))).toEqual(cases[1].payload);
});

it('recovers compact names from a bounded header after restart without reading or decrypting the payload', async () => {
  const disk = await filesystemHarness('account-secret');
  const request = { name: 'PrivateStoryName1234', workflow: { ...cases[1].payload, privateText: 'Private content '.repeat(10000) },
    protection: 'encrypted', password: 'account-secret' };
  const saved = await disk.handlers['workflow:save-named']({}, request);
  const fileName = path.basename(saved.filePath);
  expect(fileName).toHaveLength(58);
  const contents = await fs.readFile(saved.filePath, 'utf8');
  expect(JSON.parse(contents.slice(0, contents.indexOf('"ciphertext"')) + '"ciphertext":"unused"}').filenameEncryption.format).toBe('rpgraph-filename-v2');
  disk.localAccounts.prepare();
  await disk.localAccounts.unlock('alice', 'account-secret');
  const reads: number[] = [];
  const originalOpen = disk.context.fs.open;
  disk.context.fs.open = async (...args: Parameters<typeof fs.open>) => {
    const file = await originalOpen(...args);
    const originalRead = file.read.bind(file);
    file.read = async (buffer: Buffer, offset: number, length: number, position: number) => {
      reads.push(length);
      return originalRead(buffer, offset, length, position);
    };
    return file;
  };
  disk.context.fs.readFile = vi.fn(async () => { throw new Error('A full payload read must not be needed for its name.'); });
  expect(await disk.display(fileName, undefined, undefined, saved.filePath)).toBe(request.name);
  expect(reads).toEqual([4096]);
  expect(disk.context.fs.readFile).not.toHaveBeenCalled();
  expect(disk.context.decryptWorkflow).not.toHaveBeenCalled();
});

it('unlocks a foreign compact name and preserves its header when rekeying for the account', async () => {
  const disk = await filesystemHarness('account-secret');
  const cipher = require('./filenamePrivacy.cjs').createFilenameCipher('foreign-secret', crypto.randomBytes(16));
  const compact = await cipher.encodeCompact('Foreign-compact', 'workflow');
  cipher.dispose();
  const folder = path.join(disk.root, 'files');
  const filePath = path.join(folder, compact.fileName);
  await fs.writeFile(filePath, JSON.stringify({ filenameEncryption: compact.metadata,
    ...await api.encryptWorkflow(cases[1].payload, 'foreign-secret') }));
  expect((await disk.list(folder, 'files'))[0].name).toBe('Encrypted Workflow (open to unlock)');
  expect(await disk.handlers['file:load']({}, { fileName: compact.fileName, storage: 'files', password: 'foreign-secret' })).toMatchObject({ name: 'Foreign-compact' });
  const saved = await disk.handlers['workflow:save-named']({}, { name: compact.fileName, workflow: cases[1].payload,
    protection: 'encrypted', password: 'account-secret', overwrite: true });
  expect(saved.filePath).not.toBe(filePath);
  disk.localAccounts.prepare();
  await disk.localAccounts.unlock('alice', 'account-secret');
  expect((await disk.list(folder, 'files'))[0].name).toBe('Foreign-compact');
});

it('keeps the filename header on disk and out of plain payloads across plain overwrites', async () => {
  const disk = await filesystemHarness('account-secret');
  const workflow = cases[1].payload;
  const saved = await disk.handlers['workflow:save-named']({}, { name: 'Private-title', workflow,
    protection: 'encrypted', password: 'account-secret' });
  const fileName = path.basename(saved.filePath);
  await disk.handlers['workflow:save-named']({}, { name: fileName, workflow, protection: 'plain', overwrite: true });
  await disk.handlers['workflow:save-current']({}, { filePath: saved.filePath, workflow });

  expect(JSON.parse(await fs.readFile(saved.filePath, 'utf8')).filenameEncryption.format).toBe('rpgraph-filename-v2');
  const loaded = await disk.handlers['file:load']({}, { fileName, storage: 'files', password: '' });
  expect(loaded).toMatchObject({ name: 'Private-title', protection: 'plain' });
  expect((loaded as unknown as { value: object }).value).toEqual(workflow);
});

it.each(['missing', 'changed'])('rejects a %s compact header even when the name and parameters were cached', async change => {
  const disk = await filesystemHarness('account-secret');
  const saved = await disk.handlers['workflow:save-named']({}, { name: 'Private-title', workflow: cases[1].payload,
    protection: 'encrypted', password: 'account-secret' });
  const fileName = path.basename(saved.filePath);
  expect(await disk.display(fileName, undefined, undefined, saved.filePath)).toBe('Private-title');
  const envelope = JSON.parse(await fs.readFile(saved.filePath, 'utf8'));
  if (change === 'missing') delete envelope.filenameEncryption;
  else envelope.filenameEncryption.iv = crypto.randomBytes(12).toString('base64');
  await fs.writeFile(saved.filePath, JSON.stringify(envelope));

  expect(await disk.display(fileName, undefined, undefined, saved.filePath)).toBe('Encrypted Workflow (open to unlock)');
  await expect(disk.handlers['workflow:save-named']({}, { name: fileName, workflow: cases[1].payload,
    protection: 'encrypted', password: 'account-secret', overwrite: true })).rejects.toThrow('Unlock this protected filename');
  expect(await disk.read(saved.filePath, 'account-secret')).toMatchObject({ value: cases[1].payload });
});

it('shortens legacy account filenames on an explicit protected overwrite', async () => {
  const disk = await filesystemHarness('account-secret');
  const cipher = require('./filenamePrivacy.cjs').createFilenameCipher('account-secret', crypto.randomBytes(16));
  const name = 'PrivateStoryName1234';
  const fileName = await cipher.encode(name, 'workflow');
  cipher.dispose();
  const filePath = path.join(disk.root, 'files', fileName);
  await fs.writeFile(filePath, JSON.stringify(await api.encryptWorkflow(cases[1].payload, 'account-secret')));
  expect(fileName).toHaveLength(96);
  const saved = await disk.handlers['workflow:save-named']({}, { name: fileName, workflow: cases[1].payload,
    protection: 'encrypted', password: 'account-secret', overwrite: true });
  expect(path.basename(saved.filePath)).toHaveLength(58);
  await expect(fs.readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await disk.display(path.basename(saved.filePath), undefined, undefined, saved.filePath)).toBe(name);
});

it.each(cases)('reads legacy $kind envelopes with their original AAD and rejects version tampering', async ({ kind, payload }) => {
  const current = await api[`encrypt${kind}`](payload, 'legacy-password');
  const fileKind = kind === 'CharacterCard' ? 'character' : kind.toLowerCase();
  const legacyVersion = kind === 'Session' ? '2.1' : kind === 'Workflow' ? '2.0' : '1.0';
  const aadVersion = kind === 'Workflow' ? '2' : kind === 'Session' ? '2.1' : '1';
  const key = crypto.scryptSync('legacy-password', Buffer.from(current.salt, 'base64'), 32,
    { ...current.keyDerivationParameters, maxmem: 128 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(current.iv, 'base64'));
  key.fill(0);
  cipher.setAAD(Buffer.from(`rpgraph-encrypted-${fileKind}:v${aadVersion}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]).toString('base64');
  const legacy = { ...current, envelopeFormatVersion: legacyVersion, ciphertext,
    authenticationTag: cipher.getAuthTag().toString('base64'),
    ...(kind === 'CharacterCard' ? { characterName: payload.character!.name } : {}) };
  expect(await api[`decrypt${kind}`](legacy, 'legacy-password')).toEqual(payload);
  await expect(api[`decrypt${kind}`]({ ...legacy, envelopeFormatVersion: current.envelopeFormatVersion,
    ...(kind === 'CharacterCard' ? { characterName: undefined } : {}) }, 'legacy-password')).rejects.toThrow('Unable to unlock');
});

it.each(cases.flatMap(value => [false, true].map(chosenPath => ({ ...value, chosenPath }))))(
  'keeps $kind content encrypted throughout real save/temp-file/load paths (chosen path: $chosenPath)',
  async ({ kind, payload, chosenPath }) => {
    const disk = await filesystemHarness();
    const privateText = 'Private story and graph content';
    const media = `data:image/jpeg;base64,${Buffer.from('Private embedded media').toString('base64')}`;
    const value = { ...payload, privateText, media };
    const fileKind = kind === 'CharacterCard' ? 'character' : kind.toLowerCase();
    const field = kind === 'CharacterCard' ? 'characterCard' : fileKind;
    const channel = chosenPath ? 'file:save-to-path' : kind === 'Workflow' ? 'workflow:save-named' : `${fileKind}:save`;
    const request = { name: `${fileKind}-test`, kind: fileKind, [field]: value,
      protection: 'encrypted', password: 'account-or-file-password' };
    const result = await disk.handlers[channel]({}, request);
    expect(disk.writes.length).toBeGreaterThan(0);
    for (const write of disk.writes) {
      expect(write.contents).not.toContain(privateText);
      expect(write.contents).not.toContain(media);
      expect(write.contents).not.toContain('account-or-file-password');
      if ('lastWorkflowFileName' in JSON.parse(write.contents)) continue;
      expect(JSON.parse(write.contents).format).toMatch(/^rpgraph-encrypted-/);
      expect(write.filePath).toMatch(/\.tmp$/);
    }
    const beforeLoad = disk.writes.length;
    const loaded = await disk.read(result.filePath, request.password);
    expect(loaded.value).toEqual(value);
    await expect(disk.read(result.filePath, 'wrong-password')).rejects.toThrow('Unable to unlock');
    expect(disk.writes.length).toBe(beforeLoad);
    expect((await fs.readdir(path.dirname(result.filePath))).some(name => name.endsWith('.tmp'))).toBe(false);
    const original = await fs.readFile(result.filePath, 'utf8');
    await expect(disk.handlers[channel]({}, { ...request, password: '', overwrite: true })).rejects.toThrow('require a password');
    expect(await fs.readFile(result.filePath, 'utf8')).toBe(original);
    expect(disk.writes.length).toBe(beforeLoad);
    if (kind === 'Session') {
      await disk.handlers['session:save-current']({}, { ...request, filePath: result.filePath });
      expect(JSON.parse(await fs.readFile(result.filePath, 'utf8')).format).toBe('rpgraph-encrypted-session');
    }
  },
);

it.each(cases)('encrypts and authenticates $kind files without retaining temporary key buffers', async ({ kind, payload }) => {
  keys.length = 0;
  const value = { ...payload, privateText: 'Private narrative content' };
  const first = await api[`encrypt${kind}`](value, 'file-password');
  const second = await api[`encrypt${kind}`](value, 'file-password');
  expect(first.salt).not.toBe(second.salt);
  expect(first.iv).not.toBe(second.iv);
  expect(JSON.stringify(first)).not.toContain(value.privateText);
  expect(JSON.stringify(first)).not.toContain('file-password');
  expect(await api[`decrypt${kind}`](first, 'file-password')).toEqual(value);
  await expect(api[`decrypt${kind}`](first, 'wrong-password')).rejects.toThrow('Unable to unlock');
  const changed = Buffer.from(first.ciphertext, 'base64');
  changed[0] ^= 1;
  await expect(api[`decrypt${kind}`]({ ...first, ciphertext: changed.toString('base64') }, 'file-password')).rejects.toThrow('Unable to unlock');
  await expect(api[`decrypt${kind}`]({ ...first, authenticationTag: Buffer.alloc(4).toString('base64') }, 'file-password')).rejects.toThrow('Unsupported');
  expect(keys.length).toBe(5);
  expect(keys.every(key => key.equals(Buffer.alloc(32)))).toBe(true);
});

it('clears derived key buffers even when cipher initialization fails', async () => {
  keys.length = 0;
  await expect(api.createFileCipher('password', Buffer.alloc(16), Buffer.alloc(0), Buffer.from('aad'))).rejects.toThrow();
  expect(keys).toHaveLength(1);
  expect(keys[0].equals(Buffer.alloc(32))).toBe(true);
});

it.each(['valid', 'invalid-json', 'failed-authentication'])('clears temporary decrypted buffers on %s', (scenario) => {
  const chunk = Buffer.from(scenario === 'invalid-json' ? 'private invalid JSON' : '{"privateText":"narrative"}');
  const final = Buffer.alloc(0);
  const decipher = {
    update: () => chunk,
    final: vi.fn(() => {
      if (scenario === 'failed-authentication') throw new Error('Authentication failed');
      return final;
    }),
  };
  if (scenario === 'valid') expect(api.decryptedFileJson(decipher, 'YQ==')).toEqual({ privateText: 'narrative' });
  else expect(() => api.decryptedFileJson(decipher, 'YQ==')).toThrow();
  expect(chunk.equals(Buffer.alloc(chunk.length))).toBe(true);
});
