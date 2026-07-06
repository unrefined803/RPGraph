import {
  Fragment,
  type FormEvent,
  type RefObject,
  useMemo,
  useRef,
} from 'react';
import { defaultPhoneChatTextSize } from '../settings';
import type { StorybookCharacter } from '../storybook/runtime';
import type {
  ChatImageAttachment,
  ImageCaptionChange,
  MessageRecord,
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
import { PhoneVoiceMessage } from './PhoneVoiceMessage';
import { CharacterAvatar } from './CharacterAvatar';
import { ImageContextControl } from './ImageContextControl';
import {
  CommandPillComposer,
  CommandPillList,
  type CommandPillComposerHandle,
} from './CommandPillComposer';
import type { CommandInputCommand } from '../chat/structuredCommands';

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

function phoneReplySizeClass(text: string) {
  if (text.length > 120) {
    return ' long';
  }
  return text.length > 60 ? ' medium' : '';
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
}: PhonePanelProps) {
  const commandComposerRef = useRef<CommandPillComposerHandle | null>(null);
  const isImageInContext = (image: ChatImageAttachment) =>
    !!image.id.trim() && contextualReferenceImageIds.has(image.id.trim());
  const isImageManuallySelected = (image: ChatImageAttachment) =>
    !!image.id.trim() && selectedReferenceImageIds.has(image.id.trim());
  const phoneOwnerName = selectedCharacter?.name.trim().split(/\s+/)[0];
  const phoneListTitle = phoneOwnerName ? `${phoneOwnerName}'s Chats` : 'Phone Chats';
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

  return (
    <div className="phone-surface">
      <div className="phone-list" aria-label="Phone chats">
        <div className="phone-list-header">
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
                      galleryTitle={`${phoneOwnerName ?? 'Phone'}'s Images`}
                      images={phoneGalleryImages}
                      uploadDisabled={!imageUploadEnabled}
                      uploadDisabledReason={imageUploadDisabledReason}
                      onSelectImage={onSelectPhoneGalleryImage}
                      onUploadFromComputer={onSelectPhoneImages}
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
