import { describe, expect, it } from 'vitest';
import fixture from './fixtures/stage4-npc.json';
import { appCharactersFromRegistry, recipientCharacterContext } from './appRuntime';
import { characterPayload, normalizeCharacterApps, validateCharacterPayload, type Character } from './character';
import {
  resolveWhatsUpMessageParticipants, resolveWhatsUpRecipient, whatsUpAliasOwner, whatsUpNameKnownBy,
} from './messageIdentity';
import { validateCharacterAccountDirectory } from './profiles';
import { messageContactGrants } from './messageContacts';
import { buildCharacterRegistry } from './registry';
import { automaticAccountLinkGrants, parseAccountLinks } from '../chat/accountLinks';
import {
  phoneCharacterAvatarDataUrl, phoneConversationKeyTwins, phoneMessagesForOwner, phoneRuntimeCharactersFromMessages,
  whatsUpAliasAvatarDataUrl,
} from '../chat/phoneCharacters';
import { whatsUpMessageInputText } from '../chat/phoneReplies';
import { datingAvatarDataUrl } from '../chat/datingAccounts';
import { phoneContactsForViewer, phoneConversationInfoFromMessages, phoneConversationKey, unreadPhoneConversationsForCharacters } from '../data-management/selectors';
import type { MessageRecord } from '../types';

function character(id: string, name: string, alias?: { name: string; avatarImageId?: string }): Character {
  const next = structuredClone(fixture.character) as Character;
  next.id = id; next.name = name;
  for (const [app, account] of Object.entries(next.apps!)) {
    account.accountId = `${id}:${app}`;
    account.profileName = `${id}.${app}`;
    delete account.username; delete account.displayName; delete account.legacyHandles; delete account.initialPosts;
  }
  next.apps!.whatsup = { accountId: `${id}:whatsup`, enabled: true, bio: '', ...(alias ? { alias } : {}) };
  return next;
}

const imageId = (fixture.character as Character).images[0].id;
const tamara = character('tamara', 'Tamara Kovac', { name: 'Sofia Belova', avatarImageId: imageId });
const mark = character('mark', 'Mark Hale');
const dexter = character('dexter', 'Dexter Shaw');
const characters = appCharactersFromRegistry(buildCharacterRegistry(
  [tamara, mark, dexter].map((entry) => ({ character: entry, tier: 'storybook' as const, source: 'book' }))));
const owner = characters.find((entry) => entry.sourceId === 'tamara')!;

let nextId = 1;
const phone = (from: string, to: string, text = 'hi'): MessageRecord => ({
  id: nextId++, role: 'output', originalText: text, includeInHistory: true, channel: 'phone', phoneMessage: true,
  phoneFrom: from, phoneTo: to, speakerName: from,
} as MessageRecord);

