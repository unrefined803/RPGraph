import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { createServer, IncomingMessage, ServerResponse, RequestListener } from 'node:http';
import { EventEmitter } from 'node:events';
import { createChatGPTAuth } from './chatgptAuth.cjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'https://auth.openai.com';

async function fixture(options: { secure?: boolean; claims?: Record<string, unknown>; scope?: string; callbackClient?: string; rejectExchange?: boolean; refreshFailure?: 'temporary' | 'terminal'; idToken?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'rpgraph-chatgpt-'));
  roots.push(root);
  let timestamp = Date.now();
  let listener: RequestListener;
  const encryptionKey = randomBytes(32);
  const storage = {
    available: () => options.secure !== false,
    encrypt(value: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    decrypt(value: string) {
      const bytes = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  const server = new EventEmitter() as EventEmitter & {
    listen: ReturnType<typeof vi.fn>; address: () => { port: number }; close: ReturnType<typeof vi.fn>;
  };
  server.listen = vi.fn((_port, _host, ready) => ready());
  server.address = () => ({ port: 54321 });
  server.close = vi.fn();
  const createServerMock = ((handler: RequestListener) => { listener = handler; return server; }) as unknown as typeof createServer;
  let identityToken = '';
  let sequence = 0;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('openid-configuration')) return Response.json({ issuer, jwks_uri: `${issuer}/jwks`, revocation_endpoint: `${issuer}/revoke` });
    if (url.endsWith('/jwks')) return Response.json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' }] });
    if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
    const parameters = new URLSearchParams(init?.body as URLSearchParams);
    if (options.rejectExchange && parameters.get('grant_type') === 'authorization_code') return Response.json({ error: 'invalid_grant' }, { status: 400 });
    if (options.refreshFailure && parameters.get('grant_type') === 'refresh_token') {
      return Response.json({ error: options.refreshFailure === 'terminal' ? 'invalid_grant' : 'server_error' },
        { status: options.refreshFailure === 'terminal' ? 400 : 503 });
    }
    return Response.json({ access_token: `access-secret-${++sequence}`, refresh_token: `refresh-secret-${sequence}`,
      token_type: 'Bearer', expires_in: 3600, id_token: options.idToken ?? identityToken,
      scope: options.scope ?? 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct' });
  });
  function callback(url: URL, changes: Record<string, string> = {}) {
    const query = new URLSearchParams({ code: 'authorization-code', state: url.searchParams.get('state')!,
      client_id: options.callbackClient ?? 'oaiapp_test', ...changes });
    const response = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() };
    response.writeHead.mockReturnValue(response);
    listener({ url: `/auth/callback?${query}`, method: 'GET' } as IncomingMessage, response as unknown as ServerResponse);
    return response;
  }
  const openBrowser = vi.fn(async (value: string) => {
    const url = new URL(value);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: url.searchParams.get('client_id') === 'dynamic_agent_client' ? 'oaiapp_test' : url.searchParams.get('client_id'),
      sub: 'account-subject', email: 'person@example.com', nonce: url.searchParams.get('nonce'), exp: timestamp / 1000 + 3600, ...options.claims })).toString('base64url');
    identityToken = `${header}.${payload}.${sign('sha256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`;
    callback(url);
  });
  const runtime = { claim: vi.fn(() => true), release: vi.fn() };
  const configuration = { userDataPath: root, storage, runtime, openBrowser, fetch: fetchMock, createServer: createServerMock, now: () => timestamp };
  const auth = createChatGPTAuth(configuration);
  return { root, auth, configuration, openBrowser, fetchMock, server, callback, advance: (ms: number) => { timestamp += ms; } };
}

