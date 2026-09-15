import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { useRpgraphFiles } from './useRpgraphFiles';
import { emptyRpStorybook } from '../nodes/rp-storybook/model';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
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

function harness() {
  const result = { fileName: 'game.json', name: 'Game', filePath: '/files/game.json' };
  const bridge = {
    saveSession: vi.fn(async () => result), saveStorybook: vi.fn(async () => result),
    saveCurrentSession: vi.fn(async () => result),
    saveRpgraphFileToPath: vi.fn(async () => ({ ...result, canceled: false })),
    listFiles: vi.fn(async () => []),
    loadFilePath: vi.fn(async () => ({ ...result, type: 'storybook', protection: 'encrypted', value: emptyRpStorybook })),
  };
  vi.stubGlobal('window', { rpgraph: bridge });
  const options = {
    currentWorkflowForSave: async () => ({}), currentSession: async () => ({}),
    currentStorybookForSave: () => ({ storybook: emptyRpStorybook, name: 'Book', nodeId: 'book' }),
    latestSessionTurnNumber: () => 1, suggestedSessionName: () => 'Game', suggestedWorkflowName: () => 'Graph',
    updateRuntimeNode: vi.fn(), notifySystem: vi.fn(), errorMessage: String,
    setActiveStorybookProtection: vi.fn(), setActiveWorkflowProtection: vi.fn(),
    applyStorybookToNode: vi.fn(() => true), onWorkspacePasswordChange: vi.fn(async () => {}),
  } as unknown as Parameters<typeof useRpgraphFiles>[0];
  function render() {
    hooks.index = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useRpgraphFiles(options);
  }
  return { render, bridge, options };
}

it.each([false, true])('inherits an encrypted Storybook password for RP saves (chosen path: %s)', async (choosePath) => {
  const { render, bridge } = harness();
  render().requestSaveStorybook();
  render().setFileProtection('encrypted');
  render().setSessionPassword('book-secret');
  await render().saveStorybook();
  expect(render().encryptionRequired).toBe(true);
  render().requestSaveSession();
  render().setFileProtection('plain');
  render().setSessionPassword('different');
  render().setChooseSaveLocation(choosePath);
  expect(render().fileProtection).toBe('encrypted');
  expect(render().sessionPassword).toBe('book-secret');
  await render().saveSession();
  if (choosePath) expect(bridge.saveRpgraphFileToPath).toHaveBeenCalledWith(expect.objectContaining({ protection: 'encrypted', password: 'book-secret' }));
  else expect(bridge.saveSession).toHaveBeenCalledWith('Game', {}, 'encrypted', 'book-secret', false);
});

it('upgrades an existing plain RP quick save after loading a protected Storybook', async () => {
  const { render, bridge } = harness();
  render().activeSessionPathRef.current = '/files/plain.json';
  render().setActiveSessionFileName('plain.json');
  render().setActiveSessionProtection('plain');
  render().setPendingStorybookLoad({ nodeId: 'book', fileName: 'book.json', filePath: '/files/book.json' });
  render().setSessionPassword('book-secret');
  await render().unlockStorybookFile();
  await render().saveCurrentSession();
  expect(bridge.saveCurrentSession).toHaveBeenCalledWith('/files/plain.json', {}, 'encrypted', 'book-secret');
});

it('rejects a conflicting Storybook password without applying its content', async () => {
  const { render, options } = harness();
  render().setWorkspacePassword('first');
  render().setPendingStorybookLoad({ nodeId: 'book', fileName: 'book.json', filePath: '/files/book.json' });
  render().setSessionPassword('second');
  await render().unlockStorybookFile();
  expect(options.applyStorybookToNode).not.toHaveBeenCalled();
  expect(render().workspacePasswordRef.current).toBe('first');
});

it('allows a replacement Storybook password when the workflow is unprotected', async () => {
  const { render, options } = harness();
  options.workflowRequiresProtection = () => false;
  render().setWorkspacePassword('first');
  render().setPendingStorybookLoad({ nodeId: 'book', fileName: 'book.json', filePath: '/files/book.json' });
  render().setSessionPassword('second');
  await render().unlockStorybookFile();
  expect(options.applyStorybookToNode).toHaveBeenCalled();
  expect(render().workspacePasswordRef.current).toBe('second');
});

it('preserves the workflow name and source protection when saving an RP', async () => {
  const { render, options } = harness();
  render().activateWorkflowPath('/files/original.json', 'original.json');
  render().requestSaveSession();
  await render().saveSession();
  expect(render().activeWorkflowFileName).toBe('original.json');
  expect(options.setActiveWorkflowProtection).not.toHaveBeenCalled();
});

it.each([false, true])('releases Storybook-only protection on replacement (protected workflow: %s)', (protectedWorkflow) => {
  const { render, options } = harness();
  options.workflowRequiresProtection = () => protectedWorkflow;
  render().setWorkspacePassword('book-secret');
  render().completeStorybookReplacement('plain');
  expect(render().encryptionRequired).toBe(protectedWorkflow);
  expect(render().workspacePasswordRef.current).toBe(protectedWorkflow ? 'book-secret' : '');
  expect(options.onWorkspacePasswordChange).toHaveBeenLastCalledWith(protectedWorkflow ? 'book-secret' : '');
});

it.each(['plain', 'encrypted'] as const)('makes an RP-derived workflow follow the replacement Storybook: %s', (protection) => {
  const { render, options } = harness();
  options.workflowRequiresProtection = () => true;
  options.workflowFollowsStorybookProtection = () => true;
  render().setWorkspacePassword('old-save-secret');
  render().completeStorybookReplacement(protection);
  expect(options.setActiveWorkflowProtection).toHaveBeenLastCalledWith(protection);
  if (protection === 'plain') {
    expect(render().encryptionRequired).toBe(false);
    expect(options.onWorkspacePasswordChange).toHaveBeenLastCalledWith('');
  }
});

it('replaces an inherited RP password with the new encrypted Storybook password', async () => {
  const { render, options } = harness();
  options.workflowRequiresProtection = () => true;
  options.workflowFollowsStorybookProtection = () => true;
  render().setWorkspacePassword('old-save-secret');
  render().setPendingStorybookLoad({ nodeId: 'book', fileName: 'book.json', filePath: '/files/book.json' });
  render().setSessionPassword('new-book-secret');
  await render().unlockStorybookFile();
  expect(options.applyStorybookToNode).toHaveBeenCalled();
  expect(render().workspacePasswordRef.current).toBe('new-book-secret');
});
