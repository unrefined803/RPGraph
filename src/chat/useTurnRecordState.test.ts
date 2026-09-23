import { beforeEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import type { MessageRecord, TurnRecord } from '../types';
import { useTurnRecordState } from './useTurnRecordState';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, writes: 0 }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.writes++;
      hooks.slots[index] = typeof update === 'function' ? (update as (current: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
}));
beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.writes = 0; });

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
  const stateWrites = hooks.writes;
  const listener = vi.fn();
  const unsubscribe = state.messageStream.subscribe(listener);
  for (const text of ['A', 'A new', 'A new answer']) state.updateMessage(id, { originalText: text }, { streaming: true });
  expect(hooks.writes).toBe(stateWrites);
  expect(listener).toHaveBeenCalledTimes(3);
  expect(state.messageStream.getSnapshot()).toBe(state.messagesRef.current);
  expect(state.messagesRef.current[1].originalText).toBe('A new answer');
  expect(state.activeTurnCollectorRef.current.outputMessages[0].originalText).toBe('A new answer');
  expect(state.messagesRef.current[0]).toBe(oldMessage);
  expect(state.turnsRef.current).toBe(turns);
  expect(captureNpcMessages).not.toHaveBeenCalled();
  expect(reconcileNpcMessages).not.toHaveBeenCalled();
  state.updateMessage(id, { originalText: 'A new answer.', includeInHistory: true });
  expect(captureNpcMessages).toHaveBeenCalledWith([oldMessage, expect.objectContaining({ originalText: 'A new answer.', includeInHistory: true })]);
  expect(reconcileNpcMessages).toHaveBeenCalledTimes(1);
  expect(hooks.writes).toBeGreaterThan(stateWrites);
  expect(state.messageStream.getSnapshot()[1].includeInHistory).toBe(true);
  unsubscribe();
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

it('removes a cancelled preview and replaces stream snapshots when loading a session', () => {
  const { state } = harness();
  const previous: MessageRecord = { id: 10, role: 'output', originalText: 'Previous turn' };
  state.setMessages([previous]);
  state.nextMessageIdRef.current = 11;
  const id = state.appendMessage({ role: 'output', originalText: '', includeInHistory: false });
  state.updateMessage(id, { originalText: 'Partial reply', translatedText: 'Partial translation',
    embeddedPhoneMessages: [{ phoneMessageId: -1, from: 'Alice', to: 'Bob', message: 'Preview' }] },
  { streaming: true });
  expect(state.messageStream.getSnapshot()[1].embeddedPhoneMessages?.[0].message).toBe('Preview');
  state.removeMessage(id);
  expect(state.messageStream.getSnapshot()).toEqual([previous]);
  const replacement: MessageRecord[] = [{ id: 1, role: 'user', originalText: 'Loaded session' }];
  state.setMessages(replacement);
  state.updateMessage(id, { originalText: 'Late chunk' }, { streaming: true });
  expect(state.messageStream.getSnapshot()).toBe(replacement);
  expect(state.messagesRef.current).toBe(replacement);
});

it('changes only affected time records without rebuilding contacts or unrelated turns', () => {
  const { state, reconcileNpcMessages, captureNpcMessages } = harness();
  const older: MessageRecord = { id: 1, role: 'output', originalText: 'Earlier', rpDateTime: '2026-09-21T10:00' };
  const latest: MessageRecord = { id: 2, role: 'output', originalText: 'Latest' };
  const turns: TurnRecord[] = [older, latest].map((message) => ({ id: String(message.id), number: message.id,
    createdAt: '', input: { graphText: '', messages: [] }, output: { graphText: '', messages: [message] } }));
  state.setMessages([older, latest]);
  state.setTurns(turns);
  state.activeTurnCollectorRef.current = { turnId: '2', turnNumber: 2, createdAt: '', part: 'output',
    inputMessages: [], outputMessages: [latest] };
  reconcileNpcMessages.mockClear();
  captureNpcMessages.mockClear();
  state.updateHistoryMessageTimes([{ id: 2, rpDateTime: '2026-09-21T10:05' }]);
  expect(state.turnsRef.current[0]).toBe(turns[0]);
  expect(state.messagesRef.current[0]).toBe(older);
  expect(state.turnsRef.current[1].output.messages[0].rpDateTime).toBe('2026-09-21T10:05');
  expect(state.activeTurnCollectorRef.current.outputMessages[0].rpDateTime).toBe('2026-09-21T10:05');
  expect(state.messageStream.getSnapshot()).toBe(state.messagesRef.current);
  expect(reconcileNpcMessages).not.toHaveBeenCalled();
  expect(captureNpcMessages).not.toHaveBeenCalled();
  const writes = hooks.writes;
  const snapshot = state.messageStream.getSnapshot();
  const updatedTurns = state.turnsRef.current;
  state.updateHistoryMessageTimes([{ id: 2, rpDateTime: '2026-09-21T10:05' }]);
  state.updateHistoryMessageTimes([{ id: 999, rpDateTime: '2026-09-21T10:05' }]);
  state.updateHistoryMessageTimes([]);
  expect(hooks.writes).toBe(writes);
  expect(state.messageStream.getSnapshot()).toBe(snapshot);
  expect(state.turnsRef.current).toBe(updatedTurns);
});

it('captures appended phone contacts without reconciling all previous messages', () => {
  const { state, captureNpcMessages, reconcileNpcMessages } = harness();
  state.setMessages([{ id: 10, role: 'output', originalText: 'Earlier' }]);
  reconcileNpcMessages.mockClear();
  const id = state.appendMessage({ role: 'output', originalText: 'Hello', phoneMessage: true,
    phoneFromAccountId: 'alice', phoneToAccountId: 'bob' });
  expect(captureNpcMessages).toHaveBeenCalledWith([expect.objectContaining({ id: 10 }), expect.objectContaining({ id, phoneMessage: true })]);
  expect(reconcileNpcMessages).not.toHaveBeenCalled();
  expect(state.messageStream.getSnapshot()).toBe(state.messagesRef.current);
  state.removeMessage(id);
  expect(reconcileNpcMessages).toHaveBeenCalledTimes(1);
});
