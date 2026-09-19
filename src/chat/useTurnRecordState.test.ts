import { beforeEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import type { MessageRecord, TurnRecord } from '../types';
import { useTurnRecordState } from './useTurnRecordState';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function' ? (update as (current: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
}));
beforeEach(() => { hooks.slots = []; hooks.index = 0; });

function harness() {
  const captureNpcMessages = vi.fn();
  const reconcileNpcMessages = vi.fn();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const state = useTurnRecordState({ appCharacters: () => [], captureNpcMessages, reconcileNpcMessages,
    nodesRef: { current: [] }, setNodes: vi.fn(), workflowVariablesRef: { current: {} }, setWorkflowVariables: vi.fn() });
  return { state, captureNpcMessages, reconcileNpcMessages };
}

it('updates live text and its collector without rebuilding saved turns or changing contacts', () => {
  const { state, captureNpcMessages, reconcileNpcMessages } = harness();
  const oldMessage: MessageRecord = { id: 1, role: 'output', originalText: 'Earlier' };
  const oldTurn: TurnRecord = { id: 'old', number: 1, createdAt: '',
    input: { graphText: '', messages: [] }, output: { graphText: 'Earlier', messages: [oldMessage] } };
  state.setMessages([oldMessage]);
  state.setTurns([oldTurn]);
  state.nextMessageIdRef.current = 2;
  state.activeTurnCollectorRef.current = { turnId: 'new', turnNumber: 2, createdAt: '', part: 'output', inputMessages: [], outputMessages: [] };
  const id = state.appendMessage({ role: 'output', originalText: '', includeInHistory: false });
  const turns = state.turnsRef.current;
  captureNpcMessages.mockClear();
  reconcileNpcMessages.mockClear();
  for (const text of ['A', 'A new', 'A new answer']) state.updateMessage(id, { originalText: text }, { streaming: true });
  expect(state.messagesRef.current[1].originalText).toBe('A new answer');
  expect(state.activeTurnCollectorRef.current.outputMessages[0].originalText).toBe('A new answer');
  expect(state.messagesRef.current[0]).toBe(oldMessage);
  expect(state.turnsRef.current).toBe(turns);
  expect(captureNpcMessages).not.toHaveBeenCalled();
  expect(reconcileNpcMessages).not.toHaveBeenCalled();
  state.updateMessage(id, { originalText: 'A new answer.', includeInHistory: true });
  expect(captureNpcMessages).toHaveBeenCalledWith([expect.objectContaining({ originalText: 'A new answer.', includeInHistory: true })]);
  expect(reconcileNpcMessages).toHaveBeenCalledTimes(1);
  expect(state.turnsRef.current).toBe(turns);
});

it('still edits existing turn messages without changing unrelated turns', () => {
  const { state } = harness();
  const messages: MessageRecord[] = [1, 2].map((id) => ({ id, role: 'output', originalText: `Reply ${id}` }));
  const turns: TurnRecord[] = messages.map((message) => ({ id: String(message.id), number: message.id, createdAt: '',
    input: { graphText: '', messages: [] }, output: { graphText: '', messages: [message] } }));
  state.setMessages(messages);
  state.setTurns(turns);
  state.updateMessage(1, { translatedText: 'Translated' });
  expect(state.turnsRef.current[0].output.messages[0].translatedText).toBe('Translated');
  expect(state.turnsRef.current[1]).toBe(turns[1]);
});