it('protects tokens, restores profiles after restart, and reuses one profile across models', async () => {
  const f = await fixture();
  const state = await f.auth.signIn(f.root);
  const id = state.lastProfileId!;
  expect(state.profiles[0]).toMatchObject({ connected: true, sharing: true, label: 'person@example.com' });
  expect(JSON.stringify(state)).not.toContain('secret');
  const disk = await readFile(path.join(f.root, 'chatgpt-profiles.json'), 'utf8');
  expect(disk).not.toContain('access-secret');
  expect(disk).not.toContain('refresh-secret');
  const restarted = createChatGPTAuth(f.configuration);
  expect(await restarted.accessToken(f.root, id)).toBe('access-secret-1');
  expect(await restarted.accessToken(f.root, id)).toBe('access-secret-1');
  expect(f.openBrowser).toHaveBeenCalledTimes(1);
  await restarted.signIn(f.root, id);
  const first = new URL(f.openBrowser.mock.calls[0][0]);
  const returning = new URL(f.openBrowser.mock.calls[1][0]);
  expect(first.searchParams.get('client_id')).toBe('dynamic_agent_client');
  expect(returning.searchParams.get('client_id')).toBe('oaiapp_test');
  expect(returning.searchParams.get('agent_name_hint')).toBeNull();
  expect(returning.searchParams.get('ext_agent_host_id')).toBe(first.searchParams.get('ext_agent_host_id'));
  expect(f.server.listen).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function));
});

it('isolates workspace profiles while retaining the original renewable session', async () => {
  const f = await fixture();
  const state = await f.auth.signIn(f.root);
  const namedRoot = path.join(f.root, 'accounts', 'alice');
  expect((await f.auth.state(namedRoot)).profiles).toEqual([]);
  f.auth.cancelPending();
  expect(await f.auth.accessToken(f.root, state.lastProfileId!)).toBe('access-secret-1');
  const other = await f.auth.signIn(namedRoot);
  expect(other.lastProfileId).not.toBe(state.lastProfileId);
  await expect(f.auth.accessToken(namedRoot, state.lastProfileId!)).rejects.toThrow('Select a saved');
  expect(await f.auth.accessToken(f.root, state.lastProfileId!)).toBe('access-secret-1');
});

it('serializes concurrent refreshes and persists the replacement token', async () => {
  const f = await fixture();
  const state = await f.auth.signIn(f.root);
  f.advance(3600000);
  expect(await Promise.all([f.auth.accessToken(f.root, state.lastProfileId!), f.auth.accessToken(f.root, state.lastProfileId!)])).toEqual(['access-secret-2', 'access-secret-2']);
  const refreshes = f.fetchMock.mock.calls.filter(([, init]) => new URLSearchParams(init?.body as URLSearchParams).get('grant_type') === 'refresh_token');
  expect(refreshes).toHaveLength(1);
  expect(new URLSearchParams(refreshes[0][1]?.body as URLSearchParams).get('client_id')).toBe('oaiapp_test');
  const restarted = createChatGPTAuth(f.configuration);
  expect(await restarted.accessToken(f.root, state.lastProfileId!)).toBe('access-secret-2');
});

it('retains registration but revokes and removes tokens on explicit sign-out', async () => {
  const f = await fixture();
  const state = await f.auth.signIn(f.root);
  await expect(f.auth.signOut(f.root, state.lastProfileId!)).resolves.toMatchObject({ remoteRevocationConfirmed: true, profiles: [{ connected: false }] });
  await expect(f.auth.accessToken(f.root, state.lastProfileId!)).rejects.toThrow('Sign in');
  const disk = JSON.parse(await readFile(path.join(f.root, 'chatgpt-profiles.json'), 'utf8'));
  expect(disk.profiles[0].clientId).toBe('oaiapp_test');
  expect(disk.profiles[0].encrypted).toBeUndefined();
  const revoke = f.fetchMock.mock.calls.find(([url]) => String(url).endsWith('/revoke'))!;
  expect(new URLSearchParams(revoke[1]?.body as URLSearchParams).get('token')).toBe('refresh-secret-1');
});

