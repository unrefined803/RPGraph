import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { llmCallDisplayParts } from '../llm/callDisplay';
import type { WorkflowNode } from '../types';
import type { RunLlmCallReport } from './AppDialogs';

const lingerAfterRunMs = 3000;

type RunStepEntry = {
  group?: string;
  title: string;
  active: boolean;
};

// Finished calls in run order, followed by the calls that are still running.
function runStepEntries(calls: RunLlmCallReport[], nodes: WorkflowNode[]): RunStepEntry[] {
  const nodeData = (nodeId: string) => {
    const node = nodes.find((entry) => entry.id === nodeId);
    return node && node.data.kind === undefined ? node.data : undefined;
  };
  const activeNodes = nodes
    .filter((node) => !!node.data.llmActiveCallLabel)
    .sort((left, right) =>
      (left.data.llmActiveCallStartedAtMs ?? 0) - (right.data.llmActiveCallStartedAtMs ?? 0)
    );
  return [
    ...calls.map((call) => ({
      ...llmCallDisplayParts(call.label, nodeData(call.nodeId)),
      active: false,
    })),
    ...activeNodes.map((node) => ({
      ...llmCallDisplayParts(node.data.llmActiveCallLabel ?? '', nodeData(node.id)),
      active: true,
    })),
  ];
}

type BigScreenRunStepsProps = {
  calls: RunLlmCallReport[];
  nodes: WorkflowNode[];
  isRunning: boolean;
  // Usage summary shown once the finished step list has lingered.
  children: ReactNode;
};

export function BigScreenRunSteps({ calls, nodes, isRunning, children }: BigScreenRunStepsProps) {
  const [wasRunning, setWasRunning] = useState(isRunning);
  const [lingering, setLingering] = useState(false);
  if (wasRunning !== isRunning) {
    setWasRunning(isRunning);
    setLingering(!isRunning);
  }
  const visible = isRunning || lingering;
  const listRef = useRef<HTMLOListElement>(null);
  const entries = visible ? runStepEntries(calls, nodes) : [];

  useEffect(() => {
    if (!lingering) {
      return undefined;
    }
    const timer = window.setTimeout(() => setLingering(false), lingerAfterRunMs);
    return () => window.clearTimeout(timer);
  }, [lingering]);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [entries.length]);

  if (!visible) {
    return <>{children}</>;
  }

  return (
    <ol className="big-screen-run-steps" ref={listRef} aria-label="LLM steps of the current run">
      {entries.length === 0 && <li className="big-screen-run-step">Preparing workflow ...</li>}
      {entries.map((entry, index) => {
        const startsGroup = !!entry.group && entry.group !== entries[index - 1]?.group;
        return (
          // Position keys keep a step mounted when it turns from running to finished.
          <li
            className={`big-screen-run-step${entry.active ? ' active' : ''}${entry.group ? ' grouped' : ''}`}
            key={index}
          >
            {startsGroup && <span className="big-screen-run-step-group">{entry.group}</span>}
            <span className="big-screen-run-step-title">{entry.title}</span>
          </li>
        );
      })}
    </ol>
  );
}
