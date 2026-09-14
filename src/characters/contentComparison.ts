import { characterPayload } from './character';
import { normalizeRpStorybookCharacter } from '../nodes/rp-storybook/model';

type ComparableCharacter = Parameters<typeof characterPayload>[0];

function comparableContent(character: ComparableCharacter) {
  const normalized = normalizeRpStorybookCharacter(structuredClone(character), 0, new Set());
  const payload = characterPayload({ ...normalized, playable: false }, true);
  // Export can materialize empty posts; absence and an empty list mean the same thing.
  for (const account of Object.values(payload.apps)) account.initialPosts ??= [];
  return { ...payload, hiddenAgency: payload.hiddenAgency ?? '' };
}

/** Sort object keys recursively, retaining meaningful array order and all authored content. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)));
  });
}

/** Compare authored content independently of save layout, projections and runtime state. */
export function characterContentEqual(left: ComparableCharacter, right: ComparableCharacter): boolean {
  return stableJson(comparableContent(left)) === stableJson(comparableContent(right));
}
