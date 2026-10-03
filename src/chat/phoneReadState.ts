import type { StorybookCharacter } from '../storybook/runtime';

/** Numeric read boundaries used by all phone apps; badges are derived from them. */
export type PhoneReadState = {
  phoneSeenByConversation: Record<string, number>;
  bankingSeenByCharacter: Record<string, number>;
  phoneAppSeenByCharacter: Record<string, number>;
  phoneDividerAfterByConversation: Record<string, number>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function normalizePhoneReadState(value: unknown): PhoneReadState {
  const source = record(value);
  const markers = (key: keyof PhoneReadState) => Object.fromEntries(Object.entries(record(source[key]))
    .filter((entry): entry is [string, number] => Number.isSafeInteger(entry[1]) && Number(entry[1]) >= 0));
  return {
    phoneSeenByConversation: markers('phoneSeenByConversation'),
    bankingSeenByCharacter: markers('bankingSeenByCharacter'),
    phoneAppSeenByCharacter: markers('phoneAppSeenByCharacter'),
    phoneDividerAfterByConversation: markers('phoneDividerAfterByConversation'),
  };
}

/** Storybooks use stable character identities, not workflow-specific node IDs. */
export function rekeyPhoneReadState(
  state: PhoneReadState,
  characters: Pick<StorybookCharacter, 'id' | 'sourceId'>[],
  direction: 'store' | 'load',
): PhoneReadState {
  const identities = characters.map(character => direction === 'store'
    ? [character.id, character.sourceId] : [character.sourceId, character.id])
    .sort((left, right) => right[0].length - left[0].length);
  const rekey = (values: Record<string, number>, appKey: boolean) => Object.fromEntries(
    Object.entries(values).map(([key, marker]) => {
      const identity = identities.find(([id]) => appKey ? key.startsWith(`${id}:`) : key === id);
      return [identity ? identity[1] + key.slice(identity[0].length) : key, marker];
    }),
  );
  return { ...state,
    bankingSeenByCharacter: rekey(state.bankingSeenByCharacter, false),
    phoneAppSeenByCharacter: rekey(state.phoneAppSeenByCharacter, true),
  };
}

/**
 * Undo can leave boundaries above the highest remaining message ID. Loading
 * restarts ID allocation below them, so later messages would count as read.
 */
export function clampPhoneReadState(state: PhoneReadState, highestMessageId: number): PhoneReadState {
  return Object.fromEntries(Object.entries(state).map(([key, markers]) => [key,
    Object.fromEntries(Object.entries(markers).map(([id, marker]) => [id, Math.min(marker, highestMessageId)])),
  ])) as PhoneReadState;
}

/** The ID mapping must preserve numeric order so read prefixes stay prefixes. */
export function remapPhoneReadState(state: PhoneReadState, ids: ReadonlyMap<number, number>): PhoneReadState {
  const ordered = [...ids].sort((left, right) => left[0] - right[0]);
  const remap = (marker: number) => {
    let low = 0;
    let high = ordered.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (ordered[mid][0] <= marker) low = mid + 1;
      else high = mid;
    }
    return low ? ordered[low - 1][1] : 0;
  };
  return Object.fromEntries(Object.entries(state).map(([key, markers]) => [key,
    Object.fromEntries(Object.entries(markers).map(([id, marker]) => [id, remap(marker)])),
  ])) as PhoneReadState;
}
