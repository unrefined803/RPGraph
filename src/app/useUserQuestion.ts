import { useEffect, useState, useSyncExternalStore } from 'react';
import { createUserQuestionChannel } from './userQuestion';

export function useUserQuestion() {
  const [channel] = useState(createUserQuestionChannel);
  const pendingQuestion = useSyncExternalStore(channel.subscribe, channel.getSnapshot);
  useEffect(() => () => channel.cancel(), [channel]);
  return { pendingQuestion, askUser: channel.ask, answerUserQuestion: channel.answer };
}
