import type { WorkflowNode } from '../../types';
import { applyTextReplacements, textReplaceEntries } from '../../workflow';
import type { ExecuteContext } from '../types';

export async function executeTextReplaceNode(node: WorkflowNode, context: ExecuteContext) {
  const inputEdge = context.edges.find((edge) => edge.target === node.id);
  const input = inputEdge
    ? await context.executeInput(inputEdge.source, inputEdge.sourceHandle)
    : '';
  const entries = textReplaceEntries(node.data);
  const result = applyTextReplacements(entries, input);
  const activeCount = entries.filter((entry) => entry.source).length;

  context.updateRuntimeData(node.id, {
    preview: activeCount
      ? `Applied ${activeCount} replacement${activeCount === 1 ? '' : 's'}`
      : 'No replacements configured',
    fullText: result,
    displayTokenBytesPerToken: context.textMetrics.bytesPerToken,
  });
  // The same replaced text is returned for both the text and json output handles.
  return result;
}
