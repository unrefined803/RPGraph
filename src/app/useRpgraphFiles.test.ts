import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { startDialogWorkflowFileName, useRpgraphFiles } from './useRpgraphFiles';
import type { SavedFileSummary } from '../types';
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

function harness(result = { fileName: 'game.json', name: 'Game', filePath: '/files/game.json' }) {
  const bridge = {
    saveNamedWorkflow: vi.fn(async () => result), saveCharacter: vi.fn(async () => result),
    saveSession: vi.fn(async () => result), saveStorybook: vi.fn(async () => result),
    saveCurrentSession: vi.fn(async () => result),
    saveRpgraphFileToPath: vi.fn(async () => ({ ...result, canceled: false })),
    listFiles: vi.fn(async () => []),
    saveStartTarget: vi.fn(async () => {}),
    loadStartDialogState: vi.fn(async () => ({ workflowFileName: 'game.json', targetFileName: '' })),
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
    applyLoadedRpgraphFile: vi.fn(), clearWorkspace: vi.fn(),
  } as unknown as Parameters<typeof useRpgraphFiles>[0];
  function render() {
    hooks.index = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useRpgraphFiles(options);
  }
  return { render, bridge, options };
}

it.each(['workflow', 'storybook', 'session'] as const)('retains the unlocked %s display name separately from its file ID', async type => {
  const fileName = `${type === 'workflow' ? 'WF' : type === 'storybook' ? 'SB' : 'RP'}2xQAbCd1234.json`;
  const { render, bridge, options } = harness({ fileName, name: 'Private title', filePath: `/files/${fileName}` });
  bridge.loadFile.mockResolvedValueOnce({ fileName, name: 'Private title', filePath: `/files/${fileName}`,
    type, protection: 'encrypted', value: { nodes: [] } });

  expect(await render().loadStoredFile(fileName, 'manual-secret')).toBe(true);

  expect(render().fileDisplayName(fileName)).toBe('Private title');
  expect(options.applyLoadedRpgraphFile).toHaveBeenCalledWith(expect.objectContaining({ fileName, name: 'Private title' }), 'manual-secret');
  expect(bridge.loadFile).toHaveBeenCalledWith(fileName, 'manual-secret', undefined);
});

it.each(['workflow', 'storybook', 'session'] as const)('retains the saved %s display name for both destinations', async type => {
  for (const chosenPath of [false, true]) {
    hooks.slots = []; hooks.index = 0;
    const fileName = `${type === 'workflow' ? 'WF' : type === 'storybook' ? 'SB' : 'RP'}2xQAbCd1234.json`;
    const { render } = harness({ fileName, name: 'Private title', filePath: `/files/${fileName}` });
    if (type === 'workflow') render().requestExportWorkflow();
    else if (type === 'storybook') render().requestSaveStorybook();
    else render().requestSaveSession();
    render().setFileProtection('encrypted');
    render().setSessionPassword('manual-secret');
    render().setChooseSaveLocation(chosenPath);
    if (type === 'workflow') await render().saveNamedWorkflow();
    else if (type === 'storybook') await render().saveStorybook();
    else await render().saveSession();
    expect(render().fileDisplayName(fileName)).toBe('Private title');
  }
});

