import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import { defaultRpStorybookCharacterBanking, defaultRpStorybookCharacterSocial } from '../nodes/rp-storybook/model';
import {
  normalizePhoneName,
  phoneNamesMatch,
} from './phoneMessages';
import { appAvatarDataUrl } from '../characters/portrait';
import { whatsUpAccountId } from '../characters/messageIdentity';

export type PhoneRuntimeCharacter = StorybookCharacter & {
  temporaryPhone?: boolean;
};

/** Prefer the character portrait, then the app avatars carried by the same container. */
export function phoneCharacterAvatarDataUrl(character: StorybookCharacter | undefined) {
  if (!character) return undefined;
  const imageIds = [
    character.profileImage?.imageId,
    character.apps?.whatsup?.avatarImageId,
    character.apps?.fotogram?.avatarImageId,
    character.apps?.matchme?.avatarImageId,
    character.apps?.onlyfriends?.avatarImageId,
  ].filter((id): id is string => !!id);
  const image = imageIds.flatMap((id) => character.images?.find((entry) => entry.id === id) ?? [])[0];
  return appAvatarDataUrl(character, image);
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
        storyCharacters.some((character) => phoneNamesMatch(character.name, name)) ||
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

  return [...storyCharacters, ...temporaryCharacters];
}
