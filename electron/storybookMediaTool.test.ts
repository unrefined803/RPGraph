import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const temporaryDirectories: string[] = [];
const firstImage = 'data:image/png;base64,QUJDRA==';
const secondImage = 'data:image/jpeg;base64,RUZHSA==';

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rpgraph-storybook-media-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeJson(filePath: string, value: unknown) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runTool(...args: string[]) {
  return run(process.execPath, ['scripts/storybook-media.mjs', ...args], {
    cwd: process.cwd(),
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('Storybook media tool', () => {
  it('redacts media and restores it around document edits', async () => {
    const directory = await temporaryDirectory();
    const sourcePath = path.join(directory, 'source.rpgraph-storybook.json');
    const redactedPath = path.join(directory, 'redacted.json');
    const mergedPath = path.join(directory, 'merged.rpgraph-storybook.json');
    const source = {
      format: 'rpgraph-storybook',
      version: '3.0.0',
      title: 'Original title',
      characters: [{ images: [{ dataUrl: firstImage }], profileImage: { dataUrl: secondImage } }],
    };
    await writeJson(sourcePath, source);

    await runTool('redact', sourcePath, redactedPath);
    const redactedText = await fs.readFile(redactedPath, 'utf8');
    expect(redactedText).not.toContain('data:image/');
    expect(redactedText.match(/__RPGRAPH_DATA_URL_REDACTED__/g)).toHaveLength(2);

    const edited = JSON.parse(redactedText);
    edited.title = 'Edited title';
    await writeJson(redactedPath, edited);
    await runTool('merge', redactedPath, sourcePath, mergedPath);

    const merged = JSON.parse(await fs.readFile(mergedPath, 'utf8'));
    expect(merged.title).toBe('Edited title');
    expect(merged.characters[0].images[0].dataUrl).toBe(firstImage);
    expect(merged.characters[0].profileImage.dataUrl).toBe(secondImage);
    expect(JSON.stringify(merged)).not.toContain('__RPGRAPH_DATA_URL_REDACTED__');
  });

  it('rejects markers whose original media is unavailable', async () => {
    const directory = await temporaryDirectory();
    const sourcePath = path.join(directory, 'source.rpgraph-storybook.json');
    const redactedPath = path.join(directory, 'redacted.json');
    const mergedPath = path.join(directory, 'merged.rpgraph-storybook.json');
    await writeJson(sourcePath, {
      format: 'rpgraph-storybook', version: '3.0.0', images: [{ dataUrl: firstImage }],
    });
    await runTool('redact', sourcePath, redactedPath);
    const redacted = await fs.readFile(redactedPath, 'utf8');
    await fs.writeFile(redactedPath, redacted.replace(/sha256:[a-f0-9]{64}/, `sha256:${'0'.repeat(64)}`));

    await expect(runTool('merge', redactedPath, sourcePath, mergedPath)).rejects.toThrow();
    await expect(fs.stat(mergedPath)).rejects.toThrow();
  });

  it('rejects non-Storybook JSON documents', async () => {
    const directory = await temporaryDirectory();
    const sourcePath = path.join(directory, 'workflow.json');
    await writeJson(sourcePath, { format: 'rpgraph-workflow', nodes: [] });

    const redactedPath = path.join(directory, 'redacted.json');
    await expect(runTool('redact', sourcePath, redactedPath)).rejects.toThrow();
    await expect(fs.stat(redactedPath)).rejects.toThrow();
  });
});
