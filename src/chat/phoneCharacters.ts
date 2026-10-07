import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import { defaultRpStorybookCharacterBanking, defaultRpStorybookCharacterSocial } from '../nodes/rp-storybook/model';
import {
  normalizePhoneName,
  phoneNamesMatch,
} from './phoneMessages';
import { accountPortraitUrl, characterPortrait } from '../characters/portraits';
import { whatsUpAccountId, whatsUpAlias, whatsUpAliasAccountId } from '../characters/messageIdentity';

export type PhoneRuntimeCharacter = StorybookCharacter & {
  temporaryPhone?: boolean;
  /** Set on the contact that stands for a character's second WhatsUp name. */
  whatsUpAliasOf?: StorybookCharacter;
};

/** The second WhatsUp account resolves its own shared portrait selection. */
export function whatsUpAliasAvatarDataUrl(character: StorybookCharacter | undefined) {
  const alias = whatsUpAlias(character);
  return accountPortraitUrl(character, alias);
}

/**
 * Other people meet a second name as a separate contact with its own name and
 * picture. It carries no characterization, so nothing leads back to the owner.
 */
export function whatsUpAliasContact(character: StorybookCharacter): PhoneRuntimeCharacter | undefined {
  const alias = whatsUpAlias(character);
  if (!alias) return undefined;
  const portrait = characterPortrait(character, alias.portraitId);
  const image = character.images?.find((entry) => entry.id === portrait?.imageId);
  const id = `${character.id}::whatsup-alias`;
  return {
    id, storybookNodeId: '', kind: 'character', sourceId: `${character.sourceId}::whatsup-alias`,
    name: alias.name, label: alias.name,
    profile: { name: alias.name, description: '', personality: '', speechStyle: '', role: '' },
    apps: { whatsup: { accountId: whatsUpAliasAccountId(character), enabled: true, bio: '' } },
    images: image ? [image] : [],
    ...(portrait ? { profileImage: { ...portrait, dataUrl: accountPortraitUrl(character, alias) ?? '' } } : {}),
    phoneSettings: { wallpaperId: 'wallpaper-1' },
    banking: defaultRpStorybookCharacterBanking(),
    social: defaultRpStorybookCharacterSocial(),
    temporaryPhone: true, whatsUpAliasOf: character,
  };
}

/** Main WhatsUp account portrait; missing selection means the real character. */
export function phoneCharacterAvatarDataUrl(character: StorybookCharacter | undefined) {
  return accountPortraitUrl(character, character?.apps?.whatsup);
}

/**
 * The owner of a second name has one inbox: for their own phone, messages that
 * used the second name read as messages under the real name.
 */
export function phoneMessagesForOwner(messages: MessageRecord[], owner: StorybookCharacter | undefined): MessageRecord[] {
  const alias = whatsUpAlias(owner);
  if (!owner || !alias) return messages;
  const aliasKey = normalizePhoneName(alias.name);
  const realKey = normalizePhoneName(owner.name);
  const own = (name: string | undefined, id: string | undefined) => id
    ? id === whatsUpAliasAccountId(owner) : !!name && normalizePhoneName(name) === aliasKey;
  const real = (name: string | undefined, id: string | undefined) => id
    ? id === whatsUpAccountId(owner) : !!name && normalizePhoneName(name) === realKey;
  return messages.map((message) => {
    if (message.channel !== 'phone') return message;
    if (own(message.phoneFrom, message.phoneFromAccountId) || own(message.phoneTo, message.phoneToAccountId)) {
      return {
        ...message, phoneOwnerAlias: true,
        ...(own(message.phoneFrom, message.phoneFromAccountId) ? { phoneFrom: owner.name, speakerName: owner.name, speakerNames: [owner.name] } : {}),
        ...(own(message.phoneTo, message.phoneToAccountId) ? { phoneTo: owner.name } : {}),
      };
    }
    // The thread shows which of the two names a conversation is running under.
    return real(message.phoneFrom, message.phoneFromAccountId) || real(message.phoneTo, message.phoneToAccountId)
      ? { ...message, phoneOwnerAlias: false } : message;
  });
}

/** Only the viewed owner's two names share an inbox; the other person's contacts stay separate. */
export function phoneConversationKeyTwins(conversationKey: string, owner: StorybookCharacter | undefined) {
  const parts = conversationKey.split('::');
  if (parts.length !== 2) return [];
  const alias = whatsUpAlias(owner);
  if (!owner || !alias) return [];
  const names = [normalizePhoneName(owner.name), normalizePhoneName(alias.name)];
  return parts.flatMap((part, index) => names.includes(part)
    ? names.filter((name) => name !== part).map((name) => [name, parts[1 - index]].sort().join('::')) : []);
}

function temporaryPhoneCharacterId(name: string) {
  const slug = normalizePhoneName(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `__rpgraph-phone-temp__${slug || 'unknown'}`;
}

function phoneParticipantNames(message: MessageRecord) {
  if (message.channel !== 'phone') {
    return [];
  }
  return [
    message.phoneFrom ?? message.speakerName ?? '',
    message.phoneTo ?? '',
  ].map((name) => name.trim()).filter(Boolean);
}

export function phoneRuntimeCharactersFromMessages(
  storyCharacters: StorybookCharacter[],
  messages: MessageRecord[],
  sharedAccountIds: ReadonlySet<string> = new Set(),
): PhoneRuntimeCharacter[] {
  const phoneMessageAccountIds = new Set(messages.flatMap((message) => [message.phoneFromAccountId, message.phoneToAccountId]));
  const aliasContacts = storyCharacters.flatMap((character) => {
    const contact = whatsUpAliasContact(character);
    const accountId = contact && whatsUpAliasAccountId(character);
    return contact && accountId && (!character.libraryNpc || sharedAccountIds.has(accountId) || phoneMessageAccountIds.has(accountId))
      ? [contact] : [];
  });
  storyCharacters = storyCharacters.filter((character) => !character.libraryNpc ||
    (character.apps?.whatsup?.enabled !== false && sharedAccountIds.has(whatsUpAccountId(character))) || messages.some((message) =>
    [message.phoneFromAccountId, message.phoneToAccountId].includes(whatsUpAccountId(character))));
  const knownNames = new Set(storyCharacters.map((character) => normalizePhoneName(character.name)));
  const temporaryCharacters: PhoneRuntimeCharacter[] = [];

  messages.forEach((message) => {
    phoneParticipantNames(message).forEach((name) => {
      const normalizedName = normalizePhoneName(name);
      if (
        !normalizedName ||
        knownNames.has(normalizedName) ||
        [...storyCharacters, ...aliasContacts].some((character) => phoneNamesMatch(character.name, name)) ||
        temporaryCharacters.some((character) => phoneNamesMatch(character.name, name))
      ) {
        return;
      }
      knownNames.add(normalizedName);
      temporaryCharacters.push({
        id: temporaryPhoneCharacterId(name),
        storybookNodeId: '',
        kind: 'character',
        sourceId: temporaryPhoneCharacterId(name),
        name,
        label: name,
        profile: {
          name,
          description: '',
          personality: '',
          speechStyle: '',
          role: 'Temporary phone contact',
        },
        phoneSettings: { wallpaperId: 'wallpaper-1' },
        banking: defaultRpStorybookCharacterBanking(),
        social: defaultRpStorybookCharacterSocial(),
        temporaryPhone: true,
      });
    });
  });

  return [...storyCharacters, ...aliasContacts, ...temporaryCharacters];
}
