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
}: {
  isRunning: boolean;
  nodes: WorkflowNode[];
}) {
  if (!isRunning) {
    return null;
  }
  const node = currentRuntimeNode(nodes);
  if (!node || node.data.kind !== undefined) {
    return null;
  }
  const route = promptSwitchRouteLabel(node.data);
  const stage = node.data.llmActiveCallLabel
    ? llmCallStageLabel(node.data, node.data.llmActiveCallLabel)
    : nodeFallbackStageLabel(node.data);
  const startTimeMs = node.data.llmActiveCallStartedAtMs ?? node.data.runActiveStartedAtMs ?? null;

  return (
    <aside className="chat-run-progress" aria-live="polite" aria-label="Current workflow step">
      <div className="chat-run-progress-heading">
        <span className="chat-run-progress-pulse" aria-hidden="true" />
        <strong>{route ?? node.data.label}</strong>
        {startTimeMs !== null && (
          <span className="chat-run-progress-time">
            <LiveRunClock isRunning startTimeMs={startTimeMs} finalMs={0} /> s
          </span>
        )}
      </div>
      <div className="chat-run-progress-stage">
        <span>{stage}</span>
        <span className="chat-run-progress-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </aside>
  );
}
