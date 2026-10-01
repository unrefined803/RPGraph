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
  sessionCipherAad: Buffer.from('rpgraph-encrypted-session:v2.1'),
  workflowCipherAad: Buffer.from('rpgraph-encrypted-workflow:v2'),
  storybookCipherAad: Buffer.from('rpgraph-encrypted-storybook:v1'),
  characterCardCipherAad: Buffer.from('rpgraph-encrypted-character:v1'),
  unsupportedSessionFormatError: () => new Error('Unsupported session'),
  unsupportedWorkflowFormatError: () => new Error('Unsupported workflow'),
  unsupportedStorybookFormatError: () => new Error('Unsupported storybook'),
  unsupportedCharacterCardFormatError: () => new Error('Unsupported character'),
});

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

async function filesystemHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rpgraph-encrypted-paths-'));
  temporary.push(root);
  const handlers: Record<string, (event: object, request: object) => Promise<{ filePath: string }>> = {};
  const writes: { filePath: string; contents: string }[] = [];
  const between = (start: string, end: string) => main.slice(main.indexOf(start), main.indexOf(end));
  const context = {
    ...api,
    ...require('./sessionFormat.cjs'), ...require('./workflowFormat.cjs'),
    ...require('./storybookFormat.cjs'), ...require('./characterCardFormat.cjs'),
    ...require('./fileNames.cjs'),
    fs: { ...fs, writeFile: async (filePath: string, contents: string, options: Parameters<typeof fs.writeFile>[2]) => {
      writes.push({ filePath, contents });
      return fs.writeFile(filePath, contents, options);
    } },
    fsSync, path, crypto, process, console,
    jsonFileExtension: '.json',
    ipcMain: { handle: (channel: string, handler: typeof handlers[string]) => { handlers[channel] = handler; } },
    localAccounts: { root },
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
    approveFilePath: (value: string) => value,
    validateFilePath: (value: string) => value,
    normalizedFilePath: (value: string) => value,
    isStoredFilePath: () => false,
    dialog: { showSaveDialog: async ({ defaultPath }: { defaultPath: string }) => ({
      canceled: false, filePath: path.join(root, 'external', path.basename(defaultPath)),
    }) },
  };
  const helpers = between('function handleWorkspace(', 'function makeNpcLibraryService(') +
    between('function storedJsonName(', 'async function readStoredFileMetadata(') +
    between('async function assertOverwriteType(', 'async function workflowFiles(') +
    between('async function readRpgraphFile(', '\nfunction endpoint(');
  const routes = between("handleWorkspace('workflow:save-named'", "ipcMain.handle('character:detect-face'") +
    between("handleWorkspace('character:save'", "ipcMain.handle('text-file:load'") +
    between("handleWorkspace('session:save'", "ipcMain.handle('image:select'") +
    between("handleWorkspace('session:save-current'", 'async function loadFilePathRequest(');
  const read = runInNewContext(`${helpers}${routes}; readRpgraphFile`, context);
  return { root, handlers, writes, read };
}

const cases = [
  { kind: 'Session', payload: { format: 'rpgraph-session', formatVersion: require('./sessionFormat.cjs').currentSessionFormatVersion,
    workflow: { formatVersion: require('./sessionFormat.cjs').currentSessionWorkflowFormatVersion }, timeline: [] } },
  { kind: 'Workflow', payload: { format: 'rpgraph-workflow', formatVersion: require('./workflowFormat.cjs').currentWorkflowFormatVersion } },
  { kind: 'Storybook', payload: { format: 'rpgraph-storybook', version: require('./storybookFormat.cjs').currentStorybookFormatVersion } },
  { kind: 'CharacterCard', payload: { format: 'rpgraph-character', version: require('./characterCardFormat.cjs').currentCharacterCardFormatVersion,
    character: { id: 'character', name: 'Public character name' } } },
];

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
      if (write.filePath.includes('workflow-state.json')) continue;
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
