import { afterEach, expect, it, vi } from 'vitest';
import { createTextStreamBatch } from './streamBatch.cjs';

afterEach(() => vi.useRealTimers());

it('coalesces token bursts in order and flushes the final tail before completion', () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const batch = createTextStreamBatch(send);
  for (const text of ['Hello', ' ', 'world', '!']) batch.push(text);
  expect(send).not.toHaveBeenCalled();
  vi.advanceTimersByTime(50);
  expect(send.mock.calls).toEqual([['Hello world!']]);
  batch.push(' Final');
  batch.push(' tail.');
  batch.flush();
  expect(send.mock.calls).toEqual([['Hello world!'], [' Final tail.']]);
  vi.runAllTimers();
  expect(send).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('delivers sparse chunks without waiting for another token and discards cancelled output', () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const batch = createTextStreamBatch(send);
  batch.push('First');
  vi.advanceTimersByTime(50);
  expect(send).toHaveBeenCalledWith('First');
  batch.push('Cancelled');
  batch.cancel();
  batch.flush();
  vi.runAllTimers();
  expect(send).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
