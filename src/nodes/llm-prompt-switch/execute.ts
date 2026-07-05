import { collectRecentReferenceImages } from '../../chat/referenceImages';
import type { WorkflowNode } from '../../types';
import {
  llmPromptSwitchOutputHandle,
  llmPromptSwitchOutputTitles,
  llmPromptSwitchPromptAfters,
  llmPromptSwitchPromptBefores,
  llmPromptSwitchPromptTitles,
  resolveWorkflowVariables,
} from '../../workflow';
import { resolveConnectedImages } from '../shared/imageInputs';
import { llmPromptSwitchMemo } from '../runScratch';
import { promptActionConfigs, withPromptActionRuntimeSettingsList } from '../shared/promptActions';
import { runActionAwarePrompt } from '../shared/promptRun';
import type { ExecuteContext } from '../types';

export const promptSwitchTextHandle = 'text';
export const promptSwitchOutputChannelHandle = 'output-channel';
export const promptSwitchPromptSlotHandle = 'prompt-slot';

function selectedIndex(value: string, max: number) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(max - 1, Math.max(0, Math.trunc(parsed)));
}

function selectedExistingIndex(value: string, max: number) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return { requested: 0, selected: 0, fallback: false };
  }
  const index = Math.trunc(parsed);
  const selected = index >= 0 && index < max ? index : 0;
  return { requested: index, selected, fallback: selected !== index };
}

async function resolveInput(node: WorkflowNode, context: ExecuteContext, targetHandle: string) {
  const edge = context.edges.find(
    (candidate) => candidate.target === node.id && candidate.targetHandle === targetHandle,
  );
  if (!edge) {
    const label =
      targetHandle === promptSwitchOutputChannelHandle
        ? 'Output Channel'
        : targetHandle === promptSwitchPromptSlotHandle
          ? 'Prompt Slot'
          : 'Text';
    throw new Error(`LLM Prompt Switch requires a ${label} input.`);
  }
  return context.executeInput(edge.source, edge.sourceHandle);
}

async function runPromptSwitch(node: WorkflowNode, context: ExecuteContext) {
  const [inputValue, outputChannelValue, promptSlotValue] = await Promise.all([
    resolveInput(node, context, promptSwitchTextHandle),
    resolveInput(node, context, promptSwitchOutputChannelHandle),
    resolveInput(node, context, promptSwitchPromptSlotHandle),
  ]);
  const outputTitles = llmPromptSwitchOutputTitles(node.data);
  const outputChannel = selectedIndex(outputChannelValue, outputTitles.length);
  const promptTitles = llmPromptSwitchPromptTitles(node.data, outputChannel);
  const promptSlotSelection = selectedExistingIndex(promptSlotValue, promptTitles.length);
  const promptSlot = promptSlotSelection.selected;
  if (promptSlotSelection.fallback) {
    context.reportWarning(
      `${node.data.label}: Prompt slot ${promptSlotSelection.requested} does not exist; using Default Prompt.`,
    );
  }
  if (node.data.llmPromptSwitchAutoShowPrompt ?? true) {
    context.updateRuntimeData(node.id, {
      llmPromptSwitchSelectedOutputChannel: outputChannel,
      llmPromptSwitchSelectedPromptSlot: promptSlot,
    });
  }
  const promptBefore = resolveWorkflowVariables(
    llmPromptSwitchPromptBefores(node.data, outputChannel)[promptSlot] ?? '',
    context.settingsValueDefinitions,
    context.settingsValues,
  );
  const promptAfter = resolveWorkflowVariables(
    llmPromptSwitchPromptAfters(node.data, outputChannel)[promptSlot] ?? '',
    context.settingsValueDefinitions,
    context.settingsValues,
  );
  const selectionDebug = {
    outputChannelValue,
    promptSlotValue,
    selectedOutputChannel: outputChannel,
    selectedPromptSlot: promptSlot,
  };
  const combinedPrompt = [promptBefore.trim(), inputValue, promptAfter.trim()]
    .filter(Boolean)
    .join('\n\n');
  if (!inputValue.trim()) {
    context.updateRuntimeData(node.id, {
      preview: 'Skipped: no text input',
      generatedText: '',
      fullText: '',
      displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
      llmPromptSwitchDebug: {
        inputValue,
        promptBefore,
        promptAfter,
        combinedPrompt,
        generatedText: '',
        ...selectionDebug,
      },
    });
    return { outputChannel, text: '' };
  }

  context.updateRuntimeData(node.id, {
    preview: promptSlotSelection.fallback
      ? `Prompt ${promptSlotSelection.requested} not found; calling output ${outputChannel}, prompt ${promptSlot} ...`
      : `Calling output ${outputChannel}, prompt ${promptSlot} ...`,
    llmCallStats: [],
  });
  const images = await resolveConnectedImages(node, context);
  const referenceImages = collectRecentReferenceImages({
    messages: context.historyMessages,
    nodes: context.nodes,
    options: context.referenceImages,
  });
  const actionConfigs = withPromptActionRuntimeSettingsList(
    promptActionConfigs(node.data.llmPromptActions),
    context.promptActionSettings,
  );
  const streamsVisibleOutput = !!context.streamOutput && context.edges.some(
    (edge) =>
      edge.source === node.id &&
      edge.sourceHandle === llmPromptSwitchOutputHandle(outputChannel) &&
      edge.target === context.outputNodeId,
  );
  const outputTitle = outputTitles[outputChannel] ?? `Output ${outputChannel}`;
  const promptTitle = promptTitles[promptSlot] ?? `Prompt ${promptSlot}`;
  const result = await runActionAwarePrompt({
    node,
    context,
    inputValue,
    images,
    referenceImages,
    promptBefore,
    promptAfter,
    actionConfigs,
    streamsVisibleOutput,
    contributesToTokenCalibration: true,
    callLabel: (actionReplayCount) =>
      `${outputTitle} / ${promptTitle}${actionReplayCount ? ` / Action replay ${actionReplayCount}` : ''}`,
  });
  context.updateRuntimeData(node.id, {
    preview: promptSlotSelection.fallback
      ? `Prompt ${promptSlotSelection.requested} not found; used ${outputTitle}, ${promptTitle} via ${result.connectionLabel}`
      : `${outputTitle}, ${promptTitle} sent via ${result.connectionLabel}`,
    generatedText: result.generatedText,
    fullText: result.generatedText,
    displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
    llmPromptSwitchDebug: {
      ...result.debug,
      ...selectionDebug,
    },
  });
  return { outputChannel, text: result.generatedText };
}

export async function executeLlmPromptSwitchNode(node: WorkflowNode, context: ExecuteContext) {
  const memo = llmPromptSwitchMemo(context);
  const resultPromise = memo.get(node.id) ?? runPromptSwitch(node, context);
  memo.set(node.id, resultPromise);
  const result = await resultPromise;
  return context.sourceHandle === llmPromptSwitchOutputHandle(result.outputChannel) ? result.text : '';
}
