import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = appBuilderRequire('@electron/asar');

const archiveDirectories = ['dist', 'electron', 'shared', 'comfy-workflows/api-workflows-with-variables'];
const archiveFiles = ['LICENSE', 'package.json', 'src/assets/app-icons/rpgraph.ico',
  'src/assets/app-icons/rpgraph.png', 'src/session/formatVersions.json',
  'src/storybook/formatVersions.json', 'src/workflow/formatVersions.json'];
// electron-builder rewrites package.json, so its metadata is compared separately.
const rewrittenArchiveFiles = new Set(['package.json']);
const electronRuntimeFiles = ['chrome_100_percent.pak', 'icudtl.dat', 'locales/en-US.pak',
  'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin'];

export async function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await filesIn(path.join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Unexpected non-regular resource: ${relative}`);
    }
  }
  return files.sort();
}

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// The asar library resolves entries with the host path separator.
const archivePath = (relative) => relative.split('/').join(path.sep);

function archiveFileList(archive) {
  return asar.listPackage(archive)
    .map((entry) => entry.replaceAll('\\', '/').replace(/^\//, ''))
    .filter((entry) => !('files' in asar.statFile(archive, archivePath(entry))))
    .sort();
}

async function expectedArchiveFiles(projectRoot) {
  const expected = [...archiveFiles];
  for (const directory of archiveDirectories) {
    for (const file of await filesIn(path.join(projectRoot, directory))) {
      if (['electron', 'shared'].includes(directory) && !file.endsWith('.cjs')) continue;
      expected.push(`${directory}/${file}`);
    }
  }
  return expected.sort();
}

async function verifyResources(resources, source, target, projectRoot, selectedFiles) {
  const sourceDirectory = path.join(projectRoot, source);
  const expectedFiles = selectedFiles ?? await filesIn(sourceDirectory);
  const targetDirectory = path.join(resources, target);
  assert.deepEqual(await filesIn(targetDirectory), [...expectedFiles].sort(),
    `Packaged resource list differs: ${target}`);
  for (const file of expectedFiles) {
    assert.equal(await sha256(path.join(targetDirectory, file)),
      await sha256(path.join(sourceDirectory, file)), `Packaged resource differs: ${target}/${file}`);
  }
}

export async function verifyPackageContent(projectRoot, appDirectory, metadata, platformRuntimeFiles = []) {
  try {
    for (const file of [...electronRuntimeFiles, ...platformRuntimeFiles]) {
      const details = await stat(path.join(appDirectory, file)).catch(() => null);
      assert.ok(details?.isFile() && details.size > 0, `Missing Electron runtime file: ${file}`);
    }
    const resources = path.join(appDirectory, 'resources');
    const archive = path.join(resources, 'app.asar');
    const packagedMetadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
    for (const key of ['name', 'version', 'main', 'desktopName']) {
      assert.equal(packagedMetadata[key], metadata[key], `Packaged metadata differs: ${key}`);
    }
    // An exact list also rejects unit tests, declaration files, and unbundled dependencies.
    const expected = await expectedArchiveFiles(projectRoot);
    assert.deepEqual(archiveFileList(archive), expected, 'Packaged application file list differs.');
    for (const file of expected) {
      if (rewrittenArchiveFiles.has(file)) continue;
      assert.ok(asar.extractFile(archive, archivePath(file)).equals(await readFile(path.join(projectRoot, file))),
        `Packaged file differs from source: ${file}`);
    }
    assert.deepEqual(
      (await readdir(resources)).filter((entry) => entry === 'app-update.yml' || entry === 'app.asar.unpacked'),
      [], 'Unexpected updater metadata or unpacked application files.');
    await verifyResources(resources, 'resources/default-content', 'default-content', projectRoot);
    await verifyResources(resources, 'resources/npc-characters', 'npc-characters', projectRoot);
  } finally {
    asar.uncacheAll();
  }
}
