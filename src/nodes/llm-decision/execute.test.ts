import { expect, it, vi } from 'vitest';
import type { WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { executeLlmDecisionNode } from './execute';

function harness(responses: string[], retry = true) {
  const complete = vi.fn(async () => ({ text: responses.shift() ?? '{}' }));
  const reportWarning = vi.fn();
  const reportFormatResult = vi.fn();
  const updateRuntimeData = vi.fn();
  const node = { id: 'decision', data: { nodeType: 'llm-decision', label: 'Decision' } } as WorkflowNode;
  const context = {
    nodes: [node], edges: [{ source: 'input', target: node.id }], executeInput: async () => 'An attempt.',
    llm: { complete }, reportWarning, reportFormatResult, updateRuntimeData,
    textMetrics: { bytesPerToken: 4 }, runScratch: new Map(), retryFormatErrorsEnabled: retry,
  } as unknown as ExecuteContext;
  return { run: () => executeLlmDecisionNode(node, context), complete, reportWarning, reportFormatResult, updateRuntimeData };
}

it.each(['plain prose', '{}', '{"bool":"true.","text":"yes","number":1}',
  '{"bool":"Yes, definitely","text":"yes","number":1}',
  '{"bool":"__proto__","text":"yes","number":1}',
  '{"bool":true,"text":"yes","number":""}'])('retries an invalid decision: %s', async (invalid) => {
  const test = harness([invalid, '{"bool":true,"text":"accepted","number":2}']);
  expect(await test.run()).toBe('accepted');
  expect(test.complete).toHaveBeenCalledTimes(2);
  expect(test.reportWarning).not.toHaveBeenCalled();
  expect(test.updateRuntimeData).toHaveBeenLastCalledWith('decision', expect.objectContaining({ llmDecisionBoolResults: [true] }));
});

it.each([true, false])('reports invalid decisions after the configured attempts (retry=%s)', async (retry) => {
  const test = harness(['{}', '{}'], retry);
  expect(await test.run()).toBe('');
  expect(test.complete).toHaveBeenCalledTimes(retry ? 2 : 1);
  expect(test.reportFormatResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  expect(test.reportWarning).toHaveBeenCalledOnce();
});

it('accepts a valid false decision without retrying', async () => {
  const test = harness(['{"bool":false,"text":"no","number":0}']);
  expect(await test.run()).toBe('no');
  expect(test.complete).toHaveBeenCalledOnce();
  expect(test.reportWarning).not.toHaveBeenCalled();
});
