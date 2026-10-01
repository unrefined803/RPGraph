import { afterEach, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { createFilenameCipher, privateFileType } = require('./filenamePrivacy.cjs');
const sessions: { dispose: () => void }[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); });
function cipher(password = 'account-secret', salt = crypto.randomBytes(16)) {
  const session = createFilenameCipher(password, salt);
  sessions.push(session);
  return session;
}

it.each([
  ['workflow', 'WF1xQ'], ['session', 'RP1xQ'], ['character-card', 'CH1xQ'], ['storybook', 'SB1xQ'],
])('authenticates %s names and their five-character type marker', async (type, prefix) => {
  const session = cipher();
  const name = 'Private_Story_東京';
  const first = await session.encode(name, type);
  const second = await session.encode(name, type);
  expect(first).toMatch(new RegExp(`^${prefix}[A-Za-z0-9_-]+\\.json$`));
  expect(first).not.toContain('Private');
  expect(first).not.toBe(second);
  expect(privateFileType(first)).toBe(type);
  expect(await session.decode(first)).toBe(name);
  // Embedded salts make copies portable to another account with this password.
  expect(await cipher().decode(first)).toBe(name);
  expect(await cipher('wrong-password').decode(first)).toBeUndefined();
  const bytes = Buffer.from(first.slice(5, -5), 'base64url');
  bytes[bytes.length - 1] ^= 1;
  expect(await session.decode(`${prefix}${bytes.toString('base64url')}.json`)).toBeUndefined();
  const wrongType = type === 'workflow' ? 'SB1xQ' : 'WF1xQ';
  expect(await session.decode(wrongType + first.slice(5))).toBeUndefined();
});

it('bounds portable filename lengths and rejects malformed tokens', async () => {
  const session = cipher();
  const name = 'é'.repeat(64);
  const fileName = await session.encode(name, 'workflow');
  expect(fileName.length).toBe(240);
  expect(await session.decode(fileName)).toBe(name);
  await expect(session.encode('é'.repeat(65), 'workflow')).rejects.toThrow('128 UTF-8 bytes');
  for (const value of ['plain.json', 'WF1xQ.json', 'WF1xQ!!!!.json', fileName + '.json', fileName.replace('.json', '.txt')]) {
    expect(await session.decode(value)).toBeUndefined();
  }
  session.dispose();
  await expect(session.encode('Private', 'workflow')).rejects.toThrow('session has ended');
});

it.each(['workflow', 'session', 'character-card', 'storybook'])('authenticates compact %s names with only parameters in the header', async type => {
  const session = cipher();
  const name = 'PrivateStoryName1234';
  expect(Buffer.byteLength(name)).toBe(20);
  const { fileName, metadata } = await session.encodeCompact(name, type);
  expect(fileName).toHaveLength(58);
  expect(fileName.slice(2, 5)).toBe('2xQ');
  expect(JSON.stringify(metadata)).not.toContain(name);
  expect(Object.keys(metadata).sort()).toEqual(['format', 'iv', 'salt']);
  expect(await session.decode(fileName, metadata)).toBe(name);
  expect(await session.decode(fileName)).toBeUndefined();
  expect(await cipher().decode(fileName, metadata)).toBe(name);
  expect(await cipher('wrong-password').decode(fileName, metadata)).toBeUndefined();
  const changed = { ...metadata, iv: Buffer.alloc(12).toString('base64') };
  expect(await session.decode(fileName, changed)).toBeUndefined();
  expect(await session.decode(fileName, { ...metadata, salt: 'invalid' })).toBeUndefined();
  const bytes = Buffer.from(fileName.slice(5, -5), 'base64url');
  bytes[0] ^= 1;
  expect(await session.decode(fileName.slice(0, 5) + bytes.toString('base64url') + '.json', metadata)).toBeUndefined();
  const otherType = type === 'workflow' ? 'SB2xQ' : 'WF2xQ';
  expect(await session.decode(otherType + fileName.slice(5), metadata)).toBeUndefined();
  const longest = await session.encodeCompact('é'.repeat(64), type);
  expect(longest.fileName).toHaveLength(202);
  expect(await session.decode(longest.fileName, longest.metadata)).toBe('é'.repeat(64));
});

it('derives one RAM key for twenty names and clears it when the account closes', async () => {
  const keys: Buffer[] = [];
  let derivations = 0;
  const trackedCrypto = { ...crypto, scrypt: (...args: Parameters<typeof crypto.scrypt>) => {
    derivations += 1;
    const callback = args.pop() as (error: Error | null, key: Buffer) => void;
    crypto.scrypt(args[0]!, args[1]!, args[2]!, args[3]!, (error, key) => {
      if (key) keys.push(key);
      callback(error, key);
    });
  } };
  const module = { exports: {} as typeof import('./filenamePrivacy.cjs') };
  runInNewContext(readFileSync(new URL('./filenamePrivacy.cjs', import.meta.url), 'utf8'), {
    require: (id: string) => id === 'node:crypto' ? trackedCrypto : require(id), module, Buffer,
  });
  const session = module.exports.createFilenameCipher('secret', Buffer.alloc(16));
  sessions.push(session);
  const names = await Promise.all(Array.from({ length: 20 }, (_, index) => session.encodeCompact(`Story-${index}`, 'storybook')));
  expect(await Promise.all(names.map(({ fileName, metadata }) => session.decode(fileName, metadata)))).toEqual(
    Array.from({ length: 20 }, (_, index) => `Story-${index}`),
  );
  expect(derivations).toBe(1);
  expect(keys[0].equals(Buffer.alloc(32))).toBe(false);
  session.dispose();
  await Promise.resolve();
  expect(keys.every(key => key.equals(Buffer.alloc(32)))).toBe(true);
});
