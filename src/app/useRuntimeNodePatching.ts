import { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { RunLlmReport } from '../components/AppDialogs';
import { getRegisteredNode } from '../nodes/registry';
import { isStorybookSourceNode } from '../storybook/runtime';
import type { LlmCallStage, LlmCallStats, WorkflowNode, WorkflowNodeData } from '../types';
import type { ActiveRun } from './useGraphRun';

const inputTransformCallLabels = new Set(['Translate', 'Act RP', 'Act Phone']);

function llmCallStatsLabelsToReplace(label: string) {
  return inputTransformCallLabels.has(label) ? inputTransformCallLabels : new Set([label]);
}

type UseRuntimeNodePatchingOptions = {
  nodesRef: { current: WorkflowNode[] };
  commitNodes: (nextNodes: WorkflowNode[]) => void;
  activeRunRef: { current: ActiveRun | null };
  activeRunLlmReportRef: { current: RunLlmReport | null };
  setRunLlmReport: Dispatch<SetStateAction<RunLlmReport | null>>;
  openingHistorySignature: (storybookJson?: string) => string;
  onStorybookOpeningHistoryChanged: (nextNodes: WorkflowNode[]) => void;
  replaceCurrentChatWithOpeningHistoryRef: { current: boolean };
};

export function useRuntimeNodePatching({
  nodesRef,
  commitNodes,
  activeRunRef,
  activeRunLlmReportRef,
  setRunLlmReport,
  openingHistorySignature,
  onStorybookOpeningHistoryChanged,
  replaceCurrentChatWithOpeningHistoryRef,
}: UseRuntimeNodePatchingOptions) {
  const runActiveStartedAt = useRef<Record<string, number>>({});
  const runActiveEndTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function applyRuntimeNodePatch(nodeId: string, patch: Partial<WorkflowNodeData>) {
    const previousNode = nodesRef.current.find((node) => node.id === nodeId);
    const nextStorybookJson = typeof patch.storybookJson === 'string'
      ? patch.storybookJson
      : undefined;
    const shouldRefreshOpeningHistory =
      previousNode !== undefined &&
      isStorybookSourceNode(previousNode) &&
      nextStorybookJson !== undefined &&
      openingHistorySignature(previousNode.data.storybookJson) !==
        openingHistorySignature(nextStorybookJson);
    const nextNodes = nodesRef.current.map((node) =>
      node.id === nodeId
        ? { ...node, data: { ...node.data, ...patch } as WorkflowNodeData }
        : node,
    );
    commitNodes(nextNodes);
    if (shouldRefreshOpeningHistory) {
      onStorybookOpeningHistoryChanged(nextNodes);
    } else {
      replaceCurrentChatWithOpeningHistoryRef.current = false;
    }
  }

  function clearRunActiveEndTimer(nodeId: string) {
    const timer = runActiveEndTimers.current[nodeId];
    if (timer) {
      clearTimeout(timer);
      delete runActiveEndTimers.current[nodeId];
    }
  }

  function clearAllRunActiveTimers() {
    Object.keys(runActiveEndTimers.current).forEach(clearRunActiveEndTimer);
    runActiveStartedAt.current = {};
  }

  function updateRuntimeNode(nodeId: string, patch: Partial<WorkflowNodeData>) {
    if (patch.runActive === true) {
      clearRunActiveEndTimer(nodeId);
      runActiveStartedAt.current[nodeId] = performance.now();
      applyRuntimeNodePatch(nodeId, patch);
      return;
    }

    if (patch.runActive === false) {
      const startedAt = runActiveStartedAt.current[nodeId];
      const minimumActiveMs = 500;
      if (startedAt !== undefined) {
        const remainingMs = minimumActiveMs - (performance.now() - startedAt);
        if (remainingMs > 0) {
          clearRunActiveEndTimer(nodeId);
          const delayedPatch = { ...patch };
          runActiveEndTimers.current[nodeId] = setTimeout(() => {
            delete runActiveEndTimers.current[nodeId];
            delete runActiveStartedAt.current[nodeId];
            applyRuntimeNodePatch(nodeId, delayedPatch);
          }, remainingMs);
          const immediatePatch: Partial<WorkflowNodeData> = { ...patch };
          delete immediatePatch.runActive;
          if (Object.keys(immediatePatch).length > 0) {
            applyRuntimeNodePatch(nodeId, immediatePatch);
          }
          return;
        }
      }
      clearRunActiveEndTimer(nodeId);
      delete runActiveStartedAt.current[nodeId];
    }

    applyRuntimeNodePatch(nodeId, patch);
  }

  function updateLlmNodeActive(
    nodeId: string,
    runActive: boolean,
    label?: string,
    stage?: LlmCallStage,
  ) {
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    const definition = node?.data.kind !== undefined
      ? undefined
      : node
        ? getRegisteredNode(node.data.nodeType)
        : undefined;
    if (definition?.usesLlm) {
      updateRuntimeNode(nodeId, {
        runActive,
        llmActiveCallLabel: runActive ? label : undefined,
        llmActiveCallStage: runActive ? stage : undefined,
        llmActiveCallStartedAtMs: runActive && label ? performance.now() : undefined,
      });
    }
  }

  function recordNodeLlmCall(
    nodeId: string,
    label: string,
    stats: LlmCallStats,
    metadata?: { startedAtMs: number; stage?: LlmCallStage },
  ) {
    const report = activeRunLlmReportRef.current;
    const run = activeRunRef.current;
    if (report && run && report.runId === run.id) {
      const node = nodesRef.current.find((entry) => entry.id === nodeId);
      const calls = [
        ...report.calls,
        {
          id: `${report.runId}-llm-${report.calls.length + 1}`,
          order: report.calls.length + 1,
          nodeId,
          nodeLabel: node?.data.label ?? nodeId,
          label,
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          reasoningTokens: stats.reasoningTokens,
          totalTokens: stats.totalTokens,
          durationMs: stats.durationMs,
          startedAtMs: metadata?.startedAtMs,
        },
      ].sort(
        // Calls without a start time keep their append position at the end; a
        // 0 fallback would jump them ahead of every timed call and misalign
        // the per-occurrence prompt passes in the turn trace.
        (left, right) =>
          (left.startedAtMs ?? Number.MAX_SAFE_INTEGER) -
          (right.startedAtMs ?? Number.MAX_SAFE_INTEGER),
      );
      const nextReport: RunLlmReport = {
        ...report,
        calls: calls.map((call, index) => ({ ...call, order: index + 1 })),
      };
      activeRunLlmReportRef.current = nextReport;
      setRunLlmReport(nextReport);
    }

    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node) {
      return;
    }
    const replacedLabels = llmCallStatsLabelsToReplace(label);
    const otherCalls = (node.data.llmCallStats ?? []).filter((call) => !replacedLabels.has(call.label));
    applyRuntimeNodePatch(nodeId, {
      llmCallStats: [...otherCalls, { label, stage: metadata?.stage, ...stats }],
    });
  }

  return {
    updateRuntimeNode,
    updateLlmNodeActive,
    recordNodeLlmCall,
    clearAllRunActiveTimers,
  };
}
