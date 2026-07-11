import { type FormEvent, useMemo, useState } from 'react';
import type { StorybookCharacter } from '../../storybook/runtime';
import type { ChatImageAttachment, SocialAppKind, SocialDirectMessageRecord } from '../../types';
import { formatBankingAmount } from '../../chat/bankTransfers';
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
  selectedParticipant?: SocialDirectMessageParticipant;
  messages: SocialDirectMessageRecord[];
  characterColors: Map<string, string>;
  socialImageById: (imageId: string) => ChatImageAttachment | undefined;
  disabled?: boolean;
  onSelectParticipant: (participant: SocialDirectMessageParticipant) => void;
  onCloseConversation: () => void;
  onBack: () => void;
  onSend: (message: SocialDirectMessageRecord) => Promise<boolean>;
};

function identityMatches(left: string, right: string) {
  return left.trim().replace(/^@/, '').toLocaleLowerCase() ===
    right.trim().replace(/^@/, '').toLocaleLowerCase();
}

export function PhoneSocialDirectMessages({
  app,
  owner,
  ownerHandle,
  participants,
  selectedParticipant,
  messages,
  characterColors,
  socialImageById,
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
  const [originExpanded, setOriginExpanded] = useState(false);
  const conversation = useMemo(() => {
    if (!selectedParticipant) {
      return [];
    }
    return messages.filter((message) =>
      message.app === app && (
        identityMatches(message.fromHandle, ownerHandle) &&
        identityMatches(message.toHandle, selectedParticipant.handle) ||
        identityMatches(message.toHandle, ownerHandle) &&
        identityMatches(message.fromHandle, selectedParticipant.handle)
      ),
    );
  }, [app, messages, ownerHandle, selectedParticipant]);

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
          <button type="button" onClick={onBack} aria-label="Back to feed" title="Back to feed">←</button>
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
            const latest = [...messages].reverse().find((message) =>
              message.app === app && (
                identityMatches(message.fromHandle, ownerHandle) &&
                identityMatches(message.toHandle, participant.handle) ||
                identityMatches(message.toHandle, ownerHandle) &&
                identityMatches(message.fromHandle, participant.handle)
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
    identityMatches(origin.commentAuthorHandle, ownerHandle);
  const originLabel = origin?.commentText
    ? originOutgoing
      ? `Your comment on @${origin.postAuthorHandle}'s post`
      : identityMatches(origin.postAuthorHandle, ownerHandle)
        ? 'Comment on your post'
        : `Comment on @${origin.postAuthorHandle}'s post`
    : '';
  return (
    <section className="phone-social-dm" aria-label={`Conversation with ${selectedParticipant.name}`}>
      <header className="phone-social-dm-header conversation">
        <button type="button" onClick={onCloseConversation} aria-label="Back to messages" title="Back to messages">←</button>
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
          onClick={() => setOriginExpanded((current) => !current)}
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
      <div className="phone-social-dm-thread">
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
          const outgoing = identityMatches(message.fromHandle, ownerHandle);
          return (
            <div className={`phone-social-dm-message-row ${outgoing ? 'outgoing' : 'incoming'}`} key={message.messageId}>
              <div className="phone-social-dm-bubble">
                <span>{message.displayText ?? message.text}</span>
                {message.app === 'onlyfriends' && message.tip !== undefined && (
                  <span className="phone-social-dm-tip">+{formatBankingAmount(message.tip)} tip</span>
                )}
                <time>
                  {new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
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
        <button type="submit" disabled={disabled || sending || !draft.trim()} aria-label="Send message">
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
