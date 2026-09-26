import { describe, expect, it } from 'vitest';
import { compatibleModel, compatibleReasoningOptions, mergeCompatibleNativeModels } from '../shared/compatibleModels.cjs';
const defaultConnection = { id: 'test', label: 'Test', baseUrl: 'http://localhost:8080/v1', apiKey: '', model: 'test' };

describe('compatible model metadata', () => {
  it('merges native metadata only for matching model IDs and loaded aliases', () => {
    const models = [{ id: 'alias', capabilities: {} }, { id: 'other', capabilities: {} }];
    expect(mergeCompatibleNativeModels(models, { models: [null, {
      key: 'original', loaded_instances: [{ id: 'alias' }], capabilities: { vision: true },
    }] })).toEqual([
      { id: 'alias', capabilities: { vision: true }, reasoning: undefined },
      { id: 'other', capabilities: {} },
    ]);
    expect(mergeCompatibleNativeModels(models, { error: 'Unsupported endpoint' })).toEqual(models);
  });
  it('keeps missing capabilities unknown and rejects invalid entries', () => {
    expect(compatibleModel({ id: 'plain' })?.capabilities).toEqual({});
    expect(compatibleModel({ id: 'plain', reasoning: {} })?.reasoning).toBeUndefined();
    expect(compatibleModel({ id: 123 })).toBeNull();
  });

  it('reads partial flags without guessing other capabilities', () => {
    expect(compatibleModel({ id: 'partial', capabilities: { vision: false, tools: true } })?.capabilities)
      .toEqual({ vision: false, tools: true });
  });

  it('reads modalities and advertised reasoning parameters', () => {
    expect(compatibleModel({ id: 'multimodal', architecture: {
      input_modalities: ['text', 'image'], output_modalities: ['text'],
    }, supported_parameters: ['tools', 'reasoning'] })).toMatchObject({
      capabilities: { vision: true, text: true, image: false, voice: false, tools: true, reasoning: true },
      reasoningFormat: 'reasoning',
    });
  });

  it('normalizes LM Studio reasoning options and mandatory reasoning', () => {
    expect(compatibleModel({ id: 'thinking', capabilities: {
      reasoning: { allowed_options: ['low', 'high'], default: 'low' },
    } })?.reasoning).toEqual({
      supportedEfforts: ['low', 'high'], mandatory: true, defaultEffort: 'low', defaultEnabled: true,
    });
  });

  it('preserves unknown levels and explicit unsupported reasoning', () => {
    expect(compatibleModel({ id: 'thinking', reasoning: { mandatory: true } })?.reasoning)
      .toMatchObject({ mandatory: true, supportedEfforts: null });
    expect(compatibleModel({ id: 'plain', capabilities: { reasoning: false } })?.reasoning)
      .toMatchObject({ supportedEfforts: [], defaultEnabled: false });
  });
});

describe('compatible reasoning requests', () => {
  it('uses the standard field unless metadata specifies the nested format', () => {
    const connection = { ...defaultConnection, reasoningEffort: 'high' as const };
    expect(compatibleReasoningOptions(connection)).toEqual({ reasoning_effort: 'high' });
    expect(compatibleReasoningOptions({ ...connection, compatibleReasoningFormat: 'reasoning' }))
      .toEqual({ reasoning: { effort: 'high' } });
  });

  it('omits unsupported settings and provider defaults', () => {
    expect(compatibleReasoningOptions({ ...defaultConnection, reasoningEffort: 'auto' })).toEqual({});
    expect(compatibleReasoningOptions({ ...defaultConnection, reasoningEffort: 'high',
      reasoningCapabilities: { supportedEfforts: ['low'], mandatory: true },
    })).toEqual({});
    expect(compatibleReasoningOptions({ ...defaultConnection,
      reasoningCapabilities: { supportedEfforts: [] },
    })).toEqual({});
  });
});
