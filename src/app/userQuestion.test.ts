import { expect, it, vi } from 'vitest';
import { createUserQuestionChannel } from './userQuestion';

it('waits for a non-empty answer to the current question and rejects duplicate submissions', async () => {
  const channel = createUserQuestionChannel();
  const listener = vi.fn();
  channel.subscribe(listener);
  const result = channel.ask('What happens?', new AbortController().signal);
  const id = channel.getSnapshot()!.id;
  expect(channel.answer(id, '  ')).toBe(false);
  expect(channel.answer(id + 1, 'Stale')).toBe(false);
  expect(channel.answer(id, ' I open the door. ')).toBe(true);
  expect(channel.answer(id, 'Duplicate')).toBe(false);
  await expect(result).resolves.toBe('I open the door.');
  expect(channel.getSnapshot()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(2);
});

it('cancels a waiting run, removes the question, and permits a later request', async () => {
  const channel = createUserQuestionChannel();
  const controller = new AbortController();
  const result = channel.ask('First?', controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  const oldId = channel.getSnapshot()!.id;
  controller.abort();
  await rejected;
  expect(channel.getSnapshot()).toBeNull();
  const next = channel.ask('Next?', new AbortController().signal);
  expect(channel.answer(oldId, 'Late answer')).toBe(false);
  channel.answer(channel.getSnapshot()!.id, 'New answer');
  await expect(next).resolves.toBe('New answer');
});

it('rejects already-aborted runs and overlapping questions without losing the active question', async () => {
  const channel = createUserQuestionChannel();
  await expect(channel.ask('Aborted?', AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  const controller = new AbortController();
  const active = channel.ask('Active?', controller.signal);
  await expect(channel.ask('Other?', controller.signal)).rejects.toThrow('already pending');
  expect(channel.getSnapshot()?.question).toBe('Active?');
  const rejected = expect(active).rejects.toMatchObject({ name: 'AbortError' });
  channel.cancel();
  await rejected;
});
