import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLocalAccounts } from './localAccounts.cjs';
import { createWorkspaceOperations } from './workspaceOperations.cjs';
import { runInNewContext } from 'node:vm';

const temporary: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpgraph-accounts-'));
  temporary.push(root);
  return root;
}

it('defaults legacy and new accounts to private names and persists only the account preference', async () => {
  const root = await fixture();
  const accounts = createLocalAccounts(root);
  await accounts.create('alice', 'secret');
  expect(accounts.filenamePrivacy).toBe(true);
  const fileName = await accounts.encodeFileName('Private-story', 'storybook');
  const metadata = accounts.filenameMetadata(fileName);
  expect(await accounts.decodeFileName(fileName, undefined, metadata)).toBe('Private-story');
  const accountPath = path.join(accounts.root, 'account.json');
  await accounts.setFilenamePrivacy(false);
  accounts.prepare();
  await accounts.unlock('alice', 'secret');
  expect(accounts.filenamePrivacy).toBe(false);
  expect(await accounts.decodeFileName(fileName, undefined, metadata)).toBe('Private-story');
  const record = JSON.parse(await readFile(accountPath, 'utf8'));
  expect(Object.keys(record).sort()).toEqual(['filenamePrivacy', 'salt', 'username', 'verifier', 'version']);
  delete record.filenamePrivacy;
  await writeFile(accountPath, JSON.stringify(record));
  accounts.prepare();
  await accounts.unlock('alice', 'secret');
  expect(accounts.filenamePrivacy).toBe(true);
  accounts.prepare();
  await accounts.useLocal();
  expect(accounts.filenamePrivacy).toBe(false);
  expect(await accounts.decodeFileName(fileName)).toBeUndefined();
  await expect(accounts.encodeFileName('Private-story', 'storybook')).rejects.toThrow('Sign in');
  await expect(accounts.setFilenamePrivacy(true)).rejects.toThrow('Sign in');
});

it('preserves the existing local workspace and separates multiple accounts across restarts', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'files'));
  await writeFile(path.join(root, 'files', 'existing.json'), 'original');
  const local = createLocalAccounts(root);
  expect(() => local.root).toThrow('sign in');
  await local.useLocal();
  expect(local.root).toBe(root);
  await createLocalAccounts(root).create('Alice', 'alice-secret');
  await createLocalAccounts(root).create('Bob', 'bob-secret');
  const restarted = createLocalAccounts(root);
  expect(await restarted.list()).toEqual([{ username: 'alice' }, { username: 'bob' }]);
  await expect(restarted.unlock('alice', 'bob-secret')).rejects.toThrow('Incorrect');
  expect(() => restarted.root).toThrow();
  await restarted.unlock('ALICE', 'alice-secret');
  expect(restarted.root).toBe(path.join(root, 'accounts', 'alice'));
  expect(restarted.password).toBe('alice-secret');
  expect(await readdir(path.join(restarted.root, 'files'))).toEqual([]);
  expect(await readFile(path.join(root, 'files', 'existing.json'), 'utf8')).toBe('original');
  expect(await readFile(path.join(restarted.root, 'account.json'), 'utf8')).not.toContain('alice-secret');
  await expect(restarted.unlock('bob', 'bob-secret')).rejects.toThrow('Restart');
  await expect(createLocalAccounts(root).create('ALICE', 'another')).rejects.toThrow('already exists');
});

it.each(['../files', '/tmp/test', 'a/b', 'a\\b', '.', 'CON', '', 'alice.json'])('rejects unsafe account name %s', async username => {
  await expect(createLocalAccounts(await fixture()).create(username, 'secret')).rejects.toThrow('username');
});

it('rejects symlink account directories', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'accounts'));
  await symlink(root, path.join(root, 'accounts', 'alice'), 'dir');
  await expect(createLocalAccounts(root).unlock('alice', 'secret')).rejects.toThrow('directory');
});

it('activates account setup directly from the local workspace', async () => {
  const accounts = createLocalAccounts(await fixture());
  await accounts.useLocal();
  accounts.prepare();
  expect(() => accounts.root).toThrow('sign in');
  await accounts.create('alice', 'secret');
  expect(accounts.active).toBe(true);
  accounts.prepare();
  expect(accounts.active).toBe(false);
  expect(() => accounts.root).toThrow('sign in');
  await accounts.unlock('alice', 'secret');
  expect(accounts.active).toBe(true);
});

