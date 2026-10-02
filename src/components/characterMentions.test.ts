import { describe, expect, it } from 'vitest';
import { characterMentionQuery, updateCharacterMentions, type CharacterMention } from './characterMentions';

const text = '@Sarah Carter ';
const mention: CharacterMention = { start: 0, end: 13, id: 'sarah', text: '@Sarah Carter' };

describe('explicit character mentions', () => {
  it('keeps selected names attached without reopening search after spaces or prose', () => {
    for (const next of [text + ' ', text + 'should meet Alex', text + '\nPlease add a scene.']) {
      const mentions = updateCharacterMentions(text, next, [mention]);
      expect(mentions).toEqual([mention]);
      expect(characterMentionQuery(next, next.length, mentions)).toBeUndefined();
    }
  });

  it('opens a new search after a completed mention and supports names with spaces', () => {
    const next = text + 'meets @Alex Mor';
    expect(characterMentionQuery(next, next.length, [mention])).toEqual({ start: next.lastIndexOf('@'), query: 'Alex Mor' });
    expect(characterMentionQuery('@Sarah Car', 10, [])?.query).toBe('Sarah Car');
  });

  it('shifts identity bindings when text is inserted before them', () => {
    const next = 'Ask ' + text;
    expect(updateCharacterMentions(text, next, [mention])).toEqual([{ ...mention, start: 4, end: 17 }]);
  });

  it('removes bindings when a name is edited, deleted, or merged into another word', () => {
    for (const next of ['@Sarah Carte ', '', '@Sarah Carterson ', 'x@Sarah Carter ']) {
      expect(updateCharacterMentions(text, next, [mention])).toEqual([]);
    }
  });

  it('retains punctuation and does not attach manually typed or pasted names', () => {
    expect(updateCharacterMentions(text, '@Sarah Carter, hello', [mention])).toEqual([mention]);
    expect(updateCharacterMentions('', text, [])).toEqual([]);
  });

  it('keeps the exact selected identity for identical display names', () => {
    const next = text + text;
    const other = { ...mention, id: 'other-sarah', start: text.length, end: text.length + mention.end };
    expect(updateCharacterMentions(next, text, [mention, other])).toEqual([mention]);
  });
});
