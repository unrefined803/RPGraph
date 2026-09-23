import { AppMessageAvatar } from '../AppMessageAvatars';
import { createPortal } from 'react-dom';
import { AccountLinkInput } from '../AccountLinkInput';
import { AccountLinkText } from '../AccountLinkText';
import { npcSeedPostAccountId } from '../../characters/npcParticipants';
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
import { formatOnlyFriendsTip } from '../../chat/onlyFriendsWallet';
import { formatBankingAmount } from '../../chat/bankTransfers';
import { isAccountPrivacyMode, socialIdentityMatches, socialAccountPresentation, socialCharacterForPost } from '../../chat/socialMedia';
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
  characters: StorybookCharacter[];
  ownerHandle: string;
  participants: SocialDirectMessageParticipant[];
  unreadByHandle: SocialDmUnreadByHandle;
  selectedParticipant?: SocialDirectMessageParticipant;
  messages: SocialDirectMessageRecord[];
  characterColors: Map<string, string>;
  socialImageById: (imageId: string, ownerId?: string) => ChatImageAttachment | undefined;
  messageRpDateTimeById: ReadonlyMap<string, string>;
  rpTimeTrackingEnabled: boolean;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  emojiOptions: string[];
  recentlyUsedEmojis: string[];
  highlightedMessageId?: string;
  highlightedMessagePulseKey: number;
  disabled?: boolean;
  walletBalance: number;
  onSelectParticipant: (participant: SocialDirectMessageParticipant) => void;
  onCloseConversation: () => void;
  onBack: () => void;
  onSend: (message: SocialDirectMessageRecord) => Promise<boolean>;
};

