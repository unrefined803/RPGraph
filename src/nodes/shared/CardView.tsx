/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, type RefObject } from 'react';
import { useUpdateNodeInternals } from '@xyflow/react';
import type { WorkflowNode } from '../../types';
import { llmPromptSwitchPromptTitles } from '../../workflow';
import { llmCallStageLabel, promptSwitchRouteLabel } from '../../llm/callDisplay';

export function runStateClassName(data: WorkflowNode['data']) {
  if (data.runError) {
    return ' workflow-node-error';
  }
  const activeClassName = data.runActive ? ' workflow-node-active' : '';
  return data.runPrepared
    ? ` workflow-node-prepared${activeClassName}`
    : data.runCompleted
      ? ` workflow-node-complete${activeClassName}`
      : activeClassName;
}

export function useNodeLayoutSync(id: string): RefObject<HTMLDivElement | null> {
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    updateNodeInternals(id);
    void document.fonts?.ready.then(() => {
      if (!disposed) {
        updateNodeInternals(id);
      }
    });
    const nodeBody = nodeBodyRef.current;
    if (!nodeBody || typeof ResizeObserver === 'undefined') {
      return () => {
        disposed = true;
      };
    }
    const observer = new ResizeObserver(() => updateNodeInternals(id));
    observer.observe(nodeBody);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [id, updateNodeInternals]);

  return nodeBodyRef;
}

function formatCallDuration(durationMs: number) {
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)} s` : `${durationMs} ms`;
}

function getExpectedCallLabels(data: WorkflowNode['data']): string[] {
  switch (data.nodeType) {
    case 'input':
      return ['Translate'];
    case 'custom':
      return ['Custom Node LLM'];
    case 'llm-prompt':
      return ['Generate'];
    case 'event-manager':
      return ['Events'];
    case 'character-stats': {
      const actual = data.llmCallStats?.find((s) => s.label === 'Init Stats' || s.label === 'Patch Stats');
      return [actual?.label ?? (data.characterStatsState ? 'Patch Stats' : 'Init Stats')];
    }
    case 'history':
      return data.historyTimeTrackingEnabled ? ['RP Time'] : [];
    case 'output':
      return data.speakerAnalysisEnabled ? ['Speakers'] : [];
    case 'context-compression':
      return ['Compress'];
    case 'llm-decision': {
      const questionCount = data.llmDecisionQuestions?.length || data.llmDecisionOutputToggles?.length || 1;
      const labels: string[] = [];
      for (let i = 0; i < questionCount; i++) {
        labels.push(`Decision ${i + 1}`);
      }
      return labels;
    }
    case 'llm-prompt-switch': {
      const outputTitles = data.llmPromptSwitchOutputTitles ?? [];
      const selectedOutputChannel = data.llmPromptSwitchSelectedOutputChannel ?? 0;
      const selectedPromptSlot = data.llmPromptSwitchSelectedPromptSlot ?? 0;
      const promptTitles = llmPromptSwitchPromptTitles(data, selectedOutputChannel);
      const label = `${outputTitles[selectedOutputChannel] ?? `Output ${selectedOutputChannel}`} / ${promptTitles[selectedPromptSlot] ?? `Prompt ${selectedPromptSlot}`}`;
      return [label];
    }
    default:
      return [];
  }
}

export function LlmCallMetrics({ data }: { data: WorkflowNode['data'] }) {
  const expectedLabels = getExpectedCallLabels(data);
  const actualStats = data.llmCallStats ?? [];
  const displayStats = data.nodeType === 'input' && actualStats.length > 0
    ? [{ ...actualStats[actualStats.length - 1], label: 'Translate' }]
    : actualStats;
  const hasReasoning = displayStats.some((stats) => (stats.reasoningTokens ?? 0) > 0);
  const activeLabel = data.nodeType === 'input' && data.llmActiveCallLabel
    ? 'Translate'
    : data.llmActiveCallLabel;
  const routeLabel = promptSwitchRouteLabel(data);
  const effectiveExpectedLabels = data.nodeType === 'llm-prompt-switch' ? [] : expectedLabels;
  const labels = [
    ...effectiveExpectedLabels,
    ...displayStats.flatMap((stats) => effectiveExpectedLabels.includes(stats.label) ? [] : [stats.label]),
    ...(activeLabel && !displayStats.some((stats) => stats.label === activeLabel) ? [activeLabel] : []),
  ];
  if (labels.length === 0 && !routeLabel) {
    return null;
  }

  return (
    <div className="llm-call-metrics">
      {routeLabel && <strong className="llm-call-route">{routeLabel}</strong>}
      {labels.map((label) => {
        const actual = displayStats.find((stats) => stats.label === label);
        const displayLabel = llmCallStageLabel(
          actual?.stage ?? (label === activeLabel ? data.llmActiveCallStage : undefined),
          label,
        );
        return (
          <div
            className={`llm-call-metric${hasReasoning ? ' llm-call-metric-with-reasoning' : ''}`}
            key={label}
            title={label}
          >
            <strong>{displayLabel}</strong>
            <span className="llm-metric-in">IN {actual?.inputTokens !== undefined ? actual.inputTokens : '?'}</span>
            <span className="llm-metric-out">OUT {actual?.outputTokens !== undefined ? actual.outputTokens : '?'}</span>
            {hasReasoning && (
              <span className="llm-metric-reasoning">
                {actual?.reasoningTokens !== undefined && actual.reasoningTokens > 0
                  ? `RSN ${actual.reasoningTokens}`
                  : ''}
              </span>
            )}
            <span className="llm-metric-duration">
              {actual?.durationMs !== undefined ? formatCallDuration(actual.durationMs) : '? s'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
