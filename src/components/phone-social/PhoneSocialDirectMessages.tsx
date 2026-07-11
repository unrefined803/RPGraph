import { type FormEvent, useMemo, useState } from 'react';
import type { StorybookCharacter } from '../../storybook/runtime';
import type { SocialAppKind, SocialDirectMessageRecord } from '../../types';
import { CharacterAvatar } from '../CharacterAvatar';

export type SocialDirectMessageParticipant = {
  key: string;
  name: string;
  handle: string;
  character?: StorybookCharacter;
};

type PhoneSocialDirectMessagesProps = {
  app: SocialAppKind;
  owner: StorybookCharacter;
  ownerHandle: string;
  participants: SocialDirectMessageParticipant[];
  selectedParticipant?: SocialDirectMessageParticipant;
  messages: SocialDirectMessageRecord[];
  characterColors: Map<string, string>;
  disabled?: boolean;
  onSelectParticipant: (participant: SocialDirectMessageParticipant) => void;
  onCloseConversation: () => void;
  onBack: () => void;
  onSend: (message: SocialDirectMessageRecord) => void;
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
  disabled = false,
  onSelectParticipant,
  onCloseConversation,
  onBack,
  onSend,
}: PhoneSocialDirectMessagesProps) {
  const [draft, setDraft] = useState('');
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

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedParticipant || !text || disabled) {
      return;
    }
    const sequence = messages.length + 1;
    onSend({
      app,
      messageId: `${app}-dm-${Date.now()}-${sequence}`,
      from: owner.name,
      fromHandle: ownerHandle,
      to: selectedParticipant.name,
      toHandle: selectedParticipant.handle,
      text,
      sentAt: new Date().toISOString(),
    });
    setDraft('');
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
                identityMatches(message.fromHandle, participant.handle) ||
                identityMatches(message.toHandle, participant.handle)
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
                  <span>{latest?.text ?? `@${participant.handle}`}</span>
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
      <div className="phone-social-dm-thread">
        {conversation.length === 0 && (
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
        {conversation.map((message) => {
          const outgoing = identityMatches(message.fromHandle, ownerHandle);
          return (
            <div className={`phone-social-dm-message-row ${outgoing ? 'outgoing' : 'incoming'}`} key={message.messageId}>
              <div className="phone-social-dm-bubble">
                <span>{message.text}</span>
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
        <button type="submit" disabled={disabled || !draft.trim()} aria-label="Send message">Send</button>
      </form>
    </section>
  );
}
