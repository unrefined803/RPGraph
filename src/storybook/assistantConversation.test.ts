import { describe, expect, it } from 'vitest';
import { parseStorybookContinuation } from './assistantConversation';

describe('Storybook continuation markers', () => {
  it('extracts a trailing phase description without losing the response', () => {
    expect(parseStorybookContinuation('Base saved.\n[NEXT: Configure app profiles]  ')).toEqual({
      text: 'Base saved.', nextPhase: 'Configure app profiles',
    });
  });

  it.each(['Done.', '[NEXT: ]', '[NEXT: Profiles] More text', '[Other text]', '[NEXT: Profiles\nand tags]'])(
    'preserves text without a valid trailing action: %s', (text) => {
      expect(parseStorybookContinuation(text)).toEqual({ text, nextPhase: undefined });
    });
});
