import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { useNpcLibrary } from './useNpcLibrary';
import type { NpcLibrarySnapshot } from './npcLibrary';
import { normalizeRpStorybook } from '../nodes/rp-storybook/model';
import fixture from './fixtures/stage4-npc.json';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useState: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function' ? (update as (value: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useRef: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
}));
beforeEach(() => { hooks.slots = []; hooks.index = 0; });
afterEach(() => vi.unstubAllGlobals());
function render() {
  hooks.index = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useNpcLibrary();
}
function snapshot(unlocked: boolean): NpcLibrarySnapshot {
  return {
    roots: { user: '/user', bundled: '/bundled' }, diagnostics: [], skipped: 0,
    entries: unlocked ? [{ tier: 'user', source: 'user:npc.json', fileName: 'npc.json',
      character: normalizeRpStorybook({ characters: [fixture.character] }).characters[0] }] : [],
    files: [{ tier: 'user', fileName: 'npc.json', name: 'NPC', updatedAt: '', type: 'character-card',
      protection: 'encrypted', compatible: true, unlocked }],
  };
}

it('removes unlocked NPCs immediately and ignores a delayed result from the previous game', async () => {
  let finishOld!: (value: NpcLibrarySnapshot) => void;
  const bridge = {
    setWorkspaceProtection: vi.fn(async () => snapshot(true)),
  };
  vi.stubGlobal('window', { rpgraph: bridge });
  await render().setGamePassword('first');
  expect(render().snapshot?.entries).toHaveLength(1);
  bridge.setWorkspaceProtection.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  const old = render().setGamePassword('second');
  expect(render().snapshot?.entries).toHaveLength(0);
  bridge.setWorkspaceProtection.mockResolvedValueOnce(snapshot(false));
  await render().setGamePassword('');
  finishOld(snapshot(true));
  await old;
  expect(render().snapshot?.entries).toHaveLength(0);
  expect(render().snapshot?.files[0].unlocked).toBe(false);
  expect(bridge.setWorkspaceProtection).toHaveBeenLastCalledWith('');
});
