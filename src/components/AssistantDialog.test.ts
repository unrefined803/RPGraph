import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ComponentProps, type ReactNode, type SetStateAction } from 'react';
import { AssistantDialog, type AssistantMessage } from './AssistantDialog';
import type { ConnectionPreset, WorkflowNode } from '../types';
import { rpStorybookJsonText, starterRpStorybook } from '../nodes/rp-storybook/model';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as Array<() => void | (() => void)> }));
const code = vi.hoisted(() => vi.fn(async () => 'node implementation'));
vi.mock('../nodes/codeResolver', () => ({ getNodeCodeSnippet: code }));
vi.mock('../navigation/usePanelNavigation', () => ({ usePanelNavigationOverlay: () => {} }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function' ? (update as (value: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useMemo: <T,>(factory: () => T) => factory(),
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));

beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.effects = []; code.mockReset(); code.mockResolvedValue('node implementation'); });
afterEach(() => vi.unstubAllGlobals());

type ElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { currentTarget: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
  placeholder?: string;
};
function elements(node: ReactNode): ElementProps[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node.props, ...elements(node.props.children)];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// Exercise callbacks and asynchronous control flow without mounting UI or a browser.
function harness() {
  const listeners = new Map<string, (event: KeyboardEvent) => void>();
  vi.stubGlobal('document', {
    addEventListener: (name: string, handler: (event: KeyboardEvent) => void) => listeners.set(name, handler),
    removeEventListener: (name: string) => listeners.delete(name),
  });
  const bridge = { streamChatCompletion: vi.fn(async (_request: unknown, _chunk: (text: string) => void, _register: (cancel: () => void) => void) => ({ text: 'Answer' })) };
  vi.stubGlobal('window', { rpgraph: bridge });
  const connection = {} as ConnectionPreset;
  const props: ComponentProps<typeof AssistantDialog> = {
    mode: 'workflow', connections: [], providerHealthById: {}, defaultConnectionId: '',
    resolveConnection: vi.fn(async () => connection), messages: [],
    setMessages: (update) => { props.messages = typeof update === 'function' ? update(props.messages) : update; },
    estimatedTokenBytesPerToken: 4, onClose: vi.fn(),
    workflowNodes: [{ id: 'prompt', data: { nodeType: 'llm-prompt', label: 'Prompt', prompt: 'Authored prompt', other: 'Do not load this field' } } as unknown as WorkflowNode],
  };
  function render() { hooks.index = 0; return elements(AssistantDialog(props)); }
  render();
  const cleanup = hooks.effects.map((effect) => effect());
  function send() {
    render().find((element) => element.placeholder)?.onChange?.({ currentTarget: { value: 'Explain this workflow' } });
    render().find((element) => element.onSubmit)?.onSubmit?.({ preventDefault() {} });
  }
  function escape() {
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent;
    listeners.get('keydown')?.(event);
    return event;
  }
  return { props, bridge, send, escape, render, unmount: () => cleanup.forEach((dispose) => dispose?.()), connection };
}

it('closes on Escape and prevents a late connection resolution from starting a request', async () => {
  const state = harness();
  const pending = deferred<ConnectionPreset>();
  state.props.resolveConnection = vi.fn(() => pending.promise);
  state.send();
  const event = state.escape();
  expect(state.props.onClose).toHaveBeenCalledOnce();
  expect(event.preventDefault).toHaveBeenCalledOnce();
  pending.resolve(state.connection);
  await pending.promise;
  expect(state.bridge.streamChatCompletion).not.toHaveBeenCalled();
});

it('invalidates late streaming callbacks and completion after unmount', async () => {
  const state = harness();
  const pending = deferred<{ text: string }>();
  const cancel = vi.fn();
  let chunk!: (text: string) => void;
  state.bridge.streamChatCompletion.mockImplementation((_request, onChunk, register) => {
    chunk = onChunk;
    register(cancel);
    return pending.promise;
  });
  state.send();
  await vi.waitFor(() => expect(state.bridge.streamChatCompletion).toHaveBeenCalledOnce());
  state.unmount();
  const messages = [...state.props.messages];
  expect(cancel).toHaveBeenCalledOnce();
  chunk('Late chunk');
  pending.resolve({ text: 'Late answer' });
  await pending.promise;
  expect(state.props.messages).toEqual(messages);
});

it('does not resume after closing during source context loading', async () => {
  const state = harness();
  const pending = deferred<string>();
  code.mockReturnValue(pending.promise);
  state.bridge.streamChatCompletion.mockResolvedValue({ text: '{"load":"node","id":"prompt"}' });
  state.send();
  await vi.waitFor(() => expect(code).toHaveBeenCalledOnce());
  state.escape();
  const messages = [...state.props.messages];
  pending.resolve('Source loaded too late');
  await pending.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.bridge.streamChatCompletion).toHaveBeenCalledOnce();
  expect(state.props.messages).toEqual(messages);
});

it('loads only the requested node field without loading source code', async () => {
  const state = harness();
  state.bridge.streamChatCompletion.mockResolvedValueOnce({ text: '{"load":"nodeData","id":"prompt","field":"prompt"}' });
  state.send();
  await vi.waitFor(() => expect(state.bridge.streamChatCompletion).toHaveBeenCalledTimes(2));
  const followUp = state.bridge.streamChatCompletion.mock.calls[1][0] as { prompt: string };
  expect(followUp.prompt).toContain('Authored prompt');
  expect(followUp.prompt).not.toContain('Do not load this field');
  expect(code).not.toHaveBeenCalled();
  expect(state.props.messages.some((message: AssistantMessage) => message.role === 'context')).toBe(true);
});

