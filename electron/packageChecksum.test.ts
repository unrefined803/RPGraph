import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(platform: 'linux' | 'windows') {
  const root = mkdtempSync(path.join(tmpdir(), 'rpgraph-checksum-'));
  directories.push(root);
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'release'));
  // A junction also works without symlink privileges on Windows build hosts.
  symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  for (const script of ['package-content.mjs', 'appimage-runtime.mjs', 'windows-pe.mjs',
    `verify-${platform}-package.mjs`]) {
    copyFileSync(path.join(repositoryRoot, 'scripts', script), path.join(root, 'scripts', script));
  }
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  const artifact = path.join(root, 'release', platform === 'windows'
    ? 'RPGraph-Studio-1.2.3-Windows-Setup.exe' : 'RPGraph-Studio-1.2.3-x86_64.AppImage');
  writeFileSync(`${artifact}.sha256`, 'stale checksum');
  return { root, artifact };
}

describe('package checksum invalidation', () => {
  it('removes an earlier checksum when the Windows executable header is invalid', () => {
    const { root, artifact } = fixture('windows');
    writeFileSync(artifact, 'truncated');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-windows-package.mjs')],
      { encoding: 'utf8', timeout: 30_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Truncated Windows executable');
    expect(existsSync(`${artifact}.sha256`)).toBe(false);
  });

  it.skipIf(process.platform !== 'linux' || process.arch !== 'x64')(
    'removes an earlier checksum when the AppImage is missing', () => {
      const { root, artifact } = fixture('linux');
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-linux-package.mjs')],
        { encoding: 'utf8', timeout: 30_000 });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('ENOENT');
      expect(existsSync(`${artifact}.sha256`)).toBe(false);
    });
});
