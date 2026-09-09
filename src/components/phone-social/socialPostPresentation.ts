import { npcSeedPostAccountId } from '../../characters/npcParticipants';

export type SocialPost = {
  id: string;
  authorName: string;
  authorHandle: string;
  caption: string;
  likeCount: number;
  commentCount: number;
  comments?: SocialComment[];
  unlockPrice?: number;
  locked: boolean;
  dummy: boolean;
  textOnly?: boolean;
  imageDataUrl?: string;
  imageId?: string;
  imageDescription?: string;
  rpDateTime?: string;
};

export type SocialComment = {
  id: string;
  authorName?: string;
  authorHandle: string;
  text: string;
};

export function formatSocialCount(count: number) {
  if (count >= 1000) {
    const compact = (count / 1000).toFixed(count >= 10_000 ? 0 : 1);
    return `${compact.replace(/\.0$/, '')}k`;
  }
  return String(count);
}

/**
 * Container seed posts intentionally carry no engagement snapshot. Derive a
 * stable, plausible preview from their owner-scoped runtime id so counts do
 * not jump when the feed rerenders.
 */
export function npcSeedPostEngagement(postId: string) {
  if (!npcSeedPostAccountId(postId)) {
    return undefined;
  }
  let hash = 2_166_136_261;
  for (let index = 0; index < postId.length; index += 1) {
    hash ^= postId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return {
    likeCount: 10 + ((hash >>> 0) % 41),
    commentCount: 2 + ((hash >>> 8) % 4),
  };
}
