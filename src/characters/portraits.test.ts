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

  it('lets social accounts and the second WhatsUp account show no portrait, but not MatchMe or the main account', () => {
    const character = fixture();
    character.apps!.fotogram!.portraitId = 'none';
    character.apps!.whatsup!.alias!.portraitId = 'none';
    expect(accountPortraitUrl(character, character.apps?.fotogram)).toBeUndefined();
    expect(whatsUpAliasAvatarDataUrl(character as never)).toBeUndefined();
    expect(() => validateCharacterPayload(characterPayload(character))).not.toThrow();
    const payload = characterPayload(character);
    expect(() => validateCharacterPayload({ ...payload, apps: { ...payload.apps, matchme: { ...payload.apps.matchme, portraitId: 'none' } } })).toThrow('Unknown character portrait');
    expect(() => validateCharacterPayload({ ...payload, apps: { ...payload.apps, whatsup: { ...payload.apps.whatsup, portraitId: 'none' } } })).toThrow('Unknown character portrait');
  });

  it('rejects Storybook assistant selections the app cannot show and keeps app-managed framing', () => {
    const book = normalizeRpStorybook({ characters: [fixture()] });
    const patch = (...operations: Array<Record<string, unknown>>) => parseRpStorybookAssistantResult(JSON.stringify({ reply: 'Done.',
      patch: operations.map((operation) => ({ ...operation, path: `/characters/0${operation.path as string}` })) }), book).storybook.characters[0];
    expect(() => patch({ op: 'remove', path: '/customPortraits/custom2' })).toThrow('customPortraits.custom2 does not exist');
    expect(() => patch({ op: 'add', path: '/apps/matchme/portraitId', value: 'none' })).toThrow('always shows a portrait');
    expect(() => patch({ op: 'add', path: '/apps/fotogram/portraitId', value: 'avatar' })).toThrow('must be "character"');
    const cleared = patch({ op: 'add', path: '/apps/whatsup/portraitId', value: 'character' }, { op: 'remove', path: '/customPortraits/custom2' });
    expect(cleared.customPortraits?.custom2).toBeUndefined();
    expect(patch({ op: 'add', path: '/apps/fotogram/portraitId', value: 'none' }).apps?.fotogram?.portraitId).toBe('none');
    expect(patch({ op: 'add', path: '/customPortraits/custom1', value: { imageId: 'persona' } }, { op: 'replace', path: '/name', value: 'Renamed' })
      .customPortraits?.custom1?.crop).toEqual({ x: 10, y: 20, size: 30 });
    const kept = parseCharacterAssistantResult(JSON.stringify({ reply: 'Done.', patch: [
      { op: 'add', path: '/character/customPortraits/custom1', value: { imageId: 'persona' } }, { op: 'replace', path: '/character/role', value: 'Guide' }] }), fixture()).character;
    expect(kept.customPortraits?.custom1?.crop).toEqual({ x: 10, y: 20, size: 30 });
  });

  for (const assistant of ['character', 'storybook'] as const) {
    const apply = (character: Character, patch: Array<Record<string, unknown>>) => {
      const prefix = assistant === 'character' ? '/character' : '/characters/0';
      const response = JSON.stringify({ reply: 'Done.', patch: patch.map((op) => ({ ...op, path: prefix + op.path })) });
      return assistant === 'character' ? parseCharacterAssistantResult(response, character).character
        : parseRpStorybookAssistantResult(response, normalizeRpStorybook({ characters: [character] })).storybook.characters[0];
    };

    it(`${assistant} assistant preserves independent crops and ignores authored crop coordinates`, () => {
      const character = fixture();
      const invented = { x: 0, y: 0, size: 50 };
      const next = apply(character, [
        { op: 'add', path: '/profileImage/crop', value: invented },
        { op: 'add', path: '/customPortraits/custom1/crop', value: invented },
        { op: 'remove', path: '/customPortraits/custom2/crop' },
      ]);
      expect(next.profileImage?.crop).toBeUndefined();
      expect(next.customPortraits?.custom1?.crop).toEqual(character.customPortraits?.custom1?.crop);
      expect(next.customPortraits?.custom2?.crop).toEqual(character.customPortraits?.custom2?.crop);
    });

    it(`${assistant} assistant rejects malformed portrait values without changing the source`, () => {
      const character = fixture();
      delete character.apps!.fotogram!.portraitId;
      const before = structuredClone(character);
      for (const [path, value] of [
        ['/customPortraits', []], ['/customPortraits', null], ['/customPortraits/custom1', null],
        ['/profileImage', null], ['/apps/fotogram/portraitId', null],
      ]) {
        expect(() => apply(character, [{ op: 'add', path, value }])).toThrow();
        expect(character).toEqual(before);
      }
    });
  }

  it('uses only attached face estimates and leaves existing crops independent', () => {
    const character = fixture();
    character.customPortraits!.custom1!.imageId = 'real';
    const response = JSON.stringify({ reply: 'Done.', patch: [],
      faces: { real: { centerX: 50, centerY: 50, height: 20 } } });
    expect(parseCharacterAssistantResult(response, character).character).toEqual(character);
    const next = parseCharacterAssistantResult(response, character, ['real']).character;
    expect(next.profileImage?.crop).toBeDefined();
    expect(next.customPortraits?.custom1?.crop).toEqual(character.customPortraits?.custom1?.crop);
    expect(character.profileImage?.crop).toBeUndefined();
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
