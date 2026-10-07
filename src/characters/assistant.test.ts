import { describe, expect, it } from 'vitest';
import { assignCharacterImage, characterAssistantPrompt, copyAssistantCharacter, newAssistantCharacter,
  parseCharacterAssistantResult, validateAssistantCharacter } from './assistant';
import { assertStaticCharacterImage } from './assistantMedia';
import type { Character } from './character';
import { buildCharacterRegistry } from './registry';

function fixture(): Character {
  const character = newAssistantCharacter();
  return { ...character, name: 'Alex', hiddenAgency: 'Secret motivation', banking: { startBalance: 500, fixedExpenses: [] },
    voiceConfig: { sampleName: 'Voice', sampleMimeType: 'audio/wav', sampleDataUrl: 'data:audio/wav;base64,SECRET' },
    images: ['one', 'two'].map((id) => ({ id, name: `${id}.jpg`, description: 'Existing description', mimeType: 'image/jpeg', size: 3, dataUrl: 'data:image/jpeg;base64,/9j/', width: 1, height: 1 })),
    profileImage: { imageId: 'one', dataUrl: 'data:image/jpeg;base64,/9j/', crop: { x: 0, y: 0, size: 50 } } };
}
const response = (patch: unknown[]) => JSON.stringify({ reply: 'Updated.', patch });

