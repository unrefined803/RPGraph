import {
  Fragment,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  defaultPhoneChatTextSize,
  phoneDesktopGridColumns,
  phoneDesktopGridRows,
} from '../settings';
import type { StorybookCharacter } from '../storybook/runtime';
import type { PhoneDesktopIconSize, PhoneDesktopLayout } from '../types';
import type {
  ChatImageAttachment,
  ConnectionPreset,
  ImageCaptionChange,
  MessageRecord,
  SocialPostRecord,
  SocialReactionComment,
  SocialThreadActionRecord,
  ProviderConnectionHealth,
  RpDateTimeFormat,
  RpWeekdayLanguage,
} from '../types';
import {
  matchingPhoneName,
  phoneConversationMessageViews,
} from '../data-management/selectors';
import { formatRpDateTimeParts, formatRpDayLabel } from '../workflow';
import { dialogueSpeechText } from '../chat/dialogueVoiceSegments';
import { phoneReplyVisibleText } from '../chat/phoneReplies';
import { PhoneImagePicker } from './PhoneImagePicker';
import { PhoneGalleryScreen } from './PhoneGalleryScreen';
import { PhoneBankingScreen } from './PhoneBankingScreen';
import { PhoneSocialFeedScreen } from './phone-social/PhoneSocialFeedScreen';
import { socialApps } from './phone-social/socialApps';
import { PhoneVoiceMessage } from './PhoneVoiceMessage';
import { CharacterAvatar } from './CharacterAvatar';
import { ImageContextControl } from './ImageContextControl';
import {
  CommandPillComposer,
  CommandPillList,
  type CommandPillComposerHandle,
} from './CommandPillComposer';
import type { CommandInputCommand } from '../chat/structuredCommands';
import type {
  ImageGenerationAssistantMessage,
  ImageGenerationAssistantResult,
  ImageGenerationSettings,
  ImageAssistantModelState,
} from '../chat/imageGenerationAssistant';
import { imageGenerationCharacterContext } from '../chat/imageGenerationAssistant';
import wallpaper1Url from '../assets/wallpapers/Wallpaper 1.jpg';
import wallpaper2Url from '../assets/wallpapers/Wallpaper 2.jpg';

type PhoneContact = {
  character: StorybookCharacter;
  color: string;
  conversationKey: string;
  latestPhoneId: number;
  preview: string;
  time: string;
  unreadCount: number;
};

type UnreadPhoneConversation = {
  key: string;
  conversationKey: string;
  viewerName: string;
  contactName: string;
  latestId: number;
  unreadCount: number;
  unread: boolean;
};

type PhoneScreen =
  | 'desktop' | 'whatsup' | 'gallery' | 'chat-gallery' | 'camera' | 'banking'
  | 'fotogram' | 'onlyfriends';

type PhoneDesktopAppId = 'whatsup' | 'gallery' | 'camera' | 'banking' | 'fotogram' | 'onlyfriends';

const phoneDesktopAppIds: readonly PhoneDesktopAppId[] =
  ['whatsup', 'gallery', 'camera', 'banking', 'fotogram', 'onlyfriends'];

const defaultPhoneWallpapers: ChatImageAttachment[] = [
  {
    id: 'wallpaper-1',
    name: 'Wallpaper 1',
    mimeType: 'image/jpeg',
    size: 0,
    dataUrl: wallpaper1Url,
  },
  {
    id: 'wallpaper-2',
    name: 'Wallpaper 2',
    mimeType: 'image/jpeg',
    size: 0,
    dataUrl: wallpaper2Url,
  },
];

const phoneDesktopIconSizePx: Record<PhoneDesktopIconSize, number> = {
  medium: 52,
  large: 68,
};
const phoneDesktopIconLabelHeight = 18;

function phoneReplySizeClass(text: string) {
  if (text.length > 120) {
    return ' long';
  }
  return text.length > 60 ? ' medium' : '';
}

function desktopBadgeLabel(count: number) {
  return count > 99 ? '99+' : String(count);
}

