import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { embeddedImageBytes } from './character-creator.mjs';

export function parseImageAssignment(filename) {
  const stem = basename(filename, extname(filename));
  const parts = stem.split(/[-_]/);
  const flags = [];
  while (/^[FOMPG]$/.test(parts[0] ?? '')) flags.push(parts.shift());
  const label = parts.join('-');
  if (!flags.length || !label || (flags.includes('G') && flags.length !== 1) || new Set(flags).size !== flags.length) {
    throw new Error(`Invalid image assignment: ${filename}. Use F-P-description.jpg (F, O, M, P; G for gallery only).`);
  }
  return { flags, label };
}

/** Resolve renamed files by bytes or stable labels and replace all app media assignments. */
export async function assignCharacterImages(source, specification, directory) {
  const spec = structuredClone(specification);
  const character = spec.character;
  const existing = character.images ?? [];
  const files = (await readdir(resolve(directory, 'images'), { withFileTypes: true }))
    .filter(file => file.isFile() && !file.name.startsWith('.')).map(file => file.name).sort();
  const assigned = [];
  const used = new Set();
  for (const filename of files) {
    if (!/\.(jpe?g|png|webp)$/i.test(filename)) throw new Error(`Unsupported image file: ${filename}`);
    const { flags, label } = parseImageAssignment(filename);
    const path = `images/${filename}`;
    const bytes = await readFile(resolve(directory, path));
    const matches = existing.filter(image => image.path === path ||
      image.id.endsWith(`:image:${label}`) || source.character.images.some(original =>
        original.id === image.id && bytes.equals(embeddedImageBytes(source, original.id))));
    if (matches.length !== 1) throw new Error(`Register a unique image id, name and description in character.json for ${path}.`);
    const image = { ...matches[0], path };
    if (used.has(image.id)) throw new Error(`Multiple files resolve to image ${image.id}.`);
    if (!image.name?.trim() || !image.description?.trim()) throw new Error(`Image labels are missing: ${path}`);
    used.add(image.id);
    const original = source.character.images.find(item => item.id === image.id);
    const unchanged = original && bytes.equals(embeddedImageBytes(source, image.id));
    if (unchanged) {
      image.embedded = { mimeType: original.mimeType, size: original.size, width: original.width, height: original.height };
      delete image.path;
    }
    assigned.push({ image, flags, unchanged });
  }
  assigned.sort((left, right) => existing.findIndex(image => image.id === left.image.id)
    - existing.findIndex(image => image.id === right.image.id));
  const portraits = assigned.filter(item => item.flags.includes('P'));
  if (portraits.length > 1) throw new Error(`Only one P image is allowed for ${character.name}.`);
  const portrait = portraits[0];
  const previousPortrait = character.profileImage;
  delete character.profileImage;
  if (portrait) character.profileImage = portrait.unchanged && previousPortrait?.imageId === portrait.image.id
    ? previousPortrait : { imageId: portrait.image.id };
  character.images = assigned.map(item => item.image);
  character.apps ??= {};
  for (const [app, flag] of [['fotogram', 'F'], ['onlyfriends', 'O'], ['matchme', 'M']]) {
    const selected = assigned.filter(item => item.flags.includes(flag)).map(item => item.image);
    let account = character.apps[app];
    if (!account && selected.length) {
      account = character.apps[app] = { accountId: `character:${character.id}:${app}`, enabled: true,
        username: character.id.replaceAll('_', '.'), displayName: character.name,
        bio: character.apps.fotogram?.bio || character.description };
    }
    if (!account) continue;
    if (selected.length) account.enabled = true;
    if (app === 'matchme') {
      if (selected.length > 3) throw new Error(`MatchMe allows at most three images for ${character.name}.`);
      if (!selected.length) delete account.profile;
      else account.profile = { username: account.username, name: character.name, age: character.age,
        bio: account.bio, interests: '', ...(character.gender ? { gender: character.gender } : {}),
        ...account.profile, photoIds: selected.map(image => image.id) };
    } else {
      const previousPosts = account.initialPosts ?? [];
      account.initialPosts = [ ...previousPosts.filter(post => !post.imageId), ...selected.map(image =>
        previousPosts.find(post => post.imageId === image.id) ?? {
          id: `${character.id}:${app}:post:${image.id.split(':image:').at(-1)}`, text: '', imageId: image.id,
        }) ];
    }
  }
  character.apps.whatsup ??= { accountId: `character:${character.id}:whatsup`, enabled: true,
    username: character.name, displayName: character.name, bio: '' };
  // P is the shared avatar; it does not implicitly create a post or MatchMe photo.
  for (const account of Object.values(character.apps)) {
    delete account.avatarImageId;
    if (portrait) account.avatarImageId = portrait.image.id;
  }
  return spec;
}