describe('Character Assistant edits', () => {
  it('preserves historical routing aliases when replacing an account to rename it', () => {
    const original = fixture();
    original.apps!.fotogram = { accountId: 'alex-fg', enabled: true, bio: '',
      username: 'alex.artist', displayName: 'Alex' };
    const result = parseCharacterAssistantResult(response([{ op: 'replace', path: '/character/apps/fotogram',
      value: { accountId: 'alex-fg', enabled: true, bio: '', profileName: 'New Artist' } }]), original);
    expect(result.character.apps!.fotogram).toMatchObject({ accountId: 'alex-fg', profileName: 'New Artist',
      legacyHandles: ['alex.artist', 'Alex'] });
    expect(() => parseCharacterAssistantResult(response([{ op: 'remove',
      path: '/character/apps/fotogram/legacyHandles' }]), result.character)).toThrow('cannot edit');
    expect(original.apps!.fotogram.username).toBe('alex.artist');
  });

  it('keeps playable internal and defaults authored containers to NPC', () => {
    const character = newAssistantCharacter();
    expect(character.playable).toBe(false);
    expect(() => parseCharacterAssistantResult(response([{ op: 'add', path: '/character/playable', value: true }]), character)).toThrow();
  });

  it('frames avatars on the face positions reported by the vision model', () => {
    const character = fixture();
    character.images = character.images.map((image) => ({ ...image, width: 1000, height: 2000 }));
    delete character.profileImage;
    const face = { centerX: 50, centerY: 25, height: 20 };
    const result = parseCharacterAssistantResult(JSON.stringify({ reply: 'Selecting the portrait.', faces: { one: face, two: face, missing: face },
      patch: [{ op: 'add', path: '/character/profileImage', value: { imageId: 'one' } },
        { op: 'add', path: '/character/customPortraits', value: { custom1: { imageId: 'two' } } },
        { op: 'add', path: '/character/apps/whatsup/alias', value: { name: 'Lex Work', portraitId: 'custom1' } }] }), character, ['one', 'two']);
    // A 400px head with room around it: a 600px square centered on the face.
    expect(result.character.profileImage).toMatchObject({ imageId: 'one', crop: { x: 20, y: 10, size: 60 } });
    expect(result.character.apps?.whatsup?.alias).toEqual({ name: 'Lex Work', portraitId: 'custom1' });
    expect(result.character.customPortraits?.custom1?.crop).toEqual({ x: 20, y: 10, size: 60 });
    // Repeated face estimates must not overwrite existing slot framing.
    const recentered = parseCharacterAssistantResult(JSON.stringify({ reply: 'Centered.', patch: [],
      faces: { one: { centerX: 0, centerY: 100, height: 20 }, two: { centerX: 'left' } } }), result.character, ['one', 'two']);
    expect(recentered.character.profileImage?.crop).toEqual({ x: 20, y: 10, size: 60 });
    expect(recentered.character.customPortraits?.custom1?.crop).toEqual({ x: 20, y: 10, size: 60 });
    const copy = copyAssistantCharacter(result.character);
    expect(copy.images.map((image) => image.id)).toContain(copy.customPortraits?.custom1?.imageId);
    expect(() => parseCharacterAssistantResult(JSON.stringify({ reply: 'Same name.', patch: [
      { op: 'add', path: '/character/apps/whatsup/alias', value: { name: 'Alex' } }] }), character)).toThrow(/second WhatsUp name/);
    expect(characterAssistantPrompt(character, [], 'Add a work number.', [], 'npc-characters')).toContain('apps.whatsup.alias');
  });

  it('preserves source, media, voice and identities when editing text and captions', () => {
    const original = assignCharacterImage(fixture(), 'one', 'F', true);
    const before = structuredClone(original);
    const result = parseCharacterAssistantResult(response([
      { op: 'replace', path: '/character/name', value: 'Alex Revised' },
      { op: 'replace', path: '/character/banking/startBalance', value: 900 },
      { op: 'replace', path: '/images/one/description', value: 'New description' },
      { op: 'replace', path: '/character/apps/fotogram/initialPosts/0/text', value: 'New caption' },
    ]), original).character;
    expect(original).toEqual(before);
    expect(result.id).toBe(original.id);
    expect(result.images[0].dataUrl).toBe(original.images[0].dataUrl);
    expect(result.voiceConfig).toEqual(original.voiceConfig);
    expect(result.apps?.fotogram?.initialPosts?.[0]).toEqual({ ...original.apps!.fotogram!.initialPosts![0], text: 'New caption' });
    expect(validateAssistantCharacter(result).character.hiddenAgency).toBe('Secret motivation');
  });

  it('rejects an entire invalid batch without mutating nested source fields', () => {
    const original = fixture();
    const before = structuredClone(original);
    expect(() => parseCharacterAssistantResult(response([
      { op: 'replace', path: '/character/banking/startBalance', value: 999 },
      { op: 'add', path: '/character/profileImage', value: { imageId: 'missing' } },
    ]), original)).toThrow('portrait');
    expect(original).toEqual(before);
  });

  it.each(['/character/id', '/character/voiceConfig', '/images/one/dataUrl', '/images/one/id', '/images/missing/name', '/character/apps/fotogram/accountId', '/character/__proto__/polluted', ''])('rejects managed or unknown paths: %s', (path) => {
    expect(() => parseCharacterAssistantResult(response([{ op: 'add', path, value: 'bad' }]), fixture())).toThrow();
  });

  it('rejects identity replacement and nested media injection', () => {
    const original = fixture();
    expect(() => parseCharacterAssistantResult(response([{ op: 'replace', path: '/character/apps/fotogram', value: { ...original.apps!.fotogram, accountId: 'invented' } }]), original)).toThrow('account IDs');
    expect(() => parseCharacterAssistantResult(response([{ op: 'add', path: '/character/profileImage', value: { imageId: 'one', dataUrl: 'invented' } }]), original)).toThrow('Binary media');
  });

  it('allocates new account and post IDs in the application', () => {
    const original = fixture();
    const result = parseCharacterAssistantResult(response([{ op: 'add', path: '/character/apps/onlyfriends', value: {
      enabled: true, username: 'alex.private', displayName: 'Alex', bio: '', initialPosts: [{ id: 'new-caption', imageId: 'one', text: 'Hello' }],
    } }]), original).character;
    expect(result.apps?.onlyfriends?.accountId).toBe(`character:${original.id}:onlyfriends`);
    expect(result.apps?.onlyfriends?.initialPosts?.[0].id).not.toBe('new-caption');
    expect(result.apps?.onlyfriends?.initialPosts?.[0].imageId).toBe('one');
  });

  it('rejects malformed MatchMe instead of silently discarding it during normalization', () => {
    expect(() => parseCharacterAssistantResult(response([{ op: 'add', path: '/character/apps/matchme', value: {
      enabled: true, username: 'alex', displayName: 'Alex', bio: 'Hello', profile: { name: 'Alex', age: 25, bio: 'Hello', interests: '', photoIds: [], decisions: {} },
    } }]), fixture())).toThrow('MatchMe');
  });

  it('allows photo-less disabled MatchMe drafts, and activates with one gallery photo', () => {
    const original = fixture();
    const draft = parseCharacterAssistantResult(response([{ op: 'add', path: '/character/apps/matchme', value: {
      enabled: false, username: 'alex', displayName: 'Alex', bio: 'Hello', profile: { name: 'Alex', age: 25, bio: 'Hello', interests: '', photoIds: [], decisions: {} },
    } }]), original).character;
    const ready = parseCharacterAssistantResult(response([
      { op: 'add', path: '/character/apps/matchme/profile/photoIds/-', value: 'one' },
      { op: 'replace', path: '/character/apps/matchme/enabled', value: true },
    ]), draft).character;
    expect(ready.apps?.matchme?.profile?.photoIds).toEqual(['one']);
    expect(validateAssistantCharacter(ready).character.apps.matchme?.enabled).toBe(true);
  });

  it('changes portraits without carrying the previous crop or creating posts', () => {
    const original = fixture();
    const result = parseCharacterAssistantResult(response([{ op: 'replace', path: '/character/profileImage', value: { imageId: 'two' } }]), original).character;
    expect(result.profileImage).toEqual({ imageId: 'two', dataUrl: original.images[1].dataUrl });
    expect(result.apps?.fotogram?.initialPosts).toBeUndefined();
  });

  it('removes an F publication when moving the photo to M', () => {
    const original = assignCharacterImage(fixture(), 'one', 'F', true);
    const moved = parseCharacterAssistantResult(response([
      { op: 'remove', path: '/character/apps/fotogram/initialPosts/0' },
      { op: 'add', path: '/character/apps/matchme', value: { enabled: true, username: 'alex', displayName: 'Alex', bio: 'Hello',
        profile: { name: 'Alex', age: 25, bio: 'Hello', interests: '', photoIds: ['one'], decisions: {} } } },
    ]), original).character;
    expect(moved.apps?.fotogram?.initialPosts).toEqual([]);
    expect(moved.apps?.matchme?.profile?.photoIds).toEqual(['one']);
  });

  it('keeps answers lossless, even while the user has an incomplete manual draft', () => {
    const original = { ...fixture(), name: '' };
    expect(parseCharacterAssistantResult(response([]), original).character).toBe(original);
  });

  it('copies with independent identity and rewrites all gallery references', () => {
    const original = assignCharacterImage(fixture(), 'one', 'F', true);
    const copy = copyAssistantCharacter(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.images[0].id).not.toBe(original.images[0].id);
    expect(copy.profileImage?.imageId).toBe(copy.images[0].id);
    expect(copy.apps?.fotogram?.initialPosts?.[0].imageId).toBe(copy.images[0].id);
    expect(copy.images[0].dataUrl).toBe(original.images[0].dataUrl);
    expect(() => validateAssistantCharacter(copy)).not.toThrow();
  });

  it('uses a local revision instead of the built-in character by stable identity', () => {
    const original = fixture();
    const edited = parseCharacterAssistantResult(response([{ op: 'replace', path: '/character/name', value: 'Local Alex' }]), original).character;
    const registry = buildCharacterRegistry([{ tier: 'bundled', source: 'built-in.json', character: original }, { tier: 'user', source: 'local.json', character: edited }]);
    expect(registry.characters).toHaveLength(1);
    expect(registry.characters[0].character.name).toBe('Local Alex');
  });

  it('excludes image and voice bytes from the model prompt and explains storage', () => {
    const prompt = characterAssistantPrompt(fixture(), [], 'Describe the attached image', ['one'], 'npc-characters');
    expect(prompt).not.toContain('/9j/');
    expect(prompt).not.toContain('SECRET');
    expect(prompt).toContain('Attached image IDs: ["one"]');
    expect(prompt).toContain('<userData>/npc-characters');
  });
});

