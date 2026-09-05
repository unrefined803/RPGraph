import { describe, expect, it } from 'vitest';
import { customNodeDefinition, defaultCustomNodeDefinition } from '../nodes/custom-node/model';
import type { WorkflowNode } from '../types';
import { captureTurnRuntime, restoreTurnRuntime } from './turns';

describe('turn runtime rollback', () => {
  it.each(['rp-storybook', 'rp-storybook-editor'] as const)('restores %s content after a failed run', (nodeType) => {
    const before = {
      id: 'book', type: 'workflow', position: { x: 0, y: 0 },
      data: { nodeType, label: 'Book', storybookJson: '{"description":"original"}' },
    } as WorkflowNode;
    const snapshot = captureTurnRuntime([before]);
    const after = { ...before, data: { ...before.data, storybookJson: '{"description":"changed"}', storybookStatus: 'Updated' } };
    const [restored] = restoreTurnRuntime([after], snapshot);
    expect(restored.data.storybookJson).toBe(before.data.storybookJson);
    expect(restored.data.storybookStatus).toBeUndefined();
  });
});


it('rolls back custom state after a failed run', () => {
  const before = {
    id: 'custom', type: 'workflow', position: { x: 0, y: 0 },
    data: { nodeType: 'custom', label: 'Counter', customNodeDefinition: { ...defaultCustomNodeDefinition(), state: { count: 0 } } },
  } as WorkflowNode;
  const snapshot = captureTurnRuntime([before]);
  const after = structuredClone(before);
  customNodeDefinition(after.data.customNodeDefinition).state.count = 1;
  expect(customNodeDefinition(restoreTurnRuntime([after], snapshot)[0].data.customNodeDefinition).state.count).toBe(0);
});