it('retains a temporary refresh failure but clears a terminal renewal failure', async () => {
  const options: { refreshFailure?: 'temporary' | 'terminal' } = {};
  const f = await fixture(options);
  const state = await f.auth.signIn(f.root);
  f.advance(3600000);
  options.refreshFailure = 'temporary';
  await expect(f.auth.accessToken(f.root, state.lastProfileId!)).rejects.toMatchObject({ status: 503 });
  expect((await f.auth.state(f.root)).profiles[0].connected).toBe(true);
  options.refreshFailure = 'terminal';
  await expect(f.auth.accessToken(f.root, state.lastProfileId!)).rejects.toMatchObject({ code: 'invalid_grant' });
  expect((await f.auth.state(f.root)).profiles[0].connected).toBe(false);
  const restarted = createChatGPTAuth(f.configuration);
  expect((await restarted.state(f.root)).profiles[0].connected).toBe(false);
});

it('requires a rotated token to be saved successfully before returning it', async () => {
  const f = await fixture();
  const state = await f.auth.signIn(f.root);
  const file = path.join(f.root, 'chatgpt-profiles.json');
  const original = await readFile(file, 'utf8');
  await rm(file);
  await mkdir(file);
  f.advance(3600000);
  await expect(f.auth.accessToken(f.root, state.lastProfileId!)).rejects.toThrow();
  await expect(f.auth.accessToken(f.root, state.lastProfileId!)).rejects.toThrow();
  await rm(file, { recursive: true });
  await writeFile(file, original);
  expect(await f.auth.accessToken(f.root, state.lastProfileId!)).toBe('access-secret-2');
  const restarted = createChatGPTAuth(f.configuration);
  expect(await restarted.accessToken(f.root, state.lastProfileId!)).toBe('access-secret-2');
});

it.each(['invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'])(
  'clears terminal refresh credentials for %s while preserving registration', async code => {
    const f = await fixture();
    const state = await f.auth.signIn(f.root);
    f.advance(3600000);
    f.fetchMock.mockResolvedValueOnce(Response.json({ error: code }, { status: 400 }));
    await expect(f.auth.accessToken(f.root, state.lastProfileId!)).rejects.toMatchObject({
      code, message: expect.stringContaining('Sign in again'),
    });
    const restarted = createChatGPTAuth(f.configuration);
    expect((await restarted.state(f.root)).profiles[0]).toMatchObject({ id: state.lastProfileId, connected: false, sharing: false });
    await restarted.signIn(f.root, state.lastProfileId);
    expect(new URL(f.openBrowser.mock.calls[1][0]).searchParams.get('client_id')).toBe('oaiapp_test');
  },
);

it('uses a nonrenewable access token until its actual expiry', async () => {
  const f = await fixture();
  const state = await f.auth.signIn(f.root);
  const file = path.join(f.root, 'chatgpt-profiles.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  const tokens = JSON.parse(f.configuration.storage.decrypt(record.profiles[0].encrypted));
  delete tokens.refreshToken;
  record.profiles[0].encrypted = f.configuration.storage.encrypt(JSON.stringify(tokens));
  await writeFile(file, JSON.stringify(record));
  const restarted = createChatGPTAuth(f.configuration);
  f.advance(3570000);
  expect(await restarted.accessToken(f.root, state.lastProfileId!)).toBe('access-secret-1');
  f.advance(30000);
  await expect(restarted.accessToken(f.root, state.lastProfileId!)).rejects.toThrow('session expired');
});

it('does not confirm remote revocation when saved credentials cannot be decrypted', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'chatgpt-profiles.json'), JSON.stringify({ version: 1,
    profiles: [{ id: 'profile', clientId: 'client', encrypted: 'unreadable' }] }));
  await expect(f.auth.signOut(f.root, 'profile')).resolves.toMatchObject({
    remoteRevocationConfirmed: false, profiles: [{ connected: false, storageLocked: false }],
  });
});

it('reports malformed identity tokens without exposing their contents', async () => {
  const privateValue = 'private-identity-diagnostic';
  const f = await fixture({ idToken: `${Buffer.from(privateValue).toString('base64url')}.payload.signature` });
  await expect(f.auth.signIn(f.root)).rejects.toThrow('Invalid ChatGPT ID token.');
  await expect(f.auth.signIn(f.root)).rejects.not.toThrow(privateValue);
});

