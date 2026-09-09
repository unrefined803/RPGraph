import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assignCharacterImages } from './character-image-assignments.mjs';
import { createEditedCharacterContainer, writeContainerAtomic } from './character-creator.mjs';

// This workspace intentionally migrates identities before applying ordinary edits.
const { values } = parseArgs({ options: {
  workspace: { type: 'string' }, output: { type: 'string' }, check: { type: 'boolean' },
} });
if (!values.workspace || (!values.output && !values.check) || (values.output && values.check)) {
  throw new Error('Usage: npm run character:pack -- --workspace DIRECTORY (--check | --output DIRECTORY)');
}
const root = resolve(values.workspace);
const check = values.check;
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const results = [];
for (const entry of manifest.entries) {
  const original = JSON.parse(await readFile(resolve(root, '.originals', entry.file), 'utf8'));
  const rewrite = value => Array.isArray(value) ? value.map(rewrite)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      ['id', 'accountId', 'imageId', 'avatarImageId'].includes(key) && typeof item === 'string' ? entry.ids[item] ?? item
        : key === 'photoIds' ? item.map(id => entry.ids[id] ?? id) : rewrite(item)])) : value;
  const source = rewrite(original);
  source.character.id = entry.id;
  const directory = resolve(root, entry.directory);
  const specification = JSON.parse(await readFile(resolve(directory, 'character.json'), 'utf8'));
  const spec = await assignCharacterImages(source, specification, directory);
  const container = await createEditedCharacterContainer(source, spec, directory);
  results.push({ file: entry.file, container });
}
// Validate the whole batch before publishing any containers. Existing files are protected.
if (!check) {
  const output = resolve(values.output);
  const existing = await readdir(output).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (results.some(item => existing.includes(item.file))) throw new Error('Output already contains character files; choose an empty staging directory.');
  for (const item of results) await writeContainerAtomic(resolve(output, item.file), item.container);
}
console.log(`${check ? 'Validated' : 'Packed'} ${results.length} characters.`);
