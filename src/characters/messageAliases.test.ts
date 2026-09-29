import { canonicalPhoneName } from '../chat/phoneMessages';
import { resolveAccountLink, parseAccountLinks } from '../chat/accountLinks';
import { bankingRecipientByName } from '../chat/bankingRecipients';
import { resolveRegistryAccount } from './registry';
import { describe, expect, it } from 'vitest';
import { appCharactersFromRegistry } from './appRuntime';
import { buildCharacterRegistry } from './registry';
import { resolveWhatsUpMessageParticipants, resolveWhatsUpRecipient } from './messageIdentity';
import { resolveSocialMessageIdentity, validateSocialMessengerAccounts } from '../chat/socialMessageValidation';
import { datingAccounts, resolveDatingAccount } from '../chat/datingAccounts';

const cast = () => appCharactersFromRegistry(buildCharacterRegistry(['Alice Smith', 'Bob Jones'].map((name, index) => ({
  tier: 'storybook', source: 'book', character: {
    id: `person-${index}`, name, description: '', personality: '', speechStyle: '', role: '', images: [],
    apps: {
      whatsup: { accountId: `wa-${index}`, enabled: true, bio: '' },
      fotogram: { accountId: `fg-${index}`, enabled: true, profileName: `Photo ${index}`, legacyHandles: [`old.photo.${index}`], bio: '' },
      onlyfriends: { accountId: `of-${index}`, enabled: true, profileName: `Private ${index}`, bio: '' },
      matchme: { accountId: `mm-${index}`, enabled: true, profileName: name, bio: 'Hello', profile: { name, age: 25, bio: 'Hello', photoIds: ['portrait'], interests: '', decisions: {}, historyVersion: 1 as const } },
    },
  },
}))));

describe('cross-app message aliases', () => {
  it.each(['Alice Smith', '@Alice Smith', 'Photo 0', '@Photo 0', 'Private 0', '@Private 0', '@old.photo.0', '  @ALICE   SMITH  ', 'alice_smith', '@alice_smith', 'alice.smith', '@alice.smith', 'alicesmith', '@alicesmith', 'alice-smith', '@alice-smith', '@ALICE._ SMITH'])(
    'resolves %s to the owner in every messenger', (identity) => {
      const characters = cast();
      expect(resolveWhatsUpMessageParticipants(characters, [], { from: identity, to: '@Photo 1' }))
        .toMatchObject({ from: { name: 'Alice Smith', accountId: 'wa-0' }, to: { name: 'Bob Jones', accountId: 'wa-1' } });
      for (const app of ['fotogram', 'onlyfriends', 'matchme'] as const) {
        expect(resolveSocialMessageIdentity({ characters, messages: [], app, identity }))
          .toMatchObject({ available: true, name: 'Alice Smith' });
      }
      expect(resolveDatingAccount(identity, datingAccounts(characters))?.id).toBe('mm-0');
    },
  );

  it.each(['Alice Smith', '@alice_smith', 'alice.smith', '@alicesmith', 'alice-smith'])(
    'resolves account links, bank recipients and registry accounts for %s', (identity) => {
      const characters = cast();
      for (const app of ['whatsup', 'fotogram', 'onlyfriends', 'matchme', 'banking'] as const) {
        expect(resolveAccountLink(app, identity, characters)?.characterId).toBe(characters[0].sourceId);
        expect(parseAccountLinks(`Hello @${app}:${identity}!`, characters))
          .toMatchObject([{ characterId: characters[0].sourceId, token: `@${app}:${identity}` }]);
      }
      expect(canonicalPhoneName(characters, identity)).toBe('Alice Smith');
      expect(bankingRecipientByName(identity, characters)?.name).toBe('Alice Smith');
      expect(bankingRecipientByName(identity, characters, characters[0])).toBeUndefined();
      const registry = buildCharacterRegistry([{ tier: 'storybook', source: 'book', character: {
        id: 'alice', name: 'Alice Smith', description: '', personality: '', speechStyle: '', role: '', images: [],
        apps: characters[0].apps,
      } }]);
      for (const app of ['whatsup', 'fotogram', 'onlyfriends', 'matchme'] as const) {
        expect(resolveRegistryAccount(registry, app, identity).status).toBe('found');
      }
    },
  );

  it('rejects relaxed collisions while preserving exact nicknames across apps', () => {
    const characters = cast();
    characters[1].name = 'Alice.Smith';
    expect(resolveWhatsUpRecipient(characters, [], '@Alice.Smith').accountId).toBe('wa-1');
    expect(() => resolveWhatsUpRecipient(characters, [], '@alice_smith')).toThrow('Ambiguous');
    for (const app of ['fotogram', 'onlyfriends', 'matchme'] as const) {
      expect(resolveSocialMessageIdentity({ characters, messages: [], app, identity: '@alice_smith' }).available).toBe(false);
      expect(resolveAccountLink(app, '@alice_smith', characters)).toBeUndefined();
      expect(parseAccountLinks(`@${app}:alice_smith`, characters)).toEqual([]);
    }
    expect(bankingRecipientByName('@alice_smith', characters)).toBeUndefined();
  });

  it('accepts cross-app sender and recipient aliases in generated social JSON', () => {
    const text = JSON.stringify({ fotogramApp: [{ from: '@Private 0', to: '@Bob Jones', message: 'Hello' }] });
    expect(validateSocialMessengerAccounts({ text, characters: cast(), messages: [] }))
      .toEqual({ issues: [], sanitizedText: text });
  });

  it('rejects ambiguous fallback aliases and preserves stable target IDs', () => {
    const characters = cast();
    characters[1].apps!.onlyfriends!.profileName = 'Photo 0';
    expect(() => resolveWhatsUpRecipient(characters, [], '@Photo 0')).toThrow('Ambiguous');
    expect(resolveSocialMessageIdentity({ characters, messages: [], app: 'matchme', identity: '@Photo 0' }).available).toBe(false);
    expect(resolveWhatsUpRecipient(characters, [], 'wa-0').name).toBe('Alice Smith');
  });

  it('does not enable a disabled destination or use foreign account IDs as nicknames', () => {
    const characters = cast();
    characters[0].apps!.whatsup!.enabled = false;
    characters[0].apps!.onlyfriends!.enabled = false;
    expect(() => resolveWhatsUpRecipient(characters, [], '@Photo_0')).toThrow('Unavailable');
    expect(resolveSocialMessageIdentity({ characters, messages: [], app: 'onlyfriends', identity: '@Photo_0' }).available).toBe(false);
    expect(() => resolveWhatsUpRecipient(characters, [], 'fg-0')).toThrow('Unknown');
  });
});
