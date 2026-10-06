import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import type { WorkflowFile } from '../../types';
import type { ExecuteContext } from '../types';
import { llmPromptSwitchOutputHandle } from '../../workflow';
import { runActionAwarePrompt } from '../shared/promptRun';
import { executeLlmPromptSwitchNode } from './execute';

vi.mock('../shared/promptRun', () => ({ runActionAwarePrompt: vi.fn() }));

function phoneInitiativeContext() {
  const workflow = JSON.parse(readFileSync('resources/default-content/default_normal_v42.json', 'utf8')) as WorkflowFile;
  const node = workflow.nodes.find((entry) => entry.data.nodeType === 'llm-prompt-switch')!;
  const values: Record<string, string> = { text: 'AI phone initiative for Alex', 'output-channel': '2', 'prompt-slot': '7' };
  const context = {
    nodes: [node], historyMessages: [], runScratch: new Map(), referenceImages: { maxImages: 0 }, promptActionSettings: {},
    edges: Object.keys(values).map((handle) => ({ id: handle, source: handle, target: node.id, targetHandle: handle })),
    executeInput: async (source: string) => values[source],
    sourceHandle: llmPromptSwitchOutputHandle(2),
    updateRuntimeData: vi.fn(), reportWarning: vi.fn(), textMetrics: { bytesPerToken: 4 },
  } as unknown as ExecuteContext;
  return { node, context };
}

it('emits phone initiative on Social Media only and preserves its app payload', async () => {
  const { node, context } = phoneInitiativeContext();
  const payload = '{"whatsUpApp":[{"from":"Sam","to":"Alex","message":"Are you free?"}]}';
  vi.mocked(runActionAwarePrompt).mockResolvedValueOnce({ generatedText: payload, connectionLabel: 'Test' } as Awaited<ReturnType<typeof runActionAwarePrompt>>);
  expect(await executeLlmPromptSwitchNode(node, context)).toBe(payload);
  expect(runActionAwarePrompt).toHaveBeenLastCalledWith(expect.objectContaining({
    inputValue: 'AI phone initiative for Alex', promptBefore: '',
    promptAfter: node.data.llmPromptSwitchPromptAftersByOutput![2][7],
  }));
  expect(await executeLlmPromptSwitchNode(node, { ...context, sourceHandle: llmPromptSwitchOutputHandle(0) })).toBe('');
});

it('rejects a missing Phone Initiative slot instead of running the default social prompt', async () => {
  const { node, context } = phoneInitiativeContext();
  node.data.llmPromptSwitchPromptTitlesByOutput![2].pop();
  await expect(executeLlmPromptSwitchNode(node, context)).rejects.toThrow('Social Media slot 7 (Phone Initiative) is missing');
  expect(context.reportWarning).not.toHaveBeenCalled();
});
