import { useCallback, useEffect, useRef, useState } from 'react';
import {
  autoplayMessageFormat,
  escalationPromptSlot,
  localActivityPromptSlot,
  remoteActivityPromptSlot,
  storyFlowPromptSlot,
} from './messageFormats';

const autoplayEnabledStorageKey = 'rpgraph-autoplay-enabled';
const autoplayModeStorageKey = 'rpgraph-autoplay-mode';

export type AutoplayMode = 'local-activity' | 'remote-activity' | 'story-flow' | 'escalation';

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
  cancelAutoplayRun: () => void;
};

const runnableModeSlots: Record<AutoplayMode, number> = {
  'local-activity': localActivityPromptSlot,
  'remote-activity': remoteActivityPromptSlot,
  'story-flow': storyFlowPromptSlot,
  'escalation': escalationPromptSlot,
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
    return stored && stored in runnableModeSlots ? (stored as AutoplayMode) : fallback;
  } catch {
    return fallback;
  }
}

export function useAutoplay({ isRunning, runAutoplay, cancelAutoplayRun }: UseAutoplayOptions) {
  const [enabled, setEnabledState] = useState(() => storedBoolean(autoplayEnabledStorageKey, false));
  const [mode, setModeState] = useState<AutoplayMode>(() => storedMode('story-flow'));
  const enabledRef = useRef(enabled);
  const modeRef = useRef(mode);
  const pendingAutoplayRef = useRef<number | null>(null);
  const autoplayRunActiveRef = useRef(false);
  const previousIsRunningRef = useRef(isRunning);

  const cancelPendingAutoplay = useCallback(() => {
    if (pendingAutoplayRef.current !== null) {
      window.clearTimeout(pendingAutoplayRef.current);
      pendingAutoplayRef.current = null;
    }
  }, []);

  const scheduleAutoplay = useCallback((playerCharacterName: string) => {
    cancelPendingAutoplay();
    if (!enabledRef.current) {
      return;
    }
    const promptSlot = runnableModeSlots[modeRef.current];
    pendingAutoplayRef.current = window.setTimeout(() => {
      pendingAutoplayRef.current = null;
      if (!enabledRef.current) {
        return;
      }
      autoplayRunActiveRef.current = true;
      void runAutoplay({ playerCharacterName, promptSlot }).finally(() => {
        autoplayRunActiveRef.current = false;
      });
    }, 0);
  }, [cancelPendingAutoplay, runAutoplay]);

  const onRunCommitted = useCallback(({ messageFormat, playerCharacterName }: AutoplayCommittedRun) => {
    if (messageFormat === autoplayMessageFormat) {
      return;
    }
    scheduleAutoplay(playerCharacterName);
  }, [scheduleAutoplay]);

  const runModeNow = useCallback((runMode: AutoplayMode, playerCharacterName: string) => {
    const promptSlot = runnableModeSlots[runMode];
    if (isRunning || !playerCharacterName.trim()) {
      return;
    }
    cancelPendingAutoplay();
    void runAutoplay({ playerCharacterName, promptSlot });
  }, [cancelPendingAutoplay, isRunning, runAutoplay]);

  const setEnabled = useCallback((value: boolean) => {
    enabledRef.current = value;
    setEnabledState(value);
    storeBoolean(autoplayEnabledStorageKey, value);
    if (!value) {
      cancelPendingAutoplay();
      if (autoplayRunActiveRef.current) {
        cancelAutoplayRun();
      }
    }
  }, [cancelAutoplayRun, cancelPendingAutoplay]);

  const setMode = useCallback((value: AutoplayMode) => {
    modeRef.current = value;
    setModeState(value);
    try {
      window.localStorage.setItem(autoplayModeStorageKey, value);
    } catch {
      // Non-critical UI preference.
    }
    cancelPendingAutoplay();
  }, [cancelPendingAutoplay]);

  useEffect(() => {
    if (isRunning && !previousIsRunningRef.current) {
      cancelPendingAutoplay();
    }
    previousIsRunningRef.current = isRunning;
  }, [cancelPendingAutoplay, isRunning]);

  useEffect(() => cancelPendingAutoplay, [cancelPendingAutoplay]);

  return {
    enabled,
    setEnabled,
    mode,
    setMode,
    cancelPendingAutoplay,
    onRunCommitted,
    runModeNow,
  };
}
