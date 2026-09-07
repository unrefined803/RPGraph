import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAuthoredCharacter } from './creator';
import { validateCharacterContainer } from './character';
import { planCharacterCardImport, rpCharacterCardForCharacter } from '../storybook/characterCard';
import { emptyRpStorybook } from '../nodes/rp-storybook/model';
import { demoConversionPlan } from './demoConversion';

const directory = mkdtempSync(join(tmpdir(), 'rpgraph-creator-'));
const galleryImageMaxPixels = 1_000_000;
const galleryImageMaxBytes = 200 * 1024;
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const fixture = JSON.parse(readFileSync('src/characters/fixtures/stage4-npc.json', 'utf8'));
const cli = (args: string[]) => run(process.execPath, ['scripts/create-character-container.mjs', ...args], { encoding: 'utf8' });
const inspectCli = (args: string[]) => run(process.execPath, ['scripts/inspect-character-container.mjs', ...args], { encoding: 'utf8' });
const editCli = (args: string[]) => run(process.execPath, ['scripts/edit-character-container.mjs', ...args], { encoding: 'utf8' });

describe('shared container creator', () => {
  it('uses the UI export format and preserves profiles, references and initial posts through repeated import', () => {
    const card = createAuthoredCharacter(fixture.character, () => { throw new Error('Existing identity'); });
    validateCharacterContainer(card);
    const imported = planCharacterCardImport(card, structuredClone(emptyRpStorybook));
    const repeated = planCharacterCardImport(card, imported.storybook);
    expect(repeated.storybook.characters).toHaveLength(1);
    const exported = rpCharacterCardForCharacter(repeated.character, { includePosts: true });
    expect(exported).toMatchObject({ ...card, character: { ...card.character, playable: true } });
    expect(rpCharacterCardForCharacter(planCharacterCardImport(exported, repeated.storybook).character, { includePosts: true })).toEqual(exported);
    expect(rpCharacterCardForCharacter(repeated.character).character.apps.fotogram).not.toHaveProperty('initialPosts');
  });

  it('allocates only a new identity and derives stable account IDs independently of names', () => {
    const card = createAuthoredCharacter({ name: 'Fictional Author', apps: { onlyfriends: { username: 'writer' } } }, () => 'new-id');
    const revision = createAuthoredCharacter({ ...card.character, name: 'Renamed Author' }, () => { throw new Error('Must retain ID'); });
    expect(revision.character.id).toBe('new-id');
    expect(revision.character.apps).toEqual(card.character.apps);
  });

  it('rejects dangling media and malformed profiles before normalization', () => {
    expect(() => createAuthoredCharacter({ ...fixture.character, images: [] }, () => '')).toThrow('gallery image');
    const bad = structuredClone(fixture.character);
    bad.apps.matchme.profile.age = 12;
    expect(() => createAuthoredCharacter(bad, () => '')).toThrow('MatchMe');
    expect(() => createAuthoredCharacter({ ...fixture.character, messages: ['private'] }, () => '')).toThrow('Unsupported authored');
  });

  it('removes private dating state and private gallery access metadata', () => {
    const source = structuredClone(fixture.character);
    Object.assign(source.apps.matchme.profile, { decisions: { someone: 'like' }, historyVersion: 1,
      messages: [{ id: 'secret', text: 'private' }] });
    Object.assign(source.images[0], { receivedFrom: 'secret', imageAccess: { private: true } });
    const card = createAuthoredCharacter(source, () => '');
    expect(card.character.apps.matchme?.profile?.decisions).toEqual({});
    expect(JSON.stringify(card)).not.toContain('secret');
    expect(card.character.apps.matchme?.profile).not.toHaveProperty('historyVersion');
  });

  it('converts real local PNG/JPEG media once and installs a validated container atomically', async () => {
    const input = join(directory, 'spec.json');
    const output = join(directory, 'created.json');
    const spec = { id: 'authored-example', name: 'Authored Fiction',
      images: [{ id: 'photo', path: resolve('src/assets/app-icons/rpgraph-16.png'), description: 'Application icon, not a portrait' }],
      profileImage: { imageId: 'photo', crop: { x: 50, y: 50, size: 100 } },
      apps: { fotogram: { username: 'fiction', avatarImageId: 'photo', initialPosts: [{ key: 'first', text: 'Hello', imageId: 'photo', likeCount: 999 }] } } };
    writeFileSync(input, JSON.stringify(spec));
    await cli(['--input', input, '--output', output, '--install-dir', join(directory, 'library')]);
    const card = JSON.parse(readFileSync(output, 'utf8'));
    validateCharacterContainer(card);
    expect(card.character.images).toHaveLength(1);
    expect(card.character.images[0]).toMatchObject({ id: 'photo', width: 16, height: 16, mimeType: 'image/jpeg' });
    const bytes = Buffer.from(card.character.images[0].dataUrl.split(',')[1], 'base64');
    expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
    expect(card.character.images[0].size).toBe(bytes.length);
    expect(card.character.images[0].size).toBeLessThanOrEqual(galleryImageMaxBytes);
    expect(card.character.images[0].width * card.character.images[0].height).toBeLessThanOrEqual(galleryImageMaxPixels);
    expect(card.character.apps.fotogram.initialPosts).toEqual([{ id: 'authored-example:fotogram:post:first', text: 'Hello', imageId: 'photo' }]);
    const installed = readdirSync(join(directory, 'library'));
    expect(installed).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(directory, 'library', installed[0]), 'utf8'))).toEqual(card);
    renameSync(join(directory, 'library', installed[0]), join(directory, 'library', 'renamed.json'));
    await cli(['--input', input, '--install-dir', join(directory, 'library'), '--overwrite']);
    expect(readdirSync(join(directory, 'library'))).toEqual(['renamed.json']);
    await expect(cli(['--input', input, '--output', output])).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(card);
    await cli(['--input', input, '--output', output, '--overwrite']);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(card);
    writeFileSync(input, JSON.stringify({ ...spec, id: 'different-person' }));
    await expect(cli(['--input', input, '--output', output, '--overwrite'])).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(card);
    expect(readdirSync(directory).some((file) => file.endsWith('.tmp'))).toBe(false);
  });

  it('limits large gallery images to one megapixel and 200 KiB', async () => {
    const photo = join(directory, 'large-photo.png');
    await run('magick', ['-size', '1800x1400', 'plasma:fractal', photo]);
    const input = join(directory, 'large-spec.json');
    const output = join(directory, 'large-container.json');
    writeFileSync(input, JSON.stringify({ id: 'large-image-test', name: 'Fiction',
      images: [{ id: 'photo', path: photo, name: 'Large source' }] }));
    await cli(['--input', input, '--output', output]);
    const image = JSON.parse(readFileSync(output, 'utf8')).character.images[0];
    expect(image.width * image.height).toBeLessThanOrEqual(galleryImageMaxPixels);
    expect(image.size).toBeLessThanOrEqual(galleryImageMaxBytes);
    expect(Buffer.from(image.dataUrl.split(',')[1], 'base64')).toHaveLength(image.size);
  });

  it('supports WebP inputs and rejects conflicting image IDs', async () => {
    const photo = join(directory, 'photo.webp');
    await run('magick', [resolve('src/assets/app-icons/rpgraph-16.png'), photo]);
    const input = join(directory, 'webp-spec.json');
    const output = join(directory, 'webp-container.json');
    const image = { id: 'shared', path: photo, name: 'Icon' };
    writeFileSync(input, JSON.stringify({ id: 'webp-test', name: 'Fiction', images: [image, image] }));
    await cli(['--input', input, '--output', output]);
    const card = JSON.parse(readFileSync(output, 'utf8'));
    expect(card.character.images).toHaveLength(1);
    expect(card.character.images[0]).toMatchObject({ width: 16, height: 16, mimeType: 'image/jpeg' });
    writeFileSync(input, JSON.stringify({ id: 'webp-test', name: 'Fiction', images: [image, { ...image, name: 'Conflicting metadata' }] }));
    await expect(cli(['--input', input, '--output', output, '--overwrite'])).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(card);
  });

  it('inspects and edits packed containers without exposing or rewriting retained image bytes', async () => {
    const input = join(directory, 'editable-source.json');
    const editSpecification = join(directory, 'editable-spec.json');
    const output = join(directory, 'editable-output.json');
    const extracted = join(directory, 'extracted.jpg');
    const source = {
      id: 'editable-character', name: 'Original Name',
      images: [
        { id: 'portrait', path: resolve('src/assets/app-icons/rpgraph-64.png'), name: 'Portrait' },
        { id: 'spare', path: resolve('src/assets/app-icons/rpgraph-32.png'), name: 'Spare' },
      ],
      profileImage: { imageId: 'portrait' },
      apps: {
        fotogram: { username: 'original', avatarImageId: 'portrait',
          initialPosts: [{ id: 'first-post', text: 'First', imageId: 'portrait' }] },
        matchme: { username: 'original.match', bio: 'Original bio', profile: {
          name: 'Original Name', age: 25, gender: 'woman', bio: 'Original bio', interests: 'Art',
          photoIds: ['portrait'], decisions: {},
        } },
      },
    };
    writeFileSync(join(directory, 'editable-source-spec.json'), JSON.stringify(source));
    await cli(['--input', join(directory, 'editable-source-spec.json'), '--output', input]);
    const original = JSON.parse(readFileSync(input, 'utf8'));
    await inspectCli(['--input', input, '--output', editSpecification,
      '--extract-image', 'portrait', '--image-output', extracted]);
    const editable = JSON.parse(readFileSync(editSpecification, 'utf8'));
    expect(JSON.stringify(editable)).not.toContain('data:image');
    expect(editable).toMatchObject({ format: 'rpgraph-character-edit', version: '1.0.0',
      sourceCharacterId: 'editable-character', character: { images: [
        { id: 'portrait', embedded: { mimeType: 'image/jpeg' } },
        { id: 'spare', embedded: { mimeType: 'image/jpeg' } },
      ] } });
    expect(readFileSync(extracted)).toEqual(Buffer.from(original.character.images[0].dataUrl.split(',')[1], 'base64'));

    const invalid = structuredClone(editable);
    invalid.character.images = invalid.character.images.filter((image: { id: string }) => image.id !== 'portrait');
    writeFileSync(editSpecification, JSON.stringify(invalid));
    await expect(editCli(['--input', input, '--spec', editSpecification, '--output', output])).rejects.toMatchObject({ code: 1 });
    expect(readFileSync(input, 'utf8')).toBe(`${JSON.stringify(original, null, 2)}\n`);

    editable.character.name = 'Edited Name';
    editable.character.profileImage = { imageId: 'new-photo' };
    editable.character.images = [
      editable.character.images.find((image: { id: string }) => image.id === 'spare'),
      { id: 'new-photo', path: resolve('src/assets/app-icons/rpgraph-128.png'), name: 'New photo', description: 'Added later' },
    ];
    delete editable.character.apps.fotogram.avatarImageId;
    editable.character.apps.fotogram.initialPosts[0].imageId = 'new-photo';
    editable.character.apps.matchme.profile.name = 'Edited Name';
    editable.character.apps.matchme.profile.photoIds = ['spare', 'new-photo'];
    writeFileSync(editSpecification, JSON.stringify(editable));
    await editCli(['--input', input, '--spec', editSpecification, '--output', output]);
    const edited = JSON.parse(readFileSync(output, 'utf8'));
    validateCharacterContainer(edited);
    expect(edited.character.images.map((image: { id: string }) => image.id)).toEqual(['spare', 'new-photo']);
    expect(edited.character.images[0].dataUrl).toBe(original.character.images[1].dataUrl);
    expect(edited.character.images[1].size).toBeLessThanOrEqual(galleryImageMaxBytes);
    expect(edited.character.apps.fotogram).not.toHaveProperty('avatarImageId');
    expect(edited.character.apps.fotogram.initialPosts[0].imageId).toBe('new-photo');
    expect(edited.character.apps.matchme.profile.photoIds).toEqual(['spare', 'new-photo']);
    expect(edited.character.apps.fotogram.accountId).toBe(original.character.apps.fotogram.accountId);
    expect(edited.character.apps.matchme.accountId).toBe(original.character.apps.matchme.accountId);

    const beforeInPlace = readFileSync(output, 'utf8');
    await expect(editCli(['--input', output, '--spec', editSpecification])).rejects.toMatchObject({ code: 1 });
    expect(readFileSync(output, 'utf8')).toBe(beforeInPlace);
    await editCli(['--input', output, '--spec', editSpecification, '--overwrite']);
    expect(JSON.parse(readFileSync(output, 'utf8')).character.images[0].dataUrl).toBe(original.character.images[1].dataUrl);
  });

  it('leaves targets untouched on bad media, missing references and unsupported versions', async () => {
    const input = join(directory, 'invalid.json');
    const output = join(directory, 'must-not-exist.json');
    writeFileSync(join(directory, 'corrupt.png'), 'This is not an image');
    for (const source of [
      { name: 'Invalid', images: [{ key: 'corrupt', path: 'corrupt.png' }] },
      { name: 'Invalid', images: [{ key: 'missing', path: 'absent.jpg' }] },
      { name: 'Invalid', images: [{ path: resolve('src/assets/app-icons/rpgraph-16.png') }] },
      { name: 'Invalid', images: [], apps: { fotogram: { avatarImageId: 'missing' } } },
      { ...fixture, version: '9.0.0' },
    ]) {
      writeFileSync(input, JSON.stringify(source));
      await expect(cli(['--input', input, '--output', output])).rejects.toMatchObject({ code: 1 });
    }
    expect(readdirSync(directory)).not.toContain('must-not-exist.json');
  });

  it('inventories and converts all explicit demo identities without exporting engagement or inventing faces', async () => {
    const plans = demoConversionPlan();
    expect(plans).toHaveLength(204);
    expect(new Set(plans.map((entry) => entry.characterId)).size).toBe(204);
    expect(plans.flatMap((entry) => entry.posts)).toHaveLength(25);
    const output = join(directory, 'demos');
    await run(process.execPath, ['scripts/convert-demo-characters.mjs', '--output', output]);
    expect(JSON.parse(readFileSync(join(output, 'conversion-map.json'), 'utf8'))).toEqual(JSON.parse(readFileSync('docs/architecture/demo-conversion-map.json', 'utf8')));
    for (const file of readdirSync(output).filter((file) => file !== 'conversion-map.json')) {
      const card = JSON.parse(readFileSync(join(output, file), 'utf8'));
      validateCharacterContainer(card);
      const imported = planCharacterCardImport(card, structuredClone(emptyRpStorybook));
      const exported = rpCharacterCardForCharacter(imported.character, { includePosts: true });
      expect(exported.character.id).toBe(card.character.id);
      expect(exported.character.apps).toMatchObject(card.character.apps);
      expect(exported.character.images).toEqual(card.character.images);
      for (const account of Object.values(card.character.apps) as { initialPosts?: object[] }[]) {
        for (const post of account.initialPosts ?? []) expect(Object.keys(post).sort()).toEqual('imageId' in post ? ['id', 'imageId', 'text'] : ['id', 'text']);
      }
      if (card.character.id.startsWith('demo-')) {
        expect(card.character.images).toEqual([]);
        expect(card.character.apps.matchme.accountId).toBe(card.character.id);
        expect(card.character.apps.matchme).not.toHaveProperty('profile');
      }
    }
  }, 30000);
});
