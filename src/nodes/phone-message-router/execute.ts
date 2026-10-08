import type { WorkflowNode } from '../../types';
import {
  textRouterMode,
  textRouterNumberOutputCount,
  textRouterNumberOutputHandle,
} from '../../workflow';
import type { ExecuteContext } from '../types';

const conditionHandle = 'condition';
const textHandle = 'text';

function isTruthyBooleanText(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function routeNumber(value: string, count: number) {
  const trimmed = value.trim();
  const parsed = trimmed ? Number(trimmed) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  const routeIndex = Math.trunc(parsed);
  if (routeIndex >= count) {
    return undefined;
  }
  return routeIndex;
}

async function resolveInput(node: WorkflowNode, context: ExecuteContext, targetHandle: string) {
  const edge = context.edges.find(
    (candidate) => candidate.target === node.id && candidate.targetHandle === targetHandle,
  );
  if (!edge) {
    const mode = textRouterMode(node.data);
    throw new Error(`Text Router requires a ${targetHandle === conditionHandle ? (mode === 'number' ? 'Number' : 'Bool') : 'Text'} input.`);
  }
  return context.executeInput(edge.source, edge.sourceHandle);
}

async function optionalInput(node: WorkflowNode, context: ExecuteContext, targetHandle: string) {
  const edge = context.edges.find(
    (candidate) => candidate.target === node.id && candidate.targetHandle === targetHandle,
  );
  return edge ? context.executeInput(edge.source, edge.sourceHandle) : '';
}

export async function executePhoneMessageRouterNode(node: WorkflowNode, context: ExecuteContext) {
  const mode = textRouterMode(node.data);
  const [conditionText, inputText] = await Promise.all([
    mode === 'number'
      ? optionalInput(node, context, conditionHandle)
      : resolveInput(node, context, conditionHandle),
    resolveInput(node, context, textHandle),
  ]);
  const numberOutputCount = textRouterNumberOutputCount(node.data);
  const route = mode === 'number' ? routeNumber(conditionText, numberOutputCount) : undefined;
  const selectedHandle = mode === 'number'
    ? route === undefined
      ? undefined
      : textRouterNumberOutputHandle(route)
    : isTruthyBooleanText(conditionText) ? 'true' : 'false';
  const outputText = context.sourceHandle === selectedHandle ? inputText : '';

  context.updateRuntimeData(node.id, {
    preview: mode === 'number'
      ? route === undefined
        ? 'No number routed'
        : `Text routed to Number ${route}`
      : selectedHandle === 'true'
        ? 'Text routed to True'
        : 'Text routed to False',
    fullText: outputText,
    displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
  });
  return outputText;
}
