import { expect, it, vi } from 'vitest';
import { askUserWithTranslation } from './askUserTranslation';

const question = 'Anna blocks the door. What do you do?';
const answer = 'Player answer in the display language.';
const englishAnswer = 'I ask her to let me through.';
const germanQuestion = 'Question translated into the display language.';

it.each([
  [false, false, false, false],
  [false, true, false, true],
  [true, false, true, true],
  [true, true, true, true],
])('applies full=%s input-only=%s without leaking the inactive display language', async (full, inputOnly, translateQuestion, translateAnswer) => {
  const calls: string[] = [];
  const ask = vi.fn(async (text: string) => { calls.push(`ask:${text}`); return answer; });
  const translate = vi.fn(async (text: string, direction: string) => {
    calls.push(direction);
    expect(text).toBe(direction === 'to-display' ? question : answer);
    return direction === 'to-display' ? germanQuestion : englishAnswer;
  });
  const result = await askUserWithTranslation({
    question, context: { englishProcessingEnabled: full, inputTranslationOnlyEnabled: inputOnly, displayLanguage: 'German' },
    ask, translate, signal: new AbortController().signal,
  });
  expect(ask).toHaveBeenCalledWith(translateQuestion ? germanQuestion : question);
  expect(result).toEqual({ question, answer,
    ...(translateQuestion ? { displayedQuestion: germanQuestion } : {}),
    ...(translateAnswer ? { translatedAnswer: englishAnswer } : {}),
  });
  expect(calls).toEqual([
    ...(translateQuestion ? ['to-display'] : []),
    `ask:${translateQuestion ? germanQuestion : question}`,
    ...(translateAnswer ? ['to-english'] : []),
  ]);
});

it('rejects an empty translation instead of resuming with an empty answer', async () => {
  await expect(askUserWithTranslation({ question,
    context: { englishProcessingEnabled: false, inputTranslationOnlyEnabled: true, displayLanguage: 'German' },
    ask: async () => answer, translate: async () => '', signal: new AbortController().signal,
  })).rejects.toThrow('translation returned empty text');
});

it('does not open a question after its display translation was cancelled', async () => {
  const controller = new AbortController();
  const ask = vi.fn(async () => answer);
  await expect(askUserWithTranslation({ question,
    context: { englishProcessingEnabled: true, displayLanguage: 'German' }, ask,
    translate: async () => { controller.abort(); return germanQuestion; }, signal: controller.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(ask).not.toHaveBeenCalled();
});

it('does not translate the answer after cancellation during the user wait', async () => {
  const controller = new AbortController();
  const translate = vi.fn(async () => englishAnswer);
  await expect(askUserWithTranslation({ question,
    context: { englishProcessingEnabled: false, inputTranslationOnlyEnabled: true, displayLanguage: 'German' },
    ask: async () => { controller.abort(); return answer; }, translate, signal: controller.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(translate).not.toHaveBeenCalled();
});
