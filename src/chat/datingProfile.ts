import { normalizeDatingMessages, type DatingMessage } from './datingMessages';

export const datingPhotoLimit = 3;

export const datingGenders = ['woman', 'man', 'nonbinary'] as const;
export type DatingGender = typeof datingGenders[number];
export const datingGenderLabels: Record<DatingGender, string> = {
  woman: 'Woman', man: 'Man', nonbinary: 'Non-binary / diverse',
};
export const datingSeekingLabels: Record<DatingGender, string> = {
  woman: 'Women', man: 'Men', nonbinary: 'Non-binary / diverse people',
};

/** Defaults apply only to an explicit gender change, never to a saved preference. */
export function datingSeekingOrder(gender?: DatingGender): DatingGender[] {
  const first = gender === 'woman' ? 'man' : gender === 'man' ? 'woman' : 'nonbinary';
  return [first, ...datingGenders.filter((entry) => entry !== first)];
}

/** Gallery references keep profile media in the existing Storybook image pipeline. */
export type DatingProfile = {
  /** Runtime projection of the canonical MatchMe username. */
  username?: string;
  name: string;
  age: number;
  gender?: DatingGender;
  seeking?: DatingGender[];
  bio: string;
  interests: string;
  photoIds: string[];
  messages?: DatingMessage[];
  historyVersion?: 1;
  decisions: Record<string, 'like' | 'pass'>;
};

export function normalizeDatingProfile(value: unknown, allowMissingPhoto = false): DatingProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Partial<DatingProfile>;
  const photoIds = Array.isArray(input.photoIds)
    ? [...new Set(input.photoIds.filter((id): id is string => typeof id === 'string' && !!id.trim()))].slice(0, datingPhotoLimit)
    : [];
  if (typeof input.name !== 'string' || !input.name.trim() ||
      !Number.isInteger(input.age) || input.age! < 18 || input.age! > 120 ||
      typeof input.bio !== 'string' || !input.bio.trim() || (!allowMissingPhoto && !photoIds.length)) return undefined;
  return {
    ...(typeof input.username === 'string' ? { username: input.username.trim() } : {}),
    name: input.name.trim().slice(0, 60), age: input.age!, bio: input.bio.trim().slice(0, 500),
    interests: typeof input.interests === 'string' ? input.interests.trim().slice(0, 150) : '',
    ...(datingGenders.includes(input.gender as DatingGender) ? { gender: input.gender } : {}),
    ...(Array.isArray(input.seeking) ? { seeking: datingGenders.filter((gender) => input.seeking!.includes(gender)) } : {}),
    photoIds,
    ...(input.historyVersion === 1 ? { historyVersion: 1 as const } : {}),
    ...(Array.isArray(input.messages) ? { messages: normalizeDatingMessages(input.messages) } : {}),
    decisions: Object.fromEntries(Object.entries(input.decisions && typeof input.decisions === 'object' ? input.decisions : {})
      .filter((entry) => entry[1] === 'like' || entry[1] === 'pass')),
  };
}
