import { describe, it, expect } from 'vitest';
import { applyTextReplacements, textReplaceEntries } from './nodeHelpers';
import type { TextReplaceEntry } from '../types';

const entry = (source: string, replacement: string, id = source): TextReplaceEntry => ({
  id,
  source,
  replacement,
});

describe('applyTextReplacements', () => {
  it('replaces every case-insensitive occurrence', () => {
    expect(applyTextReplacements([entry('hero', 'Aria')], 'Hero, HERO and hero')).toBe(
      'Aria, Aria and Aria',
    );
  });

  it('replaces all occurrences, not only the first', () => {
    expect(applyTextReplacements([entry('a', 'x')], 'banana')).toBe('bxnxnx');
  });

  it('treats regex metacharacters in the source as literal text', () => {
    expect(applyTextReplacements([entry('a.b', 'X')], 'a.b aXb acb')).toBe('X aXb acb');
  });

  it('inserts the replacement verbatim, including $ sequences', () => {
    expect(applyTextReplacements([entry('price', '$5 (was $&1)')], 'price')).toBe('$5 (was $&1)');
  });

  it('applies rows in order, chaining results', () => {
    const entries = [entry('a', 'b', 'r1'), entry('b', 'c', 'r2')];
    expect(applyTextReplacements(entries, 'a')).toBe('c');
  });

  it('skips rows with an empty source', () => {
    expect(applyTextReplacements([entry('', 'x')], 'unchanged')).toBe('unchanged');
  });

  it('returns empty input unchanged', () => {
    expect(applyTextReplacements([entry('a', 'b')], '')).toBe('');
  });

  it('returns the input unchanged when there are no entries', () => {
    expect(applyTextReplacements([], 'nothing to do')).toBe('nothing to do');
  });
});

describe('textReplaceEntries', () => {
  it('defaults to an empty array when unset', () => {
    expect(textReplaceEntries({ textReplaceEntries: undefined } as never)).toEqual([]);
  });

  it('coerces missing fields and back-fills a stable id', () => {
    const raw = [{ source: 'a' }, { id: 'kept', source: 'b', replacement: 'c' }];
    expect(textReplaceEntries({ textReplaceEntries: raw } as never)).toEqual([
      { id: 'text-replace-0', source: 'a', replacement: '' },
      { id: 'kept', source: 'b', replacement: 'c' },
    ]);
  });
});
