import { useCallback, useEffect, useRef, useState } from 'react';
import { autoplayMessageFormat } from './messageFormats';

const autoplayEnabledStorageKey = 'rpgraph-autoplay-enabled';
const chainReactionsEnabledStorageKey = 'rpgraph-autoplay-chain-reactions-enabled';
const directorModeEnabledStorageKey = 'rpgraph-autoplay-director-mode-enabled';

export const autoplayDelayMs = 3000;

export type AutoplayRunRequest = {
  playerCharacterName: string;
};

type AutoplayCommittedRun = {
  messageFormat: number;
  playerCharacterName: string;
};

type UseAutoplayOptions = {
  isRunning: boolean;
  runAutoplay: (request: AutoplayRunRequest) => Promise<boolean>;
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

export function useAutoplay({ isRunning, runAutoplay }: UseAutoplayOptions) {
  const [enabled, setEnabledState] = useState(() => storedBoolean(autoplayEnabledStorageKey, false));
  const [chainReactionsEnabled, setChainReactionsEnabledState] = useState(() =>
    storedBoolean(chainReactionsEnabledStorageKey, true),
  );
  const [directorModeEnabled, setDirectorModeEnabledState] = useState(() =>
    storedBoolean(directorModeEnabledStorageKey, false),
  );
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
    if (!enabled || !chainReactionsEnabled) {
      return;
    }
    setCountdownId((current) => current + 1);
    setCountdownActive(true);
    countdownTimerRef.current = window.setTimeout(() => {
      countdownTimerRef.current = null;
      setCountdownActive(false);
      void runAutoplay({ playerCharacterName });
    }, autoplayDelayMs);
  }, [cancelCountdown, chainReactionsEnabled, enabled, runAutoplay]);

  const onRunCommitted = useCallback(({ messageFormat, playerCharacterName }: AutoplayCommittedRun) => {
    if (messageFormat === autoplayMessageFormat) {
      return;
    }
    scheduleAutoplay(playerCharacterName);
  }, [scheduleAutoplay]);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    storeBoolean(autoplayEnabledStorageKey, value);
    if (!value) {
      cancelCountdown();
    }
  }, [cancelCountdown]);

  const setChainReactionsEnabled = useCallback((value: boolean) => {
    setChainReactionsEnabledState(value);
    storeBoolean(chainReactionsEnabledStorageKey, value);
    if (!value) {
      cancelCountdown();
    }
  }, [cancelCountdown]);

  const setDirectorModeEnabled = useCallback((value: boolean) => {
    setDirectorModeEnabledState(value);
    storeBoolean(directorModeEnabledStorageKey, value);
  }, []);

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
    chainReactionsEnabled,
    setChainReactionsEnabled,
    directorModeEnabled,
    setDirectorModeEnabled,
    countdownActive,
    countdownId,
    cancelCountdown,
    onRunCommitted,
  };
}
