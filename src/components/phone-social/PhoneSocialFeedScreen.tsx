import { type FormEvent, useEffect, useState } from 'react';
import type { StorybookCharacter } from '../../storybook/runtime';
import { CharacterAvatar } from '../CharacterAvatar';
import type { SocialAppConfig } from './socialApps';
import {
  dummySocialPosts,
  formatSocialCount,
  type SocialComment,
  type SocialPost,
} from './dummyPosts';

type PhoneSocialFeedScreenProps = {
  app: SocialAppConfig;
  owner?: StorybookCharacter;
  characterColors: Map<string, string>;
  onBack: () => void;
};

/**
 * Shared feed screen used by every social app (Fotogram, OnlyFriends).
 * The app config controls branding and behavior flags; everything else —
 * feed, likes, comments, posting, account creation — is one implementation.
 *
 * Phase 1 (UI only): all state is local to the opened screen. Accounts,
 * posts, and interactions are not persisted yet; Storybook-backed accounts
 * and LLM content arrive in later phases (see SOCIALMEDIA.md).
 */
export function PhoneSocialFeedScreen({
  app,
  owner,
  characterColors,
  onBack,
}: PhoneSocialFeedScreenProps) {
  const [nickname, setNickname] = useState('');
  const [account, setAccount] = useState<string>();
  const [posts, setPosts] = useState<SocialPost[]>(() =>
    dummySocialPosts(app, owner?.id ?? 'no-account'));
  const [likedPostIds, setLikedPostIds] = useState<ReadonlySet<string>>(new Set());
  const [unlockedPostIds, setUnlockedPostIds] = useState<ReadonlySet<string>>(new Set());
  const [commentsByPostId, setCommentsByPostId] = useState<Record<string, SocialComment[]>>({});
  const [openCommentsPostId, setOpenCommentsPostId] = useState<string>();
  const [commentDraft, setCommentDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [postDraft, setPostDraft] = useState('');
  const ownerColor = owner ? characterColors.get(owner.name) : undefined;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onBack();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  function toggleLike(post: SocialPost) {
    const liked = likedPostIds.has(post.id);
    setLikedPostIds((current) => {
      const next = new Set(current);
      if (liked) {
        next.delete(post.id);
      } else {
        next.add(post.id);
      }
      return next;
    });
    setPosts((current) => current.map((entry) =>
      entry.id === post.id
        ? { ...entry, likeCount: entry.likeCount + (liked ? -1 : 1) }
        : entry,
    ));
  }

  function unlockPost(post: SocialPost) {
    setUnlockedPostIds((current) => new Set(current).add(post.id));
  }

  function submitComment(event: FormEvent<HTMLFormElement>, post: SocialPost) {
    event.preventDefault();
    const text = commentDraft.trim();
    if (!text || !account) {
      return;
    }
    const comment: SocialComment = {
      id: `comment-${post.id}-${Date.now()}`,
      authorHandle: account,
      text,
    };
    setCommentsByPostId((current) => ({
      ...current,
      [post.id]: [...(current[post.id] ?? []), comment],
    }));
    setPosts((current) => current.map((entry) =>
      entry.id === post.id ? { ...entry, commentCount: entry.commentCount + 1 } : entry,
    ));
    setCommentDraft('');
  }

  function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const caption = postDraft.trim();
    if (!caption || !account || !owner) {
      return;
    }
    const post: SocialPost = {
      id: `own-${Date.now()}`,
      authorName: owner.name,
      authorHandle: account,
      caption,
      likeCount: 0,
      commentCount: 0,
      locked: false,
      dummy: true,
    };
    setPosts((current) => [post, ...current]);
    setPostDraft('');
    setComposerOpen(false);
  }

  function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = nickname.trim().replace(/\s+/g, ' ');
    if (!name) {
      return;
    }
    setAccount(name);
    setNickname('');
  }

  const header = (
    <header className="phone-gallery-header phone-social-header">
      <button type="button" onClick={onBack} aria-label="Back" title="Back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div>
        <span>{app.name}</span>
        <strong>
          {account
            ? `@${account}`
            : owner
              ? `${owner.name} — no account`
              : 'No account'}
        </strong>
      </div>
      {account && (
        <button
          type="button"
          className="phone-social-new-post-button"
          onClick={() => setComposerOpen((open) => !open)}
          aria-expanded={composerOpen}
        >
          {composerOpen ? 'Cancel' : '+ Post'}
        </button>
      )}
    </header>
  );

  if (!account) {
    return (
      <div className={`phone-social-screen ${app.themeClass}`} aria-label={app.name}>
        {header}
        <div className="phone-social-onboarding">
          <div className="phone-social-onboarding-card">
            <strong>{app.name}</strong>
            <span>{app.tagline}</span>
            {owner ? (
              <form onSubmit={createAccount}>
                <label className="phone-banking-field">
                  <span>Nickname</span>
                  <input
                    type="text"
                    placeholder="Pick a nickname"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    autoFocus
                  />
                </label>
                <button type="submit" disabled={!nickname.trim()}>
                  Create Account
                </button>
              </form>
            ) : (
              <span className="phone-social-empty">
                Select a character to create an account.
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`phone-social-screen ${app.themeClass}`} aria-label={app.name}>
      {header}
      <div className="phone-social-scroll">
        {composerOpen && (
          <form className="phone-social-composer" onSubmit={submitPost}>
            <div className="phone-social-composer-image" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <circle cx="8.5" cy="8.5" r="1.4" />
                <path d="m4.5 18 5.5-5.5 3.2 3.2 2.1-2.1 4.2 4.4" />
              </svg>
              <span>Image is added later</span>
            </div>
            <textarea
              placeholder="Write a caption"
              value={postDraft}
              onChange={(event) => setPostDraft(event.target.value)}
              rows={2}
              autoFocus
            />
            <button type="submit" disabled={!postDraft.trim()}>
              Share Post
            </button>
          </form>
        )}
        {posts.map((post) => {
          const liked = likedPostIds.has(post.id);
          const lockedNow = post.locked && !unlockedPostIds.has(post.id);
          const comments = commentsByPostId[post.id] ?? [];
          const commentsOpen = openCommentsPostId === post.id;
          const ownPost = post.authorHandle === account;
          return (
            <article className="phone-social-post" key={post.id}>
              <div className="phone-social-post-author">
                <CharacterAvatar
                  className="phone-avatar"
                  name={post.authorName}
                  fallback={post.authorName.slice(0, 1).toUpperCase()}
                  profileImageDataUrl={ownPost ? owner?.profileImage?.dataUrl : undefined}
                  style={ownPost && ownerColor
                    ? { borderColor: ownerColor, color: ownerColor }
                    : undefined}
                />
                <div>
                  <strong>{post.authorName}</strong>
                  <span>@{post.authorHandle}</span>
                </div>
                {lockedNow && (
                  <span className="phone-social-locked-chip">Locked</span>
                )}
              </div>
              <div className={`phone-social-post-image${lockedNow ? ' locked' : ''}`}>
                {post.imageDataUrl && !lockedNow ? (
                  <img src={post.imageDataUrl} alt={post.caption} />
                ) : (
                  <div className="phone-social-post-placeholder" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="4" />
                      <circle cx="8.5" cy="8.5" r="1.4" />
                      <path d="m4.5 18 5.5-5.5 3.2 3.2 2.1-2.1 4.2 4.4" />
                    </svg>
                  </div>
                )}
                {lockedNow && (
                  <div className="phone-social-unlock-overlay">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="4" y="10" width="16" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                    <button type="button" onClick={() => unlockPost(post)}>
                      Unlock for {post.unlockPrice ?? '$4.99'}
                    </button>
                  </div>
                )}
              </div>
              <div className="phone-social-post-actions">
                <button
                  type="button"
                  className={`phone-social-like-button${liked ? ' liked' : ''}`}
                  onClick={() => toggleLike(post)}
                  aria-pressed={liked}
                  aria-label={liked ? 'Unlike' : 'Like'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M19 14c1.5-1.5 2-3.2 2-4.5A4.5 4.5 0 0 0 12 6.6 4.5 4.5 0 0 0 3 9.5c0 1.3.5 3 2 4.5l7 7Z" />
                  </svg>
                  <span>{formatSocialCount(post.likeCount)}</span>
                </button>
                <button
                  type="button"
                  className="phone-social-comment-button"
                  onClick={() => {
                    setOpenCommentsPostId(commentsOpen ? undefined : post.id);
                    setCommentDraft('');
                  }}
                  aria-expanded={commentsOpen}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a8 8 0 0 1-8 8H4l1.3-3.2A8 8 0 1 1 21 12Z" />
                  </svg>
                  <span>{formatSocialCount(post.commentCount)}</span>
                </button>
              </div>
              {!lockedNow && <p className="phone-social-post-caption">{post.caption}</p>}
              {commentsOpen && (
                <div className="phone-social-comments">
                  {comments.map((comment) => (
                    <div className="phone-social-comment" key={comment.id}>
                      <strong>@{comment.authorHandle}</strong>
                      <span>{comment.text}</span>
                    </div>
                  ))}
                  {comments.length === 0 && (
                    <span className="phone-social-empty">No comments yet.</span>
                  )}
                  <form
                    className="phone-social-comment-form"
                    onSubmit={(event) => submitComment(event, post)}
                  >
                    <input
                      type="text"
                      placeholder="Add a comment"
                      value={commentDraft}
                      onChange={(event) => setCommentDraft(event.target.value)}
                      autoFocus
                    />
                    <button type="submit" disabled={!commentDraft.trim()}>
                      Send
                    </button>
                  </form>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