it('requires the active account password before deleting its complete workspace', async () => {
  const root = await fixture();
  const accounts = createLocalAccounts(root);
  await accounts.create('alice', 'secret');
  await writeFile(path.join(accounts.root, 'files', 'private.json'), 'private');
  await createLocalAccounts(root).create('bob', 'other-secret');
  const accountFile = path.join(root, 'accounts', 'alice', 'account.json');

  await expect(accounts.delete('wrong')).rejects.toThrow('Incorrect account password');
  expect(accounts.active).toBe(true);
  await expect(readFile(accountFile, 'utf8')).resolves.toContain('alice');

  await expect(accounts.delete('secret')).resolves.toEqual({ username: 'alice' });
  expect(accounts.active).toBe(false);
  expect(await accounts.list()).toEqual([{ username: 'bob' }]);
  await expect(readFile(accountFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(path.join(root, 'accounts', 'alice', 'files', 'private.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await accounts.unlock('bob', 'other-secret');
  expect(accounts.root).toBe(path.join(root, 'accounts', 'bob'));
});

it('removes an incomplete new account so creation can be retried after a write failure', async () => {
  const root = await fixture();
  const accounts = createLocalAccounts(root);
  vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Disk full'));

  await expect(accounts.create('alice', 'secret')).rejects.toThrow('Disk full');
  expect(await accounts.list()).toEqual([]);
  expect(await readdir(path.join(root, 'accounts'))).toEqual([]);
  expect(() => accounts.root).toThrow('sign in');
  await expect(accounts.create('alice', 'secret')).resolves.toEqual({ username: 'alice' });
});

it('rejects workspace changes while account creation is pending', async () => {
  const accounts = createLocalAccounts(await fixture());
  const creation = accounts.create('alice', 'secret');
  expect(() => accounts.prepare()).toThrow('Wait');
  await expect(accounts.useLocal()).rejects.toThrow();
  await creation;
  accounts.prepare();
  await accounts.useLocal();
  expect(accounts.active).toBe(false);
  expect(accounts.password).toBe('');
});

it('routes global and account NPC exports to distinct directories', async () => {
  const root = await fixture();
  const localAccounts = createLocalAccounts(root);
  await localAccounts.create('alice', 'secret');
  const main = await readFile('electron/main.cjs', 'utf8');
  const source = main.slice(main.indexOf('function filesDirectory()'), main.indexOf('async function listedFilesInDirectory'));
  const resolveDirectory = runInNewContext(`${source}; storedFileDirectory`, {
    path, localAccounts,
    npcLibraryService: { current: () => ({ roots: { user: path.join(root, 'npc-characters') } }) },
  });
  expect(resolveDirectory('files')).toBe(path.join(root, 'accounts', 'alice', 'files'));
  expect(resolveDirectory('npc-characters')).toBe(path.join(root, 'npc-characters'));
  expect(resolveDirectory('account-npc-characters')).toBe(path.join(root, 'accounts', 'alice', 'npc-characters'));
});

it.each(['accounts:prepare', 'accounts:delete'])('%s releases cached characters and workspace access', async channel => {
  const localAccounts = createLocalAccounts(await fixture());
  await localAccounts.create('alice', 'secret');
  const main = await readFile('electron/main.cjs', 'utf8');
  const handlers: Record<string, (event?: unknown, request?: unknown) => Promise<unknown>> = {};
  const context = {
    ipcMain: { handle: (name: string, handler: typeof handlers[string]) => { handlers[name] = handler; } },
    localAccounts,
    workspaceOperations: createWorkspaceOperations(),
    settingsWriteQueue: Promise.resolve(),
    abortActiveLlmRequests: vi.fn(),
    approvedFilePaths: new Set(['private-file']),
    approvedWorkflowPaths: new Set(['private-workflow']),
    workspaceProtection: { activate: vi.fn() },
    npcLibraryService: { decryptedCharacters: ['private-character'] } as unknown,
  };
  const wrappers = main.slice(main.indexOf('function handleWorkspace('), main.indexOf('function makeNpcLibraryService('));
  runInNewContext(wrappers + main.slice(main.indexOf("ipcMain.handle('accounts:list'"), main.indexOf('\nfunction normalizedWorkflowPath')), context);

  let finish!: () => void;
  const originalRoot = localAccounts.root;
  const delayedWrite = vi.fn(async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    expect(localAccounts.root).toBe(originalRoot);
    await writeFile(path.join(localAccounts.root, 'files', 'pending.json'), 'pending data');
    context.approvedFilePaths.add('completed-write');
  });
  runInNewContext("handleWorkspace('test:write', delayedWrite)", { ...context, delayedWrite });
  const write = handlers['test:write']();
  await vi.waitFor(() => expect(delayedWrite).toHaveBeenCalledOnce());
  const transition = handlers[channel]({}, { password: 'secret' });
  await expect(handlers['test:write']()).rejects.toThrow('workspace change');
  expect(localAccounts.active).toBe(true);
  finish();
  await write;
  await transition;

  expect(localAccounts.password).toBe('');
  expect(context.npcLibraryService).toBeUndefined();
  expect(context.workspaceProtection.activate).toHaveBeenCalledWith('');
  expect(context.approvedFilePaths.size).toBe(0);
  expect(context.approvedWorkflowPaths.size).toBe(0);
  if (channel === 'accounts:delete') {
    await expect(readFile(path.join(originalRoot, 'files', 'pending.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } else {
    expect(await readFile(path.join(originalRoot, 'files', 'pending.json'), 'utf8')).toBe('pending data');
  }
});
