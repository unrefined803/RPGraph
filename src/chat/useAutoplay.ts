import { useCallback, useEffect, useRef, useState } from 'react';
import {
  autoplayMessageFormat,
  localActivityPromptSlot,
  remoteActivityPromptSlot,
} from './messageFormats';

const autoplayEnabledStorageKey = 'rpgraph-autoplay-enabled';
const autoplayModeStorageKey = 'rpgraph-autoplay-mode';

export const autoplayDelayMs = 3000;

export type AutoplayMode = 'local-activity' | 'remote-activity' | 'director-mode';

export type AutoplayRunRequest = {
  playerCharacterName: string;
  promptSlot: number;
};

type AutoplayCommittedRun = {
  messageFormat: number;
  playerCharacterName: string;
};

type UseAutoplayOptions = {
  isRunning: boolean;
  runAutoplay: (request: AutoplayRunRequest) => Promise<boolean>;
};

const runnableModeSlots: Partial<Record<AutoplayMode, number>> = {
  'local-activity': localActivityPromptSlot,
  'remote-activity': remoteActivityPromptSlot,
};

function storedBoolean(key: string, fallback: boolean) {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

function storeBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Non-critical UI preference.
  }
}

function storedMode(fallback: AutoplayMode): AutoplayMode {
  try {
    const stored = window.localStorage.getItem(autoplayModeStorageKey);
    return stored === 'local-activity' || stored === 'remote-activity' || stored === 'director-mode'
      ? stored
      : fallback;
  } catch {
    return fallback;
  }
}

export function useAutoplay({ isRunning, runAutoplay }: UseAutoplayOptions) {
  const [enabled, setEnabledState] = useState(() => storedBoolean(autoplayEnabledStorageKey, false));
  const [mode, setModeState] = useState<AutoplayMode>(() => storedMode('local-activity'));
  const [countdownId, setCountdownId] = useState(0);
  const [countdownActive, setCountdownActive] = useState(false);
  const countdownTimerRef = useRef<number | null>(null);
  const previousIsRunningRef = useRef(isRunning);

  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current !== null) {
      window.clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdownActive(false);
  }, []);

  const scheduleAutoplay = useCallback((playerCharacterName: string) => {
    cancelCountdown();
    const promptSlot = runnableModeSlots[mode];
    if (!enabled || promptSlot === undefined) {
      return;
    }
    setCountdownId((current) => current + 1);
    setCountdownActive(true);
    countdownTimerRef.current = window.setTimeout(() => {
      countdownTimerRef.current = null;
      setCountdownActive(false);
      void runAutoplay({ playerCharacterName, promptSlot });
    }, autoplayDelayMs);
  }, [cancelCountdown, enabled, mode, runAutoplay]);

  const onRunCommitted = useCallback(({ messageFormat, playerCharacterName }: AutoplayCommittedRun) => {
    if (messageFormat === autoplayMessageFormat) {
      return;
    }
    scheduleAutoplay(playerCharacterName);
  }, [scheduleAutoplay]);

  const runModeNow = useCallback((runMode: AutoplayMode, playerCharacterName: string) => {
    const promptSlot = runnableModeSlots[runMode];
    if (isRunning || promptSlot === undefined || !playerCharacterName.trim()) {
      return;
    }
    cancelCountdown();
    void runAutoplay({ playerCharacterName, promptSlot });
  }, [cancelCountdown, isRunning, runAutoplay]);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    storeBoolean(autoplayEnabledStorageKey, value);
    if (!value) {
      cancelCountdown();
    }
  }, [cancelCountdown]);

  const setMode = useCallback((value: AutoplayMode) => {
    setModeState(value);
    try {
      window.localStorage.setItem(autoplayModeStorageKey, value);
    } catch {
      // Non-critical UI preference.
    }
    // A pending countdown would still fire the previous mode's prompt slot.
    cancelCountdown();
  }, [cancelCountdown]);

  useEffect(() => {
    if (isRunning && !previousIsRunningRef.current) {
      cancelCountdown();
    }
    previousIsRunningRef.current = isRunning;
  }, [cancelCountdown, isRunning]);

  useEffect(() => cancelCountdown, [cancelCountdown]);

  return {
    enabled,
    setEnabled,
    mode,
    setMode,
    countdownActive,
    countdownId,
    cancelCountdown,
    onRunCommitted,
    runModeNow,
  };
}
