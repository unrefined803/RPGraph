import { expect, it, vi } from 'vitest';
import { TextMetricsApi } from '../../llm/tokenMetrics';
import type { WorkflowNode } from '../../types';
import type { ExecuteContext } from '../types';
import { createUserQuestionChannel } from '../../app/userQuestion';
import { configForPromptActionToken, defaultPromptActionConfig, normalizePromptActionConfig,
  parsePromptActionRequest, promptActionSaveConfigs } from './promptActions';
import { runActionAwarePrompt } from './promptRun';

it('recognizes and round-trips Ask User without accepting missing questions', () => {
  const config = defaultPromptActionConfig('', 'askUser');
  expect(configForPromptActionToken([], 'Ask User')).toEqual(config);
  expect(normalizePromptActionConfig(promptActionSaveConfigs([config])[0])).toEqual(config);
  expect(parsePromptActionRequest('{"action":"ask_user","question":"How do you react?"}'))
    .toEqual({ action: 'askUser', plan: 'How do you react?' });
  for (const question of ['', '  ', null, 42]) {
    expect(parsePromptActionRequest(JSON.stringify({ action: 'ask_user', question }))).toBeUndefined();
  }
});

function start(planning: boolean, channel: ReturnType<typeof createUserQuestionChannel>, signal: AbortSignal) {
  const calls: string[] = [];
  const replies = ['{"action":"ask_user","question":"Anna blocks the door. What do you do?"}',
    planning ? 'Anna blocks the door; the player asks her to move.' : 'The final scene.', 'The final scene.'];
  const context = {
    nodes: [], historyMessages: [], textMetrics: new TextMetricsApi(),
    askUser: (question: string) => channel.ask(question, signal),
    reportWarning: vi.fn(), reportFormatResult: vi.fn(), updateRuntimeData: vi.fn(),
    llm: { supportsVision: async () => false, complete: async ({ prompt }: { prompt: string }) => {
      calls.push(prompt);
      return { text: replies[calls.length - 1], connection: { label: 'Test' } };
    } },
  } as unknown as ExecuteContext;
  const result = runActionAwarePrompt({
    node: { id: 'prompt', data: { label: 'Narrator' } } as WorkflowNode, context,
    inputValue: 'Player: Morgan', images: [], referenceImages: [], promptBefore: '',
    promptAfter: planning
      ? '@step:planning\nPlan.\n@action:Ask User\n@step:main\nWrite.\n@output:planning\n@action:Ask User'
      : 'Write.\n@action:Ask User',
    actionConfigs: [defaultPromptActionConfig('', 'askUser')], streamsVisibleOutput: false,
    contributesToTokenCalibration: false, callLabel: 'Narrator',
  });
  return { calls, result };
}

it.each([false, true])('pauses a %s planning run and resumes only through authored action/output markers', async (planning) => {
  const channel = createUserQuestionChannel();
  const { calls, result } = start(planning, channel, new AbortController().signal);
  await vi.waitFor(() => expect(channel.getSnapshot()).not.toBeNull());
  expect(calls).toHaveLength(1);
  channel.answer(channel.getSnapshot()!.id, 'I ask her to move. Literal {{question}}.');
  const output = await result;
  expect(output.generatedText).toBe('The final scene.');
  expect(calls).toHaveLength(planning ? 3 : 2);
  expect(calls[1]).toContain('User question: Anna blocks the door. What do you do?');
  expect(calls[1]).toContain('User answer: I ask her to move. Literal {{question}}.');
  if (planning) expect(calls[2]).toContain('Anna blocks the door; the player asks her to move.');
  expect(output.debug.actionResults).toHaveLength(1);
});

it('aborts while waiting without calling the model again', async () => {
  const channel = createUserQuestionChannel();
  const controller = new AbortController();
  const { calls, result } = start(true, channel, controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(channel.getSnapshot()).not.toBeNull());
  controller.abort();
  await rejected;
  expect(calls).toHaveLength(1);
});
