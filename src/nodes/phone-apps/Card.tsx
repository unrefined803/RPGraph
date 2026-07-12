import type { NodeProps } from '@xyflow/react';
import type { WorkflowNode } from '../../types';
import { useNodeActions } from '../NodeActionsContext';
import { useNodeView } from '../NodeViewContext';
import { runStateClassName, useNodeLayoutSync } from '../shared/CardView';
import { ConnectionSelect } from '../shared/ConnectionSelect';
import { NodeCustomSelect } from '../shared/NodeCustomSelect';
import { providerOption } from '../shared/providerHealthLabels';

export function PhoneAppsNodeCard({ id, data }: NodeProps<WorkflowNode>) {
  const actions = useNodeActions();
  const { connections, providerHealthById } = useNodeView();

  const nodeBodyRef = useNodeLayoutSync(id);
  const notesOptions = connections
    .filter((connection) => connection.kind !== 'comfyui')
    .map((connection) => providerOption(connection, providerHealthById[connection.id]));

  return (
    <div className={`workflow-node phone-apps-node${runStateClassName(data)}`} ref={nodeBodyRef}>
      <div className="node-title-row">
        <span className="node-dot" />
        <strong>{data.label}</strong>
      </div>
      <span className="node-description">{data.description}</span>
      <ConnectionSelect id={id} label="CHATGPD LLM" connectionId={data.connectionId} />
      <label className="node-field-label" htmlFor={`${id}-notes-connection`}>
        NOTES LLM
      </label>
      <NodeCustomSelect
        id={`${id}-notes-connection`}
        value={data.phoneAppsNotesConnectionId}
        onChange={(value) => actions.updateData(id, { phoneAppsNotesConnectionId: value })}
        options={notesOptions}
      />
      <div className="node-actions">
        <span className="run-note">{data.preview}</span>
      </div>
    </div>
  );
}
