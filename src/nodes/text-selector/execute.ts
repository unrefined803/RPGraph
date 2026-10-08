import type { WorkflowNode } from '../../types';
import {
  textSelectorInputCount,
  textSelectorMode,
  textSelectorTextInputHandle,
} from '../../workflow';
import type { ExecuteContext } from '../types';

const conditionHandle = 'condition';

function isTruthyBooleanText(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function selectedNumber(value: string, count: number) {
  const trimmed = value.trim();
  const parsed = trimmed ? Number(trimmed) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  const selectedIndex = Math.trunc(parsed);
  if (selectedIndex >= count) {
    return undefined;
  }
  return selectedIndex;
}

async function resolveInput(node: WorkflowNode, context: ExecuteContext, targetHandle: string) {
  const edge = context.edges.find(
    (candidate) => candidate.target === node.id && candidate.targetHandle === targetHandle,
  );
  if (!edge) {
    const mode = textSelectorMode(node.data);
    throw new Error(`Text Selector requires a ${targetHandle === conditionHandle ? (mode === 'number' ? 'Number' : 'Bool') : 'Text'} input.`);
  }
  return context.executeInput(edge.source, edge.sourceHandle);
}

async function optionalInput(node: WorkflowNode, context: ExecuteContext, targetHandle: string) {
  const edge = context.edges.find(
    (candidate) => candidate.target === node.id && candidate.targetHandle === targetHandle,
  );
  return edge ? context.executeInput(edge.source, edge.sourceHandle) : '';
}

export async function executeTextSelectorNode(node: WorkflowNode, context: ExecuteContext) {
  const mode = textSelectorMode(node.data);
  const inputCount = textSelectorInputCount(node.data);
  const conditionText = mode === 'number'
    ? await optionalInput(node, context, conditionHandle)
    : await resolveInput(node, context, conditionHandle);
  const selection = mode === 'number' ? selectedNumber(conditionText, inputCount) : undefined;
  const selectedHandle = mode === 'number'
    ? selection === undefined
      ? undefined
      : textSelectorTextInputHandle(selection)
    : isTruthyBooleanText(conditionText) ? 'true' : 'false';
  const outputText = selectedHandle
    ? mode === 'number'
      ? await optionalInput(node, context, selectedHandle)
      : await resolveInput(node, context, selectedHandle)
    : '';

  context.updateRuntimeData(node.id, {
    preview: mode === 'number'
      ? selection === undefined
        ? 'No number selected'
        : `Selected Number ${selection} Text`
      : selectedHandle === 'true'
        ? 'Selected True Text'
        : 'Selected False Text',
    fullText: outputText,
    displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
  });
  return outputText;
}
