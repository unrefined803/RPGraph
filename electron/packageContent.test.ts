import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyPackageContent } from '../scripts/package-content.mjs';

const require = createRequire(import.meta.url);
const electronBuilderRequire = createRequire(require.resolve('electron-builder'));
const builderRequire = createRequire(electronBuilderRequire.resolve('app-builder-lib'));
const asar = builderRequire('@electron/asar');
const yaml = builderRequire('js-yaml');
const { minimatch } = builderRequire('minimatch');
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const directories: string[] = [];
const metadata = { name: 'fixture', version: '1.2.3', main: 'electron/main.cjs', desktopName: 'fixture.desktop' };
const packagedFiles = [
  'LICENSE', 'package.json', 'dist/index.html', 'dist/assets/app.js', 'electron/main.cjs',
  'electron/providers/adapter.cjs', 'shared/reasoning.cjs',
  'comfy-workflows/api-workflows-with-variables/image/default.json',
  'src/assets/app-icons/rpgraph.ico', 'src/assets/app-icons/rpgraph.png',
  'src/session/formatVersions.json', 'src/storybook/formatVersions.json', 'src/workflow/formatVersions.json',
];
const sourceOnlyFiles = ['electron/main.test.ts', 'shared/reasoning.d.cts', 'scripts/other.mjs'];
const resourceFiles = [
  ['resources/default-content/default.json', 'default-content/default.json'],
  ['resources/npc-characters/nested/npc.json', 'npc-characters/nested/npc.json'],
];
const runtimeFiles = ['chrome_100_percent.pak', 'icudtl.dat', 'locales/en-US.pak', 'resources.pak',
  'snapshot_blob.bin', 'v8_context_snapshot.bin', 'libffmpeg.so'];

afterEach(() => {
  asar.uncacheAll();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function write(root: string, relative: string, content: string) {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), content);
}

async function fixture(extraArchiveFiles: string[] = []) {
  const root = mkdtempSync(path.join(tmpdir(), 'rpgraph-package-content-'));
  directories.push(root);
  const project = path.join(root, 'project');
  const stage = path.join(root, 'stage');
  const app = path.join(root, 'app');
  for (const file of [...packagedFiles, ...sourceOnlyFiles, ...resourceFiles.map(([source]) => source)]) {
    write(project, file, file === 'package.json' ? JSON.stringify(metadata) : `source:${file}`);
  }
  for (const file of packagedFiles) cpSync(path.join(project, file), path.join(stage, file), { recursive: true });
  for (const file of extraArchiveFiles) write(stage, file, 'extra');
  for (const file of runtimeFiles) write(app, file, 'runtime');
  for (const [source, target] of resourceFiles) {
    cpSync(path.join(project, source), path.join(app, 'resources', target), { recursive: true });
  }
  await asar.createPackage(stage, path.join(app, 'resources', 'app.asar'));
  return { project, app };
}

describe('packaged application content verification', () => {
  it('accepts a package matching the project sources', async () => {
    const { project, app } = await fixture();
    await expect(verifyPackageContent(project, app, metadata, ['libffmpeg.so'])).resolves.toBeUndefined();
  });

  it.each([
    ['unbundled dependencies', 'node_modules/react/index.js'],
    ['unit tests', 'electron/main.test.ts'],
  ])('rejects %s in the application archive', async (_label, file) => {
    const { project, app } = await fixture([file]);
    await expect(verifyPackageContent(project, app, metadata)).rejects.toThrow('file list differs');
  });

  it('rejects nested files that differ from their source', async () => {
    const { project, app } = await fixture();
    write(project, 'dist/assets/app.js', 'changed');
    await expect(verifyPackageContent(project, app, metadata))
      .rejects.toThrow('Packaged file differs from source: dist/assets/app.js');
  });

  it('rejects missing or changed bundled resources', async () => {
    const { project, app } = await fixture();
    write(project, 'resources/npc-characters/nested/npc.json', 'changed');
    await expect(verifyPackageContent(project, app, metadata))
      .rejects.toThrow('Packaged resource differs: npc-characters/nested/npc.json');
    write(project, 'resources/default-content/added.json', 'added');
    await expect(verifyPackageContent(project, app, metadata))
      .rejects.toThrow('Packaged resource list differs: default-content');
  });

  it('rejects missing Electron runtime files and updater metadata', async () => {
    const { project, app } = await fixture();
    await expect(verifyPackageContent(project, app, metadata, ['ffmpeg.dll']))
      .rejects.toThrow('Missing Electron runtime file: ffmpeg.dll');
    write(app, 'resources/app-update.yml', 'provider: github');
    await expect(verifyPackageContent(project, app, metadata)).rejects.toThrow('Unexpected updater metadata');
  });

  it('rejects mismatched application metadata', async () => {
    const { project, app } = await fixture();
    await expect(verifyPackageContent(project, app, { ...metadata, version: '1.2.4' }))
      .rejects.toThrow('Packaged metadata differs: version');
  });

  it('rejects empty runtime files and unpacked application files', async () => {
    const { project, app } = await fixture();
    write(app, 'icudtl.dat', '');
    await expect(verifyPackageContent(project, app, metadata))
      .rejects.toThrow('Missing Electron runtime file: icudtl.dat');
    write(app, 'icudtl.dat', 'runtime');
    write(app, 'resources/app.asar.unpacked/extra.js', 'extra');
    await expect(verifyPackageContent(project, app, metadata))
      .rejects.toThrow('Unexpected updater metadata or unpacked application files');
  });
});

describe('packaging configuration', () => {
  const config = yaml.load(readFileSync(path.join(repositoryRoot, 'dev/config/electron-builder.yml'), 'utf8'));
  const included = config.files.filter((pattern: string) => !pattern.startsWith('!'));
  const isPackaged = (file: string) => included.some((pattern: string) => minimatch(file, pattern));

  function runtimeModules(directory: string): string[] {
    return readdirSync(path.join(repositoryRoot, directory), { withFileTypes: true }).flatMap((entry) => {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return runtimeModules(relative);
      return entry.name.endsWith('.cjs') ? [relative] : [];
    });
  }

  // A module or asset referenced from the main process must also be shipped;
  // otherwise the packaged application fails only at runtime.
  it('packages every file referenced by the Electron runtime modules', () => {
    const missing: string[] = [];
    for (const module of [...runtimeModules('electron'), ...runtimeModules('shared')]) {
      if (!isPackaged(module)) missing.push(module);
      const source = readFileSync(path.join(repositoryRoot, module), 'utf8');
      const references = [
        ...[...source.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((match) => match[1]),
        ...[...source.matchAll(/['"](\.\.\/src\/[^'"]+)['"]/g)].map((match) => match[1]),
      ];
      for (const reference of references) {
        const target = path.posix.join(path.posix.dirname(module), reference);
        if (!isPackaged(target)) missing.push(`${module} -> ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps one combined, non-publishing Windows installer for x64 and ARM64', () => {
    expect(config.publish).toBeNull();
    expect(config.win.target).toEqual([{ target: 'nsis', arch: ['x64', 'arm64'] }]);
    expect(config.nsis.artifactName).not.toContain('${arch}');
    expect(config.nsis.deleteAppDataOnUninstall).toBe(false);
    expect(readFileSync(path.join(repositoryRoot, config.nsis.include), 'utf8')).toContain('AtLeastWin10');
  });
});
