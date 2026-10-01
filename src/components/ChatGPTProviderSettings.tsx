import { useEffect, useState } from 'react';
import type { ChatGPTState, ConnectionPreset } from '../types';
import { NodeCustomSelect } from '../nodes/shared/NodeCustomSelect';

export function ChatGPTProviderSettings({ connection, onSelectProfile, onRefresh }: {
  connection: ConnectionPreset;
  onSelectProfile: (profileId: string) => void;
  onRefresh: () => void;
}) {
  const [state, setState] = useState<ChatGPTState>({ profiles: [], secureStorage: true });
  const [busy, setBusy] = useState<'sign-in' | 'sign-out' | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void window.rpgraph.chatgpt.state().then(result => {
      if (active) setState(result);
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [connection.id, connection.chatgptProfileId]);

  const profile = state.profiles.find(profile => profile.id === connection.chatgptProfileId);
  async function signIn(newProfile: boolean) {
    setBusy('sign-in');
    setMessage('Complete sign-in in your browser.');
    try {
      const result = await window.rpgraph.chatgpt.signIn(newProfile ? undefined : profile?.id);
      setState(result);
      if (result.lastProfileId) onSelectProfile(result.lastProfileId);
      setMessage('ChatGPT account connected.');
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
      setMessage(result.remoteRevocationConfirmed ? 'ChatGPT account signed out.'
        : 'Signed out locally. Remote revocation was not confirmed; you can disconnect this app in ChatGPT settings.');
      onRefresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  }
  const invoke = async (action: () => Promise<unknown>) => {
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  return (
    <div className="connection-field chatgpt-account-settings">
      <label htmlFor="chatgpt-profile">CHATGPT ACCOUNT</label>
      <NodeCustomSelect
        id="chatgpt-profile"
        value={connection.chatgptProfileId ?? ''}
        disabled={!!busy || state.profiles.length === 0}
        options={[
          { value: '', label: state.profiles.length ? 'Select a saved account' : 'No saved accounts', disabled: true },
          ...state.profiles.map((entry, index) => ({
            value: entry.id,
            label: `${entry.label} · Connection ${index + 1}${entry.connected ? '' : ' (signed out)'}`,
          })),
        ]}
        onChange={profileId => {
          onSelectProfile(profileId);
          setMessage('');
        }}
      />
      <span className="connection-field-hint">
        {profile?.connected ? profile.sharing ? 'Using ChatGPT plan' : 'Connected. ChatGPT plan usage is not enabled.'
          : profile?.storageLocked ? 'Saved credentials could not be unlocked. Sign in again.' : 'Connect your ChatGPT account to use your eligible plan.'}
      </span>
      {!state.secureStorage && <span className="connection-field-hint">
        Secure storage is unavailable. Sign-in is kept for this app session only.
      </span>}
      <div className="connection-provider-actions chatgpt-account-actions">
        {(!profile?.connected || !profile.sharing) && <button type="button" disabled={!!busy} onClick={() => void signIn(false)}>
          {busy === 'sign-in' ? 'Signing in…' : 'Sign in with ChatGPT'}
        </button>}
        {state.profiles.length > 0 && <button type="button" disabled={!!busy} onClick={() => void signIn(true)}>{busy === 'sign-in' ? 'Signing in…' : 'Add account'}</button>}
        {profile?.connected && <button type="button" className="danger" disabled={!!busy} onClick={() => void signOut()}>{busy === 'sign-out' ? 'Signing out…' : 'Sign out'}</button>}
        <button type="button" disabled={!!busy} onClick={() => void invoke(() => window.rpgraph.chatgpt.openUsage())}>Manage usage</button>
        {busy === 'sign-in' && <button type="button" onClick={() => void invoke(() => window.rpgraph.chatgpt.cancelSignIn())}>Cancel sign-in</button>}
      </div>
      {profile?.connected && profile.sharing && !profile.usageConfirmed && <div className="comfy-workflow-onboarding chatgpt-plan-confirmation" role="status">
        <p>Eligible AI requests use your ChatGPT plan or available credits. Review app usage and limits in ChatGPT settings.</p>
        <div className="connection-provider-actions chatgpt-account-actions">
          <button type="button" disabled={!!busy} onClick={() => void invoke(async () => setState(await window.rpgraph.chatgpt.confirmUsage(profile.id)))}>Got it</button>
        </div>
      </div>}
      {profile?.connected && <span className="connection-field-hint">Sign out disconnects all provider presets using this account.</span>}
      {message && <span className="connection-field-hint" role="status">{message}</span>}
    </div>
  );
}
