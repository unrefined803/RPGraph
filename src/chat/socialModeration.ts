import type { SocialPostModeration } from '../types';

export const socialModerationReasons = {
  nudity: 'Nudity or sexual content',
  graphic_violence: 'Graphic violence',
  hate_harassment: 'Hate or harassment',
  spam_scam: 'Spam or scams',
} satisfies Record<NonNullable<SocialPostModeration['reason']>, string>;

export function isSocialPostModeration(value: unknown): value is SocialPostModeration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.blocked === 'boolean' &&
    (record.reason === undefined ? !record.blocked :
      typeof record.reason === 'string' && Object.prototype.hasOwnProperty.call(socialModerationReasons, record.reason));
}
