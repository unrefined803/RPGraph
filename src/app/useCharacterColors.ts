import { createStableDerivedValueSelector } from '../chat/stableDerivedValue';
import { useMemo, useState, type CSSProperties } from 'react';
import type { StorybookCharacter } from '../storybook/runtime';
import { whatsUpAlias } from '../characters/messageIdentity';
import {
  characterColorToken, characterColorValue, reserveCharacterColors,
  type CharacterColorSlots,
} from '../chat/characterColors';

export function useCharacterColors(characters: StorybookCharacter[], players: StorybookCharacter[], interactedIds: string[]) {
  const [selectColors] = useState(() => createStableDerivedValueSelector<Map<string, string>>());
  const [selectStyle] = useState(() => createStableDerivedValueSelector<CSSProperties>());
  const [savedSlots, setCharacterColorSlots] = useState<CharacterColorSlots>({});
  // Reserve initial players first; existing slots always win, including promoted NPCs.
  const characterColorSlots = reserveCharacterColors(savedSlots, [...players.map((character) => character.sourceId), ...interactedIds]);
  if (characterColorSlots !== savedSlots) setCharacterColorSlots(characterColorSlots);
  const eligibleCharacters = useMemo(() => {
    const ids = new Set([...players.map((character) => character.sourceId), ...interactedIds]);
    return characters.filter((character) => ids.has(character.sourceId));
  }, [characters, players, interactedIds]);
  const characterColors = useMemo(() => selectColors(new Map(eligibleCharacters.flatMap((character) => {
    // A second WhatsUp name shares its owner's color.
    const alias = whatsUpAlias(character)?.name.trim();
    return [[character.name, characterColorToken(character)], ...(alias ? [[alias, characterColorToken(character)]] : [])] as Array<[string, string]>;
  }))), [eligibleCharacters, selectColors]);
  const characterColorStyle = useMemo(() => selectStyle(Object.fromEntries(eligibleCharacters.map((character) => [
    characterColorToken(character).slice(4, -1),
    characterColorValue(characterColorSlots[character.sourceId], character.playerSelectable !== false),
  ])) as CSSProperties), [eligibleCharacters, characterColorSlots, selectStyle]);
  return { characterColors, characterColorSlots, setCharacterColorSlots, characterColorStyle };
}
