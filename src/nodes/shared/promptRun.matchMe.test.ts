import { describe, expect, it, vi } from 'vitest';
import { runActionAwarePrompt } from './promptRun';
import type { ExecuteContext } from '../types';
import type { StorybookCharacter } from '../../storybook/runtime';
import type { WorkflowNode, MessageRecord } from '../../types';
import { matchMeContext, matchMeState, matchMePairId } from '../../chat/matchMe';

const characters = ['Ryan', 'Avery'].map((name) => ({
  id: name.toLowerCase(), sourceId: name.toLowerCase(), name,
  profile: { personality: 'Private secret', speechStyle: 'Friendly' },
  apps: { matchme: { enabled: true, accountId: `account-${name}` } },
  social: { plotTwist: { name, age: 25, bio: 'Public bio', interests: 'Music', decisions: {} } },
})) as StorybookCharacter[];
const messages: MessageRecord[] = [{
  id: 1, role: 'user', originalText: 'Ryan and Avery matched.',
  matchMeMatch: {
    id: matchMePairId('account-Ryan', 'account-Avery'),
    accountIds: ['account-Ryan', 'account-Avery'],
    matchedAt: '2026-09-19T12:00:00Z', status: 'active',
  },
}];
const reply = JSON.stringify({ matchMeApp: [{ from: 'account-Ryan', to: 'account-Avery', message: 'Hello!' }] });

async function run(history: MessageRecord[], command = false, direct = false, phone: Partial<ExecuteContext> = {}, inputValue = 'Narrator: Ryan texts Avery.') {
  const prompts: string[] = [];
  const warning = vi.fn();
  const context = {
    ...phone,
    nodes: [], historyMessages: history, appCharacters: characters,
    matchMeDirectMessage: direct ? { app: 'matchme', fromAccountId: 'account-Avery', toAccountId: 'account-Ryan' } : undefined,
    reportWarning: warning, reportFormatResult: vi.fn(), updateRuntimeData: vi.fn(),
    llm: {
      supportsVision: async () => false,
      complete: async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        return { text: prompts.length === 1 ? '- Ryan messages Avery.'
          : command && prompts.length === 2 ? 'Ryan types. [messenger_message: Ryan greets Avery on MatchMe]' : reply,
        connection: { label: 'Test' } };
      },
    },
  } as unknown as ExecuteContext;
  const result = await runActionAwarePrompt({
    node: { id: 'prompt', data: { label: 'Narrator' } } as WorkflowNode,
    context, inputValue, images: [], referenceImages: [],
    promptBefore: '', promptAfter: '@step:planning\nPlan the scene.\n@step:main\n@output:planning\nWrite the scene.'
      + (command ? '\n@command:messenger_message' : ''),
    actionConfigs: [], streamsVisibleOutput: false, contributesToTokenCalibration: false,
    callLabel: () => 'Narrator',
  });
  return { result, prompts, warning };
}

describe('Workflow-routed MatchMe context', () => {
  it.each([false, true])('does not inject global matches into planning, output or commands (command=%s)', async (command) => {
    const { result, prompts, warning } = await run(messages, command);
    expect(prompts).toHaveLength(command ? 3 : 2);
    for (const prompt of prompts) {
      expect(prompt).not.toContain('[MATCHME APPLICATION CONTEXT]');
      expect(prompt).not.toContain('Private secret');
    }
    expect(result.generatedText).toContain(reply);
    expect(warning).not.toHaveBeenCalled();
    for (const pass of result.debug.promptPasses) {
      expect(pass.sections?.some((section) => section.label === 'MatchMe Application Context')).toBe(false);
    }
  });

  it.each([false, true])('preserves MatchMe context received through the text input (command=%s)', async (command) => {
    const input = matchMeContext(matchMeState(characters, messages));
    const { prompts } = await run(messages, command, false, {}, input);
    for (const prompt of prompts) {
      expect(prompt).toContain(input);
      expect(prompt.split('[MATCHME APPLICATION CONTEXT]')).toHaveLength(2);
    }
  });

  it('does not turn visible match text into permission', async () => {
    const { result, prompts, warning } = await run([{ ...messages[0], matchMeMatch: undefined }]);
    expect(prompts.every((prompt) => !prompt.includes('[MATCHME APPLICATION CONTEXT]'))).toBe(true);
    expect(result.generatedText).not.toContain('matchMeApp');
    expect(warning).toHaveBeenCalled();
  });

  it.each([{ phoneMessage: true }, { messageFormat: 1 }])('omits global dating context from WhatsUp runs (%j)', async (phone) => {
    const { prompts, result } = await run(messages, false, false, phone);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) expect(prompt).not.toContain('[MATCHME APPLICATION CONTEXT]');
    for (const pass of result.debug.promptPasses)
      expect(pass.sections?.some((section) => section.label === 'MatchMe Application Context')).toBe(false);
  });

  it('leaves direct replies scoped to their existing input context', async () => {
    const { prompts, warning } = await run(messages, false, true);
    expect(prompts.every((prompt) => !prompt.includes('[MATCHME APPLICATION CONTEXT]'))).toBe(true);
    expect(warning).not.toHaveBeenCalled();
  });
});
