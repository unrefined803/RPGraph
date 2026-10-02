import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStaticAppImageRuntime } from './appimage-runtime.mjs';
import { sha256, verifyPackageContent } from './package-content.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function verifyAppImage() {
  assert.ok(process.platform === 'linux' && process.arch === 'x64',
    'Verify the Linux x86_64 AppImage on a Linux x86_64 host.');
  assert.equal(process.argv.length, 2, 'Usage: npm run package:linux:verify');
  const metadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const artifactName = `RPGraph-Studio-${metadata.version}-x86_64.AppImage`;
  const artifact = path.join(projectRoot, 'release', artifactName);
  // A checksum from an earlier build must not survive a failed verification.
  await rm(`${artifact}.sha256`, { force: true });
  await access(artifact, constants.X_OK);
  await verifyStaticAppImageRuntime(artifact);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'rpgraph-appimage-'));
  try {
    // Only the AppImage extraction mode runs; Electron and AppRun are never started.
    execFileSync(artifact, ['--appimage-extract'], {
      cwd: temporaryDirectory,
      stdio: 'ignore',
      timeout: 600_000,
    });
    const appDirectory = path.join(temporaryDirectory, 'squashfs-root');
    await access(path.join(appDirectory, 'AppRun'), constants.X_OK);
    await access(path.join(appDirectory, 'rpgraph-studio'), constants.X_OK);
    const desktop = await readFile(path.join(appDirectory, metadata.desktopName), 'utf8');
    assert.match(desktop, /^Exec=AppRun(?: .*)?$/m);
    assert.match(desktop, /^Icon=rpgraph-studio$/m);
    assert.match(desktop, /^StartupWMClass=rpgraph-studio$/m);

    await verifyPackageContent(projectRoot, appDirectory, metadata, ['libffmpeg.so']);
    const checksum = await sha256(artifact);
    await writeFile(`${artifact}.sha256`, `${checksum}  ${artifactName}\n`);
    console.log(`Linux package verified: release/${artifactName}`);
    console.log(`SHA-256 checksum written: release/${artifactName}.sha256`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

verifyAppImage().catch((error) => {
  console.error(`Linux package verification failed: ${error.message}`);
  process.exitCode = 1;
});
