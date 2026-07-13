import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord, TurnRecord } from '../types';
import type {
  ChatGpdChatRecord,
  ChatGpdChatsByCharacter,
  CreatedPhoneNoteCommit,
  PhoneNoteRecord,
  PhoneNotesByCharacter,
  SimulatedAiChatCommit,
} from './phoneAppsSessions';
import { createdPhoneNoteHistoryText, phoneNoteContentMatches } from './phoneAppsSessions';

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
    phoneNoteContentMatches(left.note, right.note)
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
  const latest = [...messages].reverse().find((message) =>
    message.createdPhoneNote?.characterId === commit.characterId &&
    message.createdPhoneNote.note.id === commit.note.id
  )?.createdPhoneNote;
  return !!latest && createdPhoneNoteMatches(latest, commit);
}

export function hasCreatedPhoneNoteRecordHistory(
  messages: MessageRecord[],
  characterId: string,
  noteId: string,
) {
  return messages.some((message) =>
    message.createdPhoneNote?.characterId === characterId &&
    message.createdPhoneNote.note.id === noteId
  );
}

export function hasSimulatedAiChatHistory(messages: MessageRecord[], commit: SimulatedAiChatCommit) {
  const latest = [...messages].reverse().find((message) =>
    message.simulatedAiChat?.characterId === commit.characterId &&
    message.simulatedAiChat.chat.id === commit.chat.id
  )?.simulatedAiChat;
  return !!latest && simulatedAiChatMatches(latest, commit);
}

function turnHasPhoneAppRecord(
  turn: TurnRecord | undefined,
  characterId: string,
  recordId: string,
  field: 'createdPhoneNote' | 'simulatedAiChat',
) {
  if (!turn?.directAction) {
    return false;
  }
  return turn.output.messages.some((message) => {
    if (field === 'createdPhoneNote') {
      return message.createdPhoneNote?.characterId === characterId &&
        message.createdPhoneNote.note.id === recordId;
    }
    return message.simulatedAiChat?.characterId === characterId &&
      message.simulatedAiChat.chat.id === recordId;
  });
}

export function lastCreatedPhoneNoteTurn(
  turns: TurnRecord[],
  characterId: string,
  noteId: string,
) {
  const turn = turns[turns.length - 1];
  return turn?.output.messages.some((message) =>
    message.createdPhoneNote?.characterId === characterId &&
    message.createdPhoneNote.note.id === noteId
  ) ? turn : undefined;
}

export function lastDirectCreatedPhoneNoteTurn(
  turns: TurnRecord[],
  characterId: string,
  noteId: string,
) {
  const turn = turns[turns.length - 1];
  return turnHasPhoneAppRecord(turn, characterId, noteId, 'createdPhoneNote') ? turn : undefined;
}

export function replaceCreatedPhoneNoteInLastTurn(
  turns: TurnRecord[],
  messages: MessageRecord[],
  commit: CreatedPhoneNoteCommit,
) {
  const turn = lastCreatedPhoneNoteTurn(turns, commit.characterId, commit.note.id);
  if (!turn) {
    return undefined;
  }
  const patchedMessages = new Map<number, MessageRecord>();
  const outputMessages = turn.output.messages.map((message) => {
    if (
      message.createdPhoneNote?.characterId !== commit.characterId ||
      message.createdPhoneNote.note.id !== commit.note.id
    ) {
      return message;
    }
    const nextCommit = {
      ...commit,
      operation: message.createdPhoneNote.operation,
    };
    const patched = {
      ...message,
      originalText: createdPhoneNoteHistoryText(nextCommit),
      translatedText: undefined,
      createdPhoneNote: nextCommit,
    };
    patchedMessages.set(message.id, patched);
    return patched;
  });
  const nextTurn = { ...turn, output: { ...turn.output, messages: outputMessages } };
  return {
    turns: turns.map((entry) => (entry.id === turn.id ? nextTurn : entry)),
    messages: messages.map((message) => patchedMessages.get(message.id) ?? message),
  };
}

export function removeCreatedPhoneNoteFromLastTurn(
  turns: TurnRecord[],
  messages: MessageRecord[],
  characterId: string,
  noteId: string,
) {
  const turn = lastCreatedPhoneNoteTurn(turns, characterId, noteId);
  if (!turn) {
    return undefined;
  }
  const removedIds = new Set(
    turn.output.messages.flatMap((message) =>
      message.createdPhoneNote?.characterId === characterId &&
      message.createdPhoneNote.note.id === noteId
        ? [message.id]
        : [],
    ),
  );
  const nextTurn = {
    ...turn,
    output: {
      ...turn.output,
      messages: turn.output.messages.filter((message) => !removedIds.has(message.id)),
    },
  };
  return {
    turns: turns.map((entry) => (entry.id === turn.id ? nextTurn : entry)),
    messages: messages.filter((message) => !removedIds.has(message.id)),
  };
}