describe('WhatsUp second name', () => {
  it('is optional, validated and preserved by normalization', () => {
    expect(() => validateCharacterPayload(characterPayload(mark))).not.toThrow();
    const payload = characterPayload(tamara);
    expect(payload.apps.whatsup?.alias).toEqual({ name: 'Sofia Belova', avatarImageId: imageId });
    expect(() => validateCharacterPayload(payload)).not.toThrow();
    expect(normalizeCharacterApps({ whatsup: { alias: { name: '  ' } } }, undefined, 'x', 'X').whatsup?.alias).toBeUndefined();
    const invalid = (change: (apps: Record<string, Record<string, unknown>>) => void) => {
      const broken = structuredClone(payload) as unknown as { apps: Record<string, Record<string, unknown>> };
      change(broken.apps);
      return () => validateCharacterPayload(broken);
    };
    expect(invalid((apps) => { apps.whatsup.alias = { name: '' }; })).toThrow(/second WhatsUp name/);
    expect(invalid((apps) => { apps.fotogram.alias = { name: 'Other' }; })).toThrow(/second WhatsUp name/);
    expect(invalid((apps) => { apps.whatsup.alias = { name: 'Other', avatarImageId: 'missing' }; })).toThrow(/gallery image/);
    expect(invalid((apps) => { apps.fotogram.avatarCrop = { x: 1, y: 1, size: 10 }; })).toThrow(/avatarCrop/);
  });

  it('rejects a second name that collides with a real name', () => {
    expect(() => validateCharacterAccountDirectory([tamara, mark])).not.toThrow();
    expect(() => validateCharacterAccountDirectory([character('a', 'Anna Roe', { name: 'Mark Hale' }), mark]))
      .toThrow(/already used as a name/);
  });

  it('resolves both names to the same character with separate link identities', () => {
    const real = resolveWhatsUpRecipient(characters, [], 'Tamara Kovac');
    const second = resolveWhatsUpRecipient(characters, [], 'sofia belova');
    expect(real).toMatchObject({ name: 'Tamara Kovac', characterId: 'tamara', accountId: 'tamara:whatsup' });
    expect(second).toMatchObject({ name: 'Sofia Belova', characterId: 'tamara', accountId: 'tamara:whatsup:alias' });
    expect(resolveWhatsUpRecipient(characters, [], 'tamara:whatsup:alias')).toMatchObject({ name: 'Sofia Belova' });
    expect(whatsUpAliasOwner(characters, 'tamara:whatsup:alias', 'anything')?.sourceId).toBe('tamara');
    expect(whatsUpAliasOwner(characters, undefined, 'Tamara Kovac')).toBeUndefined();
  });

  it('recognizes both account links and grants only the shared name', () => {
    const [realLink] = parseAccountLinks('Reach me at @whatsup:Tamara Kovac.', characters);
    const [secondLink] = parseAccountLinks('Write me here: @whatsup:Sofia Belova!', characters);
    expect(realLink).toMatchObject({ accountId: 'tamara:whatsup', characterId: 'tamara', token: '@whatsup:Tamara Kovac' });
    expect(secondLink).toMatchObject({ accountId: 'tamara:whatsup:alias', characterId: 'tamara', name: 'Sofia Belova', token: '@whatsup:Sofia Belova' });
    const message = { ...phone('Sofia Belova', 'Mark Hale', 'Write me here: @whatsup:Sofia Belova'), phoneToAccountId: 'mark:whatsup' };
    expect(automaticAccountLinkGrants([message], characters).map(({ owner: grantee, link }) => [grantee.sourceId, link.accountId]))
      .toEqual([['mark', 'tamara:whatsup:alias']]);
  });

  it('shows the second name as its own contact without the real portrait or characterization', () => {
    const phoneCharacters = phoneRuntimeCharactersFromMessages(characters, []);
    const contact = phoneCharacters.find((entry) => entry.name === 'Sofia Belova')!;
    expect(contact.whatsUpAliasOf?.sourceId).toBe('tamara');
    expect(contact.sourceId).not.toBe('tamara');
    expect(contact.profile.description).toBe('');
    expect(contact.hiddenAgency).toBeUndefined();
    expect(phoneCharacterAvatarDataUrl(contact)).toBe(whatsUpAliasAvatarDataUrl(owner));
    const plain = appCharactersFromRegistry(buildCharacterRegistry(
      [{ character: character('t2', 'Tess Roe', { name: 'Agent X' }), tier: 'storybook' as const, source: 'book' }]));
    const pictureless = phoneRuntimeCharactersFromMessages(plain, []).find((entry) => entry.name === 'Agent X')!;
    expect(phoneCharacterAvatarDataUrl(pictureless)).toBeUndefined();
    // A message under the second name does not create an extra temporary contact.
    const withHistory = phoneRuntimeCharactersFromMessages(characters, [phone('Sofia Belova', 'Mark Hale')]);
    expect(withHistory.filter((entry) => entry.name === 'Sofia Belova')).toHaveLength(1);
  });

  it('keeps separate threads for the other person and one inbox for the owner', () => {
    const messages = [phone('Mark Hale', 'Sofia Belova'), phone('Sofia Belova', 'Mark Hale'), phone('Dexter Shaw', 'Tamara Kovac')];
    const stored = phoneConversationInfoFromMessages(messages, {});
    expect([...stored.keys()].sort()).toEqual([
      phoneConversationKey('Dexter Shaw', 'Tamara Kovac'), phoneConversationKey('Mark Hale', 'Sofia Belova'),
    ].sort());
    const inbox = phoneMessagesForOwner(messages, owner);
    expect(inbox.map((message) => [message.phoneFrom, message.phoneTo])).toEqual([
      ['Mark Hale', 'Tamara Kovac'], ['Tamara Kovac', 'Mark Hale'], ['Dexter Shaw', 'Tamara Kovac'],
    ]);
    expect(phoneMessagesForOwner(messages, characters.find((entry) => entry.sourceId === 'mark'))).toBe(messages);
    const phoneCharacters = phoneRuntimeCharactersFromMessages(characters, messages);
    const contacts = phoneContactsForViewer(phoneCharacters.filter((entry) => !entry.whatsUpAliasOf), {
      viewedCharacter: owner, messages: inbox, conversations: phoneConversationInfoFromMessages(inbox, {}),
      characterColors: new Map(), fallbackColor: '#fff', englishProcessingEnabled: false,
    });
    expect(contacts.find((contact) => contact.character.name === 'Mark Hale')?.latestPhoneId).toBe(messages[1].id);
    expect(phoneConversationKeyTwins(phoneConversationKey('Mark Hale', 'Sofia Belova'), characters))
      .toEqual([phoneConversationKey('Mark Hale', 'Tamara Kovac')]);
    // An unread message for the second name belongs to the owner's phone.
    const unread = unreadPhoneConversationsForCharacters(phoneCharacters, {
      narratorSelected: false, conversations: phoneConversationInfoFromMessages([phone('Mark Hale', 'Sofia Belova')], {}),
    });
    expect(unread.map((entry) => entry.viewerName)).toEqual(['Tamara Kovac']);
  });

  it('continues the name the other person already knows', () => {
    const history = [phone('Mark Hale', 'Sofia Belova')];
    expect(whatsUpNameKnownBy(owner, 'Mark Hale', history)).toBe('alias');
    expect(resolveWhatsUpMessageParticipants(characters, history, { from: 'Tamara Kovac', to: 'Mark Hale' }).from)
      .toMatchObject({ name: 'Sofia Belova', accountId: 'tamara:whatsup:alias' });
    // An exact account ID is a deliberate choice, and an unknown contact keeps the written name.
    expect(resolveWhatsUpMessageParticipants(characters, history, { from: 'tamara:whatsup', to: 'Mark Hale' }).from.name).toBe('Tamara Kovac');
    expect(resolveWhatsUpMessageParticipants(characters, history, { from: 'Tamara Kovac', to: 'Dexter Shaw' }).from.name).toBe('Tamara Kovac');
    expect(whatsUpNameKnownBy(owner, 'Mark Hale', [...history, phone('Tamara Kovac', 'Mark Hale')])).toBeUndefined();
  });

  it('never turns a second-name conversation into a contact with the real character', () => {
    const exchange = [phone('Mark Hale', 'Sofia Belova'), phone('Sofia Belova', 'Mark Hale', 'Also here: @whatsup:Sofia Belova')];
    expect(messageContactGrants(exchange, characters)).toEqual([{ ownerId: 'tamara', targetId: 'mark', app: 'whatsup' }]);
    const real = [phone('Mark Hale', 'Tamara Kovac'), phone('Tamara Kovac', 'Mark Hale')];
    expect(messageContactGrants(real, characters)).toContainEqual({ ownerId: 'mark', targetId: 'tamara', app: 'whatsup' });
  });

  it('tells only the owner about the second name', () => {
    const context = recipientCharacterContext(owner, { app: 'whatsup' });
    expect(context).toContain('Link: @whatsup:Tamara Kovac');
    expect(context).toContain('Second name link: @whatsup:Sofia Belova');
    expect(context).not.toContain('This conversation:');
    const input = whatsUpMessageInputText('Mark Hale', 'Sofia Belova', 'hey', owner, undefined, characters);
    expect(input).toContain('Reply as: Sofia Belova to Mark Hale');
    expect(input).toContain('This conversation: The other person knows you only as Sofia Belova.');
    expect(recipientCharacterContext(characters.find((entry) => entry.sourceId === 'mark')!, { app: 'whatsup' }))
      .not.toContain('Second name');
  });
});

it('frames the MatchMe avatar with a stored face region', () => {
  const dating = character('dana', 'Dana Moss');
  dating.apps!.matchme = { accountId: 'dana:matchme', enabled: true, profileName: 'Dana Moss', bio: 'Hi',
    profile: { name: 'Dana Moss', age: 30, bio: 'Hi', interests: '', photoIds: [imageId], decisions: {} } };
  const [plain] = appCharactersFromRegistry(buildCharacterRegistry([{ character: dating, tier: 'storybook', source: 'book' }]));
  const cropped = structuredClone(dating);
  cropped.apps!.matchme!.avatarCrop = { x: 10, y: 10, size: 40 };
  const [framed] = appCharactersFromRegistry(buildCharacterRegistry([{ character: cropped, tier: 'storybook', source: 'book' }]));
  expect(framed.apps?.matchme?.avatarCrop).toEqual({ x: 10, y: 10, size: 40 });
  expect(datingAvatarDataUrl(plain)).toBeTruthy();
  expect(datingAvatarDataUrl(framed)).not.toBe(datingAvatarDataUrl(plain));
});
