/** Monotonic execution time, excluding pauses for human input. */
export function createRunClock(now: () => number) {
  let startTimeMs = now();
  let pausedAt: number | null = null;
  return {
    startTimeMs: () => startTimeMs,
    elapsedMs: () => (pausedAt ?? now()) - startTimeMs,
    pause: () => { pausedAt ??= now(); },
    resume: () => {
      if (pausedAt === null) return;
      startTimeMs += now() - pausedAt;
      pausedAt = null;
    },
  };
}
