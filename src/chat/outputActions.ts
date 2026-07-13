import type {
  BankTransferRecord,
  OutputActionChoiceGroup,
  OutputActionInfoBox,
  OutputActionProgressBar,
} from '../types';
import { isRecord } from '../utils/records';
import { phoneVoiceMessageFlag } from './phoneMessages';
import {
  phoneNoteColors,
  type CreatedPhoneNoteCommit,
  type DeletedPhoneNoteCommit,
  type PhoneNoteColor,
  type SimulatedAiChatCommit,
} from './phoneAppsSessions';

type OutputActionPhoneMessage = {
  from: string;
  to: string;
  message: string;
  isVoiceMessage?: boolean;
  imageId?: string;
  imageDescription?: string;
};

export type OutputActionChatMessage = {
  speakerName?: string;
  text: string;
};

type OutputActionControl =
  | { type: 'setTab'; tab: 'chat' | 'phone' | 'events' }
  | { type: 'setPlayer'; name: string };

export type OutputActionContextCapacityRequest = {
  id?: string;
  title?: string;
  label?: string;
  showLegend?: boolean;
  source: {
    type: 'contextCompression';
    index: number;
  };
};

export type OutputActionUiItem =
  | { type: 'choiceGroup'; value: OutputActionChoiceGroup }
  | { type: 'infoBox'; value: OutputActionInfoBox }
  | { type: 'progressBar'; value: OutputActionProgressBar }
  | { type: 'contextCapacity'; value: OutputActionContextCapacityRequest };

export type ParsedOutputActions = {
  phoneMessages: OutputActionPhoneMessage[];
  bankTransfers: BankTransferRecord[];
  chatMessages: OutputActionChatMessage[];
  choiceGroups: OutputActionChoiceGroup[];
  infoBoxes: OutputActionInfoBox[];
  progressBars: OutputActionProgressBar[];
  contextCapacityBars: OutputActionContextCapacityRequest[];
  uiItems: OutputActionUiItem[];
  controls: OutputActionControl[];
  createdPhoneNoteCommits: CreatedPhoneNoteCommit[];
  deletedPhoneNoteCommits: DeletedPhoneNoteCommit[];
  simulatedAiChatCommits: SimulatedAiChatCommit[];
  warnings: string[];
};

export type ParseOutputActionsOptions = {
  /**
   * Allows the fully specified createdPhoneNote, deletedPhoneNote, and
   * simulatedAiChat payloads that only direct app action runs may carry.
   * LLM-driven Output Actions must not change these records.
   */
  phoneAppCommits?: boolean;
};

const emptyOutputActions = (): ParsedOutputActions => ({
  phoneMessages: [],
  bankTransfers: [],
  chatMessages: [],
  choiceGroups: [],
  infoBoxes: [],
  progressBars: [],
  contextCapacityBars: [],
  uiItems: [],
  controls: [],
  createdPhoneNoteCommits: [],
  deletedPhoneNoteCommits: [],
  simulatedAiChatCommits: [],
  warnings: [],
});

function compactType(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
    : '';
}

function stringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function optionalStringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

function numberValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function boundedColumns(value: number | undefined) {
  return value === undefined ? undefined : Math.max(1, Math.round(value));
}

function actionMode(value: unknown): 'submit' | 'state' | undefined {
  const mode = compactType(value);
  if (mode === 'state' || mode === 'setstate') {
    return 'state';
  }
  if (mode === 'submit' || mode === 'run' || mode === 'action' || mode === 'execute') {
    return 'submit';
  }
  return undefined;
}

function boundedTone(value: unknown): OutputActionInfoBox['tone'] {
  const tone = compactType(value);
  return tone === 'success' || tone === 'warning' || tone === 'danger' || tone === 'info'
    ? tone
    : undefined;
}

function optionalBooleanValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function parseContextCapacitySource(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { type: 'contextCompression' as const, index: Math.max(1, Math.round(value)) };
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return { type: 'contextCompression' as const, index: Math.max(1, Math.round(parsed)) };
    }
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (compactType(value.type ?? value.kind) !== 'contextcompression') {
    return undefined;
  }
  const index = numberValue(value, ['index', 'number', 'position']);
  return { type: 'contextCompression' as const, index: Math.max(1, Math.round(index ?? 1)) };
}

function parseChoiceOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) {
      return [{ label: entry.trim() }];
    }
    if (!isRecord(entry)) {
      return [];
    }
    const label = stringValue(entry, ['label', 'text', 'title', 'name']);
    if (!label) {
      return [];
    }
    const storedValue = stringValue(entry, ['value', 'storyText', 'prompt', 'input']);
    return [{
      id: stringValue(entry, ['id', 'key']),
      label,
      value: storedValue,
      text: optionalStringValue(entry, ['text', 'sendText', 'inputText', 'userText']),
      player: stringValue(entry, ['player', 'playerName', 'setPlayer', 'character', 'characterName']),
      messageFormat: numberValue(entry, ['messageFormat', 'message_format', 'outputChannel']),
      turnMode: numberValue(entry, ['turnMode', 'turn_mode', 'promptSlot']),
      mode: actionMode(entry.mode ?? entry.actionMode),
    }];
  });
}

function parsePhoneMessage(entry: Record<string, unknown>) {
  const from = stringValue(entry, ['from', 'sender', 'speaker']);
  const to = stringValue(entry, ['to', 'recipient', 'target']);
  const message = stringValue(entry, ['message', 'text', 'content']);
  if (!from || !to || !message) {
    return undefined;
  }
  return {
    from,
    to,
    message,
    isVoiceMessage: phoneVoiceMessageFlag(
      entry.isVoiceMessage ?? entry.is_voice_message ?? entry.voiceMessage ?? entry.voice_message,
    ) || undefined,
    imageId: stringValue(entry, ['sendImageId', 'send_image_id', 'imageId', 'imageID', 'image_id']),
    imageDescription: stringValue(entry, ['image', 'imageDescription']),
  };
}

function parseCreatedPhoneNoteCommit(entry: unknown): CreatedPhoneNoteCommit | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const characterId = stringValue(entry, ['characterId']);
  const characterName = stringValue(entry, ['characterName']);
  const note = entry.note;
  if (!characterId || !characterName || !isRecord(note)) {
    return undefined;
  }
  const id = stringValue(note, ['id']);
  const title = stringValue(note, ['title']);
  const text = optionalStringValue(note, ['text']);
  const dayLabel = optionalStringValue(note, ['dayLabel']);
  const color = note.color;
  const operation = entry.operation === undefined
    ? 'create'
    : entry.operation === 'create' || entry.operation === 'update'
      ? entry.operation
      : undefined;
  if (
    !id || !title || text === undefined || dayLabel === undefined || !operation ||
    !phoneNoteColors.includes(color as PhoneNoteColor)
  ) {
    return undefined;
  }
  return {
    characterId,
    characterName,
    operation,
    note: { id, title, text, dayLabel, color: color as PhoneNoteColor },
  };
}

function parseSimulatedAiChatCommit(entry: unknown): SimulatedAiChatCommit | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }
  const characterId = stringValue(entry, ['characterId']);
  const characterName = stringValue(entry, ['characterName']);
  const chat = entry.chat;
  if (!characterId || !characterName || !isRecord(chat)) {
    return undefined;
  }
  const id = stringValue(chat, ['id']);
  const title = stringValue(chat, ['title']);
  const createdAt = stringValue(chat, ['createdAt']);
  if (!id || !title || !createdAt || !Array.isArray(chat.messages) || chat.messages.length === 0) {
    return undefined;
  }
  const messages = chat.messages.flatMap((message): SimulatedAiChatCommit['chat']['messages'] => {
    if (!isRecord(message)) {
      return [];
    }
    const text = stringValue(message, ['text']);
    return text && (message.role === 'user' || message.role === 'assistant')
      ? [{ role: message.role, text }]
      : [];
  });
  if (
    messages.length !== chat.messages.length ||
    !messages.some((message) => message.role === 'assistant')
  ) {
    return undefined;
  }
  return { characterId, characterName, chat: { id, title, createdAt, messages } };
}

function parseDeletedPhoneNoteCommit(entry: unknown): DeletedPhoneNoteCommit | undefined {
  const parsed = parseCreatedPhoneNoteCommit({
    ...(isRecord(entry) ? entry : {}),
    operation: 'update',
  });
  return parsed
    ? {
        characterId: parsed.characterId,
        characterName: parsed.characterName,
        note: parsed.note,
      }
    : undefined;
}

function pushCreatedPhoneNoteCommit(
  entry: unknown,
  result: ParsedOutputActions,
  options: ParseOutputActionsOptions,
) {
  if (!options.phoneAppCommits) {
    result.warnings.push('createdPhoneNote commits are only accepted on direct app action runs.');
    return;
  }
  const commit = parseCreatedPhoneNoteCommit(entry);
  if (commit) {
    result.createdPhoneNoteCommits.push(commit);
  } else {
    result.warnings.push(
      'Direct Actions createdPhoneNote needs characterId, characterName, an optional create/update operation, and a full note (id, title, text, dayLabel, valid color).',
    );
  }
}

