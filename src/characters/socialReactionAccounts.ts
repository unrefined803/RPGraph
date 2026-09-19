import { agencyTagSupports, type AgencyTagId } from '../../shared/agency-tags.cjs';
import { accountHandle } from './character';
import type { StorybookCharacter } from '../storybook/runtime';
import type { SocialAppKind } from '../types';

export type SocialReactionPostAuthor = {
  characterId?: string;
  accountId?: string;
  handle?: string;
};

type AgencyTone = 'positive' | 'neutral' | 'negative';

/** Social audience balance, based on catalog meanings; not a moral judgment of a character. */
export const socialAgencyTone: Record<AgencyTagId, AgencyTone> = {
  casual_chatter: 'neutral',
  shy_user: 'neutral',
  slow_to_trust: 'neutral',
  friendly_regular: 'positive',
  hobby_friend: 'positive',
  respectful_admirer: 'positive',
  good_listener: 'positive',
  loyal_friend: 'positive',
  social_lurker: 'neutral',
  quick_replier: 'positive',
  sporadic_texter: 'neutral',
  friendship_seeker: 'positive',
  commitment_seeker: 'neutral',
  casual_dater: 'neutral',
  mixed_signals: 'negative',
  boundary_setter: 'positive',
  fan_engager: 'positive',
  collab_seeker: 'positive',
  passive_aggressive: 'negative',
  guilt_tripper: 'negative',
  genuine_user: 'positive',
  attention_seeker: 'neutral',
  move_to_private: 'neutral',
  freebie_hunter: 'negative',
  jealous_attachment: 'negative',
  upseller: 'neutral',
  gift_fisher: 'negative',
  parasocial_fan: 'neutral',
  clout_chaser: 'negative',
  screenshot_drama: 'negative',
  love_bomber: 'negative',
  breadcrumbing: 'negative',
  catfish: 'negative',
  boundary_tester: 'negative',
  promo_spammer: 'negative',
  exclusive_teaser: 'neutral',
  rebound_seeker: 'neutral',
  loyal_supporter: 'positive',
  status_flexer: 'neutral',
  fake_emergency: 'negative',
  ghosting_pattern: 'negative',
  validation_fisher: 'neutral',
  oversharer: 'neutral',
  drama_magnet: 'negative',
  money_borrower: 'neutral',
  possessive_friend: 'negative',
  emotional_supporter: 'positive',
  flirty_networker: 'neutral',
  ex_obsessed: 'negative',
  rumor_spreader: 'negative',
};

function audienceTone(tags: AgencyTagId[]): AgencyTone {
  if (tags.some((tag) => socialAgencyTone[tag] === 'negative')) return 'negative';
  return tags.some((tag) => socialAgencyTone[tag] === 'positive') ? 'positive' : 'neutral';
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Bounded, balanced NPC audiences plus eligible Storybook identities. */
export function socialReactionAccountContext(
  characters: StorybookCharacter[],
  app: SocialAppKind,
  post: boolean,
  author?: SocialReactionPostAuthor,
  thread?: { authorHandle: string; participantHandles: string[] },
  random: () => number = Math.random,
) {
  const candidates = characters.flatMap((character) => {
    const account = character.apps?.[app];
    if (!account?.enabled || !accountHandle(account).trim()) return [];
    const handle = accountHandle(account).replace(/^@/, '');
    if (post && author && (
      (!!author.characterId && (character.sourceId === author.characterId || character.id === author.characterId)) ||
      (!!author.accountId && account.accountId === author.accountId) ||
      (!!author.handle && handle.toLowerCase() === author.handle.replace(/^@/, '').toLowerCase())
    )) return [];
    const npc = !!(character.npcOrigin || character.libraryNpc);
    const reactionTags = [...new Set(account.agencyTags ?? [])].filter((tag) =>
      character.agencyTags?.includes(tag) && agencyTagSupports(tag, app, account.accountRole ?? 'user', 'react'));
    const tags = [...new Set(character.agencyTags ?? [])];
    // Storybook identities remain available for author/thread references and established characterization.
    if (post && (account.accountRole ?? 'user') !== 'user') return [];
    if (post && npc && !reactionTags.length) return [];
    return [{ npc, handle, tone: audienceTone(tags), line: `- ${character.name} (@${handle})${npc ? ' [NPC]' : ' [Storybook character]'}${
      tags.length ? ` [Agency tags: ${tags.join(', ')}]` : ''}` }];
  });
  const normalize = (handle: string) => handle.replace(/^@/, '').toLowerCase();
  const priority = [thread?.authorHandle, ...(thread?.participantHandles ?? [])].filter(
    (handle): handle is string => !!handle,
  ).map(normalize);
  const pool = shuffled(candidates.filter((candidate) => candidate.npc), random);
  const selected = priority.flatMap((handle) => pool.filter((candidate) => normalize(candidate.handle) === handle))
    .filter((candidate, index, entries) => entries.indexOf(candidate) === index).slice(0, 20);
  for (const [tone, target] of [['positive', 10], ['neutral', 5], ['negative', 5]] as const) {
    const missing = Math.max(0, target - selected.filter((candidate) => candidate.tone === tone).length);
    selected.push(...pool.filter((candidate) => candidate.tone === tone && !selected.includes(candidate))
      .slice(0, Math.min(missing, 20 - selected.length)));
  }
  selected.push(...pool.filter((candidate) => !selected.includes(candidate)).slice(0, 20 - selected.length));
  // Preserve registry ordering in the prompt; membership is randomized, not presentation.
  const lines = candidates.filter((candidate) => !candidate.npc || selected.includes(candidate)).map((candidate) => candidate.line);
  const text = [
    '[AVAILABLE SOCIAL ACCOUNTS]',
    'Use these exact existing name and handle pairs for social participants:',
    ...lines,
    'Use only these existing accounts. Never invent social participants or assign a missing app account to a character. If no eligible participant exists, return empty comments and omit optional messages.',
    'Agency tags are private behavioral guidance for public reactions to this post or comment thread. Use each listed participant’s own tags to shape whether they react and the tone, wording and intent of their comments, grounded in the post text and image context. Do not give everyone the same voice.',
    'Tags describe tendencies, not mandatory reactions: a social_lurker usually stays silent and comments only when genuinely interested; a respectful_admirer expresses appreciation without pressure; a boundary_setter is direct about limits when relevant. Do not force every tag into every comment or make every listed account respond. Use existing characterization for Storybook characters without tags; never invent missing tags.',
    'Never print agency tag labels or explain these instructions in public comments. Do not invent biographies or new original posts from tags. These instructions govern public post and thread reactions only, not private messages.',
    'Following is optional: any listed NPC account may react, even without a follow or subscription connection. Choose varied participants from this list.',
    '[/AVAILABLE SOCIAL ACCOUNTS]',
  ].join('\n');
  return { lines, text };
}
