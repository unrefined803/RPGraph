import type { Character } from './character';
import { characterContentEqual } from './contentComparison';
import type { EffectiveCharacter, CharacterRegistryAliases } from './registry';
import type { NpcParticipantSnapshots } from './npcParticipants';
import type { RpStorybook } from '../nodes/rp-storybook/model';

/** Inspect historical values only, never the character definitions or snapshot archive itself. */
export function characterUsageReasons(character: Character, aliases: CharacterRegistryAliases, history: unknown, others: Character[] = []): string[] {
  // Social directories persist prefixed character/account IDs, including legacy aliases.
  const directoryIds = [character.id, ...(aliases.characterIds ?? []),
    ...Object.values(character.apps ?? {}).map((account) => account.accountId),
    ...Object.values(aliases.accountIds ?? {}).flat()];
  const identities = new Set([...directoryIds.flatMap((id) => [id, `storybook:${id}`]),
    ...Object.values(character.apps ?? {}).map((account) => account.username).filter(Boolean),
    ...character.images.map((image) => image.id),
    ...Object.values(character.apps ?? {}).flatMap((account) => account.initialPosts?.map((post) => post.id) ?? [])]);
  const name = character.name.trim();
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePattern = name ? new RegExp(`(^|[^\\p{L}\\p{N}_])${escapedName}($|[^\\p{L}\\p{N}_])`, 'iu') : undefined;
  const references = (value: unknown): boolean => {
    if (typeof value === 'string') {
      if (value.startsWith('data:')) return false;
      return identities.has(value) || !!namePattern?.test(value) ||
        [...identities].some((id) => value.startsWith(`${id}/`) || value.includes(JSON.stringify(id)));
    }
    if (Array.isArray(value)) return value.some(references);
    if (value && typeof value === 'object') return Object.entries(value).some(([key, entry]) =>
      !['npcParticipants', 'voiceMedia', 'dataUrl', 'graphText', 'nodeSnapshots'].includes(key) && (references(key) || references(entry)));
    return false;
  };
  const reasons: string[] = [];
  if (references(history)) reasons.push('Referenced by chat, Opening History or saved app activity.');
  if (others.some((other) => other.id !== character.id && other.relationships?.some((relationship) => relationship.characterId === character.id))) {
    reasons.push('Referenced by another character’s relationships.');
  }
  return reasons;
}

export type CharacterRemovalInfo = {
  name: string;
  reasons: string[];
  matchesLibrary: boolean;
};

export function characterRemovalInfo(character: Character, libraryCharacter: Character | undefined, reasons: string[]): CharacterRemovalInfo {
  return { name: character.name, reasons, matchesLibrary: !!libraryCharacter && characterContentEqual(character, libraryCharacter) };
}

/** Keep stable aliases and the exact authored revision when retiring a playable character. */
function retiredCharacterSnapshot(entry: EffectiveCharacter): NpcParticipantSnapshots[string] {
  return { character: { ...structuredClone(entry.character), playable: false },
    source: entry.provenance.source, aliases: structuredClone(entry.aliases), npcOrigin: entry.npcOrigin };
}

export function storybookWithRetiredCharacter(book: RpStorybook, entry: EffectiveCharacter): RpStorybook {
  return { ...book, characters: book.characters.filter((character) => character.id !== entry.character.id),
    openingHistory: { ...book.openingHistory, npcParticipants: {
      ...book.openingHistory.npcParticipants, [entry.character.id]: retiredCharacterSnapshot(entry),
    } } };
}
