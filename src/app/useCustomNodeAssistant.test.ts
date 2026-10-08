import { beforeEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import type { WorkflowNode } from '../types';
import { defaultCustomNodeDefinition } from '../nodes/custom-node/model';
import { useCustomNodeAssistant } from './useCustomNodeAssistant';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock('react', () => ({
  useState: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function'
        ? (update as (current: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(current: T) => ({ current }),
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => {},
}));
beforeEach(() => { hooks.slots = []; hooks.index = 0; });

it('rejects an assistant patch when runtime state changed during the request', async () => {
  const definition = { ...defaultCustomNodeDefinition(), state: { count: 1 } };
  const node = { id: 'custom', data: { nodeType: 'custom', customNodeDefinition: definition } } as WorkflowNode;
  const nodesRef = { current: [node] };
  let resolve!: (value: unknown) => void;
  const complete = vi.fn(() => new Promise((done) => { resolve = done; }));
  const updateRuntimeNode = vi.fn();
  const render = () => {
    hooks.index = 0;
    // The explicit state harness avoids launching a renderer or DOM.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useCustomNodeAssistant({ nodes: nodesRef.current, nodesRef, edges: [], inputImages: [],
      nodeLlm: { complete } as unknown as Parameters<typeof useCustomNodeAssistant>[0]['nodeLlm'], updateRuntimeNode });
  };
  render().open(node.id);
  const pending = render().submitMessage('Improve the label', 'provider');
  nodesRef.current = [{ ...node, data: { ...node.data, customNodeDefinition: { ...definition, state: { count: 2 } } } }];
  resolve({ text: JSON.stringify({ reply: 'Updated', patch: { label: 'New label' } }), connection: { label: 'Provider' } });
  await pending;
  expect(updateRuntimeNode.mock.calls.some(([, patch]) => patch.customNodeDefinition)).toBe(false);
  expect(render().messages).toContainEqual(expect.objectContaining({ role: 'error', text: expect.stringContaining('node changed') }));
});