export function lastDirectSimulatedAiChatTurn(
  turns: TurnRecord[],
  characterId: string,
  chatId: string,
) {
  const turn = turns[turns.length - 1];
  return turnHasPhoneAppRecord(turn, characterId, chatId, 'simulatedAiChat') ? turn : undefined;
}

export function archivedSimulatedAiChatIds(turns: TurnRecord[], characterId: string) {
  const committedIds = new Set(
    turns.flatMap((turn) => turn.output.messages.flatMap((message) =>
      message.simulatedAiChat?.characterId === characterId
        ? [message.simulatedAiChat.chat.id]
        : [],
    )),
  );
  const lastTurn = turns[turns.length - 1];
  lastTurn?.output.messages.forEach((message) => {
    if (message.simulatedAiChat?.characterId === characterId && lastTurn.directAction) {
      committedIds.delete(message.simulatedAiChat.chat.id);
    }
  });
  return committedIds;
}

// The commit snapshots stored on history messages are the source of truth for
// undo: a record reverts to the latest snapshot still present in the remaining
// history, or disappears from the phone app when no snapshot is left.
function revertCommittedRecords<T extends { id: string }>(
  current: Record<string, T[]>,
  removedCommits: { characterId: string; record: T }[],
  remainingCommits: { characterId: string; record: T }[],
): Record<string, T[]> {
  if (!removedCommits.length) {
    return current;
  }
  const next = { ...current };
  removedCommits.forEach(({ characterId, record }) => {
    const snapshot = [...remainingCommits]
      .reverse()
      .find((commit) => commit.characterId === characterId && commit.record.id === record.id);
    const records = next[characterId] ?? [];
    const reverted = snapshot
      ? records.map((entry) => (entry.id === record.id ? structuredClone(snapshot.record) : entry))
      : records.filter((entry) => entry.id !== record.id);
    if (reverted.length) {
      next[characterId] = reverted;
    } else {
      delete next[characterId];
    }
  });
  return next;
}

type PhoneNoteHistoryOperation = {
  characterId: string;
  record: PhoneNoteRecord;
  operation: 'upsert' | 'delete';
};

function phoneNoteHistoryOperations(messages: MessageRecord[]): PhoneNoteHistoryOperation[] {
  return messages.flatMap((message) => {
    const operations: PhoneNoteHistoryOperation[] = [];
    if (message.createdPhoneNote) {
      operations.push({
        characterId: message.createdPhoneNote.characterId,
        record: message.createdPhoneNote.note,
        operation: 'upsert',
      });
    }
    if (message.deletedPhoneNote) {
      operations.push({
        characterId: message.deletedPhoneNote.characterId,
        record: message.deletedPhoneNote.note,
        operation: 'delete',
      });
    }
    return operations;
  });
}

function simulatedAiChatCommits(messages: MessageRecord[]) {
  return messages.flatMap((message) =>
    message.simulatedAiChat
      ? [{ characterId: message.simulatedAiChat.characterId, record: message.simulatedAiChat.chat }]
      : [],
  );
}

export function revertCreatedPhoneNotesForMessages(
  current: PhoneNotesByCharacter,
  removedMessages: MessageRecord[],
  remainingMessages: MessageRecord[],
): PhoneNotesByCharacter {
  const removedOperations = phoneNoteHistoryOperations(removedMessages);
  if (!removedOperations.length) {
    return current;
  }
  const remainingOperations = phoneNoteHistoryOperations(remainingMessages);
  const next = { ...current };
  removedOperations.forEach(({ characterId, record, operation }) => {
    const notes = next[characterId] ?? [];
    if (operation === 'delete') {
      const restored = structuredClone(record);
      next[characterId] = notes.some((note) => note.id === restored.id)
        ? notes.map((note) => (note.id === restored.id ? restored : note))
        : [restored, ...notes];
      return;
    }
    const snapshot = [...remainingOperations].reverse().find((entry) =>
      entry.characterId === characterId && entry.record.id === record.id
    );
    if (snapshot?.operation === 'upsert') {
      const currentColor = notes.find((note) => note.id === record.id)?.color;
      const restored = {
        ...structuredClone(snapshot.record),
        color: currentColor ?? snapshot.record.color,
      };
      next[characterId] = notes.some((note) => note.id === restored.id)
        ? notes.map((note) => (note.id === restored.id ? restored : note))
        : [restored, ...notes];
      return;
    }
    const retained = notes.filter((note) => note.id !== record.id);
    if (retained.length) {
      next[characterId] = retained;
    } else {
      delete next[characterId];
    }
  });
  return next;
}

export function revertSimulatedAiChatsForMessages(
  current: ChatGpdChatsByCharacter,
  removedMessages: MessageRecord[],
  remainingMessages: MessageRecord[],
): ChatGpdChatsByCharacter {
  // Deleting an archived chat is intentionally local. This reverter never
  // inserts a missing chat, so undoing later turns cannot resurrect it.
  return revertCommittedRecords(
    current,
    simulatedAiChatCommits(removedMessages),
    simulatedAiChatCommits(remainingMessages),
  );
}
