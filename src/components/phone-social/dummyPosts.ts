import type { SocialAppConfig } from './socialApps';

export type SocialPost = {
  id: string;
  authorName: string;
  authorHandle: string;
  caption: string;
  likeCount: number;
  commentCount: number;
  /** Price label shown on locked posts; only used when the app requires unlocking. */
  unlockPrice?: string;
  /** Locked posts hide their image and caption until unlocked. */
  locked: boolean;
  /** Dummy posts render a placeholder instead of a real image. */
  dummy: boolean;
  /** Text-only posts have no image area at all; the caption moves on top. */
  textOnly?: boolean;
  imageDataUrl?: string;
};

export type SocialComment = {
  id: string;
  authorHandle: string;
  text: string;
};

const dummyAuthors = [
  { name: 'Luna Sky', handle: 'luna.sky' },
  { name: 'Max Power', handle: 'maxpower_official' },
  { name: 'Ari Blume', handle: 'ariblume' },
  { name: 'Nova Reyes', handle: 'nova.reyes' },
  { name: 'Kit Harlow', handle: 'kitharlow' },
  { name: 'Sasha Vale', handle: 'sashavale' },
];

const dummyCaptions = [
  'Golden hour hits different ✨',
  'New week, new me.',
  'You would not believe the view up here.',
  'Coffee first, questions later ☕',
  'Little throwback to last summer.',
  'Behind the scenes of today 📸',
];

const dummyUnlockPrices = ['$4.99', '$9.99', '$14.99', '$7.49'];

// Simple deterministic hash so the same seed always produces the same feed.
function seedNumber(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/**
 * Deterministic dummy feed for one account. The posts look like a feed that
 * has not finished loading: placeholder images, generic captions, plausible
 * like counts. Later phases replace parts of this with LLM-generated content.
 */
export function dummySocialPosts(
  app: SocialAppConfig,
  seed: string,
  count = 8,
  author?: { name: string; handle: string },
): SocialPost[] {
  const base = seedNumber(`${app.id}:${seed}`);
  return Array.from({ length: count }, (_, index) => {
    const value = seedNumber(`${base}:${index}`);
    const postAuthor = author ?? dummyAuthors[value % dummyAuthors.length];
    const locked = app.postsRequireUnlock && index % 3 !== 2;
    return {
      id: `dummy-${app.id}-${seed}-${index}`,
      authorName: postAuthor.name,
      authorHandle: postAuthor.handle,
      caption: dummyCaptions[value % dummyCaptions.length],
      likeCount: (value % 900) + 12,
      commentCount: value % 48,
      unlockPrice: locked ? dummyUnlockPrices[value % dummyUnlockPrices.length] : undefined,
      locked,
      dummy: true,
    };
  });
}

export function formatSocialCount(count: number) {
  if (count >= 1000) {
    const compact = (count / 1000).toFixed(count >= 10_000 ? 0 : 1);
    return `${compact.replace(/\.0$/, '')}k`;
  }
  return String(count);
}
