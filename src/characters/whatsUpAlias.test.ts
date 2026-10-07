import { describe, expect, it } from 'vitest';
import fixture from './fixtures/stage4-npc.json';
import { appCharactersFromRegistry, recipientCharacterContext } from './appRuntime';
import { characterPayload, normalizeCharacterApps, validateCharacterPayload, type Character } from './character';
import {
  resolveWhatsUpMessageParticipants, resolveWhatsUpRecipient, whatsUpAliasInUse, whatsUpAliasOwner, whatsUpNameKnownBy, whatsUpNamesUsedWith,
} from './messageIdentity';
import { validateCharacterAccountDirectory, whatsUpAliasConflict } from './profiles';
import { socialPublishedLinkContext, socialReactionAccountContext } from './socialReactionAccounts';
import { parseValidatedSocialReactionsOutput, resolveSocialMessageIdentity } from '../chat/socialMessageValidation';
import { messageContactGrants } from './messageContacts';
import { buildCharacterRegistry } from './registry';
import { automaticAccountLinkGrants, parseAccountLinks } from '../chat/accountLinks';
import {
  phoneCharacterAvatarDataUrl, phoneConversationKeyTwins, phoneMessagesForOwner, phoneRuntimeCharactersFromMessages,
  whatsUpAliasAvatarDataUrl,
} from '../chat/phoneCharacters';
import { phoneMarkersWithCurrentNames, phoneMessagesWithCurrentNames } from '../chat/phoneIdentity';
import { formatChatHistory } from '../workflow/textHelpers';
import { whatsUpMessageInputText } from '../chat/phoneReplies';
import { datingAccounts, datingAvatarDataUrl, resolveDatingAccount } from '../chat/datingAccounts';
import { phoneContactsForViewer, phoneConversationInfoFromMessages, phoneConversationKey, phoneMessageShouldBeMarkedSeen, unreadPhoneConversationsForCharacters } from '../data-management/selectors';
import { parseEmbeddedBankTransfersObject, parseMessengerAppMessagesObject } from '../chat/phoneMessages';
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
      .toThrow(/already used as a name: it matches the name of Mark Hale/);
    // Spellings that resolve alike count as the same name, also against another second name.
    expect(() => validateCharacterAccountDirectory([character('a', 'Anna Roe', { name: 'mark.hale' }), mark])).toThrow(/name of Mark Hale/);
    expect(() => validateCharacterAccountDirectory([character('a', 'Anna Roe', { name: 'SofiaBelova' }), tamara]))
      .toThrow(/second WhatsUp name of Tamara Kovac/);
    expect(() => validateCharacterAccountDirectory([character('a', 'Anna Roe', { name: 'anna roe' })])).toThrow(/own name/);
    expect(whatsUpAliasConflict('Sofia Belova', 'tamara', [{ id: 'tamara', name: 'Tamara Kovac', alias: 'Sofia Belova' }])).toBeUndefined();
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
    // The owner's thread can mark where a conversation uses the second or the main account.
    expect(inbox.map((message) => message.phoneOwnerAlias)).toEqual([true, true, false]);
    expect(phoneMessagesForOwner(messages, characters.find((entry) => entry.sourceId === 'mark'))).toBe(messages);
    const phoneCharacters = phoneRuntimeCharactersFromMessages(characters, messages);
    const contacts = phoneContactsForViewer(phoneCharacters.filter((entry) => !entry.whatsUpAliasOf), {
      viewedCharacter: owner, messages: inbox, conversations: phoneConversationInfoFromMessages(inbox, {}),
      characterColors: new Map(), fallbackColor: '#fff', englishProcessingEnabled: false,
    });
    expect(contacts.find((contact) => contact.character.name === 'Mark Hale')?.latestPhoneId).toBe(messages[1].id);
    expect(phoneConversationKeyTwins(phoneConversationKey('Mark Hale', 'Sofia Belova'), owner))
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

  it('keeps identity, history and reply selection through second-account and contact renames', () => {
    const renamedOwner = structuredClone(owner);
    renamedOwner.apps!.whatsup!.alias!.name = 'New Alias';
    const renamedContact = { ...characters.find((entry) => entry.sourceId === 'mark')!, name: 'Mark Renamed' };
    const cast = [renamedOwner, renamedContact];
    const stored = [{ ...phone('Mark Hale', 'Sofia Belova', 'Hi Sofia Belova'),
      phoneFromAccountId: 'mark:whatsup', phoneToAccountId: 'tamara:whatsup:alias' }];
    expect(whatsUpNamesUsedWith(renamedOwner, renamedContact.name, stored, 'mark:whatsup'))
      .toMatchObject({ latest: 'alias', count: 1 });
    expect(resolveWhatsUpMessageParticipants(cast, stored, { from: 'Tamara Kovac', to: 'Mark Renamed' }).from)
      .toMatchObject({ name: 'New Alias', accountId: 'tamara:whatsup:alias' });
    expect(resolveWhatsUpRecipient(cast, stored, 'Sofia Belova'))
      .toMatchObject({ name: 'New Alias', accountId: 'tamara:whatsup:alias', characterId: 'tamara' });
    const current = phoneMessagesWithCurrentNames(stored, cast);
    expect(current[0]).toMatchObject({ phoneFrom: 'Mark Renamed', phoneTo: 'New Alias', originalText: 'Hi Sofia Belova' });
    expect(stored[0].phoneTo).toBe('Sofia Belova');
    expect(phoneMessagesWithCurrentNames(current, cast)).toBe(current);
    expect(phoneMessagesForOwner(stored, renamedOwner)[0]).toMatchObject({ phoneTo: 'Tamara Kovac', phoneOwnerAlias: true });
    const runtime = phoneRuntimeCharactersFromMessages(cast, current);
    expect(runtime.some((entry) => entry.name === 'Sofia Belova')).toBe(false);
    expect(formatChatHistory(stored, false, undefined, undefined, undefined, cast))
      .toContain('[WhatsUp] Mark Renamed texts New Alias (second account of Tamara Kovac): Hi Sofia Belova');
    const oldKey = phoneConversationKey('Mark Hale', 'Sofia Belova');
    const newKey = phoneConversationKey('Mark Renamed', 'New Alias');
    const seen = phoneMarkersWithCurrentNames({ [oldKey]: stored[0].id }, stored, current);
    expect(seen[newKey]).toBe(stored[0].id);
    expect(phoneConversationInfoFromMessages(current, seen).get(newKey)?.unreadByRecipient['new alias']?.unreadCount ?? 0).toBe(0);
    renamedOwner.apps!.whatsup!.alias!.name = 'Third Alias';
    const again = phoneMessagesWithCurrentNames(stored, cast);
    const nextSeen = phoneMarkersWithCurrentNames({ [newKey]: stored[0].id }, current, again);
    expect(nextSeen[phoneConversationKey('Mark Renamed', 'Third Alias')]).toBe(stored[0].id);
    expect(phoneMarkersWithCurrentNames(nextSeen, current, again)).toBe(nextSeen);
    // Reordered or deleted messages never move another message's marker.
    expect(phoneMarkersWithCurrentNames({ [oldKey]: 10 }, stored, [])).toEqual({ [oldKey]: 10 });
  });

  it('updates embedded history labels without rewriting message text or account links', () => {
    const renamed = structuredClone(owner);
    renamed.apps!.whatsup!.alias!.name = 'New Alias';
    const stored = { ...phone('Sofia Belova', 'Mark Hale', 'My old name is Sofia Belova'),
      phoneFromAccountId: 'tamara:whatsup:alias', phoneToAccountId: 'mark:whatsup' };
    const parent: MessageRecord = { id: nextId++, role: 'output', originalText: '', includeInHistory: true,
      embeddedPhoneMessages: [{ from: 'Sofia Belova', to: 'Mark Hale', message: stored.originalText, phoneMessageId: stored.id }] };
    const cast = [renamed, ...characters.filter((entry) => entry.sourceId !== 'tamara')];
    const projected = phoneMessagesWithCurrentNames([parent, stored], cast);
    expect(projected[0].embeddedPhoneMessages?.[0].from).toBe('New Alias');
    expect(formatChatHistory([parent], false, undefined, undefined, [stored], cast))
      .toContain('New Alias (second account of Tamara Kovac) texts Mark Hale: My old name is Sofia Belova');
  });

  it('still follows a history-only contact, whose account ID is not a character account', () => {
    const stored = [{ ...phone('Old Friend', 'Sofia Belova'),
      phoneFromAccountId: 'whatsup:contact:Old%20Friend', phoneToAccountId: 'tamara:whatsup:alias' }];
    const contact = phoneRuntimeCharactersFromMessages(characters, stored).find((entry) => entry.name === 'Old Friend')!;
    expect(whatsUpNamesUsedWith(owner, contact.name, stored, contact.apps?.whatsup?.accountId))
      .toMatchObject({ latest: 'alias', count: 1 });
  });

  it('uses stored account IDs before matching a reused name', () => {
    const unrelated = { ...phone('Sofia Belova', 'Mark Hale'), phoneFromAccountId: 'someone-else:whatsup', phoneToAccountId: 'mark:whatsup' };
    expect(whatsUpNamesUsedWith(owner, 'Mark Hale', [unrelated], 'mark:whatsup').count).toBe(0);
    expect(phoneMessagesForOwner([unrelated], owner)[0]).toBe(unrelated);
    // Legacy messages without account IDs still resolve by name.
    expect(whatsUpNamesUsedWith(owner, 'Mark Hale', [phone('Sofia Belova', 'Mark Hale')], 'mark:whatsup').latest).toBe('alias');
  });

  it('does not mark the other contact read when the recipient opens the main contact', () => {
    const recipient = characters.find((entry) => entry.sourceId === 'mark')!;
    const mainKey = phoneConversationKey('Mark Hale', 'Tamara Kovac');
    const secondKey = phoneConversationKey('Mark Hale', 'Sofia Belova');
    const seen = (viewer: typeof owner) => [secondKey, ...phoneConversationKeyTwins(secondKey, viewer)]
      .some((key) => phoneMessageShouldBeMarkedSeen('output', 'phone', key, mainKey, mainKey));
    expect(seen(recipient)).toBe(false);
    expect(seen(owner)).toBe(true);
    const recipientWithAlias = structuredClone(recipient);
    recipientWithAlias.apps!.whatsup!.alias = { name: 'Mark Secret' };
    expect(phoneConversationKeyTwins(secondKey, recipientWithAlias))
      .toEqual([phoneConversationKey('Mark Secret', 'Sofia Belova')]);
    expect(seen(recipientWithAlias)).toBe(false);
  });

  it.each(['disabled', 'removed'] as const)('does not revive a %s second account from history', (state) => {
    const unavailable = structuredClone(owner);
    if (state === 'disabled') unavailable.apps!.whatsup!.enabled = false;
    else delete unavailable.apps!.whatsup!.alias;
    const stored = [{ ...phone('Sofia Belova', 'Mark Hale'), phoneFromAccountId: 'tamara:whatsup:alias' }];
    const cast = [unavailable, ...characters.filter((entry) => entry.sourceId !== 'tamara')];
    for (const identity of ['Sofia Belova', '@whatsup:Sofia Belova', 'tamara:whatsup:alias']) {
      expect(() => resolveWhatsUpRecipient(cast, stored, identity)).toThrow(/Unavailable WhatsUp recipient/);
    }
    if (state === 'disabled') {
      expect(() => resolveWhatsUpRecipient(cast, [phone('Sofia Belova', 'Mark Hale')], 'Sofia Belova'))
        .toThrow(/Unavailable WhatsUp recipient/);
    }
  });

  it('follows the account a conversation last used and sends from the chosen one', () => {
    const history = [phone('Tamara Kovac', 'Mark Hale'), phone('Mark Hale', 'Sofia Belova')];
    expect(whatsUpNamesUsedWith(owner, 'Mark Hale', history)).toMatchObject({ latest: 'alias', count: 2 });
    expect(whatsUpNamesUsedWith(owner, 'Mark Hale', [...history, phone('Mark Hale', 'Tamara Kovac')]).latest).toBe('real');
    // Someone who only wrote to the second account does not know the main one.
    const aliasOnly = whatsUpNamesUsedWith(owner, 'Mark Hale', [phone('Mark Hale', 'Sofia Belova')]);
    expect([...aliasOnly.known]).toEqual(['alias']);
    expect(whatsUpNamesUsedWith(owner, 'Dexter Shaw', history)).toMatchObject({ latest: undefined, count: 0 });
    // The account picked in the chat header is an exact account ID, which is never rewritten.
    expect(resolveWhatsUpMessageParticipants(characters, [phone('Mark Hale', 'Sofia Belova')],
      { from: 'tamara:whatsup', to: 'Mark Hale' }).from).toMatchObject({ name: 'Tamara Kovac', accountId: 'tamara:whatsup' });
    expect(resolveWhatsUpMessageParticipants(characters, [phone('Tamara Kovac', 'Mark Hale')],
      { from: 'tamara:whatsup:alias', to: 'Mark Hale' }).from).toMatchObject({ name: 'Sofia Belova', accountId: 'tamara:whatsup:alias' });
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
    expect(input).toContain('This conversation: You are using the second account Sofia Belova.');
    expect(input).toContain('Preserve an established discovery');
    expect(input).not.toContain('knows you only as');
    // The recipient of a message cannot connect the sender's two names; a sender with one name needs no note.
    expect(input).not.toContain('Sender identity');
    const fromReal = whatsUpMessageInputText('Tamara Kovac', 'Mark Hale', 'hey', undefined, undefined, characters);
    expect(fromReal).toContain('Treat "Tamara Kovac" and "Sofia Belova" as separate contacts unless the history establishes that Mark Hale learned their connection');
    const fromSecond = whatsUpMessageInputText('Sofia Belova', 'Mark Hale', 'hey', undefined, undefined, characters);
    expect(fromSecond).toContain('Treat "Sofia Belova" and "Tamara Kovac" as separate contacts unless the history establishes that Mark Hale learned their connection');
    expect(fromSecond).toContain('using a different account does not undo it');
    expect(recipientCharacterContext(characters.find((entry) => entry.sourceId === 'mark')!, { app: 'whatsup' }))
      .not.toContain('Second name');
  });
});

