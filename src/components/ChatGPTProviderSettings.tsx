import { useEffect, useState } from 'react';
import type { ChatGPTState, ConnectionPreset } from '../types';

export function useChatGPTProviderSettings({ connection, enabled, connectionStatus, onSelectProfile, onRefresh }: {
  connection: ConnectionPreset;
  enabled: boolean;
  connectionStatus: string;
  onSelectProfile: (profileId: string) => void;
  onRefresh: () => void;
}) {
  const [state, setState] = useState<ChatGPTState>({ profiles: [], secureStorage: true });
  const [busy, setBusy] = useState<'sign-in' | 'sign-out' | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void window.rpgraph.chatgpt.state().then(result => {
      if (active) setState(result);
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [enabled, connection.id, connection.chatgptProfileId]);

  const profile = state.profiles.find(profile => profile.connected)
    ?? state.profiles.find(profile => profile.id === connection.chatgptProfileId)
    ?? state.profiles[0];
  async function signIn() {
    setBusy('sign-in');
    setMessage('Complete sign-in in your browser.');
    try {
      const result = await window.rpgraph.chatgpt.signIn(profile?.id);
      setState(result);
      if (result.lastProfileId) onSelectProfile(result.lastProfileId);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      const result = await window.rpgraph.chatgpt.state().catch(() => null);
      if (result) {
        setState(result);
        // Preserve a newly issued registration so a retry uses its client ID.
        if (!connection.chatgptProfileId) {
          const savedId = result.lastProfileId ?? result.profiles[0]?.id;
          if (savedId) onSelectProfile(savedId);
        }
      }
    } finally { setBusy(null); }
  }
  async function signOut() {
    if (!profile) return;
    setBusy('sign-out');
    try {
      const result = await window.rpgraph.chatgpt.signOut(profile.id);
      setState(result);
      setMessage(result.remoteRevocationConfirmed ? ''
        : 'Signed out locally. Remote revocation was not confirmed; you can disconnect this app in ChatGPT settings.');
      onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  }
  const invoke = async (action: () => Promise<unknown>) => {
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const accountField = (
    <div className="connection-field">
      <label htmlFor="chatgpt-profile">CHATGPT ACCOUNT</label>
      <input id="chatgpt-profile" readOnly value={profile?.connected ? profile.label : 'Not signed in'} />
    </div>
  );
  const information = (
    <aside className="chatgpt-account-info" aria-label="ChatGPT account information">
      <p>Eligible AI requests count toward the connected ChatGPT account’s plan allowance or available credits. Use Manage usage to see how much this app has used and adjust its usage limits in ChatGPT settings.</p>
      {profile?.connected && !profile.sharing && <p role="status">ChatGPT plan usage is not enabled. Sign in to authorize it.</p>}
      {profile?.storageLocked && <p role="status">Saved credentials could not be unlocked. Sign out to reset the connection or sign in again.</p>}
      {!state.secureStorage && <p>Secure storage is unavailable. Sign-in is kept for this app session only.</p>}
      {message && <p role="status">{message}</p>}
      {!message && connectionStatus && <p className="chatgpt-connection-status" role="status">{connectionStatus}</p>}
    </aside>
  );
  const authenticationField = (
    <div className="connection-field chatgpt-authentication">
      <label>ACCOUNT CONNECTION</label>
      <div className="connection-provider-actions chatgpt-account-actions">
        {(!profile?.connected || !profile.sharing) && <button type="button" disabled={!!busy} onClick={() => void signIn()}>
          {busy === 'sign-in' ? 'Signing in…' : 'Sign in with ChatGPT'}
        </button>}
        {profile && <button type="button" className="danger" disabled={!!busy} onClick={() => void signOut()}>{busy === 'sign-out' ? 'Signing out…' : 'Sign out'}</button>}
        {profile?.connected && <button type="button" disabled={!!busy} onClick={() => void invoke(() => window.rpgraph.chatgpt.openUsage())}>Manage usage</button>}
        {busy === 'sign-in' && <button type="button" onClick={() => void invoke(() => window.rpgraph.chatgpt.cancelSignIn())}>Cancel sign-in</button>}
      </div>
      {information}
    </div>
  );
  return { accountField, authenticationField };
}
