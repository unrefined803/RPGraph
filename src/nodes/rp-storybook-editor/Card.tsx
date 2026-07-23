import { useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkflowNode } from '../../types';
import { useNodeActions } from '../NodeActionsContext';
import { runStateClassName, useNodeLayoutSync } from '../shared/CardView';
import { PortLabel } from '../shared/PortValue';
import {
  emptyRpStorybook,
  estimatedRpStorybookPromptTokens,
  parseRpStorybookJson,
  type RpStorybook,
} from '../rp-storybook/model';

function hasStorybookContent(storybook: RpStorybook) {
  return Boolean(
    storybook.title ||
    storybook.introduction ||
    storybook.scenario.summary ||
    storybook.scenario.openingSituation ||
    storybook.scenario.currentSituation ||
    storybook.characters.length ||
    storybook.openingHistory.summary ||
    storybook.openingHistory.turns.length ||
    storybook.openingHistory.events.length,
  );
}

export function RpStorybookEditorNodeCard({ id, data }: NodeProps<WorkflowNode>) {
  const nodeBodyRef = useNodeLayoutSync(id);
  const { openStorybookEditor } = useNodeActions();
  const storybook = useMemo(() => {
    try {
      return data.storybookJson ? parseRpStorybookJson(data.storybookJson) : emptyRpStorybook;
    } catch {
      return emptyRpStorybook;
    }
  }, [data.storybookJson]);
  const characterNames = useMemo(
    () => storybook.characters
      .map((character) => character.name || character.id)
      .filter(Boolean),
    [storybook],
  );
  const storybookHasContent = hasStorybookContent(storybook);

  return (
    <div className={`workflow-node rp-storybook-node${runStateClassName(data)}`} ref={nodeBodyRef}>
      <div className="node-title-row">
        <span className="node-dot" />
        <strong>{data.label}</strong>
      </div>
      <span className="node-description">{data.description}</span>
      <div className="storybook-node-summary">
        <strong>{storybook.title || 'Untitled Storybook'}</strong>
        <span className="storybook-node-introduction">
          {storybook.introduction || 'No introduction defined.'}
        </span>
        <span>Characters: {characterNames.length ? characterNames.join(', ') : 'None'}</span>
        {storybookHasContent && (
          <span className="storybook-node-token-estimate">
            ~{estimatedRpStorybookPromptTokens(storybook).toLocaleString('en-US')} tokens (images excluded)
          </span>
        )}
      </div>
      <div className="storybook-actions">
        <button className="load-text-button nodrag" type="button" onClick={() => openStorybookEditor(id)}>
          Open Editor
        </button>
      </div>
      <div className="node-actions">
        <span className="run-note">{data.storybookStatus ?? data.preview}</span>
      </div>
      <div className="workflow-ports">
        <div className="workflow-port workflow-port-output">
          <PortLabel data={data} direction="output" handle="json" label="JSON" valueType="json" />
          <Handle id="json" type="source" position={Position.Right} />
        </div>
        <div className="workflow-port workflow-port-output">
          <PortLabel data={data} direction="output" handle="formatted-text" label="Formatted Text" valueType="text" />
          <Handle id="formatted-text" type="source" position={Position.Right} />
        </div>
        <div className="workflow-port workflow-port-output">
          <PortLabel data={data} direction="output" handle="character-info" label="Character Info" valueType="text" />
          <Handle id="character-info" type="source" position={Position.Right} />
        </div>
      </div>
    </div>
  );
}
