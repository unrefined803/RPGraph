import type { Edge } from '@xyflow/react';
import type { WorkflowFile, WorkflowNode, WorkflowNodeData } from '../types';
import { withWorkflowConnectionColor } from '../graph/edges';
import { emptyRpStorybook, rpStorybookJsonText } from '../nodes/rp-storybook/model';
import { persistentNodeData } from '../workflow/persistence';
import { currentWorkflowFormatVersion } from '../workflow/version';

function workflowNodeDataForSave(
  data: WorkflowNodeData,
  includeStorybook: boolean,
): WorkflowNodeData {
  const savedData = persistentNodeData(data);
  // The editor is a MANUAL storybook source with no separate `.rpgraph-storybook`
  // file copy, so a "workflow-only" save must NOT strip its document (that would
  // lose the only copy). Only the AI `rp-storybook` node — which has the
  // storybook-file ecosystem — is stripped.
  if (includeStorybook || savedData.nodeType !== 'rp-storybook') {
    return savedData;
  }
  return {
    ...savedData,
    preview: 'No storybook loaded',
    storybookJson: rpStorybookJsonText(emptyRpStorybook),
    storybookStatus: 'Ready',
    storybookFileName: undefined,
    storybookFilePath: undefined,
  };
}

export function workflowSnapshotFromGraph({
  nodes,
  edges,
  viewport,
  includeStorybook = true,
  savedAt = new Date().toISOString(),
}: {
  nodes: WorkflowNode[];
  edges: Edge[];
  viewport?: WorkflowFile['viewport'];
  includeStorybook?: boolean;
  savedAt?: string;
}): WorkflowFile {
  return {
    format: 'rpgraph-workflow',
    formatVersion: currentWorkflowFormatVersion,
    savedAt,
    viewport,
    nodes: nodes.map((node) => ({
      ...node,
      selected: false,
      data: workflowNodeDataForSave(node.data, includeStorybook),
    })),
    edges: edges.map((edge) => withWorkflowConnectionColor({ ...edge, selected: false })),
  };
}

export function suggestedSessionNameFromCharacters(characters: Array<{ name: string }>) {
  const castName = characters
    .map((character) => character.name.trim())
    .filter(Boolean)
    .map((name) => {
      const parts = name.split(/\s+/).filter(Boolean);
      const lastName = parts[parts.length - 1];
      return parts.length > 1 ? `${parts[0]}${lastName[0]}` : parts[0];
    })
    .join('_');
  return castName || 'Session';
}

export function suggestedWorkflowNameFromPath(filePath: string | null | undefined) {
  if (!filePath) {
    return 'workflow';
  }
  const fileName = filePath.split(/[\\/]/).pop() ?? 'workflow';
  return fileName.replace(/(\.rpgraph)?\.json$/i, '') || 'workflow';
}
