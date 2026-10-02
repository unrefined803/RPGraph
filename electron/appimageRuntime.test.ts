import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyStaticAppImageRuntime } from '../scripts/appimage-runtime.mjs';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function runtime({ interpreter = false, needed = false, machine = 62 } = {}) {
  const buffer = Buffer.alloc(64 + 56 + 32);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]).copy(buffer);
  buffer.writeUInt16LE(3, 16);
  buffer.writeUInt16LE(machine, 18);
  buffer.writeBigUInt64LE(64n, 32);
  buffer.writeUInt16LE(56, 54);
  buffer.writeUInt16LE(1, 56);
  buffer.writeUInt32LE(interpreter ? 3 : 2, 64);
  buffer.writeBigUInt64LE(120n, 72);
  buffer.writeBigUInt64LE(32n, 96);
  buffer.writeBigInt64LE(needed ? 1n : 30n, 120);
  return buffer;
}

async function artifact(buffer: Buffer) {
  const directory = await mkdtemp(path.join(tmpdir(), 'rpgraph-runtime-test-'));
  directories.push(directory);
  const file = path.join(directory, 'fixture.AppImage');
  await writeFile(file, buffer);
  return file;
}

describe('static AppImage runtime verification', () => {
  it('accepts static PIE metadata without host shared-library dependencies', async () => {
    await expect(verifyStaticAppImageRuntime(await artifact(runtime()))).resolves.toBeUndefined();
  });

  it('rejects runtimes that require a system dynamic loader', async () => {
    await expect(verifyStaticAppImageRuntime(await artifact(runtime({ interpreter: true }))))
      .rejects.toThrow('system ELF interpreter');
  });

  it('rejects runtimes that link host libraries such as libfuse2', async () => {
    await expect(verifyStaticAppImageRuntime(await artifact(runtime({ needed: true }))))
      .rejects.toThrow('host shared libraries');
  });

  it('rejects a runtime for another CPU architecture', async () => {
    await expect(verifyStaticAppImageRuntime(await artifact(runtime({ machine: 183 }))))
      .rejects.toThrow('target x86_64');
  });

  it('rejects truncated program headers', async () => {
    await expect(verifyStaticAppImageRuntime(await artifact(runtime().subarray(0, 80))))
      .rejects.toThrow('Truncated AppImage runtime');
  });
});
