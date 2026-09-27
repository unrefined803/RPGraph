import { describe, expect, it } from 'vitest';

const { providerAdapterKind } = await import('./providers/providerAdapter.cjs');

describe('provider adapters', () => {
  it('selects LM Studio for native LM Studio connections', () => {
    expect(providerAdapterKind({ provider: 'lmstudio' })).toBe('lmstudio');
  });

  it('selects OpenAI-compatible fallback for plain base URL connections', () => {
    expect(providerAdapterKind({ baseUrl: 'http://127.0.0.1:1234', model: 'm' })).toBe('openai-compatible');
  });
});
