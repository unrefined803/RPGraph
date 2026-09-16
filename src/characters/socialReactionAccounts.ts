import { agencyTagSupports } from '../../shared/agency-tags.cjs';
import { accountHandle } from './character';
import type { StorybookCharacter } from '../storybook/runtime';
import type { SocialAppKind } from '../types';

export type SocialReactionPostAuthor = {
  characterId?: string;
  accountId?: string;
  handle?: string;
};

/** Post reactions use authored app tags; comment-thread identity context keeps its existing behavior. */
export function socialReactionAccountContext(
  characters: StorybookCharacter[],
  app: SocialAppKind,
  post: boolean,
  author?: SocialReactionPostAuthor,
) {
  const lines = characters.flatMap((character) => {
    const account = character.apps?.[app];
    if (!account?.enabled || !accountHandle(account).trim()) return [];
    const handle = accountHandle(account).replace(/^@/, '');
    if (post && author && (
      character.sourceId === author.characterId ||
      character.id === author.characterId ||
      account.accountId === author.accountId ||
      (!!author.handle && handle.toLowerCase() === author.handle.replace(/^@/, '').toLowerCase())
    )) return [];
    const npc = !!(character.npcOrigin || character.libraryNpc);
    const tags = post ? [...new Set(account.agencyTags ?? [])].filter((tag) =>
      character.agencyTags?.includes(tag) && agencyTagSupports(tag, app, account.accountRole ?? 'user', 'react')) : [];
    // Storybook identities remain available for author/thread references and established characterization.
    if (post && (account.accountRole ?? 'user') !== 'user') return [];
    if (post && npc && !tags.length) return [];
    return [`- ${character.name} (@${handle})${npc ? ' [NPC]' : ' [Storybook character]'}${
      tags.length ? ` [Agency tags: ${tags.join(', ')}]` : ''}`];
  });
  const text = [
    '[AVAILABLE SOCIAL ACCOUNTS]',
    'Use these exact existing name and handle pairs for social participants:',
    ...lines,
    'Use only these existing accounts. Never invent social participants or assign a missing app account to a character. If no eligible participant exists, return empty comments and omit optional messages.',
    ...(post ? [
      'Agency tags are private behavioral guidance for public reactions to this post. Use each listed participant’s own tags to shape whether they react and the tone, wording and intent of their comments, grounded in the post text and image context. Do not give everyone the same voice.',
      'Tags describe tendencies, not mandatory reactions: a social_lurker usually stays silent and comments only when genuinely interested; a respectful_admirer expresses appreciation without pressure; a boundary_setter is direct about limits when relevant. Do not force every tag into every comment or make every listed account respond. Use existing characterization for Storybook characters without tags; never invent missing tags.',
      'Never print agency tag labels or explain these instructions in public comments. Do not invent biographies or new original posts from tags. These instructions govern post reactions only, not private messages.',
    ] : []),
    'Following is optional: any listed NPC account may react, even without a follow or subscription connection. Choose varied participants from this list.',
    '[/AVAILABLE SOCIAL ACCOUNTS]',
  ].join('\n');
  return { lines, text };
}
