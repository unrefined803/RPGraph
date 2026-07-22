import type { LlmCallStage, WorkflowNodeData } from '../types';
import {
  llmPromptSwitchOutputTitles,
  llmPromptSwitchPromptTitles,
} from '../workflow';

function selectedPromptSwitchRoute(data: WorkflowNodeData) {
  const outputIndex = data.llmPromptSwitchSelectedOutputChannel ?? 0;
  const promptIndex = data.llmPromptSwitchSelectedPromptSlot ?? 0;
  const outputTitle = llmPromptSwitchOutputTitles(data)[outputIndex] ?? `Output ${outputIndex}`;
  const promptTitle = llmPromptSwitchPromptTitles(data, outputIndex)[promptIndex] ?? `Prompt ${promptIndex}`;
  return `${outputTitle} / ${promptTitle}`;
}

export function promptSwitchRouteLabel(data: WorkflowNodeData) {
  return data.nodeType === 'llm-prompt-switch' ? selectedPromptSwitchRoute(data) : undefined;
}

export function readableRuntimeName(value: string) {
  const normalized = value.trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
  if (!normalized) {
    return 'Running';
  }
  return normalized
    .replace(/\bchatgpd\b/gi, 'ChatGPD')
    .replace(/\bwhatsup\b/gi, 'WhatsUp')
    .replace(/^./, (character) => character.toLocaleUpperCase());
}

export function llmCallStageLabel(stage: LlmCallStage | undefined, fallbackLabel: string) {
  if (!stage) {
    return readableRuntimeName(fallbackLabel);
  }
  const suffix = 'correction' in stage && stage.correction ? ' · Correction' : '';
  switch (stage.kind) {
    case 'step':
      return `Step: ${readableRuntimeName(stage.name)}${stage.replay ? ` · Replay ${stage.replay}` : ''}`;
    case 'action':
      return `Action: ${readableRuntimeName(stage.name)}${suffix}`;
    case 'command':
      return `${stage.name ? `Command: ${readableRuntimeName(stage.name)}` : 'Command'}${suffix}`;
    case 'correction':
      return `Correction: ${readableRuntimeName(stage.name)}`;
  }
}

export function nodeFallbackStageLabel(data: WorkflowNodeData) {
  if (data.nodeType === 'input') {
    return 'Translate';
  }
  if (data.nodeType === 'output') {
    return data.speakerAnalysisEnabled ? 'Speakers' : 'Translate';
  }
  if (data.nodeType === 'llm-prompt-switch') {
    const action = data.preview.match(/Action\s+([A-Za-z0-9_]+)\s+(?:requested|resolved)/i);
    if (action) {
      return `Action: ${readableRuntimeName(action[1])}`;
    }
    const step = data.preview.match(/\bstep\s+([A-Za-z0-9_-]+)/i);
    if (step) {
      return `Step: ${readableRuntimeName(step[1])}`;
    }
    return 'Step: Main';
  }
  return data.preview.trim() && !/waiting|not run|no output/i.test(data.preview)
    ? data.preview.trim()
    : `Running ${data.label}`;
}
