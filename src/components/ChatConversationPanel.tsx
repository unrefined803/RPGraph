import { MatchMeActivityCard } from './MatchMeActivityCard';
import { groupMatchMeHistory, type MatchMeHistoryRow } from '../chat/matchMe';
import type { UserQuestion } from '../app/userQuestion';
import { measureUiWork, countChatRowRender } from '../diagnostics/uiPerformance';
import { createRowTimelineSelector } from '../chat/rowTimeline';
import { gradientPhaseStyle } from '../chat/gradientPhase';
import { isNpcCharacterColor } from '../chat/characterColors';
import { ChatBubbleText } from './ChatBubbleText';
import { CharacterName } from './CharacterName';
import { EmojiText } from './EmojiText';
import { accountHandleMatches } from '../characters/character';
import { datingAccountMatches, datingAvatarDataUrl } from '../chat/datingAccounts';
import { CharacterAvatar } from './CharacterAvatar';
import { phoneCharacterAvatarDataUrl, whatsUpAliasAvatarDataUrl } from '../chat/phoneCharacters';
import { whatsUpAliasOwner } from '../characters/messageIdentity';
import { phoneNamesMatch } from '../chat/phoneMessages';
import { createStableDerivedValueSelector } from '../chat/stableDerivedValue';
import type { MessageStream } from '../chat/messageStream';
import { isAccountPrivacyMode, socialAccountPresentation, socialDirectMessageCharacter, socialDirectMessageDisplayText, socialDirectMessageParty } from '../chat/socialMedia';
import { socialTimelineGroups, socialTimelineMessageText } from '../chat/socialTimeline';
import { AccountLinkText } from './AccountLinkText';
import {
  Fragment,
  memo,
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  coloredDialogueParts,
  dialogueColors,
  quotedSpeechParts,
  thoughtParts,
  thoughtStyleClass,
} from '../chat/textRendering';
import { dialogueSpeechText } from '../chat/dialogueVoiceSegments';
import { VoicePlaybackDialog } from '../chat/VoicePlaybackDialog';
import type { StorybookCharacter } from '../storybook/runtime';
import type {
  ChatDialogueQuote,
  ChatImageAttachment,
  DialogueVoiceMode,
  ImageCaptionChange,
  InputActionSelection,
  MessageRecord,
  EmbeddedPhoneMessageLink,
  EmbeddedSocialMessageLink,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  SocialDirectMessageRecord,
  SocialPostRecord,
} from '../types';
import {
  defaultChatTextSize,
  defaultThoughtTextStyle,
} from '../settings';
import { phoneReplyVisibleText } from '../chat/phoneReplies';
import {
  formatRpDateTimeParts,
  formatRpDayLabel,
  stripRecognizedSpeakerLabels,
} from '../workflow';
import {
  directPhoneTimelineEntries,
  messageEffectiveRpDateTime,
  phoneMessageVisibleText,
  phoneMessageRpDateTime,
  phoneMessagesById as selectPhoneMessagesById,
  visibleMessageRecords,
} from '../data-management/selectors';
import { ImageContextControl } from './ImageContextControl';
import {
  CommandPillComposer,
  CommandPillList,
  type CommandPillComposerHandle,
} from './CommandPillComposer';
import { PhoneVoiceMessage } from './PhoneVoiceMessage';
import { BankTransferCard } from './BankTransferCard';
import { SocialPostCard } from './SocialPostCard';
import { CreatedPhoneNoteCard } from './CreatedPhoneNoteCard';
import { SimulatedAiChatCard } from './SimulatedAiChatCard';
import type { CommandInputCommand } from '../chat/structuredCommands';

function chatReadingColor(brightness: number) {
  const value = Math.min(100, Math.max(0, brightness));
  const base = [213, 217, 230];
  const dark = [180, 185, 198];
  const target = [255, 255, 255];
  const start = value < 70 ? dark : base;
  const end = value < 70 ? base : target;
  const progress = value < 70 ? value / 70 : (value - 70) / 30;
  return `rgb(${start.map((channel, index) => Math.round(channel + (end[index] - channel) * progress)).join(', ')})`;
}
import {
  socialAppNames,
  socialCharacterForPost,
  socialMessageHiddenFromChat,
  socialPostEngagementByPostId,
} from '../chat/socialMedia';
import {
  createdPhoneNoteHistoryText,
  deletedPhoneNoteHistoryText,
  simulatedAiChatHistoryText,
} from '../chat/phoneAppsSessions';
import { AutoplayControl } from '../chat/AutoplayControl';
import type { AutoplayMode } from '../chat/useAutoplay';
import { useStableEventHandlers } from '../app/useStableEventHandlers';
import type { RunProgress } from '../chat/runProgress';
import { RunProgressCard } from '../chat/RunProgressCard';

const outsidePhoneDisplayModeStorageKey = 'rpgraph-chat-phone-display-mode';
const composerAutoCollapseStorageKey = 'rpgraph-chat-composer-auto-collapse-enabled';

function isStandaloneEmbeddedPhoneOutput(message: MessageRecord) {
  const hasNonPhoneText = [
    message.originalText,
    message.translatedText,
    message.embeddedPhoneTextBefore,
    message.embeddedPhoneTextAfter,
    message.embeddedPhoneTranslatedTextBefore,
    message.embeddedPhoneTranslatedTextAfter,
  ].some((text) => text?.trim());
  const hasOtherVisibleContent =
    !!message.imageAttachments?.length ||
    !!message.outputActionChoices?.length ||
    !!message.outputActionInfoBoxes?.length ||
    !!message.outputActionProgressBars?.length ||
    !!message.outputActionContextCapacityBars?.length ||
    !!message.bankTransfer ||
    !!message.socialPost ||
    !!message.socialThreadAction ||
    !!message.socialReactions ||
    !!message.socialDirectMessage ||
    !!message.createdPhoneNote ||
    !!message.deletedPhoneNote ||
    !!message.simulatedAiChat;

  return (
    message.role === 'output' &&
    !!message.embeddedPhoneMessages?.length &&
    !hasNonPhoneText &&
    !hasOtherVisibleContent
  );
}

type EmbeddedMessengerGroup =
  | { kind: 'phone'; phoneMessages: EmbeddedPhoneMessageLink[] }
  | { kind: 'social'; socialMessages: EmbeddedSocialMessageLink[] };

// Interleaves the phone and social bubble stacks back into the order the
// messenger objects appeared in the RP output. Messages without a stored
// sourceOrder (older sessions) keep the legacy phone-then-social order.
function embeddedMessengerGroups(message: MessageRecord): EmbeddedMessengerGroup[] {
  const entries = [
    ...(message.embeddedPhoneMessages ?? []).map((link) => ({
      kind: 'phone' as const,
      order: link.sourceOrder,
      link,
    })),
    ...(message.embeddedSocialMessages ?? []).map((link) => ({
      kind: 'social' as const,
      order: link.sourceOrder,
      link,
    })),
  ];
  if (entries.every((entry) => entry.order !== undefined)) {
    entries.sort((a, b) => a.order! - b.order!);
  }
  const groups: EmbeddedMessengerGroup[] = [];
  for (const entry of entries) {
    const current = groups[groups.length - 1];
    if (entry.kind === 'phone') {
      if (current?.kind === 'phone') {
        current.phoneMessages.push(entry.link);
      } else {
        groups.push({ kind: 'phone', phoneMessages: [entry.link] });
      }
    } else if (current?.kind === 'social') {
      current.socialMessages.push(entry.link);
    } else {
      groups.push({ kind: 'social', socialMessages: [entry.link] });
    }
  }
  return groups;
}

function phoneReplySizeClass(text: string) {
  if (text.length > 120) {
    return ' long';
  }
  return text.length > 60 ? ' medium' : '';
}

function rpTimePlaceholderParts(format: RpDateTimeFormat) {
  if (format === 'iso') {
    return { date: '0000-00-00 WWW', time: '00:00' };
  }
  if (format === 'us') {
    return { date: '00/00/00 WWW', time: '00:00 AM' };
  }
  return { date: '00.00.00 WWW', time: '00:00' };
}

// Share the empty fallback so unrelated row updates do not invalidate text parsing.
const emptyDialogue: ChatDialogueQuote[] = [];

type DialogueTextProps = {
  text: string;
  keyPrefix: string;
  messageId: number;
  dialogue: ChatDialogueQuote[];
  llmDialogueHighlightActive: boolean;
  speakerColors: Record<string, string> | undefined;
  characterColors: Map<string, string>;
  dialogueVoiceSpeakerNames: ReadonlySet<string>;
  activeDialogueVoiceKey: string | null;
  onSpeakDialogue: (request: { key: string; messageId: number; speakerName: string; text: string }) => void;
  chatColorIntensity: number;
  thoughtTextStyle: 'bold' | 'italic' | 'light';
  accountLinks: MessageRecord['accountLinks'];
};

/** Re-runs the dialogue-color/quoted-speech/thought-part text parsing (and its
 * spans) only when this message's own text/dialogue or the shared display
 * settings change — not on every render of the panel, e.g. every streamed
 * chunk of an unrelated (or this same) message elsewhere in the history. */
