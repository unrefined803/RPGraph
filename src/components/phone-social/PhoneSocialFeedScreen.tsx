import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { StorybookCharacter } from '../../storybook/runtime';
import type {
  ChatImageAttachment,
  ConnectionPreset,
  MessageRecord,
  ProviderConnectionHealth,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  SocialDirectMessageOpenRequest,
} from '../../types';
import { formatRpDateTimeParts } from '../../workflow';
import { bankingBalanceForCharacter, formatBankingAmount } from '../../chat/bankTransfers';
import {
  onlyFriendsWalletBalance,
  type OnlyFriendsPurchasesByCharacter,
} from '../../chat/onlyFriendsWallet';
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
import {
  nextSocialPostId,
  socialCharacterForPost,
  socialHandleForCharacter,
  socialHandleForName,
  socialIdentityMatches,
  socialLikeAccountKey,
  socialPostMessages,
  socialPostVisibleToViewer,
  socialReactionsByPostId,
} from '../../chat/socialMedia';
import {
  searchSocialDirectory,
  socialConnectionIds,
  type SocialConnectionsByCharacter,
  type SocialDirectoryUser,
} from '../../chat/socialDirectory';
import type {
  SocialPostRecord,
  SocialDirectMessageRecord,
  SocialReactionComment,
  SocialThreadActionRecord,
} from '../../types';
import type { SocialAppConfig } from './socialApps';
import {
  PhoneSocialDirectMessages,
  type SocialDirectMessageParticipant,
} from './PhoneSocialDirectMessages';
import {
  dummySocialPosts,
  formatSocialCount,
  type SocialComment,
  type SocialPost,
} from './dummyPosts';

type SocialAccount = {
  key: string;
  socialUserId?: string;
  name: string;
  handle: string;
  character?: StorybookCharacter;
};

type SocialNotice = {
  kind: 'success' | 'error';
  text: string;
};

type PendingCommentReveal = {
  actionId: string;
  postId: string;
  baselineCount: number;
  baselineVisibleCount: number;
  baselinePersistedCount: number;
};

const POST_APPEAR_DELAY_MIN_MS = 2_000;
const POST_APPEAR_DELAY_MAX_MS = 3_000;
const COMMENT_APPEAR_DELAY_MIN_MS = 3_000;
const COMMENT_APPEAR_DELAY_MAX_MS = 6_000;
const LIKE_RAMP_DURATION_MIN_MS = 45_000;
const LIKE_RAMP_DURATION_MAX_MS = 60_000;

function randomDelay(minimum: number, maximum: number) {
  return Math.round(minimum + Math.random() * (maximum - minimum));
}

type PhoneSocialFeedScreenProps = {
  app: SocialAppConfig;
  owner?: StorybookCharacter;
  storyCharacters: StorybookCharacter[];
  characterColors: Map<string, string>;
  phoneGalleryImages: ChatImageAttachment[];
  bankTransferMessages: MessageRecord[];
  socialMediaMessages: MessageRecord[];
  phoneEmojiOptions: string[];
  recentlyUsedEmojis: string[];
  rpTimeTrackingEnabled: boolean;
  onSendDirectMessage: (message: SocialDirectMessageRecord) => Promise<boolean>;
  /** Resolves a Storybook/Gallery image id to the stored image. */
  socialImageById: (imageId: string) => ChatImageAttachment | undefined;
  /** Liked post ids per "characterId/app" account (persisted in the RP save). */
  socialLikesByAccount: Record<string, string[]>;
  socialDirectoryUsers: SocialDirectoryUser[];
  fotogramContactsByCharacter: Record<string, string[]>;
  socialConnectionsByCharacter: SocialConnectionsByCharacter;
  onAddSocialConnection: (
    characterId: string,
    app: 'fotogram' | 'onlyfriends',
    socialUserId: string,
  ) => void;
  onlyFriendsPurchasesByCharacter: OnlyFriendsPurchasesByCharacter;
  onToggleLike: (postId: string) => void;
  /** Saves an uploaded file into the owner's Gallery and returns the stored image. */
  onImportPostImage: (request: {
    owner: StorybookCharacter;
    image: ChatImageAttachment;
  }) => Promise<ChatImageAttachment | undefined>;
  openPostRequest?: {
    requestId: number;
    postId: string;
  };
  openDirectMessageRequest?: SocialDirectMessageOpenRequest;
  isRunning: boolean;
  onTransferOnlyFriendsWallet: (request: {
    owner: StorybookCharacter;
    direction: 'top-up' | 'withdraw';
    amount: number;
  }) => void;
  onUnlockOnlyFriendsPost: (characterId: string, postId: string, price: number) => void;
  onSubmitSocialPost: (request: {
    author: StorybookCharacter;
    post: SocialPostRecord;
    image?: ChatImageAttachment;
  }) => Promise<boolean>;
  onSubmitSocialThreadAction: (request: {
    actor: StorybookCharacter;
    action: SocialThreadActionRecord;
    existingComments: SocialReactionComment[];
    likeCount: number;
  }) => Promise<boolean>;
  onCreateSocialAccount: (
    character: StorybookCharacter,
    app: 'fotogram' | 'onlyfriends',
    username: string,
  ) => void;
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
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
};

/**
 * Shared social screen used by every social app (Fotogram, OnlyFriends).
 * The app config controls branding and behavior flags; everything else —
 * accounts panel, feed, likes, comments, posting, account creation — is one
 * implementation. Layout mirrors the WhatsUp screen: accounts on the left
 * (the phone contacts double as followed social accounts), feed on the right.
 *
 * Published posts, user thread actions, and generated reactions are persisted
 * on chat messages. Player likes and OnlyFriends purchases live in the RP save
 * per character. Added accounts and discovered NPC identities are persisted in
 * the RP save and can also be carried through Storybook Opening History.
 */
