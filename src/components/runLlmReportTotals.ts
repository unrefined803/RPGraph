import type { RunLlmCallReport, RunLlmReport } from './AppDialogs';

export function tokenCell(value: number | undefined) {
  return value === undefined ? '-' : value.toLocaleString();
}

export function callTotalTokens(call: RunLlmCallReport) {
  return call.totalTokens ?? (call.inputTokens ?? 0) + (call.outputTokens ?? 0);
}

export function runLlmReportTotals(report: RunLlmReport) {
  return report.calls.reduce(
    (totals, call) => ({
      inputTokens: totals.inputTokens + (call.inputTokens ?? 0),
      cachedInputTokens: totals.cachedInputTokens + (call.cachedInputTokens ?? 0),
      hasCachedInputTokens: totals.hasCachedInputTokens || call.cachedInputTokens !== undefined,
      outputTokens: totals.outputTokens + (call.outputTokens ?? 0),
      reasoningTokens: totals.reasoningTokens + (call.reasoningTokens ?? 0),
      hasReasoningTokens: totals.hasReasoningTokens || call.reasoningTokens !== undefined,
      totalTokens: totals.totalTokens + callTotalTokens(call),
      durationMs: totals.durationMs + call.durationMs,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      hasCachedInputTokens: false,
      outputTokens: 0,
      reasoningTokens: 0,
      hasReasoningTokens: false,
      totalTokens: 0,
      durationMs: 0,
    },
  );
}
