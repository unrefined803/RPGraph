import { accountHandle } from './character';
import type { Character } from './character';
import { characterContentEqual } from './contentComparison';
import type { EffectiveCharacter, CharacterRegistryAliases } from './registry';
import type { NpcParticipantSnapshots } from './npcParticipants';
import type { RpStorybook } from '../nodes/rp-storybook/model';

type UsageCharacter = Pick<Character, 'id' | 'name' | 'apps' | 'images'>;
const excludedUsageKeys = new Set(['npcParticipants', 'voiceMedia', 'dataUrl', 'graphText', 'nodeSnapshots']);

function usageIdentity(character: UsageCharacter, aliases: CharacterRegistryAliases) {
  // Social directories persist prefixed character/account IDs, including legacy aliases.
  const directoryIds = [character.id, ...(aliases.characterIds ?? []),
    ...Object.values(character.apps ?? {}).map((account) => account.accountId),
    ...Object.values(aliases.accountIds ?? {}).flat()];
  const identities = new Set([...directoryIds.flatMap((id) => [id, `storybook:${id}`]),
    ...Object.values(character.apps ?? {}).map((account) => accountHandle(account)).filter(Boolean),
    ...character.images.map((image) => image.id),
    ...Object.values(character.apps ?? {}).flatMap((account) => account.initialPosts?.map((post) => post.id) ?? [])]);
  const name = character.name.trim();
  return { identities: [...identities], name };
}

function createUsageMatcher(identity: ReturnType<typeof usageIdentity>, cacheObjects: boolean) {
  const identities = new Set(identity.identities);
  const prefixes = identity.identities.map((id) => `${id}/`);
  const quotedIds = identity.identities.map((id) => JSON.stringify(id));
  const escapedName = identity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePattern = identity.name ? new RegExp(`(^|[^\\p{L}\\p{N}_])${escapedName}($|[^\\p{L}\\p{N}_])`, 'iu') : undefined;
  const objects = cacheObjects ? new WeakMap<object, boolean>() : undefined;
  const strings = new Map<string, boolean>();
  const references = (value: unknown): boolean => {
    if (typeof value === 'string') {
      if (value.startsWith('data:')) return false;
      const cached = strings.get(value);
      if (cached !== undefined) return cached;
      const result = identities.has(value) || !!namePattern?.test(value) ||
        prefixes.some((prefix) => value.startsWith(prefix)) || quotedIds.some((id) => value.includes(id));
      // Bound retained text while reusing repeated field names and unchanged text.
      if (strings.size < 2048) strings.set(value, result);
      return result;
    }
    if (!value || typeof value !== 'object') return false;
    const cached = objects?.get(value);
    if (cached !== undefined) return cached;
    const result = Array.isArray(value) ? value.some(references) :
      Object.entries(value).some(([key, entry]) => !excludedUsageKeys.has(key) && (references(key) || references(entry)));
    objects?.set(value, result);
    return result;
  };
  return references;
}

/** Inspect historical values only, never character definitions or snapshot archives. */
export function characterUsageReasons(character: UsageCharacter, aliases: CharacterRegistryAliases, history: unknown): string[] {
  return createUsageMatcher(usageIdentity(character, aliases), false)(history)
    ? ['Referenced by chat, Opening History or saved app activity.'] : [];
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
