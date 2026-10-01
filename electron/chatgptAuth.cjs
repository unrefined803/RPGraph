const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { chatgptError, terminalRefreshCodes } = require('./chatgptErrors.cjs');

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function callbackListener(state, signal, createServer = http.createServer) {
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  // Browser startup and the callback run concurrently.
  result.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    let url;
    try { url = new URL(request.url, 'http://127.0.0.1'); }
    catch { response.writeHead(400).end('Invalid sign-in callback request.'); return; }
    if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
      response.writeHead(404).end('Not found.');
      return;
    }
    if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) {
      response.writeHead(400).end('Invalid sign-in state. Return to RPGraph and try again.');
      return;
    }
    if (url.searchParams.has('error')) {
      response.writeHead(400).end('ChatGPT sign-in was declined. You can return to RPGraph.');
      rejectResult(new Error('ChatGPT sign-in was declined.'));
      return;
    }
    if (url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code') ||
        url.searchParams.getAll('client_id').length > 1) {
      response.writeHead(400).end('Incomplete ChatGPT sign-in response.');
      rejectResult(new Error('Incomplete ChatGPT sign-in response.'));
      return;
    }
    response.end('ChatGPT authorization received. Return to RPGraph to finish connecting.');
    resolveResult({ code: url.searchParams.get('code'), clientId: url.searchParams.get('client_id') });
  });
  const abort = () => rejectResult(new Error('ChatGPT sign-in was cancelled.'));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  server.on('error', rejectResult);
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/auth/callback`));
  });
  return { result, ready, close() {
    signal.removeEventListener('abort', abort);
    server.close();
    server.closeAllConnections?.();
  } };
}

function createChatGPTAuth({ userDataPath, storage, runtime, openBrowser, fetch: fetchRequest = fetch,
  createServer, now = Date.now, signInTimeoutMs = 5 * 60 * 1000 }) {
  const workspaces = new Map();
  const controllers = new Set();
  let signInPending = false;
  let signInController;
  let hostPromise;
  let ownsRuntimeLock = false;

  function acquireRuntimeLock() {
    if (!ownsRuntimeLock) {
      if (!runtime.claim()) {
        throw new Error('ChatGPT sessions are in use by another RPGraph process. Close that instance before connecting here.');
      }
      ownsRuntimeLock = true;
    }
  }

  async function jsonRequest(url, options, signal) {
    const response = await fetchRequest(url, {
      ...options, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw chatgptError(response.status, body, response.headers.get('x-request-id'));
    if (!body || typeof body !== 'object') throw new Error('ChatGPT returned an invalid response.');
    return body;
  }

  async function discover(signal) {
    const metadata = await jsonRequest(`${issuer}/.well-known/openid-configuration`, {}, signal);
    if (metadata.issuer !== issuer) throw new Error('Unexpected ChatGPT identity issuer.');
    return metadata;
  }

  function trustedAuthUrl(value) {
    const url = new URL(value);
    if (url.origin !== issuer || url.username || url.password) throw new Error('Unexpected ChatGPT authentication endpoint.');
    return url.toString();
  }

  async function verifyIdentity(token, clientId, nonce, signal) {
    if (typeof token !== 'string' || token.length > 65536) throw new Error('Missing or invalid ChatGPT ID token.');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid ChatGPT ID token.');
    let header;
    let claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (!header || !claims || typeof header !== 'object' || typeof claims !== 'object') throw new Error('Invalid identity fields.');
    } catch (error) { throw new Error('Invalid ChatGPT ID token.', { cause: error }); }
    if (!['RS256', 'ES256'].includes(header.alg) || typeof header.kid !== 'string' || header.crit) {
      throw new Error('Unsupported ChatGPT identity signature.');
    }
    const metadata = await discover(signal);
    const jwks = await jsonRequest(trustedAuthUrl(metadata.jwks_uri), {}, signal);
    const key = jwks.keys?.find(key => key.kid === header.kid && (!key.alg || key.alg === header.alg) &&
      (!key.use || key.use === 'sig') && (header.alg === 'RS256' ? key.kty === 'RSA' : key.kty === 'EC' && key.crv === 'P-256'));
    if (!key || !crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), {
      key: crypto.createPublicKey({ key, format: 'jwk' }), dsaEncoding: 'ieee-p1363',
    }, Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid ChatGPT identity signature.');
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !audience.includes(clientId) || (claims.azp !== undefined && claims.azp !== clientId) ||
        (audience.length > 1 && claims.azp !== clientId) ||
        !Number.isFinite(claims.exp) || claims.exp <= now() / 1000 ||
        (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now() / 1000 + 60)) ||
        claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub) {
      throw new Error('ChatGPT identity verification failed.');
    }
    return { issuer: claims.iss, subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : '',
      name: typeof claims.name === 'string' ? claims.name : '' };
  }

  async function load(root) {
    // A lifetime lock prevents competing Electron processes from racing rotating
    // refresh tokens or overwriting each other's cached profile records.
    acquireRuntimeLock();
    if (!workspaces.has(root)) {
      const pending = (async () => {
        let record;
        try { record = JSON.parse(await fs.readFile(path.join(root, 'chatgpt-profiles.json'), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw new Error('Unable to read ChatGPT profiles. The saved file was preserved.', { cause: error }); }
        if (record && (record.version !== 1 || !Array.isArray(record.profiles))) {
          throw new Error('Unsupported ChatGPT profile storage. The saved file was preserved.');
        }
        const profiles = (record?.profiles ?? []).map(item => {
          if (typeof item.id !== 'string' || typeof item.clientId !== 'string' || !item.clientId ||
              (item.identity && (item.identity.issuer !== issuer || typeof item.identity.subject !== 'string'))) {
            throw new Error('Invalid ChatGPT profile storage. The saved file was preserved.');
          }
          const profile = { id: item.id, clientId: item.clientId, identity: item.identity,
            encrypted: item.encrypted, usageConfirmed: item.usageConfirmed === true };
          if (item.encrypted) {
            try {
              const tokens = JSON.parse(storage.decrypt(item.encrypted));
              if (!tokens || typeof tokens.accessToken !== 'string' || !tokens.accessToken ||
                  !Number.isFinite(tokens.expiresAt) || !Array.isArray(tokens.scopes) ||
                  !tokens.scopes.every(scope => typeof scope === 'string') ||
                  (tokens.refreshToken !== undefined && typeof tokens.refreshToken !== 'string') ||
                  typeof tokens.idToken !== 'string') throw new Error('Invalid saved credentials.');
              profile.tokens = tokens;
              profile.persistedTokens = tokens;
            }
            catch { profile.storageLocked = true; }
          }
          return profile;
        });
        return { profiles, lastProfileId: record?.lastProfileId, writeQueue: Promise.resolve() };
      })();
      workspaces.set(root, pending);
      pending.catch(() => workspaces.delete(root));
    }
    return workspaces.get(root);
  }

  function save(root, workspace) {
    const action = workspace.writeQueue.catch(() => {}).then(async () => {
      const snapshots = workspace.profiles.map(profile => [profile, profile.tokens]);
      const profiles = workspace.profiles.map(profile => {
        if (profile.tokens && storage.available()) {
          profile.encrypted = storage.encrypt(JSON.stringify(profile.tokens));
        }
        return { id: profile.id, clientId: profile.clientId, identity: profile.identity,
          encrypted: profile.encrypted, usageConfirmed: profile.usageConfirmed };
      });
      await writeJson(path.join(root, 'chatgpt-profiles.json'), {
        version: 1, lastProfileId: workspace.lastProfileId, profiles,
      });
      for (const [profile, tokens] of snapshots) {
        if (profile.tokens === tokens) profile.persistedTokens = tokens;
      }
    });
    workspace.writeQueue = action;
    return action;
  }

  function hostId() {
    if (!hostPromise) {
      hostPromise = (async () => {
        const file = path.join(userDataPath, 'chatgpt-host.json');
        try {
          const record = JSON.parse(await fs.readFile(file, 'utf8'));
          if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(record.hostId)) throw new Error('Invalid ChatGPT host identifier.');
          return record.hostId;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const value = `urn:uuid:${crypto.randomUUID()}`;
          await writeJson(file, { hostId: value });
          return value;
        }
      })();
      hostPromise.catch(() => { hostPromise = undefined; });
    }
    return hostPromise;
  }

  function profileFor(workspace, id) {
    const profile = workspace.profiles.find(profile => profile.id === id);
    if (!profile) throw new Error('Select a saved ChatGPT account first.');
    return profile;
  }

  function tokenSet(data, previous) {
    if (typeof data.access_token !== 'string' || !data.access_token || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        (data.refresh_token !== undefined && typeof data.refresh_token !== 'string') ||
        (!previous && typeof data.id_token !== 'string')) throw new Error('Invalid ChatGPT credentials.');
    return { accessToken: data.access_token,
      refreshToken: data.refresh_token ?? previous?.refreshToken,
      // Only retain the ID token verified during sign-in. An expired verified
      // token is still a valid returning-login hint.
      idToken: previous?.idToken ?? data.id_token,
      scopes: typeof data.scope === 'string' ? data.scope.split(/\s+/) : previous?.scopes ?? [],
      expiresAt: now() + data.expires_in * 1000,
      earliestRefreshAt: typeof data.earliest_refresh_at === 'number' ? data.earliest_refresh_at * 1000 : undefined };
  }

  async function tokenRequest(parameters, signal) {
    return jsonRequest(`${issuer}/api/accounts/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters),
    }, signal);
  }

  function controller() {
    const result = new AbortController();
    controllers.add(result);
    return result;
  }

  const api = {
    async state(root) {
      const workspace = await load(root);
      return { lastProfileId: workspace.lastProfileId, secureStorage: storage.available(),
        profiles: workspace.profiles.map(profile => ({
          id: profile.id, label: profile.identity?.email || profile.identity?.name || `ChatGPT account ${workspace.profiles.indexOf(profile) + 1}`,
          connected: !!profile.tokens && (profile.tokens.expiresAt > now() || !!profile.tokens.refreshToken),
          sharing: !!profile.tokens?.scopes?.includes('chatgpt.tokens.use.direct'),
          storageLocked: profile.storageLocked === true,
          usageConfirmed: profile.usageConfirmed,
        })) };
    },
    async select(root, id) {
      const workspace = await load(root);
      profileFor(workspace, id);
      workspace.lastProfileId = id;
      await save(root, workspace);
      return api.state(root);
    },
    async confirmUsage(root, id) {
      const workspace = await load(root);
      profileFor(workspace, id).usageConfirmed = true;
      await save(root, workspace);
      return api.state(root);
    },
    async signIn(root, profileId) {
      if (signInPending) throw new Error('A ChatGPT sign-in is already in progress.');
      signInPending = true;
      const abort = controller();
      signInController = abort;
      const timeout = setTimeout(() => abort.abort(), signInTimeoutMs);
      let listener;
      try {
        const workspace = await load(root);
        const existing = profileId ? profileFor(workspace, profileId) : undefined;
        if (existing?.signingOut) throw new Error('Wait for ChatGPT sign-out to finish.');
        await existing?.refresh;
        const state = crypto.randomBytes(32).toString('base64url');
        const nonce = crypto.randomBytes(32).toString('base64url');
        const verifier = crypto.randomBytes(64).toString('base64url');
        listener = callbackListener(state, abort.signal, createServer);
        const redirectUri = await listener.ready;
        const url = new URL(`${issuer}/api/accounts/authorize`);
        url.search = new URLSearchParams({
          client_id: existing?.clientId ?? 'dynamic_agent_client',
          ...(existing ? {} : { agent_name_hint: 'RPgraph Studio' }),
          ext_agent_host_id: await hostId(), response_type: 'code', redirect_uri: redirectUri,
          scope: scopes, resource, state, nonce, code_challenge_method: 'S256',
          code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
          ...(existing?.tokens?.idToken ? { id_token_hint: existing.tokens.idToken } : {}),
          ...(existing?.identity?.email ? { login_hint: existing.identity.email } : {}),
          ...(existing?.tokens && !existing.tokens.scopes?.includes('chatgpt.tokens.use.direct') ? { prompt: 'consent' } : {}),
        }).toString();
        abort.signal.throwIfAborted();
        try { await openBrowser(url.toString()); }
        catch (error) { throw new Error('Unable to open the browser for ChatGPT sign-in.', { cause: error }); }
        const callback = await listener.result;
        const clientId = callback.clientId || existing?.clientId;
        if (!clientId || !/^[A-Za-z0-9_-]{1,200}$/.test(clientId) || clientId === 'dynamic_agent_client' || (existing && existing.clientId !== clientId)) {
          throw new Error('Unexpected ChatGPT client registration.');
        }
        const profile = existing ?? { id: crypto.randomUUID(), clientId, usageConfirmed: false };
        if (!existing) workspace.profiles.push(profile);
        // Retain the registration even if the short-lived code cannot be exchanged.
        await save(root, workspace);
        const data = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId,
          code: callback.code, code_verifier: verifier, redirect_uri: redirectUri, resource }, abort.signal);
        const identity = await verifyIdentity(data.id_token, clientId, nonce, abort.signal);
        if (existing?.identity && (existing.identity.issuer !== identity.issuer || existing.identity.subject !== identity.subject)) {
          throw new Error('The ChatGPT account does not match this saved profile. Add a separate account instead.');
        }
        abort.signal.throwIfAborted();
        profile.identity = identity;
        profile.tokens = tokenSet(data);
        delete profile.encrypted;
        profile.storageLocked = false;
        workspace.lastProfileId = profile.id;
        await save(root, workspace);
        return api.state(root);
      } finally {
        clearTimeout(timeout);
        listener?.close();
        controllers.delete(abort);
        signInController = undefined;
        signInPending = false;
      }
    },
    async accessToken(root, id, signal) {
      signal?.throwIfAborted();
      const workspace = await load(root);
      const profile = profileFor(workspace, id);
      if (profile.signingOut) throw new Error('This ChatGPT account is signing out.');
      if (!profile.tokens) throw new Error(profile.storageLocked
        ? 'Saved ChatGPT credentials cannot be decrypted on this system. Sign in again.'
        : 'Sign in to ChatGPT for this provider first.');
      if (!profile.tokens.scopes?.includes('chatgpt.tokens.use.direct')) {
        throw new Error('ChatGPT plan usage is not enabled. Continue with ChatGPT to authorize it.');
      }
      if (profile.tokens.refreshToken && profile.tokens.expiresAt <= now() + 60000 &&
          (!profile.tokens.earliestRefreshAt || profile.tokens.earliestRefreshAt <= now())) {
        if (!profile.refresh) {
          const previous = profile.tokens;
          const abort = controller();
          profile.refresh = (async () => {
            try {
              const data = await tokenRequest({ grant_type: 'refresh_token', client_id: profile.clientId,
                refresh_token: previous.refreshToken, resource }, abort.signal);
              if (profile.tokens !== previous) throw new Error('The ChatGPT session changed during renewal.');
              profile.tokens = tokenSet(data, previous);
              delete profile.encrypted;
              await save(root, workspace);
            } catch (error) {
              if (terminalRefreshCodes.has(error.code) && profile.tokens === previous) {
                delete profile.tokens;
                delete profile.encrypted;
                await save(root, workspace);
              }
              throw error;
            } finally { controllers.delete(abort); profile.refresh = undefined; }
          })();
        }
        await profile.refresh;
      }
      signal?.throwIfAborted();
      if (!profile.tokens || profile.tokens.expiresAt <= now()) throw new Error('The ChatGPT session expired. Sign in again.');
      if (!profile.tokens.scopes?.includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan usage is not enabled. Continue with ChatGPT to authorize it.');
      // If an earlier atomic write failed, retry saving the replacement before
      // returning it. Never fall back to the consumed refresh token on disk.
      if (profile.tokens !== profile.persistedTokens) await save(root, workspace);
      signal?.throwIfAborted();
      return profile.tokens.accessToken;
    },
    async signOut(root, id) {
      if (signInPending) throw new Error('Finish or cancel ChatGPT sign-in before signing out.');
      const workspace = await load(root);
      const profile = profileFor(workspace, id);
      if (profile.signingOut) throw new Error('ChatGPT sign-out is already in progress.');
      profile.signingOut = true;
      // Finish a token rotation before revoking the latest renewable session.
      await profile.refresh?.catch(() => {});
      const tokens = profile.tokens;
      const abort = controller();
      let remoteRevocationConfirmed = !profile.storageLocked && !tokens?.refreshToken;
      try {
        if (tokens?.refreshToken) {
          const metadata = await discover(abort.signal);
          const response = await fetchRequest(trustedAuthUrl(metadata.revocation_endpoint), {
            method: 'POST', redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId }),
          });
          remoteRevocationConfirmed = response.status === 200;
        }
      } catch { remoteRevocationConfirmed = false; }
      finally { controllers.delete(abort); }
      delete profile.tokens;
      delete profile.encrypted;
      profile.storageLocked = false;
      try { await save(root, workspace); }
      finally { profile.signingOut = false; }
      return { ...await api.state(root), remoteRevocationConfirmed };
    },
    cancelPending() { for (const abort of controllers) abort.abort(); },
    cancelSignIn() { signInController?.abort(); },
    dispose() {
      api.cancelPending();
      if (ownsRuntimeLock) {
        runtime.release();
        ownsRuntimeLock = false;
      }
    },
    forgetWorkspace(root) { workspaces.delete(root); },
  };
  return api;
}

module.exports = { createChatGPTAuth };
