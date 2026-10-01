import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps, ContextType, SetStateAction } from 'react';
import { AppEntry } from './AppEntry';
import { LoginScreen } from './accounts/LoginScreen';
import { AccountControlsContext } from './accounts/accountControls';
import { getAccountPassword, setAccountSession } from './accounts/accountSession';

vi.mock('./App', () => ({ default: () => null }));
vi.mock('./accounts/LoginScreen', () => ({ LoginScreen: () => null }));
vi.mock('./navigation/PanelNavigation', () => ({ PanelNavigation: () => null }));
vi.mock('./diagnostics/uiPerformance', () => ({ profileUiRender: () => {} }));

// Exercise account orchestration without mounting the studio or a DOM.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, effects: [] as (() => void)[] }));
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
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = hooks.index++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) hooks.effects.push(effect);
    hooks.slots[index] = deps;
  },
}));

beforeEach(() => { hooks.slots = []; hooks.index = 0; hooks.effects = []; });
afterEach(() => { setAccountSession(''); vi.unstubAllGlobals(); });

function harness(preference: string | null = null, items = [{ username: 'alice' }]) {
  const accounts = {
    list: vi.fn(async () => items),
    prepare: vi.fn(async () => {}),
    create: vi.fn(async (username: string) => ({ username })),
    unlock: vi.fn(async (username: string) => ({ username })),
    useLocal: vi.fn(async () => {}),
    delete: vi.fn(async () => ({ username: 'alice' })),
  };
  const setItem = vi.fn();
  vi.stubGlobal('window', { rpgraph: { accounts }, confirm: () => true, alert: vi.fn(),
    localStorage: { getItem: () => preference, setItem } });
  function render() {
    hooks.index = 0;
    const tree = AppEntry();
    hooks.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  function login() {
    const tree = render();
    expect(tree.type).toBe(LoginScreen);
    return tree.props as ComponentProps<typeof LoginScreen>;
  }
  function controls() {
    const tree = render();
    expect(tree.type).toBe(AccountControlsContext.Provider);
    return tree.props.value as ContextType<typeof AccountControlsContext>;
  }
  render();
  return { accounts, setItem, login, controls };
}

it('creates an account, logs out, and signs into another account without restarting', async () => {
  const state = harness(null, []);
  await vi.waitFor(() => expect(state.login().mode).toBe('setup'));
  state.login().onCreateAccount();
  state.login().onSubmit('alice', 'alice-secret');
  await vi.waitFor(() => expect(state.controls().hasAccounts).toBe(true));
  expect(state.accounts.create).toHaveBeenCalledWith('alice', 'alice-secret');
  expect(getAccountPassword()).toBe('alice-secret');

  state.accounts.list.mockResolvedValue([{ username: 'alice' }, { username: 'bob' }]);
  state.controls().openAccountEntry();
  await vi.waitFor(() => expect(state.login().mode).toBe('login'));
  expect(getAccountPassword()).toBe('');
  state.login().onSubmit('bob', 'bob-secret');
  await vi.waitFor(() => state.controls());
  expect(state.accounts.unlock).toHaveBeenCalledWith('bob', 'bob-secret');
  expect(getAccountPassword()).toBe('bob-secret');
});

it('retains the local startup preference while exposing existing accounts', async () => {
  const state = harness('disabled');
  await vi.waitFor(() => expect(state.controls().hasAccounts).toBe(true));
  expect(state.accounts.useLocal).toHaveBeenCalledOnce();
  expect(getAccountPassword()).toBe('');
});

it('stays at account selection when listing fails after logout', async () => {
  const state = harness('disabled');
  await vi.waitFor(() => state.controls());
  setAccountSession('secret');
  state.accounts.list.mockRejectedValueOnce(new Error('Account list unavailable'));
  state.controls().openAccountEntry();
  await vi.waitFor(() => expect(state.login().error).toBe('Account list unavailable'));
  expect(getAccountPassword()).toBe('');
  expect(state.login().mode).toBe('login');
});

it('does not close the main-process workspace when saving the preference fails', async () => {
  const state = harness('disabled');
  await vi.waitFor(() => state.controls());
  setAccountSession('secret');
  state.setItem.mockImplementation(() => { throw new Error('Storage unavailable'); });
  state.controls().openAccountEntry();
  state.controls();
  expect(state.accounts.prepare).not.toHaveBeenCalled();
  expect(getAccountPassword()).toBe('secret');
});

it('does not select the local workspace if remembering the startup choice fails', async () => {
  const state = harness(null, []);
  await vi.waitFor(() => expect(state.login().mode).toBe('setup'));
  state.setItem.mockImplementation(() => { throw new Error('Storage unavailable'); });
  state.login().onContinueWithoutAccount();
  await vi.waitFor(() => expect(state.login().error).toContain('Unable to remember'));
  expect(state.accounts.useLocal).not.toHaveBeenCalled();
  state.login().onCreateAccount();
  state.login().onSubmit('alice', 'secret');
  await vi.waitFor(() => state.controls());
  expect(state.accounts.create).toHaveBeenCalledWith('alice', 'secret');
});

it('keeps the active account after a rejected deletion and closes it after success', async () => {
  const state = harness('disabled');
  await vi.waitFor(() => state.controls());
  setAccountSession('secret');
  state.accounts.delete.mockRejectedValueOnce(new Error('Incorrect password'));
  await expect(state.controls().deleteAccount('wrong')).rejects.toThrow('Incorrect password');
  state.controls();
  expect(getAccountPassword()).toBe('secret');

  state.accounts.list.mockRejectedValueOnce(new Error('Account list unavailable'));
  await state.controls().deleteAccount('secret');
  expect(getAccountPassword()).toBe('');
  expect(state.login().mode).toBe('setup');
  expect(state.login().error).toBe('Account list unavailable');
});
