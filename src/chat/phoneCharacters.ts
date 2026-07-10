import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import { defaultRpStorybookCharacterBanking, defaultRpStorybookCharacterSocial } from '../nodes/rp-storybook-v1/model';
import {
  normalizePhoneName,
  phoneNamesMatch,
} from './phoneMessages';

export type PhoneRuntimeCharacter = StorybookCharacter & {
  temporaryPhone?: boolean;
};

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
): PhoneRuntimeCharacter[] {
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
