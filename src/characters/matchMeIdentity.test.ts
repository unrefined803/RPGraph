import { describe, expect, it } from 'vitest';
import { createAuthoredCharacter, createCharacterContainer } from './creator';
import { normalizeCharacterApps, validateCharacterContainer, type Character } from './character';
import { appCharactersFromRegistry, recipientCharacterContext } from './appRuntime';
import { buildCharacterRegistry } from './registry';
import { withCharacterAppProfile } from './profiles';
import { datingAccounts, resolveDatingAccount } from '../chat/datingAccounts';
import { phoneCharacterAvatarDataUrl } from '../chat/phoneCharacters';
import { socialDirectMessageParty } from '../chat/socialMedia';
import { browserNpcLibrarySnapshot } from './npcLibrary';
import { parseCharacterAssistantResult } from './assistant';

function source(): Character {
  return {
    id: 'real-person', name: 'Joel Vance', age: 28, gender: 'man', playable: false,
    description: 'Uses an invented dating identity.', personality: 'Calculating', speechStyle: 'Brief', role: 'Troll',
    images: ['camera', 'dating'].map((id) => ({ id, name: id, description: id, mimeType: 'image/jpeg', size: 3,
      dataUrl: `data:image/jpeg;base64,${id === 'camera' ? 'YWJj' : 'ZGVm'}` })),
    profileImage: { imageId: 'camera', dataUrl: 'data:image/jpeg;base64,YWJj' },
    apps: { matchme: { accountId: 'stable-dating', enabled: true, bio: 'Student',
      profile: { name: 'Joel Vance', age: 22, gender: 'woman', bio: 'Student', interests: 'Music', photoIds: ['dating'], decisions: {} } } },
  };
}
const runtime = (character: Character) => appCharactersFromRegistry(buildCharacterRegistry([
  { character, tier: 'bundled', source: 'test' },
]))[0];

describe('independent MatchMe identity', () => {
  it.each([undefined, 'Joel Vance', 'Chloe Vance'])('loads an optional name %s without changing the real identity', (name) => {
    const character = source();
    // Model the canonical on-disk shape: the nested name is only a runtime projection.
    const payload = JSON.parse(JSON.stringify(character));
    delete payload.apps.matchme.profile.name;
    delete payload.profileImage.dataUrl;
    if (name !== undefined) payload.apps.matchme.profileName = name;
    const raw = { format: 'rpgraph-character', version: '2.0.0', character: payload };
    expect(() => validateCharacterContainer(raw)).not.toThrow();
    const card = createAuthoredCharacter(payload, () => 'unused');
    const expected = name ?? character.name;
    expect(card.character).toMatchObject({ name: 'Joel Vance', age: 28, gender: 'man' });
    expect(card.character.apps.matchme).toMatchObject({ profileName: expected, profile: { age: 22, gender: 'woman' } });
    expect(card.character.apps.matchme!.profile).not.toHaveProperty('name');
    expect(normalizeCharacterApps(card.character.apps, undefined, character.id, character.name).matchme!.profile!.name).toBe(expected);
    expect(createCharacterContainer(card.character)).toEqual(card);
  });

  it('keeps routing, WhatsUp identity and media separate through a dating rename', () => {
    const original = source();
    original.apps = normalizeCharacterApps(original.apps, undefined, original.id, original.name);
    const renamed = withCharacterAppProfile(original, 'matchme', { ...original.apps.matchme!, profileName: 'Chloe Vance' });
    const person = runtime(renamed);
    const accounts = datingAccounts([person]);
    expect(accounts[0]).toMatchObject({ id: 'stable-dating', name: 'Chloe Vance', age: 22, gender: 'woman', avatarDataUrl: original.images[1].dataUrl });
    expect(resolveDatingAccount('Joel Vance', accounts)?.id).toBe('stable-dating');
    expect(resolveDatingAccount('Chloe Vance', accounts)?.id).toBe('stable-dating');
    expect(person.name).toBe('Joel Vance');
    expect(phoneCharacterAvatarDataUrl(person)).toBe(original.images[0].dataUrl);
    expect(person.apps!.whatsup).not.toHaveProperty('profileName');
    expect(recipientCharacterContext(person)).toContain('Name: Joel Vance');
    expect(recipientCharacterContext(person)).toContain('Public name: Chloe, 22');
    const message = { app: 'matchme' as const, messageId: 'm', sentAt: '', from: 'Joel Vance', to: 'Other',
      fromHandle: 'stable-dating', toHandle: 'other', fromAccountId: 'stable-dating', text: 'Hello' };
    expect(socialDirectMessageParty(message, 'from', [person], true, true)).toBe('Chloe, 22');
    expect(renamed.images).toEqual(original.images);
  });

  it('accepts an assistant persona edit without changing the real demographics', () => {
    const original = source();
    const result = parseCharacterAssistantResult(JSON.stringify({ reply: 'Updated.', patch: [
      { op: 'add', path: '/character/apps/matchme/profileName', value: 'Chloe Vance' },
    ] }), original).character;
    expect(result).toMatchObject({ name: 'Joel Vance', age: 28, gender: 'man' });
    expect(runtime(result).social.plotTwist).toMatchObject({ name: 'Chloe Vance', age: 22, gender: 'woman' });
  });

  it('uses no unrelated portrait when dating photos are unavailable', () => {
    const person = runtime(source());
    person.images = person.images!.filter((image) => image.id === 'camera');
    expect(datingAccounts([person])[0].avatarDataUrl).toBeUndefined();
    expect(phoneCharacterAvatarDataUrl(person)).toBe(source().images[0].dataUrl);
  });

  it('does not expose a dating persona as the WhatsUp fallback avatar', () => {
    const character = source();
    delete character.profileImage;
    character.apps!.matchme!.avatarImageId = 'dating';
    const person = runtime(character);
    expect(phoneCharacterAvatarDataUrl(person)).toBeUndefined();
    expect(datingAccounts([person])[0].avatarDataUrl).toBe(character.images[1].dataUrl);
  });

  it('assigns all four bundled troll portraits and keeps Joel behind the Chloe persona', async () => {
    const library = await browserNpcLibrarySnapshot();
    expect(library.diagnostics).toEqual([]);
    for (const id of ['chloe_bella_vance', 'tyler_briggs', 'felix_miller', 'simon_drake']) {
      const character = library.entries.find((entry) => entry.character.id === id)!.character;
      expect(character.profileImage?.imageId).toBe(`${id}:image:portrait`);
      expect(character.apps?.fotogram?.privacyMode).toBe(true);
      expect(character.apps?.onlyfriends?.privacyMode).toBe(true);
      expect(character.apps?.whatsup).not.toHaveProperty('privacyMode');
      expect(character.apps?.matchme).not.toHaveProperty('privacyMode');
      expect(phoneCharacterAvatarDataUrl(runtime(character))).toBeTruthy();
    }
    const joel = library.entries.find((entry) => entry.character.id === 'chloe_bella_vance')!.character;
    expect(joel).toMatchObject({ name: 'Joel Vance', age: 28, gender: 'man' });
    const dating = datingAccounts([runtime(joel)])[0];
    expect(dating).toMatchObject({ name: 'Chloe Vance', age: 22, gender: 'woman' });
    expect(dating.avatarDataUrl).toBe(joel.images.find((image) => image.id.endsWith(':lifestyle'))!.dataUrl);
    expect(dating.avatarDataUrl).not.toBe(phoneCharacterAvatarDataUrl(runtime(joel)));
  });
});
