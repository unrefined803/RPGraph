import { useId, useState, type FormEvent } from 'react';
import appIcon from '../assets/app-icon-transparent.png';
import loginArtwork from '../assets/account-login-artwork.png';
import { NodeCustomSelect } from '../nodes/shared/NodeCustomSelect';
import { loadLastAccountUsername, saveLastAccountUsername } from './accountFeaturePreference';
import './login-screen.css';

type LoginScreenProps = {
  mode: 'loading' | 'setup' | 'create' | 'login';
  accounts: { username: string }[];
  busy: boolean;
  error: string;
  onCreateAccount: () => void;
  onContinueWithoutAccount: () => void;
  onBack: () => void;
  onSubmit: (username: string, password: string) => void;
};

export function LoginScreen(props: LoginScreenProps) {
  const passwordId = useId();
  const usernameId = useId();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [username, setUsername] = useState(() => {
    if (props.mode !== 'login') return '';
    const preferred = loadLastAccountUsername();
    return props.accounts.some(account => account.username === preferred)
      ? preferred ?? ''
      : props.accounts[0]?.username ?? '';
  });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (props.busy) return;
    if (props.mode === 'create' && password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setError('');
    props.onSubmit(username, password);
    setPassword('');
    setConfirmation('');
  }

  return (
    <main className="login-screen">
      <header className="login-titlebar">
        <span>RPGraph Studio</span>
        <div className="login-window-controls" aria-label="Window controls">
          <button
            type="button"
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => void window.rpgraph?.minimizeWindow?.()}
          >
            <span className="login-minimize-icon" aria-hidden="true" />
          </button>
          <button
            className="login-close-button"
            type="button"
            aria-label="Close window"
            title="Close"
            onClick={() => void window.rpgraph?.closeWindow?.()}
          >
            <span className="login-close-icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      <aside className="login-art" aria-hidden="true">
        <img src={loginArtwork} alt="" draggable={false} />
        <div className="login-art-copy">
          <p>EVERY CHOICE CONNECTS.</p>
          <span>Build a world.<br />Follow a different thread.</span>
        </div>
      </aside>

      <section className="login-entry" aria-labelledby="login-heading">
        <div className="login-brand">
          <img src={appIcon} alt="" />
          <span><strong>RP</strong>Graph Studio</span>
        </div>

        <div>
          <p className="login-eyebrow">{props.mode === 'setup' ? 'ACCOUNT SETUP' : 'WELCOME BACK'}</p>
          <h1 id="login-heading">
            {props.mode === 'loading' ? 'Opening RPGraph…' : props.mode === 'setup' ? 'Choose how you want to start.' : props.mode === 'create' ? 'Make a space of your own.' : 'Your stories, your space.'}
          </h1>
          <p className="login-muted">
            {props.mode === 'setup'
              ? 'Local accounts keep your settings, AI providers, and files separated, using your password to automatically encrypt and decrypt saved workflows and storybooks.'
              : props.mode === 'create' ? 'Set up a local account with its own settings, AI providers, and automatic file encryption and decryption.' : 'Enter your local account details to continue.'}
          </p>
        </div>

        {props.mode === 'setup' ? (
          <div className="login-choice-actions login-setup-actions">
            <button
              type="button"
              onClick={props.onCreateAccount}
              disabled={props.busy}
            >
              Create account
            </button>
            <button type="button" disabled={props.busy} onClick={props.onContinueWithoutAccount}>
              Continue without an account
            </button>
          </div>
        ) : props.mode !== 'loading' && <form onSubmit={submit} aria-busy={props.busy}>
          <fieldset disabled={props.busy}>
          <label className="login-field" htmlFor={usernameId}>
            Username
            {props.mode === 'login' ? (
              <div className="login-account-select">
                <NodeCustomSelect
                  id={usernameId}
                  value={username}
                  options={props.accounts.map(account => ({ value: account.username, label: account.username }))}
                  onChange={value => {
                    setUsername(value);
                    saveLastAccountUsername(value);
                  }}
                />
              </div>
            ) : (
              <input
                id={usernameId}
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={event => setUsername(event.target.value)}
                maxLength={40}
              />
            )}
          </label>

          <label className="login-field" htmlFor={passwordId}>
            Password
            {props.mode === 'create' ? (
              <input
                id={passwordId}
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            ) : (
              <span className="login-password">
                <input
                  id={passwordId}
                  name="password"
                  type={passwordVisible ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  aria-label={`${passwordVisible ? 'Hide' : 'Show'} password`}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible(visible => !visible)}
                >
                  {passwordVisible ? 'Hide' : 'Show'}
                </button>
              </span>
            )}
          </label>

          {props.mode === 'create' && <>
            <label className="login-field">Confirm password
              <input type="password" autoComplete="new-password" value={confirmation} required onChange={event => setConfirmation(event.target.value)} />
            </label>
            <p className="login-caption">Your password unlocks your account and automatically encrypts and decrypts your saved workflows and storybooks. Forgotten passwords cannot be reset and encrypted files cannot be recovered without it.</p>
          </>}
          <button className="login-primary" type="submit">{props.busy ? 'Please wait…' : props.mode === 'create' ? 'Create account' : 'Sign in'}</button>
          <div className="login-choice-actions">
            {props.mode === 'login' ? <button type="button" onClick={props.onCreateAccount}>Create another account</button> : <button type="button" onClick={props.onBack}>Back</button>}
            {props.mode === 'login' && <button type="button" onClick={props.onContinueWithoutAccount}>Continue without an account</button>}
          </div>
          </fieldset>
        </form>}

        {(props.error || error) && <p role="alert">{props.error || error}</p>}

        <p className="login-caption">
          {props.mode === 'setup'
            ? 'Your choice is saved on this computer.'
            : 'Accounts stay on this computer.'}
        </p>
      </section>
    </main>
  );
}
