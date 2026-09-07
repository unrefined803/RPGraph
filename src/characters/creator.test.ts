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
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const fixture = JSON.parse(readFileSync('src/characters/fixtures/stage4-npc.json', 'utf8'));
const cli = (args: string[]) => run(process.execPath, ['scripts/create-character-container.mjs', ...args], { encoding: 'utf8' });

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
