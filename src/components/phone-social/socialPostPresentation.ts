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
