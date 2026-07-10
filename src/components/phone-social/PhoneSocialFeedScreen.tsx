import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { StorybookCharacter } from '../../storybook/runtime';
import type {
  ChatImageAttachment,
  ConnectionPreset,
  MessageRecord,
  ProviderConnectionHealth,
} from '../../types';
import { bankingBalanceForCharacter, formatBankingAmount } from '../../chat/bankTransfers';
import type {
  ImageGenerationAssistantMessage,
  ImageGenerationAssistantResult,
  ImageGenerationSettings,
  ImageAssistantModelState,
} from '../../chat/imageGenerationAssistant';
import { imageGenerationCharacterContext } from '../../chat/imageGenerationAssistant';
import { CharacterAvatar } from '../CharacterAvatar';
import { PhoneGalleryScreen } from '../PhoneGalleryScreen';
import { PhoneImagePicker } from '../PhoneImagePicker';
import { socialHandleForName, type SocialAppConfig } from './socialApps';
import {
  dummySocialPosts,
  formatSocialCount,
  type SocialComment,
  type SocialPost,
} from './dummyPosts';

type SocialAccount = {
  key: string;
  name: string;
  handle: string;
  character?: StorybookCharacter;
};

type PhoneSocialFeedScreenProps = {
  app: SocialAppConfig;
  owner?: StorybookCharacter;
  storyCharacters: StorybookCharacter[];
  characterColors: Map<string, string>;
  phoneGalleryImages: ChatImageAttachment[];
  bankTransferMessages: MessageRecord[];
  isRunning: boolean;
  onSendBankTransfer: (request: {
    from: StorybookCharacter;
    to: string;
    amount: number;
    note: string;
  }) => void;
  onBack: () => void;
  connections?: ConnectionPreset[];
  providerHealthById?: Record<string, ProviderConnectionHealth>;
  estimatedTokenBytesPerToken: number;
  imageAssistantChatHistoryContext: string;
  imageAssistantModelStateById: Record<string, ImageAssistantModelState>;
  onSetImageAssistantLlmModelLoaded: (providerId: string, loaded: boolean) => Promise<void>;
  onUnloadImageAssistantComfyModel: (providerId: string) => Promise<void>;
  onRefreshImageAssistantModelState: (providerId: string) => void;
  onSubmitImageAssistantMessage: (request: {
    connectionId: string;
    imageProviderId: string;
    currentPrompt: string;
    currentSettings: ImageGenerationSettings;
    currentImage?: { dataUrl: string; description: string };
    availableCharacterLoras: string[];
    characterContext: string;
    chatHistoryContext: string;
    messages: ImageGenerationAssistantMessage[];
    userMessage: string;
    describeImage?: boolean;
  }) => Promise<ImageGenerationAssistantResult>;
  onGenerateImageAssistantImages: (request: {
    providerId: string;
    prompt: string;
    settings: ImageGenerationSettings;
  }) => Promise<string[]>;
  onSaveImageAssistantImage: (request: {
    characterId: string;
    dataUrl: string;
    description: string;
  }) => Promise<void>;
};

/**
 * Shared social screen used by every social app (Fotogram, OnlyFriends).
 * The app config controls branding and behavior flags; everything else —
 * accounts panel, feed, likes, comments, posting, account creation — is one
 * implementation. Layout mirrors the WhatsUp screen: accounts on the left
 * (the phone contacts double as followed social accounts), feed on the right.
 *
 * Phase 1 (UI only): all state is local to the opened screen. Accounts,
 * posts, and interactions are not persisted or synchronized between
 * characters yet; the shared post database, Storybook-backed accounts, and
 * LLM content arrive in later phases (see SOCIALMEDIA.md).
 */
