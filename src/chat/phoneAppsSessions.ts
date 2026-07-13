// Session records for the direct phone apps (Notes and ChatGPD). They are
// keyed by storybook character id, saved in the RP save, and snapshotted
// into a storybook's opening history by "Import Current Session".

export const phoneNoteColors = [
  'neutral',
  'sand',
  'coral',
  'peach',
  'mint',
  'sky',
  'lavender',
  'rose',
] as const;

export type PhoneNoteColor = (typeof phoneNoteColors)[number];

export type PhoneNoteRecord = {
  id: string;
  title: string;
  text: string;
  dayLabel: string;
  color: PhoneNoteColor;
};

export type PhoneNotesByCharacter = Record<string, PhoneNoteRecord[]>;

export type CreatedPhoneNote = {
  character: string;
  title: string;
  text: string;
};

export type CreatedPhoneNoteCommit = {
  characterId: string;
  characterName: string;
  /** Manual Notes-app commits distinguish create and update; LLM notes are always creates. */
  operation?: 'create' | 'update';
  note: PhoneNoteRecord;
};

export type DeletedPhoneNoteCommit = {
  characterId: string;
  characterName: string;
  /** Full snapshot kept so undo can restore the deleted note exactly. */
  note: PhoneNoteRecord;
};

type ChatGpdChatMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type SimulatedAiChat = {
  character: string;
  messages: ChatGpdChatMessage[];
};

export type SimulatedAiChatCommit = {
  characterId: string;
  characterName: string;
  chat: ChatGpdChatRecord;
};

export type ChatGpdChatRecord = {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatGpdChatMessage[];
};

export type ChatGpdChatsByCharacter = Record<string, ChatGpdChatRecord[]>;

