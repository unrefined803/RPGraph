import { LiveRunClock } from '../components/LiveRunClock';
import {
  llmCallStageLabel,
  nodeFallbackStageLabel,
  promptSwitchRouteLabel,
} from '../llm/callDisplay';
import type { WorkflowNode } from '../types';

function currentRuntimeNode(nodes: WorkflowNode[]) {
  const activeCallNode = nodes
    .filter((node) => !!node.data.llmActiveCallLabel)
    .sort((left, right) =>
      (right.data.llmActiveCallStartedAtMs ?? 0) - (left.data.llmActiveCallStartedAtMs ?? 0)
    )[0];
  if (activeCallNode) {
    return activeCallNode;
  }
  return nodes
    .filter((node) => node.data.runActive)
    .sort((left, right) =>
      (right.data.runActiveStartedAtMs ?? 0) - (left.data.runActiveStartedAtMs ?? 0)
    )[0];
}

export function RunProgressCard({
  isRunning,
  nodes,
  runStartTimeMs,
  onCancel,
}: {
  isRunning: boolean;
  nodes: WorkflowNode[];
  runStartTimeMs: number | null;
  onCancel: () => void;
}) {
  if (!isRunning) {
    return null;
  }
  const node = currentRuntimeNode(nodes);
  const runtimeData = node?.data.kind === undefined ? node.data : undefined;
  const route = runtimeData ? promptSwitchRouteLabel(runtimeData) : undefined;
  const stage = runtimeData
    ? runtimeData.llmActiveCallLabel
      ? llmCallStageLabel(runtimeData.llmActiveCallStage, runtimeData.llmActiveCallLabel)
      : nodeFallbackStageLabel(runtimeData)
    : 'Preparing workflow';
  const activity = `${route ?? runtimeData?.label ?? 'RPGraph'}: ${stage}`;

  return (
    <aside className="chat-run-progress" aria-live="polite" aria-label="Current workflow step">
      <div className="chat-run-progress-copy">
        <strong title={activity}>{activity}</strong>
      </div>
      <div className="chat-run-progress-controls">
        {runStartTimeMs !== null && (
          <span className="chat-run-progress-total-time" title="Total workflow time">
            <LiveRunClock isRunning startTimeMs={runStartTimeMs} finalMs={0} /> s
          </span>
        )}
        <span className="chat-run-progress-bars" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </span>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </aside>
  );
}