export function PhoneSocialFeedScreen({
  app,
  owner,
  storyCharacters,
  characterColors,
  phoneGalleryImages,
  bankTransferMessages,
  isRunning,
  onSendBankTransfer,
  onBack,
  connections = [],
  providerHealthById = {},
  estimatedTokenBytesPerToken,
  imageAssistantChatHistoryContext,
  imageAssistantModelStateById,
  onSetImageAssistantLlmModelLoaded,
  onUnloadImageAssistantComfyModel,
  onRefreshImageAssistantModelState,
  onSubmitImageAssistantMessage,
  onGenerateImageAssistantImages,
  onSaveImageAssistantImage,
}: PhoneSocialFeedScreenProps) {
  const [nickname, setNickname] = useState('');
  const [account, setAccount] = useState<string>();
  const [addedAccounts, setAddedAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountKey, setSelectedAccountKey] = useState<string>();
  const [ownPosts, setOwnPosts] = useState<SocialPost[]>([]);
  const [likedPostIds, setLikedPostIds] = useState<ReadonlySet<string>>(new Set());
  const [likeDeltaByPostId, setLikeDeltaByPostId] = useState<Record<string, number>>({});
  const [unlockedPostIds, setUnlockedPostIds] = useState<ReadonlySet<string>>(new Set());
  // Post currently showing the "pay with bank account" confirmation.
  const [unlockCandidateId, setUnlockCandidateId] = useState<string>();
  const [commentsByPostId, setCommentsByPostId] = useState<Record<string, SocialComment[]>>({});
  const [openCommentsPostId, setOpenCommentsPostId] = useState<string>();
  const [commentDraft, setCommentDraft] = useState('');
  // Posting flow: pick the image source first (menu), then describe (editor).
  const [postStage, setPostStage] = useState<'menu' | 'editor'>();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [postDraft, setPostDraft] = useState('');
  const [postDraftImage, setPostDraftImage] = useState<ChatImageAttachment>();
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const postMenuRef = useRef<HTMLDivElement | null>(null);
  const ownerColor = owner ? characterColors.get(owner.name) : undefined;
  const bankBalance = owner ? bankingBalanceForCharacter(owner, bankTransferMessages) : 0;
  const ownerFirstName = owner?.name.trim().split(/\s+/)[0];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !galleryOpen && !cameraOpen) {
        onBack();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cameraOpen, galleryOpen, onBack]);

  // Close the post source menu when clicking anywhere outside it.
  useEffect(() => {
    if (postStage !== 'menu') {
      return;
    }
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && !postMenuRef.current?.contains(event.target)) {
        setPostStage(undefined);
      }
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [postStage]);

  // Every character with a phone shares the social platform: the phone
  // contacts double as the followed accounts, plus manually added people.
  const characterAccounts: SocialAccount[] = storyCharacters
    .filter((character) => character.id !== owner?.id)
    .map((character) => ({
      key: `character-${character.id}`,
      name: character.name,
      handle: socialHandleForName(character.name),
      character,
    }));
  const followedAccounts = [...characterAccounts, ...addedAccounts];
  const selectedAccount = followedAccounts.find((entry) => entry.key === selectedAccountKey);

  const feedPosts = selectedAccount
    ? dummySocialPosts(app, `${selectedAccount.key}`, 6, {
        name: selectedAccount.name,
        handle: selectedAccount.handle,
      })
    : [...ownPosts, ...dummySocialPosts(app, owner?.id ?? 'no-account')];
  const posts = feedPosts.map((post) => ({
    ...post,
    likeCount: post.likeCount + (likeDeltaByPostId[post.id] ?? 0),
    commentCount: post.commentCount + (commentsByPostId[post.id]?.length ?? 0),
  }));

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
    setLikeDeltaByPostId((current) => ({
      ...current,
      [post.id]: (current[post.id] ?? 0) + (liked ? -1 : 1),
    }));
  }

  // Unlocking is a real purchase: the price is transferred from the owner's
  // bank account to the post's author through the normal banking pipeline, so
  // it shows up in the Banking app and lowers the balance.
  function payUnlock(post: SocialPost) {
    const price = post.unlockPrice ?? 4.99;
    if (!owner || isRunning || price <= 0 || price > bankBalance) {
      return;
    }
    onSendBankTransfer({
      from: owner,
      to: post.authorName,
      amount: price,
      note: `${app.name}: unlocked a post by @${post.authorHandle}`,
    });
    setUnlockedPostIds((current) => new Set(current).add(post.id));
    setUnlockCandidateId(undefined);
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
      dummy: false,
      textOnly: !postDraftImage,
      imageDataUrl: postDraftImage?.dataUrl,
    };
    setOwnPosts((current) => [post, ...current]);
    setPostDraft('');
    setPostDraftImage(undefined);
    setPostStage(undefined);
    setSelectedAccountKey(undefined);
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

  function addPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newPersonName.trim().replace(/\s+/g, ' ');
    if (!name) {
      return;
    }
    const personAccount: SocialAccount = {
      key: `added-${socialHandleForName(name)}`,
      name,
      handle: socialHandleForName(name),
    };
    if (!followedAccounts.some((entry) => entry.key === personAccount.key)) {
      setAddedAccounts((current) => [...current, personAccount]);
    }
    setSelectedAccountKey(personAccount.key);
    setNewPersonName('');
    setAddingPerson(false);
  }

  function addUploadedImage(files: FileList | null) {
    const file = files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPostDraftImage({
          id: `upload-${Date.now()}`,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: reader.result,
        });
        setPostStage('editor');
      }
    };
    reader.readAsDataURL(file);
  }

  if (galleryOpen) {
    return (
      <PhoneGalleryScreen
        title={`${ownerFirstName ?? 'Phone'}'s Gallery`}
        images={phoneGalleryImages}
        action="select"
        onBack={() => setGalleryOpen(false)}
        onSelectImage={(image) => {
          setPostDraftImage(image);
          setGalleryOpen(false);
          setPostStage('editor');
        }}
      />
    );
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
      <div className="phone-social-surface">
        <div className="phone-social-sidebar" aria-label="Followed accounts">
          <div className="phone-social-account-list">
            <button
              type="button"
              className={`phone-social-account${selectedAccountKey === undefined ? ' active' : ''}`}
              onClick={() => setSelectedAccountKey(undefined)}
            >
              <CharacterAvatar
                className="phone-avatar"
                name={owner?.name ?? account}
                fallback={(owner?.name ?? account).slice(0, 1).toUpperCase()}
                profileImageDataUrl={owner?.profileImage?.dataUrl}
                style={ownerColor ? { borderColor: ownerColor, color: ownerColor } : undefined}
              />
              <span className="phone-social-account-main">
                <strong style={ownerColor ? { color: ownerColor } : undefined}>Your Feed</strong>
                <span>@{account}</span>
              </span>
            </button>
            {followedAccounts.map((entry) => {
              const color = entry.character ? characterColors.get(entry.character.name) : undefined;
              return (
                <button
                  type="button"
                  key={entry.key}
                  className={`phone-social-account${selectedAccountKey === entry.key ? ' active' : ''}`}
                  onClick={() => setSelectedAccountKey(entry.key)}
                >
                  <CharacterAvatar
                    className="phone-avatar"
                    name={entry.name}
                    fallback={entry.name.slice(0, 1).toUpperCase()}
                    profileImageDataUrl={entry.character?.profileImage?.dataUrl}
                    style={color ? { borderColor: color, color } : undefined}
                  />
                  <span className="phone-social-account-main">
                    <strong style={color ? { color } : undefined}>{entry.name}</strong>
                    <span>@{entry.handle}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="phone-social-sidebar-actions">
            {addingPerson && (
              <form className="phone-social-add-person" onSubmit={addPerson}>
                <input
                  type="text"
                  placeholder="Person's name"
                  value={newPersonName}
                  onChange={(event) => setNewPersonName(event.target.value)}
                  autoFocus
                />
                <button type="submit" disabled={!newPersonName.trim()}>
                  Add
                </button>
              </form>
            )}
            <button
              type="button"
              className="phone-social-sidebar-button"
              onClick={() => setAddingPerson((open) => !open)}
              aria-expanded={addingPerson}
            >
              {addingPerson ? 'Cancel' : '+ Add Person'}
            </button>
            <div className="phone-social-post-menu-anchor" ref={postMenuRef}>
              {postStage === 'menu' && (
                <div className="phone-image-action-menu phone-social-post-menu" role="menu" aria-label="New post image source">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setCameraOpen(true)}
                  >
                    <span aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 7h3l1.2-2h7.6L17 7h3a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1Z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </span>
                    <span>
                      <strong>Camera</strong>
                      <small>Create an image with the assistant</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setGalleryOpen(true)}
                  >
                    <span aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" />
                        <rect x="14" y="3" width="7" height="7" />
                        <rect x="14" y="14" width="7" height="7" />
                        <rect x="3" y="14" width="7" height="7" />
                      </svg>
                    </span>
                    <span>
                      <strong>Choose from Phone Gallery</strong>
                      <small>Use a saved Storybook image</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => uploadInputRef.current?.click()}
                  >
                    <span aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </span>
                    <span>
                      <strong>Upload from Computer</strong>
                      <small>Choose a local image file</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPostDraftImage(undefined);
                      setPostStage('editor');
                    }}
                  >
                    <span aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 6h16M4 12h16M4 18h10" />
                      </svg>
                    </span>
                    <span>
                      <strong>Text Post</strong>
                      <small>Post without an image</small>
                    </span>
                  </button>
                </div>
              )}
              <button
                type="button"
                className="phone-social-sidebar-button primary"
                onClick={() => {
                  if (postStage) {
                    setPostStage(undefined);
                    setPostDraftImage(undefined);
                  } else {
                    setPostStage('menu');
                    setSelectedAccountKey(undefined);
                  }
                }}
                aria-expanded={postStage !== undefined}
              >
                {postStage ? 'Cancel Post' : '+ New Post'}
              </button>
            </div>
            <input
              ref={uploadInputRef}
              className="phone-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                addUploadedImage(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
        </div>
        <div className="phone-social-scroll">
          {postStage === 'editor' && !selectedAccount && (
            <form className="phone-social-composer" onSubmit={submitPost}>
              {postDraftImage && (
                <div className="phone-social-composer-preview">
                  <img src={postDraftImage.dataUrl} alt={postDraftImage.name} />
                  <button
                    type="button"
                    onClick={() => {
                      setPostDraftImage(undefined);
                      setPostStage('menu');
                    }}
                    aria-label="Remove image"
                    title="Remove image"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
              <textarea
                placeholder={postDraftImage ? 'Describe your image' : 'Write your post'}
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
          {selectedAccount && (
            <div className="phone-social-profile-banner">
              <strong>{selectedAccount.name}</strong>
              <span>@{selectedAccount.handle}</span>
            </div>
          )}
          {posts.map((post) => {
            const liked = likedPostIds.has(post.id);
            const lockedNow = post.locked && !unlockedPostIds.has(post.id);
            const price = post.unlockPrice ?? 4.99;
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
                {post.textOnly && (
                  <p className="phone-social-post-caption">{post.caption}</p>
                )}
                {!post.textOnly && (
                <div
                  className={`phone-social-post-image${lockedNow ? ' locked' : ''}${
                    post.imageDataUrl && !lockedNow ? '' : ' placeholder'
                  }`}
                >
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
                      {unlockCandidateId === post.id ? (
                        <div className="phone-social-unlock-confirm">
                          <strong>Pay with Bank Account</strong>
                          <span>
                            {formatBankingAmount(price)} · Balance {formatBankingAmount(bankBalance)}
                          </span>
                          <div className="phone-social-unlock-confirm-actions">
                            <button
                              type="button"
                              onClick={() => payUnlock(post)}
                              disabled={isRunning || price > bankBalance}
                            >
                              {isRunning ? 'Paying...' : `Pay ${formatBankingAmount(price)}`}
                            </button>
                            <button type="button" onClick={() => setUnlockCandidateId(undefined)}>
                              Cancel
                            </button>
                          </div>
                          {price > bankBalance && (
                            <span className="phone-social-unlock-hint">Not enough balance.</span>
                          )}
                        </div>
                      ) : (
                        <button type="button" onClick={() => setUnlockCandidateId(post.id)}>
                          Unlock for {formatBankingAmount(price)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                )}
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
                {!lockedNow && !post.textOnly && (
                  <p className="phone-social-post-caption">{post.caption}</p>
                )}
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
      {cameraOpen && (
        <PhoneImagePicker
          hideLauncher
          openCameraOnMount
          onCameraClose={() => {
            // Camera images are saved into the Phone Gallery; open it so the
            // new image can be picked for the post right away.
            setCameraOpen(false);
            setGalleryOpen(true);
          }}
          onUploadFromComputer={() => {}}
          connections={connections}
          providerHealthById={providerHealthById}
          availableCharacterLoras={storyCharacters.flatMap((character) => {
            const loraName = character.comfyConfig?.loraName.trim();
            return loraName ? [`${character.name}: ${loraName}`] : [];
          })}
          characterContext={imageGenerationCharacterContext(storyCharacters)}
          characterCount={storyCharacters.length}
          chatHistoryContext={imageAssistantChatHistoryContext}
          estimatedTokenBytesPerToken={estimatedTokenBytesPerToken}
          saveCharacters={storyCharacters}
          preferredSaveCharacterId={owner?.id}
          onSubmitImageAssistantMessage={onSubmitImageAssistantMessage}
          onGenerateImageAssistantImages={onGenerateImageAssistantImages}
          onSaveImageAssistantImage={onSaveImageAssistantImage}
          imageAssistantModelStateById={imageAssistantModelStateById}
          onSetImageAssistantLlmModelLoaded={onSetImageAssistantLlmModelLoaded}
          onUnloadImageAssistantComfyModel={onUnloadImageAssistantComfyModel}
          onRefreshImageAssistantModelState={onRefreshImageAssistantModelState}
        />
      )}
    </div>
  );
}
