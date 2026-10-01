import { Profiler, useEffect, useRef, useState } from 'react';
import App from './App';
import {
  loadAccountFeaturePreference,
  saveLastAccountUsername,
  saveAccountFeaturePreference,
} from './accounts/accountFeaturePreference';
import { LoginScreen } from './accounts/LoginScreen';
import { setAccountSession } from './accounts/accountSession';
import { AccountControlsContext } from './accounts/accountControls';
import { profileUiRender } from './diagnostics/uiPerformance';
import { PanelNavigation } from './navigation/PanelNavigation';

export function AppEntry() {
  type Mode = 'loading' | 'setup' | 'create' | 'login' | 'ready';
  const [mode, setMode] = useState<Mode>('loading');
  const [accounts, setAccounts] = useState<{ username: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const startup = useRef<Promise<{ mode: Mode; accounts: { username: string }[] }> | null>(null);

  useEffect(() => {
    if (mode === 'ready') return;
    return window.rpgraph?.onWindowCleanupBeforeClose?.(() =>
      window.rpgraph.finishWindowCloseCleanup());
  }, [mode]);

  useEffect(() => {
    let alive = true;
    startup.current ??= (async () => {
      const api = window.rpgraph?.accounts;
      if (loadAccountFeaturePreference() === 'disabled') {
        const items = await api?.list() ?? [];
        await api?.useLocal();
        return { mode: 'ready' as const, accounts: items };
      }
      const items = await api?.list() ?? [];
      return { mode: items.length ? 'login' as const : 'setup' as const, accounts: items };
    })();
    void startup.current.then(result => {
      if (alive) { setAccounts(result.accounts); setMode(result.mode); }
    }).catch(error => {
      if (alive) { setError(String(error)); setMode('setup'); }
    });
    return () => { alive = false; };
  }, []);

  async function enter(username: string, password: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const api = window.rpgraph?.accounts;
      if (!api) throw new Error('Local accounts require the desktop app.');
      const account = mode === 'create'
        ? await api.create(username, password)
        : await api.unlock(username, password);
      setAccountSession(password);
      setAccounts(items => items.some(item => item.username === account.username)
        ? items : [...items, account]);
      saveAccountFeaturePreference('enabled');
      saveLastAccountUsername(account.username);
      setMode('ready');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function enterLocalWorkspace() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!saveAccountFeaturePreference('disabled')) throw new Error('Unable to remember your choice. Check local storage permissions.');
      await window.rpgraph?.accounts?.useLocal();
      setAccountSession('');
      setMode('ready');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function openAccountEntry() {
    if (!window.confirm('Save your work before leaving this workspace. Continue to account selection?')) return;
    setMode('loading');
    setError('');
    let workspaceClosed = false;
    try {
      if (!saveAccountFeaturePreference('enabled')) throw new Error('Unable to remember the account preference.');
      await window.rpgraph?.accounts?.prepare();
      workspaceClosed = true;
      setAccountSession('');
      const items = await window.rpgraph?.accounts?.list() ?? [];
      setAccounts(items);
      setMode(items.length ? 'login' : 'create');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (workspaceClosed) {
        setError(message);
        setMode(accounts.length ? 'login' : 'setup');
      } else {
        window.alert(message);
        setMode('ready');
      }
    }
  }

  async function deleteAccount(password: string) {
    const api = window.rpgraph?.accounts;
    if (!api) throw new Error('Deleting accounts requires the desktop app.');
    await api.delete(password);
    setAccountSession('');
    saveAccountFeaturePreference('enabled');
    setAccounts([]);
    setMode('loading');
    setError('');
    try {
      const items = await api.list();
      setAccounts(items);
      setMode(items.length ? 'login' : 'create');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setMode('setup');
    }
  }

  if (mode !== 'ready') return <LoginScreen
    key={mode} mode={mode} accounts={accounts} busy={busy} error={error}
    onSubmit={(username, password) => void enter(username, password)}
    onCreateAccount={() => { setError(''); setMode('create'); }}
    onBack={() => { setError(''); setMode(accounts.length ? 'login' : 'setup'); }}
    onContinueWithoutAccount={() => void enterLocalWorkspace()}
  />;

  return (
    <AccountControlsContext.Provider value={{
      hasAccounts: accounts.length > 0,
      openAccountEntry: () => void openAccountEntry(),
      deleteAccount,
      openFolder: async () => {
        const api = window.rpgraph?.accounts;
        if (!api) throw new Error('Account folders require the desktop app.');
        return api.openFolder();
      },
    }}><PanelNavigation>
      <Profiler id="App" onRender={profileUiRender}>
        <App />
      </Profiler>
    </PanelNavigation></AccountControlsContext.Provider>
  );
}
