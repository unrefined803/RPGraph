import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesIn, sha256, verifyPackageContent } from './package-content.mjs';
import { verifyWindowsExecutable } from './windows-pe.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const { getPath7za } = appBuilderRequire('./toolsets/7zip');

async function verifyInstaller() {
  assert.equal(process.argv.length, 2, 'Usage: npm run package:windows:verify');
  const metadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const artifactName = `RPGraph-Studio-${metadata.version}-Windows-Setup.exe`;
  const artifact = path.join(projectRoot, 'release', artifactName);
  // A checksum from an earlier build must not survive a failed verification.
  await rm(`${artifact}.sha256`, { force: true });
  // NSIS uses an x86 installer stub to select the native x64 or ARM64 payload.
  await verifyWindowsExecutable(artifact, 0x014c);
  const sevenZip = await getPath7za();
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'rpgraph-windows-package-'));
  try {
    const installerDirectory = path.join(temporaryDirectory, 'installer');
    const extract = (archive, destination) => execFileSync(sevenZip,
      ['x', '-y', '-bd', `-o${destination}`, archive], { timeout: 600_000, maxBuffer: 2 * 1024 * 1024 });
    // Inspect the actual installer payload; do not run the installer or Electron.
    extract(artifact, installerDirectory);
    const files = await filesIn(installerDirectory);
    const uninstallers = files.filter((file) => /^Uninstall .*\.exe$/.test(path.posix.basename(file)));
    assert.equal(uninstallers.length, 1, 'Missing or ambiguous Windows uninstaller.');
    await verifyWindowsExecutable(path.join(installerDirectory, uninstallers[0]), 0x014c);
    assert.ok(!files.some((file) => path.posix.basename(file) === 'app-32.7z'),
      'Unexpected 32-bit installer payload.');
    for (const [archiveName, architecture, machine] of [
      ['app-64.7z', 'x64', 0x8664], ['app-arm64.7z', 'arm64', 0xaa64],
    ]) {
      const matches = files.filter((file) => path.posix.basename(file) === archiveName);
      assert.equal(matches.length, 1, `Missing or ambiguous installer payload: ${archiveName}`);
      const appDirectory = path.join(temporaryDirectory, architecture);
      await mkdir(appDirectory);
      extract(path.join(installerDirectory, matches[0]), appDirectory);
      await verifyWindowsExecutable(path.join(appDirectory, 'RPGraph-Studio.exe'), machine);
      await verifyPackageContent(projectRoot, appDirectory, metadata, ['ffmpeg.dll', 'resources/elevate.exe']);
      console.log(`Windows ${architecture} installer payload verified.`);
    }
    const checksum = await sha256(artifact);
    await writeFile(`${artifact}.sha256`, `${checksum}  ${artifactName}\n`);
    console.log(`Windows installer verified: release/${artifactName}`);
    console.log(`SHA-256 checksum written: release/${artifactName}.sha256`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

verifyInstaller().catch((error) => {
  console.error(`Windows installer verification failed: ${error.message}`);
  process.exitCode = 1;
});