type PhonePanelProps = {
  phoneContacts: PhoneContact[];
  storyCharacters: StorybookCharacter[];
  characterColors: Map<string, string>;
  selectedPhoneContact?: PhoneContact;
  selectedCharacter?: StorybookCharacter;
  selectedCharacterPlayable?: boolean;
  selectedPhoneConversation: MessageRecord[];
  selectedPhoneDividerAfterId?: number;
  highlightedPhoneMessageId?: number;
  highlightedPhoneMessagePulseKey: number;
  unreadPhoneConversations: UnreadPhoneConversation[];
  unreadBankingCount: number;
  phoneHomeRequestId: number;
  socialPostOpenRequest?: {
    requestId: number;
    app: 'fotogram' | 'onlyfriends';
    postId: string;
  };
  phoneImages: ChatImageAttachment[];
  phoneGalleryImages: ChatImageAttachment[];
  phoneDraft: string;
  phoneDraftCommands: CommandInputCommand[];
  replyToMessage?: MessageRecord;
  showPhoneEmojiPicker: boolean;
  phoneEmojiOptions: string[];
  recentlyUsedEmojis?: string[];
  isRunning: boolean;
  canSend: boolean;
  inputLocked?: boolean;
  voiceMessageSpeakerNames: ReadonlySet<string>;
  onGenerateVoiceMessageClip: (request: { messageId: number; speakerName: string; text: string }) => Promise<string | null>;
  englishProcessingEnabled: boolean;
  rpTimeTrackingEnabled: boolean;
  phoneAuthorBadgesEnabled: boolean;
  phoneChatTextSize: number;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  contextualReferenceImageIds: ReadonlySet<string>;
  selectedReferenceImageIds: ReadonlySet<string>;
  imageUploadEnabled?: boolean;
  imageUploadDisabledReason?: string;
  referenceImageContextEnabled?: boolean;
  referenceImageContextDisabledReason?: string;
  phoneThreadRef: RefObject<HTMLDivElement | null>;
  phoneEmojiPickerRef: RefObject<HTMLDivElement | null>;
  phoneImageInputRef: RefObject<HTMLInputElement | null>;
  onOpenPhoneContact: (contact: PhoneContact) => void;
  onMarkSelectedPhoneConversationSeen: () => void;
  onMarkBankingSeen: () => void;
  onOpenUnreadPhoneConversation: (conversation: UnreadPhoneConversation) => void;
  unreadPhoneSwitchName: (conversation: UnreadPhoneConversation) => string;
  onSwitchToViewedCharacter: () => void;
  onPreviewImage: (image: ChatImageAttachment) => void;
  onToggleReferenceImage: (image: ChatImageAttachment) => void;
  onPreviewImageCaptionChange: (change: ImageCaptionChange) => void;
  onScrollPhoneThreadToBottom: (behavior?: ScrollBehavior) => void;
  onRemovePhoneImage: (imageId: string) => void;
  onPhoneDraftChange: (value: string) => void;
  onPhoneDraftCommandsChange: (commands: CommandInputCommand[]) => void;
  onReplyToMessage: (message: MessageRecord) => void;
  onCancelPhoneReply: () => void;
  onSubmitPhoneMessage: (event: FormEvent<HTMLFormElement>) => void;
  onTogglePhoneEmojiPicker: () => void;
  onSelectPhoneEmoji: (emoji: string) => void;
  onSelectPhoneImages: () => void;
  onSelectPhoneGalleryImage: (image: ChatImageAttachment) => void;
  onAddPhoneImages: (files: FileList | null) => void;
  connections?: ConnectionPreset[];
  providerHealthById?: Record<string, ProviderConnectionHealth>;
  estimatedTokenBytesPerToken: number;
  imageAssistantChatHistoryContext: string;
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
  onPhoneWallpaperChange: (character: StorybookCharacter, wallpaperId: string) => void;
  bankTransferMessages: MessageRecord[];
  bankingContactNames: string[];
  onAddBankingContact: (characterId: string, contactName: string) => void;
  onSendBankTransfer: (request: {
    from: StorybookCharacter;
    to: string;
    amount: number;
    note: string;
  }) => void;
  socialMediaMessages: MessageRecord[];
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
  onImportSocialPostImage: (request: {
    owner: StorybookCharacter;
    image: ChatImageAttachment;
  }) => Promise<ChatImageAttachment | undefined>;
  socialImageById: (imageId: string) => ChatImageAttachment | undefined;
  socialLikesByAccount: Record<string, string[]>;
  onToggleSocialLike: (
    characterId: string,
    app: 'fotogram' | 'onlyfriends',
    postId: string,
  ) => void;
  phoneDesktopLayout: PhoneDesktopLayout;
  onPhoneDesktopLayoutChange: (layout: PhoneDesktopLayout) => void;
  phoneDesktopIconSize: PhoneDesktopIconSize;
  onPhoneDesktopIconSizeChange: (size: PhoneDesktopIconSize) => void;
  phoneClockRpDateTime?: string;
  imageAssistantModelStateById: Record<string, ImageAssistantModelState>;
  onSetImageAssistantLlmModelLoaded: (providerId: string, loaded: boolean) => Promise<void>;
  onUnloadImageAssistantComfyModel: (providerId: string) => Promise<void>;
  onRefreshImageAssistantModelState: (providerId: string) => void;
};

