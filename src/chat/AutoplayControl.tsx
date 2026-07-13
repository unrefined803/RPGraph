import { useEffect, useRef, useState } from 'react';
import { autoplayDelayMs } from './useAutoplay';
import type { AutoplayMode } from './useAutoplay';

type AutoplayControlProps = {
  enabled: boolean;
  mode: AutoplayMode;
  countdownActive: boolean;
  countdownId: number;
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

export function AutoplayControl({
  enabled,
  mode,
  countdownActive,
  countdownId,
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
    options?: { note?: string; runnable?: boolean },
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
        {options?.note ? (
          <span className="autoplay-menu-label">
            {label}
            <small>{options.note}</small>
          </span>
        ) : (
          <span>{label}</span>
        )}
      </button>
    );
    if (!options?.runnable) {
      return optionButton;
    }
    return (
      <div className="autoplay-menu-row" role="none">
        {optionButton}
        <button
          className="autoplay-menu-play"
          type="button"
          role="menuitem"
          aria-label={`Run ${label} now`}
          title={`Run ${label} now`}
          disabled={replayDisabled}
          onClick={() => onRunModeNow(optionMode)}
        >
          {playIcon}
        </button>
      </div>
    );
  };

  return (
    <div className="autoplay-control" ref={controlRef}>
      <div className={`autoplay-split-button${enabled ? ' enabled' : ''}${countdownActive ? ' counting' : ''}`}>
        <button
          className="autoplay-toggle"
          type="button"
          aria-pressed={enabled}
          title={enabled ? 'Turn Autoplay off' : 'Turn Autoplay on'}
          onClick={() => onEnabledChange(!enabled)}
        >
          {countdownActive && (
            <span
              className="autoplay-progress"
              key={countdownId}
              style={{ animationDuration: `${autoplayDelayMs}ms` }}
              aria-hidden="true"
            />
          )}
          <span className="autoplay-label">Autoplay</span>
        </button>
        <button
          className="autoplay-settings"
          type="button"
          aria-label="Autoplay settings"
          aria-expanded={menuOpen}
          title="Autoplay settings"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.3l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 1 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.13.65.77 1.08 1.51 1.08H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51.92Z" />
          </svg>
        </button>
      </div>
      {menuOpen && (
        <div className="autoplay-menu" role="menu" aria-label="Autoplay modes">
          <span className="autoplay-menu-heading">Autoplay Modes</span>
          {modeOption('local-activity', 'Local Activity', { runnable: true })}
          {modeOption('remote-activity', 'Remote Activity', { runnable: true })}
          {modeOption('director-mode', 'Director Mode', { note: 'Coming later' })}
        </div>
      )}
    </div>
  );
}
