export type UserQuestion = { id: number; question: string };

/** A run-scoped pause. Answers never start another graph execution. */
export function createUserQuestionChannel() {
  let pending: UserQuestion | null = null;
  let nextId = 0;
  let complete: ((answer?: string) => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (value: UserQuestion | null) => {
    pending = value;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => pending,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    ask: (question: string, signal: AbortSignal): Promise<string> => {
      if (signal.aborted) return Promise.reject(new DOMException('Run cancelled.', 'AbortError'));
      if (pending) return Promise.reject(new Error('Another user question is already pending.'));
      if (!question.trim()) return Promise.reject(new Error('Ask User requires a question.'));
      return new Promise((resolve, reject) => {
        const abort = () => finish();
        const finish = (answer?: string) => {
          signal.removeEventListener('abort', abort);
          complete = undefined;
          publish(null);
          if (answer === undefined) reject(new DOMException('Run cancelled.', 'AbortError'));
          else resolve(answer);
        };
        complete = finish;
        signal.addEventListener('abort', abort, { once: true });
        publish({ id: ++nextId, question });
      });
    },
    answer: (id: number, answer: string) => {
      if (pending?.id !== id || !answer.trim()) return false;
      complete?.(answer.trim());
      return true;
    },
    cancel: () => complete?.(),
  };
}
