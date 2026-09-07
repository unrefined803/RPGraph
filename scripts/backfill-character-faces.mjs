import { parseArgs } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { detectFaces, primaryPortrait } from './character-faces.mjs';
import { writeContainerAtomic } from './character-creator.mjs';
import validator from '../shared/character-container.cjs';

try {
  const { values } = parseArgs({ options: { directory: { type: 'string' }, write: { type: 'boolean', default: false }, 'include-uncropped': { type: 'boolean', default: false } } });
  if (!values.directory) throw new Error('Usage: npm run character:faces -- --directory NPC_FOLDER [--write]');
  const directory = resolve(values.directory);
  const pending = [];
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()) {
    const file = join(directory, name);
    const container = JSON.parse(await readFile(file, 'utf8'));
    validator.validateCharacterContainer(container);
    if (container.character.profileImage && (container.character.profileImage.crop || !values['include-uncropped'])) {
      console.log(`${name}: kept existing portrait`);
      continue;
    }
    const image = primaryPortrait(container.character);
    if (!image) {
      console.log(`${name}: no gallery image; kept initials`);
      continue;
    }
    pending.push({ file, name, container, image });
  }
  const results = await detectFaces(pending.map((entry) => entry.image));
  let unresolved = 0;
  const changed = [];
  for (const [index, entry] of pending.entries()) {
    const result = results[index];
    if (result?.faces === 0) {
      console.log(`${entry.name}: no confident face; kept the existing picture or initials`);
      continue;
    }
    if (!result?.crop) {
      console.error(`${entry.name}: ${result?.faces ?? 0} faces; manual crop required`);
      unresolved++;
      continue;
    }
    entry.container.character.profileImage = { imageId: entry.image.id, crop: result.crop };
    validator.validateCharacterContainer(entry.container);
    changed.push(entry);
    console.log(`${entry.name}: ${JSON.stringify(result.crop)} (confidence ${result.confidence.toFixed(3)})`);
  }
  // Review the entire batch before publishing any file.
  if (unresolved) throw new Error(`${unresolved} portraits need review. No files were changed.`);
  if (values.write) for (const entry of changed) await writeContainerAtomic(entry.file, entry.container, true);
  console.log(`${values.write ? 'Updated' : 'Previewed'} ${changed.length} portraits (${pending.length} images checked); existing portraits preserved.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
