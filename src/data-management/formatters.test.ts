import { decode } from '@toon-format/toon';
import { expect, it } from 'vitest';
import { formatContextValue } from './formatters';

it('preserves nested context, literal dotted keys, and comment-like text in TOON', () => {
  const value = {
    runtime: { current: { status: 'ready' } },
    'runtime.current': { status: 'literal key' },
    characters: {
      Alice: { mood: 70, note: '# keep this text' },
      Bob: { mood: 40, note: '+42' },
    },
    dialogue: [{ quoteId: 1, speakerId: 2, text: 'Hello,\n"Alice"' }],
    empty: [],
  };
  const text = formatContextValue(value, 'toon');
  expect(text.startsWith('{')).toBe(false);
  expect(decode(text)).toEqual(value);
});
