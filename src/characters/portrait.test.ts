import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { appAvatarDataUrl, portraitDataUrl, withCharacterPortrait } from './portrait';
import { characterPayload, validateCharacterPayload } from './character';
import { normalizeRpStorybook, parseRpStorybookJson, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { planCharacterCardImport, rpCharacterCardForCharacter } from '../storybook/characterCard';
import { buildCharacterRegistry } from './registry';
import { appCharactersFromRegistry } from './appRuntime';
import { datingAccounts } from '../chat/datingAccounts';

const container = JSON.parse(readFileSync('resources/npc-characters/luca-reed.json', 'utf8'));
const decodedSvg = (url: string) => atob(url.slice('data:image/svg+xml;base64,'.length));

describe('portable character portrait crops', () => {
  it('restores the selected area after editing, save/reload, export/import and NPC projection', () => {
    const story = normalizeRpStorybook({ characters: [container.character] });
    const character = story.characters[0];
    const image = character.images.find((image) => image.id === character.profileImage?.imageId)!;
    const crop = { x: 12, y: 8, size: 35 };
    character.profileImage = { imageId: image.id, crop, dataUrl: 'data:image/jpeg;base64,OLDPREVIEW' };
    const saved = rpStorybookJsonText(story);
    expect(saved).not.toContain('OLDPREVIEW');
    expect(saved).not.toContain('data:image/svg');
    const reloaded = parseRpStorybookJson(saved).characters[0];
    const expected = portraitDataUrl(image, crop);
    expect(reloaded.profileImage).toEqual({ imageId: image.id, crop, dataUrl: expected });
    expect(expected).not.toBe(image.dataUrl);
    const side = image.width! * 0.35;
    expect(decodedSvg(expected)).toContain(`viewBox="${image.width! * 0.12} ${image.height! * 0.08} ${side} ${side}"`);
    const exported = rpCharacterCardForCharacter(reloaded);
    expect(exported.character.profileImage).toEqual({ imageId: image.id, crop });
    const imported = planCharacterCardImport(exported, story).character;
    expect(imported.profileImage?.dataUrl).toBe(expected);
    const runtime = appCharactersFromRegistry(buildCharacterRegistry([{ character: imported, tier: 'snapshot', source: 'saved-npc' }]))[0];
    expect(runtime.profileImage?.dataUrl).toBe(expected);
    expect(appAvatarDataUrl(runtime, image)).toBe(expected);
    expect(datingAccounts([runtime])[0].avatarDataUrl).toBe(expected);
    expect(characterPayload(imported).images).toEqual(container.character.images);
  });

  it('reads dimensions from legacy JPEG bytes and clamps portrait and landscape crops to the image', () => {
    const image = container.character.images[0];
    const crop = { x: 20, y: 10, size: 40 };
    expect(portraitDataUrl({ dataUrl: image.dataUrl }, crop)).toBe(portraitDataUrl(image, crop));
    const landscape = { ...image, width: 800, height: 400 };
    expect(decodedSvg(portraitDataUrl(landscape, { x: 90, y: 90, size: 90 }))).toContain('viewBox="400 0 400 400"');
    const portrait = { ...image, width: 400, height: 800 };
    expect(decodedSvg(portraitDataUrl(portrait, { x: 90, y: 90, size: 50 }))).toContain('viewBox="200 600 200 200"');
  });

  it('keeps explicit uncropped pictures and missing portraits distinct, including round trips', () => {
    const source = structuredClone(container.character);
    delete source.profileImage;
    let story = normalizeRpStorybook({ characters: [source] });
    expect(parseRpStorybookJson(rpStorybookJsonText(story)).characters[0].profileImage).toBeUndefined();
    expect(appAvatarDataUrl(story.characters[0])).toBeUndefined();
    const image = source.images[0];
    source.profileImage = { imageId: image.id };
    story = normalizeRpStorybook({ characters: [source] });
    const reloaded = parseRpStorybookJson(rpStorybookJsonText(story)).characters[0];
    expect(reloaded.profileImage).toEqual({ imageId: image.id, dataUrl: image.dataUrl });
    expect(appAvatarDataUrl(reloaded, image)).toBe(image.dataUrl);
    expect(appAvatarDataUrl({ profileImage: { imageId: 'another', crop: { x: 0, y: 0, size: 10 } } }, image)).toBe(image.dataUrl);
  });

  it('updates apps following the portrait and preserves independent app images', () => {
    const character = normalizeRpStorybook({ characters: [container.character] }).characters[0];
    const original = structuredClone(character);
    character.apps!.onlyfriends = { ...character.apps!.fotogram!, accountId: 'separate', avatarImageId: 'scenery' };
    const next = { imageId: character.images[1].id, dataUrl: character.images[1].dataUrl, crop: { x: 5, y: 5, size: 30 } };
    const changed = withCharacterPortrait(character, next);
    expect(changed.apps?.fotogram?.avatarImageId).toBe(next.imageId);
    expect(changed.apps?.matchme?.avatarImageId).toBe(next.imageId);
    expect(changed.apps?.onlyfriends?.avatarImageId).toBe('scenery');
    expect(character.profileImage).toEqual(original.profileImage);
    const cleared = withCharacterPortrait(changed, undefined);
    expect(cleared.profileImage).toBeUndefined();
    expect(cleared.apps?.fotogram?.avatarImageId).toBeUndefined();
    expect(cleared.apps?.onlyfriends?.avatarImageId).toBe('scenery');
  });

  it('rejects malformed persisted crops while accepting omitted crops', () => {
    const source = structuredClone(container.character);
    source.profileImage = { imageId: source.images[0].id };
    expect(() => validateCharacterPayload(source)).not.toThrow();
    for (const crop of [{ x: -1, y: 0, size: 20 }, { x: 0, y: 0, size: 0 }, { x: 0, y: NaN, size: 20 }, {}]) {
      source.profileImage.crop = crop;
      expect(() => validateCharacterPayload(source)).toThrow('Portrait crops');
    }
  });
});
