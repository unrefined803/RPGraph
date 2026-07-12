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

type ChatGpdChatMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type ChatGpdChatRecord = {
  id: string;
  title: string;
  createdAt: string;
  messages: ChatGpdChatMessage[];
};

export type ChatGpdChatsByCharacter = Record<string, ChatGpdChatRecord[]>;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
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
