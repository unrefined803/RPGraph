import {
  normalizeRpStorybookCharacter,
  rpFormatVersionStatus,
  type RpStorybook,
  type RpStorybookCharacter,
} from '../nodes/rp-storybook/model';
import formatVersions from './formatVersions.json';

const currentRpCharacterCardVersion = formatVersions.characterCard;

/**
 * A character card is one self-contained storybook character (identity texts,
 * images, voice sample, phone/banking/social setup). Story state such as
 * Opening History notes or chats stays in the storybook and never travels
 * with the card.
 */
export type RpCharacterCard = {
  format: 'rpgraph-character';
  version: string;
  character: RpStorybookCharacter;
};

export function rpCharacterCardForCharacter(character: RpStorybookCharacter): RpCharacterCard {
  return {
    format: 'rpgraph-character',
    version: currentRpCharacterCardVersion,
    character: structuredClone(character),
  };
}

export type CharacterCardImportPlan = {
  character: RpStorybookCharacter;
  /** Index of the replaced character, or undefined when the card adds a new one. */
  replacesIndex?: number;
  storybook: RpStorybook;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Validates a character card file and merges its character into the
 * storybook: a character with the same id or name is replaced in place,
 * otherwise the character is appended. Image ids are re-namespaced so they
 * never collide with the other characters' images.
 */
export function planCharacterCardImport(
  cardValue: unknown,
  storybook: RpStorybook,
): CharacterCardImportPlan {
  const card = recordValue(cardValue);
  if (card.format !== 'rpgraph-character') {
    throw new Error('The selected file is not an RPGraph Character Card.');
  }
  const versionStatus = rpFormatVersionStatus(card.version, currentRpCharacterCardVersion);
  if (versionStatus === 'newer') {
    throw new Error(
      `This character card uses Format ${String(card.version)}, which is newer than the supported Format ${currentRpCharacterCardVersion}. Update RPGraph to import it.`,
    );
  }
  if (versionStatus === 'invalid') {
    throw new Error('This character card has no valid format version.');
  }

  const sourceCharacter = recordValue(card.character);
  const sourceId = typeof sourceCharacter.id === 'string' ? sourceCharacter.id.trim() : '';
  const sourceName = typeof sourceCharacter.name === 'string' ? sourceCharacter.name.trim() : '';
  if (!sourceId && !sourceName) {
    throw new Error('This character card does not contain a valid character identity.');
  }
  const matchingIdIndex = sourceId
    ? storybook.characters.findIndex((existing) => existing.id === sourceId)
    : -1;
  const matchingNameIndex = sourceName
    ? storybook.characters.findIndex(
        (existing) => existing.name.trim().toLowerCase() === sourceName.toLowerCase(),
      )
    : -1;
  if (matchingIdIndex >= 0 && matchingNameIndex >= 0 && matchingIdIndex !== matchingNameIndex) {
    throw new Error(
      'This character card matches one existing character by id and another by name. Resolve the duplicate identity before importing it.',
    );
  }
  const replacesIndex = matchingIdIndex >= 0 ? matchingIdIndex : matchingNameIndex;

  const usedImageIds = new Set<string>();
  storybook.characters.forEach((existing, index) => {
    if (index === replacesIndex) {
      return;
    }
    existing.images.forEach((image) => usedImageIds.add(image.id));
  });

  const targetIndex = replacesIndex >= 0 ? replacesIndex : storybook.characters.length;
  const character = normalizeRpStorybookCharacter(sourceCharacter, targetIndex, usedImageIds);

  const characters = [...storybook.characters];
  if (replacesIndex >= 0) {
    // Keep the established id so chat history, phone contacts, and social
    // accounts referencing the character stay attached.
    characters[replacesIndex] = { ...character, id: characters[replacesIndex].id };
  } else {
    const existingIds = new Set(storybook.characters.map((existing) => existing.id));
    let uniqueId = character.id;
    for (let suffix = 2; existingIds.has(uniqueId); suffix += 1) {
      uniqueId = `${character.id}-${suffix}`;
    }
    characters.push({ ...character, id: uniqueId });
  }

  return {
    character: replacesIndex >= 0 ? characters[replacesIndex] : characters[characters.length - 1],
    ...(replacesIndex >= 0 ? { replacesIndex } : {}),
    storybook: { ...storybook, characters },
  };
}
