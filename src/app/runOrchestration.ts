// Run-orchestration helpers extracted from App.tsx (Etappe 2, APP_ZERLEGUNG.md).
// Module scope keeps these impure time/id reads out of the component body, where the
// React Compiler flags them as render-reachable via the runGraph/retryRun closure.

import type { MessageRecord } from '../types';
import { formatLastMessageForContext } from '../workflow';

export const narratorSpeakerName = 'Narrator';
export const narratorCharacterId = '__rpgraph-narrator__';

type GraphInputReplacement = {
  replaceInput: boolean;
  turn: { input: { graphText: string } };
};

export function replacementGraphInputText(
  inputText: string,
  replacement: GraphInputReplacement | undefined,
  directActionOnly: boolean,
  isAutoTurn: boolean,
) {
  if (directActionOnly) {
    return inputText.trim();
  }
  if (replacement && !replacement.replaceInput) {
    return isAutoTurn ? inputText.trim() : replacement.turn.input.graphText;
  }
  return undefined;
}

export function stripEventOutputHeader(text: string, eventDisplayText: string) {
  const eventTitle = eventDisplayText.replace(/^Event:\s*/i, '').trim();
  const lines = text.trim().split(/\r?\n/);
  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }
  if (lines.length === 0) {
    return '';
  }
  const firstLine = lines[0].trim();
  const timestampedEvent = /^\[[^\]]+\]\s*Event:\s*/i.test(firstLine);
  const plainEvent = /^Event:\s*/i.test(firstLine);
  const mentionsSameEvent = !eventTitle || firstLine.toLocaleLowerCase().includes(eventTitle.toLocaleLowerCase());
  if ((timestampedEvent || plainEvent) && mentionsSameEvent) {
    lines.shift();
    while (lines.length > 0 && !lines[0].trim()) {
      lines.shift();
    }
  }
  return lines.join('\n').trim();
}

export function lastMessage(messages: MessageRecord[], role: 'user' | 'output') {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === role && message.includeInHistory !== false) {
      return message;
    }
  }
  return undefined;
}

export function lastMessageText(messages: MessageRecord[], role: 'user' | 'output') {
  const message = lastMessage(messages, role);
  return message ? formatLastMessageForContext(message) : '';
}

export function withoutMessageRpDateTime(message: MessageRecord): MessageRecord {
  const nextMessage = { ...message };
  delete nextMessage.rpDateTime;
  return nextMessage;
}

export function isRunCancelledError(error: unknown) {
  return error instanceof Error &&
    (
      error.message === 'The LLM request was cancelled.' ||
      error.name === 'AbortError' ||
      error.message.toLowerCase().includes('aborted') ||
      error.message.toLowerCase().includes('cancelled')
    );
}

export function createRunId() {
  return `run-${Date.now()}-${crypto.randomUUID()}`;
}

export function createTurnId(turnNumber: number) {
  return `turn-${turnNumber}-${Date.now()}`;
}

export function runClockNow() {
  return performance.now();
}
