import { accountHandle } from './character';
import type { Character } from './character';
import { characterContentEqual } from './contentComparison';
import type { EffectiveCharacter, CharacterRegistryAliases } from './registry';
import type { NpcParticipantSnapshots } from './npcParticipants';
import type { RpStorybook } from '../nodes/rp-storybook/model';

/** Inspect historical values only, never the character definitions or snapshot archive itself. */
export function characterUsageReasons(character: Character, aliases: CharacterRegistryAliases, history: unknown): string[] {
  // Social directories persist prefixed character/account IDs, including legacy aliases.
  const directoryIds = [character.id, ...(aliases.characterIds ?? []),
    ...Object.values(character.apps ?? {}).map((account) => account.accountId),
    ...Object.values(aliases.accountIds ?? {}).flat()];
  const identities = new Set([...directoryIds.flatMap((id) => [id, `storybook:${id}`]),
    ...Object.values(character.apps ?? {}).map((account) => accountHandle(account)).filter(Boolean),
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
  return reasons;
}

export type CharacterRemovalInfo = {
  name: string;
  reasons: string[];
  warnings: string[];
  matchesLibrary: boolean;
};

export function characterStoryTextWarnings(storybook: RpStorybook, characterName: string): string[] {
  const nameParts = (characterName.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [])
    .filter((part, index, parts) => parts.findIndex((candidate) => candidate.localeCompare(part, undefined, { sensitivity: 'base' }) === 0) === index);
  const fields = [
    ['Introduction', storybook.introduction],
    ['Scenario Summary', storybook.scenario.summary],
    ['Opening Situation', storybook.scenario.openingSituation],
    ['Current Situation', storybook.scenario.currentSituation],
  ];
  return nameParts.flatMap((namePart) => {
    const escapedName = namePart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const namePattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapedName}($|[^\\p{L}\\p{N}_])`, 'iu');
    const matches = fields.flatMap(([label, text]) => namePattern.test(text) ? label : []);
    return matches.length > 0
      ? `“${namePart}” is still mentioned in ${matches.join(', ')}. Review the story text with “Check Story Logic” in the Storybook assistant.`
      : [];
  });
}

export function characterRemovalInfo(
  character: Character,
  libraryCharacter: Character | undefined,
  reasons: string[],
  warnings: string[] = [],
): CharacterRemovalInfo {
  return { name: character.name, reasons, warnings,
    matchesLibrary: !!libraryCharacter && characterContentEqual(character, libraryCharacter) };
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
