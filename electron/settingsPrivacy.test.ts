import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { runInNewContext } from 'node:vm';

const main = readFileSync(new URL('./main.cjs', import.meta.url), 'utf8');
const settingsSource = main.slice(main.indexOf('function apiKeyEncryptionAvailable()'), main.indexOf('function windowStateFilePath()'));
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function harness(available = true, backend = 'gnome_libsecret') {
  const safeStorage = {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: vi.fn((key: string) => Buffer.from(`encrypted:${key}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace(/^encrypted:/, '')),
  };
  const functions = runInNewContext(`${settingsSource}; ({ settingsForDisk, settingsFromDisk, settingsHasEncryptedApiKeys, apiKeyEncryptionAvailable })`, {
    safeStorage, Buffer, structuredClone,
  });
  return { ...functions, safeStorage };
}

const payload = { format: 'electron-safe-storage', value: Buffer.from('encrypted:old-key').toString('base64') };
const settings = { options: { displayLanguage: 'English' }, connections: [{ id: 'provider', apiKey: 'private-key' }] };

it.each([[false, 'unknown'], [true, 'basic_text']])('keeps new API keys out of settings without secure storage (%s, %s)', (available, backend) => {
  const api = harness(available as boolean, backend as string);
  const disk = api.settingsForDisk(settings);
  expect(disk.connections[0].apiKey).toBe('');
  expect(JSON.stringify(disk)).not.toContain('private-key');
  expect(disk.apiKeyStorage).toBe('memory');
  expect(api.safeStorage.encryptString).not.toHaveBeenCalled();
  expect(settings.connections[0].apiKey).toBe('private-key');
});

it('encrypts keys with secure storage and returns decrypted keys only in memory', () => {
  const api = harness();
  const disk = api.settingsForDisk(settings);
  expect(disk.connections[0].apiKey).toBe('');
  expect(disk.connections[0].apiKeyEncrypted.format).toBe('electron-safe-storage');
  const loaded = api.settingsFromDisk(disk);
  expect(loaded.connections[0].apiKey).toBe('private-key');
  expect(api.settingsHasEncryptedApiKeys(loaded)).toBe(false);
});

it.each(['unavailable', 'different-keychain', 'unsupported-format'])('preserves unreadable keys and other settings across saves: %s', (failure) => {
  const api = harness(failure !== 'unavailable');
  if (failure === 'different-keychain') api.safeStorage.decryptString.mockImplementation(() => { throw new Error('Cannot decrypt'); });
  const savedPayload = failure === 'unsupported-format' ? { ...payload, format: 'future-format' } : payload;
  const disk = { ...settings, connections: [{ id: 'provider', apiKey: '', apiKeyEncrypted: savedPayload }] };
  const loaded = api.settingsFromDisk(disk);
  expect(loaded.options).toEqual(settings.options);
  expect(loaded.connections[0].apiKey).toBe('');
  expect(loaded.connections[0].apiKeyEncrypted).toEqual(savedPayload);
  expect(api.settingsHasEncryptedApiKeys(loaded)).toBe(true);
  expect(api.settingsForDisk(loaded).connections[0].apiKeyEncrypted).toEqual(savedPayload);
  loaded.connections[0].apiKey = 'replacement';
  if (failure !== 'unavailable') {
    expect(api.settingsForDisk(loaded).connections[0].apiKeyEncrypted).not.toEqual(savedPayload);
  }
});

it('can recover legacy basic_text payloads without using that backend for new saves', () => {
  const api = harness(true, 'basic_text');
  const loaded = api.settingsFromDisk({ connections: [{ apiKey: '', apiKeyEncrypted: payload }] });
  expect(loaded.connections[0].apiKey).toBe('old-key');
  expect(api.settingsForDisk(loaded).connections[0].apiKey).toBe('');
});

it('writes private atomic files with restrictive POSIX permissions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpgraph-private-write-'));
  temporary.push(root);
  const filePath = path.join(root, 'settings.json');
  const source = main.slice(main.indexOf('async function writeTextFileAtomically('), main.indexOf('async function writeNewTextFileAtomically('));
  const write = runInNewContext(`${source}; writeTextFileAtomically`, { fs, path, crypto, process, console });
  await write(filePath, 'private settings');
  expect(await readFile(filePath, 'utf8')).toBe('private settings');
  if (process.platform !== 'win32') expect((await stat(filePath)).mode & 0o777).toBe(0o600);
});
