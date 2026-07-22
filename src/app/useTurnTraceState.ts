import { useRef, useState } from 'react';
import {
  createTurnTrace,
  type TurnTrace,
} from './turnTrace';

type CreateTurnTraceInput = Parameters<typeof createTurnTrace>[0];

// Traces hold full prompt passes and live only in memory, so long sessions
// would grow without bound; keep the most recent turns only.
const maxTracedTurns = 30;

function pruneToRecentTurns(traces: TurnTrace[]) {
  const recentTurnNumbers = new Set(
    Array.from(new Set(traces.map((trace) => trace.turnNumber)))
      .sort((left, right) => right - left)
      .slice(0, maxTracedTurns),
  );
  return traces.filter((trace) => recentTurnNumbers.has(trace.turnNumber));
}

export function useTurnTraceState() {
  const [turnTraces, setTurnTracesState] = useState<TurnTrace[]>([]);
  const turnTracesRef = useRef(turnTraces);

  // All writes go through this setter so the ref stays in sync with the state.
  function setTurnTraces(next: TurnTrace[]) {
    turnTracesRef.current = next;
    setTurnTracesState(next);
  }

  function recordTurnTrace(input: CreateTurnTraceInput) {
    const trace = createTurnTrace(input);
    const retained = trace.status === 'completed'
      ? turnTracesRef.current.filter(
          (entry) => entry.turnId !== trace.turnId || entry.status !== 'completed',
        )
      : turnTracesRef.current;
    setTurnTraces(pruneToRecentTurns([...retained, trace]));
    return trace;
  }

  function removeTurnTracesForTurn(turnId: string) {
    setTurnTraces(turnTracesRef.current.filter((trace) => trace.turnId !== turnId));
  }

  function clearTurnTraces() {
    setTurnTraces([]);
  }

  return {
    turnTraces,
    turnTracesRef,
    recordTurnTrace,
    removeTurnTracesForTurn,
    clearTurnTraces,
  };
}
