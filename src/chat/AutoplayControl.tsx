import { useEffect, useRef, useState } from 'react';
import type { AutoplayMode } from './useAutoplay';

type AutoplayControlProps = {
  replayDisabled: boolean;
  onRunModeNow: (mode: AutoplayMode) => void;
};

const playIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7L8 5Z" />
  </svg>
);

export function AutoplayControl({
  replayDisabled,
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
    return (
      <div className="autoplay-menu-row" role="none">
        <button
          className="autoplay-menu-help"
          type="button"
          aria-label={`About ${label}`}
          data-tooltip={description}
        >
          ?
        </button>
        <button
          className="autoplay-menu-option"
          type="button"
          role="menuitem"
          aria-label={`Run ${label} now`}
          disabled={replayDisabled}
          onClick={() => {
            onRunModeNow(optionMode);
            setMenuOpen(false);
          }}
        >
          <span>{label}</span>
          {playIcon}
        </button>
      </div>
    );
  };

  return (
    <div className="autoplay-control" ref={controlRef}>
      <div className="autoplay-pill">
        <button
          className="autoplay-menu-trigger"
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Run an Autoplay mode"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <span className="autoplay-label">Autoplay</span>
        </button>
      </div>
      {menuOpen && (
        <div className="autoplay-menu" role="menu" aria-label="Autoplay modes">
          <span className="autoplay-menu-heading">
            <span>Autoplay Mode</span>
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