describe('Character Assistant media', () => {
  it('rejects animated PNG and WebP before decoding', () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]);
    const webp = new Uint8Array([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 65, 78, 73, 77, 0, 0, 0, 0]);
    expect(() => assertStaticCharacterImage(png)).toThrow('Animated');
    expect(() => assertStaticCharacterImage(webp)).toThrow('Animated');
    expect(() => assertStaticCharacterImage(new Uint8Array([255, 216, 255]))).not.toThrow();
  });
});

describe('Character Assistant response handling for small models', () => {
  it('accepts JSON wrapped in prose or fences and repairs Markdown-escaped underscores', () => {
    const wrapped = `Here is the patch:\n\`\`\`json\n${response([{ op: 'replace', path: '/character/name', value: 'Alex Reed' }])}\n\`\`\`\nDone.`;
    expect(parseCharacterAssistantResult(wrapped, fixture()).character.name).toBe('Alex Reed');
    const escaped = '{"reply":"Tagged.","patch":[{"op":"add","path":"/character/agencyTags","value":["status\\_flexer"]}]}';
    expect(parseCharacterAssistantResult(escaped, fixture()).character.agencyTags).toEqual(['status_flexer']);
    expect(() => parseCharacterAssistantResult('I cannot do that.', fixture())).toThrow('did not return JSON');
  });

  it('treats replace on an absent optional field of a fresh draft as an upsert', () => {
    const draft = newAssistantCharacter();
    const created = parseCharacterAssistantResult(response([
      { op: 'replace', path: '/character/name', value: 'Alex Reed' },
      { op: 'replace', path: '/character/age', value: 27 },
      { op: 'replace', path: '/character/gender', value: 'man' },
      { op: 'replace', path: '/character/agencyTags', value: ['shy_user'] },
      { op: 'replace', path: '/character/banking', value: { startBalance: 900, fixedExpenses: [{ label: 'Mobile plan', amount: 20 }] } },
    ]), draft).character;
    expect(created).toMatchObject({ name: 'Alex Reed', age: 27, gender: 'man', agencyTags: ['shy_user'], banking: { startBalance: 900 } });
    expect(draft.age).toBeUndefined();
  });

  it('identifies the failing operation and still reports a misspelled field', () => {
    expect(() => parseCharacterAssistantResult(response([
      { op: 'replace', path: '/character/name', value: 'Alex Reed' },
      { op: 'replace', path: '/character/apps/fotogram/biography', value: 'Hello' },
    ]), fixture())).toThrow('Patch operation 2 (/character/apps/fotogram/biography) failed: JSON Patch path does not exist: /character/apps/fotogram/biography. replace needs an existing field; use add to create a missing one.');
  });

  it('shows rejected attempts to the model so a repeated request can correct them', () => {
    const prompt = characterAssistantPrompt(fixture(), [
      { role: 'user', text: 'Tag Alex as an influencer.' },
      { role: 'error', text: 'Character agencyTags must contain at most two unique known tag IDs. Not in the catalog: influencer. No changes were applied.' },
    ], 'Tag Alex as an influencer.', [], 'npc-characters');
    expect(prompt).toContain('user: Tag Alex as an influencer.\napp error: Character agencyTags must contain');
    expect(prompt).toContain('correct the reported cause instead of returning the same patch');
    expect(prompt).toContain('Every catalog tag is valid for every character');
  });
});
