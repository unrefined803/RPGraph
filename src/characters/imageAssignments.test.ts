import { it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('assigns renamed media by flags, preserves bytes and rejects ambiguous assignments', async () => {
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { parseImageAssignment, assignCharacterImages } from './scripts/character-image-assignments.mjs';
    import { editableCharacterSpecification, embeddedImageBytes } from './scripts/character-creator.mjs';
    assert.deepEqual(parseImageAssignment('F-P_new.png'), { flags: ['F', 'P'], label: 'new' });
    assert.deepEqual(parseImageAssignment('O-M-photo.jpg').flags, ['O', 'M']);
    for (const name of ['F-F-photo.jpg', 'photo.jpg', 'P-.png', 'G-F-photo.jpg']) {
      assert.throws(() => parseImageAssignment(name));
    }
    const directory = await mkdtemp(join(tmpdir(), 'rpgraph-assignments-'));
    try {
      await mkdir(join(directory, 'images'));
      const source = JSON.parse(await readFile('resources/npc-characters/avery-hart.json', 'utf8'));
      const images = source.character.images;
      await writeFile(join(directory, 'images/F-P-renamed.jpg'), embeddedImageBytes(source, images[0].id));
      await writeFile(join(directory, 'images/O-M-other.jpg'), embeddedImageBytes(source, images[1].id));
      const spec = editableCharacterSpecification(source);
      const result = await assignCharacterImages(source, spec, directory);
      const c = result.character;
      assert.equal(c.profileImage.imageId, images[0].id);
      assert.deepEqual(c.apps.matchme.profile.photoIds, [images[1].id]);
      assert.deepEqual(c.apps.onlyfriends.initialPosts.map(p => p.imageId), [images[1].id]);
      assert.deepEqual(c.apps.fotogram.initialPosts.map(p => p.imageId), [images[0].id]);
      assert.ok(c.images.every(image => !image.path && image.embedded));
      assert.deepEqual(spec, editableCharacterSpecification(source));
      await writeFile(join(directory, 'images/P-duplicate.jpg'), embeddedImageBytes(source, images[0].id));
      await assert.rejects(assignCharacterImages(source, spec, directory), /Multiple files/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  `]);
});
