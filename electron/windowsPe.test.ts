import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyWindowsExecutable } from '../scripts/windows-pe.mjs';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function executable(machine: number) {
  const directory = await mkdtemp(path.join(tmpdir(), 'rpgraph-pe-test-'));
  directories.push(directory);
  const file = path.join(directory, 'fixture.exe');
  const buffer = Buffer.alloc(88);
  buffer.write('MZ');
  buffer.writeUInt32LE(64, 60);
  Buffer.from([0x50, 0x45, 0, 0]).copy(buffer, 64);
  buffer.writeUInt16LE(machine, 68);
  await writeFile(file, buffer);
  return file;
}

describe('Windows package executable verification', () => {
  it.each([0x014c, 0x8664, 0xaa64])('accepts a PE executable of the expected architecture %i', async (machine) => {
    await expect(verifyWindowsExecutable(await executable(machine), machine)).resolves.toBeUndefined();
  });

  it('rejects x64 code in an ARM64 installer payload', async () => {
    await expect(verifyWindowsExecutable(await executable(0x8664), 0xaa64))
      .rejects.toThrow('Unexpected Windows executable architecture');
  });

  it('rejects truncated or non-Windows artifacts', async () => {
    const file = await executable(0x8664);
    await writeFile(file, 'incomplete download');
    await expect(verifyWindowsExecutable(file, 0x8664)).rejects.toThrow('Truncated Windows executable');
    await writeFile(file, Buffer.alloc(88));
    await expect(verifyWindowsExecutable(file, 0x8664)).rejects.toThrow('Missing Windows executable header');
  });
});
