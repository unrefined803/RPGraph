import { expect, it, vi } from 'vitest';
import type { TurnRecord } from '../types';
import { turnTraceCopyPayload } from './turnTrace';
import { useTurnTraceState } from './useTurnTraceState';

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: <T,>(current: T) => ({ current }),
  useState: <T,>(initial: T) => [initial, vi.fn()],
}));

it('keeps only the latest regenerated trace while preserving earlier turns', () => {
  const state = useTurnTraceState();
  const turn: TurnRecord = {
    id: 'turn-7', number: 7, createdAt: '2026-09-20T08:00:00Z', mode: 'user',
    input: { graphText: 'Input', messages: [] },
    output: { graphText: 'Superseded output', messages: [] },
  };
  const run = { runId: 'original', startedAt: turn.createdAt, calls: [] };
  const earlier = state.recordTurnTrace({
    turn: { ...turn, id: 'turn-6', number: 6, output: { graphText: 'Earlier output', messages: [] } },
    run: { ...run, runId: 'earlier' }, status: 'completed',
  });
  state.recordTurnTrace({ turn, run, status: 'completed' });

  for (const status of ['completed', 'error', 'cancelled', 'completed'] as const) {
    const latest = state.recordTurnTrace({
      turn: { ...turn, output: { graphText: 'Latest output', messages: [] } },
      run: { ...run, runId: `regenerated-${status}` }, status,
    });
    expect(state.turnTracesRef.current).toEqual([earlier, latest]);
    const payload = JSON.stringify(turnTraceCopyPayload(state.turnTracesRef.current));
    expect(payload).not.toContain('Superseded output');
    expect(payload).toContain('Latest output');
    expect(payload).toContain('Earlier output');
  }
});
