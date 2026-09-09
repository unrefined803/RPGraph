import { ensureFaceCrop } from './character-faces.mjs';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rename, rm, link, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import validator from '../shared/character-container.cjs';

const run = promisify(execFile);
export const galleryImageMaxPixels = 1_000_000;
// Approximate size target only; conversion always uses JPEG quality 84.
export const galleryImageMaxBytes = 200 * 1024;
export const characterEditFormat = 'rpgraph-character-edit';
export const characterEditVersion = '1.0.0';
const galleryImageResizePixels = galleryImageMaxPixels - 1_000;
let creatorPromise;
export function loadCreator() {
  return creatorPromise ??= bundleCreator();
}
async function bundleCreator() {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/characters/creator.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}

/** Decode local raster files without launching Electron or touching source files. */
export async function readGalleryImage(file, metadata) {
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extname(file).toLowerCase())) {
    throw new Error(`Unsupported image format: ${file}. Use JPEG, PNG or WebP.`);
  }
  const source = await readFile(file);
  // Feed bytes through stdin: filenames cannot become ImageMagick options or pseudo protocols.
  // Leave a small rounding margin because ImageMagick rounds both output dimensions.
  const child = run('magick', ['-', '-auto-orient', '-resize', `${galleryImageResizePixels}@>`,
    '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-strip',
    '-quality', '84', 'jpeg:-'],
  { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  child.child.stdin.end(source);
  const { stdout } = await child;
  const dimensions = run('magick', ['jpeg:-', '-format', '%w %h\n', 'info:'], { encoding: 'utf8' });
  dimensions.child.stdin.end(stdout);
  const measured = (await dimensions).stdout.trim();
  if (!/^\d+ \d+$/.test(measured)) throw new Error('Animated or multi-frame images are unsupported.');
  const [width, height] = measured.split(' ').map(Number);
  if (!width || !height) throw new Error(`Unable to decode image: ${file}`);
  if (width * height > galleryImageMaxPixels) {
    throw new Error(`Unable to fit image within the ${galleryImageMaxPixels}-pixel gallery limit: ${file}`);
  }
  return { ...metadata, mimeType: 'image/jpeg', size: stdout.length, width, height,
    dataUrl: `data:image/jpeg;base64,${stdout.toString('base64')}` };
}

export async function createFromSpecification(document, directory, newId = randomUUID, { detectFace = true, faceDetector } = {}) {
  if (document.format !== undefined) validator.validateCharacterContainer(document);
  const source = structuredClone(document.character ?? document);
  source.id ??= newId();
  const images = [];
  const byId = new Map();
  const byPath = new Map();
  for (const input of source.images ?? []) {
    let image = input;
    if (input.path !== undefined) {
      const { path, key, id, name, description = '' } = input;
      if (!id && (typeof key !== 'string' || !key.trim())) throw new Error('Local images require a stable id or key.');
      const imageId = id ?? `${source.id}:image:${key}`;
      const file = resolve(directory, path);
      if (byPath.has(file) && byPath.get(file) !== imageId) throw new Error('Reuse one image id for repeated local image paths.');
      byPath.set(file, imageId);
      image = await readGalleryImage(file, { id: imageId, name: name ?? key ?? id, description });
    }
    if (byId.has(image.id)) {
      if (JSON.stringify(byId.get(image.id)) !== JSON.stringify(image)) throw new Error(`Conflicting gallery image: ${image.id}`);
      continue;
    }
    byId.set(image.id, image);
    images.push(image);
  }
  source.images = images;
  if (detectFace && document.format === undefined) await ensureFaceCrop(source, faceDetector);
  for (const [app, account] of Object.entries(source.apps ?? {})) {
    if (account.initialPosts) account.initialPosts = account.initialPosts.map((post) => {
      const { key, id, text, imageId } = post;
      if (!id && (typeof key !== 'string' || !key.trim())) throw new Error('Initial posts require a stable id or key.');
      return { id: id ?? `${source.id}:${app}:post:${key}`, text, ...(imageId !== undefined ? { imageId } : {}) };
    });
  }
  return (await loadCreator()).createAuthoredCharacter(source, newId);
}

/** Produce a complete editable character without exposing large embedded data URLs. */
export function editableCharacterSpecification(container) {
  validator.validateCharacterContainer(container);
  const character = structuredClone(container.character);
  character.images = character.images.map((sourceImage) => {
    const image = { ...sourceImage };
    const embedded = { mimeType: image.mimeType, size: image.size,
      ...(image.width !== undefined ? { width: image.width } : {}),
      ...(image.height !== undefined ? { height: image.height } : {}) };
    delete image.dataUrl;
    delete image.mimeType;
    delete image.size;
    delete image.width;
    delete image.height;
    return { ...image, embedded };
  });
  return {
    format: characterEditFormat,
    version: characterEditVersion,
    sourceCharacterId: character.id,
    containerVersion: container.version,
    character,
  };
}

/** Apply a blob-free edit specification while preserving untouched embedded JPEG bytes exactly. */
export async function createEditedCharacterContainer(container, editSpecification, directory, options = { detectFace: false }) {
  validator.validateCharacterContainer(container);
  if (editSpecification?.format !== characterEditFormat || editSpecification?.version !== characterEditVersion ||
      editSpecification?.sourceCharacterId !== container.character.id ||
      editSpecification?.containerVersion !== container.version || !editSpecification.character) {
    throw new Error(`Invalid ${characterEditFormat} ${characterEditVersion} specification for this container.`);
  }
  const source = structuredClone(editSpecification.character);
  if (source.id !== container.character.id) throw new Error('A character edit must retain the existing character id.');
  for (const [app, account] of Object.entries(container.character.apps ?? {})) {
    if (source.apps?.[app] && source.apps[app].accountId !== account.accountId) {
      throw new Error(`A character edit must retain the existing ${app} account id.`);
    }
  }
  const existingImages = new Map(container.character.images.map((image) => [image.id, image]));
  const revisedImages = [];
  const byPath = new Map();
  for (const input of source.images ?? []) {
    if (input.path !== undefined) {
      const { path, key, id, name, description = '' } = input;
      if (!id && (typeof key !== 'string' || !key.trim())) throw new Error('Local images require a stable id or key.');
      const imageId = id ?? `${source.id}:image:${key}`;
      const file = resolve(directory, path);
      if (byPath.has(file) && byPath.get(file) !== imageId) throw new Error('Reuse one image id for repeated local image paths.');
      byPath.set(file, imageId);
      revisedImages.push(await readGalleryImage(file, {
        id: imageId,
        name: name ?? key ?? id,
        description,
      }));
      continue;
    }
    if (input.embedded === undefined || typeof input.id !== 'string') {
      throw new Error('Images in an edit specification require embedded metadata or a local path.');
    }
    const existing = existingImages.get(input.id);
    if (!existing) throw new Error(`Embedded image is not present in the source container: ${input.id}`);
    revisedImages.push({ ...existing, name: input.name ?? existing.name, description: input.description ?? existing.description });
  }
  source.images = revisedImages;
  return createFromSpecification(source, directory, () => { throw new Error('A character edit cannot allocate a new identity.'); }, options);
}

export function embeddedImageBytes(container, imageId) {
  validator.validateCharacterContainer(container);
  const image = container.character.images.find((candidate) => candidate.id === imageId);
  if (!image) throw new Error(`Unknown character gallery image: ${imageId}`);
  const bytes = Buffer.from(image.dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
  if (bytes.length !== image.size) throw new Error(`Embedded image size does not match its metadata: ${imageId}`);
  return bytes;
}

/** Publish JSON atomically, with explicit replacement. */
export async function writeBytesAtomic(file, contents, overwrite = false) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    if (overwrite) await rename(temporary, file);
    else await link(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

export async function writeJsonAtomic(file, value, overwrite = false) {
  await writeBytesAtomic(file, `${JSON.stringify(value, null, 2)}\n`, overwrite);
}

/** Publish only complete files; the default cannot replace an existing target. */
export async function writeContainerAtomic(file, container, overwrite = false) {
  validator.validateCharacterContainer(container);
  if (overwrite) {
    let previous;
    try { previous = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      validator.validateCharacterContainer(previous);
      if (previous.character.id !== container.character.id) throw new Error('A revision must retain the existing character id.');
      for (const [app, account] of Object.entries(previous.character.apps ?? {})) {
        if (container.character.apps?.[app] && container.character.apps[app].accountId !== account.accountId) {
          throw new Error(`A revision must retain the existing ${app} account id.`);
        }
      }
    }
  }
  await writeJsonAtomic(file, container, overwrite);
}

export function containerFileName(id) {
  return `${createHash('sha256').update(id).digest('hex')}.json`;
}

/** Respect arbitrary existing library basenames when installing a revision. */
export async function installationTarget(directory, id) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return join(directory, containerFileName(id)); throw error; }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
    let value;
    try { value = JSON.parse(await readFile(join(directory, entry.name), 'utf8')); }
    catch { continue; }
    if (value.format === 'rpgraph-character' && value.character?.id === id) matches.push(entry.name);
  }
  if (matches.length > 1) throw new Error(`Resolve duplicate library files for character ${id} before installing.`);
  return join(directory, matches[0] ?? containerFileName(id));
}
