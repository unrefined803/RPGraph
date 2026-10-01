import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { defaultConnection, useAppSettings } from './settings';
import { setAccountSession } from './accounts/accountSession';

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.slots[index], (update: SetStateAction<T>) => {
      hooks.slots[index] = typeof update === 'function' ? (update as (value: T) => T)(hooks.slots[index] as T) : update;
    }];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((value, position) => !Object.is(value, previous[position]))) {
      hooks.slots[index] = deps;
      hooks.effects.push(effect);
    }
  },
}));
beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.effects = []; });
afterEach(() => { vi.unstubAllGlobals(); setAccountSession(''); });

function harness(load: () => Promise<unknown>) {
  const storage = { getItem: () => null, removeItem: vi.fn() };
  const bridge = { loadSettings: vi.fn(load), saveSettings: vi.fn(async (_settings: unknown) => ({ apiKeyEncryptionAvailable: true })) };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { rpgraph: bridge });
  function render() {
    hooks.index = 0;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const state = useAppSettings();
    hooks.effects.splice(0).forEach(effect => effect());
    return state;
  }
  return { render, bridge };
}

it.each(['read error', 'invalid settings'])('disables automatic writes after a failed settings load: %s', async failure => {
  const state = harness(async () => {
    if (failure === 'read error') throw new Error('Cannot read settings');
    return { settings: { format: 'invalid' }, apiKeyEncryptionAvailable: true };
  });
  state.render();
  await vi.waitFor(() => expect(state.render().settingsLoadComplete).toBe(true));
  expect(state.render().settingsStatus).toContain('Automatic saving is disabled');
  state.render().setConnections([{ ...defaultConnection, apiKey: 'session-key' }]);
  state.render();
  expect(state.bridge.saveSettings).not.toHaveBeenCalled();
});

it('still persists normal first-run settings', async () => {
  const state = harness(async () => ({ settings: null, apiKeyEncryptionAvailable: true, apiKeyDecryptionUnavailable: false }));
  state.render();
  await vi.waitFor(() => expect(state.render().settingsLoadComplete).toBe(true));
  expect(state.bridge.saveSettings).toHaveBeenCalledOnce();
});

it('documents the unresolved plaintext settings path for restored RP workflow variables', async () => {
  setAccountSession('account-secret');
  const state = harness(async () => ({ settings: null, apiKeyEncryptionAvailable: true, apiKeyDecryptionUnavailable: false }));
  state.render();
  await vi.waitFor(() => expect(state.render().settingsLoadComplete).toBe(true));
  // applySessionFile restores sessionState.workflowVariables through this setter.
  state.render().setWorkflowSettingsValues({ privateNarrative: 'Private variable restored from an encrypted RP save' });
  state.render();
  expect(state.bridge.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ options: expect.objectContaining({
    workflowSettingsValues: { privateNarrative: 'Private variable restored from an encrypted RP save' },
  }) }));
  const main = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const source = main.slice(main.indexOf('function apiKeyEncryptionAvailable()'), main.indexOf('function windowStateFilePath()'));
  const serializeForDisk = runInNewContext(`${source}; settingsForDisk`, {
    safeStorage: { isEncryptionAvailable: () => false }, Buffer, structuredClone,
  });
  const calls = state.bridge.saveSettings.mock.calls;
  const diskSettings = serializeForDisk(calls[calls.length - 1]?.[0]);
  expect(JSON.stringify(diskSettings)).toContain('Private variable restored from an encrypted RP save');
});
