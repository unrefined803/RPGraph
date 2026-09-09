import { readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { editableCharacterSpecification, embeddedImageBytes, writeJsonAtomic, writeBytesAtomic } from './character-creator.mjs';
const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } } });
if (!values.input || !values.output) throw new Error('Usage: npm run character:unpack -- --input DIRECTORY --output NEW_DIRECTORY');
const input = resolve(values.input);
const output = resolve(values.output);
const entries = [];
// Require a new workspace and leave packed originals in place.
await mkdir(output);
for (const file of (await readdir(input)).filter(file => file.endsWith('.json')).sort()) {
  const bytes = await readFile(resolve(input, file));
  const container = JSON.parse(bytes.toString('utf8'));
  const spec = editableCharacterSpecification(container);
  const c = spec.character;
  const directory = basename(file, '.json');
  await mkdir(resolve(output, directory, 'images'), { recursive: true });
  for (let index = 0; index < c.images.length; index++) {
    const image = c.images[index];
    const flags = [];
    for (const [app, flag] of [['fotogram', 'F'], ['onlyfriends', 'O']]) {
      if (c.apps?.[app]?.initialPosts?.some(post => post.imageId === image.id)) flags.push(flag);
    }
    if (c.apps?.matchme?.profile?.photoIds?.includes(image.id)) flags.push('M');
    if (c.profileImage?.imageId === image.id) flags.push('P');
    // G explicitly retains gallery-only images without creating app assignments.
    const label = `${index + 1}-${image.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image'}`;
    image.path = `images/${flags.length ? flags.join('-') : 'G'}-${label}.jpg`;
    await writeBytesAtomic(resolve(output, directory, image.path), embeddedImageBytes(container, image.id));
  }
  await writeJsonAtomic(resolve(output, directory, 'character.json'), spec);
  await writeBytesAtomic(resolve(output, '.originals', file), bytes);
  entries.push({ directory, file, id: c.id, ids: {} });
}
await writeJsonAtomic(resolve(output, 'manifest.json'), { version: 1, entries });
console.log(`Unpacked ${entries.length} characters. Original containers remain unchanged.`);
