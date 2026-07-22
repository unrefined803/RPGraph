import type { StorybookCharacter } from '../storybook/runtime';
import type {
  RpDateTimeFormat,
  RpWeekdayLanguage,
  SocialPostRecord,
} from '../types';
import { socialAppNames } from '../chat/socialMedia';
import { formatRpDateTimeParts } from '../workflow';
import { CharacterAvatar } from './CharacterAvatar';
import { formatSocialCount } from './phone-social/dummyPosts';

type SocialPostCardProps = {
  post: SocialPostRecord;
  /** Resolved Gallery image of the post (posts only store the image id). */
  imageDataUrl?: string;
  authorCharacter?: StorybookCharacter;
  authorColor?: string;
  likeCount: number;
  commentCount: number;
  rpDateTime?: string;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  fontSize?: number;
  onOpen: () => void;
  onImageLoaded: () => void;
};

export function SocialPostCard({
  post,
  imageDataUrl,
  authorCharacter,
  authorColor,
  likeCount,
  commentCount,
  rpDateTime,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  fontSize,
  onOpen,
  onImageLoaded,
}: SocialPostCardProps) {
  const timeParts = rpDateTime
    ? formatRpDateTimeParts(rpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
    : undefined;
  const appName = socialAppNames[post.app];
  const authorIdentity = (
    <span className="chat-social-post-author">
      <CharacterAvatar
        className="chat-social-post-avatar"
        name={post.author}
        fallback={post.author.slice(0, 1).toUpperCase()}
        profileImageDataUrl={authorCharacter?.profileImage?.dataUrl}
        style={authorColor ? { borderColor: authorColor, color: authorColor } : undefined}
      />
      <span>
        <strong style={authorColor ? { color: authorColor } : undefined}>{post.author}</strong>
        <small>@{post.authorHandle}</small>
      </span>
    </span>
  );

  return (
    <button
      className={`chat-social-post-card ${post.app}`}
      type="button"
      style={fontSize ? { fontSize } : undefined}
      onClick={onOpen}
      aria-label={`Open ${appName} post by ${post.author} with comments`}
    >
      <span className="chat-social-post-accent" aria-hidden="true" />
      <span className="chat-social-post-header">
        <span className="chat-social-post-app-icon" aria-hidden="true">
          {post.app === 'fotogram' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 13.5c1.2-1.3 1.8-2.7 1.8-3.9A4.1 4.1 0 0 0 12 6.9a4.1 4.1 0 0 0-8.8 2.7c0 1.2.6 2.6 1.8 3.9l7 6.8Z" />
            </svg>
          )}
        </span>
        <span className="chat-social-post-app-heading">
          <strong>{appName}</strong>
          <small>{post.textOnly ? 'Text post' : 'Photo post'}</small>
        </span>
        {timeParts && (
          <time className="chat-social-post-time">
            <span>{timeParts.date}</span>
            <span>{timeParts.time}</span>
          </time>
        )}
      </span>

      {post.textOnly ? (
        <>
          {authorIdentity}
          <span className="chat-social-post-caption">
            <strong>{post.author}</strong>
            <span>{post.caption}</span>
          </span>
        </>
      ) : (
        <span className={`chat-social-post-image${imageDataUrl ? '' : ' placeholder'}`}>
          {imageDataUrl ? (
            <img src={imageDataUrl} alt={post.caption} onLoad={onImageLoaded} />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="8.5" cy="8.5" r="1.4" />
              <path d="m4.5 18 5.5-5.5 3.2 3.2 2.1-2.1 4.2 4.4" />
            </svg>
          )}
          <span className="chat-social-post-image-author">
            {authorIdentity}
          </span>
          <span className="chat-social-post-image-caption">
            {post.caption}
          </span>
        </span>
      )}
      <span className="chat-social-post-footer">
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 14c1.5-1.5 2-3.2 2-4.5A4.5 4.5 0 0 0 12 6.6 4.5 4.5 0 0 0 3 9.5c0 1.3.5 3 2 4.5l7 7Z" />
          </svg>
          {formatSocialCount(likeCount)}
        </span>
        <span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
          {formatSocialCount(commentCount)}
        </span>
        <span className="chat-social-post-open-label">
          Open comments
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M14 7l5 5-5 5" />
          </svg>
        </span>
      </span>
    </button>
  );
}
