import type { StorybookCharacter } from '../storybook/runtime';
import type { DatingGender } from './datingProfile';

export const datingNpcProfiles = [
  { id: 'demo-alex', name: 'Alex', age: 26, bio: 'Coffee first. Spontaneous road trip second. I will absolutely make you a playlist.', interests: ['Music', 'Road trips', 'Coffee'], gender: 'man' as const, personality: 'Warm, spontaneous and gently playful. Loves sharing music and asks thoughtful questions.', color: 'rose' },
  { id: 'demo-jamie', name: 'Jamie', age: 28, bio: 'Collecting little adventures and very big books. Tell me your most unpopular movie opinion.', interests: ['Books', 'Cinema', 'Cooking'], gender: 'woman' as const, personality: 'Thoughtful, sociable and dryly funny. Values honest conversation and lets trust grow gradually.', color: 'violet' },
  { id: 'demo-robin', name: 'Robin', age: 24, bio: 'Usually at a flea market or getting lost on a trail. Looking for a partner in side quests.', interests: ['Outdoors', 'Vintage', 'Art'], gender: 'nonbinary' as const, personality: 'Curious, independent and quietly witty. Enjoys small adventures and respects personal space.', color: 'peach' },
  { id: 'demo-sam', name: 'Sam', age: 30, bio: 'Excellent dinner guest. Questionable dancer. Let’s find our new favorite place.', interests: ['Food', 'Dancing', 'Travel'], gender: 'woman' as const, personality: 'Outgoing, generous and self-deprecating. Enjoys hosting friends, discovering restaurants and finding humor in imperfect evenings.', color: 'violet' },
];

export type DatingAccount = {
  id: string; characterId?: string; name: string; age: number; gender?: DatingGender;
  bio: string; interests: string[]; personality: string; color: string;
};
export const datingAccountId = (characterId: string) => `storybook:${characterId}`;

/** Storybook links are explicit IDs; display names never merge accounts. */
export function datingAccounts(characters: StorybookCharacter[]): DatingAccount[] {
  const accounts: DatingAccount[] = [...datingNpcProfiles];
  for (const character of characters) {
    const profile = character.social.plotTwist;
    if (!profile) continue;
    accounts.push({ id: datingAccountId(character.id), characterId: character.id,
      name: profile.name, age: profile.age, gender: profile.gender, bio: profile.bio,
      interests: profile.interests.split(',').map((part) => part.trim()).filter(Boolean),
      personality: [character.profile.personality, character.profile.speechStyle].filter(Boolean).join('\n'), color: 'violet' });
  }
  const counts = new Map<string, number>();
  accounts.forEach((account) => counts.set(account.id, (counts.get(account.id) ?? 0) + 1));
  return accounts.filter((account) => counts.get(account.id) === 1);
}

export function resolveDatingAccount(identity: string, accounts: DatingAccount[]) {
  const key = identity.trim().replace(/^@/, '');
  const byId = accounts.filter((account) => account.id === key);
  if (byId.length === 1) return byId[0];
  const matches = accounts.filter((account) => account.name.toLowerCase() === key.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}
