import { expect, it } from 'vitest';
import { isRunCancelledError } from './runOrchestration';

it('does not mistake provider aborts or timeouts for user cancellation', () => {
  for (const error of [new DOMException('Provider aborted the request', 'AbortError'),
    new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    new Error('Provider cancelled generation')]) {
    expect(isRunCancelledError(error, new AbortController().signal)).toBe(false);
  }
});

it('recognizes the run signal and IPC cancellation errors', () => {
  const controller = new AbortController();
  controller.abort();
  expect(isRunCancelledError(new Error('Request ended'), controller.signal)).toBe(true);
  expect(isRunCancelledError(new Error("Error invoking remote method: The LLM request was cancelled."))).toBe(true);
});
