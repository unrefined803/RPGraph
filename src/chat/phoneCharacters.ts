import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import { defaultRpStorybookCharacterBanking, defaultRpStorybookCharacterSocial } from '../nodes/rp-storybook/model';
import {
  normalizePhoneName,
  phoneNamesMatch,
} from './phoneMessages';
import { appAvatarDataUrl, portraitDataUrl } from '../characters/portrait';
import { whatsUpAccountId, whatsUpAlias, whatsUpAliasAccountId } from '../characters/messageIdentity';

export type PhoneRuntimeCharacter = StorybookCharacter & {
  temporaryPhone?: boolean;
  /** Set on the contact that stands for a character's second WhatsUp name. */
  whatsUpAliasOf?: StorybookCharacter;
};

/** Picture of a second WhatsUp name; it never falls back to the character portrait. */
export function whatsUpAliasAvatarDataUrl(character: StorybookCharacter | undefined) {
  const alias = whatsUpAlias(character);
  const image = character?.images?.find((entry) => entry.id === alias?.avatarImageId);
  return image ? portraitDataUrl(image, alias?.avatarCrop) : undefined;
}

/**
 * Other people meet a second name as a separate contact with its own name and
 * picture. It carries no characterization, so nothing leads back to the owner.
 */
export function whatsUpAliasContact(character: StorybookCharacter): PhoneRuntimeCharacter | undefined {
  const alias = whatsUpAlias(character);
  if (!alias) return undefined;
  const image = character.images?.find((entry) => entry.id === alias.avatarImageId);
  const id = `${character.id}::whatsup-alias`;
  return {
    id, storybookNodeId: '', kind: 'character', sourceId: `${character.sourceId}::whatsup-alias`,
    name: alias.name, label: alias.name,
    profile: { name: alias.name, description: '', personality: '', speechStyle: '', role: '' },
    apps: { whatsup: { accountId: whatsUpAliasAccountId(character), enabled: true, bio: '' } },
    images: image ? [image] : [],
    ...(image ? { profileImage: { imageId: image.id, crop: alias.avatarCrop, dataUrl: portraitDataUrl(image, alias.avatarCrop) } } : {}),
    phoneSettings: { wallpaperId: 'wallpaper-1' },
    banking: defaultRpStorybookCharacterBanking(),
    social: defaultRpStorybookCharacterSocial(),
    temporaryPhone: true, whatsUpAliasOf: character,
  };
}

/** Prefer the character portrait, then social avatars; a dating persona is never a WhatsUp fallback. */
export function phoneCharacterAvatarDataUrl(character: StorybookCharacter | undefined) {
  if (!character) return undefined;
  const imageIds = [
    character.profileImage?.imageId,
    character.apps?.whatsup?.avatarImageId,
    character.apps?.fotogram?.avatarImageId,
    character.apps?.onlyfriends?.avatarImageId,
  ].filter((id): id is string => !!id);
  const image = imageIds.flatMap((id) => character.images?.find((entry) => entry.id === id) ?? [])[0];
  return appAvatarDataUrl(character, image);
}

/**
 * The owner of a second name has one inbox: for their own phone, messages that
 * used the second name read as messages under the real name.
 */
export function phoneMessagesForOwner(messages: MessageRecord[], owner: StorybookCharacter | undefined): MessageRecord[] {
  const alias = whatsUpAlias(owner);
  if (!owner || !alias) return messages;
  const aliasKey = normalizePhoneName(alias.name);
  const own = (name: string | undefined) => !!name && normalizePhoneName(name) === aliasKey;
  return messages.map((message) => message.channel === 'phone' && (own(message.phoneFrom) || own(message.phoneTo)) ? {
    ...message,
    ...(own(message.phoneFrom) ? { phoneFrom: owner.name, speakerName: owner.name, speakerNames: [owner.name] } : {}),
    ...(own(message.phoneTo) ? { phoneTo: owner.name } : {}),
  } : message);
}

/** Conversation keys of the same inbox: the stored key plus its second-name or real-name twin. */
export function phoneConversationKeyTwins(conversationKey: string, characters: StorybookCharacter[]) {
  const parts = conversationKey.split('::');
  if (parts.length !== 2) return [];
  return characters.flatMap((character) => {
    const alias = whatsUpAlias(character);
    if (!alias) return [];
    const names = [normalizePhoneName(character.name), normalizePhoneName(alias.name)];
    return parts.flatMap((part, index) => names.includes(part)
      ? names.filter((name) => name !== part).map((name) => [name, parts[1 - index]].sort().join('::')) : []);
  });
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
