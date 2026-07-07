import { useRef, useState } from 'react';
import type {
  LlmRunHistoryEntry,
  RunLlmReport,
} from '../components/AppDialogs';
import type { LastRunDebug } from './debugSnapshot';
import type {
  ActiveRun,
  CancelReason,
} from './useGraphRun';

export function useRunLifecycle() {
  const [isRunning, setIsRunning] = useState(false);
  const [runLlmReport, setRunLlmReport] = useState<RunLlmReport | null>(null);
  const [showRunLlmReport, setShowRunLlmReport] = useState(false);
  const [runDurationMs, setRunDurationMs] = useState<number>(0);
  const [runHistory, setRunHistory] = useState<LlmRunHistoryEntry[]>([]);
  const [workflowComfyGenerationActive, setWorkflowComfyGenerationActive] = useState(false);
  const workflowComfyGenerationActiveCountRef = useRef(0);
  const activeRun = useRef<ActiveRun | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const lastRunDebugRef = useRef<LastRunDebug | null>(null);
  const activeRunCancelReason = useRef<CancelReason>('cancel');
  const activeRunLlmReport = useRef<RunLlmReport | null>(null);
  const pendingRunRestart = useRef<(() => void) | null>(null);
  const runStartTimeRef = useRef<number | null>(null);
  const runEndTimeRef = useRef<number | null>(null);
  // Render-safe mirror of runStartTimeRef for the <LiveRunClock> instances
  // (React forbids reading refs during render).
  const [runStartTimeMs, setRunStartTimeMs] = useState<number | null>(null);

  // NOTE: the live run-duration display is driven by the self-contained
  // <LiveRunClock> leaf component, NOT by an App-level interval. A former 50ms
  // setRunDurationMs interval here re-rendered the ENTIRE app (incl. the whole
  // conversation) 20x/second; on a large session each render takes ~750ms, so
  // they ran back-to-back and pegged the main thread for the whole run, freezing
  // the tab. The final duration is set once in runGraph's finishRun().

  function updateWorkflowComfyGenerationActive(active: boolean) {
    workflowComfyGenerationActiveCountRef.current = Math.max(
      0,
      workflowComfyGenerationActiveCountRef.current + (active ? 1 : -1),
    );
    setWorkflowComfyGenerationActive(workflowComfyGenerationActiveCountRef.current > 0);
  }

  function cancelCurrentRun(reason: CancelReason = 'cancel') {
    const run = activeRun.current;
    if (!run) {
      return false;
    }
    activeRunCancelReason.current = reason;
    if (reason === 'cancel') {
      pendingRunRestart.current = null;
    }
    run.controller.abort();
    return true;
  }

  return {
    isRunning,
    setIsRunning,
    runLlmReport,
    setRunLlmReport,
    showRunLlmReport,
    setShowRunLlmReport,
    runDurationMs,
    setRunDurationMs,
    runHistory,
    setRunHistory,
    workflowComfyGenerationActive,
    updateWorkflowComfyGenerationActive,
    activeRunRef: activeRun,
    activeRunId,
    setActiveRunId,
    lastRunDebugRef,
    activeRunCancelReasonRef: activeRunCancelReason,
    activeRunLlmReportRef: activeRunLlmReport,
    pendingRunRestartRef: pendingRunRestart,
    runStartTimeRef,
    runEndTimeRef,
    runStartTimeMs,
    setRunStartTimeMs,
    cancelCurrentRun,
  };
}
