import type { LlmCallStage, WorkflowNodeData } from '../types';
import {
  llmPromptSwitchOutputTitles,
  llmPromptSwitchPromptTitles,
} from '../workflow';

// Joins the route heading and the pass title of an LLM call label.
export const llmCallLabelSeparator = ' › ';
export const llmPromptCallLabel = 'Generate';

function selectedPromptSwitchRoute(data: WorkflowNodeData) {
  const outputIndex = data.llmPromptSwitchSelectedOutputChannel ?? 0;
  const promptIndex = data.llmPromptSwitchSelectedPromptSlot ?? 0;
  const outputTitle = llmPromptSwitchOutputTitles(data)[outputIndex] ?? `Output ${outputIndex}`;
  const promptTitle = llmPromptSwitchPromptTitles(data, outputIndex)[promptIndex] ?? `Prompt ${promptIndex}`;
  return `${outputTitle}${llmCallLabelSeparator}${promptTitle}`;
}

export function promptSwitchRouteLabel(data: WorkflowNodeData) {
  return data.nodeType === 'llm-prompt-switch' ? selectedPromptSwitchRoute(data) : undefined;
}

// Splits a call label into the route heading it runs under and its own title.
// Calls of nodes without a route have no group and keep their whole label.
export function llmCallDisplayParts(label: string, data: WorkflowNodeData | undefined) {
  const route = data
    ? data.nodeType === 'llm-prompt' ? llmPromptCallLabel : promptSwitchRouteLabel(data)
    : undefined;
  if (!data || !route) {
    return { title: label };
  }
  const group = data.nodeType === 'llm-prompt' ? data.label : route;
  if (label === route) {
    return { group, title: 'Main' };
  }
  const prefix = `${route}${llmCallLabelSeparator}`;
  return label.startsWith(prefix) ? { group, title: label.slice(prefix.length) } : { title: label };
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
      return `Step: ${readableRuntimeName(stage.name)}${stage.replay ? ' · Continued' : ''}`;
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
    return data.speakerAnalysisEnabled ? 'Speaker highlighting' : 'Translate';
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
