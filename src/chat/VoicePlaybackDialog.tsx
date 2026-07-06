import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { DialogueVoiceMode } from '../types';

type VoicePlaybackDialogProps = {
  mode: DialogueVoiceMode;
  onModeChange: (mode: DialogueVoiceMode) => void;
  preloadDisabledReason: string | null;
  readAloudDisabledReason: string | null;
  narratorOnlyDisabledReason: string | null;
  narratorProviderOptions: Array<{ value: string; label: string }>;
  narratorProviderId: string;
  onNarratorProviderChange: (providerId: string) => void;
  cloneVoiceProviderOptions: Array<{ value: string; label: string }>;
  cloneVoiceProviderId: string;
  onCloneVoiceProviderChange: (providerId: string) => void;
  onConfigureOpenRouterTts: () => void;
  onClose: () => void;
};

const voiceModes: Array<{
  id: DialogueVoiceMode;
  title: string;
  description: string;
}> = [
  {
    id: 'click',
    title: 'Generate On Click (ComfyUI)',
    description: 'Click highlighted character dialogue to generate and play only that spoken line.',
  },
  {
    id: 'preload',
    title: 'Preload Voices (ComfyUI)',
    description: 'Generate character dialogue clips after each turn so later clicks can play immediately.',
  },
  {
    id: 'read-aloud',
    title: 'Read Aloud Automatically (ComfyUI)',
    description: 'Read narration and dialogue in sequence with the ComfyUI narrator and cloned character voices.',
  },
  {
    id: 'narrator-only',
    title: 'Narrator Only (API + ComfyUI)',
    description: 'Read each complete output bubble with one selected ComfyUI or API narrator voice.',
  },
];

export function VoicePlaybackDialog({
  mode,
  onModeChange,
  preloadDisabledReason,
  readAloudDisabledReason,
  narratorOnlyDisabledReason,
  narratorProviderOptions,
  narratorProviderId,
  onNarratorProviderChange,
  cloneVoiceProviderOptions,
  cloneVoiceProviderId,
  onCloneVoiceProviderChange,
  onConfigureOpenRouterTts,
  onClose,
}: VoicePlaybackDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const disabledReasonForMode = (candidate: DialogueVoiceMode) => {
    if (candidate === 'preload') return preloadDisabledReason;
    if (candidate === 'read-aloud') return readAloudDisabledReason;
    if (candidate === 'narrator-only') return narratorOnlyDisabledReason;
    return null;
  };

  return createPortal(
    <div className="dialog-backdrop voice-playback-dialog-backdrop" onMouseDown={onClose}>
      <section
        className="voice-playback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-playback-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="voice-playback-dialog-header">
          <div>
            <h2 id="voice-playback-dialog-title">Voice Playback</h2>
            <p>Choose how RPGraph turns roleplay output into speech.</p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>Close</button>
        </header>

        <div className="voice-playback-dialog-body">
          <div className="voice-playback-mode-list" role="radiogroup" aria-label="Voice playback mode">
            {voiceModes.map((entry) => {
              const disabledReason = disabledReasonForMode(entry.id);
              return (
                <button
                  type="button"
                  className={`voice-playback-mode-card${mode === entry.id ? ' active' : ''}`}
                  role="radio"
                  aria-checked={mode === entry.id}
                  disabled={disabledReason !== null}
                  title={disabledReason ?? undefined}
                  key={entry.id}
                  onClick={() => onModeChange(entry.id)}
                >
                  <span className="voice-playback-mode-check" aria-hidden="true">
                    {mode === entry.id ? '●' : '○'}
                  </span>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>{disabledReason ?? entry.description}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <aside className="voice-playback-setup-panel">
            {mode === 'narrator-only' ? (
              <>
                <div className="voice-playback-setup-section">
                  <h3>Narrator provider</h3>
                  <p>Reads the complete chat bubble with one selected API or ComfyUI voice.</p>
                  <label htmlFor="voice-playback-narrator-provider">Provider and voice</label>
                  <select
                    id="voice-playback-narrator-provider"
                    value={narratorProviderId}
                    disabled={narratorProviderOptions.length === 0}
                    onChange={(event) => onNarratorProviderChange(event.target.value)}
                  >
                    {narratorProviderOptions.length === 0 ? (
                      <option value="">No narrator provider ready</option>
                    ) : narratorProviderOptions.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div className="voice-playback-setup-section">
                  <h3>API narrator setup</h3>
                  <ol>
                    <li>Create a dedicated OpenRouter TTS provider.</li>
                    <li>
                      Select{' '}
                      <button
                        type="button"
                        className="voice-playback-provider-link"
                        onClick={() => {
                          onClose();
                          onConfigureOpenRouterTts();
                        }}
                      >
                        <code>google/gemini-3.1-flash-tts-preview</code>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M14 5h5v5" />
                          <path d="M10 14 19 5" />
                          <path d="M19 13v6H5V5h6" />
                        </svg>
                      </button>
                      {' '}or another speech-only model.
                    </li>
                    <li>Choose its voice and optional delivery settings.</li>
                    <li>Click <strong>Set Narrator Only model</strong>.</li>
                  </ol>
                </div>
              </>
            ) : (
              <div className="voice-playback-setup-section">
                <h3>Cloned character voices</h3>
                <p>
                  Select the ComfyUI Voice provider used to clone character voices from the MP3
                  samples stored in Storybook character setup.
                </p>
                <label htmlFor="voice-playback-clone-provider">ComfyUI Voice provider</label>
                <select
                  id="voice-playback-clone-provider"
                  value={cloneVoiceProviderId}
                  disabled={cloneVoiceProviderOptions.length === 0}
                  onChange={(event) => onCloneVoiceProviderChange(event.target.value)}
                >
                  {cloneVoiceProviderOptions.length === 0 ? (
                    <option value="">No ComfyUI Voice provider ready</option>
                  ) : cloneVoiceProviderOptions.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
                <p>
                  Upload or replace each character's MP3 sample in Storybook → Character Setup →
                  Voice Setup.
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  );
}
