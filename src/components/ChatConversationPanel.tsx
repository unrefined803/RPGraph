import {
  Fragment,
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
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
  ChatImageAttachment,
  DialogueVoiceMode,
  ImageCaptionChange,
  InputActionSelection,
  MessageRecord,
  EmbeddedPhoneMessageLink,
  RpDateTimeFormat,
  RpWeekdayLanguage,
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
import type { CommandInputCommand } from '../chat/structuredCommands';

const outsidePhoneDisplayModeStorageKey = 'rpgraph-chat-phone-display-mode';
const phoneBubbleHeadersStorageKey = 'rpgraph-chat-phone-bubble-headers-enabled';

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

type ChatConversationPanelProps = {
  messages: MessageRecord[];
  storyCharacters: StorybookCharacter[];
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
  narratorProviderOptions: Array<{ value: string; label: string }>;
  narratorProviderId: string;
  onNarratorProviderChange: (providerId: string) => void;
  cloneVoiceProviderOptions: Array<{ value: string; label: string }>;
  cloneVoiceProviderId: string;
  onCloneVoiceProviderChange: (providerId: string) => void;
  onConfigureOpenRouterTts: () => void;
  voiceReadAloudActive: boolean;
  onStopVoiceReadAloud: () => void;
  rpTimeTrackingEnabled: boolean;
  chatTextSize: number;
  onChatTextSizeChange: (value: number) => void;
  phoneAuthorBadgesEnabled: boolean;
  onPhoneAuthorBadgesEnabledChange: (enabled: boolean) => void;
  thoughtTextStyle: 'bold' | 'italic' | 'light';
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  contextualReferenceImageIds: ReadonlySet<string>;
  selectedReferenceImageIds: ReadonlySet<string>;
  canRunChat: boolean;
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
  onOutputActionChoice: (selection: InputActionSelection) => void;
  onSubmitMessage: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (value: string) => void;
  onDraftCommandsChange: (commands: CommandInputCommand[]) => void;
  onAddDraftImages: (files: FileList | null) => void;
  onSelectDraftImages: () => void;
  onMessageContentLoaded: () => void;
};

export function ChatConversationPanel({
  messages,
  storyCharacters,
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
  onNarratorProviderChange,
  cloneVoiceProviderOptions,
  cloneVoiceProviderId,
  onCloneVoiceProviderChange,
  onConfigureOpenRouterTts,
  voiceReadAloudActive,
  onStopVoiceReadAloud,
  rpTimeTrackingEnabled,
  chatTextSize,
  onChatTextSizeChange,
  phoneAuthorBadgesEnabled,
  onPhoneAuthorBadgesEnabledChange,
  thoughtTextStyle,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  contextualReferenceImageIds,
  selectedReferenceImageIds,
  canRunChat,
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
  onOutputActionChoice,
  onSubmitMessage,
  onDraftChange,
  onDraftCommandsChange,
  onAddDraftImages,
  onSelectDraftImages,
  onMessageContentLoaded,
}: ChatConversationPanelProps) {
  const commandComposerRef = useRef<CommandPillComposerHandle | null>(null);
  const isImageInContext = (image: ChatImageAttachment) =>
    !!image.id.trim() && contextualReferenceImageIds.has(image.id.trim());
  const isImageManuallySelected = (image: ChatImageAttachment) =>
    !!image.id.trim() && selectedReferenceImageIds.has(image.id.trim());
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
  const [phoneBubbleHeadersEnabled, setPhoneBubbleHeadersEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(phoneBubbleHeadersStorageKey) !== 'false';
    } catch {
      return true;
    }
  });
  const phoneMessagesById = selectPhoneMessagesById(messages);

  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isComposerHovered, setIsComposerHovered] = useState(false);
  const [scrollCollapsed, setScrollCollapsed] = useState(false);
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
    if (!thread) return;
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
      if (wheelScrollCollapseTimerRef.current !== null) {
        window.clearTimeout(wheelScrollCollapseTimerRef.current);
        wheelScrollCollapseTimerRef.current = null;
      }
      thread.removeEventListener('wheel', handleWheel);
      thread.removeEventListener('scroll', handleScroll);
    };
  }, [chatThreadRef]);

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
    isComposerFocused ||
    (!scrollCollapsed && draftImages.length > 0);
  const composerModeClass = isExpanded
    ? 'expanded'
    : isComposerHovered
      ? 'collapsed hover-ready'
      : 'collapsed';

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

  function changePhoneBubbleHeadersEnabled(enabled: boolean) {
    setPhoneBubbleHeadersEnabled(enabled);
    try {
      window.localStorage.setItem(phoneBubbleHeadersStorageKey, String(enabled));
    } catch {
      // Non-critical UI preference.
    }
  }

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
  const badgeClassName = (badge: string) =>
    `entry-channel-badge badge-${badge.toLocaleLowerCase()}`;
  const effectiveRpDateTime = (message: MessageRecord) =>
    messageEffectiveRpDateTime(message, phoneMessagesById);
  const visibleMessages = visibleMessageRecords(messages, {
    hideMessage: (message) => isNarratorPhoneAutoTurnInstruction(message) || !!message.outputActionsHidden,
  });
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

  return (
    <>
      <div className="messages" ref={chatThreadRef} aria-live="polite">
        {visibleMessages.map((message, index) => {
          if (skippedPhoneTimelineMessageIds.has(message.id)) {
            return null;
          }
          const displayText = message.eventInput && message.eventDisplayText
            ? message.eventDisplayText
            : englishProcessingEnabled
              ? message.translatedText ?? message.originalText
              : message.originalText;
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
          const reserveSpeakerLabels = message.role === 'output' && !hasOutputActionUi;
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
          const dialogue = englishProcessingEnabled
            ? message.translatedDialogue ?? []
            : message.originalDialogue ?? [];
          const llmDialogueHighlightActive =
            (message.role === 'output' || message.role === 'user') &&
            dialogueHighlightEnabled;
          const parts = llmDialogueHighlightActive
            ? dialogue.length > 0
              ? coloredDialogueParts(visibleText, dialogue)
              : quotedSpeechParts(visibleText)
            : quotedSpeechParts(visibleText);
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
          const effectiveMessageRpDateTime = effectiveRpDateTime(message);
          let previousDay: string | undefined;
          for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
            previousDay = effectiveRpDateTime(visibleMessages[previousIndex])?.slice(0, 10);
            if (previousDay) {
              break;
            }
          }
          const messageDay = effectiveMessageRpDateTime?.slice(0, 10);
          const dayLabel =
            rpTimeTrackingEnabled && effectiveMessageRpDateTime && messageDay !== previousDay
              ? formatRpDayLabel(effectiveMessageRpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
              : '';
          const renderDialoguePartSpans = (
            textParts: Array<{ text: string; speakerName?: string; isSpeech?: boolean }>,
            keyPrefix: string,
          ) =>
            textParts.map((part, index) => {
              const partSpeakerName = 'speakerName' in part ? part.speakerName : undefined;
              const speechColor = partSpeakerName
                ? message.speakerColors?.[partSpeakerName] ??
                  characterColors.get(partSpeakerName) ??
                  dialogueColors[0]
                : undefined;
              const pendingSpeech = !speechColor && 'isSpeech' in part && part.isSpeech;
              const voiceKey =
                partSpeakerName && dialogueVoiceSpeakerNames.has(partSpeakerName)
                  ? `${message.id}:${keyPrefix}:${index}`
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
                  style={speechColor ? { color: speechColor } : undefined}
                  title={
                    voiceKey
                      ? voiceActive
                        ? 'Stop voice playback'
                        : `Speak with the voice of ${partSpeakerName}`
                      : undefined
                  }
                  onClick={
                    voiceKey && partSpeakerName
                      ? () => onSpeakDialogue({ key: voiceKey, messageId: message.id, speakerName: partSpeakerName, text: part.text })
                      : undefined
                  }
                >
                  {thoughtParts(part.text).map((thoughtPart, thoughtIndex) => (
                    <span
                      className={
                        thoughtPart.isThought
                          ? thoughtStyleClass(thoughtTextStyle || defaultThoughtTextStyle)
                          : undefined
                      }
                      key={thoughtIndex}
                    >
                      {thoughtPart.text}
                    </span>
                  ))}
                </span>
              );
            });
          const renderDialogueTextParts = (text: string, keyPrefix: string) => {
            const textParts = llmDialogueHighlightActive && dialogue.length > 0
              ? coloredDialogueParts(text, dialogue)
              : quotedSpeechParts(text);
            return renderDialoguePartSpans(textParts, keyPrefix);
          };
          const characterNameStyle = (name: string) => {
            const color = characterColors.get(name);
            return color ? { color } : undefined;
          };
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
              <strong style={characterNameStyle(phoneMessage.from)}>{phoneMessage.from}</strong>
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
              <strong style={characterNameStyle(phoneMessage.to)}>{phoneMessage.to}</strong>
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
                className="embedded-phone-link"
                type="button"
                key={phoneMessage.phoneMessageId}
                onClick={() => onOpenEmbeddedPhoneMessage(phoneMessage)}
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
                className={`message-timeline-row phone ${className}`}
                style={{ fontSize: chatTextSize || defaultChatTextSize }}
                type="button"
                key={phoneMessage.phoneMessageId}
                onClick={() => onOpenEmbeddedPhoneMessage(phoneMessage)}
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
          const phoneConversationCardTitle = (phoneMessage: EmbeddedPhoneMessageLink) => (
            <h3 className="chat-phone-card-title">
              <span style={characterNameStyle(phoneMessage.from)}>{phoneMessage.from}</span>
              <span>and</span>
              <span style={characterNameStyle(phoneMessage.to)}>{phoneMessage.to}</span>
            </h3>
          );
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

              return (
                <div className="phone-message-row chat-phone-message-row" key={phoneMessage.phoneMessageId}>
                  <div className={`phone-message-content ${outgoing ? 'outgoing' : 'incoming'}`}>
                    <div
                      className={`phone-bubble ${outgoing ? 'outgoing' : 'incoming'} chat-phone-bubble`}
                      role="button"
                      tabIndex={0}
                      onClick={openPhoneMessage}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openPhoneMessage();
                        }
                      }}
                      style={{ fontSize: chatTextSize || defaultChatTextSize }}
                    >
                      {showRouteLabel ? (
                        <span className="phone-bubble-sender chat-phone-bubble-route">
                          <span style={fromColor ? { color: fromColor } : undefined}>{phoneMessage.from}</span>
                          {authorBadge}
                          <span>texts</span>
                          <span style={toColor ? { color: toColor } : undefined}>{phoneMessage.to}</span>
                        </span>
                      ) : (
                        <span
                          className="phone-bubble-sender"
                          style={fromColor ? { color: fromColor } : undefined}
                        >
                          {phoneMessage.from}
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
                              Reply to {repliedToMessage.phoneFrom || repliedToMessage.speakerName || 'Unknown'}
                            </strong>
                            <span>{repliedToText}</span>
                          </div>
                        </div>
                      )}
                      {!!linkedMessage?.imageAttachments?.length && (
                        <div className="phone-bubble-images">
                          {linkedMessage.imageAttachments.map((image) => (
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
                        <span>{text}</span>
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
              const anchorSender = phoneMessages[0]?.from.trim().toLocaleLowerCase() ?? '';
              return (
                <section className="chat-phone-bubble-stack embedded" aria-label="Phone messages">
                  {phoneMessages.map((phoneMessage) => renderPhoneBubble(phoneMessage, anchorSender, true))}
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
                      className="chat-phone-card"
                      key={`${segment[0]?.phoneMessageId ?? 'segment'}-${segmentIndex}`}
                    >
                      {phoneBubbleHeadersEnabled && segment[0] && phoneConversationCardTitle(segment[0])}
                      <div className="chat-phone-card-messages">
                        {segment.map((phoneMessage) => renderPhoneBubble(phoneMessage, anchorSender))}
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

          return (
            <Fragment key={message.id}>
              {dayLabel && <div className="rp-day-divider chat-day-divider"><span>{dayLabel}</span></div>}
              <article className={`message ${message.role} ${hasOutputActionUi ? 'has-output-action-ui' : ''}`}>
              {speakerLabelNames.length > 0 && (
                <div className={`message-speakers${speakerLabelsPlaceholder ? ' is-placeholder' : ''}`}>
                  {speakerLabelNames.map((speakerName) => {
                    const isCharacter = storyCharacters.some(
                      (character) => character.name === speakerName,
                    );
                    const color =
                      isCharacter && dialogueHighlightEnabled
                        ? message.speakerColors?.[speakerName] ?? characterColors.get(speakerName)
                        : undefined;
                    return (
                      <span
                        className="message-speaker"
                        key={speakerName}
                        style={color ? { color } : undefined}
                      >
                        {speakerName}
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
                      value={editingDraft}
                      onChange={(event) => onEditingDraftChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
                          event.preventDefault();
                          onRegenerateEditedMessage();
                        }
                      }}
                      rows={4}
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
                      ) : (message.embeddedPhoneMessages?.length ?? 0) > 0 ? (
                        <div
                          className="message-composite-bubble"
                          style={{ fontSize: chatTextSize || defaultChatTextSize }}
                        >
                          {compositeTextBefore && (
                            <span className="message-composite-text">
                              {renderDialogueTextParts(stripRecognizedSpeakerLabels(compositeTextBefore, speakerNames), 'before')}
                            </span>
                          )}
                          {outsidePhoneDisplayMode === 'bubbles' ? (
                            renderPhoneBubbleStack(message.embeddedPhoneMessages ?? [], true)
                          ) : (
                            <span className="embedded-phone-links inline" aria-label="Sent phone messages">
                              {(message.embeddedPhoneMessages ?? []).map((phoneMessage) => (
                                renderPhoneActionButton(phoneMessage)
                              ))}
                            </span>
                          )}
                          {compositeTextAfter && (
                            <span className="message-composite-text">
                              {renderDialogueTextParts(stripRecognizedSpeakerLabels(compositeTextAfter, speakerNames), 'after')}
                            </span>
                          )}
                          {rpTimeTrackingEnabled &&
                            !message.eventInput &&
                            renderRpTime(message.rpDateTime, 'message-rp-time')}
                        </div>
                      ) : (visibleText || message.rpDateTime) && (
                        <p style={{ fontSize: chatTextSize || defaultChatTextSize }}>
                          {renderDialoguePartSpans(parts, 'main')}
                          {rpTimeTrackingEnabled &&
                            !message.eventInput &&
                            renderRpTime(message.rpDateTime, 'message-rp-time')}
                        </p>
                      )}
                    </>
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
        })}
      </div>
      <form
        ref={composerRef}
        className={`composer ${composerModeClass}`}
        onSubmit={onSubmitMessage}
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
            {(isNarratorSelected ? 'Narrator' : selectedCharacter?.name ?? 'CHARACTER').toUpperCase()} INPUT
          </label>
        </div>
        <CommandPillComposer
          ref={commandComposerRef}
          id="chat-prompt"
          value={draft}
          commands={draftCommands}
          commandsEnabled={rpTimeTrackingEnabled}
          disabled={false}
          onValueChange={onDraftChange}
          onCommandsChange={onDraftCommandsChange}
          onSubmit={onSubmitMessage}
          placeholder="Click here or press Enter to write. Type /cmd for commands"
          rows={3}
        />
        {!!draftImages.length && (
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
              Attach Image
            </button>
            <div className="phone-display-menu" ref={outsidePhoneMenuRef}>
              <button
                className="composer-icon-button"
                type="button"
                onClick={() => setOutsidePhoneMenuOpen((open) => !open)}
                title="Phone message display"
                aria-label="Phone message display"
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
                    <span className="phone-display-popover-heading">Phone Message Display</span>
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
                    <button
                      className={`phone-display-checkbox${phoneBubbleHeadersEnabled ? ' active' : ''}`}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={phoneBubbleHeadersEnabled}
                      onClick={() => changePhoneBubbleHeadersEnabled(!phoneBubbleHeadersEnabled)}
                    >
                      <span className="phone-display-check" aria-hidden="true">
                        {phoneBubbleHeadersEnabled ? '✓' : ''}
                      </span>
                      <span>Show bubble headers</span>
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
                Stop Voices
              </button>
            )}
          </div>
          {draftCommands.length > 0 && (
            <CommandPillList
              className="chat-command-pill-list"
              commands={draftCommands}
              onCommandsChange={onDraftCommandsChange}
              onRequestMessageFocus={() => commandComposerRef.current?.focusMessage()}
            />
          )}
          <button
            type="submit"
            disabled={!canRunChat}
            title={
              canRunChat || isRunning
                ? undefined
                : 'Add a Storybook with one player and at least one actor to run the chat.'
            }
          >
            {isRunning ? 'Cancel' : 'Run Chat'}
          </button>
        </div>
      </form>
      {voicePlaybackDialogOpen && (
        <VoicePlaybackDialog
          mode={dialogueVoiceMode}
          onModeChange={onDialogueVoiceModeChange}
          preloadDisabledReason={dialogueVoicePreloadDisabledReason}
          readAloudDisabledReason={dialogueVoiceReadAloudDisabledReason}
          narratorOnlyDisabledReason={dialogueNarratorOnlyDisabledReason}
          narratorProviderOptions={narratorProviderOptions}
          narratorProviderId={narratorProviderId}
          onNarratorProviderChange={onNarratorProviderChange}
          cloneVoiceProviderOptions={cloneVoiceProviderOptions}
          cloneVoiceProviderId={cloneVoiceProviderId}
          onCloneVoiceProviderChange={onCloneVoiceProviderChange}
          onConfigureOpenRouterTts={onConfigureOpenRouterTts}
          onClose={() => setVoicePlaybackDialogOpen(false)}
        />
      )}
    </>
  );
}
