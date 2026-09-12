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
  it('keeps playable internal and defaults authored containers to NPC', () => {
    const character = newAssistantCharacter();
    expect(character.playable).toBe(false);
    expect(() => parseCharacterAssistantResult(response([{ op: 'add', path: '/character/playable', value: true }]), character)).toThrow();
  });

  it('supports automatic cropping requests and first portrait selection', () => {
    const character = fixture();
    delete character.profileImage;
    const result = parseCharacterAssistantResult(JSON.stringify({ reply: 'Selecting the portrait.', autoCrop: true,
      patch: [{ op: 'replace', path: '/character/profileImage', value: { imageId: 'one' } }] }), character);
    expect(result.autoCrop).toBe(true);
    expect(result.character.profileImage?.imageId).toBe('one');
    expect(parseCharacterAssistantResult(JSON.stringify({ reply: 'Detecting.', patch: [], autoCrop: true }), result.character).autoCrop).toBe(true);
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
