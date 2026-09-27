import { describe, expect, it, vi } from 'vitest';
import { createUnslothApi, unslothEndpoint } from './unslothApi.cjs';

const connection = { baseUrl: 'http://127.0.0.1:8888/v1', model: 'repo/model:Q4_K_M' };
describe('Unsloth lifecycle API', () => {
  it('uses separate inference and OpenAI paths, preserving proxy prefixes', () => {
    expect(unslothEndpoint(connection, 'api/inference/load')).toBe('http://127.0.0.1:8888/api/inference/load');
    expect(unslothEndpoint({ baseUrl: 'http://localhost/proxy/v1/' }, 'v1/models')).toBe('http://localhost/proxy/v1/models');
    expect(() => unslothEndpoint({ baseUrl: 'file:///tmp' }, 'v1/models')).toThrow();
  });
  it('loads the exact local variant, confirms residency and unloads reported identifiers', async () => {
    let loaded = false;
    const request = vi.fn(async (url: string, _connection: unknown, body: unknown) => {
      if (url.endsWith('/v1/models')) return { data: [{ id: 'repo/model', quant: 'Q4_K_M', loaded }] };
      if (url.endsWith('/status')) return { loaded: loaded ? ['resident-model'] : [], loading: [] };
      if (url.endsWith('/load')) { expect(body).toEqual({ model_path: 'repo/model', gguf_variant: 'Q4_K_M' }); loaded = true; }
      if (url.endsWith('/unload')) { expect(body).toEqual({ model_path: 'resident-model', force_cancel_active: false }); loaded = false; }
      return { status: 'success' };
    });
    const api = createUnslothApi(request);
    await expect(api.load(connection)).resolves.toEqual({ loadedModel: connection.model });
    const count = request.mock.calls.length;
    await api.load(connection);
    expect(request.mock.calls.length).toBe(count + 2);
    await expect(api.unload(connection)).resolves.toEqual({ unloadedCount: 1, models: ['resident-model'] });
  });
  it('does not download an unknown model or claim a rejected load succeeded', async () => {
    const unknown = createUnslothApi(async () => ({ data: [] }));
    await expect(unknown.load(connection)).rejects.toThrow('local catalog');
    const unchanged = createUnslothApi(async (url: string) => url.endsWith('/models')
      ? { data: [{ id: connection.model, loaded: false }] } : { status: 'success' });
    await expect(unchanged.load(connection)).rejects.toThrow('did not confirm');
  });
  it('propagates authentication/cancellation errors and refuses an in-progress unload', async () => {
    await expect(createUnslothApi(async () => { throw new Error('401 Unauthorized'); }).list(connection)).rejects.toThrow('401');
    await expect(createUnslothApi(async () => ({ loaded: [], loading: ['model'] })).unload(connection)).rejects.toThrow('loading');
  });
  it('prefers the owner-qualified catalog entry when Unsloth lists a resident model twice', async () => {
    // Real observed behavior: while a model is resident, /v1/models can list it once
    // under its bare "active_model" alias (no owner) and once more under its actual
    // owner-qualified id. Only the qualified id maps back onto the on-disk cache path.
    let loaded = false;
    const request = vi.fn(async (url: string, _connection: unknown, body: unknown) => {
      if (url.endsWith('/v1/models')) return { data: [
        { id: 'model', quant: 'Q5_K_S', loaded },
        { id: 'owner/model', quant: 'Q5_K_S', loaded, display_name: 'model' },
      ] };
      if (url.endsWith('/status')) return loaded ? { loaded: ['owner/model'], loading: [], active_model: 'model', model_identifier: 'owner/model' } : { loaded: [], loading: [] };
      if (url.endsWith('/load')) { expect(body).toEqual({ model_path: 'owner/model', gguf_variant: 'Q5_K_S' }); loaded = true; }
      return { status: 'success' };
    });
    const api = createUnslothApi(request);
    await expect(api.list(connection)).resolves.toEqual([{ id: 'owner/model:Q5_K_S', name: 'model', text: true, vision: false, status: 'unloaded' }]);
    // A stale connection.model saved before this de-duplication (the bare alias) must
    // still resolve to the real entry and load it correctly — not get reported as missing,
    // and not send the alias on to Unsloth (which would start an unwanted download).
    await expect(api.load({ ...connection, model: 'model:Q5_K_S' })).resolves.toEqual({ loadedModel: 'owner/model:Q5_K_S' });
  });
  it('reads vision only for the resident model and excludes non-chat models', async () => {
    const api = createUnslothApi(async (url: string) => url.endsWith('/models') ? {
      data: [
        { id: 'repo/vision', loaded: true },
        { id: 'repo/text', loaded: false },
        { id: 'repo/diffusion', task: 'text-to-image', loaded: false },
      ],
    } : { loaded: ['vision'], loading: [], active_model: 'vision', is_vision: true });
    await expect(api.list(connection)).resolves.toMatchObject([
      { id: 'repo/vision', vision: true }, { id: 'repo/text', vision: false },
    ]);
  });
});
