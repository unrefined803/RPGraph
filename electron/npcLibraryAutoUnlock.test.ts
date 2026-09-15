import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

// Exercise the main-process file-opening boundary without starting Electron.
const main = readFileSync('electron/main.cjs', 'utf8');
const source = main.slice(main.indexOf('async function readRpgraphFile('), main.indexOf('\nfunction endpoint('));

function harness(type: string, protection: string, reject = false) {
  const unlock = vi.fn(async () => {});
  const decrypt = vi.fn(async () => {
    if (reject) throw new Error('Incorrect password');
    return { opened: true };
  });
  const context = {
    fs: { readFile: async () => '{}' },
    storedFileMetadata: () => ({ type, protection, compatible: true }),
    decryptWorkflow: decrypt, decryptStorybook: decrypt, decryptSession: decrypt, decryptCharacterCard: decrypt,
    npcLibraryService: { unlock },
  };
  const read = runInNewContext(`${source}\nreadRpgraphFile`, context) as (path: string, password: string) => Promise<unknown>;
  return { read, unlock, decrypt };
}

it.each(['workflow', 'storybook', 'session', 'character-card'])('does not unlock NPCs merely by reading a %s file', async (type) => {
  const valid = harness(type, 'encrypted');
  await valid.read('file.json', 'secret');
  expect(valid.unlock).not.toHaveBeenCalled();
  const invalid = harness(type, 'encrypted', true);
  await expect(invalid.read('file.json', 'wrong')).rejects.toThrow('Incorrect password');
  expect(invalid.unlock).not.toHaveBeenCalled();
  const plain = harness(type, 'plain');
  await plain.read('file.json', 'unused');
  expect(plain.unlock).not.toHaveBeenCalled();
});