it('keeps credentials in session memory when secure storage is unavailable', async () => {
  const f = await fixture({ secure: false });
  const state = await f.auth.signIn(f.root);
  expect(await f.auth.accessToken(f.root, state.lastProfileId!)).toBe('access-secret-1');
  const restarted = createChatGPTAuth(f.configuration);
  expect((await restarted.state(f.root)).profiles[0].connected).toBe(false);
  expect(JSON.parse(await readFile(path.join(f.root, 'chatgpt-profiles.json'), 'utf8')).profiles[0].encrypted).toBeUndefined();
});

it.each([{ aud: 'wrong-client' }, { nonce: 'wrong-nonce' }, { exp: 1 }, { iss: 'https://other.example' }, { sub: '' }])('rejects invalid signed identity claims %j', async claims => {
  const f = await fixture({ claims });
  await expect(f.auth.signIn(f.root)).rejects.toThrow('verification failed');
  expect((await f.auth.state(f.root)).profiles.every(profile => !profile.connected)).toBe(true);
});

it('keeps sign-in separate from permission to use the ChatGPT plan', async () => {
  const f = await fixture({ scope: 'openid email profile' });
  const state = await f.auth.signIn(f.root);
  expect(state.profiles[0]).toMatchObject({ connected: true, sharing: false });
  await expect(f.auth.accessToken(f.root, state.lastProfileId!)).rejects.toThrow('plan usage is not enabled');
});

it('rejects a returning callback for a different client without replacing the session', async () => {
  const options = { callbackClient: 'oaiapp_test' };
  const f = await fixture(options);
  const state = await f.auth.signIn(f.root);
  options.callbackClient = 'oaiapp_other';
  await expect(f.auth.signIn(f.root, state.lastProfileId!)).rejects.toThrow('client registration');
  expect(await f.auth.accessToken(f.root, state.lastProfileId!)).toBe('access-secret-1');
});

it('ignores callbacks with invalid state and cancels a pending login without tokens', async () => {
  const f = await fixture();
  f.openBrowser.mockImplementationOnce(async value => {
    const response = f.callback(new URL(value), { state: 'incorrect' });
    expect(response.writeHead).toHaveBeenCalledWith(400);
    f.auth.cancelPending();
  });
  await expect(f.auth.signIn(f.root)).rejects.toThrow('cancelled');
  expect((await f.auth.state(f.root)).profiles).toEqual([]);
  expect(f.server.close).toHaveBeenCalled();
});

it('preserves the issued registration when code exchange fails', async () => {
  const f = await fixture({ rejectExchange: true });
  await expect(f.auth.signIn(f.root)).rejects.toThrow('Sign in again');
  const profiles = (await f.auth.state(f.root)).profiles;
  expect(profiles).toHaveLength(1);
  expect(profiles[0].connected).toBe(false);
});

it('preserves unreadable credentials and refuses to overwrite damaged storage', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'chatgpt-profiles.json'), JSON.stringify({ version: 1, profiles: [{ id: 'profile', clientId: 'client', encrypted: 'unreadable' }] }));
  expect((await f.auth.state(f.root)).profiles[0].storageLocked).toBe(true);
  await f.auth.select(f.root, 'profile');
  expect(JSON.parse(await readFile(path.join(f.root, 'chatgpt-profiles.json'), 'utf8')).profiles[0].encrypted).toBe('unreadable');
  f.auth.forgetWorkspace(f.root);
  await writeFile(path.join(f.root, 'chatgpt-profiles.json'), 'damaged');
  await expect(f.auth.signIn(f.root)).rejects.toThrow('preserved');
  expect(await readFile(path.join(f.root, 'chatgpt-profiles.json'), 'utf8')).toBe('damaged');
});

it('claims the Electron runtime once, blocks competing processes, and releases on disposal', async () => {
  const f = await fixture();
  f.configuration.runtime.claim.mockReturnValueOnce(false);
  await expect(f.auth.state(f.root)).rejects.toThrow('another RPGraph process');
  expect((await f.auth.state(f.root)).profiles).toEqual([]);
  await f.auth.state(f.root);
  expect(f.configuration.runtime.claim).toHaveBeenCalledTimes(2);
  f.auth.dispose();
  expect(f.configuration.runtime.release).toHaveBeenCalledTimes(1);
});
