import { expect, it, vi } from 'vitest';
import type { WorkflowNode } from '../../types';
import { executeContextCompressionNode } from './execute';

type Options = Parameters<typeof executeContextCompressionNode>[0];

const words = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(' ');
// One token per word keeps the budget arithmetic readable.
const textMetrics = {
  measure: (text: string) => ({ tokens: text.split(/\s+/).filter(Boolean).length }),
} as unknown as Options['textMetrics'];

it('absorbs only new text when the summarized prefix is longer than the token limit', async () => {
  const cachedPrefix = words('old', 30);
  const inputValue = `${cachedPrefix} ${words('new', 20)}`;
  const complete = vi.fn(async (_request: { prompt: string }) => ({ text: 'NEW SUMMARY' }));
  const patches: Array<Record<string, unknown>> = [];
  const node = {
    id: 'compression', type: 'workflow', position: { x: 0, y: 0 },
    data: {
      nodeType: 'context-compression', label: 'Compression', contextCompressionMaxTokens: 20,
      compressionSourceText: cachedPrefix, compressedText: 'short earlier summary',
    },
  } as unknown as WorkflowNode;

  const output = await executeContextCompressionNode({
    node,
    incoming: [{ id: 'edge', source: 'input', target: 'compression' }] as Options['incoming'],
    executeNode: async () => inputValue,
    llm: { complete } as unknown as Options['llm'],
    textMetrics,
    estimatedTokenBytesPerToken: 4,
    settingsValueDefinitions: [],
    settingsValues: {},
    postOutputRun: false,
    blockPostOutput: (message) => { throw new Error(message); },
    updateRuntimeNode: (_nodeId, patch) => { patches.push(patch); },
  });

  const prompt = complete.mock.calls[0][0].prompt;
  const lastPatch = patches[patches.length - 1];
  expect(prompt).toContain('EXISTING SUMMARY:\nshort earlier summary');
  expect(prompt).toContain('new1 ');
  expect(prompt).not.toContain('old1 ');
  const source = String(lastPatch?.compressionSourceText);
  expect(source.startsWith(`${cachedPrefix} new1`)).toBe(true);
  expect(output).toContain('NEW SUMMARY');
  expect(output).toContain('new20');
  expect(output).not.toContain('old');
  // Every new word is either summarized or retained, never both and never lost.
  const retained = String(lastPatch?.compressionRemainingText);
  expect(`${source} ${retained}`.split(/\s+/)).toEqual(inputValue.split(/\s+/));
});