it.each(['workflow', 'storybook', 'session', 'character'] as const)(
  'uses the chosen file password or account password for every %s save destination', async kind => {
    const card = { character: { id: 'alice', name: 'Alice' } } as Parameters<ReturnType<typeof useRpgraphFiles>['requestSaveCharacter']>[1];
    for (const signedIn of [false, true]) {
      for (const chosenPath of [false, true]) {
        hooks.slots = [];
        hooks.index = 0;
        setAccountSession(signedIn ? 'account-secret' : '');
        const { render, bridge } = harness();
        if (signedIn) render().setWorkspacePassword('imported-file-secret');
        if (kind === 'workflow') render().requestExportWorkflow();
        else if (kind === 'storybook') render().requestSaveStorybook();
        else if (kind === 'session') render().requestSaveSession();
        else render().requestSaveCharacter('book', card, () => card);
        render().setFileProtection('encrypted');
        render().setSessionPassword('manual-file-secret');
        if (kind === 'character') render().setCharacterSaveLocation(chosenPath ? 'choose' : 'npc-characters');
        else render().setChooseSaveLocation(chosenPath);
        const expectedPassword = signedIn ? 'account-secret' : 'manual-file-secret';
        if (kind === 'workflow') await render().saveNamedWorkflow();
        else if (kind === 'storybook') await render().saveStorybook();
        else if (kind === 'session') await render().saveSession();
        else await render().saveCharacter();
        if (chosenPath) {
          expect(bridge.saveRpgraphFileToPath).toHaveBeenCalledWith(expect.objectContaining({
            kind, protection: 'encrypted', password: expectedPassword,
          }));
        } else {
          const save = kind === 'workflow' ? bridge.saveNamedWorkflow : kind === 'storybook' ? bridge.saveStorybook
            : kind === 'session' ? bridge.saveSession : bridge.saveCharacter;
          expect(save).toHaveBeenCalledWith(expect.any(String), expect.anything(), 'encrypted', expectedPassword,
            false, ...(kind === 'character' ? ['npc-characters'] : []));
        }
      }
    }
  },
);

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

const startFiles = {
  workflow: { fileName: 'wf.json', name: 'Workflow', updatedAt: '', type: 'workflow', protection: 'plain', compatible: true },
  otherWorkflow: { fileName: 'other.json', name: 'Other', updatedAt: '', type: 'workflow', protection: 'plain', compatible: true },
  storybook: { fileName: 'book.json', name: 'Book', updatedAt: '', type: 'storybook', protection: 'plain', compatible: true },
  session: { fileName: 'save.json', name: 'Save', updatedAt: '', type: 'session', protection: 'plain', compatible: true },
} satisfies Record<string, SavedFileSummary>;

function startHarness(files: SavedFileSummary[] = Object.values(startFiles)) {
  const context = harness();
  context.bridge.listFiles.mockResolvedValue(files as never);
  context.bridge.loadFile.mockImplementation((async (fileName: string) => {
    const file = files.find(entry => entry.fileName === fileName)!;
    return { fileName, name: file.name, filePath: `/files/${fileName}`, type: file.type, protection: file.protection, value: { nodes: [] } };
  }) as never);
  return context;
}

it('prefers the last used workflow in the start dialog and falls back to a compatible one', () => {
  const files = [{ ...startFiles.workflow, compatible: false }, startFiles.otherWorkflow, startFiles.storybook];
  expect(startDialogWorkflowFileName(files, [null, 'missing.json', 'wf.json'])).toBe('wf.json');
  expect(startDialogWorkflowFileName(files, ['book.json'])).toBe('other.json');
  expect(startDialogWorkflowFileName([startFiles.storybook], [])).toBeNull();
});

it('opens the start dialog on an empty workspace at startup without loading a workflow', async () => {
  setAccountSession('account-secret');
  const { render, bridge, options } = startHarness();
  bridge.loadStartDialogState.mockResolvedValueOnce({ workflowFileName: 'other.json', targetFileName: '' });

  await render().openStartDialogAtStartup();

  expect(options.clearWorkspace).toHaveBeenCalledOnce();
  expect(options.applyLoadedRpgraphFile).not.toHaveBeenCalled();
  expect(bridge.loadFile).not.toHaveBeenCalled();
  expect(bridge.tryLoadFile).not.toHaveBeenCalled();
  expect(render().sessionPasswordAction).toBeNull();
  expect(render().showStartDialog).toBe(true);
  expect(render().showStorybookPicker).toBe(false);
  expect(render().startWorkflowFileName).toBe('other.json');
});

it('still opens the start dialog when the remembered selection cannot be read', async () => {
  const { render, bridge, options } = startHarness();
  bridge.loadStartDialogState.mockRejectedValueOnce(new Error('disk error'));

  await render().openStartDialogAtStartup();

  expect(options.notifySystem).toHaveBeenCalledWith('error', 'Startup failed: Error: disk error');
  expect(render().showStartDialog).toBe(true);
  expect(render().startWorkflowFileName).toBe('wf.json');
});

