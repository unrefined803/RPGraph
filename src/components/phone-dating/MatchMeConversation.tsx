import { CharacterAvatar } from '../CharacterAvatar';
import { useEffect, useRef, useState } from 'react';
import type { DatingMessage } from '../../chat/datingMessages';

type Props = {
  name: string;
  avatarDataUrl?: string;
  busy: boolean;
  age: number;
  messages: DatingMessage[];
  draft: string;
  onDraftChange: (text: string) => void;
  emojiOptions: string[];
  recentEmojis: string[];
  onUseEmoji: (emoji: string) => void;
  onSend: () => void;
  onBack: () => void;
};

export function MatchMeConversation({ busy, name, avatarDataUrl, age, messages, draft, onDraftChange, emojiOptions, recentEmojis, onUseEmoji, onSend, onBack }: Props) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!emojiOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !emojiRef.current?.contains(event.target)) setEmojiOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setEmojiOpen(false); inputRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [emojiOpen]);

  function selectEmoji(emoji: string) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? draft.length;
    const end = input?.selectionEnd ?? start;
    const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    if (next.length > 4000) return;
    onDraftChange(next);
    onUseEmoji(emoji);
    setEmojiOpen(false);
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + emoji.length, start + emoji.length); });
  }

  return <section className="phone-social-dm pt-conversation" aria-label={`Conversation with ${name}`}>
    <header className="phone-social-dm-header conversation">
      <button type="button" onClick={onBack} aria-label="Back to Discover">‹</button>
      <CharacterAvatar className="pt-match-avatar" name={name} profileImageDataUrl={avatarDataUrl} fallback={name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')} />
      <div><strong>{name}, {age}</strong><span>Active match · Private conversation</span></div>
    </header>
    <div className="phone-social-dm-thread" ref={threadRef} role="log" aria-label={`Messages with ${name}`} aria-live="polite" aria-relevant="additions">
      {!messages.length && <div className="phone-social-dm-empty conversation-empty">
        <CharacterAvatar className="pt-match-avatar" name={name} profileImageDataUrl={avatarDataUrl} fallback={name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')} />
        <strong>You matched with {name}</strong><small>Say hello or break the ice with an emoji.</small>
      </div>}
      {messages.map((message) => <div key={message.id} className={`phone-social-dm-message-row ${message.sender === 'owner' ? 'outgoing' : 'incoming'}`}>
        <div className="phone-social-dm-bubble"><span>{message.text}</span>
          <time dateTime={message.sentAt}>{message.demo ? 'Demo reply · ' : ''}{new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
      </div>)}
    </div>
    <form className="phone-social-dm-composer" onSubmit={(event) => { event.preventDefault(); if (draft.trim() && !busy) onSend(); }}>
      <input ref={inputRef} type="text" aria-label={`Message ${name}`} placeholder="Message…" maxLength={4000} value={draft}
        onChange={(event) => onDraftChange(event.target.value)} autoFocus />
      <div className="phone-social-dm-emoji-menu" ref={emojiRef}>
        <button type="button" className="phone-social-dm-emoji-button" aria-label="Open emoji picker" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(!emojiOpen)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01" />
          </svg>
        </button>
        {emojiOpen && <div className="phone-social-dm-emoji-picker" role="group" aria-label="Choose an emoji">
          {!!recentEmojis.length && <><small>Recent</small><div className="phone-social-dm-emoji-grid recent">
            {recentEmojis.map((emoji) => <button type="button" key={emoji} onClick={() => selectEmoji(emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}
          </div></>}
          <div className="phone-social-dm-emoji-grid">{emojiOptions.map((emoji) => <button type="button" key={emoji} onClick={() => selectEmoji(emoji)} aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>
        </div>}
      </div>
      <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message">{busy ? 'Replying…' : 'Send'}</button>
    </form>
  </section>;
}
