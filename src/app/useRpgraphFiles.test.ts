import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { useRpgraphFiles } from './useRpgraphFiles';
import { emptyRpStorybook } from '../nodes/rp-storybook/model';
import { setAccountSession } from '../accounts/accountSession';

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
afterEach(() => { vi.unstubAllGlobals(); setAccountSession(''); });

function harness() {
  const result = { fileName: 'game.json', name: 'Game', filePath: '/files/game.json' };
  const bridge = {
    saveSession: vi.fn(async () => result), saveStorybook: vi.fn(async () => result),
    saveCurrentSession: vi.fn(async () => result),
    saveRpgraphFileToPath: vi.fn(async () => ({ ...result, canceled: false })),
    listFiles: vi.fn(async () => []),
    loadStartupWorkflow: vi.fn(async () => ({ requiresPassword: true, fileName: 'game.json', name: 'Game' })),
    loadFile: vi.fn(async () => ({ ...result, type: 'session', protection: 'encrypted', value: {} })),
    tryLoadFile: vi.fn(async (): ReturnType<Window['rpgraph']['tryLoadFile']> => ({ ...result, type: 'session', protection: 'encrypted', value: {} })),
    loadFilePath: vi.fn(async () => ({ ...result, type: 'storybook', protection: 'encrypted', value: emptyRpStorybook })),
    tryLoadFilePath: vi.fn(async () => ({ ...result, type: 'storybook', protection: 'encrypted', value: emptyRpStorybook })),
  };
  vi.stubGlobal('window', { rpgraph: bridge });
  const options = {
    currentWorkflowForSave: async () => ({}), currentSession: async () => ({}),
    currentStorybookForSave: () => ({ storybook: emptyRpStorybook, name: 'Book', nodeId: 'book' }),
    latestSessionTurnNumber: () => 1, suggestedSessionName: () => 'Game', suggestedWorkflowName: () => 'Graph',
    updateRuntimeNode: vi.fn(), notifySystem: vi.fn(), errorMessage: String,
    setActiveStorybookProtection: vi.fn(), setActiveWorkflowProtection: vi.fn(),
    applyStorybookToNode: vi.fn(() => true), onWorkspacePasswordChange: vi.fn(async () => {}),
    applyLoadedRpgraphFile: vi.fn(),
  } as unknown as Parameters<typeof useRpgraphFiles>[0];
  function render() {
    hooks.index = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useRpgraphFiles(options);
  }
  return { render, bridge, options };
}

it('uses the account password by default but permits explicitly plain saves', async () => {
  setAccountSession('account-secret');
  const { render, bridge } = harness();
  render().requestSaveSession();
  expect(render().fileProtection).toBe('encrypted');
  expect(render().sessionPassword).toBe('account-secret');
  await render().saveSession();
  expect(bridge.saveSession).toHaveBeenLastCalledWith('Game', {}, 'encrypted', 'account-secret', false);
  render().requestSaveSession();
  render().setFileProtection('plain');
  expect(render().encryptionRequired).toBe(false);
  await render().saveSession();
  expect(bridge.saveSession).toHaveBeenLastCalledWith('Game', {}, 'plain', 'account-secret', false);
  await render().saveCurrentSession();
  expect(bridge.saveCurrentSession).toHaveBeenLastCalledWith('/files/game.json', {}, 'plain', 'account-secret');
});

it('offers account encryption when saving an existing plain workflow', async () => {
  setAccountSession('account-secret');
  const { render } = harness();
  render().setWorkspacePassword('');
  render().activateWorkflowPath('/files/workflow.json', 'workflow.json');
  await render().saveCurrentWorkflow();
  expect(render().sessionPasswordAction).toBe('save-workflow');
  expect(render().fileProtection).toBe('encrypted');
  expect(render().sessionPassword).toBe('account-secret');
});

it.each([
  { signedIn: true, preference: 'account-npc-characters', expected: 'account-npc-characters' },
  { signedIn: true, preference: 'npc-characters', expected: 'npc-characters' },
  { signedIn: false, preference: 'account-npc-characters', expected: 'npc-characters' },
] as const)('preselects the configured character export destination: $expected', ({ signedIn, preference, expected }) => {
  if (signedIn) setAccountSession('account-secret');
  const { render, options } = harness();
  options.defaultCharacterExportDestination = preference;
  const card = { character: { id: 'alice', name: 'Alice' } } as Parameters<ReturnType<typeof useRpgraphFiles>['requestSaveCharacter']>[1];

  render().requestSaveCharacter('storybook', card, () => card);

  expect(render().characterSaveLocation).toBe(expected);
});

it('automatically unlocks matching files and requests a password after a mismatch', async () => {
  setAccountSession('account-secret');
  const { render, bridge, options } = harness();
  const file = { fileName: 'game.json', name: 'Game', type: 'session', protection: 'encrypted', compatible: true } as const;
  await render().requestUnlockStoredFile(file as Parameters<ReturnType<typeof useRpgraphFiles>['requestUnlockStoredFile']>[0]);
  expect(options.applyLoadedRpgraphFile).toHaveBeenCalledWith(expect.anything(), 'account-secret');
  bridge.tryLoadFile.mockResolvedValueOnce(null);
  await render().requestUnlockStoredFile(file as Parameters<ReturnType<typeof useRpgraphFiles>['requestUnlockStoredFile']>[0]);
  expect(render().sessionPasswordAction).toBe('load');
  expect(render().sessionPassword).toBe('');
});

it('preserves file read errors instead of requesting another password', async () => {
  setAccountSession('account-secret');
  const { render, bridge } = harness();
  bridge.tryLoadFile.mockRejectedValueOnce(new Error('File no longer exists'));
  const file = { fileName: 'game.json', name: 'Game', type: 'session', protection: 'encrypted', compatible: true } as const;

  await render().requestUnlockStoredFile(file as Parameters<ReturnType<typeof useRpgraphFiles>['requestUnlockStoredFile']>[0]);

  expect(render().sessionPasswordAction).toBeNull();
  expect(render().fileStorageStatus).toBe('Load failed: File no longer exists');
});

it('refreshes the file picker after automatically unlocking the startup workflow', async () => {
  setAccountSession('account-secret');
  const { render, bridge } = harness();
  bridge.tryLoadFile.mockResolvedValueOnce({ fileName: 'game.json', name: 'Game', filePath: '/files/game.json',
    type: 'workflow', protection: 'encrypted', value: { nodes: [] } });

  await render().loadStartupWorkflow();

  expect(bridge.listFiles).toHaveBeenCalledOnce();
  expect(render().sessionPasswordAction).toBeNull();
});

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
