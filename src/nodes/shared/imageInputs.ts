import type { ChatImageAttachment, WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { wireLinkName } from '../memory-slot/model';

export const imageInputHandle = 'image';
export const promptBeforeInputHandle = 'prompt-before';
export const promptAfterInputHandle = 'prompt-after';

// Target handles that must never be mistaken for a node's main Text Input.
export const nonTextInputHandles = new Set<string>([
  imageInputHandle,
  promptBeforeInputHandle,
  promptAfterInputHandle,
]);

type ImageDependencyContext = Pick<ExecuteContext, 'edges' | 'nodes'>;

function memorySlotKey(node: WorkflowNode) {
  if (node.data.nodeType !== 'memory-slot') {
    return null;
  }
  try {
    return wireLinkName(node.data).toLocaleLowerCase();
  } catch {
    return null;
  }
}

export function dependsOnUserInputImage(
  nodeId: string,
  sourceHandle: string | null | undefined,
  context: ImageDependencyContext,
  visiting = new Set<string>(),
): boolean {
  const sourceNode = context.nodes.find((entry) => entry.id === nodeId);
  if (sourceNode?.data.nodeType === 'input') {
    return sourceHandle === imageInputHandle;
  }
  if (!sourceNode || visiting.has(nodeId)) {
    return false;
  }
  const nextVisiting = new Set(visiting).add(nodeId);
  return context.edges
    .filter((edge) => edge.target === nodeId)
    .some((edge) =>
      dependsOnUserInputImage(edge.source, edge.sourceHandle, context, nextVisiting),
    ) || linkedMemorySlotDependsOnUserInputImage(sourceNode, context, nextVisiting);
}

function linkedMemorySlotDependsOnUserInputImage(
  sourceNode: WorkflowNode,
  context: ImageDependencyContext,
  visiting: Set<string>,
) {
  const slotKey = memorySlotKey(sourceNode);
  if (!slotKey || sourceNode.data.memorySlotMode === 'input') {
    return false;
  }

  return context.nodes
    .filter(
      (candidate) =>
        candidate.id !== sourceNode.id &&
        candidate.data.nodeType === 'memory-slot' &&
        memorySlotKey(candidate) === slotKey,
    )
    .some((candidate) =>
      context.edges
        .filter((edge) => edge.target === candidate.id)
        .some((edge) =>
          dependsOnUserInputImage(edge.source, edge.sourceHandle, context, visiting),
        ),
    );
}

export async function resolveTextAndImageInputs(
  node: WorkflowNode,
  context: ExecuteContext,
): Promise<{ inputValue: string; images: ChatImageAttachment[] }> {
  const incomingEdge = context.edges.find(
    (edge) => edge.target === node.id && !nonTextInputHandles.has(edge.targetHandle ?? ''),
  );
  if (!incomingEdge) {
    throw new Error(`${node.data.label} has no incoming connection.`);
  }

  const imageEdge = context.edges.find(
    (edge) => edge.target === node.id && edge.targetHandle === imageInputHandle,
  );
  const inputValue = await context.executeInput(incomingEdge.source, incomingEdge.sourceHandle);
  if (imageEdge) {
    await context.executeInput(imageEdge.source, imageEdge.sourceHandle);
  }
  const shouldSendImages =
    !!imageEdge &&
    context.inputImages.length > 0 &&
    dependsOnUserInputImage(imageEdge.source, imageEdge.sourceHandle, context);

  return {
    inputValue,
    images: shouldSendImages ? context.inputImages : [],
  };
}

export async function resolveConnectedImages(node: WorkflowNode, context: ExecuteContext) {
  const imageEdge = context.edges.find(
    (edge) => edge.target === node.id && edge.targetHandle === imageInputHandle,
  );
  if (imageEdge) {
    await context.executeInput(imageEdge.source, imageEdge.sourceHandle);
  }
  return imageEdge &&
    context.inputImages.length > 0 &&
    dependsOnUserInputImage(imageEdge.source, imageEdge.sourceHandle, context)
    ? context.inputImages
    : [];
}