describe('account links as message participants', () => {
  it('resolves a WhatsUp link to exactly the account it names', () => {
    expect(resolveWhatsUpRecipient(characters, [], '@whatsup:Sofia Belova')).toMatchObject({ accountId: 'tamara:whatsup:alias' });
    expect(resolveWhatsUpRecipient(characters, [], '@whatsapp:Tamara Kovac')).toMatchObject({ accountId: 'tamara:whatsup' });
    expect(() => resolveWhatsUpRecipient(characters, [], '@fotogram:Tamara Kovac')).toThrow(/Unknown WhatsUp recipient/);
    expect(resolveSocialMessageIdentity({ characters, messages: [], app: 'fotogram', identity: '@fotogram:mark.fotogram' }))
      .toMatchObject({ available: true, characterId: 'mark' });
  });

  it('continues the known account for a bare name and never overrides a link', () => {
    const knowsReal = [phone('Mark Hale', 'Tamara Kovac')];
    expect(resolveWhatsUpMessageParticipants(characters, knowsReal, { from: '@whatsup:Sofia Belova', to: '@whatsup:Mark Hale' }).from)
      .toMatchObject({ name: 'Sofia Belova', accountId: 'tamara:whatsup:alias' });
    const knowsSecond = [phone('Mark Hale', 'Sofia Belova')];
    // A bare name names no account, so the conversation stays on the one it uses.
    expect(resolveWhatsUpMessageParticipants(characters, knowsSecond, { from: 'Tamara Kovac', to: 'Mark Hale' }).from.name)
      .toBe('Sofia Belova');
    // A link is a deliberate choice: the story may reveal or discover the main account.
    for (const from of ['@whatsup:Tamara Kovac', 'whatsup:Tamara Kovac']) {
      expect(resolveWhatsUpMessageParticipants(characters, knowsSecond, { from, to: '@whatsup:Mark Hale' }).from)
        .toMatchObject({ name: 'Tamara Kovac', accountId: 'tamara:whatsup' });
    }
    expect(resolveWhatsUpMessageParticipants(characters, knowsSecond, { from: '@whatsup:Mark Hale', to: '@whatsup:Tamara Kovac' }).to.accountId)
      .toBe('tamara:whatsup');
    // The message parsers keep the name for display and remember that it was a link.
    const [parsed] = parseMessengerAppMessagesObject({ whatsUpApp: [{ from: '@whatsup:Tamara Kovac', to: 'Mark Hale', message: 'it is me' }] }).phoneMessages;
    expect(parsed).toMatchObject({ from: 'Tamara Kovac', fromLink: true });
    expect(parsed.toLink).toBeUndefined();
    expect(resolveWhatsUpMessageParticipants(characters, knowsSecond, parsed).from.accountId).toBe('tamara:whatsup');
  });

  it('resolves a link without its @ and a bare nickname in every app', () => {
    for (const identity of ['fotogram:mark.fotogram', 'Photogram: mark.fotogram', 'mark.fotogram', '@mark.fotogram']) {
      expect(resolveSocialMessageIdentity({ characters, messages: [], app: 'fotogram', identity })).toMatchObject({ available: true, characterId: 'mark' });
    }
    const dating = datingAccounts(characters);
    expect(resolveDatingAccount('matchme:mark.matchme', dating)?.id).toBe(resolveDatingAccount('@matchme:mark.matchme', dating)?.id);
    expect(resolveDatingAccount('matchme:mark.matchme', dating)).toBeDefined();
    expect(resolveSocialMessageIdentity({ characters, messages: [], app: 'fotogram', identity: 'fotogram:nobody' }))
      .toMatchObject({ available: false, name: 'fotogram:nobody' });
    expect(parseEmbeddedBankTransfersObject({ bankTransfers: [{ from: 'bank:Mark Hale', to: '@bank:Tamara Kovac', amount: 5 }] })[0])
      .toMatchObject({ from: 'Mark Hale', to: 'Tamara Kovac' });
  });

  it('refuses a relaxed spelling that reaches a second name and another name', () => {
    const clash = appCharactersFromRegistry(buildCharacterRegistry(
      [character('a', 'Anna Roe', { name: 'Night Owl' }), character('b', 'Ben Low')].map((entry) => ({ character: entry, tier: 'storybook' as const, source: 'book' }))));
    clash.find((entry) => entry.sourceId === 'b')!.apps!.fotogram!.profileName = 'night.owl';
    expect(resolveWhatsUpRecipient(clash, [], 'Night Owl').accountId).toBe('a:whatsup:alias');
    expect(() => resolveWhatsUpRecipient(clash, [], 'nightowl')).toThrow(/Ambiguous/);
  });

  it('accepts relaxed spellings inside a link for both accounts', () => {
    for (const identity of ['@whatsup:TamaraKovac', '@whatsup:tamara.kovac', '@WhatsUp: tamara_kovac', 'whatsup:Tamara Kovac']) {
      expect(resolveWhatsUpRecipient(characters, [], identity)).toMatchObject({ accountId: 'tamara:whatsup' });
    }
    for (const identity of ['@whatsup:SofiaBelova', '@whatsup:sofia.belova', 'whatsapp:Sofia Belova',
      '@whatsup:Sofia Belova (second account of Tamara Kovac)', 'Sofia Belova (second account of Tamara Kovac)']) {
      expect(resolveWhatsUpRecipient(characters, [], identity)).toMatchObject({ name: 'Sofia Belova', accountId: 'tamara:whatsup:alias' });
    }
    // A first name alone stays a guess, and the loose form never shadows a recorded identity.
    expect(() => resolveWhatsUpRecipient(characters, [], '@whatsup:Tamara')).toThrow(/Unknown WhatsUp recipient "Tamara"/);
    const recorded = [{ ...phone('whatsup:Tamara Kovac', 'Mark Hale') }];
    expect(resolveWhatsUpRecipient(characters, recorded, 'whatsup:Tamara Kovac').accountId).toMatch(/^whatsup:contact:/);
  });

  it('treats an account ID written as a link as an exact choice', () => {
    const knowsSecond = [phone('Mark Hale', 'Sofia Belova')];
    expect(resolveWhatsUpMessageParticipants(characters, knowsSecond, { from: '@whatsup:tamara:whatsup', to: '@whatsup:Mark Hale' }).from)
      .toMatchObject({ name: 'Tamara Kovac', accountId: 'tamara:whatsup' });
  });

  it('lists the links of a post author and of every participant', () => {
    const context = socialPublishedLinkContext(characters, 'fotogram', { role: 'actor', handle: 'tamara.fotogram' },
      'message me on whatsup @whatsup:Sofia Belova');
    expect(context).toContain('- Fotogram: @fotogram:tamara.fotogram (this account)');
    expect(context).toContain('- WhatsUp main account: @whatsup:Tamara Kovac');
    expect(context).toContain('- WhatsUp second account: @whatsup:Sofia Belova');
    expect(context).toContain('- @whatsup:Sofia Belova: WhatsUp second account of Tamara Kovac.');
    expect(socialPublishedLinkContext(characters, 'fotogram', { role: 'actor', handle: 'tamara.fotogram' }, 'hello'))
      .toContain('No account link was published');
    const available = socialReactionAccountContext(characters, 'fotogram', false, undefined,
      { authorHandle: 'mark.fotogram', participantHandles: ['tamara.fotogram'] }).text;
    expect(available).toContain('Account links: Fotogram @fotogram:tamara.fotogram; WhatsUp @whatsup:Tamara Kovac; WhatsUp second account @whatsup:Sofia Belova');
  });

  it('reads a comment author from this app\'s account link without a handle field', () => {
    const parsed = parseValidatedSocialReactionsOutput(JSON.stringify({
      reactions: { postId: 'fotogram-post-01', additionalLikes: 0, comments: [{ from: '@fotogram:mark.fotogram', text: 'nice' }] },
      summary: 'Mark commented.',
    }), { app: 'fotogram', postId: 'fotogram-post-01', append: true }, { characters, messages: [] });
    expect(parsed.warnings).toEqual([]);
    expect(parsed.reactions?.comments).toEqual([{ from: 'Mark Hale', handle: 'mark.fotogram', text: 'nice' }]);
  });

  it('delivers a WhatsUp message from a comment run only to a published link', () => {
    const output = (to: string) => JSON.stringify({
      reactions: { postId: 'fotogram-post-01', additionalLikes: 1, comments: [] }, summary: 'Mark reacted.',
      whatsUpApp: [{ from: '@whatsup:Mark Hale', to, message: 'saw your comment' }],
    });
    const parse = (to: string, publishedText: string) => parseValidatedSocialReactionsOutput(output(to),
      { app: 'fotogram', postId: 'fotogram-post-01', append: true }, { characters, messages: [], publishedText });
    const published = 'write me: @whatsup:Sofia Belova';
    expect(parse('@whatsup:Sofia Belova', published).phoneMessages).toMatchObject([{ to: 'tamara:whatsup:alias' }]);
    // A real name written by mistake still reaches the account that was offered.
    expect(parse('Tamara Kovac', published).phoneMessages).toMatchObject([{ to: 'tamara:whatsup:alias' }]);
    const unpublished = parse('@whatsup:Tamara Kovac', 'no link here');
    expect(unpublished.phoneMessages).toEqual([]);
    expect(unpublished.warnings.join(' ')).toMatch(/published/);
    expect(unpublished.reactions?.likes).toBe(1);
    // Without a reactions block the delivered message is not reported as unparsable JSON.
    const messageOnly = parseValidatedSocialReactionsOutput(
      JSON.stringify({ whatsUpApp: [{ from: '@whatsup:Mark Hale', to: '@whatsup:Sofia Belova', message: 'hi' }] }),
      { app: 'fotogram', postId: 'fotogram-post-01', append: true }, { characters, messages: [], publishedText: published });
    expect(messageOnly.phoneMessages).toHaveLength(1);
    expect(messageOnly.warnings).toEqual(['Social Media output is missing the reactions block.']);
  });

  it('allows removing a second account only while it has no chats', () => {
    expect(whatsUpAliasInUse(owner, [phone('Tamara Kovac', 'Mark Hale')])).toBe(false);
    expect(whatsUpAliasInUse(owner, [phone('Mark Hale', 'Sofia Belova')])).toBe(true);
    // A stored account ID decides, so a renamed account stays in use.
    expect(whatsUpAliasInUse(owner, [{ ...phone('Old Alias', 'Mark Hale'), phoneFromAccountId: 'tamara:whatsup:alias' }])).toBe(true);
    expect(whatsUpAliasInUse(characters.find((entry) => entry.sourceId === 'mark'), [phone('Mark Hale', 'Sofia Belova')])).toBe(false);
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
