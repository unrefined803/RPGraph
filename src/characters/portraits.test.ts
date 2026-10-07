import { describe, expect, it } from 'vitest';
import { accountPortraitUrl, characterPortraitUrl, withPortraitSlot } from './portraits';
import { newAssistantCharacter, copyAssistantCharacter, parseCharacterAssistantResult } from './assistant';
import { createCharacterContainer } from './creator';
import { characterPayload, validateCharacterPayload, type Character } from './character';
import { normalizeRpStorybook, parseRpStorybookAssistantResult, parseRpStorybookJson, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { appCharactersFromRegistry } from './appRuntime';
import { buildCharacterRegistry } from './registry';
import { phoneCharacterAvatarDataUrl, whatsUpAliasAvatarDataUrl } from '../chat/phoneCharacters';
import { datingAvatarDataUrl } from '../chat/datingAccounts';
import { withStorybookExternalImagesPruned } from '../storybook/imageLibrary';

function fixture(): Character {
  const character = newAssistantCharacter();
  const images = ['real', 'persona', 'other'].map((id) => ({ id, name: id, description: id,
    mimeType: 'image/jpeg' as const, dataUrl: 'data:image/jpeg;base64,YQ==', size: 1, width: 1000, height: 1000 }));
  return { ...character, images, profileImage: { imageId: 'real', dataUrl: images[0].dataUrl },
    customPortraits: { custom1: { imageId: 'persona', dataUrl: images[1].dataUrl, crop: { x: 10, y: 20, size: 30 } },
      custom2: { imageId: 'other', dataUrl: images[2].dataUrl, crop: { x: 40, y: 10, size: 20 } } },
    apps: { ...character.apps, whatsup: { ...character.apps!.whatsup!, portraitId: 'custom2', alias: { name: 'Work Name', portraitId: 'custom1' } },
      fotogram: { ...character.apps!.fotogram!, privacyMode: true, portraitId: 'custom1' },
      matchme: { accountId: 'dating', enabled: false, profileName: 'Persona', bio: '', portraitId: 'custom1' } } };
}

describe('shared portrait slots', () => {
  it('resolves the same cropped portrait in all apps, including private social accounts', () => {
    const character = fixture();
    const [runtime] = appCharactersFromRegistry(buildCharacterRegistry([{ character, tier: 'storybook', source: 'test' }]));
    const url = characterPortraitUrl(character, 'custom1');
    expect(url).toContain('data:image/svg+xml;base64,');
    expect(accountPortraitUrl(runtime, runtime.apps?.fotogram)).toBe(url);
    expect(whatsUpAliasAvatarDataUrl(runtime)).toBe(url);
    expect(datingAvatarDataUrl(runtime)).toBe(url);
    expect(phoneCharacterAvatarDataUrl(runtime)).toBe(characterPortraitUrl(character, 'custom2'));
    expect(runtime.profileImage?.imageId).toBe('real');
  });

  it('defaults to the real portrait without using gallery or dating-photo fallbacks', () => {
    const character = fixture();
    expect(accountPortraitUrl(character)).toBe(characterPortraitUrl(character));
    expect(accountPortraitUrl({ ...character, profileImage: undefined })).toBeUndefined();
  });

  it('preserves slots and cropped references through Storybook and portable container round trips', () => {
    const character = fixture();
    const container = createCharacterContainer(character);
    expect(container.character.customPortraits?.custom1).toEqual({ imageId: 'persona', crop: { x: 10, y: 20, size: 30 } });
    const book = normalizeRpStorybook({ characters: [container.character] });
    const restored = parseRpStorybookJson(rpStorybookJsonText(book)).characters[0];
    expect(accountPortraitUrl(restored, restored.apps?.fotogram)).toBe(characterPortraitUrl(character, 'custom1'));
    const copied = copyAssistantCharacter(restored);
    expect(copied.customPortraits?.custom1?.imageId).not.toBe('persona');
    expect(() => validateCharacterPayload(characterPayload(copied))).not.toThrow();
  });

  it('updates all followers and clears a slot transactionally without changing the gallery or real portrait', () => {
    const character = fixture();
    const before = structuredClone(character);
    const next = withPortraitSlot(character, 'custom1', { imageId: 'other', dataUrl: '', crop: { x: 0, y: 0, size: 20 } });
    expect(next.apps).toEqual(character.apps);
    expect(accountPortraitUrl(next, next.apps?.fotogram)).not.toBe(accountPortraitUrl(character, character.apps?.fotogram));
    const cleared = withPortraitSlot(next, 'custom1');
    expect(cleared.customPortraits?.custom1).toBeUndefined();
    expect(cleared.apps?.fotogram?.portraitId).toBe('character');
    expect(cleared.apps?.whatsup?.alias?.portraitId).toBe('character');
    expect(character).toEqual(before);
    expect(next.profileImage).toEqual(character.profileImage);
    expect(next.images).toBe(character.images);
  });

  it('rejects extra slots, missing galleries, missing custom selections and custom portraits without the real portrait', () => {
    const character = fixture();
    for (const customPortraits of [{ custom3: { imageId: 'real' } }, { custom1: { imageId: 'missing' } }, []]) {
      expect(() => validateCharacterPayload({ ...characterPayload(character), customPortraits })).toThrow();
    }
    expect(() => validateCharacterPayload({ ...characterPayload(character), customPortraits: {} })).toThrow('Unknown character portrait');
    expect(() => withPortraitSlot(character, 'character')).toThrow('Clear the custom portraits');
    expect(() => withPortraitSlot({ ...character, profileImage: undefined }, 'custom1', character.customPortraits!.custom1)).toThrow('Create the character portrait first');
  });

  it('keeps custom portrait media during external-image pruning', () => {
    const character = fixture();
    character.images[1].receivedFrom = 'Contact';
    const book = normalizeRpStorybook({ characters: [character] });
    expect(withStorybookExternalImagesPruned(book, []).storybook.characters[0].images.map((image) => image.id)).toContain('persona');
  });

  it('lets both assistants select slots and clears stale crops when a custom portrait image changes', () => {
    const character = fixture();
    const operations = [
      { op: 'replace', path: '/customPortraits/custom1/imageId', value: 'other' },
      { op: 'add', path: '/apps/onlyfriends', value: { enabled: true, profileName: 'Persona', bio: '', portraitId: 'custom1', privacyMode: true } },
    ];
    const response = (prefix: string) => JSON.stringify({ reply: 'Done.', patch: operations.map((op) => ({ ...op, path: prefix + op.path })) });
    const next = parseCharacterAssistantResult(response('/character'), character).character;
    expect(next.customPortraits?.custom1?.crop).toBeUndefined();
    expect(next.apps?.onlyfriends?.portraitId).toBe('custom1');
    const book = normalizeRpStorybook({ characters: [character] });
    const result = parseRpStorybookAssistantResult(response('/characters/0'), book).storybook.characters[0];
    expect(result.customPortraits?.custom1?.crop).toBeUndefined();
    expect(result.images).toEqual(book.characters[0].images);
    expect(character.customPortraits?.custom1?.crop).toBeDefined();
  });
});
