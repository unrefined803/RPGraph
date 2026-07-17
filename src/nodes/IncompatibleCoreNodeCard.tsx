import type { NodeProps } from '@xyflow/react';
import type { WorkflowNode } from '../types';
import { useNodeActions } from './NodeActionsContext';

export function IncompatibleCoreNodeCard({ id, data }: NodeProps<WorkflowNode>) {
  const { upgradeNode } = useNodeActions();
  return (
    <div className="workflow-node incompatible-core-node">
      <div className="node-title-row">
        <span className="node-dot" />
        <strong>{data.label || 'Incompatible Node'}</strong>
      </div>
      <span className="node-description">{data.description || data.nodeType}</span>
      <p className="incompatible-core-node-note">
        Disabled incompatible core node
      </p>
      <dl className="incompatible-core-node-details">
        <div>
          <dt>Node type</dt>
          <dd>{data.nodeType}</dd>
        </div>
        <div>
          <dt>Stored version</dt>
          <dd>{data.nodeDataVersion}</dd>
        </div>
        <div>
          <dt>Required version</dt>
          <dd>{data.currentNodeVersion}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="load-text-button nodrag"
        onClick={() => upgradeNode(id)}
      >
        Upgrade Node
      </button>
      <p className="incompatible-core-node-hint">
        Recreates the current version and copies matching settings. Some settings may
        reset, and you will need to reconnect its wires.
      </p>
    </div>
  );
}
