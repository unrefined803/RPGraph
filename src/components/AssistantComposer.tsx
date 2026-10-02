import type { FormEventHandler, ReactNode } from 'react';

type Props = {
  children: ReactNode;
  actions?: ReactNode;
  /** Secondary actions placed directly beside the send button. */
  sendActions?: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  disabled: boolean;
  busy?: boolean;
  onCancel?: () => void;
};

/** Shared input frame and actions, based on the Image Generation Assistant. */
export function AssistantComposer({ children, actions, sendActions, onSubmit, disabled, busy = false, onCancel }: Props) {
  const canCancel = busy && !!onCancel;
  return (
    <form className="storybook-chat-form assistant-chat-form" onSubmit={onSubmit}>
      <div className="image-chat-input-box">
        {children}
        <div className="image-chat-input-toolbar">
          <div className="image-chat-input-left">{actions}</div>
          <div className="image-chat-input-right">
            {sendActions}
            <button
              type={canCancel ? 'button' : 'submit'}
              className={`image-chat-send-btn${canCancel ? ' cancel' : ''}`}
              disabled={canCancel ? false : disabled || busy}
              onClick={canCancel ? onCancel : undefined}
              title={canCancel ? 'Cancel request' : 'Send message (Enter)'}
            >
              <span>{canCancel ? 'Cancel' : busy ? 'Sending...' : 'Send'}</span>
              {canCancel ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /></svg> : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
