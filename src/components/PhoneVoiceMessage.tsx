import { useState } from 'react';
import { DarkAudioPlayer } from './DarkAudioPlayer';

// WhatsApp-style voice message bar for the Phone tab. The clip is generated
// on demand from the message text and the sender's reference voice; when
// anything fails, the bubble falls back to showing the plain message text.
export function PhoneVoiceMessage({
  text,
  clipDataUrl,
  disabled,
  disabledReason,
  onGenerateClip,
}: {
  text: string;
  clipDataUrl?: string;
  disabled: boolean;
  disabledReason?: string;
  onGenerateClip: () => Promise<string | null>;
}) {
  const [generatedClipDataUrl, setGeneratedClipDataUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const playableClipDataUrl = generatedClipDataUrl ?? clipDataUrl ?? null;

  async function generate() {
    if (generating || disabled) {
      return;
    }
    setGenerating(true);
    try {
      const clip = await onGenerateClip();
      if (clip) {
        setGeneratedClipDataUrl(clip);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setGenerating(false);
    }
  }

  if (failed) {
    return <span>{text}</span>;
  }
  if (playableClipDataUrl) {
    return (
      <DarkAudioPlayer
        src={playableClipDataUrl}
        title="Voice message"
        className="phone-voice-message-player"
        autoPlay={!!generatedClipDataUrl}
      />
    );
  }
  return (
    <div className="dark-audio-player phone-voice-message-player pending">
      <div className="dark-audio-controls">
        <button
          type="button"
          className="dark-audio-play-btn nodrag"
          onClick={() => void generate()}
          disabled={disabled || generating}
          aria-label="Generate and play voice message"
          title={disabled ? disabledReason : 'Generate and play the voice message'}
        >
          {generating ? (
            <span className="phone-voice-message-spinner" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className="dark-audio-track-container">
          <div className="dark-audio-info-row">
            <span className="dark-audio-title">Voice message</span>
            <span className="dark-audio-time">{generating ? 'Generating ...' : '-:--'}</span>
          </div>
          <div className="dark-audio-slider-wrapper">
            <input
              type="range"
              className="dark-audio-slider nodrag"
              min={0}
              max={100}
              value={0}
              readOnly
              disabled
            />
          </div>
        </div>
      </div>
    </div>
  );
}
