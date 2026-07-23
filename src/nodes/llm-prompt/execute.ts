import type { ReferenceImage } from '../../chat/referenceImages';
import type { ChatImageAttachment, WorkflowNode } from '../../types';
import { resolveWorkflowVariables } from '../../workflow';
import { promptAfterInputHandle, promptBeforeInputHandle } from '../shared/imageInputs';
import { promptActionConfigs, withPromptActionRuntimeSettingsList } from '../shared/promptActions';
import { promptCommandConfigs } from '../shared/promptCommands';
import { runActionAwarePrompt } from '../shared/promptRun';
import type { ExecuteContext } from '../types';

export async function executeLlmPromptNode({
  node,
  inputValue,
  images,
  referenceImages,
  context,
  streamsVisibleOutput,
}: {
  node: WorkflowNode;
  inputValue: string;
  images: ChatImageAttachment[];
  referenceImages: ReferenceImage[];
  context: ExecuteContext;
  streamsVisibleOutput: boolean;
}) {
  // A connection on either override handle bypasses (but never clears) the
  // authored field text: the received string is fed into the same operation.
  // Presence of the edge activates the override even when it resolves to ''.
  const promptBeforeEdge = context.edges.find(
    (edge) => edge.target === node.id && edge.targetHandle === promptBeforeInputHandle,
  );
  const promptAfterEdge = context.edges.find(
    (edge) => edge.target === node.id && edge.targetHandle === promptAfterInputHandle,
  );
  const promptBeforeSource = promptBeforeEdge
    ? await context.executeInput(promptBeforeEdge.source, promptBeforeEdge.sourceHandle)
    : node.data.llmPromptBefore ?? '';
  const promptAfterSource = promptAfterEdge
    ? await context.executeInput(promptAfterEdge.source, promptAfterEdge.sourceHandle)
    : node.data.llmPromptAfter ?? '';

  const promptBefore = resolveWorkflowVariables(
    promptBeforeSource,
    context.settingsValueDefinitions,
    context.settingsValues,
  );
  const promptAfter = resolveWorkflowVariables(
    promptAfterSource,
    context.settingsValueDefinitions,
    context.settingsValues,
  );
  const combinedPrompt = [promptBefore.trim(), inputValue, promptAfter.trim()]
    .filter(Boolean)
    .join('\n\n');
  if (!inputValue.trim()) {
    context.updateRuntimeData(node.id, {
      preview: 'Skipped: no text input',
      generatedText: '',
      displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
      llmPromptDebug: {
        inputValue,
        promptBefore,
        promptAfter,
        combinedPrompt,
        generatedText: '',
      },
    });
    return '';
  }

  context.updateRuntimeData(node.id, { preview: 'Calling LLM ...', llmCallStats: [] });
  const result = await runActionAwarePrompt({
    node,
    context,
    inputValue,
    images,
    referenceImages,
    promptBefore,
    promptAfter,
    actionConfigs: withPromptActionRuntimeSettingsList(
      promptActionConfigs(node.data.llmPromptActions),
      context.promptActionSettings,
    ),
    commandConfigs: promptCommandConfigs(node.data.llmPromptCommands),
    streamsVisibleOutput,
    contributesToTokenCalibration: true,
    callLabel: (actionReplayCount) =>
      `Generate${actionReplayCount ? ` / Action replay ${actionReplayCount}` : ''}`,
  });
  context.updateRuntimeData(node.id, {
    preview: `Sent via ${result.connectionLabel}${result.referenceImageCount ? ` (+${result.referenceImageCount} reference images)` : ''}`,
    generatedText: result.generatedText,
    displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
    llmPromptDebug: result.debug,
  });
  return result.generatedText;
}
