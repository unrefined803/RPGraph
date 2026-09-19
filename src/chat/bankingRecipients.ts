import type { StorybookCharacter } from '../storybook/runtime';
import { normalizePhoneName } from './phoneMessages';

/** Transfers use names, so ambiguous names cannot safely identify a recipient. */
export function bankingRecipientByName(name: string, characters: StorybookCharacter[], owner?: StorybookCharacter) {
  const key = normalizePhoneName(name);
  if (!key || (owner && key === normalizePhoneName(owner.name))) return undefined;
  const matches = characters.filter((character) => normalizePhoneName(character.name) === key);
  return matches.length === 1 ? matches[0] : undefined;
}

export function bankingRecipientCandidates(
  query: string,
  currentNames: string[],
  characters: StorybookCharacter[],
  owner?: StorybookCharacter,
) {
  const byName = new Map<string, StorybookCharacter | undefined>();
  const ownerKey = owner ? normalizePhoneName(owner.name) : '';
  for (const character of characters) {
    const key = normalizePhoneName(character.name);
    if (!key || key === ownerKey) continue;
    byName.set(key, byName.has(key) ? undefined : character);
  }
  const currentKeys = new Set(currentNames.map(normalizePhoneName));
  const current = [...currentKeys].flatMap((name) => {
    const character = byName.get(name);
    return character ? [character] : [];
  });
  const search = normalizePhoneName(query);
  if (!search) return current.slice(0, 9);
  const candidates = search.length < 3 ? current : [...byName.values()].filter(
    (character): character is StorybookCharacter => !!character);
  const matches = candidates.filter((character) => normalizePhoneName(character.name).includes(search));
  if (search.length >= 3) {
    matches.sort((left, right) =>
      Number(currentKeys.has(normalizePhoneName(right.name))) - Number(currentKeys.has(normalizePhoneName(left.name))) ||
      left.name.localeCompare(right.name));
  }
  return matches.slice(0, 9);
}