it.each(['workflow', 'session'] as const)('refuses to save a %s while no workflow is loaded', kind => {
  const { render, options } = harness();
  options.workspaceEmpty = () => true;

  if (kind === 'workflow') render().requestExportWorkflow();
  else render().requestSaveSession();

  expect(render().sessionPasswordAction).toBeNull();
  expect(render().fileStorageStatus).toMatch(/^No workflow is loaded\./);
  expect(options.notifySystem).toHaveBeenCalledWith('warning', expect.stringMatching(/^No workflow is loaded\./));
});

it('loads the selected workflow before the Storybook chosen in the start dialog', async () => {
  const { render, bridge, options } = startHarness();
  await render().openStartDialog();
  render().setStartWorkflowFileName('other.json');

  await render().openStartSelection(startFiles.storybook);

  expect(bridge.loadFile.mock.calls.map(call => (call as unknown[])[0])).toEqual(['other.json', 'book.json']);
  expect(vi.mocked(options.applyLoadedRpgraphFile).mock.calls.map(([file]) => file.type)).toEqual(['workflow', 'storybook']);
  expect(render().showStartDialog).toBe(false);
  expect(render().showStorybookPicker).toBe(false);
  expect(render().startTargetFileName).toBe('book.json');
});

it('opens an RP Save from the start dialog without loading the selected workflow', async () => {
  const { render, bridge } = startHarness();
  await render().openStartDialog();

  await render().openStartSelection(startFiles.session);

  expect(bridge.loadFile).toHaveBeenCalledOnce();
  expect(bridge.loadFile).toHaveBeenCalledWith('save.json', '', undefined);
  expect(render().showStartDialog).toBe(false);
});

it('continues with the pending Storybook after the encrypted workflow is unlocked', async () => {
  const workflow = { ...startFiles.workflow, protection: 'encrypted' } satisfies SavedFileSummary;
  const { render, bridge } = startHarness([workflow, startFiles.storybook]);
  await render().openStartDialog();

  await render().openStartSelection(startFiles.storybook);

  expect(bridge.loadFile).not.toHaveBeenCalled();
  expect(render().sessionPasswordAction).toBe('load');
  expect(render().showStartDialog).toBe(true);
  render().setSessionPassword('secret');
  await render().unlockStoredFile();
  expect(bridge.loadFile.mock.calls.map(call => (call as unknown[]).slice(0, 2))).toEqual([['wf.json', 'secret'], ['book.json', '']]);
  expect(render().showStartDialog).toBe(false);
});

it('keeps the start dialog open when the Storybook cannot be applied', async () => {
  const { render, options } = startHarness();
  vi.mocked(options.applyLoadedRpgraphFile).mockImplementation(file => file.type !== 'storybook');
  await render().openStartDialog();

  await render().openStartSelection(startFiles.storybook);

  expect(render().showStartDialog).toBe(true);
});

it('restores the last start dialog target at startup and persists opened or saved ones', async () => {
  const { render, bridge } = startHarness();
  bridge.loadStartDialogState.mockResolvedValueOnce({ workflowFileName: 'wf.json', targetFileName: 'book.json' });

  await render().openStartDialogAtStartup();
  expect(render().startTargetFileName).toBe('book.json');
  expect(bridge.saveStartTarget).not.toHaveBeenCalled();

  await render().openStartSelection(startFiles.session);
  expect(bridge.saveStartTarget).toHaveBeenLastCalledWith('save.json');

  render().requestSaveSession();
  await render().saveSession();
  expect(bridge.saveStartTarget).toHaveBeenLastCalledWith('game.json');
  expect(render().startTargetFileName).toBe('game.json');
});

it('drops a remembered start dialog target that no longer exists', async () => {
  const { render } = startHarness();

  await render().openStartDialog(null, 'deleted.json');

  expect(render().startTargetFileName).toBeNull();
});
