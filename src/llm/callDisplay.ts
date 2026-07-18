import type { WorkflowNodeData } from '../types';
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

function withoutRoutePrefix(data: WorkflowNodeData, label: string) {
  const route = promptSwitchRouteLabel(data);
  if (!route) {
    return label.trim();
  }
  const trimmed = label.trim();
  return trimmed === route
    ? ''
    : trimmed.startsWith(`${route} / `)
      ? trimmed.slice(route.length + 3).trim()
      : trimmed;
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

export function llmCallStageLabel(data: WorkflowNodeData, label: string) {
  if (data.nodeType !== 'llm-prompt-switch') {
    return readableRuntimeName(label);
  }
  const stage = withoutRoutePrefix(data, label);
  if (!stage || /^Initial action prompt$/i.test(stage) || /^Action replay \d+$/i.test(stage)) {
    return 'Step: Main';
  }
  if (/^Planning step$/i.test(stage)) {
    return 'Step: Planning';
  }
  const planningReplay = stage.match(/^Planning replay (\d+)$/i);
  if (planningReplay) {
    return `Step: Planning · Replay ${planningReplay[1]}`;
  }
  const detailStage = stage.replace(/^Action replay \d+\s*\/\s*/i, '');
  const action = detailStage.match(/^(?:Planning action follow-up|Action follow-up|After-reply action):\s*(.+)$/i);
  if (action) {
    return `Action: ${readableRuntimeName(action[1])}`;
  }
  const command = detailStage.match(/^Command(?: pass)?(?::\s*)?(.+)?$/i);
  if (command) {
    return command[1]
      ? `Command: ${readableRuntimeName(command[1])}`
      : 'Command';
  }
  const correction = detailStage.match(/^(.+?) correction(?: replay)?$/i);
  if (correction) {
    return `Correction: ${readableRuntimeName(correction[1])}`;
  }
  return readableRuntimeName(detailStage);
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
    if (/planning/i.test(data.preview)) {
      return 'Step: Planning';
    }
    return 'Step: Main';
  }
  return data.preview.trim() && !/waiting|not run|no output/i.test(data.preview)
    ? data.preview.trim()
    : `Running ${data.label}`;
}
