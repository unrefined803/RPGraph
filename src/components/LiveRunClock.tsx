import { useEffect, useState } from 'react';

function formatRuntimeSeconds(durationMs: number) {
  return (durationMs / 1000).toFixed(2);
}

/**
 * Self-contained live run timer.
 *
 * While `isRunning`, an interval ticks LOCAL state, so only this small leaf
 * re-renders — never the whole app. It replaces a former App-level 50ms
 * `setRunDurationMs` interval (useRunLifecycle) that updated App state 20x per
 * second and thereby re-rendered the entire conversation on every tick. On a
 * large session a single such render takes ~750ms, so those renders ran
 * back-to-back and pegged the main thread for the whole run — freezing the UI,
 * worst during long no-stream waits (e.g. a custom node's internal LLM call).
 *
 * The elapsed time is always derived from `startTimeMs` (the run's real start
 * on the `performance.now()` clock), never from this component's mount time.
 * That keeps every instance in sync and correct even when one mounts mid-run,
 * e.g. inside the run report dialog. When not running, it shows the final
 * duration passed in `finalMs`.
 */
export function LiveRunClock({
  isRunning,
  startTimeMs,
  finalMs,
}: {
  isRunning: boolean;
  startTimeMs: number | null;
  finalMs: number;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!isRunning || startTimeMs === null) {
      return;
    }
    const update = () => setElapsedMs(performance.now() - startTimeMs);
    // Immediate async tick so an instance mounted mid-run (e.g. the report
    // dialog) shows the true elapsed time right away, not after 200ms.
    const timeoutId = window.setTimeout(update, 0);
    const intervalId = window.setInterval(update, 200);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [isRunning, startTimeMs]);

  return <>{formatRuntimeSeconds(isRunning ? elapsedMs : finalMs)}</>;
}
