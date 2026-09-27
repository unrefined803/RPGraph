import { closeSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const electronBuilderRequire = createRequire(require.resolve('electron-builder'));
const builderRequire = createRequire(electronBuilderRequire.resolve('app-builder-lib'));
const squirrelRequire = createRequire(builderRequire.resolve('electron-builder-squirrel-windows'));
const installerRequire = createRequire(squirrelRequire.resolve('electron-winstaller'));
const temp = installerRequire('temp');
const asar = builderRequire('@electron/asar');
const directories: string[] = [];

afterEach(() => {
  temp.cleanupSync();
  asar.uncacheAll();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('packaging dependency compatibility', () => {
  it('uses the local cleanup adapter inside temp', () => {
    const tempRequire = createRequire(installerRequire.resolve('temp'));
    expect(tempRequire('rimraf')).toBe(require('rimraf'));
  });

  it('cleans tracked files and nested directories through temp callbacks', async () => {
    temp.track();
    const { createTempDir } = installerRequire('./temp-utils');
    const directory = await createTempDir('rpgraph-packaging-');
    directories.push(directory);
    mkdirSync(path.join(directory, 'nested'));
    writeFileSync(path.join(directory, 'nested', 'file.txt'), 'temporary');
    const file = temp.openSync('rpgraph-packaging-');
    closeSync(file.fd);
    directories.push(file.path);
    await new Promise<void>((resolve, reject) => {
      temp.cleanup((error: Error | null) => error ? reject(error) : resolve());
    });
    expect(existsSync(directory)).toBe(false);
    expect(existsSync(file.path)).toBe(false);
  });

  it('supports synchronous cleanup and already removed paths', () => {
    temp.track();
    const directory = temp.mkdirSync('rpgraph-packaging-');
    directories.push(directory);
    writeFileSync(path.join(directory, 'file.txt'), 'temporary');
    const missing = temp.mkdirSync('rpgraph-packaging-');
    rmSync(missing, { recursive: true });
    expect(temp.cleanupSync()).toEqual({ files: 0, dirs: 2 });
    expect(existsSync(directory)).toBe(false);
  });

  it('creates archives readable by builder and installer consumers', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'rpgraph-asar-'));
    directories.push(directory);
    const source = path.join(directory, 'app');
    mkdirSync(source);
    const metadata = JSON.stringify({ name: 'packaging-fixture', version: '1.0.0' });
    writeFileSync(path.join(source, 'package.json'), metadata);
    const archive = path.join(directory, 'app.asar');
    await asar.createPackage(source, archive);
    const { checkFileInArchive } = builderRequire('./asar/asarFileChecker');
    expect((await checkFileInArchive(archive, 'package.json', 'Fixture')).size)
      .toBe(Buffer.byteLength(metadata));
    expect(installerRequire('@electron/asar').extractFile(archive, 'package.json').toString())
      .toBe(metadata);
    const universalRequire = createRequire(builderRequire.resolve('@electron/universal'));
    const { generateAsarIntegrity } = universalRequire('./asar-utils');
    expect(generateAsarIntegrity(archive).hash).toMatch(/^[a-f0-9]{64}$/);
  });

  // @electron/universal's mergeASARs joins archive-relative entry paths with
  // path.sep before looking them up in the asar filesystem, which is only
  // ever POSIX-separated. On win32 that produces a leading "\" the archive
  // never had, so the lookup fails even though the merge itself is a
  // macOS-only (universal x64+arm64 binary) packaging step that never runs
  // on Windows in practice.
  it.skipIf(process.platform === 'win32')(
    'merges universal (x64+arm64) archives readable by installer consumers',
    async () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'rpgraph-asar-'));
      directories.push(directory);
      const source = path.join(directory, 'app');
      mkdirSync(source);
      const metadata = JSON.stringify({ name: 'packaging-fixture', version: '1.0.0' });
      writeFileSync(path.join(source, 'package.json'), metadata);
      const archive = path.join(directory, 'app.asar');
      await asar.createPackage(source, archive);
      const universalRequire = createRequire(builderRequire.resolve('@electron/universal'));
      const { mergeASARs } = universalRequire('./asar-utils');
      const merged = path.join(directory, 'merged.asar');
      await mergeASARs({ x64AsarPath: archive, arm64AsarPath: archive, outputAsarPath: merged });
      expect(asar.extractFile(merged, 'package.json').toString()).toBe(metadata);
    },
  );
});
