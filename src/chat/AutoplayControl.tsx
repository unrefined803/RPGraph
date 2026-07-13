import { useEffect, useRef, useState } from 'react';
import type { AutoplayMode } from './useAutoplay';

type AutoplayControlProps = {
  enabled: boolean;
  mode: AutoplayMode;
  replayDisabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onModeChange: (mode: AutoplayMode) => void;
  onRunModeNow: (mode: AutoplayMode) => void;
};

const playIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7L8 5Z" />
  </svg>
);

const pauseIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />
  </svg>
);

export function AutoplayControl({
  enabled,
  mode,
  replayDisabled,
  onEnabledChange,
  onModeChange,
  onRunModeNow,
}: AutoplayControlProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeMenu = (event: PointerEvent) => {
      if (event.target instanceof Node && !controlRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [menuOpen]);

  const modeOption = (
    optionMode: AutoplayMode,
    label: string,
    description: string,
  ) => {
    const selected = mode === optionMode;
    const optionButton = (
      <button
        className={`autoplay-menu-option${selected ? ' active' : ''}`}
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        onClick={() => onModeChange(optionMode)}
      >
        <span className="autoplay-menu-check" aria-hidden="true">
          {selected ? '✓' : ''}
        </span>
        <span>{label}</span>
      </button>
    );
    return (
      <div className="autoplay-menu-row" role="none">
        {optionButton}
        <button
          className="autoplay-menu-help"
          type="button"
          aria-label={`About ${label}`}
          data-tooltip={description}
        >
          ?
        </button>
        <button
          className="autoplay-menu-play"
          type="button"
          role="menuitem"
          aria-label={`Run ${label} now`}
          title={`Run ${label} now`}
          disabled={replayDisabled}
          onClick={() => {
            onRunModeNow(optionMode);
            setMenuOpen(false);
          }}
        >
          {playIcon}
        </button>
      </div>
    );
  };

  return (
    <div className="autoplay-control" ref={controlRef}>
      <div className={`autoplay-split-button${enabled ? ' enabled' : ''}`}>
        <button
          className="autoplay-menu-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Choose or run an Autoplay mode"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <span className="autoplay-label">Autoplay</span>
        </button>
        <button
          className="autoplay-state-toggle"
          type="button"
          aria-label={enabled ? 'Autoplay is playing. Pause Autoplay' : 'Autoplay is paused. Start Autoplay'}
          aria-pressed={enabled}
          title={enabled ? 'Autoplay is playing. Click to pause' : 'Autoplay is paused. Click to play'}
          onClick={() => onEnabledChange(!enabled)}
        >
          {enabled ? playIcon : pauseIcon}
        </button>
      </div>
      {menuOpen && (
        <div className="autoplay-menu" role="menu" aria-label="Autoplay modes">
          <span className="autoplay-menu-heading">
            <span>Autoplay Mode</span>
            <button
              className="autoplay-menu-help"
              type="button"
              aria-label="About Autoplay"
              data-tooltip="After a user turn finishes, Autoplay adds one optional background action to make the world feel more alive."
            >
              ?
            </button>
          </span>
          {modeOption(
            'local-activity',
            'Local Activity',
            'One background beat in or right next to your current scene: nearby characters act, speak, or reach out, so the world around you stays alive without demanding a reply.',
          )}
          {modeOption(
            'remote-activity',
            'Remote Activity',
            'One background beat away from your scene: absent characters talk among themselves, message each other, or pursue their own plans — often reacting to recent events or posts.',
          )}
          {modeOption(
            'story-flow',
            'Story Flow',
            'The balanced default: keeps feeding the current thread while it still has energy, and shifts the focus to other characters when it winds down — earlier background activity pays off.',
          )}
          {modeOption(
            'escalation',
            'Escalation',
            'Pushes the story toward a turning point: builds pressure from established secrets and tensions, continues an ongoing escalation instead of opening a new one, and stops just before a hard decision.',
          )}
        </div>
      )}
    </div>
  );
}
