import { describe, expect, it } from 'vitest';
import {
  compositeDefaultBaseUrl,
  compositeEndpoint,
  compositeModelEntries,
  compositeNormalizedModel,
} from './compositeApi.cjs';

describe('Composite API adapter', () => {
  it('normalizes OpenAI-compatible model metadata with vision pricing', () => {
    expect(compositeModelEntries({
      data: [{
        id: 'deepseek/deepseek-v4-flash-vision-exp',
        name: 'DeepSeek: DeepSeek V4 Flash Vision Exp',
        context_length: 1048576,
        pricing: {
          prompt: '0.00000014',
          completion: '0.00000028',
          image: '0.00000014',
        },
      }],
    }).map(compositeNormalizedModel)).toEqual([{
      id: 'deepseek/deepseek-v4-flash-vision-exp',
      name: 'DeepSeek: DeepSeek V4 Flash Vision Exp',
      text: true,
      vision: true,
      image: false,
      voice: false,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportedVoices: [],
      supportedParameters: [],
      contextLength: 1048576,
      pricing: {
        prompt: '0.00000014',
        completion: '0.00000028',
        image: '0.00000014',
      },
    }]);
  });

  it('uses the Composite default base URL when none is configured', () => {
    expect(compositeDefaultBaseUrl).toBe('https://composite.lucidity.sh/v1');
    expect(compositeEndpoint({ baseUrl: '' }, 'models')).toBe('https://composite.lucidity.sh/v1/models');
  });
});
