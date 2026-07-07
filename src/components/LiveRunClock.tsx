import { useEffect, useRef, useState } from 'react';

function formatRuntimeSeconds(durationMs: number) {
  return (durationMs / 1000).toFixed(2);
}

/**
 * Self-contained live run timer.
 *
 * While `isRunning`, this ticks its OWN local state, so only this small leaf
 * re-renders — never the whole app. It replaces a former App-level 50ms
 * `setRunDurationMs` interval (useRunLifecycle) that updated App state 20x per
 * second and thereby re-rendered the entire conversation on every tick. On a
 * large session a single such render takes ~750ms, so those renders ran
 * back-to-back and pegged the main thread for the whole run — freezing the UI,
 * worst during long no-stream waits (e.g. a custom node's internal LLM call).
 *
 * When not running, it shows the final duration passed in `finalMs`.
 */
export function LiveRunClock({ isRunning, finalMs }: { isRunning: boolean; finalMs: number }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isRunning) {
      startRef.current = null;
      return;
    }
    startRef.current = performance.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      if (startRef.current !== null) {
        setElapsedMs(performance.now() - startRef.current);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [isRunning]);

  return <>{formatRuntimeSeconds(isRunning ? elapsedMs : finalMs)}</>;
}