export function PhonePanel({
  phoneContacts,
  storyCharacters,
  characterColors,
  selectedPhoneContact,
  selectedCharacter,
  selectedCharacterPlayable = true,
  selectedPhoneConversation,
  selectedPhoneDividerAfterId,
  highlightedPhoneMessageId,
  highlightedPhoneMessagePulseKey,
  unreadPhoneConversations,
  unreadBankingCount,
  phoneHomeRequestId,
  socialPostOpenRequest,
  phoneImages,
  phoneGalleryImages,
  phoneDraft,
  phoneDraftCommands,
  replyToMessage,
  showPhoneEmojiPicker,
  phoneEmojiOptions,
  recentlyUsedEmojis = [],
  isRunning,
  canSend,
  inputLocked = false,
  voiceMessageSpeakerNames,
  onGenerateVoiceMessageClip,
  englishProcessingEnabled,
  rpTimeTrackingEnabled,
  phoneAuthorBadgesEnabled,
  phoneChatTextSize,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  contextualReferenceImageIds,
  selectedReferenceImageIds,
  imageUploadEnabled = true,
  imageUploadDisabledReason,
  referenceImageContextEnabled = true,
  referenceImageContextDisabledReason,
  phoneThreadRef,
  phoneEmojiPickerRef,
  phoneImageInputRef,
  onOpenPhoneContact,
  onMarkSelectedPhoneConversationSeen,
  onMarkBankingSeen,
  onOpenUnreadPhoneConversation,
  unreadPhoneSwitchName,
  onSwitchToViewedCharacter,
  onPreviewImage,
  onToggleReferenceImage,
  onPreviewImageCaptionChange,
  onScrollPhoneThreadToBottom,
  onRemovePhoneImage,
  onPhoneDraftChange,
  onPhoneDraftCommandsChange,
  onReplyToMessage,
  onCancelPhoneReply,
  onSubmitPhoneMessage,
  onTogglePhoneEmojiPicker,
  onSelectPhoneEmoji,
  onSelectPhoneImages,
  onSelectPhoneGalleryImage,
  onAddPhoneImages,
  connections = [],
  providerHealthById = {},
  estimatedTokenBytesPerToken,
  imageAssistantChatHistoryContext,
  onSubmitImageAssistantMessage,
  onGenerateImageAssistantImages,
  onSaveImageAssistantImage,
  onPhoneWallpaperChange,
  bankTransferMessages,
  bankingContactNames,
  onAddBankingContact,
  onSendBankTransfer,
  socialMediaMessages,
  onSubmitSocialPost,
  onSubmitSocialThreadAction,
  onCreateSocialAccount,
  onImportSocialPostImage,
  socialImageById,
  socialLikesByAccount,
  onToggleSocialLike,
  phoneDesktopLayout,
  onPhoneDesktopLayoutChange,
  phoneDesktopIconSize,
  onPhoneDesktopIconSizeChange,
  phoneClockRpDateTime,
  imageAssistantModelStateById,
  onSetImageAssistantLlmModelLoaded,
  onUnloadImageAssistantComfyModel,
  onRefreshImageAssistantModelState,
}: PhonePanelProps) {
  const commandComposerRef = useRef<CommandPillComposerHandle | null>(null);
  // Start on the conversation when the panel opens through a chat message
  // link, or on a requested social post; otherwise start on the desktop.
  const [screen, setScreen] = useState<PhoneScreen>(() =>
    socialPostOpenRequest?.app ??
    (highlightedPhoneMessageId !== undefined ? 'whatsup' : 'desktop'));
  const [seenPhoneHomeRequestId, setSeenPhoneHomeRequestId] = useState(phoneHomeRequestId);
  if (seenPhoneHomeRequestId !== phoneHomeRequestId) {
    setSeenPhoneHomeRequestId(phoneHomeRequestId);
    if (screen !== 'desktop') {
      setScreen('desktop');
    }
  }
  const [seenSocialPostOpenRequestId, setSeenSocialPostOpenRequestId] = useState(
    socialPostOpenRequest?.requestId ?? 0,
  );
  // Leaving the social screen consumes the request; otherwise reopening the
  // app from the desktop would jump back to the previously requested post.
  const [dismissedSocialPostOpenRequestId, setDismissedSocialPostOpenRequestId] =
    useState<number>();
  if (
    socialPostOpenRequest &&
    seenSocialPostOpenRequestId !== socialPostOpenRequest.requestId
  ) {
    setSeenSocialPostOpenRequestId(socialPostOpenRequest.requestId);
    if (screen !== socialPostOpenRequest.app) {
      setScreen(socialPostOpenRequest.app);
    }
  }
  const unreadWhatsUpCount = phoneContacts.reduce(
    (count, contact) => count + contact.unreadCount,
    0,
  );

  useEffect(() => {
    if (screen === 'whatsup' && selectedPhoneContact) {
      onMarkSelectedPhoneConversationSeen();
    }
  }, [
    onMarkSelectedPhoneConversationSeen,
    screen,
    selectedPhoneContact,
  ]);

  useEffect(() => {
    if (screen === 'banking' && unreadBankingCount > 0) {
      onMarkBankingSeen();
    }
  }, [onMarkBankingSeen, screen, unreadBankingCount]);

  // Jump straight to the conversation when a chat message links into the
  // phone (each click bumps the highlight pulse key).
  const [seenHighlightPulseKey, setSeenHighlightPulseKey] = useState(highlightedPhoneMessagePulseKey);
  if (seenHighlightPulseKey !== highlightedPhoneMessagePulseKey) {
    setSeenHighlightPulseKey(highlightedPhoneMessagePulseKey);
    if (highlightedPhoneMessageId !== undefined && screen !== 'whatsup') {
      setScreen('whatsup');
    }
  }
  const [desktopLayoutOverride, setDesktopLayoutOverride] = useState<PhoneDesktopLayout | undefined>(undefined);
  const desktopLayout = desktopLayoutOverride ?? phoneDesktopLayout;
  const desktopLayoutRef = useRef(phoneDesktopLayout);
  const desktopRef = useRef<HTMLDivElement | null>(null);
  const desktopInteractionRef = useRef<{
    kind: 'clock' | 'app' | 'resize';
    appId?: PhoneDesktopAppId;
    startedAt: { x: number; y: number };
    moved: boolean;
  } | undefined>(undefined);
  const suppressAppClickRef = useRef(false);
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const desktopSettingsRef = useRef<HTMLDivElement | null>(null);
  const desktopIconPx = phoneDesktopIconSizePx[phoneDesktopIconSize];
  const desktopGridGap = desktopIconPx / 2;
  const desktopCellWidth = desktopIconPx;
  const desktopCellHeight = desktopIconPx + phoneDesktopIconLabelHeight;

  useEffect(() => {
    if (!desktopSettingsOpen) {
      return;
    }
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && !desktopSettingsRef.current?.contains(event.target)) {
        setDesktopSettingsOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [desktopSettingsOpen]);

  const [clockNow, setClockNow] = useState(() => new Date());

  useEffect(() => {
    if (screen !== 'desktop') {
      return;
    }
    const updateClock = () => setClockNow(new Date());
    const kickoff = window.setTimeout(updateClock, 0);
    const timer = window.setInterval(updateClock, 30_000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [screen]);

  const pad2 = (value: number) => String(value).padStart(2, '0');
  const localClockDateTime = `${clockNow.getFullYear()}-${pad2(clockNow.getMonth() + 1)}-` +
    `${pad2(clockNow.getDate())}T${pad2(clockNow.getHours())}:${pad2(clockNow.getMinutes())}`;
  const clockDateTime = rpTimeTrackingEnabled && phoneClockRpDateTime
    ? phoneClockRpDateTime
    : localClockDateTime;
  const clockParts = formatRpDateTimeParts(clockDateTime, rpDateTimeFormat, rpWeekdayLanguage);
  const clockDayLabel = formatRpDayLabel(clockDateTime, rpDateTimeFormat, rpWeekdayLanguage);

  const isImageInContext = (image: ChatImageAttachment) =>
    !!image.id.trim() && contextualReferenceImageIds.has(image.id.trim());
  const isImageManuallySelected = (image: ChatImageAttachment) =>
    !!image.id.trim() && selectedReferenceImageIds.has(image.id.trim());
  const phoneOwnerName = selectedCharacter?.name.trim().split(/\s+/)[0];
  const phoneListTitle = phoneOwnerName ? `${phoneOwnerName}'s Chats` : 'Phone Chats';
  const wallpaperImageId = selectedCharacter?.phoneSettings.wallpaperId ?? 'wallpaper-1';
  const wallpaperImage = [...defaultPhoneWallpapers, ...phoneGalleryImages]
    .find((image) => image.id === wallpaperImageId) ?? defaultPhoneWallpapers[0];
  const desktopStyle = wallpaperImage?.dataUrl
    ? { backgroundImage: `url("${wallpaperImage.dataUrl}")` }
    : undefined;
  const selectedReplyText = replyToMessage
    ? phoneReplyVisibleText(replyToMessage, englishProcessingEnabled) || 'Image'
    : '';
  const phoneMessageViews = useMemo(() => phoneConversationMessageViews(
    selectedPhoneConversation,
    {
      viewerName: selectedCharacter?.name,
      selectedPhoneDividerAfterId,
      englishProcessingEnabled,
      rpTimeTrackingEnabled,
    },
  ), [
    englishProcessingEnabled,
    rpTimeTrackingEnabled,
    selectedCharacter?.name,
    selectedPhoneConversation,
    selectedPhoneDividerAfterId,
  ]);

  function desktopGridPoint(clientX: number, clientY: number) {
    const bounds = desktopRef.current?.getBoundingClientRect();
    const pitchX = desktopCellWidth + desktopGridGap;
    const pitchY = desktopCellHeight + desktopGridGap;
    if (!bounds) {
      return { column: 1, row: 1, fitColumns: 1, fitRows: 1 };
    }
    const padding = desktopIconPx * 0.75;
    const fitColumns = Math.min(
      phoneDesktopGridColumns,
      Math.max(1, Math.floor((bounds.width - padding * 2 + desktopGridGap) / pitchX)),
    );
    const fitRows = Math.min(
      phoneDesktopGridRows,
      Math.max(1, Math.floor((bounds.height - padding * 2 + desktopGridGap) / pitchY)),
    );
    return {
      column: Math.min(fitColumns, Math.max(1, Math.floor((clientX - bounds.left - padding) / pitchX) + 1)),
      row: Math.min(fitRows, Math.max(1, Math.floor((clientY - bounds.top - padding) / pitchY) + 1)),
      fitColumns,
      fitRows,
    };
  }

  function beginDesktopInteraction(
    event: ReactPointerEvent<HTMLElement>,
    interaction: { kind: 'clock' | 'app' | 'resize'; appId?: PhoneDesktopAppId },
  ) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    desktopLayoutRef.current = desktopLayout;
    desktopInteractionRef.current = {
      ...interaction,
      startedAt: { x: event.clientX, y: event.clientY },
      moved: false,
    };
  }

  function moveDesktopInteraction(event: ReactPointerEvent<HTMLDivElement>) {
    const interaction = desktopInteractionRef.current;
    if (!interaction) {
      return;
    }
    if (Math.hypot(event.clientX - interaction.startedAt.x, event.clientY - interaction.startedAt.y) > 5) {
      interaction.moved = true;
    }
    const point = desktopGridPoint(event.clientX, event.clientY);
    setDesktopLayoutOverride((previous) => {
      const current = previous ?? phoneDesktopLayout;
      if (interaction.kind === 'app' && interaction.appId) {
        const cellOccupied = phoneDesktopAppIds.some((app) =>
          app !== interaction.appId &&
          current.apps[app].column === point.column &&
          current.apps[app].row === point.row,
        );
        if (cellOccupied) {
          desktopLayoutRef.current = current;
          return current;
        }
        const next = {
          ...current,
          apps: {
            ...current.apps,
            [interaction.appId]: { column: point.column, row: point.row },
          },
        };
        desktopLayoutRef.current = next;
        return next;
      }
      if (interaction.kind === 'clock') {
        const next = {
          ...current,
          clock: {
            ...current.clock,
            column: Math.max(1, Math.min(point.fitColumns - current.clock.width + 1, point.column)),
            row: Math.max(1, Math.min(point.fitRows - current.clock.height + 1, point.row)),
          },
        };
        desktopLayoutRef.current = next;
        return next;
      }
      const next = {
        ...current,
        clock: {
          ...current.clock,
          width: Math.max(2, Math.min(point.fitColumns - current.clock.column + 1, point.column - current.clock.column + 1)),
          height: Math.max(1, Math.min(point.fitRows - current.clock.row + 1, point.row - current.clock.row + 1)),
        },
      };
      desktopLayoutRef.current = next;
      return next;
    });
  }

  function endDesktopInteraction() {
    const interaction = desktopInteractionRef.current;
    if (!interaction) {
      return;
    }
    desktopInteractionRef.current = undefined;
    suppressAppClickRef.current = interaction.kind === 'app' || interaction.moved;
    if (interaction.moved) {
      onPhoneDesktopLayoutChange(desktopLayoutRef.current);
    }
    if (interaction.kind === 'app' && interaction.appId && !interaction.moved) {
      setScreen(interaction.appId);
    }
  }

  function selectWallpaper(image?: ChatImageAttachment) {
    if (!selectedCharacter) {
      return;
    }
    onPhoneWallpaperChange(selectedCharacter, image?.id ?? 'wallpaper-1');
  }

  function phoneCharacterColor(name: string) {
    const directColor = characterColors.get(name);
    if (directColor) {
      return directColor;
    }
    const matchedCharacter = matchingPhoneName(storyCharacters, name);
    return matchedCharacter ? characterColors.get(matchedCharacter.name) : undefined;
  }

  function phoneVoiceClipDataUrl(message: MessageRecord, speakerName: string, text: string) {
    const speechText = dialogueSpeechText(text);
    return message.voiceClips?.find((clip) =>
      clip.source === 'phone' &&
      clip.speakerName === speakerName &&
      clip.text === speechText &&
      !!clip.dataUrl
    )?.dataUrl;
  }

  if (screen === 'gallery' || screen === 'chat-gallery') {
    const wallpaperMode = screen === 'gallery';
    return (
      <PhoneGalleryScreen
        title={`${phoneOwnerName ?? 'Phone'}'s Gallery`}
        images={phoneGalleryImages}
        action={wallpaperMode ? 'wallpaper' : 'select'}
        selectedWallpaperId={wallpaperMode ? wallpaperImageId : undefined}
        onBack={() => setScreen(wallpaperMode ? 'desktop' : 'whatsup')}
        onSelectImage={(image) => {
          if (wallpaperMode) {
            selectWallpaper(image);
            setScreen('desktop');
          } else {
            onSelectPhoneGalleryImage(image);
            setScreen('whatsup');
          }
        }}
      />
    );
  }

  if (screen === 'banking') {
    return (
      <PhoneBankingScreen
        key={selectedCharacter?.id ?? 'no-account'}
        owner={selectedCharacter}
        storyCharacters={storyCharacters}
        characterColors={characterColors}
        bankTransferMessages={bankTransferMessages}
        bankingContactNames={bankingContactNames}
        clockDateTime={clockDateTime}
        rpDateTimeFormat={rpDateTimeFormat}
        rpWeekdayLanguage={rpWeekdayLanguage}
        sendLocked={inputLocked}
        isRunning={isRunning}
        onBack={() => setScreen('desktop')}
        onAddBankingContact={onAddBankingContact}
        onSendBankTransfer={onSendBankTransfer}
      />
    );
  }

  if (screen === 'fotogram' || screen === 'onlyfriends') {
    const socialScreen = screen;
    return (
      <PhoneSocialFeedScreen
        key={`${screen}-${selectedCharacter?.id ?? 'no-account'}`}
        app={socialApps[screen]}
        owner={selectedCharacter}
        storyCharacters={storyCharacters}
        characterColors={characterColors}
        phoneGalleryImages={phoneGalleryImages}
        bankTransferMessages={bankTransferMessages}
        socialMediaMessages={socialMediaMessages}
        openPostRequest={
          socialPostOpenRequest?.app === screen &&
          socialPostOpenRequest.requestId !== dismissedSocialPostOpenRequestId
            ? {
                requestId: socialPostOpenRequest.requestId,
                postId: socialPostOpenRequest.postId,
              }
            : undefined
        }
        isRunning={isRunning}
        onSendBankTransfer={onSendBankTransfer}
        onSubmitSocialPost={onSubmitSocialPost}
        onSubmitSocialThreadAction={onSubmitSocialThreadAction}
        onCreateSocialAccount={onCreateSocialAccount}
        onImportPostImage={onImportSocialPostImage}
        socialImageById={socialImageById}
        socialLikesByAccount={socialLikesByAccount}
        onToggleLike={(postId) => {
          if (selectedCharacter) {
            onToggleSocialLike(selectedCharacter.id, socialScreen, postId);
          }
        }}
        onBack={() => {
          setDismissedSocialPostOpenRequestId(socialPostOpenRequest?.requestId);
          setScreen('desktop');
        }}
        connections={connections}
        providerHealthById={providerHealthById}
        estimatedTokenBytesPerToken={estimatedTokenBytesPerToken}
        imageAssistantChatHistoryContext={imageAssistantChatHistoryContext}
        imageAssistantModelStateById={imageAssistantModelStateById}
        onSetImageAssistantLlmModelLoaded={onSetImageAssistantLlmModelLoaded}
        onUnloadImageAssistantComfyModel={onUnloadImageAssistantComfyModel}
        onRefreshImageAssistantModelState={onRefreshImageAssistantModelState}
        onSubmitImageAssistantMessage={onSubmitImageAssistantMessage}
        onGenerateImageAssistantImages={onGenerateImageAssistantImages}
        onSaveImageAssistantImage={onSaveImageAssistantImage}
        rpDateTimeFormat={rpDateTimeFormat}
        rpWeekdayLanguage={rpWeekdayLanguage}
      />
    );
  }

  if (screen === 'camera') {
    return (
      <div className="phone-desktop" style={desktopStyle} aria-label="Phone desktop">
        <div className="phone-desktop-scrim" />
        <PhoneImagePicker
          hideLauncher
          openCameraOnMount
          onCameraClose={() => setScreen('desktop')}
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
          preferredSaveCharacterId={selectedCharacter?.id}
          onSubmitImageAssistantMessage={onSubmitImageAssistantMessage}
          onGenerateImageAssistantImages={onGenerateImageAssistantImages}
          onSaveImageAssistantImage={onSaveImageAssistantImage}
          imageAssistantModelStateById={imageAssistantModelStateById}
          onSetImageAssistantLlmModelLoaded={onSetImageAssistantLlmModelLoaded}
          onUnloadImageAssistantComfyModel={onUnloadImageAssistantComfyModel}
          onRefreshImageAssistantModelState={onRefreshImageAssistantModelState}
        />
      </div>
    );
  }

  if (screen === 'desktop') {
    return (
      <div
        className="phone-desktop"
        ref={desktopRef}
        style={{ ...desktopStyle, '--phone-icon': `${desktopIconPx}px` } as CSSProperties}
        aria-label="Phone desktop"
        onPointerMove={moveDesktopInteraction}
        onPointerUp={endDesktopInteraction}
        onPointerCancel={endDesktopInteraction}
      >
        <div className="phone-desktop-scrim" />
        <div
          className="phone-clock-widget"
          style={{
            gridColumn: `${desktopLayout.clock.column} / span ${desktopLayout.clock.width}`,
            gridRow: `${desktopLayout.clock.row} / span ${desktopLayout.clock.height}`,
          }}
          onPointerDown={(event) => beginDesktopInteraction(event, { kind: 'clock' })}
        >
          <strong>{clockParts?.time ?? '--:--'}</strong>
          <span>{clockDayLabel || clockParts?.date || ''}</span>
          <button
            className="phone-clock-resize-handle"
            type="button"
            onPointerDown={(event) => beginDesktopInteraction(event, { kind: 'resize' })}
            aria-label="Resize clock widget"
            title="Resize clock widget"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M8 16h8M12 12h4M16 8h1" />
            </svg>
          </button>
        </div>
        <div className="phone-desktop-apps">
          <button
            className="phone-desktop-app"
            type="button"
            style={{
              gridColumn: desktopLayout.apps.whatsup.column,
              gridRow: desktopLayout.apps.whatsup.row,
            }}
            onPointerDown={(event) => beginDesktopInteraction(event, { kind: 'app', appId: 'whatsup' })}
            onClick={() => {
              if (suppressAppClickRef.current) {
                suppressAppClickRef.current = false;
                return;
              }
              setScreen('whatsup');
            }}
            aria-label={unreadWhatsUpCount > 0
              ? `Open WhatsUp, ${unreadWhatsUpCount} unread`
              : 'Open WhatsUp'}
          >
            <span className="phone-whatsup-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18.8 5.2A8.9 8.9 0 0 0 4.7 15.9L3.4 20.4l4.7-1.2A8.9 8.9 0 1 0 18.8 5.2Z" />
              </svg>
            </span>
            {unreadWhatsUpCount > 0 && (
              <span className="phone-desktop-app-badge" aria-hidden="true">
                {desktopBadgeLabel(unreadWhatsUpCount)}
              </span>
            )}
            <span>WhatsUp</span>
          </button>
          <button
            className="phone-desktop-app"
            type="button"
            style={{
              gridColumn: desktopLayout.apps.gallery.column,
              gridRow: desktopLayout.apps.gallery.row,
            }}
            onPointerDown={(event) => beginDesktopInteraction(event, { kind: 'app', appId: 'gallery' })}
            onClick={() => {
              if (suppressAppClickRef.current) {
                suppressAppClickRef.current = false;
                return;
              }
              setScreen('gallery');
            }}
            aria-label="Open Gallery"
          >
            <span className="phone-gallery-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <circle cx="8.5" cy="8.5" r="1.4" />
                <path d="m4.5 18 5.5-5.5 3.2 3.2 2.1-2.1 4.2 4.4" />
              </svg>
            </span>
            <span>Gallery</span>
          </button>
          <button
            className="phone-desktop-app"
            type="button"
            style={{
              gridColumn: desktopLayout.apps.camera.column,
              gridRow: desktopLayout.apps.camera.row,
            }}
            onPointerDown={(event) => beginDesktopInteraction(event, { kind: 'app', appId: 'camera' })}
            onClick={() => {
              if (suppressAppClickRef.current) {
                suppressAppClickRef.current = false;
                return;
              }
              setScreen('camera');
            }}
            aria-label="Open Camera"
          >
            <span className="phone-camera-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h3l1.2-2h7.6L17 7h3a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1Z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </span>
            <span>Camera</span>
          </button>
          <button
            className="phone-desktop-app"
            type="button"
            style={{
              gridColumn: desktopLayout.apps.banking.column,
              gridRow: desktopLayout.apps.banking.row,
            }}
            onPointerDown={(event) => beginDesktopInteraction(event, { kind: 'app', appId: 'banking' })}
            onClick={() => {
              if (suppressAppClickRef.current) {
                suppressAppClickRef.current = false;
                return;
              }
              setScreen('banking');
            }}
            aria-label={unreadBankingCount > 0
              ? `Open Banking, ${unreadBankingCount} new transactions`
              : 'Open Banking'}
          >
            <span className="phone-banking-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9 12 4l9 5" />
                <path d="M4 9h16" />
                <path d="M6 11v7M10 11v7M14 11v7M18 11v7" />
                <path d="M3 20h18" />
              </svg>
            </span>
            {unreadBankingCount > 0 && (
              <span className="phone-desktop-app-badge banking" aria-hidden="true">
                {desktopBadgeLabel(unreadBankingCount)}
              </span>
            )}
            <span>Banking</span>
          </button>
          <button
            className="phone-desktop-app"
            type="button"
            style={{
              gridColumn: desktopLayout.apps.fotogram.column,
              gridRow: desktopLayout.apps.fotogram.row,
            }}
            onPointerDown={(event) => beginDesktopInteraction(event, { kind: 'app', appId: 'fotogram' })}
            onClick={() => {
              if (suppressAppClickRef.current) {
                suppressAppClickRef.current = false;
                return;
              }
              setScreen('fotogram');
            }}
            aria-label="Open Fotogram"
          >
            <span className="phone-fotogram-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.2" cy="6.8" r="1" />
              </svg>
            </span>
            <span>Fotogram</span>
          </button>
          <button
            className="phone-desktop-app"
            type="button"
            style={{
              gridColumn: desktopLayout.apps.onlyfriends.column,
              gridRow: desktopLayout.apps.onlyfriends.row,
            }}
            onPointerDown={(event) => beginDesktopInteraction(event, { kind: 'app', appId: 'onlyfriends' })}
            onClick={() => {
              if (suppressAppClickRef.current) {
                suppressAppClickRef.current = false;
                return;
              }
              setScreen('onlyfriends');
            }}
            aria-label="Open OnlyFriends"
          >
            <span className="phone-onlyfriends-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 13.5c1.2-1.3 1.8-2.7 1.8-3.9A4.1 4.1 0 0 0 12 6.9a4.1 4.1 0 0 0-8.8 2.7c0 1.2.6 2.6 1.8 3.9l7 6.8Z" />
              </svg>
            </span>
            <span>OnlyFriends</span>
          </button>
        </div>
        <div className="phone-desktop-settings" ref={desktopSettingsRef}>
          {desktopSettingsOpen && (
            <div className="phone-desktop-settings-menu" role="menu" aria-label="Desktop settings">
              <span className="phone-desktop-settings-label">Wallpaper</span>
              <div className="phone-desktop-wallpaper-options">
                {defaultPhoneWallpapers.map((wallpaper) => (
                  <button
                    className={`phone-desktop-wallpaper-option${
                      wallpaperImageId === wallpaper.id ? ' active' : ''
                    }`}
                    type="button"
                    key={wallpaper.id}
                    onClick={() => selectWallpaper(wallpaper)}
                    title={`Use ${wallpaper.name}`}
                    aria-label={`Use ${wallpaper.name}`}
                  >
                    <img src={wallpaper.dataUrl} alt={wallpaper.name} />
                  </button>
                ))}
                <button
                  className="phone-desktop-wallpaper-gallery"
                  type="button"
                  onClick={() => {
                    setDesktopSettingsOpen(false);
                    setScreen('gallery');
                  }}
                >
                  Select Image from Gallery
                </button>
              </div>
              <span className="phone-desktop-settings-label">Icon Size</span>
              <div className="phone-desktop-icon-size-options">
                {(['medium', 'large'] as const).map((size) => (
                  <button
                    className={phoneDesktopIconSize === size ? 'active' : ''}
                    type="button"
                    key={size}
                    onClick={() => onPhoneDesktopIconSizeChange(size)}
                  >
                    {size === 'medium' ? 'Medium' : 'Large'}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            className="phone-desktop-settings-button"
            type="button"
            onClick={() => setDesktopSettingsOpen((open) => !open)}
            aria-label="Desktop settings"
            aria-expanded={desktopSettingsOpen}
            title="Desktop settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.98 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.98a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.02a1.7 1.7 0 0 0 1.02-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.02a1.7 1.7 0 0 0 1.56 1.02H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="phone-surface">
      <div className="phone-list" aria-label="Phone chats">
        <div className="phone-list-header">
          <button
            className="phone-home-button"
            type="button"
            onClick={() => setScreen('desktop')}
            aria-label="Back to phone desktop"
            title="Phone desktop"
          >
            ←
          </button>
          <strong>{phoneListTitle}</strong>
          <span>{phoneContacts.length}</span>
        </div>
        <div className="phone-contact-list">
          {phoneContacts.map((contact) => (
            <button
              className={`phone-contact${
                selectedPhoneContact?.character.id === contact.character.id ? ' active' : ''
              }`}
              type="button"
              key={contact.character.id}
              onClick={() => onOpenPhoneContact(contact)}
            >
              <CharacterAvatar
                className="phone-avatar"
                name={contact.character.name}
                fallback={contact.character.name.slice(0, 1).toUpperCase()}
                profileImageDataUrl={contact.character.profileImage?.dataUrl}
                style={{ borderColor: contact.color, color: contact.color }}
              />
              <span className="phone-contact-main">
                <span className="phone-contact-topline">
                  <strong style={{ color: contact.color }}>{contact.character.name}</strong>
                  <small>{contact.time}</small>
                </span>
                <span className="phone-contact-bottomline">
                  <span>{contact.preview}</span>
                  {contact.unreadCount > 0 && (
                    <span className="phone-contact-badge">
                      {contact.unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
          {phoneContacts.length === 0 && (
            <div className="phone-empty">No characters in this RP.</div>
          )}
        </div>
        {unreadPhoneConversations.length > 0 && (
          <div className="phone-unread-switches" aria-label="Phone switches">
            {unreadPhoneConversations.map((conversation) => (
              <button
                type="button"
                className={conversation.unread ? 'unread' : 'idle'}
                key={conversation.key}
                onClick={() => onOpenUnreadPhoneConversation(conversation)}
              >
                <span>Switch to {unreadPhoneSwitchName(conversation)} Phone</span>
                {conversation.unread && (
                  <span className="phone-switch-badge">
                    {conversation.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="phone-chat" aria-label="Phone conversation">
        {selectedPhoneContact ? (
          <>
            <div className="phone-chat-header">
              <CharacterAvatar
                className="phone-avatar large"
                name={selectedPhoneContact.character.name}
                fallback={selectedPhoneContact.character.name.slice(0, 1).toUpperCase()}
                profileImageDataUrl={selectedPhoneContact.character.profileImage?.dataUrl}
                style={{
                  borderColor: selectedPhoneContact.color,
                  color: selectedPhoneContact.color,
                }}
              />
              <div>
                <strong style={{ color: selectedPhoneContact.color }}>
                  {selectedPhoneContact.character.name}
                </strong>
                <span>Last seen Today</span>
              </div>
            </div>
            <div className="phone-thread" ref={phoneThreadRef}>
              {phoneMessageViews.length > 0 ? (
                phoneMessageViews.map((view) => {
                  const { message } = view;
                  const focusHighlighted = highlightedPhoneMessageId === message.id;
                  const repliedToMessage = message.replyToMessageId !== undefined
                    ? selectedPhoneConversation.find((entry) => entry.id === message.replyToMessageId)
                    : undefined;
                  const replySelected = replyToMessage?.id === message.id;
                  const repliedToText = repliedToMessage
                    ? phoneReplyVisibleText(repliedToMessage, englishProcessingEnabled) || 'Image'
                    : '';
                  const fromColor = phoneCharacterColor(view.senderName);
                  const dayLabel = view.dayRpDateTime
                    ? formatRpDayLabel(view.dayRpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
                    : '';
                  return (
                    <Fragment key={`${message.id}-${focusHighlighted ? highlightedPhoneMessagePulseKey : 'idle'}`}>
                      {dayLabel && <div className="rp-day-divider"><span>{dayLabel}</span></div>}
                      <div
                        className={`phone-message-row${replySelected ? ' reply-selected' : ''}${
                          focusHighlighted ? ' phone-focus-highlight' : ''
                        }`}
                        data-phone-message-id={message.id}
                      >
                      {view.showNewDivider && <div className="phone-new-divider"><span>New</span></div>}
                      <div className={`phone-message-content ${view.outgoing ? 'outgoing' : 'incoming'}`}>
                        <div
                          className={`phone-bubble ${view.outgoing ? 'outgoing' : 'incoming'}`}
                          style={{ fontSize: phoneChatTextSize || defaultPhoneChatTextSize }}
                        >
                          <span
                            className="phone-bubble-sender"
                            style={fromColor ? { color: fromColor } : undefined}
                          >
                            {view.senderName}
                            {phoneAuthorBadgesEnabled && (
                              <span className={`phone-author-badge ${message.role === 'user' ? 'user' : 'ai'}`}>
                                {message.role === 'user' ? 'USER' : 'AI'}
                              </span>
                            )}
                          </span>
                          {repliedToMessage && (
                            <div className={`phone-bubble-reply-context${phoneReplySizeClass(repliedToText)}`}>
                              {!!repliedToMessage.imageAttachments?.length && (
                                <img
                                  src={repliedToMessage.imageAttachments[0]?.dataUrl}
                                  alt={repliedToMessage.imageAttachments[0]?.name ?? 'Replied image'}
                                  onLoad={() => onScrollPhoneThreadToBottom('auto')}
                                />
                              )}
                              <div className="phone-bubble-reply-copy">
                                <strong>
                                  Reply to {repliedToMessage.phoneFrom || repliedToMessage.speakerName || 'Unknown'}
                                </strong>
                                <span>{repliedToText}</span>
                              </div>
                            </div>
                          )}
                          {!!message.imageAttachments?.length && (
                            <div className="phone-bubble-images">
                              {message.imageAttachments.map((image) => (
                                <div className="phone-bubble-image" key={image.id}>
                                  <button
                                    className="phone-bubble-image-preview"
                                    type="button"
                                    onClick={() => onPreviewImage(image)}
                                  >
                                    <img
                                      src={image.dataUrl}
                                      alt={image.name}
                                      onLoad={() => onScrollPhoneThreadToBottom('auto')}
                                    />
                                  </button>
                                  <ImageContextControl
                                    image={image}
                                    inContext={isImageInContext(image)}
                                    manuallySelected={isImageManuallySelected(image)}
                                    disabled={isRunning}
                                    contextEnabled={referenceImageContextEnabled}
                                    contextDisabledReason={referenceImageContextDisabledReason}
                                    onToggle={onToggleReferenceImage}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          {view.visibleText && (
                            message.phoneVoiceMessage && voiceMessageSpeakerNames.has(view.senderName) ? (
                              <PhoneVoiceMessage
                                text={view.visibleText}
                                clipDataUrl={phoneVoiceClipDataUrl(message, view.senderName, view.visibleText)}
                                disabled={isRunning}
                                disabledReason="Voice messages are unavailable while the chat is running."
                                onGenerateClip={() =>
                                  onGenerateVoiceMessageClip({
                                    messageId: message.id,
                                    speakerName: view.senderName,
                                    text: view.visibleText,
                                  })
                                }
                              />
                            ) : (
                              <span>{view.visibleText}</span>
                            )
                          )}
                          {message.phoneImageCaptionChange && (
                            <button
                              className="caption-change-chip"
                              type="button"
                              onClick={() => onPreviewImageCaptionChange(message.phoneImageCaptionChange!)}
                            >
                              Image Caption Updated
                            </button>
                          )}
                          {message.rpDateTime && (
                            <span className="phone-bubble-time">
                              {(() => {
                                const parts = formatRpDateTimeParts(
                                  message.rpDateTime,
                                  rpDateTimeFormat,
                                  rpWeekdayLanguage,
                                );
                                return parts
                                  ? (
                                      <>
                                        <span className="rp-time-date">{parts.date}</span>
                                        {'   '}
                                        <span className="rp-time-clock">{parts.time}</span>
                                      </>
                                    )
                                  : message.rpDateTime;
                              })()}
                            </span>
                          )}
                        </div>
                        {!inputLocked && message.replyToMessageId === undefined && (
                          <button
                            className="phone-reply-action"
                            type="button"
                            onClick={() => onReplyToMessage(message)}
                            aria-label={`Reply to ${view.senderName}`}
                            title="Reply to message"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="9 17 4 12 9 7" />
                              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                            </svg>
                          </button>
                        )}
                      </div>
                      </div>
                    </Fragment>
                  );
                })
              ) : null}
            </div>
            <div className={`phone-input-zone${inputLocked ? ' locked' : ''}`}>
              {replyToMessage && (
                <div
                  className={`phone-reply-preview${phoneReplySizeClass(selectedReplyText)}`}
                  aria-label="Replying to message"
                >
                  {!!replyToMessage.imageAttachments?.length && (
                    <img
                      src={replyToMessage.imageAttachments[0]?.dataUrl}
                      alt={replyToMessage.imageAttachments[0]?.name ?? 'Replied image'}
                      onLoad={() => onScrollPhoneThreadToBottom('auto')}
                    />
                  )}
                  <div className="phone-reply-preview-copy">
                    <strong>
                      Replying to {replyToMessage.phoneFrom || replyToMessage.speakerName || 'Unknown'}
                    </strong>
                    <span>
                      {selectedReplyText}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onCancelPhoneReply}
                    aria-label="Cancel reply"
                    title="Cancel reply"
                    className="phone-cancel-reply-button"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
              {!!phoneImages.length && (
                <div className="phone-attachment-tray" aria-label="Selected phone images">
                  {phoneImages.map((image) => (
                    <div
                      className={`phone-attachment${
                        image.width && image.height && image.height > image.width
                          ? ' portrait'
                          : ''
                      }`}
                      key={image.id}
                    >
                      <button
                        className="phone-image-preview"
                        type="button"
                        onClick={() => onPreviewImage(image)}
                      >
                        <img src={image.dataUrl} alt={image.name} />
                      </button>
                      <button
                        className="phone-image-remove"
                        type="button"
                        onClick={() => onRemovePhoneImage(image.id)}
                        title={`Remove ${image.name}`}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!!selectedCharacter && !!phoneDraft.trim() ? (
                <div className="phone-typing">
                  <strong style={{ color: characterColors.get(selectedCharacter.name) }}>
                    {selectedCharacter.name}
                  </strong>
                  <span>typing...</span>
                  <CommandPillList
                    className="phone-command-pill-list"
                    commands={phoneDraftCommands}
                    onCommandsChange={onPhoneDraftCommandsChange}
                    onRequestMessageFocus={() => commandComposerRef.current?.focusMessage()}
                  />
                </div>
              ) : phoneDraftCommands.length > 0 ? (
                <div className="phone-active-commands-row">
                  <CommandPillList
                    className="phone-command-pill-list"
                    commands={phoneDraftCommands}
                    onCommandsChange={onPhoneDraftCommandsChange}
                    onRequestMessageFocus={() => commandComposerRef.current?.focusMessage()}
                  />
                </div>
              ) : null}
              <form className="phone-composer" onSubmit={onSubmitPhoneMessage}>
                <CommandPillComposer
                  ref={commandComposerRef}
                  value={phoneDraft}
                  commands={phoneDraftCommands}
                  commandsEnabled={rpTimeTrackingEnabled}
                  disabled={inputLocked}
                  onValueChange={onPhoneDraftChange}
                  onCommandsChange={onPhoneDraftCommandsChange}
                  onSubmit={onSubmitPhoneMessage}
                  placeholder="Write message"
                  rows={4}
                />
                <div className="phone-composer-actions">
                  <button className="phone-send-button" type="submit" disabled={!canSend}>
                    {isRunning ? 'Cancel' : 'Send'}
                  </button>
                  <div className="phone-secondary-actions">
                    <div className="phone-emoji-menu" ref={phoneEmojiPickerRef}>
                      <button
                        className="phone-emoji-button"
                        type="button"
                        onClick={onTogglePhoneEmojiPicker}
                        aria-label="Open phone emoji picker"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                          <line x1="9" y1="9" x2="9.01" y2="9" />
                          <line x1="15" y1="9" x2="15.01" y2="9" />
                        </svg>
                      </button>
                      {showPhoneEmojiPicker && (
                        <div className="phone-emoji-picker">
                          {recentlyUsedEmojis.length > 0 && (
                            <div className="phone-emoji-recent-row">
                              <div className="phone-emoji-recent-label">RECENT</div>
                              <div className="phone-emoji-recent-list">
                                {recentlyUsedEmojis.map((emoji) => (
                                  <button
                                    type="button"
                                    key={`recent-${emoji}`}
                                    onClick={() => onSelectPhoneEmoji(emoji)}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="phone-emoji-all-grid">
                            {phoneEmojiOptions.map((emoji) => (
                              <button
                                type="button"
                                key={emoji}
                                onClick={() => onSelectPhoneEmoji(emoji)}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <PhoneImagePicker
                      uploadDisabled={!imageUploadEnabled}
                      uploadDisabledReason={imageUploadDisabledReason}
                      onOpenGallery={() => setScreen('chat-gallery')}
                      onUploadFromComputer={onSelectPhoneImages}
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
                      preferredSaveCharacterId={selectedCharacter?.id}
                      onSubmitImageAssistantMessage={onSubmitImageAssistantMessage}
                      onGenerateImageAssistantImages={onGenerateImageAssistantImages}
                      onSaveImageAssistantImage={onSaveImageAssistantImage}
                      imageAssistantModelStateById={imageAssistantModelStateById}
                      onSetImageAssistantLlmModelLoaded={onSetImageAssistantLlmModelLoaded}
                      onUnloadImageAssistantComfyModel={onUnloadImageAssistantComfyModel}
                      onRefreshImageAssistantModelState={onRefreshImageAssistantModelState}
                    />
                  </div>
                </div>
                <input
                  ref={phoneImageInputRef}
                  className="phone-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={!imageUploadEnabled}
                  onChange={(event) => {
                    onAddPhoneImages(event.target.files);
                    event.target.value = '';
                  }}
                />
              </form>
              {inputLocked && (
                <div className="phone-input-locked-overlay" aria-live="polite">
                  <div>
                    {!!selectedCharacter && selectedCharacterPlayable && (
                      <button type="button" onClick={onSwitchToViewedCharacter}>
                        Switch to {selectedCharacter.name}
                      </button>
                    )}
                    <span>
                      Use AutoTurn to let the LLM decide what happens next.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="phone-chat-empty">No chat selected.</div>
        )}
      </div>
    </div>
  );
}
