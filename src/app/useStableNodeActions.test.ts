import { beforeEach, expect, it, vi } from 'vitest';
import type { NodeActions } from '../nodes/types';
import { useStableNodeActions } from './useStableNodeActions';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', () => ({
  useState: <T,>(initial: () => T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial();
    return [hooks.slots[index]];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useLayoutEffect: (effect: () => void) => { hooks.effects.push(effect); },
}));
beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.effects = []; });

it('keeps context and callback identities while dispatching to the latest committed handler', async () => {
  const old = vi.fn(async () => false);
  const latest = vi.fn(async () => true);
  const render = (handler: NodeActions['loadStorybookFile']) => {
    hooks.index = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStableNodeActions({ loadStorybookFile: handler } as NodeActions);
  };
  const first = render(old);
  hooks.effects.splice(0).forEach((effect) => effect());
  const second = render(latest);
  expect(second).toBe(first);
  expect(second.loadStorybookFile).toBe(first.loadStorybookFile);
  await expect(first.loadStorybookFile('book')).resolves.toBe(false);
  hooks.effects.splice(0).forEach((effect) => effect());
  await expect(first.loadStorybookFile('book')).resolves.toBe(true);
  expect(latest).toHaveBeenCalledWith('book');
});
