import { afterEach, expect, it, vi } from 'vitest';
import { useRuntimeNodePatching } from './useRuntimeNodePatching';
import type { WorkflowNode } from '../types';

vi.mock('react', async (importOriginal) => ({ ...await importOriginal<typeof import('react')>(),
  useRef: <T,>(current: T) => ({ current }),
}));
afterEach(() => vi.useRealTimers());

it('skips unchanged runtime patches without suppressing changed token counts', () => {
  const nodesRef = { current: [{ id: 'llm', data: { nodeType: 'llm-prompt', llmActiveReasoningTokens: 10 } }] as WorkflowNode[] };
  const commitNodes = vi.fn((nodes: WorkflowNode[]) => { nodesRef.current = nodes; });
  const { updateRuntimeNode } = useRuntimeNodePatching({ nodesRef, commitNodes,
    activeRunRef: { current: null }, activeRunLlmReportRef: { current: null }, setRunLlmReport: vi.fn(),
    openingHistorySignature: () => '', onStorybookOpeningHistoryChanged: vi.fn(),
    replaceCurrentChatWithOpeningHistoryRef: { current: false },
  });
  updateRuntimeNode('llm', { llmActiveReasoningTokens: 10 });
  updateRuntimeNode('missing', { llmActiveReasoningTokens: 20 });
  expect(commitNodes).not.toHaveBeenCalled();
  updateRuntimeNode('llm', { llmActiveReasoningTokens: 20 });
  expect(commitNodes).toHaveBeenCalledTimes(1);
  expect(nodesRef.current[0].data.llmActiveReasoningTokens).toBe(20);
});

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
