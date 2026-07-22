import type { RpStorybook } from '../nodes/rp-storybook/model';

function withoutRecordKey<T>(record: Record<string, T>, removedKey: string) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== removedKey));
}

export function storybookWithoutCharacter(
  storybook: RpStorybook,
  characterId: string,
): RpStorybook {
  return {
    ...storybook,
    characters: storybook.characters.filter((character) => character.id !== characterId),
    phoneContacts: {
      blocked: storybook.phoneContacts.blocked.filter(
        (pair) => pair.owner !== characterId && pair.contact !== characterId,
      ),
    },
    openingHistory: {
      ...storybook.openingHistory,
      socialLikes: Object.fromEntries(
        Object.entries(storybook.openingHistory.socialLikes).filter(
          ([accountKey]) => !accountKey.startsWith(`${characterId}/`),
        ),
      ),
      notes: withoutRecordKey(storybook.openingHistory.notes, characterId),
      chatGpdChats: withoutRecordKey(storybook.openingHistory.chatGpdChats, characterId),
    },
  };
}