/** Note color and date label are presentation metadata, not note content. */
export function phoneNoteContentMatches(left: PhoneNoteRecord, right: PhoneNoteRecord) {
  return left.title === right.title && left.text === right.text;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function parseCreatedPhoneNote(value: unknown): CreatedPhoneNote | undefined {
  const note = recordValue(value);
  const character = stringValue(note.character).trim();
  const title = stringValue(note.title).trim();
  const text = stringValue(note.text).trim();
  return character && title && text ? { character, title, text } : undefined;
}

export function createdPhoneNoteIdPrefix(turnId: string) {
  return `note-command-${turnId}-`;
}

// Applying a commit is an upsert: a record whose id already exists (for
// example a manual note update or a replayed direct action) replaces the
// stored record in place instead of adding a duplicate.
function upsertRecord<T extends { id: string }>(records: T[] | undefined, record: T): T[] {
  const existing = records ?? [];
  return existing.some((entry) => entry.id === record.id)
    ? existing.map((entry) => (entry.id === record.id ? record : entry))
    : [record, ...existing];
}

export function replaceCreatedPhoneNotesForTurn(
  current: PhoneNotesByCharacter,
  turnId: string,
  commits: CreatedPhoneNoteCommit[],
): PhoneNotesByCharacter {
  const prefix = createdPhoneNoteIdPrefix(turnId);
  const next = Object.fromEntries(
    Object.entries(current).flatMap(([characterId, notes]) => {
      const retained = notes.filter((note) => !note.id.startsWith(prefix));
      return retained.length ? [[characterId, retained]] : [];
    }),
  );
  commits.forEach(({ characterId, note }) => {
    next[characterId] = upsertRecord(next[characterId], note);
  });
  return next;
}

export function createdPhoneNoteActionVerb(entry: CreatedPhoneNoteCommit) {
  return entry.operation === 'update' ? 'updated' : 'created';
}

export function createdPhoneNoteHistoryText(entry: CreatedPhoneNoteCommit) {
  const verb = createdPhoneNoteActionVerb(entry);
  return [
    `[Notes] ${entry.characterName} ${verb} the note "${entry.note.title}":`,
    entry.note.text,
  ].join('\n');
}

export function deletedPhoneNoteHistoryText(entry: DeletedPhoneNoteCommit) {
  return `[Notes] ${entry.characterName} deleted the note "${entry.note.title}".`;
}

export function deletePhoneNotesForTurn(
  current: PhoneNotesByCharacter,
  commits: DeletedPhoneNoteCommit[],
): PhoneNotesByCharacter {
  if (!commits.length) {
    return current;
  }
  const deletedIdsByCharacter = new Map<string, Set<string>>();
  commits.forEach(({ characterId, note }) => {
    const ids = deletedIdsByCharacter.get(characterId) ?? new Set<string>();
    ids.add(note.id);
    deletedIdsByCharacter.set(characterId, ids);
  });
  return Object.fromEntries(
    Object.entries(current).flatMap(([characterId, notes]) => {
      const deletedIds = deletedIdsByCharacter.get(characterId);
      const retained = deletedIds ? notes.filter((note) => !deletedIds.has(note.id)) : notes;
      return retained.length ? [[characterId, retained]] : [];
    }),
  );
}

export function parseSimulatedAiChat(value: unknown): SimulatedAiChat | undefined {
  const chat = recordValue(value);
  const character = stringValue(chat.character).trim();
  if (!character || !Array.isArray(chat.messages)) {
    return undefined;
  }
  if (chat.messages.length < 2 || chat.messages.length > 8 || chat.messages.length % 2 !== 0) {
    return undefined;
  }
  const messages = chat.messages.flatMap((value, index): ChatGpdChatMessage[] => {
    const message = recordValue(value);
    const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
    const text = stringValue(message.text).trim();
    return message.role === expectedRole && text ? [{ role: expectedRole, text }] : [];
  });
  return messages.length === chat.messages.length ? { character, messages } : undefined;
}

export function chatGpdFallbackTitle(question: string) {
  const words = question.trim().split(/\s+/);
  const title = words.slice(0, 6).join(' ');
  return words.length > 6 ? `${title} ...` : title;
}

export function simulatedAiChatIdPrefix(turnId: string) {
  return `chatgpd-simulated-${turnId}-`;
}

export function replaceSimulatedAiChatsForTurn(
  current: ChatGpdChatsByCharacter,
  turnId: string,
  commits: SimulatedAiChatCommit[],
): ChatGpdChatsByCharacter {
  const prefix = simulatedAiChatIdPrefix(turnId);
  const next = Object.fromEntries(
    Object.entries(current).flatMap(([characterId, chats]) => {
      const retained = chats.filter((chat) => !chat.id.startsWith(prefix));
      return retained.length ? [[characterId, retained]] : [];
    }),
  );
  commits.forEach(({ characterId, chat }) => {
    next[characterId] = upsertRecord(next[characterId], chat);
  });
  return next;
}

export function simulatedAiChatHistoryText(entry: SimulatedAiChatCommit) {
  return [
    `[ChatGPD] ${entry.characterName} used the AI assistant:`,
    ...entry.chat.messages.map((message) =>
      `${message.role === 'user' ? entry.characterName : 'ChatGPD'}: ${message.text}`
    ),
  ].join('\n');
}

function uniqueRecordsById<T extends { id: string }>(records: T[]) {
  const seenIds = new Set<string>();
  return records.filter((record) => {
    if (seenIds.has(record.id)) {
      return false;
    }
    seenIds.add(record.id);
    return true;
  });
}

function normalizePhoneNote(value: unknown): PhoneNoteRecord | undefined {
  const note = recordValue(value);
  const id = stringValue(note.id).trim();
  if (!id) {
    return undefined;
  }
  return {
    id,
    title: stringValue(note.title),
    text: stringValue(note.text),
    dayLabel: stringValue(note.dayLabel),
    color: phoneNoteColors.includes(note.color as PhoneNoteColor)
      ? (note.color as PhoneNoteColor)
      : 'neutral',
  };
}

export function normalizePhoneNotesByCharacter(value: unknown): PhoneNotesByCharacter {
  return Object.fromEntries(
    Object.entries(recordValue(value)).flatMap(([characterId, notes]) => {
      if (!characterId.trim() || !Array.isArray(notes)) {
        return [];
      }
      const normalized = uniqueRecordsById(
        notes
          .map(normalizePhoneNote)
          .filter((note): note is PhoneNoteRecord => !!note),
      );
      return normalized.length ? [[characterId, normalized]] : [];
    }),
  );
}

function normalizeChatGpdChat(value: unknown): ChatGpdChatRecord | undefined {
  const chat = recordValue(value);
  const id = stringValue(chat.id).trim();
  if (!id) {
    return undefined;
  }
  const messages = (Array.isArray(chat.messages) ? chat.messages : [])
    .map((message) => {
      const entry = recordValue(message);
      const text = stringValue(entry.text);
      if (!text || (entry.role !== 'user' && entry.role !== 'assistant')) {
        return undefined;
      }
      return {
        role: entry.role,
        text,
      };
    })
    .filter((message): message is ChatGpdChatMessage => !!message);
  return {
    id,
    title: stringValue(chat.title),
    createdAt: stringValue(chat.createdAt),
    messages,
  };
}

export function normalizeChatGpdChatsByCharacter(value: unknown): ChatGpdChatsByCharacter {
  return Object.fromEntries(
    Object.entries(recordValue(value)).flatMap(([characterId, chats]) => {
      if (!characterId.trim() || !Array.isArray(chats)) {
        return [];
      }
      const normalized = uniqueRecordsById(
        chats
          .map(normalizeChatGpdChat)
          .filter((chat): chat is ChatGpdChatRecord => !!chat),
      );
      return normalized.length ? [[characterId, normalized]] : [];
    }),
  );
}

/**
 * Merges opening-history records into the current per-character records.
 * Existing entries win; opening entries with unseen ids are appended.
 */
export function mergePhoneAppRecordsByCharacter<T extends { id: string }>(
  current: Record<string, T[]>,
  opening: Record<string, T[]>,
): Record<string, T[]> {
  const merged: Record<string, T[]> = { ...current };
  Object.entries(opening).forEach(([characterId, openingRecords]) => {
    const existing = merged[characterId] ?? [];
    const existingIds = new Set(existing.map((record) => record.id));
    const newRecords = openingRecords.filter((record) => {
      if (existingIds.has(record.id)) {
        return false;
      }
      existingIds.add(record.id);
      return true;
    });
    merged[characterId] = [...existing, ...newRecords];
  });
  return merged;
}