const DialogueText = memo(function DialogueText({
  text, keyPrefix, messageId, dialogue, llmDialogueHighlightActive, speakerColors,
  characterColors, dialogueVoiceSpeakerNames, activeDialogueVoiceKey, onSpeakDialogue,
  chatColorIntensity, thoughtTextStyle, accountLinks,
}: DialogueTextProps) {
  const textParts = useMemo(
    () => llmDialogueHighlightActive && dialogue.length > 0
      ? coloredDialogueParts(text, dialogue)
      : quotedSpeechParts(text),
    [text, dialogue, llmDialogueHighlightActive],
  );
  return (
    <>
      {textParts.map((part, index) => {
        const partSpeakerName = 'speakerName' in part ? part.speakerName : undefined;
        const speechColor = partSpeakerName
          ? characterColors.get(partSpeakerName) ??
            speakerColors?.[partSpeakerName] ??
            dialogueColors[0]
          : undefined;
        const pendingSpeech = !speechColor && 'isSpeech' in part && part.isSpeech;
        const voiceKey =
          partSpeakerName && dialogueVoiceSpeakerNames.has(partSpeakerName)
            ? `${messageId}:${keyPrefix}:${index}`
            : undefined;
        const voiceActive = !!voiceKey && voiceKey === activeDialogueVoiceKey;
        const className = [
          speechColor ? 'dialogue-highlight' : pendingSpeech ? 'dialogue-highlight pending' : '',
          voiceKey ? 'dialogue-voice' : '',
          voiceActive ? 'dialogue-voice-active' : '',
        ].filter(Boolean).join(' ');
        return (
          <span
            key={`${keyPrefix}:${index}`}
            className={className || undefined}
            style={speechColor ? {
              color: chatColorIntensity === 100
                ? speechColor
                : `oklch(from ${speechColor} calc(l * ${0.98 + chatColorIntensity * 0.0002}) calc(c * ${0.75 + chatColorIntensity * 0.0025}) h)`,
            } : undefined}
            title={
              voiceKey
                ? voiceActive
                  ? 'Stop voice playback'
                  : `Speak with the voice of ${partSpeakerName}`
                : undefined
            }
            onClick={
              voiceKey && partSpeakerName
                ? () => onSpeakDialogue({ key: voiceKey, messageId, speakerName: partSpeakerName, text: part.text })
                : undefined
            }
          >
            <span style={gradientPhaseStyle(part.text)} className={
              speechColor && partSpeakerName && characterColors.has(partSpeakerName) && !isNpcCharacterColor(speechColor)
                ? 'dialogue-text-gradient'
                : !speechColor && !pendingSpeech
                  ? 'dialogue-text-gradient narration-text-gradient'
                  : undefined
            }>
              {thoughtParts(part.text).map((thoughtPart, thoughtIndex) => (
                <span
                  className={
                    thoughtPart.isThought
                      ? thoughtStyleClass(thoughtTextStyle || defaultThoughtTextStyle)
                      : undefined
                  }
                  key={thoughtIndex}
                >
                  <AccountLinkText text={thoughtPart.text} bindings={accountLinks} />
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </>
  );
});

type OutsidePhoneDisplayMode = 'collapse' | 'show' | 'hide' | 'bubbles';
type PhoneTimelineEntry = {
  phoneMessage: EmbeddedPhoneMessageLink;
  badges: string[];
  className: string;
  ariaLabel: string;
};
type PhoneTimelineGroup = {
  messageIds: number[];
  entries: PhoneTimelineEntry[];
};

function badgeClassName(badge: string) {
  return `entry-channel-badge badge-${badge.toLocaleLowerCase()}`;
}

type MessageRowProps = {
  chatMessageAvatarsEnabled: boolean;
  socialMessageRpDateTimeById: Map<number, string>;
  message: MatchMeHistoryRow;
  previousDay: string | undefined;
  englishProcessingEnabled: boolean;
  appCharacters: StorybookCharacter[];
  showProfileNames: boolean;
  characterColors: Map<string, string>;
  dialogueHighlightEnabled: boolean;
  dialogueVoiceSpeakerNames: ReadonlySet<string>;
  activeDialogueVoiceKey: string | null;
  onSpeakDialogue: (request: { key: string; messageId: number; speakerName: string; text: string }) => void;
  onGenerateVoiceMessageClip: (request: { messageId: number; speakerName: string; text: string }) => Promise<string | null>;
  chatColorIntensity: number;
  thoughtTextStyle: 'bold' | 'italic' | 'light';
  chatTextSize: number;
  phoneAuthorBadgesEnabled: boolean;
  phoneLinksEnabled?: boolean;
  rpTimeTrackingEnabled: boolean;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  editingMessageId: number | null;
  editableUserMessageId: number | undefined;
  editingDraft: string;
  isRunning: boolean;
  contextualReferenceImageIds: ReadonlySet<string>;
  selectedReferenceImageIds: ReadonlySet<string>;
  referenceImageContextEnabled: boolean;
  referenceImageContextDisabledReason: string | undefined;
  onBeginEditMessage: (message: MessageRecord, visibleText: string) => void;
  onCancelEditMessage: () => void;
  onRegenerateEditedMessage: () => void;
  onEditingDraftChange: (value: string) => void;
  onPreviewImage: (image: ChatImageAttachment) => void;
  onToggleReferenceImage: (image: ChatImageAttachment) => void;
  onPreviewImageCaptionChange: (change: ImageCaptionChange) => void;
  onOpenEmbeddedPhoneMessage: (message: EmbeddedPhoneMessageLink) => void;
  onOpenEmbeddedSocialMessage: (message: EmbeddedSocialMessageLink) => void;
  onOpenSocialPost: (post: SocialPostRecord) => void;
  socialImageById: (imageId: string, ownerId?: string) => ChatImageAttachment | undefined;
  onOutputActionChoice: (selection: InputActionSelection) => void;
  onMessageContentLoaded: () => void;
  phoneMessagesById: Map<number, MessageRecord>;
  socialMessagesById: Map<number, SocialDirectMessageRecord>;
  socialTimeline: { groups: Map<number, EmbeddedSocialMessageLink[]>; skippedIds: Set<number> };
  phoneTimelineGroupsByFirstMessageId: Map<number, PhoneTimelineGroup>;
  skippedPhoneTimelineMessageIds: Set<number>;
  outsidePhoneDisplayMode: OutsidePhoneDisplayMode;
  expandedPhoneGroups: Record<string, boolean>;
  setExpandedPhoneGroups: Dispatch<SetStateAction<Record<string, boolean>>>;
  socialEngagementByApp: {
    fotogram: ReturnType<typeof socialPostEngagementByPostId>;
    onlyfriends: ReturnType<typeof socialPostEngagementByPostId>;
  };
};

/** Re-runs the full per-message render body (dialogue/phone/social bubble
 * assembly, output-action UI, timeline grouping, etc.) only when this
 * message's own data or the shared display/handler props change — not on
 * every render of the panel, e.g. every streamed chunk of live LLM output
 * touching a different message elsewhere in the history. */
const MessageRow = memo(function MessageRow(props: MessageRowProps) {
  const [diagnosticIdentity] = useState(() => ({}));
  countChatRowRender(props.message.id, props, diagnosticIdentity);
  const {
    message, previousDay, englishProcessingEnabled, appCharacters, showProfileNames,
    chatMessageAvatarsEnabled, socialMessageRpDateTimeById,
    characterColors, dialogueHighlightEnabled, dialogueVoiceSpeakerNames, activeDialogueVoiceKey,
    onSpeakDialogue, onGenerateVoiceMessageClip, chatColorIntensity, thoughtTextStyle, chatTextSize,
    phoneAuthorBadgesEnabled, phoneLinksEnabled = true, rpTimeTrackingEnabled, rpDateTimeFormat, rpWeekdayLanguage,
    editingMessageId, editableUserMessageId, editingDraft, isRunning, contextualReferenceImageIds,
    selectedReferenceImageIds, referenceImageContextEnabled, referenceImageContextDisabledReason,
    onBeginEditMessage, onCancelEditMessage, onRegenerateEditedMessage, onEditingDraftChange,
    onPreviewImage, onToggleReferenceImage, onPreviewImageCaptionChange, onOpenEmbeddedPhoneMessage,
    onOpenEmbeddedSocialMessage, onOpenSocialPost, socialImageById, onOutputActionChoice,
    onMessageContentLoaded, phoneMessagesById, socialMessagesById, socialTimeline,
    phoneTimelineGroupsByFirstMessageId, skippedPhoneTimelineMessageIds,
    outsidePhoneDisplayMode, expandedPhoneGroups, setExpandedPhoneGroups,
    socialEngagementByApp,
  } = props;
  if (skippedPhoneTimelineMessageIds.has(message.id) || socialTimeline.skippedIds.has(message.id)) {
    return null;
  }
  const isImageInContext = (image: ChatImageAttachment) =>
    !!image.id.trim() && contextualReferenceImageIds.has(image.id.trim());
  const isImageManuallySelected = (image: ChatImageAttachment) =>
    !!image.id.trim() && selectedReferenceImageIds.has(image.id.trim());
  const displayText = message.eventInput && message.eventDisplayText
    ? message.eventDisplayText
    : socialDirectMessageDisplayText(message, englishProcessingEnabled, appCharacters);
  const speakerNames =
    message.role === 'error'
      ? ['Error']
      : message.speakerNames?.length
        ? message.speakerNames
        : message.role === 'user'
          ? [message.speakerName ?? 'Character']
          : [];
  const hasOutputActionUi =
    !!message.outputActionChoices?.length ||
    !!message.outputActionInfoBoxes?.length ||
    !!message.outputActionProgressBars?.length ||
    !!message.outputActionContextCapacityBars?.length;
  const reserveSpeakerLabels =
    message.role === 'output' && !hasOutputActionUi && !message.deletedPhoneNote;
  const speakerLabelNames = speakerNames.length > 0
    ? speakerNames
    : reserveSpeakerLabels
      ? ['Character']
      : [];
  const speakerLabelsPlaceholder = speakerNames.length === 0 && reserveSpeakerLabels;
  const visibleText =
    message.role === 'error'
      ? displayText
      : stripRecognizedSpeakerLabels(displayText, speakerNames);
  const phoneAppCommandHistoryText = [
    message.createdPhoneNote
      ? createdPhoneNoteHistoryText(message.createdPhoneNote)
      : '',
    message.deletedPhoneNote
      ? deletedPhoneNoteHistoryText(message.deletedPhoneNote)
      : '',
    message.simulatedAiChat
      ? simulatedAiChatHistoryText(message.simulatedAiChat)
      : '',
  ].filter(Boolean).join('\n\n');
  const phoneAppCommandCardOnly =
    !!phoneAppCommandHistoryText &&
    visibleText.trim() === phoneAppCommandHistoryText.trim();
  const dialogue = englishProcessingEnabled
    ? message.translatedDialogue ?? emptyDialogue
    : message.originalDialogue ?? emptyDialogue;
  const llmDialogueHighlightActive =
    (message.role === 'output' || message.role === 'user') &&
    dialogueHighlightEnabled;
  const compositeTextBefore = (() => {
    const hasCompositeText =
      message.embeddedPhoneTextBefore !== undefined ||
      message.embeddedPhoneTextAfter !== undefined ||
      message.embeddedPhoneTranslatedTextBefore !== undefined ||
      message.embeddedPhoneTranslatedTextAfter !== undefined;
    if (!englishProcessingEnabled) {
      return message.embeddedPhoneTextBefore ?? (!hasCompositeText ? message.originalText : undefined);
    }
    if (message.embeddedPhoneTranslatedTextBefore) {
      return message.embeddedPhoneTranslatedTextBefore;
    }
    if (!hasCompositeText) {
      return message.translatedText ?? message.originalText;
    }
    return message.translatedText && !message.embeddedPhoneTranslatedTextAfter
      ? message.translatedText
      : message.embeddedPhoneTextBefore;
  })();
  const compositeTextAfter = (() => {
    const hasCompositeText =
      message.embeddedPhoneTextBefore !== undefined ||
      message.embeddedPhoneTextAfter !== undefined ||
      message.embeddedPhoneTranslatedTextBefore !== undefined ||
      message.embeddedPhoneTranslatedTextAfter !== undefined;
    if (!englishProcessingEnabled) {
      return message.embeddedPhoneTextAfter ?? (!hasCompositeText ? '' : undefined);
    }
    if (message.embeddedPhoneTranslatedTextAfter) {
      return message.embeddedPhoneTranslatedTextAfter;
    }
    if (!hasCompositeText) {
      return '';
    }
    return message.translatedText && !message.embeddedPhoneTranslatedTextBefore
      ? ''
      : message.embeddedPhoneTextAfter;
  })();
  const isEditingMessage = editingMessageId === message.id;
  const canEditMessage = message.id === editableUserMessageId && !isRunning;
  const effectiveMessageRpDateTime = messageEffectiveRpDateTime(message, phoneMessagesById);
  const messageDay = effectiveMessageRpDateTime?.slice(0, 10);
  const dayLabel =
    rpTimeTrackingEnabled && effectiveMessageRpDateTime && messageDay !== previousDay
      ? formatRpDayLabel(effectiveMessageRpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
      : '';
  // Empty workflow outputs must not occupy a timeline slot between cards.
  if (
    message.role === 'output' && !isEditingMessage && !visibleText.trim() &&
    !compositeTextBefore?.trim() && !compositeTextAfter?.trim() &&
    !message.embeddedPhoneMessages?.length && !message.embeddedSocialMessages?.length &&
    !message.imageAttachments?.length && !hasOutputActionUi &&
    !message.bankTransfer && !message.socialPost && !message.socialDirectMessage &&
    !message.createdPhoneNote && !message.deletedPhoneNote && !message.simulatedAiChat
  ) {
    return dayLabel
      ? <div className="rp-day-divider chat-day-divider" key={message.id}><span>{dayLabel}</span></div>
      : null;
  }
  const renderDialogueTextParts = (text: string, keyPrefix: string) => (
    <DialogueText
      text={text}
      keyPrefix={keyPrefix}
      messageId={message.id}
      dialogue={dialogue}
      llmDialogueHighlightActive={llmDialogueHighlightActive}
      speakerColors={message.speakerColors}
      characterColors={characterColors}
      dialogueVoiceSpeakerNames={dialogueVoiceSpeakerNames}
      activeDialogueVoiceKey={activeDialogueVoiceKey}
      onSpeakDialogue={onSpeakDialogue}
      chatColorIntensity={chatColorIntensity}
      thoughtTextStyle={thoughtTextStyle}
      accountLinks={message.accountLinks}
    />
  );
  const phoneMessageTimeParts = (phoneMessageId: number) => {
    const rpDateTime = phoneMessageRpDateTime(phoneMessageId, phoneMessagesById);
    return rpDateTime
      ? formatRpDateTimeParts(
          rpDateTime,
          rpDateTimeFormat,
          rpWeekdayLanguage,
        )
      : undefined;
  };
  const renderRpTime = (
    rpDateTime: string | undefined,
    className: 'message-rp-time' | 'phone-bubble-time',
  ) => {
    const parts = rpDateTime
      ? formatRpDateTimeParts(rpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
      : undefined;
    const displayParts = parts ?? rpTimePlaceholderParts(rpDateTimeFormat);
    return (
      <span className={`${className}${parts ? ' is-visible' : ' is-placeholder'}`}>
        <span className="rp-time-date">{displayParts.date}</span>
        {'   '}
        <span className="rp-time-clock">{displayParts.time}</span>
      </span>
    );
  };
  const renderPhoneRpTime = (phoneMessageId: number) => {
    const rpDateTime = phoneMessageRpDateTime(phoneMessageId, phoneMessagesById);
    return renderRpTime(rpDateTime, 'phone-bubble-time');
  };
  const phoneVoiceClipDataUrl = (message: MessageRecord, speakerName: string, text: string) => {
    const speechText = dialogueSpeechText(text);
    return message.voiceClips?.find((clip) =>
      clip.source === 'phone' &&
      clip.speakerName === speakerName &&
      clip.text === speechText &&
      !!clip.dataUrl
    )?.dataUrl;
  };
  const renderPhoneActionContent = (phoneMessage: EmbeddedPhoneMessageLink) => (
    <>
      <span>[WhatsUp]</span>
      <strong><CharacterName color={characterColors.get(phoneMessage.from)}>{phoneMessage.from}</CharacterName></strong>
      {phoneAuthorBadgesEnabled && (
        <span
          className={`phone-author-badge ${
            phoneMessagesById.get(phoneMessage.phoneMessageId)?.role === 'user' ? 'user' : 'ai'
          }`}
        >
          {phoneMessagesById.get(phoneMessage.phoneMessageId)?.role === 'user' ? 'USER' : 'AI'}
        </span>
      )}
      <span>sent message to</span>
      <strong><CharacterName color={characterColors.get(phoneMessage.to)}>{phoneMessage.to}</CharacterName></strong>
    </>
  );
  const renderPhoneActionButton = (phoneMessage: EmbeddedPhoneMessageLink) => {
    const timeParts = phoneMessageTimeParts(phoneMessage.phoneMessageId);
    const linkedMessage = phoneMessagesById.get(phoneMessage.phoneMessageId);
    const title = englishProcessingEnabled
      ? linkedMessage?.translatedText ?? phoneMessage.translatedMessage ?? phoneMessage.message
      : phoneMessage.message;
    return (
      <button
        className={`embedded-phone-link${phoneLinksEnabled ? '' : ' static'}`}
        type="button"
        key={phoneMessage.phoneMessageId}
        tabIndex={phoneLinksEnabled ? undefined : -1}
        onClick={phoneLinksEnabled ? () => onOpenEmbeddedPhoneMessage(phoneMessage) : undefined}
        title={title}
      >
        {renderPhoneActionContent(phoneMessage)}
        {timeParts && (
          <span className="embedded-phone-link-time">
            {timeParts.date}
            {'   '}
            {timeParts.time}
          </span>
        )}
      </button>
    );
  };
  const renderPhoneTimelineRow = (
    phoneMessage: EmbeddedPhoneMessageLink,
    badges: string[],
    className: string,
    ariaLabel: string,
  ) => {
    const timelineTimeParts = phoneMessageTimeParts(phoneMessage.phoneMessageId);
    const linkedMessage = phoneMessagesById.get(phoneMessage.phoneMessageId);
    const title = englishProcessingEnabled
      ? linkedMessage?.translatedText ?? phoneMessage.translatedMessage ?? phoneMessage.message
      : phoneMessage.message;
    return (
      <button
        className={`message-timeline-row phone ${className}${phoneLinksEnabled ? '' : ' static'}`}
        style={{ fontSize: chatTextSize || defaultChatTextSize }}
        type="button"
        key={phoneMessage.phoneMessageId}
        tabIndex={phoneLinksEnabled ? undefined : -1}
        onClick={phoneLinksEnabled ? () => onOpenEmbeddedPhoneMessage(phoneMessage) : undefined}
        title={title}
        aria-label={ariaLabel}
      >
        {badges.map((badge) => (
          <span className={badgeClassName(badge)} key={badge}>{badge}</span>
        ))}
        <span className="embedded-phone-link timeline-phone-action">
          {renderPhoneActionContent(phoneMessage)}
        </span>
        {timelineTimeParts && (
          <span className="message-timeline-time">
            <span>{timelineTimeParts.date}</span>
            <span>{timelineTimeParts.time}</span>
          </span>
        )}
      </button>
    );
  };
  const phoneConversationSignature = (phoneMessage: EmbeddedPhoneMessageLink) =>
    [phoneMessage.from, phoneMessage.to]
      .map((name) => name.trim().toLocaleLowerCase())
      .sort()
      .join('::');
  const phoneConversationSegments = (phoneMessages: EmbeddedPhoneMessageLink[]) =>
    phoneMessages.reduce<EmbeddedPhoneMessageLink[][]>((segments, phoneMessage) => {
      const currentSegment = segments[segments.length - 1];
      const previousPhoneMessage = currentSegment?.[currentSegment.length - 1];
      if (
        !currentSegment ||
        !previousPhoneMessage ||
        phoneConversationSignature(previousPhoneMessage) !== phoneConversationSignature(phoneMessage)
      ) {
        segments.push([phoneMessage]);
        return segments;
      }
      currentSegment.push(phoneMessage);
      return segments;
    }, []);
  const renderMessageAvatar = (name: string, accountId?: string, app: 'whatsup' | 'fotogram' | 'onlyfriends' | 'matchme' = 'whatsup') => {
    const matches = accountId
      ? appCharacters.filter((character) => app === 'matchme'
        ? datingAccountMatches(character, accountId)
        : character.apps?.[app]?.accountId === accountId ||
          character.identityAliases?.accountIds?.[app]?.includes(accountId))
      : appCharacters.filter((character) => phoneNamesMatch(character.name, name) ||
        accountHandleMatches(character.apps?.[app], name));
    // A second WhatsUp name shows its own picture and never resolves to its owner here.
    const aliasOwner = app === 'whatsup' ? whatsUpAliasOwner(appCharacters, accountId, name) : undefined;
    const character = !aliasOwner && matches.length === 1 ? matches[0] : undefined;
    // Show the app identity: a dating persona or private account must not reveal the real name or portrait.
    const publicName = app === 'whatsup' ? name : socialAccountPresentation(app, character, name, name).name;
    const avatarDataUrl = aliasOwner ? whatsUpAliasAvatarDataUrl(aliasOwner) : app === 'matchme' ? datingAvatarDataUrl(character)
      : isAccountPrivacyMode(app, character) ? undefined : phoneCharacterAvatarDataUrl(character);
    return <CharacterAvatar
      className="chat-message-avatar"
      style={{ borderColor: characterColors.get(character?.name ?? name) ?? '#ffffff' }}
      name={publicName}
      fallback={publicName.trim().slice(0, 2).toUpperCase() || '?'}
      profileImageDataUrl={avatarDataUrl}
    />;
  };
  const renderPhoneBubbleStack = (
    phoneMessages: EmbeddedPhoneMessageLink[],
    embedded = false,
  ) => {
    const renderPhoneBubble = (
      phoneMessage: EmbeddedPhoneMessageLink,
      anchorSender: string,
      showRouteLabel = false,
    ) => {
      const linkedMessage = phoneMessagesById.get(phoneMessage.phoneMessageId);
      const repliedToMessage = linkedMessage?.replyToMessageId !== undefined
        ? phoneMessagesById.get(linkedMessage.replyToMessageId)
        : undefined;
      const repliedToText = repliedToMessage
        ? phoneReplyVisibleText(repliedToMessage, englishProcessingEnabled) || 'Image'
        : '';
      const text = linkedMessage
        ? phoneMessageVisibleText(linkedMessage, englishProcessingEnabled)
        : englishProcessingEnabled
          ? phoneMessage.translatedMessage ?? phoneMessage.message
          : phoneMessage.message;
      const fromColor = characterColors.get(phoneMessage.from);
      const toColor = characterColors.get(phoneMessage.to);
      const outgoing = phoneMessage.from.trim().toLocaleLowerCase() === anchorSender;
      const openPhoneMessage = () => onOpenEmbeddedPhoneMessage(phoneMessage);
      const authorRole = linkedMessage?.role ?? 'output';
      const authorBadge = phoneAuthorBadgesEnabled ? (
        <span className={`phone-author-badge ${authorRole === 'user' ? 'user' : 'ai'}`}>
          {authorRole === 'user' ? 'USER' : 'AI'}
        </span>
      ) : null;
      const imageAttachments =
        linkedMessage?.imageAttachments ?? phoneMessage.previewImageAttachments;

      return (
        <div className="phone-message-row chat-phone-message-row" key={phoneMessage.phoneMessageId}>
          <div className={`phone-message-content ${outgoing ? 'outgoing' : 'incoming'}${chatMessageAvatarsEnabled ? ' with-message-avatar' : ''}`}>
            {chatMessageAvatarsEnabled && renderMessageAvatar(phoneMessage.from, linkedMessage?.phoneFromAccountId)}
            <div
              className={`phone-bubble ${outgoing ? 'outgoing' : 'incoming'} chat-phone-bubble${phoneLinksEnabled ? '' : ' static'}`}
              role={phoneLinksEnabled ? 'button' : undefined}
              tabIndex={phoneLinksEnabled ? 0 : undefined}
              onClick={phoneLinksEnabled ? openPhoneMessage : undefined}
              onKeyDown={phoneLinksEnabled ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openPhoneMessage();
                }
              } : undefined}
              style={{ fontSize: chatTextSize || defaultChatTextSize }}
            >
              {showRouteLabel ? (
                <span className="phone-bubble-sender chat-phone-bubble-route">
                  <CharacterName color={fromColor}>{phoneMessage.from}</CharacterName>
                  {authorBadge}
                  <span className="chat-message-route-verb">texts</span>
                  <CharacterName color={toColor}>{phoneMessage.to}</CharacterName>
                </span>
              ) : (
                <span
                  className="phone-bubble-sender"
                  style={fromColor ? { color: fromColor } : undefined}
                >
                  <CharacterName color={fromColor}>{phoneMessage.from}</CharacterName>
                  {authorBadge}
                </span>
              )}
              {repliedToMessage && (
                <div className={`phone-bubble-reply-context${phoneReplySizeClass(repliedToText)}`}>
                  {!!repliedToMessage.imageAttachments?.length && (
                    <img
                      src={repliedToMessage.imageAttachments[0]?.dataUrl}
                      alt={repliedToMessage.imageAttachments[0]?.name ?? 'Replied image'}
                      onLoad={onMessageContentLoaded}
                    />
                  )}
                  <div className="phone-bubble-reply-copy">
                    <strong>
                      Reply to <CharacterName color={characterColors.get(repliedToMessage.phoneFrom || repliedToMessage.speakerName || 'Unknown')}>{repliedToMessage.phoneFrom || repliedToMessage.speakerName || 'Unknown'}</CharacterName>
                    </strong>
                    <ChatBubbleText>{repliedToText}</ChatBubbleText>
                  </div>
                </div>
              )}
              {!!imageAttachments?.length && (
                <div className="phone-bubble-images">
                  {imageAttachments.map((image) => (
                    <div className="phone-bubble-image" key={image.id}>
                      <button
                        className="phone-bubble-image-preview"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onPreviewImage(image);
                        }}
                      >
                        <img
                          src={image.dataUrl}
                          alt={image.name}
                          onLoad={onMessageContentLoaded}
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
              {text && linkedMessage?.phoneVoiceMessage && dialogueVoiceSpeakerNames.has(phoneMessage.from) ? (
                <div
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <PhoneVoiceMessage
                    text={text}
                    clipDataUrl={phoneVoiceClipDataUrl(linkedMessage, phoneMessage.from, text)}
                    disabled={isRunning}
                    disabledReason="Voice messages are unavailable while the chat is running."
                    onGenerateClip={() =>
                      onGenerateVoiceMessageClip({
                        messageId: linkedMessage.id,
                        speakerName: phoneMessage.from,
                        text,
                      })
                    }
                  />
                </div>
              ) : text ? (
                <ChatBubbleText><AccountLinkText text={text} bindings={linkedMessage?.accountLinks} /></ChatBubbleText>
              ) : null}
              {linkedMessage?.phoneImageCaptionChange && (
                <button
                  className="caption-change-chip"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPreviewImageCaptionChange(linkedMessage.phoneImageCaptionChange!);
                  }}
                >
                  Image Caption Updated
                </button>
              )}
              {rpTimeTrackingEnabled && renderPhoneRpTime(phoneMessage.phoneMessageId)}
            </div>
          </div>
        </div>
      );
    };

    if (embedded) {
      const segments = phoneConversationSegments(phoneMessages);
      return (
        <section className="chat-social-message-stack" aria-label="WhatsUp messages">
          {segments.map((segment, segmentIndex) => {
            const first = segment[0];
            if (!first) {
              return null;
            }
            const anchorSender = first.from.trim().toLocaleLowerCase();
            return (
              <section
                className="chat-social-message-card whatsup"
                key={`${first.phoneMessageId}-${segmentIndex}`}
              >
                <header className="chat-social-message-header">
                  <strong>WhatsUp</strong>
                  <span>{first.from} to {first.to}</span>
                </header>
                <div className="chat-phone-card-messages">
                  {segment.map((phoneMessage) =>
                    renderPhoneBubble(phoneMessage, anchorSender)
                  )}
                </div>
              </section>
            );
          })}
        </section>
      );
    }

    const segments = phoneConversationSegments(phoneMessages);
    return (
      <section className="chat-phone-bubble-stack" aria-label="Phone messages">
        {segments.map((segment, segmentIndex) => {
          const anchorSender = segment[0]?.from.trim().toLocaleLowerCase() ?? '';
          return (
            <section
              className="chat-phone-card whatsup"
              key={`${segment[0]?.phoneMessageId ?? 'segment'}-${segmentIndex}`}
            >
              <header className="chat-social-message-header">
                <strong>WhatsUp</strong>
                {segment[0] && <span><CharacterName color={characterColors.get(segment[0].from)}>{segment[0].from}</CharacterName> to <CharacterName color={characterColors.get(segment[0].to)}>{segment[0].to}</CharacterName></span>}
              </header>
              <div className="chat-phone-card-messages">
                {segment.map((phoneMessage, messageIndex) =>
                  renderPhoneBubble(phoneMessage, anchorSender, messageIndex === 0)
                )}
              </div>
            </section>
          );
        })}
      </section>
    );
  };
  const renderEmbeddedSocialMessages = (socialMessages: EmbeddedSocialMessageLink[]) => {
    const segments = socialMessages.reduce<EmbeddedSocialMessageLink[][]>((groups, socialMessage) => {
      const current = groups[groups.length - 1];
      const first = current?.[0];
      const sameConversation = first &&
        first.app === socialMessage.app &&
        (first.app === 'matchme'
          ? !!(socialMessagesById.get(first.socialMessageId) ?? first.previewMessage)?.matchId &&
            (socialMessagesById.get(first.socialMessageId) ?? first.previewMessage)?.matchId === (socialMessagesById.get(socialMessage.socialMessageId) ?? socialMessage.previewMessage)?.matchId
          : [first.from, first.to].map((name) => name.toLocaleLowerCase()).sort().join('::') ===
            [socialMessage.from, socialMessage.to].map((name) => name.toLocaleLowerCase()).sort().join('::'));
      if (!current || !sameConversation) {
        groups.push([socialMessage]);
      } else {
        current.push(socialMessage);
      }
      return groups;
    }, []);
    return (
      <section className="chat-social-message-stack" aria-label="Social messenger messages">
        {segments.map((segment, segmentIndex) => {
          const first = segment[0];
          if (!first) {
            return null;
          }
          const anchorSender = first.from.trim().toLocaleLowerCase();
          const appName = socialAppNames[first.app];
          const firstMessage = socialMessagesById.get(first.socialMessageId) ?? first.previewMessage;
          return (
            <section
              className={`chat-social-message-card ${first.app}`}
              key={`${first.socialMessageId}-${segmentIndex}`}
            >
              <header className="chat-social-message-header">
                <strong>{appName}{first.app === 'matchme' && <span aria-hidden="true"> ♥</span>}</strong>
                <span><CharacterName color={characterColors.get((firstMessage && socialDirectMessageCharacter(firstMessage, 'from', appCharacters)?.name) || first.from)}>{firstMessage ? socialDirectMessageParty(firstMessage, 'from', appCharacters, showProfileNames) : first.from}</CharacterName> to <CharacterName color={characterColors.get((firstMessage && socialDirectMessageCharacter(firstMessage, 'to', appCharacters)?.name) || first.to)}>{firstMessage ? socialDirectMessageParty(firstMessage, 'to', appCharacters, showProfileNames) : first.to}</CharacterName></span>
              </header>
              <div className="chat-social-message-thread">
                {segment.map((socialMessage, messageIndex) => {
                  const linkedMessage = socialMessagesById.get(socialMessage.socialMessageId) ?? socialMessage.previewMessage;
                  const text = socialTimelineMessageText(socialMessage, linkedMessage, englishProcessingEnabled);
                  const outgoing = first.app === 'matchme'
                    ? linkedMessage?.fromAccountId === firstMessage?.fromAccountId
                    : socialMessage.from.trim().toLocaleLowerCase() === anchorSender;
                  return (
                    <div
                      className={`chat-social-message-row ${outgoing ? 'outgoing' : 'incoming'}${chatMessageAvatarsEnabled ? ' with-message-avatar' : ''}`}
                      key={socialMessage.socialMessageId}
                    >
                      {chatMessageAvatarsEnabled && renderMessageAvatar(socialMessage.from, linkedMessage?.fromAccountId, first.app)}
                      <div
                        className="chat-social-message-bubble"
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenEmbeddedSocialMessage(socialMessage)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onOpenEmbeddedSocialMessage(socialMessage);
                          }
                        }}
                        style={{ fontSize: chatTextSize || defaultChatTextSize }}
                      >
                        <strong className={messageIndex === 0 ? 'chat-phone-bubble-route' : undefined}>
                          <CharacterName color={characterColors.get((linkedMessage && socialDirectMessageCharacter(linkedMessage, 'from', appCharacters)?.name) || socialMessage.from)}>{linkedMessage ? socialDirectMessageParty(linkedMessage, 'from', appCharacters, showProfileNames) : socialMessage.from}</CharacterName>
                          {messageIndex === 0 && <>
                            <span className="chat-message-route-verb">texts</span>
                            <CharacterName color={characterColors.get((linkedMessage && socialDirectMessageCharacter(linkedMessage, 'to', appCharacters)?.name) || socialMessage.to)}>{linkedMessage ? socialDirectMessageParty(linkedMessage, 'to', appCharacters, showProfileNames) : socialMessage.to}</CharacterName>
                          </>}
                        </strong>
                        <ChatBubbleText><AccountLinkText text={text} bindings={linkedMessage?.accountLinks} /></ChatBubbleText>
                        {rpTimeTrackingEnabled && renderRpTime(
                          socialMessageRpDateTimeById.get(socialMessage.socialMessageId),
                          'phone-bubble-time',
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </section>
    );
  };
  const renderOutputActionChoices = () => {
    const choiceGroups = message.outputActionChoices ?? [];
    if (choiceGroups.length === 0) {
      return null;
    }
    return (
      <div className="output-action-choice-stack" style={{ fontSize: chatTextSize || defaultChatTextSize }}>
        {choiceGroups.map((group, groupIndex) => {
          return (
            <section className={`output-action-choice-group ${group.kind}`} key={groupIndex}>
              {group.prompt && <div className="output-action-choice-prompt">{group.prompt}</div>}
              <div className="output-action-choice-options">
                {group.options.map((option, optionIndex) => {
                  const selection: InputActionSelection = {
                    source: 'outputAction',
                    kind: group.kind,
                    messageId: message.id,
                    groupId: group.id,
                    groupIndex,
                    optionId: option.id,
                    optionIndex,
                    prompt: group.prompt,
                    label: option.label,
                    value: option.value,
                    text: option.text ?? group.text,
                    player: option.player ?? group.player,
                    messageFormat: option.messageFormat ?? group.messageFormat,
                    turnMode: option.turnMode ?? group.turnMode,
                    mode: option.mode ?? group.mode,
                  };
                  return (
                    <button
                      className="output-action-choice-button"
                      type="button"
                      disabled={isRunning}
                      key={`${option.label}-${optionIndex}`}
                      onClick={() => onOutputActionChoice(selection)}
                      title={option.value}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    );
  };
  const renderOutputActionDisplays = () => {
    const infoBoxes = message.outputActionInfoBoxes ?? [];
    const progressBars = message.outputActionProgressBars ?? [];
    const contextCapacityBars = message.outputActionContextCapacityBars ?? [];
    if (infoBoxes.length === 0 && progressBars.length === 0 && contextCapacityBars.length === 0) {
      return null;
    }
    return (
      <div className="output-action-display-stack" style={{ fontSize: chatTextSize || defaultChatTextSize }}>
        {infoBoxes.map((box, boxIndex) => (
          <section className={`output-action-info-box ${box.tone ?? 'info'}`} key={`info-${boxIndex}`}>
            {box.title && <div className="output-action-info-title">{box.title}</div>}
            <div className="output-action-info-text">{box.text}</div>
          </section>
        ))}
        {progressBars.map((bar, barIndex) => {
          const percent = ((bar.value - bar.min) / (bar.max - bar.min)) * 100;
          return (
            <section className="output-action-progress-card" key={`progress-${barIndex}`}>
              <div className="output-action-progress-header">
                <span className="output-action-progress-title">{bar.title}</span>
                <span className="output-action-progress-value">
                  {bar.value} / {bar.max}
                </span>
              </div>
              <div
                className="output-action-progress-track"
                role="progressbar"
                aria-label={bar.title}
                aria-valuemin={bar.min}
                aria-valuemax={bar.max}
                aria-valuenow={bar.value}
              >
                <div className="output-action-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              {bar.label && <div className="output-action-progress-label">{bar.label}</div>}
            </section>
          );
        })}
        {contextCapacityBars.map((bar, barIndex) => (
          <section className="output-action-context-capacity-card" key={bar.id ?? `context-capacity-${barIndex}`}>
            <div className="output-action-context-capacity-header">
              <div className="output-action-context-capacity-title-row">
                <span className="output-action-progress-title">{bar.title}</span>
                {bar.showLegend && (
                  <span className="output-action-context-capacity-legend">
                    <span className="replaced">trimmed context</span>
                    <span className="summary">summary</span>
                    <span className="active">active</span>
                    <span className="free">free</span>
                  </span>
                )}
              </div>
              <span className="output-action-progress-value">{bar.activeTokens + bar.summaryTokens} / {bar.maxTokens}</span>
            </div>
            <div
              className="output-action-context-capacity"
              title={`Trimmed context ~${bar.replacedTokens} / summary ~${bar.summaryTokens} / active ~${bar.activeTokens} / max ~${bar.maxTokens} tokens`}
            >
              {bar.replacedPercent > 0 && <span className="compression-capacity-replaced" style={{ width: `${bar.replacedPercent}%` }} />}
              {bar.summaryPercent > 0 && <span className="compression-capacity-summary" style={{ width: `${bar.summaryPercent}%` }} />}
              {bar.activePercent > 0 && <span className="compression-capacity-active" style={{ width: `${bar.activePercent}%` }} />}
              {bar.freePercent > 0 && <span className="compression-capacity-free" style={{ width: `${bar.freePercent}%` }} />}
            </div>
            {bar.label && <div className="output-action-progress-label">{bar.label}</div>}
          </section>
        ))}
      </div>
    );
  };
  const autoTurnMatch = message.originalText.match(
    /^(.+?) moves the story forward with an action, dialogue, or decision\.$/,
  );
  const narratorAutoTurnMarker =
    message.role === 'user' &&
    message.speakerName === 'Narrator' &&
    message.originalText.trim() === 'Narrator AutoTurn';
  const compactAutoTurnMarker =
    message.role === 'user' &&
    !message.phoneMessage &&
    !message.eventInput &&
    message.speakerName === 'Narrator' &&
    (!!autoTurnMatch || narratorAutoTurnMarker);
  const eventTitle = message.eventInput && message.eventDisplayText
    ? message.eventDisplayText.replace(/^Event:\s*/i, '').trim()
    : '';
  const compactEventMarker =
    message.role === 'user' &&
    message.eventInput &&
    !!eventTitle;
  const rpTimeParts =
    effectiveMessageRpDateTime
      ? formatRpDateTimeParts(
          effectiveMessageRpDateTime,
          rpDateTimeFormat,
          rpWeekdayLanguage,
        )
      : undefined;
  const standaloneSocialMessages = socialTimeline.groups.get(message.id);
  if (standaloneSocialMessages) {
    return (
      <Fragment key={message.id}>
        {dayLabel && <div className="rp-day-divider chat-day-divider"><span>{dayLabel}</span></div>}
        <section className="phone-timeline-bubbles">
          {renderEmbeddedSocialMessages(standaloneSocialMessages)}
        </section>
      </Fragment>
    );
  }
  const phoneTimelineGroup = phoneTimelineGroupsByFirstMessageId.get(message.id);

  if (phoneTimelineGroup?.entries.length) {
    if (outsidePhoneDisplayMode === 'hide') {
      return null;
    }

    const phoneTimelineEntries = phoneTimelineGroup.entries;
    const groupKey = phoneTimelineGroup.messageIds.join('-');
    const collapsed =
      outsidePhoneDisplayMode === 'collapse' &&
      phoneTimelineEntries.length >= 2 &&
      expandedPhoneGroups[groupKey] !== true;
    const groupedParticipantNames = Array.from(
      new Set(
        phoneTimelineEntries.flatMap((entry) => [
          entry.phoneMessage.from,
          entry.phoneMessage.to,
        ]),
      ),
    ).filter(Boolean);
    const rows = phoneTimelineEntries.map((entry) =>
      renderPhoneTimelineRow(
        entry.phoneMessage,
        entry.badges,
        entry.className,
        entry.ariaLabel,
      ),
    );
    const bubbleStack = renderPhoneBubbleStack(phoneTimelineEntries.map((entry) => entry.phoneMessage));

    return (
      <Fragment key={message.id}>
        {dayLabel && <div className="rp-day-divider chat-day-divider"><span>{dayLabel}</span></div>}
        {outsidePhoneDisplayMode === 'bubbles' ? (
          <section className="phone-timeline-bubbles">
            {bubbleStack}
          </section>
        ) : phoneTimelineEntries.length >= 2 && outsidePhoneDisplayMode === 'collapse' ? (
          <section className="phone-timeline-group">
            <button
              className="phone-timeline-group-toggle"
              type="button"
              onClick={() =>
                setExpandedPhoneGroups((current) => ({
                  ...current,
                  [groupKey]: !current[groupKey],
                }))
              }
              aria-expanded={!collapsed}
            >
              <span className="phone-timeline-group-chevron" aria-hidden="true">
                {collapsed ? '>' : 'v'}
              </span>
              <span>
                {phoneTimelineEntries.length} phone {phoneTimelineEntries.length === 1 ? 'message' : 'messages'} with
              </span>
              <span className="phone-timeline-group-summary">
                {groupedParticipantNames.join(', ')}
              </span>
            </button>
            {!collapsed && <div className="phone-timeline-group-rows">{rows}</div>}
          </section>
        ) : rows}
      </Fragment>
    );
  }

  if (compactAutoTurnMarker || compactEventMarker) {
    return (
      <Fragment key={message.id}>
        {dayLabel && <div className="rp-day-divider chat-day-divider"><span>{dayLabel}</span></div>}
        <div
          className={`message-timeline-row ${compactEventMarker ? 'event' : 'auto-turn'}${
            narratorAutoTurnMarker ? ' narrator-auto-turn' : ''
          }`}
          style={{ fontSize: chatTextSize || defaultChatTextSize }}
        >
          {narratorAutoTurnMarker && (
            <span className={badgeClassName('NARRATOR')}>NARRATOR</span>
          )}
          <span className={badgeClassName(compactEventMarker ? 'EVENT' : 'AUTOTURN')}>
            {compactEventMarker ? 'EVENT' : 'AUTOTURN'}
          </span>
          {!narratorAutoTurnMarker && (
            <span className="message-timeline-label">
              {compactEventMarker ? eventTitle : autoTurnMatch?.[1]}
            </span>
          )}
          {rpTimeParts && (
            <span className="message-timeline-time">
              <span>{rpTimeParts.date}</span>
              <span>{rpTimeParts.time}</span>
            </span>
          )}
        </div>
      </Fragment>
    );
  }

  if (message.matchMeAction) {
    return <Fragment key={message.id}>
      {dayLabel && <div className="rp-day-divider chat-day-divider"><span>{dayLabel}</span></div>}
      <MatchMeActivityCard characterColors={characterColors} messages={message.matchMeActivities ?? [message]} characters={appCharacters}
        fontSize={chatTextSize || defaultChatTextSize} />
    </Fragment>;
  }

  if (message.bankTransfer) {
    return (
      <Fragment key={message.id}>
        {dayLabel && <div className="rp-day-divider chat-day-divider"><span>{dayLabel}</span></div>}
        <BankTransferCard
          characterColors={characterColors}
          transfer={message.bankTransfer}
          rpDateTime={rpTimeTrackingEnabled ? effectiveMessageRpDateTime : undefined}
          rpDateTimeFormat={rpDateTimeFormat}
          rpWeekdayLanguage={rpWeekdayLanguage}
          fontSize={chatTextSize || defaultChatTextSize}
        />
      </Fragment>
    );
  }

  if (message.socialPost) {
    const socialPost = message.socialPost;
    const engagement = socialEngagementByApp[socialPost.app][socialPost.postId] ?? {
      likeCount: 0,
      commentCount: 0,
    };
    const authorCharacter = socialCharacterForPost(socialPost, appCharacters);
    const authorColor = authorCharacter
      ? characterColors.get(authorCharacter.name)
      : undefined;
    return (
      <Fragment key={message.id}>
        {dayLabel && <div className="rp-day-divider chat-day-divider"><span>{dayLabel}</span></div>}
        <SocialPostCard
          post={socialPost}
          moderation={engagement.moderation}
          showProfileNames={showProfileNames}
          imageDataUrl={socialPost.imageId
            ? socialImageById(socialPost.imageId, socialPost.authorAccountId ?? socialPost.authorCharacterId)?.dataUrl
            : undefined}
          authorCharacter={authorCharacter}
          authorColor={authorColor}
          likeCount={engagement.likeCount}
          commentCount={engagement.commentCount}
          rpDateTime={rpTimeTrackingEnabled ? effectiveMessageRpDateTime : undefined}
          rpDateTimeFormat={rpDateTimeFormat}
          rpWeekdayLanguage={rpWeekdayLanguage}
          fontSize={chatTextSize || defaultChatTextSize}
          onOpen={() => onOpenSocialPost(socialPost)}
          onImageLoaded={onMessageContentLoaded}
        />
      </Fragment>
    );
  }

  if (phoneAppCommandCardOnly) {
    return (
      <Fragment key={message.id}>
        {dayLabel && <div className="rp-day-divider chat-day-divider"><span>{dayLabel}</span></div>}
        <div className="phone-app-command-card-stack">
          {message.createdPhoneNote && (
            <CreatedPhoneNoteCard
              nameColor={characterColors.get(message.createdPhoneNote.characterName)}
              entry={message.createdPhoneNote}
              fontSize={chatTextSize || defaultChatTextSize}
            />
          )}
          {message.simulatedAiChat && (
            <SimulatedAiChatCard
              nameColor={characterColors.get(message.simulatedAiChat.characterName)}
              entry={message.simulatedAiChat}
              fontSize={chatTextSize || defaultChatTextSize}
            />
          )}
        </div>
      </Fragment>
    );
  }

  return (
    <Fragment key={message.id}>
      {dayLabel && <div className="rp-day-divider chat-day-divider"><span>{dayLabel}</span></div>}
      <article className={`message ${message.role} ${hasOutputActionUi ? 'has-output-action-ui' : ''}${isEditingMessage ? ' is-editing' : ''}`}>
      {speakerLabelNames.length > 0 && (
        <div
          className={`message-speakers${speakerLabelsPlaceholder ? ' is-placeholder' : ''}`}
          aria-hidden={speakerLabelsPlaceholder ? 'true' : undefined}
        >
          {speakerLabelNames.map((speakerName) => {
            const isCharacter = appCharacters.some(
              (character) => character.name === speakerName,
            );
            const color =
              isCharacter && dialogueHighlightEnabled
                ? characterColors.get(speakerName) ?? message.speakerColors?.[speakerName]
                : undefined;
            return (
              <span
                className="message-speaker"
                key={speakerName}
                style={color ? { color } : undefined}
              >
                <CharacterName color={characterColors.has(speakerName) ? color : undefined}>{speakerName}</CharacterName>
              </span>
            );
          })}
        </div>
      )}
      <div className="message-body">
        {canEditMessage && !isEditingMessage && (
          <button
            className="message-pencil-button"
            type="button"
            onClick={() => onBeginEditMessage(message, visibleText)}
            title="Edit the last user message"
            aria-label="Edit the last user message"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m4 16.5-.8 4.3 4.3-.8L19.8 7.7a2.1 2.1 0 0 0 0-3l-.5-.5a2.1 2.1 0 0 0-3 0L4 16.5Zm10.8-10.8 3.5 3.5M3.2 20.8h17.6" />
            </svg>
          </button>
        )}
        <div className="message-text-stack">
          {isEditingMessage ? (
            <textarea
              className="message-edit-textarea"
              style={{ fontSize: chatTextSize || defaultChatTextSize }}
              value={editingDraft}
              onChange={(event) => onEditingDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
                  event.preventDefault();
                  onRegenerateEditedMessage();
                }
              }}
              rows={1}
              autoFocus
            />
          ) : (
            <>
              {(message.outputActionInfoBoxes?.length ?? 0) > 0 ||
              (message.outputActionProgressBars?.length ?? 0) > 0 ||
              (message.outputActionContextCapacityBars?.length ?? 0) > 0 ? (
                renderOutputActionDisplays()
              ) : (message.outputActionChoices?.length ?? 0) > 0 ? (
                renderOutputActionChoices()
              ) : (
                (message.embeddedPhoneMessages?.length ?? 0) > 0 ||
                (message.embeddedSocialMessages?.length ?? 0) > 0
              ) ? (
                <div
                  className="message-composite-bubble"
                  style={{ fontSize: chatTextSize || defaultChatTextSize }}
                >
                  {compositeTextBefore && (
                    <span className="message-composite-text chat-reading-stripes">
                      {renderDialogueTextParts(stripRecognizedSpeakerLabels(compositeTextBefore, speakerNames), 'before')}
                    </span>
                  )}
                  {embeddedMessengerGroups(message).map((group, groupIndex) => (
                    <Fragment key={`embedded-messenger-group-${groupIndex}`}>
                      {group.kind === 'phone' ? (
                        outsidePhoneDisplayMode === 'bubbles' ? (
                          renderPhoneBubbleStack(group.phoneMessages, true)
                        ) : (
                          <span className="embedded-phone-links inline" aria-label="Sent phone messages">
                            {group.phoneMessages.map((phoneMessage) => (
                              renderPhoneActionButton(phoneMessage)
                            ))}
                          </span>
                        )
                      ) : (
                        renderEmbeddedSocialMessages(group.socialMessages)
                      )}
                    </Fragment>
                  ))}
                  {compositeTextAfter && (
                    <span className="message-composite-text chat-reading-stripes">
                      {renderDialogueTextParts(stripRecognizedSpeakerLabels(compositeTextAfter, speakerNames), 'after')}
                    </span>
                  )}
                  {rpTimeTrackingEnabled &&
                    !message.eventInput &&
                    renderRpTime(message.rpDateTime, 'message-rp-time')}
                </div>
              ) : (visibleText || message.rpDateTime) && (
                <p style={{ fontSize: chatTextSize || defaultChatTextSize }}>
                  <span className="chat-reading-stripes">
                    {renderDialogueTextParts(visibleText, 'main')}
                  </span>
                  {rpTimeTrackingEnabled &&
                    !message.eventInput &&
                    renderRpTime(message.rpDateTime, 'message-rp-time')}
                </p>
              )}
            </>
          )}
          {!isEditingMessage && (message.createdPhoneNote || message.simulatedAiChat) && (
            <div className="phone-app-command-card-stack">
              {message.createdPhoneNote && (
                <CreatedPhoneNoteCard
                  nameColor={characterColors.get(message.createdPhoneNote.characterName)}
                  entry={message.createdPhoneNote}
                  fontSize={chatTextSize || defaultChatTextSize}
                />
              )}
              {message.simulatedAiChat && (
                <SimulatedAiChatCard
                  nameColor={characterColors.get(message.simulatedAiChat.characterName)}
                  entry={message.simulatedAiChat}
                  fontSize={chatTextSize || defaultChatTextSize}
                />
              )}
            </div>
          )}
          {isEditingMessage && (
            <div className="message-actions user-actions">
              <button
                className="message-action-button"
                type="button"
                onClick={onCancelEditMessage}
              >
                Cancel
              </button>
              <button
                className="message-action-button primary"
                type="button"
                onClick={onRegenerateEditedMessage}
                disabled={!editingDraft.trim()}
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
        {!!message.imageAttachments?.length && (
          <div className="message-images">
            {message.imageAttachments.map((image) => (
              <div className="chat-image-shell" key={image.id}>
                <button
                  className="chat-image-button"
                  type="button"
                  onClick={() => onPreviewImage(image)}
                >
                  <img
                    src={image.dataUrl}
                    alt={image.name}
                    onLoad={onMessageContentLoaded}
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
      </div>
      </article>
    </Fragment>
  );
});

type ChatConversationPanelProps = RunProgress & {
  chatMessageAvatarSize?: number;
  chatMessageAvatarsEnabled?: boolean;
  messageStream: MessageStream;
  onStreamContentChange: () => void;
  storyCharacters: StorybookCharacter[];
  appCharacters?: StorybookCharacter[];
  /** Show app profile names in chat cards; reserved for a future display setting. */
  showProfileNames?: boolean;
  characterColors: Map<string, string>;
  selectedCharacter?: StorybookCharacter;
  isNarratorSelected: boolean;
  draft: string;
  draftCommands: CommandInputCommand[];
  draftImages: ChatImageAttachment[];
  editingMessageId: number | null;
  editingDraft: string;
  editableUserMessageId?: number;
  isRunning: boolean;
  isPaused?: boolean;
  runStartTimeMs: number | null;
  onCancelRun: () => void;
  englishProcessingEnabled: boolean;
  dialogueHighlightEnabled: boolean;
  dialogueVoiceSpeakerNames: ReadonlySet<string>;
  activeDialogueVoiceKey: string | null;
  onSpeakDialogue: (request: { key: string; messageId: number; speakerName: string; text: string }) => void;
  onGenerateVoiceMessageClip: (request: { messageId: number; speakerName: string; text: string }) => Promise<string | null>;
  dialogueVoiceMode: DialogueVoiceMode;
  onDialogueVoiceModeChange: (mode: DialogueVoiceMode) => void;
  dialogueVoicePreloadDisabledReason: string | null;
  dialogueVoiceReadAloudDisabledReason: string | null;
  dialogueNarratorOnlyDisabledReason: string | null;
  narratorProviderOptions: Array<{
    value: string;
    label: string;
    status?: 'unknown' | 'checking' | 'online' | 'warning' | 'offline';
  }>;
  narratorProviderId: string;
  narratorProviderWarning: string | null;
  onNarratorProviderChange: (providerId: string) => void;
  cloneVoiceProviderOptions: Array<{
    value: string;
    label: string;
    status?: 'unknown' | 'checking' | 'online' | 'warning' | 'offline';
  }>;
  cloneVoiceProviderId: string;
  cloneVoiceProviderWarning: string | null;
  onCloneVoiceProviderChange: (providerId: string) => void;
  onConfigureOpenRouterTts: () => void;
  voiceReadAloudActive: boolean;
  onStopVoiceReadAloud: () => void;
  rpTimeTrackingEnabled: boolean;
  chatTextBrightness: number;
  chatColorIntensity: number;
  chatTextSize: number;
  onChatTextSizeChange: (value: number) => void;
  phoneAuthorBadgesEnabled: boolean;
  /** False when RP Output has the phone unchecked: messages stay visible but do not open it. */
  phoneLinksEnabled?: boolean;
  onPhoneAuthorBadgesEnabledChange: (enabled: boolean) => void;
  chatReadsPhoneAppsEnabled: boolean;
  onChatReadsPhoneAppsEnabledChange: (enabled: boolean) => void;
  thoughtTextStyle: 'bold' | 'italic' | 'light';
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  contextualReferenceImageIds: ReadonlySet<string>;
  selectedReferenceImageIds: ReadonlySet<string>;
  canRunChat: boolean;
  runChatDisabledReason?: string;
  autoplayReplayDisabled: boolean;
  onAutoplayRunModeNow: (mode: AutoplayMode) => void;
  imageUploadEnabled?: boolean;
  imageUploadDisabledReason?: string;
  referenceImageContextEnabled?: boolean;
  referenceImageContextDisabledReason?: string;
  imageInputRef: RefObject<HTMLInputElement | null>;
  chatThreadRef: RefObject<HTMLDivElement | null>;
  onBeginEditMessage: (message: MessageRecord, visibleText: string) => void;
  onCancelEditMessage: () => void;
  onRegenerateEditedMessage: () => void;
  onEditingDraftChange: (value: string) => void;
  onPreviewImage: (image: ChatImageAttachment) => void;
  onToggleReferenceImage: (image: ChatImageAttachment) => void;
  onPreviewImageCaptionChange: (change: ImageCaptionChange) => void;
  onRemoveDraftImage: (imageId: string) => void;
  onOpenEmbeddedPhoneMessage: (message: EmbeddedPhoneMessageLink) => void;
  onOpenEmbeddedSocialMessage: (message: EmbeddedSocialMessageLink) => void;
  onOpenSocialPost: (post: SocialPostRecord) => void;
  socialImageById: (imageId: string, ownerId?: string) => ChatImageAttachment | undefined;
  socialLikesByAccount: Record<string, string[]>;
  onOutputActionChoice: (selection: InputActionSelection) => void;
  pendingQuestion?: UserQuestion | null;
  onAnswerUserQuestion?: (id: number, answer: string) => boolean;
  aiInitiativeUsed?: boolean;
  onStartInitiativeTurn?: () => void;
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (value: string) => void;
  onDraftCommandsChange: (commands: CommandInputCommand[]) => void;
  onAddDraftImages: (files: FileList | null) => void;
  onSelectDraftImages: () => void;
  onMessageContentLoaded: () => void;
};

// Event handlers retain their identity while observing the latest committed App state.
// Render-time data resolvers (such as socialImageById) remain ordinary reactive props.
export function ChatConversationPanel(props: ChatConversationPanelProps) {
  const handlers = useStableEventHandlers({
    onStreamContentChange: props.onStreamContentChange,
    onCancelRun: props.onCancelRun,
    onSpeakDialogue: props.onSpeakDialogue,
    onGenerateVoiceMessageClip: props.onGenerateVoiceMessageClip,
    onDialogueVoiceModeChange: props.onDialogueVoiceModeChange,
    onNarratorProviderChange: props.onNarratorProviderChange,
    onCloneVoiceProviderChange: props.onCloneVoiceProviderChange,
    onConfigureOpenRouterTts: props.onConfigureOpenRouterTts,
    onStopVoiceReadAloud: props.onStopVoiceReadAloud,
    onChatTextSizeChange: props.onChatTextSizeChange,
    onPhoneAuthorBadgesEnabledChange: props.onPhoneAuthorBadgesEnabledChange,
    onChatReadsPhoneAppsEnabledChange: props.onChatReadsPhoneAppsEnabledChange,
    onAutoplayRunModeNow: props.onAutoplayRunModeNow,
    onBeginEditMessage: props.onBeginEditMessage,
    onCancelEditMessage: props.onCancelEditMessage,
    onRegenerateEditedMessage: props.onRegenerateEditedMessage,
    onEditingDraftChange: props.onEditingDraftChange,
    onPreviewImage: props.onPreviewImage,
    onToggleReferenceImage: props.onToggleReferenceImage,
    onPreviewImageCaptionChange: props.onPreviewImageCaptionChange,
    onRemoveDraftImage: props.onRemoveDraftImage,
    onOpenEmbeddedPhoneMessage: props.onOpenEmbeddedPhoneMessage,
    onOpenEmbeddedSocialMessage: props.onOpenEmbeddedSocialMessage,
    onOpenSocialPost: props.onOpenSocialPost,
    onOutputActionChoice: props.onOutputActionChoice,
    onAnswerUserQuestion: (id: number, answer: string) => props.onAnswerUserQuestion?.(id, answer) ?? false,
    onStartInitiativeTurn: () => props.onStartInitiativeTurn?.(),
    onSubmitMessage: props.onSubmitMessage,
    onDraftChange: props.onDraftChange,
    onDraftCommandsChange: props.onDraftCommandsChange,
    onAddDraftImages: props.onAddDraftImages,
    onSelectDraftImages: props.onSelectDraftImages,
    onMessageContentLoaded: props.onMessageContentLoaded,
  });
  return <MemoizedChatConversationPanel {...props} {...handlers} />;
}

const MemoizedChatConversationPanel = memo(function ChatConversationPanelContent({
  chatMessageAvatarSize = 100,
  chatMessageAvatarsEnabled = true,
  activity,
  reasoningTokens,
  messageStream,
  onStreamContentChange,
  storyCharacters,
  appCharacters = storyCharacters,
  showProfileNames = false,
  characterColors,
  selectedCharacter,
  isNarratorSelected,
  draft,
  draftCommands,
  draftImages,
  editingMessageId,
  editingDraft,
  editableUserMessageId,
  isRunning,
  isPaused = false,
  runStartTimeMs,
  onCancelRun,
  englishProcessingEnabled,
  dialogueHighlightEnabled,
  dialogueVoiceSpeakerNames,
  activeDialogueVoiceKey,
  onSpeakDialogue,
  onGenerateVoiceMessageClip,
  dialogueVoiceMode,
  onDialogueVoiceModeChange,
  dialogueVoicePreloadDisabledReason,
  dialogueVoiceReadAloudDisabledReason,
  dialogueNarratorOnlyDisabledReason,
  narratorProviderOptions,
  narratorProviderId,
  narratorProviderWarning,
  onNarratorProviderChange,
  cloneVoiceProviderOptions,
  cloneVoiceProviderId,
  cloneVoiceProviderWarning,
  onCloneVoiceProviderChange,
  onConfigureOpenRouterTts,
  voiceReadAloudActive,
  onStopVoiceReadAloud,
  rpTimeTrackingEnabled,
  chatTextBrightness,
  chatColorIntensity,
  chatTextSize,
  onChatTextSizeChange,
  phoneAuthorBadgesEnabled,
  phoneLinksEnabled = true,
  onPhoneAuthorBadgesEnabledChange,
  chatReadsPhoneAppsEnabled,
  onChatReadsPhoneAppsEnabledChange,
  thoughtTextStyle,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  contextualReferenceImageIds,
  selectedReferenceImageIds,
  canRunChat,
  runChatDisabledReason,
  autoplayReplayDisabled,
  onAutoplayRunModeNow,
  imageUploadEnabled = true,
  imageUploadDisabledReason,
  referenceImageContextEnabled = true,
  referenceImageContextDisabledReason,
  imageInputRef,
  chatThreadRef,
  onBeginEditMessage,
  onCancelEditMessage,
  onRegenerateEditedMessage,
  onEditingDraftChange,
  onPreviewImage,
  onToggleReferenceImage,
  onPreviewImageCaptionChange,
  onRemoveDraftImage,
  onOpenEmbeddedPhoneMessage,
  onOpenEmbeddedSocialMessage,
  onOpenSocialPost,
  socialImageById,
  socialLikesByAccount,
  onOutputActionChoice,
  pendingQuestion,
  onAnswerUserQuestion,
  aiInitiativeUsed = false,
  onStartInitiativeTurn,
  onSubmitMessage,
  onDraftChange,
  onDraftCommandsChange,
  onAddDraftImages,
  onSelectDraftImages,
  onMessageContentLoaded,
}: ChatConversationPanelProps) {
  const messages = useSyncExternalStore(messageStream.subscribe, messageStream.getSnapshot);
  useEffect(() => {
    onStreamContentChange();
  }, [messages, onStreamContentChange]);
  const commandComposerRef = useRef<CommandPillComposerHandle | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState({ id: 0, text: '' });
  const answerText = pendingQuestion?.id === questionAnswer.id ? questionAnswer.text : '';
  useEffect(() => {
    if (pendingQuestion) commandComposerRef.current?.focusMessage();
  }, [pendingQuestion]);
  const [selectRowTimelines] = useState(() => createRowTimelineSelector<PhoneTimelineGroup>());
  const [selectTimeline] = useState(() => createStableDerivedValueSelector<Pick<MessageRowProps,
    'phoneMessagesById' | 'socialMessagesById' | 'socialMessageRpDateTimeById' |
    'socialTimeline' | 'phoneTimelineGroupsByFirstMessageId' | 'skippedPhoneTimelineMessageIds'
  >>());
  const [selectEngagement] = useState(() =>
    createStableDerivedValueSelector<MessageRowProps['socialEngagementByApp']>());
  const socialEngagementByApp = useMemo(() => selectEngagement({
    fotogram: socialPostEngagementByPostId('fotogram', messages, socialLikesByAccount),
    onlyfriends: socialPostEngagementByPostId('onlyfriends', messages, socialLikesByAccount),
  }), [messages, socialLikesByAccount, selectEngagement]);
  const [outsidePhoneDisplayMode, setOutsidePhoneDisplayMode] =
    useState<OutsidePhoneDisplayMode>(() => {
      try {
        const savedMode = window.localStorage.getItem(outsidePhoneDisplayModeStorageKey);
        return savedMode === 'collapse' || savedMode === 'show' || savedMode === 'hide' || savedMode === 'bubbles'
          ? savedMode
          : 'bubbles';
      } catch {
        return 'bubbles';
      }
    });
  const [outsidePhoneMenuOpen, setOutsidePhoneMenuOpen] = useState(false);
  const [voicePlaybackDialogOpen, setVoicePlaybackDialogOpen] = useState(false);
  const outsidePhoneMenuRef = useRef<HTMLDivElement | null>(null);
  const [expandedPhoneGroups, setExpandedPhoneGroups] = useState<Record<string, boolean>>({});
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerHovered, setIsComposerHovered] = useState(false);
  const [scrollCollapsed, setScrollCollapsed] = useState(false);
  const [composerAutoCollapseEnabled, setComposerAutoCollapseEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(composerAutoCollapseStorageKey) !== 'false';
    } catch {
      return true;
    }
  });
  const composerRef = useRef<HTMLFormElement | null>(null);
  const wheelScrollCollapsePendingRef = useRef(false);
  const wheelScrollCollapseTimerRef = useRef<number | null>(null);

  const bringComposerIntoView = useCallback(() => {
    const thread = chatThreadRef.current;
    if (!thread) {
      return;
    }
    window.requestAnimationFrame(() => {
      thread.scrollTop = thread.scrollHeight - thread.clientHeight;
      window.requestAnimationFrame(() => {
        thread.scrollTop = thread.scrollHeight - thread.clientHeight;
      });
    });
  }, [chatThreadRef]);

  const focusComposerInput = useCallback(() => {
    setScrollCollapsed(false);
    setIsComposerFocused(true);
    commandComposerRef.current?.focusMessage();
    bringComposerIntoView();
  }, [bringComposerIntoView, setIsComposerFocused, setScrollCollapsed]);

  const isComposerEventTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!composerRef.current?.contains(target);

  const isTextEntryTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!target.closest('input, textarea, select, button, [contenteditable="true"]');

  useEffect(() => {
    const thread = chatThreadRef.current;
    if (!thread || !composerAutoCollapseEnabled) return;
    const handleWheel = () => {
      wheelScrollCollapsePendingRef.current = true;
      if (wheelScrollCollapseTimerRef.current !== null) {
        window.clearTimeout(wheelScrollCollapseTimerRef.current);
      }
      wheelScrollCollapseTimerRef.current = window.setTimeout(() => {
        wheelScrollCollapsePendingRef.current = false;
        wheelScrollCollapseTimerRef.current = null;
      }, 180);
    };
    const handleScroll = () => {
      if (!wheelScrollCollapsePendingRef.current) {
        return;
      }
      wheelScrollCollapsePendingRef.current = false;
      if (wheelScrollCollapseTimerRef.current !== null) {
        window.clearTimeout(wheelScrollCollapseTimerRef.current);
        wheelScrollCollapseTimerRef.current = null;
      }
      const textarea = thread.ownerDocument.getElementById('chat-prompt');
      if (textarea && textarea === document.activeElement) {
        (textarea as HTMLElement).blur();
      }
      setScrollCollapsed(true);
    };
    thread.addEventListener('wheel', handleWheel, { passive: true });
    thread.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      wheelScrollCollapsePendingRef.current = false;
      if (wheelScrollCollapseTimerRef.current !== null) {
        window.clearTimeout(wheelScrollCollapseTimerRef.current);
        wheelScrollCollapseTimerRef.current = null;
      }
      thread.removeEventListener('wheel', handleWheel);
      thread.removeEventListener('scroll', handleScroll);
    };
  }, [chatThreadRef, composerAutoCollapseEnabled]);

  useEffect(() => {
    const focusFromEnter = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        editingMessageId !== null ||
        isTextEntryTarget(event.target) ||
        isComposerEventTarget(event.target) ||
        (!chatThreadRef.current?.matches(':hover') && !composerRef.current?.matches(':hover'))
      ) {
        return;
      }
      event.preventDefault();
      focusComposerInput();
    };
    window.addEventListener('keydown', focusFromEnter);
    return () => window.removeEventListener('keydown', focusFromEnter);
  }, [chatThreadRef, editingMessageId, focusComposerInput]);

  const isExpanded =
    !!pendingQuestion ||
    !composerAutoCollapseEnabled ||
    isComposerFocused ||
    (!scrollCollapsed && draftImages.length > 0);
  const composerModeClass = isExpanded
    ? 'expanded'
    : isComposerHovered
      ? 'collapsed hover-ready'
      : 'collapsed';

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    if (pendingQuestion) {
      event.preventDefault();
      if (!answerText.trim()) return;
      onAnswerUserQuestion?.(pendingQuestion.id, answerText);
      return;
    }
    setIsComposerFocused(false);
    setIsComposerHovered(false);
    setScrollCollapsed(true);
    onSubmitMessage(event);
  };

  const changeChatTextSize = (change: number) => {
    onChatTextSizeChange(Math.min(22, Math.max(11, chatTextSize + change)));
  };

  useEffect(() => {
    if (!outsidePhoneMenuOpen) {
      return;
    }
    const closeOutsidePhoneMenu = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !outsidePhoneMenuRef.current?.contains(event.target)
      ) {
        setOutsidePhoneMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutsidePhoneMenu);
    return () => document.removeEventListener('pointerdown', closeOutsidePhoneMenu);
  }, [outsidePhoneMenuOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(outsidePhoneDisplayModeStorageKey, outsidePhoneDisplayMode);
    } catch {
      // Non-critical UI preference.
    }
  }, [outsidePhoneDisplayMode]);

  function changeComposerAutoCollapseEnabled(enabled: boolean) {
    setComposerAutoCollapseEnabled(enabled);
    try {
      window.localStorage.setItem(composerAutoCollapseStorageKey, String(enabled));
    } catch {
      // Non-critical UI preference.
    }
  }

  const { phoneMessagesById, socialMessagesById, socialMessageRpDateTimeById, visibleMessages, socialTimeline,
    phoneTimelineGroupsByFirstMessageId, skippedPhoneTimelineMessageIds,
    previousDays } = useMemo(() => measureUiWork('chat.timeline', () => {
    const phoneMessagesById = selectPhoneMessagesById(messages);
    const socialMessagesById = new Map(
      messages.flatMap((message) =>
        message.socialDirectMessage ? [[message.id, message.socialDirectMessage] as const] : []
      ),
    );
    const socialMessageRpDateTimeById = new Map(
      messages.flatMap((message) =>
        message.socialDirectMessage && message.rpDateTime
          ? [[message.id, message.rpDateTime] as const]
          : [],
      ),
    );
    const isNarratorPhoneAutoTurnInstruction = (message: MessageRecord) =>
      Boolean(
        message.role === 'user' &&
          message.phoneMessage &&
          message.speakerName === 'Narrator' &&
        /^This is a Narrator Phone AutoTurn\./.test(message.originalText.trim()),
      );
    const narratorPhoneAutoTurnIds = new Set(
      messages.flatMap((message) =>
        isNarratorPhoneAutoTurnInstruction(message) && message.turnId ? [message.turnId] : []
      ),
    );
    const effectiveRpDateTime = (message: MessageRecord) =>
      messageEffectiveRpDateTime(message, phoneMessagesById);
    const visibleMessages = groupMatchMeHistory(visibleMessageRecords(messages, {
      hideMessage: (message) =>
        isNarratorPhoneAutoTurnInstruction(message) ||
        !!message.outputActionsHidden ||
        socialMessageHiddenFromChat(message),
    }));
    const socialTimeline = socialTimelineGroups(visibleMessages, englishProcessingEnabled);
    const outsidePhoneEntriesByMessageId = new Map<number, PhoneTimelineEntry[]>();

    const directPhoneTimelineEntriesByMessageId = new Map(
      directPhoneTimelineEntries(visibleMessages).map((entry) => [entry.messageId, entry.phoneMessage]),
    );

    visibleMessages.forEach((message) => {
      const directPhoneMessage = directPhoneTimelineEntriesByMessageId.get(message.id);
      if (directPhoneMessage) {
        const narratorAutoTurnPhone =
          message.phoneAutoTurnSource === 'narrator' ||
          (!!message.turnId && narratorPhoneAutoTurnIds.has(message.turnId) && message.turnPart === 'output');
        const badges = narratorAutoTurnPhone
          ? ['NARRATOR', 'AUTOTURN', 'PHONE']
          : [message.role === 'user' ? 'USER' : 'AI', 'PHONE'];
        outsidePhoneEntriesByMessageId.set(message.id, [{
          phoneMessage: directPhoneMessage,
          badges,
          className: narratorAutoTurnPhone
            ? 'auto-turn-phone'
            : `direct-phone ${message.role}`,
          ariaLabel: 'Open phone message',
        }]);
        return;
      }
      if (isStandaloneEmbeddedPhoneOutput(message)) {
        outsidePhoneEntriesByMessageId.set(
          message.id,
          message.embeddedPhoneMessages!.map((phoneMessage) => ({
            phoneMessage,
            badges: ['AI', 'PHONE'],
            className: 'embedded-phone output',
            ariaLabel: 'Open phone message',
          })),
        );
        return;
      }
      if (
        message.role === 'user' &&
        message.phoneMessage &&
        message.speakerName === 'Narrator' &&
        message.embeddedPhoneMessages?.length
      ) {
        const phoneSourceBadges = message.eventInput ? ['EVENT'] : ['NARRATOR', 'AUTOTURN'];
        const phoneSourceClass = message.eventInput ? 'event-phone' : 'auto-turn-phone';
        outsidePhoneEntriesByMessageId.set(
          message.id,
          message.embeddedPhoneMessages.map((phoneMessage) => ({
            phoneMessage,
            badges: [...phoneSourceBadges, 'PHONE'],
            className: phoneSourceClass,
            ariaLabel: 'Open sent phone message',
          })),
        );
      }
    });
    const isEmptyOutputBridgeMessage = (candidate: MessageRecord) => {
      const candidateText = (
        englishProcessingEnabled
          ? candidate.translatedText ?? candidate.originalText
          : candidate.originalText
      ).trim();
      const hasOutputActionUi =
        !!candidate.outputActionChoices?.length ||
        !!candidate.outputActionInfoBoxes?.length ||
        !!candidate.outputActionProgressBars?.length ||
        !!candidate.outputActionContextCapacityBars?.length;
      return (
        candidate.role === 'output' &&
        !candidate.socialDirectMessage &&
        !candidate.embeddedSocialMessages?.length &&
        !candidate.bankTransfer &&
        !candidate.socialPost &&
        !candidate.createdPhoneNote &&
        !candidate.deletedPhoneNote &&
        !candidate.simulatedAiChat &&
        !candidateText &&
        !candidate.rpDateTime &&
        !hasOutputActionUi &&
        !candidate.imageAttachments?.length
      );
    };
    const phoneTimelineGroupsByFirstMessageId = new Map<number, PhoneTimelineGroup>();
    const skippedPhoneTimelineMessageIds = new Set<number>();

    visibleMessages.forEach((message, index) => {
      if (skippedPhoneTimelineMessageIds.has(message.id)) {
        return;
      }
      const phoneTimelineEntries = outsidePhoneEntriesByMessageId.get(message.id);
      if (!phoneTimelineEntries?.length) {
        return;
      }

      const groupedMessageIds = [message.id];
      const groupedEntries = [...phoneTimelineEntries];
      const groupDay = effectiveRpDateTime(message)?.slice(0, 10);

      for (let nextIndex = index + 1; nextIndex < visibleMessages.length; nextIndex += 1) {
        const nextMessage = visibleMessages[nextIndex];
        const nextEntries = outsidePhoneEntriesByMessageId.get(nextMessage.id);
        if (!nextEntries?.length) {
          if (isEmptyOutputBridgeMessage(nextMessage)) {
            groupedMessageIds.push(nextMessage.id);
            continue;
          }
          break;
        }
        const nextDay = effectiveRpDateTime(nextMessage)?.slice(0, 10);
        if (groupDay && nextDay && nextDay !== groupDay) {
          break;
        }
        groupedMessageIds.push(nextMessage.id);
        groupedEntries.push(...nextEntries);
      }

      groupedMessageIds.slice(1).forEach((messageId) => skippedPhoneTimelineMessageIds.add(messageId));
      phoneTimelineGroupsByFirstMessageId.set(message.id, {
        messageIds: groupedMessageIds,
        entries: groupedEntries,
      });
    });

    // Carry the previous dated entry forward once instead of scanning backwards
    // for every message (quadratic for long histories without timestamps).
    let previousDay: string | undefined;
    const previousDays: Array<string | undefined> = [];
    for (const message of visibleMessages) {
      previousDays.push(previousDay);
      previousDay = effectiveRpDateTime(message)?.slice(0, 10) || previousDay;
    }
    return {
      ...selectTimeline({
        phoneMessagesById, socialMessagesById, socialMessageRpDateTimeById, socialTimeline,
        phoneTimelineGroupsByFirstMessageId, skippedPhoneTimelineMessageIds,
      }),
      visibleMessages,
      previousDays,
    };
  }, { messageCount: messages.length }), [messages, englishProcessingEnabled, selectTimeline]);

  const rowTimelines = useMemo(() => measureUiWork('chat.rowTimelines', () =>
    selectRowTimelines(visibleMessages, {
      phoneMessagesById, socialMessagesById, socialMessageRpDateTimeById, socialTimeline,
      phoneTimelineGroupsByFirstMessageId, skippedPhoneTimelineMessageIds,
    })), [selectRowTimelines, visibleMessages, phoneMessagesById, socialMessagesById,
    socialMessageRpDateTimeById, socialTimeline, phoneTimelineGroupsByFirstMessageId,
    skippedPhoneTimelineMessageIds]);

  return (
    <>
      <div
        className="messages"
        ref={chatThreadRef}
        aria-live="polite"
        style={{
          '--chat-message-avatar-scale': chatMessageAvatarSize / 100,
          '--chat-reading-color': chatReadingColor(chatTextBrightness),
        } as CSSProperties}
      >
        {visibleMessages.map((message, index) => (
          <MessageRow
            key={message.id}
            message={message}
            chatMessageAvatarsEnabled={chatMessageAvatarsEnabled}
            previousDay={previousDays[index]}
            englishProcessingEnabled={englishProcessingEnabled}
            appCharacters={appCharacters}
            showProfileNames={showProfileNames}
            characterColors={characterColors}
            dialogueHighlightEnabled={dialogueHighlightEnabled}
            dialogueVoiceSpeakerNames={dialogueVoiceSpeakerNames}
            activeDialogueVoiceKey={activeDialogueVoiceKey}
            onSpeakDialogue={onSpeakDialogue}
            onGenerateVoiceMessageClip={onGenerateVoiceMessageClip}
            chatColorIntensity={chatColorIntensity}
            thoughtTextStyle={thoughtTextStyle}
            chatTextSize={chatTextSize}
            phoneAuthorBadgesEnabled={phoneAuthorBadgesEnabled}
            phoneLinksEnabled={phoneLinksEnabled}
            rpTimeTrackingEnabled={rpTimeTrackingEnabled}
            rpDateTimeFormat={rpDateTimeFormat}
            rpWeekdayLanguage={rpWeekdayLanguage}
            editingMessageId={editingMessageId === message.id ? message.id : null}
            editableUserMessageId={editableUserMessageId === message.id ? message.id : undefined}
            editingDraft={editingMessageId === message.id ? editingDraft : ''}
            isRunning={isRunning}
            contextualReferenceImageIds={contextualReferenceImageIds}
            selectedReferenceImageIds={selectedReferenceImageIds}
            referenceImageContextEnabled={referenceImageContextEnabled}
            referenceImageContextDisabledReason={referenceImageContextDisabledReason}
            onBeginEditMessage={onBeginEditMessage}
            onCancelEditMessage={onCancelEditMessage}
            onRegenerateEditedMessage={onRegenerateEditedMessage}
            onEditingDraftChange={onEditingDraftChange}
            onPreviewImage={onPreviewImage}
            onToggleReferenceImage={onToggleReferenceImage}
            onPreviewImageCaptionChange={onPreviewImageCaptionChange}
            onOpenEmbeddedPhoneMessage={onOpenEmbeddedPhoneMessage}
            onOpenEmbeddedSocialMessage={onOpenEmbeddedSocialMessage}
            onOpenSocialPost={onOpenSocialPost}
            socialImageById={socialImageById}
            onOutputActionChoice={onOutputActionChoice}
            onMessageContentLoaded={onMessageContentLoaded}
            {...rowTimelines.get(message.id)!}
            outsidePhoneDisplayMode={outsidePhoneDisplayMode}
            expandedPhoneGroups={expandedPhoneGroups}
            setExpandedPhoneGroups={setExpandedPhoneGroups}
            socialEngagementByApp={socialEngagementByApp}
          />
        ))}
      </div>
      {isRunning && !isPaused && !pendingQuestion ? (
        <RunProgressCard
          isRunning
          activity={activity}
          reasoningTokens={reasoningTokens}
          runStartTimeMs={runStartTimeMs}
          onCancel={onCancelRun}
        />
      ) : (
      <form
        ref={composerRef}
        className={`composer ${composerModeClass}${pendingQuestion ? ' awaiting-answer' : ''}`}
        style={{
          '--chat-input-font-size': `${chatTextSize || defaultChatTextSize}px`,
        } as CSSProperties}
        onSubmit={submitMessage}
        onPointerDownCapture={(event) => {
          if (isTextEntryTarget(event.target)) {
            return;
          }
          event.preventDefault();
          focusComposerInput();
        }}
        onFocusCapture={() => {
          setIsComposerFocused(true);
          setScrollCollapsed(false);
        }}
        onBlurCapture={() => setIsComposerFocused(false)}
        onMouseEnter={() => setIsComposerHovered(true)}
        onMouseLeave={() => setIsComposerHovered(false)}
      >
        <div className="composer-heading">
          <label
            htmlFor="chat-prompt"
            style={
              isNarratorSelected
                ? {
                    color: '#cbd5e1',
                    textShadow: '0 0 8px rgba(203, 213, 225, 0.35)',
                  }
                : selectedCharacter && characterColors.get(selectedCharacter.name)
                ? {
                    color: characterColors.get(selectedCharacter.name),
                    textShadow: `0 0 8px ${characterColors.get(selectedCharacter.name)}`,
                  }
                : undefined
            }
          >
            <CharacterName color={!isNarratorSelected && selectedCharacter ? characterColors.get(selectedCharacter.name) : undefined}>{(isNarratorSelected ? 'Narrator' : selectedCharacter?.name ?? 'CHARACTER').toUpperCase()}</CharacterName> INPUT
          </label>
        </div>
        {pendingQuestion && (
          <div className="composer-user-question" role="status" aria-live="polite">
            <div className="composer-user-question-header">
              <span className="composer-user-question-badge">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <strong>Your input is needed</strong>
              </span>
            </div>
            <div
              id="user-question-text"
              style={gradientPhaseStyle(pendingQuestion.question)}
              className="composer-user-question-text dialogue-text-gradient narration-text-gradient"
            >
              <EmojiText text={pendingQuestion.question} />
            </div>
          </div>
        )}
        <CommandPillComposer
          ref={commandComposerRef}
          id="chat-prompt"
          describedBy={pendingQuestion ? 'user-question-text' : undefined}
          value={pendingQuestion ? answerText : draft}
          commands={pendingQuestion ? [] : draftCommands}
          commandsEnabled={!pendingQuestion && rpTimeTrackingEnabled}
          disabled={false}
          onValueChange={pendingQuestion
            ? (text) => setQuestionAnswer({ id: pendingQuestion.id, text })
            : onDraftChange}
          onEmptyDoubleEnter={!pendingQuestion && !isRunning && !isNarratorSelected && selectedCharacter && !draftImages.length && !draftCommands.length
            ? onStartInitiativeTurn : undefined}
          onCommandsChange={onDraftCommandsChange}
          onSubmit={submitMessage}
          initiativeGuidance={!pendingQuestion}
          guidanceCollapsed={!isExpanded}
          showInitiativeHint={!isNarratorSelected}
          highlightInitiative={!aiInitiativeUsed && !isRunning && !isNarratorSelected && !!selectedCharacter && !draftImages.length && !draftCommands.length}
          placeholder={pendingQuestion ? 'Write your answer and press Enter' : isNarratorSelected
            ? 'Write a message and press Enter\nType /cmd for commands'
            : 'Write a message and press Enter\nPress Enter twice while empty for AI Initiative\nType /cmd for commands'}
          rows={pendingQuestion ? 5 : 3}
        />
        {!pendingQuestion && !!draftImages.length && (
          <div className="composer-images">
            {draftImages.map((image) => (
              <div className="composer-image" key={image.id}>
                <button
                  className="composer-image-preview"
                  type="button"
                  onClick={() => onPreviewImage(image)}
                >
                  <img src={image.dataUrl} alt={image.name} />
                </button>
                <button
                  className="composer-image-remove"
                  type="button"
                  onClick={() => onRemoveDraftImage(image.id)}
                  title={`Remove ${image.name}`}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={imageInputRef}
          className="composer-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={!imageUploadEnabled}
          onChange={(event) => {
            onAddDraftImages(event.target.files);
            event.target.value = '';
          }}
        />
        <div className="composer-actions">
          <div className="composer-left-actions">
            <button
              className="attach-image-button"
              type="button"
              disabled={isRunning || !imageUploadEnabled}
              onClick={onSelectDraftImages}
              title={!imageUploadEnabled ? imageUploadDisabledReason ?? 'Image upload requires a vision-capable provider.' : undefined}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>Attach Image</span>
              {draftImages.length > 0 && (
                <span className="composer-attach-count">{draftImages.length}</span>
              )}
            </button>
            <div className="phone-display-menu" ref={outsidePhoneMenuRef}>
              <button
                className="composer-icon-button"
                type="button"
                onClick={() => setOutsidePhoneMenuOpen((open) => !open)}
                title="Chat tab settings"
                aria-label="Chat tab settings"
                aria-expanded={outsidePhoneMenuOpen}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.3l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.13.65.77 1.08 1.51 1.08H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51.92Z" />
                </svg>
              </button>
              {outsidePhoneMenuOpen && (
                <div className="phone-display-popover" role="menu">
                  <div className="phone-display-popover-section">
                    <span className="phone-display-popover-heading">Chat Tab Settings</span>
                    <button
                      className={`phone-display-checkbox${composerAutoCollapseEnabled ? ' active' : ''}`}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={composerAutoCollapseEnabled}
                      onClick={() => changeComposerAutoCollapseEnabled(!composerAutoCollapseEnabled)}
                    >
                      <span className="phone-display-check" aria-hidden="true">
                        {composerAutoCollapseEnabled ? '✓' : ''}
                      </span>
                      <span>Auto-collapse input</span>
                    </button>
                    <button
                      className={`phone-display-checkbox${chatReadsPhoneAppsEnabled ? ' active' : ''}`}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={chatReadsPhoneAppsEnabled}
                      title="App messages shown inside a chat bubble are marked read and raise no phone notification."
                      onClick={() => onChatReadsPhoneAppsEnabledChange(!chatReadsPhoneAppsEnabled)}
                    >
                      <span className="phone-display-check" aria-hidden="true">
                        {chatReadsPhoneAppsEnabled ? '✓' : ''}
                      </span>
                      <span>Chat marks app messages read</span>
                    </button>
                  </div>
                  <div className="phone-display-popover-section">
                    <span className="phone-display-popover-heading">Phone Messages</span>
                    {([
                      ['bubbles', 'Show Phone Messages'],
                      ['hide', 'Hide Phone Messages'],
                      ['show', 'Show Phone Rows'],
                      ['collapse', 'Collapse Phone Rows'],
                    ] as Array<[OutsidePhoneDisplayMode, string]>).map(([mode, label]) => (
                      <button
                        className={outsidePhoneDisplayMode === mode ? 'active' : undefined}
                        type="button"
                        role="menuitemradio"
                        aria-checked={outsidePhoneDisplayMode === mode}
                        key={mode}
                        onClick={() => {
                          setOutsidePhoneDisplayMode(mode);
                          setOutsidePhoneMenuOpen(false);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      className={`phone-display-checkbox${phoneAuthorBadgesEnabled ? ' active' : ''}`}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={phoneAuthorBadgesEnabled}
                      onClick={() => onPhoneAuthorBadgesEnabledChange(!phoneAuthorBadgesEnabled)}
                    >
                      <span className="phone-display-check" aria-hidden="true">
                        {phoneAuthorBadgesEnabled ? '✓' : ''}
                      </span>
                      <span>Show AI/User badges</span>
                    </button>
                  </div>
                  <div className="phone-display-popover-section">
                    <span className="phone-display-popover-heading">Chat Text</span>
                    <div className="phone-display-size-control" aria-label="Normal chat text size">
                      <span>Size</span>
                      <div>
                        <button
                          type="button"
                          aria-label="Decrease normal chat text size"
                          disabled={chatTextSize <= 11}
                          onClick={() => changeChatTextSize(-1)}
                        >
                          -
                        </button>
                        <strong>{chatTextSize}px</strong>
                        <button
                          type="button"
                          aria-label="Increase normal chat text size"
                          disabled={chatTextSize >= 22}
                          onClick={() => changeChatTextSize(1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button
              className={`composer-icon-button${voicePlaybackDialogOpen ? ' active' : ''}`}
              type="button"
              onClick={() => setVoicePlaybackDialogOpen(true)}
              title="Voice playback settings"
              aria-label="Voice playback settings"
              aria-haspopup="dialog"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <polygon points="4 9 8 9 13 4 13 20 8 15 4 15" />
                <path d="M17 9.5a4 4 0 0 1 0 5" />
                <path d="M19.5 7a7.5 7.5 0 0 1 0 10" />
              </svg>
            </button>
            {voiceReadAloudActive && (
              <button
                className="attach-image-button voice-stop-button"
                type="button"
                onClick={onStopVoiceReadAloud}
                title="Stop the automatic voice read-aloud"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                <span>Stop Voices</span>
              </button>
            )}
          </div>
          {!pendingQuestion && draftCommands.length > 0 && (
            <CommandPillList
              className="chat-command-pill-list"
              commands={draftCommands}
              onCommandsChange={onDraftCommandsChange}
              onRequestMessageFocus={() => commandComposerRef.current?.focusMessage()}
            />
          )}
          <div className="composer-run-actions">
            {pendingQuestion ? (
              <button
                type="button"
                className="composer-cancel-btn"
                onClick={onCancelRun}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                <span>Cancel</span>
              </button>
            ) : (
              <AutoplayControl
                replayDisabled={autoplayReplayDisabled}
                onRunModeNow={onAutoplayRunModeNow}
              />
            )}
            <button
              type="submit"
              className={`composer-submit-btn${isRunning && !pendingQuestion ? ' is-running' : ''}`}
              disabled={pendingQuestion ? !answerText.trim() : !canRunChat}
              title={
                canRunChat || isRunning
                  ? undefined
                  : runChatDisabledReason ??
                    'Add a Storybook with one player and at least one actor to run the chat.'
              }
            >
              <span>{pendingQuestion ? 'Send Answer' : isRunning ? 'Cancel' : 'Run Chat'}</span>
              {isRunning && !pendingQuestion ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </form>
      )}
      {voicePlaybackDialogOpen && (
        <VoicePlaybackDialog
          mode={dialogueVoiceMode}
          onModeChange={onDialogueVoiceModeChange}
          preloadDisabledReason={dialogueVoicePreloadDisabledReason}
          readAloudDisabledReason={dialogueVoiceReadAloudDisabledReason}
          narratorOnlyDisabledReason={dialogueNarratorOnlyDisabledReason}
          narratorProviderOptions={narratorProviderOptions}
          narratorProviderId={narratorProviderId}
          narratorProviderWarning={narratorProviderWarning}
          onNarratorProviderChange={onNarratorProviderChange}
          cloneVoiceProviderOptions={cloneVoiceProviderOptions}
          cloneVoiceProviderId={cloneVoiceProviderId}
          cloneVoiceProviderWarning={cloneVoiceProviderWarning}
          onCloneVoiceProviderChange={onCloneVoiceProviderChange}
          onConfigureOpenRouterTts={onConfigureOpenRouterTts}
          onClose={() => setVoicePlaybackDialogOpen(false)}
        />
      )}
    </>
  );
});
