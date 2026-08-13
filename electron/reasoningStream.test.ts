import { describe, expect, it } from 'vitest';
import { reasoningTextFromChatMessage } from './reasoningStream.cjs';

describe('reasoning stream extraction', () => {
  it.each([
    ['llama.cpp', { reasoning_content: 'local reasoning' }, 'local reasoning'],
    ['Ollama', { thinking: 'local thinking' }, 'local thinking'],
    ['OpenRouter text', { reasoning: 'remote reasoning' }, 'remote reasoning'],
    [
      'OpenRouter details',
      {
        reasoning_details: [
          { type: 'reasoning.text', text: 'first' },
          { type: 'reasoning.encrypted', data: 'ignored' },
          { type: 'reasoning.summary', summary: ' second' },
        ],
      },
      'first second',
    ],
  ])('extracts documented %s reasoning deltas', (_provider, message, expected) => {
    expect(reasoningTextFromChatMessage(message)).toBe(expected);
  });

  it('ignores encrypted-only and missing reasoning details', () => {
    expect(reasoningTextFromChatMessage({
      reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque' }],
    })).toBe('');
    expect(reasoningTextFromChatMessage({ content: 'answer only' })).toBe('');
  });
});
