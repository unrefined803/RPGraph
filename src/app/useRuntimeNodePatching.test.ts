import { afterEach, expect, it, vi } from 'vitest';
import { useRuntimeNodePatching } from './useRuntimeNodePatching';
import type { WorkflowNode } from '../types';

vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(),
  useRef: <T,>(current: T) => ({ current }),
}));
afterEach(() => vi.useRealTimers());

it('does not replay runtime data after Undo while ending the delayed active indicator', () => {
  vi.useFakeTimers();
  const nodesRef = { current: [{ id: 'memory', data: { nodeType: 'memory-slot', memorySlotText: 'Before' } }] as WorkflowNode[] };
  const { updateRuntimeNode } = useRuntimeNodePatching({
    nodesRef, commitNodes: (nodes) => { nodesRef.current = nodes; }, activeRunRef: { current: null },
    activeRunLlmReportRef: { current: null }, setRunLlmReport: vi.fn(),
    openingHistorySignature: () => '', onStorybookOpeningHistoryChanged: vi.fn(),
    replaceCurrentChatWithOpeningHistoryRef: { current: false },
  });
  updateRuntimeNode('memory', { runActive: true });
  updateRuntimeNode('memory', { runActive: false, memorySlotText: 'After' });
  expect(nodesRef.current[0].data.memorySlotText).toBe('After');
  nodesRef.current = [{ ...nodesRef.current[0], data: { ...nodesRef.current[0].data, memorySlotText: 'Before' } }];
  vi.runAllTimers();
  expect(nodesRef.current[0].data.memorySlotText).toBe('Before');
  expect(nodesRef.current[0].data.runActive).toBe(false);
});
