import type { TurnContext, UserInteraction } from '../types';

/** Translate at the UI boundary; the authored action keeps its internal question. */
export async function askUserWithTranslation({
  question, context, ask, translate, signal,
}: {
  question: string;
  context: TurnContext;
  ask: (displayQuestion: string) => Promise<string>;
  translate: (text: string, direction: 'to-english' | 'to-display') => Promise<string>;
  signal: AbortSignal;
}): Promise<UserInteraction> {
  const translateNonempty = async (text: string, direction: 'to-english' | 'to-display') => {
    signal.throwIfAborted();
    const result = await translate(text, direction);
    signal.throwIfAborted();
    if (!result.trim()) throw new Error('Ask User translation returned empty text.');
    return result;
  };
  signal.throwIfAborted();
  const displayedQuestion = context.englishProcessingEnabled
    ? await translateNonempty(question, 'to-display') : question;
  const answer = await ask(displayedQuestion);
  signal.throwIfAborted();
  const translatedAnswer = context.englishProcessingEnabled || context.inputTranslationOnlyEnabled
    ? await translateNonempty(answer, 'to-english') : undefined;
  return {
    question, answer,
    ...(displayedQuestion !== question ? { displayedQuestion } : {}),
    ...(translatedAnswer !== undefined ? { translatedAnswer } : {}),
  };
}
