import { describe, expect, it } from 'vitest';
import {
  veniceChatBody,
  veniceModelEntries,
  veniceNormalizedModel,
  veniceResponseText,
} from './veniceApi.cjs';

describe('Venice API adapter', () => {
  it('normalizes model capabilities from the Venice model list', () => {
    expect(veniceModelEntries({
      data: [{
        id: 'venice-uncensored',
        type: 'text',
        model_spec: {
          name: 'Venice Uncensored',
          capabilities: {
            supportsVision: true,
            supportsFunctionCalling: true,
          },
        },
      }],
    }).map(veniceNormalizedModel)).toEqual([{
      id: 'venice-uncensored',
      name: 'Venice Uncensored',
      type: 'text',
      text: true,
      vision: true,
      image: false,
      voice: false,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportedVoices: [],
      supportedParameters: [],
    }]);
  });

  it('builds OpenAI-compatible chat request bodies with Venice privacy defaults', () => {
    expect(veniceChatBody({
      connection: { model: 'venice-uncensored', reasoningEffort: 'none' },
      prompt: 'Hello',
      temperature: 0.7,
      topP: 0.9,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      maxTokens: 123,
    })).toEqual({
      model: 'venice-uncensored',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7,
      top_p: 0.9,
      presence_penalty: 0.1,
      frequency_penalty: 0.2,
      max_tokens: 123,
      venice_parameters: {
        include_venice_system_prompt: false,
        disable_thinking: true,
        strip_thinking_response: true,
      },
    });
  });

  it('reads text from chat completion responses', () => {
    expect(veniceResponseText({
      choices: [{ message: { content: 'Hi there' } }],
    })).toBe('Hi there');
  });
});
