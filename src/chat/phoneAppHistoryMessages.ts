import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import type {
  ChatGpdChatRecord,
  CreatedPhoneNoteCommit,
  PhoneNoteRecord,
  SimulatedAiChatCommit,
} from './phoneAppsSessions';

export function manualCreatedPhoneNoteCommit(
  character: StorybookCharacter | undefined,
  note: PhoneNoteRecord,
): CreatedPhoneNoteCommit | undefined {
  if (!character || (!note.title.trim() && !note.text.trim())) {
    return undefined;
  }
  return {
    characterId: character.id,
    characterName: character.name,
    note: {
      ...note,
      title: note.title.trim() || 'Untitled Note',
      text: note.text.trim(),
    },
  };
}

export function manualSimulatedAiChatCommit(
  character: StorybookCharacter | undefined,
  chat: ChatGpdChatRecord | undefined,
): SimulatedAiChatCommit | undefined {
  if (!character || !chat) {
    return undefined;
  }
  const messages = chat.messages
    .map((message) => ({ ...message, text: message.text.trim() }))
    .filter((message) => message.text);
  if (!messages.some((message) => message.role === 'assistant')) {
    return undefined;
  }
  return {
    characterId: character.id,
    characterName: character.name,
    chat: {
      ...chat,
      title: chat.title.trim(),
      messages,
    },
  };
}

function createdPhoneNoteMatches(left: CreatedPhoneNoteCommit, right: CreatedPhoneNoteCommit) {
  return (
    left.characterId === right.characterId &&
    left.note.id === right.note.id &&
    left.note.title === right.note.title &&
    left.note.text === right.note.text &&
    left.note.dayLabel === right.note.dayLabel &&
    left.note.color === right.note.color
  );
}

function simulatedAiChatMatches(left: SimulatedAiChatCommit, right: SimulatedAiChatCommit) {
  return (
    left.characterId === right.characterId &&
    left.chat.id === right.chat.id &&
    left.chat.title === right.chat.title &&
    left.chat.messages.length === right.chat.messages.length &&
    left.chat.messages.every((message, index) => {
      const other = right.chat.messages[index];
      return other && message.role === other.role && message.text === other.text;
    })
  );
}

export function hasCreatedPhoneNoteHistory(messages: MessageRecord[], commit: CreatedPhoneNoteCommit) {
  return messages.some((message) =>
    message.createdPhoneNote && createdPhoneNoteMatches(message.createdPhoneNote, commit)
  );
}

export function hasSimulatedAiChatHistory(messages: MessageRecord[], commit: SimulatedAiChatCommit) {
  return messages.some((message) =>
    message.simulatedAiChat && simulatedAiChatMatches(message.simulatedAiChat, commit)
  );
}