function pushSimulatedAiChatCommit(
  entry: unknown,
  result: ParsedOutputActions,
  options: ParseOutputActionsOptions,
) {
  if (!options.phoneAppCommits) {
    result.warnings.push('simulatedAiChat commits are only accepted on direct app action runs.');
    return;
  }
  const commit = parseSimulatedAiChatCommit(entry);
  if (commit) {
    result.simulatedAiChatCommits.push(commit);
  } else {
    result.warnings.push(
      'Direct Actions simulatedAiChat needs characterId, characterName, and a full chat (id, title, createdAt, user/assistant messages with at least one assistant reply).',
    );
  }
}

function pushDeletedPhoneNoteCommit(
  entry: unknown,
  result: ParsedOutputActions,
  options: ParseOutputActionsOptions,
) {
  if (!options.phoneAppCommits) {
    result.warnings.push('deletedPhoneNote commits are only accepted on direct app action runs.');
    return;
  }
  const commit = parseDeletedPhoneNoteCommit(entry);
  if (commit) {
    result.deletedPhoneNoteCommits.push(commit);
  } else {
    result.warnings.push(
      'Direct Actions deletedPhoneNote needs characterId, characterName, and a full note snapshot (id, title, text, dayLabel, valid color).',
    );
  }
}

function parseAction(entry: unknown, result: ParsedOutputActions, options: ParseOutputActionsOptions) {
  if (!isRecord(entry)) {
    result.warnings.push('Output Actions entry is not a JSON object.');
    return;
  }

  const type = compactType(entry.type ?? entry.action ?? entry.kind);

  if (type === 'createdphonenote') {
    pushCreatedPhoneNoteCommit(entry, result, options);
    return;
  }

  if (type === 'simulatedaichat') {
    pushSimulatedAiChatCommit(entry, result, options);
    return;
  }
  if (type === 'deletedphonenote') {
    pushDeletedPhoneNoteCommit(entry, result, options);
    return;
  }
  const typelessBankTransfer =
    !type &&
    !!entry.from &&
    !!entry.to &&
    numberValue(entry, ['amount', 'value', 'sum']) !== undefined;
  const phoneMessage =
    type === 'phonemessage' || type === 'phone' ||
    (!type && !typelessBankTransfer && entry.from && entry.to && entry.message)
      ? parsePhoneMessage(entry)
      : undefined;
  if (phoneMessage) {
    result.phoneMessages.push(phoneMessage);
    return;
  }

  if (type === 'banktransfer' || type === 'sendmoney' || type === 'moneytransfer' || typelessBankTransfer) {
    const from = stringValue(entry, ['from', 'sender']);
    const to = stringValue(entry, ['to', 'recipient', 'target']);
    const amount = numberValue(entry, ['amount', 'value', 'sum']);
    if (!from || !to || amount === undefined || amount <= 0) {
      result.warnings.push('Output Actions bankTransfer needs from, to, and a positive amount.');
      return;
    }
    result.bankTransfers.push({
      from,
      to,
      amount: Math.round(amount * 100) / 100,
      note: stringValue(entry, ['note', 'comment', 'message', 'text']),
    });
    return;
  }

  if (type === 'chatmessage' || type === 'chat' || type === 'speechbubble' || type === 'bubble') {
    const text = stringValue(entry, ['text', 'message', 'content']);
    if (!text) {
      result.warnings.push('Output Actions chat message is missing text.');
      return;
    }
    result.chatMessages.push({
      speakerName: stringValue(entry, ['speaker', 'speakerName', 'from', 'name']),
      text,
    });
    return;
  }

  if (type === 'buttons' || type === 'buttongroup' || type === 'choice') {
    const options = parseChoiceOptions(entry.options ?? entry.buttons ?? entry.items);
    if (options.length === 0) {
      result.warnings.push('Output Actions buttons group has no valid options.');
      return;
    }
    const choiceGroup: OutputActionChoiceGroup = {
      id: stringValue(entry, ['id', 'key', 'name']),
      kind: 'buttons',
      prompt: stringValue(entry, ['prompt', 'question', 'text', 'title']),
      columns: boundedColumns(numberValue(entry, ['columns', 'perRow'])),
      text: optionalStringValue(entry, ['sendText', 'inputText', 'userText']),
      player: stringValue(entry, ['player', 'playerName', 'setPlayer', 'character', 'characterName']),
      messageFormat: numberValue(entry, ['messageFormat', 'message_format', 'outputChannel']),
      turnMode: numberValue(entry, ['turnMode', 'turn_mode', 'promptSlot']),
      mode: actionMode(entry.mode ?? entry.actionMode),
      options,
    };
    result.choiceGroups.push(choiceGroup);
    result.uiItems.push({ type: 'choiceGroup', value: choiceGroup });
    return;
  }

  if (type === 'infobox' || type === 'info' || type === 'note' || type === 'notice') {
    const text = stringValue(entry, ['text', 'message', 'content', 'body']);
    if (!text) {
      result.warnings.push('Output Actions infoBox is missing text.');
      return;
    }
    const infoBox: OutputActionInfoBox = {
      title: stringValue(entry, ['title', 'label', 'heading']),
      text,
      tone: boundedTone(entry.tone ?? entry.variant ?? entry.level),
    };
    result.infoBoxes.push(infoBox);
    result.uiItems.push({ type: 'infoBox', value: infoBox });
    return;
  }

  if (type === 'progressbar' || type === 'progress' || type === 'meter') {
    const title = stringValue(entry, ['title', 'label', 'name']);
    const min = numberValue(entry, ['min', 'minimum']);
    const max = numberValue(entry, ['max', 'maximum']);
    const value = numberValue(entry, ['value', 'current', 'currentValue']);
    if (!title || min === undefined || max === undefined || value === undefined) {
      result.warnings.push('Output Actions progressBar needs title, min, max, and value.');
      return;
    }
    if (max <= min) {
      result.warnings.push('Output Actions progressBar max must be greater than min.');
      return;
    }
    const progressBar: OutputActionProgressBar = {
      title,
      min,
      max,
      value: Math.min(max, Math.max(min, value)),
      label: stringValue(entry, ['text', 'caption', 'description']),
    };
    result.progressBars.push(progressBar);
    result.uiItems.push({ type: 'progressBar', value: progressBar });
    return;
  }

  if (type === 'contextcapacity' || type === 'contextcapacitybar' || type === 'contextcompressioncapacity') {
    const source = parseContextCapacitySource(entry.source ?? entry.contextCompression ?? entry.node);
    if (!source) {
      result.warnings.push('Output Actions contextCapacity needs source { "type": "contextCompression", "index": 1 }.');
      return;
    }
    const contextCapacityBar: OutputActionContextCapacityRequest = {
      id: stringValue(entry, ['id', 'key', 'name']),
      title: stringValue(entry, ['title', 'label']) ?? 'Context Capacity',
      label: stringValue(entry, ['text', 'caption', 'description']),
      showLegend: optionalBooleanValue(entry, ['showLegend', 'legend']),
      source,
    };
    result.contextCapacityBars.push(contextCapacityBar);
    result.uiItems.push({ type: 'contextCapacity', value: contextCapacityBar });
    return;
  }

  if (type === 'settab' || type === 'switchtab' || type === 'tab') {
    const tab = compactType(entry.tab ?? entry.value ?? entry.target);
    if (tab === 'chat' || tab === 'phone' || tab === 'events') {
      result.controls.push({ type: 'setTab', tab });
      return;
    }
    result.warnings.push('Output Actions setTab needs tab "chat", "phone", or "events".');
    return;
  }

  if (type === 'setplayer' || type === 'playas' || type === 'player') {
    const name = stringValue(entry, ['name', 'player', 'character', 'value']);
    if (name) {
      result.controls.push({ type: 'setPlayer', name });
      return;
    }
    result.warnings.push('Output Actions setPlayer needs a character name.');
    return;
  }

  result.warnings.push(type ? `Unknown Output Actions type: ${type}.` : 'Output Actions entry has no type.');
}

