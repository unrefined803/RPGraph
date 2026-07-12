import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  chatGpdModels,
  type ChatGpdModel,
  type ChatGpdPhoneApp,
} from '../chat/useChatGpdPhoneApp';

type PhoneChatGpdScreenProps = {
  chatGpd: ChatGpdPhoneApp;
  onBack: () => void;
};

export function PhoneChatGpdScreen({ chatGpd, onBack }: PhoneChatGpdScreenProps) {
  const { messages, model, isSending, nodeAvailable } = chatGpd;
  const [draft, setDraft] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, isSending]);

  useEffect(() => {
    if (!modelMenuOpen) {
      return;
    }
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && !modelMenuRef.current?.contains(event.target)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [modelMenuOpen]);

  function selectModel(nextModel: ChatGpdModel) {
    chatGpd.selectModel(nextModel);
    setModelMenuOpen(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isSending) {
      return;
    }
    setDraft('');
    void chatGpd.sendMessage(text);
  }

  return (
    <div className="phone-chatgpd-screen" aria-label="ChatGPD">
      <header className="phone-gallery-header">
        <button type="button" onClick={onBack} aria-label="Back" title="Back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="phone-chatgpd-model" ref={modelMenuRef}>
          <button
            type="button"
            className="phone-chatgpd-model-button"
            onClick={() => setModelMenuOpen((open) => !open)}
            aria-expanded={modelMenuOpen}
            aria-label="Select model"
          >
            <strong>{model}</strong>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {modelMenuOpen && (
            <div className="phone-chatgpd-model-menu" role="menu" aria-label="Models">
              {chatGpdModels.map((entry) => (
                <button
                  type="button"
                  className={entry === model ? 'active' : ''}
                  key={entry}
                  onClick={() => selectModel(entry)}
                >
                  <span>{entry}</span>
                  {entry === model && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="phone-chatgpd-clear-button"
          onClick={chatGpd.clearConversation}
          disabled={messages.length === 0 || isSending}
          aria-label="New chat"
          title="New chat"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </header>
      <div className="phone-chatgpd-thread" ref={threadRef}>
        {messages.length === 0 && (
          <div className="phone-chatgpd-empty">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7Z" />
              <path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9Z" />
            </svg>
            <span>How can I help you today?</span>
            {!nodeAvailable && (
              <small>Add a Phone Apps node to the workflow to choose the provider.</small>
            )}
          </div>
        )}
        {messages.map((message) => (
          <div
            className={`phone-chatgpd-bubble ${message.role}`}
            key={message.id}
          >
            {message.text}
          </div>
        ))}
        {isSending && (
          <div className="phone-chatgpd-bubble assistant pending">
            <span className="phone-chatgpd-typing" aria-label="ChatGPD is answering">
              <i /><i /><i />
            </span>
          </div>
        )}
      </div>
      <form className="phone-chatgpd-composer" onSubmit={submit}>
        <input
          type="text"
          value={draft}
          placeholder={`Message ${model}`}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!draft.trim() || isSending} aria-label="Send message" title="Send message">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </form>
    </div>
  );
}