export function PhoneSocialFeedScreen({
  app,
  owner,
  storyCharacters,
  characterColors,
  phoneGalleryImages,
  bankTransferMessages,
  socialMediaMessages,
  phoneEmojiOptions,
  recentlyUsedEmojis,
  rpTimeTrackingEnabled,
  onSendDirectMessage,
  socialImageById,
  socialLikesByAccount,
  socialDirectoryUsers,
  fotogramContactsByCharacter,
  socialConnectionsByCharacter,
  onAddSocialConnection,
  onlyFriendsPurchasesByCharacter,
  onToggleLike,
  onImportPostImage,
  openPostRequest,
  openDirectMessageRequest,
  isRunning,
  onTransferOnlyFriendsWallet,
  onUnlockOnlyFriendsPost,
  onSubmitSocialPost,
  onSubmitSocialThreadAction,
  onCreateSocialAccount,
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
  rpDateTimeFormat,
  rpWeekdayLanguage,
}: PhoneSocialFeedScreenProps) {
  const [nickname, setNickname] = useState('');
  // A username stored in the Storybook means the character already has an
  // account in this app; the onboarding step is skipped then.
  const storedUsername =
    app.id === 'fotogram' ? owner?.social.fotogramUsername : owner?.social.onlyfriendsUsername;
  const [account, setAccount] = useState<string | undefined>(storedUsername || undefined);
  const [directMessagesOpen, setDirectMessagesOpen] = useState(!!openDirectMessageRequest);
  const [directMessageParticipant, setDirectMessageParticipant] = useState<SocialDirectMessageParticipant | undefined>(
    openDirectMessageRequest
      ? {
          key: `open-${openDirectMessageRequest.app}-${openDirectMessageRequest.participantHandle}`,
          name: openDirectMessageRequest.participantName,
          handle: openDirectMessageRequest.participantHandle,
        }
      : undefined,
  );
  const [seenOpenDirectMessageRequestId, setSeenOpenDirectMessageRequestId] = useState(
    openDirectMessageRequest?.requestId ?? 0,
  );
  // Post currently showing the OnlyFriends balance confirmation.
  const [unlockCandidateId, setUnlockCandidateId] = useState<string>();
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletAmountText, setWalletAmountText] = useState('10');
  const [openCommentsPostId, setOpenCommentsPostId] = useState<string | undefined>(
    openPostRequest?.postId,
  );
  const [seenOpenPostRequestId, setSeenOpenPostRequestId] = useState(
    openPostRequest?.requestId ?? 0,
  );
  const [commentDraft, setCommentDraft] = useState('');
  // Posting flow: pick the image source first (menu), then describe (editor).
  const [postStage, setPostStage] = useState<'menu' | 'editor'>();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [postDraft, setPostDraft] = useState('');
  const [postDraftImage, setPostDraftImage] = useState<ChatImageAttachment>();
  const [notice, setNotice] = useState<SocialNotice>();
  const [optimisticPosts, setOptimisticPosts] = useState<SocialPost[]>([]);
  const [delayedPostIds, setDelayedPostIds] = useState<Set<string>>(() => new Set());
  const [freshPostIds, setFreshPostIds] = useState<Set<string>>(() => new Set());
  const [visibleLikeCounts, setVisibleLikeCounts] = useState<Record<string, number>>({});
  const [visibleCommentCounts, setVisibleCommentCounts] = useState<Record<string, number>>({});
  const [pendingCommentReveal, setPendingCommentReveal] = useState<PendingCommentReveal>();
  const [addingPerson, setAddingPerson] = useState(false);
  const [revealedDirectMessageIds, setRevealedDirectMessageIds] = useState<Set<string>>(() => new Set());
  const [newPersonName, setNewPersonName] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const postMenuRef = useRef<HTMLDivElement | null>(null);
  const postElementsRef = useRef(new Map<string, HTMLElement>());
  const scrolledOpenPostRequestIdRef = useRef<number | undefined>(undefined);
  const nextThreadActionSequenceRef = useRef(socialMediaMessages.length);
  const dmScheduledRevealIdsRef = useRef<Set<string>>(new Set());
  const dmRevealTimersRef = useRef<number[]>([]);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const postAppearTimersRef = useRef(new Map<string, number>());
  const reactionFallbackTimersRef = useRef(new Map<string, number>());
  const commentRevealTimersRef = useRef(new Map<string, number[]>());
  const likeRampTimersRef = useRef(new Map<string, number>());
  const scheduledInitialCommentsRef = useRef(new Set<string>());
  const scheduledThreadActionsRef = useRef(new Set<string>());
  const persistedReactionsRef = useRef<ReturnType<typeof socialReactionsByPostId>>({});
  const persistedCommentsRef = useRef<Record<string, SocialComment[]>>({});
  const characterLikeCountsRef = useRef<Record<string, number>>({});
  const ownerColor = owner ? characterColors.get(owner.name) : undefined;
  const bankBalance = owner ? bankingBalanceForCharacter(owner, bankTransferMessages) : 0;
  const onlyFriendsPurchases = owner
    ? onlyFriendsPurchasesByCharacter[owner.id] ?? {}
    : {};
  const unlockedPostIds = new Set(Object.keys(onlyFriendsPurchases));
  const walletBalance = owner
    ? onlyFriendsWalletBalance(
        owner,
        [...bankTransferMessages, ...socialMediaMessages],
        onlyFriendsPurchases,
      )
    : 0;
  const walletAmount = Math.round(Number(walletAmountText) * 100) / 100;
  const walletAmountValid = Number.isFinite(walletAmount) && walletAmount > 0;
  const ownerFirstName = owner?.name.trim().split(/\s+/)[0];
  const savedSocialUserIds = socialConnectionIds(
    socialConnectionsByCharacter,
    owner?.id,
    app.id,
  );
  const defaultFotogramUserIds = app.id === 'fotogram' && owner
    ? (fotogramContactsByCharacter[owner.id] ?? []).flatMap((characterId) => {
        const user = socialDirectoryUsers.find((entry) =>
          entry.characterId === characterId && !!entry.handles.fotogram
        );
        return user ? [user.id] : [];
      })
    : [];
  const connectedSocialUserIds = [...new Set([
    ...defaultFotogramUserIds,
    ...savedSocialUserIds,
  ])];
  const connectedSocialUsers = connectedSocialUserIds.flatMap((socialUserId) => {
    const user = socialDirectoryUsers.find((entry) => entry.id === socialUserId);
    return user?.handles[app.id] ? [user] : [];
  });
  const directorySearchResults = searchSocialDirectory(
    socialDirectoryUsers,
    app.id,
    newPersonName,
    owner?.id,
  );

  function showNotice(nextNotice: SocialNotice, duration = 1_800) {
    if (noticeTimerRef.current !== undefined) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setNotice(nextNotice);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(undefined);
      noticeTimerRef.current = undefined;
    }, duration);
  }

  useEffect(() => () => {
    if (noticeTimerRef.current !== undefined) {
      window.clearTimeout(noticeTimerRef.current);
    }
    postAppearTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    reactionFallbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    commentRevealTimersRef.current.forEach((timers) => {
      timers.forEach((timer) => window.clearTimeout(timer));
    });
    likeRampTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

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

  // Fotogram inherits the Storybook's Phone + Fotogram contacts. OnlyFriends
  // stays private until accounts are added explicitly. Real DM partners are
  // surfaced separately below in both apps.
  const connectedAccounts: SocialAccount[] = connectedSocialUsers.map((user) => ({
    key: `connected-${user.id}`,
    socialUserId: user.id,
    name: user.name,
    handle: user.handles[app.id]!,
    character: user.characterId
      ? storyCharacters.find((character) => character.id === user.characterId)
      : undefined,
  }));
  // DM conversations of the viewing account: recency per partner handle (in
  // message order) plus quick-access sidebar entries for partners who are not
  // story characters, e.g. virtual users or comment authors that were messaged.
  const persistedDirectMessages = socialMediaMessages.flatMap((message) =>
    message.socialDirectMessage ? [message.socialDirectMessage] : [],
  );
  const directMessageRpDateTimeById = new Map(
    socialMediaMessages.flatMap((message) =>
      message.socialDirectMessage && message.rpDateTime
        ? [[message.socialDirectMessage.messageId, message.rpDateTime] as const]
        : [],
    ),
  );
  // New incoming DMs are revealed one after another with short delays so a
  // fresh post feels alive instead of everything appearing in one blink.
  const incomingDirectMessageIds = persistedDirectMessages
    .filter((directMessage) =>
      directMessage.app === app.id &&
      !!account &&
      socialIdentityMatches(directMessage.toHandle, account) &&
      !socialIdentityMatches(directMessage.fromHandle, account),
    )
    .map((directMessage) => directMessage.messageId);
  // Keep the ids that already existed when this account opened as a stable
  // baseline. Later ids can then be hidden synchronously on their first paint.
  const knownDirectMessageIds = useMemo(
    () => new Set(incomingDirectMessageIds),
    // A changed id list is precisely what must not rebuild the baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account],
  );
  useEffect(() => {
    dmScheduledRevealIdsRef.current = new Set();
  }, [account]);
  const hiddenDirectMessageIds = new Set(
    incomingDirectMessageIds.filter(
      (messageId) =>
        !knownDirectMessageIds.has(messageId) && !revealedDirectMessageIds.has(messageId),
    ),
  );
  useEffect(() => {
    const freshIds = incomingDirectMessageIds.filter(
      (messageId) =>
        !knownDirectMessageIds.has(messageId) &&
        !revealedDirectMessageIds.has(messageId) &&
        !dmScheduledRevealIdsRef.current.has(messageId),
    );
    freshIds.forEach((messageId, index) => {
      dmScheduledRevealIdsRef.current.add(messageId);
      dmRevealTimersRef.current.push(window.setTimeout(() => {
        setRevealedDirectMessageIds((current) => new Set(current).add(messageId));
      }, 1_500 + index * 2_200 + Math.round(Math.random() * 900)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingDirectMessageIds.join('|'), account, knownDirectMessageIds]);
  useEffect(() => () => {
    dmRevealTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const visibleDirectMessages = persistedDirectMessages.filter(
    (directMessage) => !hiddenDirectMessageIds.has(directMessage.messageId),
  );
  const handleKey = (handle: string) => handle.trim().replace(/^@/, '').toLowerCase();
  const dmRecencyByHandle = new Map<string, number>();
  const dmPartnerNamesByHandle = new Map<string, string>();
  visibleDirectMessages.forEach((directMessage, index) => {
    if (directMessage.app !== app.id || !account) {
      return;
    }
    const partner = socialIdentityMatches(directMessage.fromHandle, account)
      ? { name: directMessage.to, handle: directMessage.toHandle }
      : socialIdentityMatches(directMessage.toHandle, account)
        ? { name: directMessage.from, handle: directMessage.fromHandle }
        : undefined;
    if (partner) {
      dmRecencyByHandle.set(handleKey(partner.handle), index);
      dmPartnerNamesByHandle.set(handleKey(partner.handle), partner.name);
    }
  });
  const dmRecency = (handle: string) => dmRecencyByHandle.get(handleKey(handle)) ?? -1;
  const dmPartnerAccounts: SocialAccount[] = [...dmPartnerNamesByHandle.entries()]
    .filter(([partnerHandleKey]) =>
      !connectedAccounts.some((entry) => handleKey(entry.handle) === partnerHandleKey),
    )
    .map(([partnerHandleKey, name]) => {
      const directoryUser = socialDirectoryUsers.find((user) =>
        socialIdentityMatches(user.handles[app.id] ?? '', partnerHandleKey)
      ) ?? socialDirectoryUsers.find((user) => socialIdentityMatches(user.name, name));
      const character = storyCharacters.find((entry) =>
        socialIdentityMatches(socialHandleForCharacter(entry, app.id), partnerHandleKey)
      ) ?? storyCharacters.find((entry) => socialIdentityMatches(entry.name, name));
      return {
        key: `dm-partner-${app.id}-${partnerHandleKey}`,
        socialUserId: directoryUser?.id,
        name,
        handle: partnerHandleKey,
        character,
      };
    });
  // Added people and real DM partners are ordered by conversation recency.
  const extraAccounts = [...connectedAccounts, ...dmPartnerAccounts]
    .sort((left, right) => dmRecency(right.handle) - dmRecency(left.handle));
  const followedAccounts = extraAccounts;
  const knownSocialUserIds = new Set([
    ...connectedSocialUserIds,
    ...(app.id === 'fotogram'
      ? dmPartnerAccounts.flatMap((account) => account.socialUserId ? [account.socialUserId] : [])
      : []),
  ]);

  // Posts published through the workflow live on chat messages (and therefore
  // in the RP save); the AI reactions to them are matched by post id.
  const persistedReactions = useMemo(
    () => socialReactionsByPostId(app.id, socialMediaMessages),
    [app.id, socialMediaMessages],
  );
  // Rebuild the visible thread in message order. A user comment and the LLM
  // replies share one message record, so the user comment is inserted first
  // and the generated replies follow it instead of pushing it to the bottom.
  const persistedCommentsByPostId = useMemo(() => {
    const commentsByPostId: Record<string, SocialComment[]> = {};
    socialMediaMessages.forEach((message) => {
      const action = message.socialThreadAction;
      const reactions = message.socialReactions?.app === app.id
        ? message.socialReactions
        : undefined;
      const actorEchoIndex = action?.app === app.id && action.action === 'comment'
        ? reactions?.comments.findIndex((comment) =>
            socialIdentityMatches(comment.from, action.actor) ||
            socialIdentityMatches(comment.handle, action.actorHandle)) ?? -1
        : -1;
      if (action?.app === app.id && action.action === 'comment' && action.commentText) {
        const translatedActorEcho = actorEchoIndex >= 0
          ? reactions?.comments[actorEchoIndex]?.text
          : undefined;
        commentsByPostId[action.postId] = [
          ...(commentsByPostId[action.postId] ?? []),
          {
            id: action.actionId,
            authorName: action.actor,
            authorHandle: action.actorHandle,
            // Older malformed runs sometimes echoed the translated actor comment
            // as an LLM reaction. Prefer that translation and hide the duplicate.
            text: translatedActorEcho ?? action.commentText,
          },
        ];
      }
      if (reactions) {
        commentsByPostId[reactions.postId] = [
          ...(commentsByPostId[reactions.postId] ?? []),
          ...reactions.comments.flatMap((comment, index) =>
            index === actorEchoIndex
              ? []
              : [{
                  id: `reaction-${message.id}-${index}`,
                  authorName: comment.from,
                  authorHandle: comment.handle,
                  text: comment.text,
                }],
          ),
        ];
      }
    });
    return commentsByPostId;
  }, [app.id, socialMediaMessages]);
  const discoveredIdentities = [
    ...connectedAccounts,
    ...(app.id === 'fotogram' ? dmPartnerAccounts : []),
  ]
    .flatMap((entry) => [entry.name, entry.handle]);
  const persistedPosts: SocialPost[] = socialPostMessages(app.id, socialMediaMessages)
    .reverse()
    .filter((message) => socialPostVisibleToViewer(
      message.socialPost,
      owner?.name ?? '',
      account ?? '',
      discoveredIdentities,
    ))
    .map((message) => ({
      id: message.socialPost.postId,
      authorName: message.socialPost.author,
      authorHandle: message.socialPost.authorHandle,
      caption: message.socialPost.caption,
      likeCount: 0,
      commentCount: 0,
      locked: false,
      dummy: false,
      textOnly: message.socialPost.textOnly,
      // Posts store only the Gallery image id; the pixels live in the
      // Storybook image library and are resolved here for display.
      imageDataUrl: message.socialPost.imageId
        ? socialImageById(message.socialPost.imageId)?.dataUrl
        : undefined,
      imageId: message.socialPost.imageId,
      imageDescription: message.socialPost.imageDescription,
      rpDateTime: message.rpDateTime,
    }));
  const persistedPostIds = new Set(persistedPosts.map((post) => post.id));
  const availablePosts = [
    ...optimisticPosts.filter((post) => !persistedPostIds.has(post.id)),
    ...persistedPosts,
  ].filter((post) => !delayedPostIds.has(post.id));
  // Cosmetic starter posts form the app's general home page. They are visible
  // without adding their authors and do not imply a saved social connection.
  const starterPosts = dummySocialPosts(
    app,
    owner?.id ?? 'no-account',
    storyCharacters.map((character) => character.id),
  );
  const feedPosts = [
    ...availablePosts,
    ...starterPosts,
  ];
  // The heart state belongs to the owner; the visible count adds one like
  // per player character that liked the post (persisted in the RP save).
  const likedPostIds = new Set(
    owner ? socialLikesByAccount[socialLikeAccountKey(owner.id, app.id)] ?? [] : [],
  );
  const characterLikeCountByPostId = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.entries(socialLikesByAccount).forEach(([accountKey, postIds]) => {
      if (!accountKey.endsWith(`/${app.id}`)) {
        return;
      }
      postIds.forEach((postId) => {
        counts[postId] = (counts[postId] ?? 0) + 1;
      });
    });
    return counts;
  }, [app.id, socialLikesByAccount]);
  useEffect(() => {
    persistedReactionsRef.current = persistedReactions;
    persistedCommentsRef.current = persistedCommentsByPostId;
    characterLikeCountsRef.current = characterLikeCountByPostId;
  }, [characterLikeCountByPostId, persistedCommentsByPostId, persistedReactions]);
  const posts = feedPosts.map((post) => {
    const fullLikeCount =
      post.likeCount +
      (persistedReactions[post.id]?.likes ?? 0) +
      (characterLikeCountByPostId[post.id] ?? 0);
    const fullCommentCount =
      post.commentCount +
      (persistedCommentsByPostId[post.id]?.length ?? 0);
    return {
      ...post,
      likeCount: freshPostIds.has(post.id)
        ? Math.min(visibleLikeCounts[post.id] ?? 0, fullLikeCount)
        : fullLikeCount,
      commentCount: visibleCommentCounts[post.id] === undefined
        ? fullCommentCount
        : Math.min(visibleCommentCounts[post.id], fullCommentCount),
    };
  });

  // A newly published post receives its stored reaction total gradually. The
  // stored message remains the source of truth; only the displayed count is
  // paced for a more natural feed experience.
  useEffect(() => {
    freshPostIds.forEach((postId) => {
      const reactions = persistedReactionsRef.current[postId];
      if (!reactions || likeRampTimersRef.current.has(postId)) {
        return;
      }
      const target =
        reactions.likes +
        (characterLikeCountsRef.current[postId] ?? 0);
      if (target <= 0) {
        setFreshPostIds((current) => {
          const next = new Set(current);
          next.delete(postId);
          return next;
        });
        return;
      }
      const startedAt = Date.now();
      const duration = randomDelay(LIKE_RAMP_DURATION_MIN_MS, LIKE_RAMP_DURATION_MAX_MS);
      const expectedPulses = Math.max(1, Math.ceil(target / 2.5));
      const pulseInterval = duration / expectedPulses;
      const nextPulseDelay = () => randomDelay(
        Math.max(500, pulseInterval * 0.7),
        Math.max(900, pulseInterval * 1.3),
      );
      const tick = () => {
        setVisibleLikeCounts((current) => {
          const currentCount = current[postId] ?? 0;
          const elapsedShare = Math.min(1, (Date.now() - startedAt) / duration);
          const pacedCeiling = Math.max(1, Math.ceil(target * elapsedShare));
          const nextCount = Math.min(target, Math.max(currentCount + randomDelay(1, 4), pacedCeiling));
          if (nextCount >= target) {
            likeRampTimersRef.current.delete(postId);
            setFreshPostIds((freshIds) => {
              const next = new Set(freshIds);
              next.delete(postId);
              return next;
            });
          } else {
            const timer = window.setTimeout(tick, nextPulseDelay());
            likeRampTimersRef.current.set(postId, timer);
          }
          return { ...current, [postId]: nextCount };
        });
      };
      const timer = window.setTimeout(tick, nextPulseDelay());
      likeRampTimersRef.current.set(postId, timer);
    });
  }, [freshPostIds, socialMediaMessages, socialLikesByAccount]);

  // Initial reactions arrive together from the workflow, but comments are
  // revealed one by one after the post card itself has appeared.
  useEffect(() => {
    freshPostIds.forEach((postId) => {
      if (!persistedReactionsRef.current[postId] || scheduledInitialCommentsRef.current.has(postId)) {
        return;
      }
      scheduledInitialCommentsRef.current.add(postId);
      const total = persistedCommentsRef.current[postId]?.length ?? 0;
      setVisibleCommentCounts((current) => ({
        ...current,
        [postId]: Math.max(current[postId] ?? 0, Math.min(1, total)),
      }));
      let elapsed = 0;
      const timers: number[] = [];
      for (let visibleCount = 2; visibleCount <= total; visibleCount += 1) {
        elapsed += randomDelay(COMMENT_APPEAR_DELAY_MIN_MS, COMMENT_APPEAR_DELAY_MAX_MS);
        timers.push(window.setTimeout(() => {
          setVisibleCommentCounts((current) => ({
            ...current,
            [postId]: Math.max(current[postId] ?? 0, visibleCount),
          }));
        }, elapsed));
      }
      commentRevealTimersRef.current.set(postId, timers);
    });
  }, [freshPostIds, socialMediaMessages]);

  // For a comment action, show the actor's comment first and then reveal every
  // generated reply at a random three-to-six-second interval.
  useEffect(() => {
    if (
      !pendingCommentReveal ||
      scheduledThreadActionsRef.current.has(pendingCommentReveal.actionId)
    ) {
      return;
    }
    const completed = socialMediaMessages.some(
      (message) => message.socialThreadAction?.actionId === pendingCommentReveal.actionId,
    );
    if (!completed) {
      return;
    }
    scheduledThreadActionsRef.current.add(pendingCommentReveal.actionId);
    const {
      postId,
      baselineCount,
      baselineVisibleCount,
      baselinePersistedCount,
    } = pendingCommentReveal;
    const currentPersistedCount = persistedCommentsRef.current[postId]?.length ?? 0;
    const total = baselineCount + Math.max(0, currentPersistedCount - baselinePersistedCount);
    const firstVisibleCount = Math.min(total, baselineVisibleCount + 1);
    queueMicrotask(() => {
      setVisibleCommentCounts((current) => ({
        ...current,
        [postId]: Math.max(current[postId] ?? 0, firstVisibleCount),
      }));
      let elapsed = 0;
      const timers: number[] = [];
      for (let visibleCount = firstVisibleCount + 1; visibleCount <= total; visibleCount += 1) {
        elapsed += randomDelay(COMMENT_APPEAR_DELAY_MIN_MS, COMMENT_APPEAR_DELAY_MAX_MS);
        timers.push(window.setTimeout(() => {
          setVisibleCommentCounts((current) => ({
            ...current,
            [postId]: Math.max(current[postId] ?? 0, visibleCount),
          }));
        }, elapsed));
      }
      commentRevealTimersRef.current.set(postId, timers);
      setPendingCommentReveal(undefined);
    });
  }, [pendingCommentReveal, socialMediaMessages]);

  if (openPostRequest && seenOpenPostRequestId !== openPostRequest.requestId) {
    setSeenOpenPostRequestId(openPostRequest.requestId);
    setDirectMessageParticipant(undefined);
    setDirectMessagesOpen(false);
    setOpenCommentsPostId(openPostRequest.postId);
    setCommentDraft('');
  }
  if (
    openDirectMessageRequest &&
    seenOpenDirectMessageRequestId !== openDirectMessageRequest.requestId
  ) {
    setSeenOpenDirectMessageRequestId(openDirectMessageRequest.requestId);
    setPostStage(undefined);
    setDirectMessageParticipant({
      key: `open-${openDirectMessageRequest.app}-${openDirectMessageRequest.participantHandle}`,
      name: openDirectMessageRequest.participantName,
      handle: openDirectMessageRequest.participantHandle,
    });
    setDirectMessagesOpen(true);
    setOpenCommentsPostId(undefined);
  }

  const openPostRequestId = openPostRequest?.requestId;
  const openPostId = openPostRequest?.postId;
  useEffect(() => {
    if (openPostRequestId === undefined || !openPostId) {
      return;
    }
    // Scroll once per request; later view changes must not jump back to the
    // previously requested post.
    if (scrolledOpenPostRequestIdRef.current === openPostRequestId) {
      return;
    }
    scrolledOpenPostRequestIdRef.current = openPostRequestId;
    const frame = window.requestAnimationFrame(() => {
      postElementsRef.current.get(openPostId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openPostId, openPostRequestId]);

  function toggleLike(post: SocialPost) {
    if (!owner) {
      return;
    }
    onToggleLike(post.id);
  }

  function payUnlock(post: SocialPost) {
    const price = post.unlockPrice ?? 4.99;
    if (!owner || isRunning || price <= 0 || price > walletBalance || unlockedPostIds.has(post.id)) {
      return;
    }
    onUnlockOnlyFriendsPost(owner.id, post.id, price);
    setUnlockCandidateId(undefined);
  }

  function changeWalletAmount(delta: number) {
    const current = Number(walletAmountText) || 0;
    setWalletAmountText(String(Math.max(0, Math.round((current + delta) * 100) / 100)));
  }

  function transferWallet(direction: 'top-up' | 'withdraw') {
    const available = direction === 'top-up' ? bankBalance : walletBalance;
    if (!owner || isRunning || !walletAmountValid || walletAmount > available) {
      return;
    }
    onTransferOnlyFriendsWallet({ owner, direction, amount: walletAmount });
    setWalletOpen(false);
  }

  async function submitComment(event: FormEvent<HTMLFormElement>, post: SocialPost) {
    event.preventDefault();
    const text = commentDraft.trim();
    if (!text || !account || !owner || isRunning) {
      return;
    }
    const actionId = nextThreadActionId(post.id);
    const existingComments = commentsForPost(post);
    const baselineCount = existingComments.length;
    const baselineVisibleCount = visibleCommentCounts[post.id] ?? baselineCount;
    const baselinePersistedCount = persistedCommentsByPostId[post.id]?.length ?? 0;
    pauseCommentReveal(post.id);
    setCommentDraft('');
    setVisibleCommentCounts((current) => ({
      ...current,
      [post.id]: current[post.id] ?? baselineVisibleCount,
    }));
    setPendingCommentReveal({
      actionId,
      postId: post.id,
      baselineCount,
      baselineVisibleCount,
      baselinePersistedCount,
    });
    showNotice({ kind: 'success', text: 'Comment sent' });
    const succeeded = await onSubmitSocialThreadAction({
      actor: owner,
      action: {
        actionId,
        action: 'comment',
        app: app.id,
        postId: post.id,
        postAuthor: post.authorName,
        postAuthorHandle: post.authorHandle,
        postCaption: post.caption,
        actor: owner.name,
        actorHandle: account,
        commentText: text,
      },
      existingComments,
      likeCount: post.likeCount,
    });
    if (!succeeded) {
      setPendingCommentReveal(undefined);
      setVisibleCommentCounts((current) => {
        const next = { ...current };
        delete next[post.id];
        return next;
      });
      setCommentDraft(text);
      showNotice({ kind: 'error', text: 'Comment could not be sent. Your text was restored.' }, 3_500);
    }
  }

  function nextThreadActionId(postId: string) {
    nextThreadActionSequenceRef.current += 1;
    return `social-thread-${app.id}-${postId}-${nextThreadActionSequenceRef.current}`;
  }

  function commentsForPost(post: SocialPost): SocialReactionComment[] {
    return [
      ...(post.comments ?? []),
      ...(persistedCommentsByPostId[post.id] ?? []),
    ].map((comment) => ({
      from: comment.authorName ?? comment.authorHandle,
      handle: comment.authorHandle,
      text: comment.text,
    }));
  }

  function pauseCommentReveal(postId: string) {
    const timers = commentRevealTimersRef.current.get(postId) ?? [];
    timers.forEach((timer) => window.clearTimeout(timer));
    commentRevealTimersRef.current.delete(postId);
  }

  async function loadMoreComments(post: SocialPost) {
    if (!account || !owner || isRunning) {
      return;
    }
    const actionId = nextThreadActionId(post.id);
    const existingComments = commentsForPost(post);
    const baselineCount = existingComments.length;
    const baselineVisibleCount = visibleCommentCounts[post.id] ?? baselineCount;
    const baselinePersistedCount = persistedCommentsByPostId[post.id]?.length ?? 0;
    pauseCommentReveal(post.id);
    setVisibleCommentCounts((current) => ({
      ...current,
      [post.id]: current[post.id] ?? baselineVisibleCount,
    }));
    setPendingCommentReveal({
      actionId,
      postId: post.id,
      baselineCount,
      baselineVisibleCount,
      baselinePersistedCount,
    });
    const succeeded = await onSubmitSocialThreadAction({
      actor: owner,
      action: {
        actionId,
        action: 'load-more',
        app: app.id,
        postId: post.id,
        postAuthor: post.authorName,
        postAuthorHandle: post.authorHandle,
        postCaption: post.caption,
        actor: owner.name,
        actorHandle: account,
      },
      existingComments,
      likeCount: post.likeCount,
    });
    if (!succeeded) {
      setPendingCommentReveal(undefined);
      showNotice({ kind: 'error', text: 'Comments could not be loaded.' }, 3_000);
    }
  }

  async function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const caption = postDraft.trim();
    if (!caption || !account || !owner || isRunning) {
      return;
    }
    const record: SocialPostRecord = {
      app: app.id,
      postId: nextSocialPostId(
        app.id,
        socialMediaMessages,
        optimisticPosts.map((post) => post.id),
      ),
      author: owner.name,
      authorHandle: account,
      caption,
      textOnly: !postDraftImage || undefined,
      // Only the Gallery image id is persisted; uploads were imported into
      // the Gallery when they were picked, so every draft image has one.
      imageId: postDraftImage?.id,
      imageDescription: postDraftImage?.description,
    };
    const draftImage = postDraftImage;
    const optimisticPost: SocialPost = {
      id: record.postId,
      authorName: record.author,
      authorHandle: record.authorHandle,
      caption: record.caption,
      likeCount: 0,
      commentCount: 0,
      locked: false,
      dummy: false,
      textOnly: record.textOnly,
      imageDataUrl: draftImage?.dataUrl,
    };
    setPostDraft('');
    setPostDraftImage(undefined);
    setPostStage(undefined);
    setDelayedPostIds((current) => new Set(current).add(record.postId));
    setFreshPostIds((current) => new Set(current).add(record.postId));
    setVisibleLikeCounts((current) => ({ ...current, [record.postId]: 0 }));
    setVisibleCommentCounts((current) => ({ ...current, [record.postId]: 0 }));
    showNotice({ kind: 'success', text: 'Post sent' });
    const appearTimer = window.setTimeout(() => {
      setOptimisticPosts((current) => [
        optimisticPost,
        ...current.filter((post) => post.id !== record.postId),
      ]);
      setOpenCommentsPostId(record.postId);
      setDelayedPostIds((current) => {
        const next = new Set(current);
        next.delete(record.postId);
        return next;
      });
      postAppearTimersRef.current.delete(record.postId);
    }, randomDelay(POST_APPEAR_DELAY_MIN_MS, POST_APPEAR_DELAY_MAX_MS));
    postAppearTimersRef.current.set(record.postId, appearTimer);
    // Publishing runs the workflow (Message Format 2, prompt slot per app):
    // the post is recorded in the chat history and the AI generates the
    // reactions. The image travels along so vision models can see it.
    const succeeded = await onSubmitSocialPost({
      author: owner,
      post: record,
      image: draftImage,
    });
    if (!succeeded) {
      const pendingTimer = postAppearTimersRef.current.get(record.postId);
      if (pendingTimer !== undefined) {
        window.clearTimeout(pendingTimer);
        postAppearTimersRef.current.delete(record.postId);
      }
      setOptimisticPosts((current) => current.filter((post) => post.id !== record.postId));
      setDelayedPostIds((current) => {
        const next = new Set(current);
        next.delete(record.postId);
        return next;
      });
      setFreshPostIds((current) => {
        const next = new Set(current);
        next.delete(record.postId);
        return next;
      });
      setVisibleLikeCounts((current) => {
        const next = { ...current };
        delete next[record.postId];
        return next;
      });
      setVisibleCommentCounts((current) => {
        const next = { ...current };
        delete next[record.postId];
        return next;
      });
      setPostDraft(caption);
      setPostDraftImage(draftImage);
      setPostStage('editor');
      showNotice({ kind: 'error', text: 'Post could not be sent. Your draft was restored.' }, 3_500);
      return;
    }
    const fallbackTimer = window.setTimeout(() => {
      if (!persistedReactionsRef.current[record.postId]) {
        setFreshPostIds((current) => {
          const next = new Set(current);
          next.delete(record.postId);
          return next;
        });
        setVisibleCommentCounts((current) => {
          const next = { ...current };
          delete next[record.postId];
          return next;
        });
      }
      reactionFallbackTimersRef.current.delete(record.postId);
    }, 500);
    reactionFallbackTimersRef.current.set(record.postId, fallbackTimer);
  }

  function submitPostOnEnter(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = socialHandleForName(nickname);
    if (!nickname.trim() || !owner) {
      return;
    }
    // The account name is persisted in the Storybook so it survives closing
    // the app and is part of the story data.
    onCreateSocialAccount(owner, app.id, username);
    setAccount(username);
    setNickname('');
  }

  function submitUserSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  function addSocialUser(user: SocialDirectoryUser) {
    if (!owner || !user.handles[app.id]) {
      return;
    }
    onAddSocialConnection(owner.id, app.id, user.id);
    setDirectMessageParticipant(undefined);
    setDirectMessagesOpen(false);
    setNewPersonName('');
    setAddingPerson(false);
    showNotice({ kind: 'success', text: `${user.name} added` });
  }

  function addUploadedImage(files: FileList | null) {
    const file = files?.[0];
    if (!file || !owner) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        return;
      }
      // Uploads are imported into the owner's Gallery first (deduplicated
      // there); the post then links the stored image by its Gallery id.
      void onImportPostImage({
        owner,
        image: {
          id: `upload-${Date.now()}`,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl: reader.result,
        },
      }).then((savedImage) => {
        if (savedImage) {
          setPostDraftImage(savedImage);
          setPostStage('editor');
        }
      });
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

  if (!account) {
    return (
      <div className={`phone-social-screen ${app.themeClass}`} aria-label={app.name}>
        <header className="phone-gallery-header phone-social-header">
          <button type="button" onClick={onBack} aria-label="Back" title="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="phone-social-brand">
            <strong>{app.name}</strong>
            <span>
              {owner
                ? `${owner.name} — no account`
                : 'No account'}
            </span>
          </div>
        </header>
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

  const directMessageCommentAccounts: SocialDirectMessageParticipant[] = posts.flatMap((post) => [
    ...(post.comments ?? []),
    ...(persistedCommentsByPostId[post.id] ?? []),
  ].map((comment) => {
    const name = comment.authorName ?? `@${comment.authorHandle}`;
    const character = storyCharacters.find((entry) =>
      socialIdentityMatches(socialHandleForCharacter(entry, app.id), comment.authorHandle)
    ) ?? storyCharacters.find((entry) => socialIdentityMatches(entry.name, name));
    return {
      key: `comment-author-${app.id}-${comment.authorHandle}`,
      name: character?.name ?? name,
      handle: comment.authorHandle,
      character,
      origin: {
        postId: post.id,
        postAuthor: post.authorName,
        postAuthorHandle: post.authorHandle,
        postCaption: post.caption,
        postImageId: post.imageId,
        postImageDescription: post.imageDescription,
        commentAuthor: character?.name ?? name,
        commentAuthorHandle: comment.authorHandle,
        commentText: comment.text,
      },
    };
  }));
  const participantCandidates: SocialDirectMessageParticipant[] = [
    ...connectedAccounts,
    ...directMessageCommentAccounts,
    ...dmPartnerAccounts,
    ...starterPosts.map((post) => ({
      key: `virtual-${app.id}-${post.authorHandle}`,
      name: post.authorName,
      handle: post.authorHandle,
    })),
    ...persistedPosts.map((post) => ({
      key: `post-author-${app.id}-${post.authorHandle}`,
      name: post.authorName,
      handle: post.authorHandle,
      character: socialCharacterForPost({
        app: app.id,
        postId: post.id,
        author: post.authorName,
        authorHandle: post.authorHandle,
        caption: post.caption,
      }, storyCharacters),
    })),
  ];
  // Existing conversations bubble to the top, most recent first; contacts
  // without a conversation keep their original order below them.
  const directMessageParticipants = participantCandidates
    .filter((participant, index, entries) =>
      !socialIdentityMatches(participant.handle, account) &&
      entries.findIndex((entry) => socialIdentityMatches(entry.handle, participant.handle)) === index,
    )
    .sort((left, right) => dmRecency(right.handle) - dmRecency(left.handle));
  const directMessages = visibleDirectMessages;

  function openDirectMessages(participant?: SocialDirectMessageParticipant) {
    setPostStage(undefined);
    setDirectMessageParticipant(participant);
    setDirectMessagesOpen(true);
  }

  return (
    <div
      className={`phone-social-screen ${app.themeClass}`}
      aria-label={directMessagesOpen ? `${app.name} messages` : app.name}
    >
      {notice && (
        <div
          className={`phone-social-notice ${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.kind === 'success' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 8v5M12 17h.01" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          )}
          <span>{notice.text}</span>
        </div>
      )}
      <div className="phone-social-surface">
        <div className="phone-social-sidebar" aria-label="Followed accounts">
          <header className="phone-gallery-header phone-social-header">
            <button type="button" onClick={onBack} aria-label="Back" title="Back">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="phone-social-brand">
              <strong>{app.name}</strong>
            </div>
            <button
              type="button"
              className="phone-social-messages-button"
              onClick={() => openDirectMessages()}
              aria-label="Open direct messages"
              title="Messages"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
              </svg>
            </button>
          </header>
          {app.id === 'onlyfriends' && owner && (
            <div className="phone-social-wallet">
              <button
                type="button"
                className="phone-social-wallet-summary"
                onClick={() => setWalletOpen((current) => !current)}
                aria-expanded={walletOpen}
              >
                <span>OnlyFriends Balance</span>
                <strong>{formatBankingAmount(walletBalance)}</strong>
                <small>Manage funds</small>
              </button>
              {walletOpen && (
                <div className="phone-social-wallet-panel">
                  <label>
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={walletAmountText}
                      onChange={(event) => setWalletAmountText(event.target.value)}
                    />
                  </label>
                  <div className="phone-social-wallet-quick-actions">
                    <button type="button" onClick={() => changeWalletAmount(10)}>+$10</button>
                    <button type="button" onClick={() => changeWalletAmount(50)}>+$50</button>
                  </div>
                  <div className="phone-social-wallet-transfer-actions">
                    <button
                      type="button"
                      onClick={() => transferWallet('top-up')}
                      disabled={isRunning || !walletAmountValid || walletAmount > bankBalance}
                    >
                      Top Up
                    </button>
                    <button
                      type="button"
                      onClick={() => transferWallet('withdraw')}
                      disabled={isRunning || !walletAmountValid || walletAmount > walletBalance}
                    >
                      Withdraw
                    </button>
                  </div>
                  <small>Bank balance: {formatBankingAmount(bankBalance)}</small>
                </div>
              )}
            </div>
          )}
          <div className="phone-social-account-list">
            <button
              type="button"
              className={`phone-social-account${directMessagesOpen ? '' : ' active'}`}
              onClick={() => {
                setDirectMessageParticipant(undefined);
                setDirectMessagesOpen(false);
              }}
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
                  className={`phone-social-account${
                    directMessagesOpen && directMessageParticipant &&
                    socialIdentityMatches(directMessageParticipant.handle, entry.handle)
                      ? ' active'
                      : ''
                  }`}
                  onClick={() => openDirectMessages(entry)}
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
              <form className="phone-social-add-user" onSubmit={submitUserSearch}>
                <input
                  type="text"
                  placeholder="Name or @nickname"
                  value={newPersonName}
                  onChange={(event) => setNewPersonName(event.target.value)}
                  autoFocus
                />
                {directorySearchResults.length > 0 ? (
                  <div className="phone-social-user-results" role="listbox" aria-label="Matching users">
                    {directorySearchResults.map((user) => {
                      const alreadyAdded = knownSocialUserIds.has(user.id);
                      return (
                        <div className="phone-social-user-result" key={user.id} role="option">
                          <span>
                            <strong>{user.name}</strong>
                            <small>@{user.handles[app.id]}</small>
                          </span>
                          <button
                            type="button"
                            onClick={() => addSocialUser(user)}
                            disabled={alreadyAdded}
                            aria-label={alreadyAdded ? `${user.name} already added` : `Add ${user.name}`}
                            title={alreadyAdded ? 'Already added' : 'Add user'}
                          >
                            {alreadyAdded ? '✓' : '+'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : newPersonName.trim().replace(/^@/, '').length >= 3 ? (
                  <span className="phone-social-user-not-found">Not found</span>
                ) : (
                  <span className="phone-social-user-hint">Type at least 3 characters</span>
                )}
              </form>
            )}
            <button
              type="button"
              className="phone-social-sidebar-button"
              onClick={() => setAddingPerson((open) => !open)}
              aria-expanded={addingPerson}
            >
              {addingPerson
                ? 'Cancel'
                : '+ Add User'}
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
                    setDirectMessageParticipant(undefined);
                    setDirectMessagesOpen(false);
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
        {directMessagesOpen && owner ? (
          <PhoneSocialDirectMessages
            app={app.id}
            owner={owner}
            ownerHandle={account}
            participants={directMessageParticipants}
            selectedParticipant={directMessageParticipant}
            messages={directMessages}
            characterColors={characterColors}
            socialImageById={socialImageById}
            messageRpDateTimeById={directMessageRpDateTimeById}
            rpTimeTrackingEnabled={rpTimeTrackingEnabled}
            rpDateTimeFormat={rpDateTimeFormat}
            rpWeekdayLanguage={rpWeekdayLanguage}
            emojiOptions={phoneEmojiOptions}
            recentlyUsedEmojis={recentlyUsedEmojis}
            highlightedMessageId={openDirectMessageRequest?.messageId}
            highlightedMessagePulseKey={openDirectMessageRequest?.requestId ?? 0}
            disabled={isRunning}
            onSelectParticipant={setDirectMessageParticipant}
            onCloseConversation={() => setDirectMessageParticipant(undefined)}
            onBack={() => {
              setDirectMessageParticipant(undefined);
              setDirectMessagesOpen(false);
            }}
            onSend={onSendDirectMessage}
          />
        ) : (
        <div className="phone-social-scroll">
          {postStage === 'editor' && (
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
                onKeyDown={submitPostOnEnter}
                rows={2}
                autoFocus
              />
              <button type="submit" disabled={!postDraft.trim() || isRunning}>
                {isRunning ? 'Posting...' : 'Share Post'}
              </button>
            </form>
          )}
          {posts.map((post) => {
            const liked = likedPostIds.has(post.id);
            const lockedNow = post.locked && !unlockedPostIds.has(post.id);
            const price = post.unlockPrice ?? 4.99;
            const allComments = [
              ...(post.comments ?? []),
              ...(persistedCommentsByPostId[post.id] ?? []),
            ];
            const comments = visibleCommentCounts[post.id] === undefined
              ? allComments
              : allComments.slice(0, visibleCommentCounts[post.id]);
            const commentsOpen = openCommentsPostId === post.id;
            const postAuthorCharacter = post.dummy
              ? undefined
              : socialCharacterForPost({
                  app: app.id,
                  postId: post.id,
                  author: post.authorName,
                  authorHandle: post.authorHandle,
                  caption: post.caption,
                }, storyCharacters);
            const postAuthorColor = postAuthorCharacter
              ? characterColors.get(postAuthorCharacter.name)
              : undefined;
            const timeParts = post.rpDateTime && rpDateTimeFormat && rpWeekdayLanguage
              ? formatRpDateTimeParts(post.rpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
              : undefined;
            return (
              <article
                className={`phone-social-post${freshPostIds.has(post.id) ? ' fresh' : ''}`}
                key={post.id}
                ref={(element) => {
                  if (element) {
                    postElementsRef.current.set(post.id, element);
                  } else {
                    postElementsRef.current.delete(post.id);
                  }
                }}
              >
                <div className="phone-social-post-header">
                  <button
                    type="button"
                    className="phone-social-post-author"
                    onClick={() => openDirectMessages({
                      key: `post-author-${app.id}-${post.authorHandle}`,
                      name: post.authorName,
                      handle: post.authorHandle,
                      character: postAuthorCharacter,
                    })}
                    aria-label={`Message ${post.authorName}`}
                    title={`Message ${post.authorName}`}
                  >
                    <CharacterAvatar
                      className="phone-avatar"
                      name={post.authorName}
                      fallback={post.authorName.slice(0, 1).toUpperCase()}
                      profileImageDataUrl={postAuthorCharacter?.profileImage?.dataUrl}
                      style={postAuthorColor
                        ? { borderColor: postAuthorColor, color: postAuthorColor }
                        : undefined}
                    />
                    <div className="phone-social-post-author-info">
                      <strong>{post.authorName}</strong>
                      <span>@{post.authorHandle}</span>
                    </div>
                  </button>
                  <div className="phone-social-post-header-right">
                    {lockedNow && (
                      <span className="phone-social-locked-chip">Locked</span>
                    )}
                    {timeParts && (
                      <time className="phone-social-post-time">
                        <span>{timeParts.date}</span>
                        <span>{timeParts.time}</span>
                      </time>
                    )}
                  </div>
                </div>
                {post.textOnly ? (
                  <>
                    <p className="phone-social-post-caption text-only-caption">
                      <strong>{post.authorName}</strong> {post.caption}
                    </p>
                    <hr className="phone-social-post-separator" />
                    <div className="phone-social-post-footer">
                      <div className="phone-social-post-actions text-only-actions">
                        <button
                          type="button"
                          className={`phone-social-like-button${liked ? ' liked' : ''}`}
                          onClick={() => toggleLike(post)}
                          aria-pressed={liked}
                          aria-label={liked ? 'Unlike' : 'Like'}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M19 14c1.5-1.5 2-3.2 2-4.5A4.5 4.5 0 0 0 12 6.6 4.5 4.5 0 0 0 3 9.5c0 1.3.5 3 2 4.5l7 7Z" />
                          </svg>
                          <span className="phone-social-like-count-pop" key={post.likeCount}>
                            {formatSocialCount(post.likeCount)}
                          </span>
                        </button>
                      </div>
                      <button
                        type="button"
                        className="phone-social-open-comments-toggle"
                        onClick={() => {
                          setOpenCommentsPostId(commentsOpen ? undefined : post.id);
                          setCommentDraft('');
                        }}
                        aria-expanded={commentsOpen}
                      >
                        <span>{commentsOpen ? 'Hide comments' : 'Open comments'}</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="16" height="16">
                          {commentsOpen ? (
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                          ) : (
                            <path d="M5 12h14M14 7l5 5-5 5" />
                          )}
                        </svg>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
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
                              <strong>Pay with OnlyFriends Balance</strong>
                              <span>
                                {formatBankingAmount(price)} · Balance {formatBankingAmount(walletBalance)}
                              </span>
                              <div className="phone-social-unlock-confirm-actions">
                                <button
                                  type="button"
                                  onClick={() => payUnlock(post)}
                                  disabled={isRunning || price > walletBalance}
                                >
                                  {isRunning ? 'Paying...' : `Pay ${formatBankingAmount(price)}`}
                                </button>
                                <button type="button" onClick={() => setUnlockCandidateId(undefined)}>
                                  Cancel
                                </button>
                              </div>
                              {price > walletBalance && (
                                <>
                                  <span className="phone-social-unlock-hint">
                                    Not enough OnlyFriends balance.
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setWalletOpen(true)}
                                  >
                                    Add funds
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <button type="button" onClick={() => setUnlockCandidateId(post.id)}>
                              Unlock for {formatBankingAmount(price)}
                            </button>
                          )}
                        </div>
                      )}
                      {!lockedNow && (
                        <div className="phone-social-post-image-actions">
                          <button
                            type="button"
                            className={`phone-social-like-button${liked ? ' liked' : ''}`}
                            onClick={() => toggleLike(post)}
                            aria-pressed={liked}
                            aria-label={liked ? 'Unlike' : 'Like'}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M19 14c1.5-1.5 2-3.2 2-4.5A4.5 4.5 0 0 0 12 6.6 4.5 4.5 0 0 0 3 9.5c0 1.3.5 3 2 4.5l7 7Z" />
                            </svg>
                            <span className="phone-social-like-count-pop" key={post.likeCount}>
                              {formatSocialCount(post.likeCount)}
                            </span>
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
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                            </svg>
                            <span>{formatSocialCount(post.commentCount)}</span>
                          </button>
                        </div>
                      )}
                    </div>
                    {!lockedNow && (
                      <>
                        <hr className="phone-social-post-separator" />
                        <p className="phone-social-post-caption">
                          <strong>{post.authorName}</strong> {post.caption}
                        </p>
                        <div className="phone-social-post-footer">
                          <button
                            type="button"
                            className="phone-social-open-comments-toggle"
                            onClick={() => {
                              setOpenCommentsPostId(commentsOpen ? undefined : post.id);
                              setCommentDraft('');
                            }}
                            aria-expanded={commentsOpen}
                          >
                            <span>{commentsOpen ? 'Hide comments' : 'Open comments'}</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="16" height="16">
                              {commentsOpen ? (
                                <path d="M19 12H5M12 19l-7-7 7-7" />
                              ) : (
                                <path d="M5 12h14M14 7l5 5-5 5" />
                              )}
                            </svg>
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
                {commentsOpen && (
                  <div className="phone-social-comments">
                    {comments.map((comment) => (
                      <button
                        type="button"
                        className="phone-social-comment"
                        key={comment.id}
                        onClick={() => {
                          const character = storyCharacters.find((entry) =>
                            socialIdentityMatches(
                              socialHandleForCharacter(entry, app.id),
                              comment.authorHandle,
                            )
                          ) ?? storyCharacters.find((entry) =>
                            socialIdentityMatches(entry.name, comment.authorName ?? '')
                          );
                          openDirectMessages({
                            key: `comment-author-${app.id}-${comment.authorHandle}`,
                            name: character?.name ?? comment.authorName ?? `@${comment.authorHandle}`,
                            handle: comment.authorHandle,
                            character,
                            origin: {
                              postId: post.id,
                              postAuthor: post.authorName,
                              postAuthorHandle: post.authorHandle,
                              postCaption: post.caption,
                              postImageId: post.imageId,
                              postImageDescription: post.imageDescription,
                              commentAuthor:
                                character?.name ?? comment.authorName ?? `@${comment.authorHandle}`,
                              commentAuthorHandle: comment.authorHandle,
                              commentText: comment.text,
                            },
                          });
                        }}
                        aria-label={`Message ${comment.authorName ?? `@${comment.authorHandle}`}`}
                        title={`Message ${comment.authorName ?? `@${comment.authorHandle}`}`}
                      >
                        <strong>{comment.authorName ?? `@${comment.authorHandle}`}</strong>
                        <span>{comment.text}</span>
                      </button>
                    ))}
                    {comments.length === 0 && (
                      <span className="phone-social-empty">No comments yet.</span>
                    )}
                    <button
                      type="button"
                      className="phone-social-load-comments"
                      onClick={() => void loadMoreComments(post)}
                      disabled={isRunning || pendingCommentReveal?.postId === post.id}
                    >
                      {isRunning || pendingCommentReveal?.postId === post.id
                        ? 'Loading...'
                        : 'Load More Comments'}
                    </button>
                    {pendingCommentReveal?.postId !== post.id && (
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
                        <button type="submit" disabled={!commentDraft.trim() || isRunning}>
                          {isRunning ? 'Sending...' : 'Send'}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        )}
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