function withoutJsonCodeFence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function topLevelJsonRanges(text: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        ranges.push({ start, end: index + 1 });
        start = -1;
      }
      if (depth < 0) {
        return [];
      }
    }
  }
  return depth === 0 ? ranges : [];
}

function parseJsonSequence(text: string) {
  const ranges = topLevelJsonRanges(text);
  if (ranges.length <= 1) {
    return undefined;
  }
  const outside = ranges.reduceRight(
    (current, range) => `${current.slice(0, range.start)}${current.slice(range.end)}`,
    text,
  );
  if (outside.replace(/[,\s]/g, '')) {
    return undefined;
  }
  return ranges.map((range) => JSON.parse(text.slice(range.start, range.end)) as unknown);
}

function parseOutputActionsRoot(
  parsed: unknown,
  result: ParsedOutputActions,
  options: ParseOutputActionsOptions,
) {
  if (Array.isArray(parsed)) {
    parsed.forEach((entry) => parseAction(entry, result, options));
    return;
  }

  if (!isRecord(parsed)) {
    result.warnings.push('RP Output Actions JSON must be an object or array.');
    return;
  }

  const hasRootCollections =
    Array.isArray(parsed.actions) ||
    Array.isArray(parsed.phoneMessages) ||
    Array.isArray(parsed.bankTransfers) ||
    Array.isArray(parsed.chatMessages) ||
    Array.isArray(parsed.choices) ||
    Array.isArray(parsed.infoBoxes) ||
    Array.isArray(parsed.progressBars) ||
    Array.isArray(parsed.contextCapacityBars) ||
    Array.isArray(parsed.createdPhoneNotes) ||
    Array.isArray(parsed.deletedPhoneNotes) ||
    Array.isArray(parsed.simulatedAiChats);

  if (Array.isArray(parsed.actions)) {
    parsed.actions.forEach((entry) => parseAction(entry, result, options));
  } else if (!hasRootCollections) {
    parseAction(parsed, result, options);
  }

  if (Array.isArray(parsed.phoneMessages)) {
    parsed.phoneMessages.forEach((entry) => {
      if (!isRecord(entry)) {
        result.warnings.push('Output Actions phoneMessages entry is not an object.');
        return;
      }
      const phoneMessage = parsePhoneMessage(entry);
      if (phoneMessage) {
        result.phoneMessages.push(phoneMessage);
      } else {
        result.warnings.push('Output Actions phone message is missing from, to, or message.');
      }
    });
  }

  if (Array.isArray(parsed.bankTransfers)) {
    parsed.bankTransfers.forEach((entry) => parseAction({ ...(isRecord(entry) ? entry : {}), type: 'bankTransfer' }, result, options));
  }

  if (Array.isArray(parsed.chatMessages)) {
    parsed.chatMessages.forEach((entry) => parseAction({ ...(isRecord(entry) ? entry : {}), type: 'chatMessage' }, result, options));
  }

  if (Array.isArray(parsed.choices)) {
    parsed.choices.forEach((entry) => parseAction(entry, result, options));
  }

  if (Array.isArray(parsed.infoBoxes)) {
    parsed.infoBoxes.forEach((entry) => parseAction({ ...(isRecord(entry) ? entry : {}), type: 'infoBox' }, result, options));
  }

  if (Array.isArray(parsed.progressBars)) {
    parsed.progressBars.forEach((entry) => parseAction({ ...(isRecord(entry) ? entry : {}), type: 'progressBar' }, result, options));
  }

  if (Array.isArray(parsed.contextCapacityBars)) {
    parsed.contextCapacityBars.forEach((entry) => parseAction({ ...(isRecord(entry) ? entry : {}), type: 'contextCapacity' }, result, options));
  }

  if (Array.isArray(parsed.createdPhoneNotes)) {
    parsed.createdPhoneNotes.forEach((entry) => pushCreatedPhoneNoteCommit(entry, result, options));
  }

  if (Array.isArray(parsed.deletedPhoneNotes)) {
    parsed.deletedPhoneNotes.forEach((entry) => pushDeletedPhoneNoteCommit(entry, result, options));
  }

  if (Array.isArray(parsed.simulatedAiChats)) {
    parsed.simulatedAiChats.forEach((entry) => pushSimulatedAiChatCommit(entry, result, options));
  }
}

export function parseOutputActions(
  value: string,
  options: ParseOutputActionsOptions = {},
): ParsedOutputActions {
  const text = withoutJsonCodeFence(value);
  const result = emptyOutputActions();
  if (!text) {
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    const sequence = parseJsonSequence(text);
    if (sequence) {
      sequence.forEach((entry) => parseOutputActionsRoot(entry, result, options));
      return result;
    }
    return {
      ...result,
      warnings: ['RP Output Actions could not be parsed as JSON.'],
    };
  }

  if (Array.isArray(parsed)) {
    parseOutputActionsRoot(parsed, result, options);
    return result;
  }

  if (!isRecord(parsed)) {
    return {
      ...result,
      warnings: ['RP Output Actions JSON must be an object or array.'],
    };
  }

  parseOutputActionsRoot(parsed, result, options);
  return result;
}
