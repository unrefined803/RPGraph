import type { ExecuteContext } from '../types';
import type { WorkflowNode } from '../../types';
import {
  emptyRpStorybookV1,
  parseRpStorybookJson,
  rpStorybookFormattedText,
  rpStorybookJsonText,
} from '../rp-storybook-v1/model';
import { storybookCharacterInfoText } from '../../storybook/runtime';

// The editor node is a standalone storybook document editor. It reuses the
// RP Storybook data model and emits the same three outputs, so it can be wired
// into a graph exactly like the RP Storybook node.
export async function executeRpStorybookEditorNode(node: WorkflowNode, context: ExecuteContext) {
  const storybook = node.data.storybookJson
    ? parseRpStorybookJson(node.data.storybookJson)
    : emptyRpStorybookV1;

  if (context.sourceHandle === 'formatted-text') {
    return rpStorybookFormattedText(storybook, node.data.storybookFormattedTextSettings);
  }
  if (context.sourceHandle === 'character-info') {
    return storybookCharacterInfoText(rpStorybookJsonText(storybook));
  }
  return rpStorybookJsonText(storybook);
}