export function PhoneSocialDirectMessages({
  app,
  owner,
  characters,
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
  walletBalance,
  onSelectParticipant,
  onCloseConversation,
  onBack,
  onSend,
}: PhoneSocialDirectMessagesProps) {
  const participantIdentity = (participant: SocialDirectMessageParticipant) => socialAccountPresentation(
    app,
    socialCharacterForPost({ app, postId: '', author: participant.name, authorHandle: participant.handle,
      authorAccountId: participant.character?.apps?.[app]?.accountId, caption: '' }, characters),
    participant.name,
    participant.handle,
  );
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
  const sendLock = useRef(false);
  const [tipDialogKey, setTipDialogKey] = useState<string>();
  const [tipAmountText, setTipAmountText] = useState('10');
  const tipAmount = Number(tipAmountText);
  const tipAmountValid = /^\d{1,4}$/.test(tipAmountText) && tipAmount > 0;
  const [tipError, setTipError] = useState('');
  const [tipHost, setTipHost] = useState<Element | null>(null);
  const [draftTips, setDraftTips] = useState<Record<string, number | undefined>>({});
  const draftTip = app === 'onlyfriends' ? draftTips[draftKey] : undefined;
  const messageInputRef = useRef<HTMLInputElement>(null);
  function closeTipPicker() {
    setTipDialogKey(undefined);
    messageInputRef.current?.focus();
  }

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

  function attachTip() {
    if (disabled || sending || !tipAmountValid) return;
    if (tipAmount > walletBalance) {
      setTipError('Insufficient OnlyFriends balance. Please top up first.');
      return;
    }
    setDraftTips((current) => ({ ...current, [draftKey]: tipAmount }));
    closeTipPicker();
  }

  function selectEmoji(emoji: string) {
    setDraft(`${draft}${emoji}`);
    setRecentEmojis((current) => [emoji, ...current.filter((entry) => entry !== emoji)].slice(0, 8));
    setEmojiPickerOpen(false);
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedParticipant || !text || disabled || sending || sendLock.current) {
      return;
    }
    if (draftTip !== undefined && draftTip > walletBalance) {
      setTipAmountText(String(draftTip));
      setTipError('Insufficient OnlyFriends balance. Please top up first.');
      setTipHost(event.currentTarget.closest('.phone-social-screen'));
      setTipDialogKey(draftKey);
      return;
    }
    const sequence = messages.length + 1;
    setDraft('');
    sendLock.current = true;
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
        ...(draftTip !== undefined ? { tip: draftTip } : {}),
        sentAt: new Date().toISOString(),
        origin: selectedParticipant.origin ?? conversation.find((message) => message.origin)?.origin,
      });
      if (!sent) {
        setDraft(text);
      } else {
        setDraftTips((current) => ({ ...current, [draftKey]: undefined }));
      }
    } catch {
      setDraft(text);
    } finally {
      sendLock.current = false;
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
                  name={participantIdentity(participant).name}
                  fallback={participant.name.slice(0, 1).toUpperCase()}
                  profileImageDataUrl={!isAccountPrivacyMode(app, participant.character) ? participant.character?.profileImage?.dataUrl : undefined}
                  style={color ? { borderColor: color, color } : undefined}
                />
                <span className="phone-social-dm-contact-copy">
                  <strong>{participantIdentity(participant).name}</strong>
                  <span>{latest?.displayText ?? latest?.text ?? `@${participantIdentity(participant).handle}`}</span>
                </span>
                {unread && (
                  <span className="phone-social-dm-badges">
                    {app === 'onlyfriends' && unread.tipTotal > 0 && (
                      <span className="phone-social-tip-badge">
                        {formatOnlyFriendsTip(unread.tipTotal)}
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
  const originImage = origin?.postImageId ? socialImageById(origin.postImageId, npcSeedPostAccountId(origin.postId)) : undefined;
  // The stored origin comment keeps its real author; when the viewer wrote
  // that comment (e.g. after switching characters), it renders as outgoing.
  const originOutgoing = !!origin?.commentAuthorHandle &&
    socialIdentityMatches(origin.commentAuthorHandle, ownerHandle);
  const originLabel = origin?.commentText
    ? originOutgoing
      ? `Your comment on @${socialAccountPresentation(app, socialCharacterForPost({ app, postId: origin.postId, author: origin.postAuthor, authorHandle: origin.postAuthorHandle, caption: '' }, characters), origin.postAuthor, origin.postAuthorHandle).handle}'s post`
      : socialIdentityMatches(origin.postAuthorHandle, ownerHandle)
        ? 'Comment on your post'
        : `Comment on @${socialAccountPresentation(app, socialCharacterForPost({ app, postId: origin.postId, author: origin.postAuthor, authorHandle: origin.postAuthorHandle, caption: '' }, characters), origin.postAuthor, origin.postAuthorHandle).handle}'s post`
    : '';
  return (
    <section className="phone-social-dm" aria-label={`Conversation with ${participantIdentity(selectedParticipant).name}`}>
      <header className="phone-social-dm-header conversation">
        <button type="button" onClick={onCloseConversation} aria-label="Back to messages" title="Back to messages">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <CharacterAvatar
          className="phone-avatar"
          name={participantIdentity(selectedParticipant).name}
          fallback={selectedParticipant.name.slice(0, 1).toUpperCase()}
          profileImageDataUrl={!isAccountPrivacyMode(app, selectedParticipant.character) ? selectedParticipant.character?.profileImage?.dataUrl : undefined}
          style={participantColor ? { borderColor: participantColor, color: participantColor } : undefined}
        />
        <div>
          <strong>{participantIdentity(selectedParticipant).name}</strong>
          <span>@{participantIdentity(selectedParticipant).handle}</span>
        </div>
      </header>
      {tipDialogKey === draftKey && tipHost && createPortal(
        <div
          className="phone-social-tip-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeTipPicker();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              closeTipPicker();
            }
          }}
        >
          <div className="phone-social-tip-dialog" role="dialog" aria-modal="true" aria-labelledby="social-tip-title">
            <div className="phone-social-tip-header">
              <div className="phone-social-tip-header-text">
                <h3 id="social-tip-title">Attach a Tip</h3>
                <span className="phone-social-tip-recipient">
                  To @{participantIdentity(selectedParticipant).handle}
                </span>
              </div>
              <button
                type="button"
                className="phone-social-tip-close"
                onClick={closeTipPicker}
                aria-label="Close tip dialog"
                title="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="phone-social-tip-balance">
              <span>OnlyFriends Balance</span>
              <strong>{formatBankingAmount(walletBalance)}</strong>
            </div>
            <div className="phone-social-tip-section">
              <span className="phone-social-tip-label">Select tip amount</span>
              <div className="phone-social-tip-options">
                {[10, 15, 25, 50].map((amount) => (
                  <button
                    type="button"
                    key={amount}
                    aria-pressed={tipAmount === amount}
                    disabled={sending}
                    onClick={() => {
                      setTipAmountText(String(amount));
                      setTipError('');
                    }}
                  >
                    {formatOnlyFriendsTip(amount)}
                  </button>
                ))}
              </div>
            </div>
            <label className="phone-social-tip-amount">
              <span className="phone-social-tip-label">Custom amount ($)</span>
              <div className="phone-social-tip-input-wrap">
                <span className="phone-social-tip-currency-symbol">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{1,4}"
                  maxLength={4}
                  placeholder="10"
                  value={tipAmountText}
                  disabled={sending}
                  autoFocus
                  onChange={(event) => {
                    if (/^\d{0,4}$/.test(event.target.value)) {
                      setTipAmountText(event.target.value);
                      setTipError('');
                    }
                  }}
                />
              </div>
            </label>
            {tipError && <p className="phone-social-tip-error" role="alert">{tipError}</p>}
            <div className="phone-social-tip-actions">
              <button
                type="button"
                className="phone-social-tip-cancel"
                onClick={closeTipPicker}
              >
                Cancel
              </button>
              <button
                type="button"
                className="phone-social-tip-submit"
                disabled={disabled || sending || !tipAmountValid}
                onClick={attachTip}
              >
                {`Attach ${formatOnlyFriendsTip(tipAmount)}`}
              </button>
            </div>
          </div>
        </div>,
        tipHost,
      )}
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
              name={participantIdentity(selectedParticipant).name}
              fallback={selectedParticipant.name.slice(0, 1).toUpperCase()}
              profileImageDataUrl={!isAccountPrivacyMode(app, selectedParticipant.character) ? selectedParticipant.character?.profileImage?.dataUrl : undefined}
              style={participantColor ? { borderColor: participantColor, color: participantColor } : undefined}
            />
            <strong>{participantIdentity(selectedParticipant).name}</strong>
            <span>@{participantIdentity(selectedParticipant).handle}</span>
            <small>Start your conversation</small>
          </div>
        )}
        {origin?.commentText && (
          <div className={`phone-social-dm-message-row ${originOutgoing ? 'outgoing' : 'incoming'} origin-comment`}>
            <AppMessageAvatar name={originOutgoing ? owner.name : participantIdentity(selectedParticipant).name}
              character={originOutgoing ? owner : selectedParticipant.character}
              hidePortrait={isAccountPrivacyMode(app, originOutgoing ? owner : selectedParticipant.character)} />
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
          const timeLabel = !rpTimeTrackingEnabled
            ? new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : undefined;
          const highlighted = message.messageId === highlightedMessageId;
          return (
            <div
              className={`phone-social-dm-message-row ${outgoing ? 'outgoing' : 'incoming'}${
                highlighted ? ' social-message-focus-highlight' : ''
              }`}
              data-social-message-id={message.messageId}
              key={`${message.messageId}-${highlighted ? highlightedMessagePulseKey : 'idle'}`}
            >
              <AppMessageAvatar name={outgoing ? owner.name : participantIdentity(selectedParticipant).name}
                character={outgoing ? owner : selectedParticipant.character}
                hidePortrait={isAccountPrivacyMode(app, outgoing ? owner : selectedParticipant.character)} />
              <div className="phone-social-dm-bubble">
                <span><AccountLinkText text={message.displayText ?? message.text} bindings={message.accountLinks} /></span>
                <div className="phone-social-dm-footer">
                  {message.app === 'onlyfriends' && message.tip !== undefined && (
                    <span className="phone-social-dm-tip">{outgoing ? '−' : '+'}{formatBankingAmount(message.tip)} tip</span>
                  )}
                  {rpTimeParts ? (
                    <time dateTime={rpDateTime}>
                      <span className="rp-time-date">{rpTimeParts.date}</span>
                      {'   '}
                      <span className="rp-time-clock">{rpTimeParts.time}</span>
                    </time>
                  ) : timeLabel ? <time dateTime={message.sentAt}>{timeLabel}</time> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <form className="phone-social-dm-composer" onSubmit={submitMessage}>
        <div className="phone-social-dm-input-field">
        <AccountLinkInput value={draft}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message..."
            ref={messageInputRef}
            disabled={disabled || sending}
            autoFocus
          />
        </AccountLinkInput>
        {app === 'onlyfriends' && (
          <span className="phone-social-draft-tip">
            <button type="button" disabled={disabled || sending} aria-label="Choose message tip"
              onClick={(event) => {
                setTipAmountText(String(draftTip ?? 10)); setTipError('');
                setTipHost(event.currentTarget.closest('.phone-social-screen'));
                setTipDialogKey(draftKey);
              }}>
              TIP{draftTip !== undefined ? ` ${formatOnlyFriendsTip(draftTip)}` : ''}
            </button>
            {draftTip !== undefined && <button type="button" aria-label="Remove tip" disabled={disabled || sending}
              onClick={() => setDraftTips((current) => ({ ...current, [draftKey]: undefined }))}>×</button>}
          </span>
        )}
        </div>
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
