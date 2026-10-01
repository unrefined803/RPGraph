import { expect, it, vi } from 'vitest';
import { createWorkspaceOperations } from './workspaceOperations.cjs';

it('drains active operations and rejects new work throughout a transition', async () => {
  const operations = createWorkspaceOperations();
  let finish!: () => void;
  const write = operations.run(() => new Promise<void>(resolve => { finish = resolve; }));
  const change = vi.fn();
  const transition = operations.transition(change);
  await expect(operations.run(() => {})).rejects.toThrow('workspace change');
  await expect(operations.transition(() => {})).rejects.toThrow('workspace change');
  expect(change).not.toHaveBeenCalled();
  finish();
  await write;
  await transition;
  expect(change).toHaveBeenCalledOnce();
  await expect(operations.run(() => 'new workspace')).resolves.toBe('new workspace');
});

it('allows transitions after failed writes and releases the gate after a failed transition', async () => {
  const operations = createWorkspaceOperations();
  const failed = operations.run(() => { throw new Error('Disk full'); });
  const transition = operations.transition(() => { throw new Error('Incorrect password'); });
  await expect(failed).rejects.toThrow('Disk full');
  await expect(transition).rejects.toThrow('Incorrect password');
  await expect(operations.run(() => 'original workspace')).resolves.toBe('original workspace');
});