it('reports empty prompt fields as successful and guides duplicate requests to the loaded result', async () => {
  const state = harness();
  Object.assign(state.props.workflowNodes![0].data, {
    llmPromptSwitchPromptBeforesByOutput: [['', ''], ['']],
    llmPromptSwitchPromptAftersByOutput: [['Main prompt']],
  });
  const before = '{"load":"nodeData","id":"prompt","field":"llmPromptSwitchPromptBeforesByOutput"}';
  const after = '{"load":"nodeData","id":"prompt","field":"llmPromptSwitchPromptAftersByOutput"}';
  state.bridge.streamChatCompletion
    .mockResolvedValueOnce({ text: before })
    .mockResolvedValueOnce({ text: before })
    .mockResolvedValueOnce({ text: after });
  state.send();
  await vi.waitFor(() => expect(state.bridge.streamChatCompletion).toHaveBeenCalledTimes(4));
  const prompts = state.bridge.streamChatCompletion.mock.calls.map(([request]) => (request as { prompt: string }).prompt);
  expect(prompts[1]).toContain('3 text values, 0 non-empty');
  expect(prompts[1]).toContain('All text values are empty; this is a successful load.');
  expect(prompts[2]).toContain('Already loaded; duplicate request skipped:');
  expect(prompts[3]).toContain('Main prompt');
  const contextMessages = state.props.messages.filter((message) => message.role === 'context');
  expect(contextMessages.filter((message) => message.text.startsWith('Loaded node context:'))).toHaveLength(2);
  expect(contextMessages[0].text).toContain(`Request: ${before}`);
  expect(contextMessages[2].text).toContain(`Request: ${after}`);
});

it('never reloads implementation code repeatedly within the same question', async () => {
  const state = harness();
  state.bridge.streamChatCompletion.mockResolvedValue({ text: '{"load":"node","id":"prompt"}' });
  state.send();
  await vi.waitFor(() => expect(state.props.messages.some((message) => message.role === 'error')).toBe(true));
  expect(code).toHaveBeenCalledOnce();
  expect(state.bridge.streamChatCompletion).toHaveBeenCalledTimes(3);
  expect(state.props.messages[state.props.messages.length - 1]?.text).toContain('Stopped repeated context requests');
});


it('recovers an invented Storybook field using the advertised narrative request', async () => {
  const state = harness();
  Object.assign(state.props.workflowNodes![0].data, {
    nodeType: 'rp-storybook',
    storybookJson: rpStorybookJsonText({ ...starterRpStorybook, title: 'Harbor mystery' }),
  });
  state.bridge.streamChatCompletion
    .mockResolvedValueOnce({ text: '{"load":"nodeData","id":"prompt","field":"formattedText"}' })
    .mockResolvedValueOnce({ text: '{"load":"nodeData","id":"prompt","field":"storybookContent"}' });
  state.send();
  await vi.waitFor(() => expect(state.bridge.streamChatCompletion).toHaveBeenCalledTimes(3));
  const prompts = state.bridge.streamChatCompletion.mock.calls.map(([request]) => (request as { prompt: string }).prompt);
  expect(prompts[1]).toContain('To read the Storybook narrative, use {"load":"nodeData","id":"prompt","field":"storybookContent"}');
  expect(prompts[2]).toContain('Harbor mystery');
  expect(prompts[2]).not.toContain('"storybookJson":');
  expect(code).not.toHaveBeenCalled();
});


it('bounds recovery attempts when the model keeps inventing fields', async () => {
  const state = harness();
  state.bridge.streamChatCompletion.mockResolvedValue({ text: '{"load":"nodeData","id":"prompt","field":"missing"}' });
  state.send();
  await vi.waitFor(() => expect(state.props.messages.some((message) => message.text.startsWith('Stopped after 4 context requests'))).toBe(true));
  expect(state.bridge.streamChatCompletion).toHaveBeenCalledTimes(5);
  expect(state.props.messages.some((message) => message.text.startsWith('Loaded node context:'))).toBe(false);
});

it('runs the first of several closing commands and accepts an inline-code command', async () => {
  const state = harness();
  Object.assign(state.props.workflowNodes![0].data, { second: 'Second field value' });
  state.bridge.streamChatCompletion
    .mockResolvedValueOnce({ text: 'I need two fields.\n{"load":"nodeData","id":"prompt","field":"prompt"}\n{"load":"nodeData","id":"prompt","field":"second"}' })
    .mockResolvedValueOnce({ text: '`{"load":"nodeData","id":"prompt","field":"second"}`' });
  state.send();
  await vi.waitFor(() => expect(state.bridge.streamChatCompletion).toHaveBeenCalledTimes(3));
  const prompts = state.bridge.streamChatCompletion.mock.calls.map(([request]) => (request as { prompt: string }).prompt);
  expect(prompts[1]).toContain('Authored prompt');
  expect(prompts[1]).not.toContain('Second field value');
  expect(prompts[2]).toContain('Second field value');
  expect(state.props.messages.filter((message) => message.role === 'assistant').map((message) => message.text)).toEqual(['I need two fields.', 'Answer']);
});

it('replaces an empty reply or a failed request with an error instead of an empty bubble', async () => {
  const state = harness();
  state.bridge.streamChatCompletion.mockResolvedValueOnce({ text: '' });
  state.send();
  await vi.waitFor(() => expect(state.props.messages[state.props.messages.length - 1]?.role).toBe('error'));
  expect(state.props.messages.map((message) => message.role)).toEqual(['user', 'error']);

  state.bridge.streamChatCompletion.mockRejectedValueOnce(new Error('Provider offline'));
  state.send();
  await vi.waitFor(() => expect(state.props.messages[state.props.messages.length - 1]?.text).toContain('Provider offline'));
  expect(state.props.messages.some((message) => message.role === 'assistant')).toBe(false);
});
