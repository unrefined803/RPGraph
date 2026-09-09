import { describe, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

describe('automatic authoring portraits', () => {
  it('creates crops in the authoring pipeline, preserves manual choices and handles non-face images', async () => {
    await run(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      import { ensureFaceCrop, primaryPortrait } from './scripts/character-faces.mjs';
      import { createFromSpecification, createEditedCharacterContainer, editableCharacterSpecification } from './scripts/character-creator.mjs';
      const original = JSON.parse(await readFile('resources/npc-characters/luca-reed.json'));
      const source = structuredClone(original.character);
      delete source.profileImage;
      const crop = { x: 15, y: 8, size: 42 };
      let calls = 0;
      const faceDetector = async (images) => {
        calls++;
        assert.equal(images[0].id, source.apps.matchme.profile.photoIds[0]);
        return [{ id: images[0].id, faces: 1, crop }];
      };
      const created = await createFromSpecification(source, '.', undefined, { faceDetector });
      assert.equal(calls, 1);
      assert.deepEqual(created.character.profileImage, { imageId: primaryPortrait(source).id, crop });
      assert.deepEqual(created.character.images, source.images);
      const fail = async () => { throw new Error('Manual portrait must not be redetected'); };
      await createFromSpecification(created.character, '.', undefined, { faceDetector: fail });
      const plain = structuredClone(created);
      delete plain.character.profileImage.crop;
      const reinstalled = await createFromSpecification(plain, '.', undefined, { faceDetector: fail });
      assert.equal(reinstalled.character.profileImage.crop, undefined);
      const edit = editableCharacterSpecification(created);
      delete edit.character.profileImage;
      const cleared = await createEditedCharacterContainer(created, edit, '.');
      assert.equal(cleared.character.profileImage, undefined);
      const nonFace = structuredClone(source);
      await ensureFaceCrop(nonFace, async () => [{ faces: 0 }]);
      assert.equal(nonFace.profileImage, undefined);
      nonFace.profileImage = { imageId: nonFace.images[0].id };
      await ensureFaceCrop(nonFace, async () => [{ faces: 0 }]);
      assert.deepEqual(nonFace.profileImage, { imageId: nonFace.images[0].id });
      await assert.rejects(() => ensureFaceCrop(structuredClone(source), async () => [{ faces: 2 }]), /2 faces/);
      await ensureFaceCrop({ images: [] }, fail);
      assert.throws(() => primaryPortrait({ images: [], profileImage: { imageId: 'missing' } }), /Unknown portrait/);
    `]);
  });
});
