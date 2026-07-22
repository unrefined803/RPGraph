import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { StorybookCharacter } from '../../storybook/runtime';
import type {
  ChatImageAttachment,
  RpDateTimeFormat,
  RpWeekdayLanguage,
  SocialAppKind,
  SocialDirectMessageRecord,
  SocialDmUnreadByHandle,
} from '../../types';
import { formatBankingAmount } from '../../chat/bankTransfers';
import { socialIdentityMatches } from '../../chat/socialMedia';
import { formatRpDateTimeParts } from '../../workflow';
import { CharacterAvatar } from '../CharacterAvatar';

export type SocialDirectMessageParticipant = {
  key: string;
  name: string;
  handle: string;
  character?: StorybookCharacter;
  origin?: SocialDirectMessageRecord['origin'];
};

type PhoneSocialDirectMessagesProps = {
  app: SocialAppKind;
  owner: StorybookCharacter;
  ownerHandle: string;
  participants: SocialDirectMessageParticipant[];
  unreadByHandle: SocialDmUnreadByHandle;
  selectedParticipant?: SocialDirectMessageParticipant;
  messages: SocialDirectMessageRecord[];
  characterColors: Map<string, string>;
  socialImageById: (imageId: string) => ChatImageAttachment | undefined;
  messageRpDateTimeById: ReadonlyMap<string, string>;
  rpTimeTrackingEnabled: boolean;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  emojiOptions: string[];
  recentlyUsedEmojis: string[];
  highlightedMessageId?: string;
  highlightedMessagePulseKey: number;
  disabled?: boolean;
  onSelectParticipant: (participant: SocialDirectMessageParticipant) => void;
  onCloseConversation: () => void;
  onBack: () => void;
  onSend: (message: SocialDirectMessageRecord) => Promise<boolean>;
};

export function PhoneSocialDirectMessages({
  app,
  owner,
  ownerHandle,
  participants,
  unreadByHandle,
  selectedParticipant,
  messages,
  characterColors,
  socialImageById,
  messageRpDateTimeById,
  rpTimeTrackingEnabled,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  emojiOptions,
  recentlyUsedEmojis,
  highlightedMessageId,
  highlightedMessagePulseKey,
  disabled = false,
  onSelectParticipant,
  onCloseConversation,
  onBack,
  onSend,
}: PhoneSocialDirectMessagesProps) {
  // One draft per app, viewing account, and conversation partner, so switching
  // the partner never carries an unsent private message into the wrong chat.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = selectedParticipant
    ? `${app}/${ownerHandle}/${selectedParticipant.handle}`.toLowerCase()
    : '';
  const draft = draftKey ? drafts[draftKey] ?? '' : '';
  const setDraft = (text: string) =>
    setDrafts((current) => ({ ...current, [draftKey]: text }));
  const [sending, setSending] = useState(false);
  const [expandedOriginDraftKey, setExpandedOriginDraftKey] = useState<string>();
  const originExpanded = expandedOriginDraftKey === draftKey;
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState(recentlyUsedEmojis);
  const emojiMenuRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const conversation = useMemo(() => {
    if (!selectedParticipant) {
      return [];
    }
    return messages.filter((message) =>
      message.app === app && (
        socialIdentityMatches(message.fromHandle, ownerHandle) &&
        socialIdentityMatches(message.toHandle, selectedParticipant.handle) ||
        socialIdentityMatches(message.toHandle, ownerHandle) &&
        socialIdentityMatches(message.fromHandle, selectedParticipant.handle)
      ),
    );
  }, [app, messages, ownerHandle, selectedParticipant]);

  useEffect(() => {
    if (!emojiPickerOpen) {
      return;
    }
    const closePicker = (event: PointerEvent) => {
      if (event.target instanceof Node && !emojiMenuRef.current?.contains(event.target)) {
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener('pointerdown', closePicker);
    return () => document.removeEventListener('pointerdown', closePicker);
  }, [emojiPickerOpen]);

  useEffect(() => {
    if (!highlightedMessageId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const highlightedRow = Array.from(
        threadRef.current?.querySelectorAll<HTMLElement>('[data-social-message-id]') ?? [],
      ).find((row) => row.dataset.socialMessageId === highlightedMessageId);
      highlightedRow?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedMessageId, highlightedMessagePulseKey, selectedParticipant]);

  function selectEmoji(emoji: string) {
    setDraft(`${draft}${emoji}`);
    setRecentEmojis((current) => [emoji, ...current.filter((entry) => entry !== emoji)].slice(0, 8));
    setEmojiPickerOpen(false);
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedParticipant || !text || disabled || sending) {
      return;
    }
    const sequence = messages.length + 1;
    setDraft('');
    setSending(true);
    try {
      const sent = await onSend({
        app,
        messageId: `${app}-dm-${Date.now()}-${sequence}`,
        from: owner.name,
        fromHandle: ownerHandle,
        to: selectedParticipant.name,
        toHandle: selectedParticipant.handle,
        text,
        sentAt: new Date().toISOString(),
        origin: selectedParticipant.origin ?? conversation.find((message) => message.origin)?.origin,
      });
      if (!sent) {
        setDraft(text);
      }
    } finally {
      setSending(false);
    }
  }

  if (!selectedParticipant) {
    return (
      <section className="phone-social-dm" aria-label="Direct messages">
        <header className="phone-social-dm-header">
          <button type="button" onClick={onBack} aria-label="Back to feed" title="Back to feed">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <strong>Messages</strong>
            <span>Choose someone to start chatting</span>
          </div>
        </header>
        <div className="phone-social-dm-list">
          {participants.map((participant) => {
            const color = participant.character
              ? characterColors.get(participant.character.name)
              : undefined;
            const unread = unreadByHandle[participant.handle.toLowerCase()];
            const latest = [...messages].reverse().find((message) =>
              message.app === app && (
                socialIdentityMatches(message.fromHandle, ownerHandle) &&
                socialIdentityMatches(message.toHandle, participant.handle) ||
                socialIdentityMatches(message.toHandle, ownerHandle) &&
                socialIdentityMatches(message.fromHandle, participant.handle)
              ),
            );
            return (
              <button
                type="button"
                className="phone-social-dm-contact"
                key={participant.key}
                onClick={() => onSelectParticipant(participant)}
              >
                <CharacterAvatar
                  className="phone-avatar large"
                  name={participant.name}
                  fallback={participant.name.slice(0, 1).toUpperCase()}
                  profileImageDataUrl={participant.character?.profileImage?.dataUrl}
                  style={color ? { borderColor: color, color } : undefined}
                />
                <span className="phone-social-dm-contact-copy">
                  <strong>{participant.name}</strong>
                  <span>{latest?.displayText ?? latest?.text ?? `@${participant.handle}`}</span>
                </span>
                {unread && (
                  <span className="phone-social-dm-badges">
                    {app === 'onlyfriends' && unread.tipTotal > 0 && (
                      <span className="phone-social-tip-badge">
                        +{formatBankingAmount(unread.tipTotal)}
                      </span>
                    )}
                    <span className="phone-contact-badge">{unread.count}</span>
                  </span>
                )}
                <span aria-hidden="true">›</span>
              </button>
            );
          })}
          {participants.length === 0 && (
            <div className="phone-social-dm-empty">
              <strong>No people yet</strong>
              <span>Add a person or open a profile from the feed.</span>
            </div>
          )}
        </div>
      </section>
    );
  }

  const participantColor = selectedParticipant.character
    ? characterColors.get(selectedParticipant.character.name)
    : undefined;
  const origin = selectedParticipant.origin ?? conversation.find((message) => message.origin)?.origin;
  const originImage = origin?.postImageId ? socialImageById(origin.postImageId) : undefined;
  // The stored origin comment keeps its real author; when the viewer wrote
  // that comment (e.g. after switching characters), it renders as outgoing.
  const originOutgoing = !!origin?.commentAuthorHandle &&
    socialIdentityMatches(origin.commentAuthorHandle, ownerHandle);
  const originLabel = origin?.commentText
    ? originOutgoing
      ? `Your comment on @${origin.postAuthorHandle}'s post`
      : socialIdentityMatches(origin.postAuthorHandle, ownerHandle)
        ? 'Comment on your post'
        : `Comment on @${origin.postAuthorHandle}'s post`
    : '';
  return (
    <section className="phone-social-dm" aria-label={`Conversation with ${selectedParticipant.name}`}>
      <header className="phone-social-dm-header conversation">
        <button type="button" onClick={onCloseConversation} aria-label="Back to messages" title="Back to messages">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <CharacterAvatar
          className="phone-avatar"
          name={selectedParticipant.name}
          fallback={selectedParticipant.name.slice(0, 1).toUpperCase()}
          profileImageDataUrl={selectedParticipant.character?.profileImage?.dataUrl}
          style={participantColor ? { borderColor: participantColor, color: participantColor } : undefined}
        />
        <div>
          <strong>{selectedParticipant.name}</strong>
          <span>@{selectedParticipant.handle}</span>
        </div>
      </header>
      {origin && (
        <button
          type="button"
          className={`phone-social-dm-origin${originExpanded ? ' expanded' : ''}`}
          onClick={() => setExpandedOriginDraftKey((current) =>
            current === draftKey ? undefined : draftKey,
          )}
          aria-expanded={originExpanded}
        >
          {originImage && <img src={originImage.dataUrl} alt={originImage.name} />}
          <span className="phone-social-dm-origin-copy">
            <small>
              {origin.commentText ? 'Conversation started from a comment' : 'Conversation about a post'}
            </small>
            {origin.commentText ? (
              <>
                <strong>{origin.commentAuthor}: “{origin.commentText}”</strong>
                {originExpanded && <span>{origin.postAuthor}: {origin.postCaption}</span>}
              </>
            ) : (
              <strong>{origin.postAuthor}: “{origin.postCaption}”</strong>
            )}
          </span>
          <span aria-hidden="true">{originExpanded ? '⌃' : '⌄'}</span>
        </button>
      )}
      <div className="phone-social-dm-thread" ref={threadRef}>
        {conversation.length === 0 && !origin && (
          <div className="phone-social-dm-empty conversation-empty">
            <CharacterAvatar
              className="phone-avatar large"
              name={selectedParticipant.name}
              fallback={selectedParticipant.name.slice(0, 1).toUpperCase()}
              profileImageDataUrl={selectedParticipant.character?.profileImage?.dataUrl}
              style={participantColor ? { borderColor: participantColor, color: participantColor } : undefined}
            />
            <strong>{selectedParticipant.name}</strong>
            <span>@{selectedParticipant.handle}</span>
            <small>Start your conversation</small>
          </div>
        )}
        {origin?.commentText && (
          <div className={`phone-social-dm-message-row ${originOutgoing ? 'outgoing' : 'incoming'} origin-comment`}>
            <div className="phone-social-dm-bubble">
              <span>{origin.commentText}</span>
              <time>{originLabel}</time>
            </div>
          </div>
        )}
        {conversation.map((message) => {
          const outgoing = socialIdentityMatches(message.fromHandle, ownerHandle);
          const rpDateTime = messageRpDateTimeById.get(message.messageId);
          const rpTimeParts = rpTimeTrackingEnabled && rpDateTime
            ? formatRpDateTimeParts(rpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
            : undefined;
          const timeLabel = rpTimeTrackingEnabled
            ? rpTimeParts?.time
            : new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const highlighted = message.messageId === highlightedMessageId;
          return (
            <div
              className={`phone-social-dm-message-row ${outgoing ? 'outgoing' : 'incoming'}${
                highlighted ? ' social-message-focus-highlight' : ''
              }`}
              data-social-message-id={message.messageId}
              key={`${message.messageId}-${highlighted ? highlightedMessagePulseKey : 'idle'}`}
            >
              <div className="phone-social-dm-bubble">
                <span>{message.displayText ?? message.text}</span>
                {message.app === 'onlyfriends' && message.tip !== undefined && (
                  <span className="phone-social-dm-tip">+{formatBankingAmount(message.tip)} tip</span>
                )}
                {timeLabel && <time dateTime={rpDateTime ?? message.sentAt}>{timeLabel}</time>}
              </div>
            </div>
          );
        })}
      </div>
      <form className="phone-social-dm-composer" onSubmit={submitMessage}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message..."
          disabled={disabled}
          autoFocus
        />
        <div className="phone-social-dm-emoji-menu" ref={emojiMenuRef}>
          <button
            type="button"
            className="phone-social-dm-emoji-button"
            onClick={() => setEmojiPickerOpen((current) => !current)}
            aria-label="Open emoji picker"
            aria-expanded={emojiPickerOpen}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </button>
          {emojiPickerOpen && (
            <div className="phone-social-dm-emoji-picker">
              {recentEmojis.length > 0 && (
                <>
                  <small>Recent</small>
                  <div className="phone-social-dm-emoji-grid recent">
                    {recentEmojis.map((emoji) => (
                      <button type="button" key={`recent-${emoji}`} onClick={() => selectEmoji(emoji)}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="phone-social-dm-emoji-grid">
                {emojiOptions.map((emoji) => (
                  <button type="button" key={emoji} onClick={() => selectEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button type="submit" disabled={disabled || sending || !draft.trim()} aria-label="Send message">
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
