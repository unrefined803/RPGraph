export type PromptCommandId =
  | 'bank_transfer'
  | 'create_note'
  | 'simulate_ai_chat'
  | 'messenger_message'
  | 'messenger_conversation'
  | 'display_image'
  | 'fotogram_post_comment'
  | 'onlyfriends_post_comment';

export type PromptCommandConfig = {
  commandId: PromptCommandId;
  instructionTemplate: string;
};

export type PromptCommandStoredConfig = {
  commandId: PromptCommandId;
  preset?: 'default';
  instructionTemplate?: string;
};

export type PromptCommandToken = {
  raw: string;
  name: string;
  index: number;
};

export const promptCommandIds: PromptCommandId[] = [
  'bank_transfer',
  'create_note',
  'simulate_ai_chat',
  'messenger_message',
  'messenger_conversation',
  'display_image',
  'fotogram_post_comment',
  'onlyfriends_post_comment',
];

const promptCommandDisplayNames: Record<PromptCommandId, string> = {
  bank_transfer: 'Bank_transfer',
  create_note: 'Create_Note',
  simulate_ai_chat: 'Simulate_ChatGPD',
  messenger_message: 'Messenger_message',
  messenger_conversation: 'Messenger_conversation',
  display_image: 'Display_image',
  fotogram_post_comment: 'Fotogram_post_comment',
  onlyfriends_post_comment: 'OnlyFriends_post_comment',
};

const bankTransferInstruction = [
  'Command bank_transfer — send money with the phone Banking app.',
  '',
  'Output exactly one JSON object in this format:',
  '{',
  '  "bankTransfers": [',
  '    {',
  '      "from": "sender name",',
  '      "to": "recipient name",',
  '      "amount": 25.5,',
  '      "note": "what the payment is for"',
  '    }',
  '  ]',
  '}',
  '',
  'Copy the actual sender, recipient, and numeric amount from the transfer described in the context or your reply, even when the story names another currency or one party is an outside contact. Do not invent a transfer when no payment occurs. amount must be a positive number; the Banking app displays ledger amounts in US-dollar format. note is optional. Use full displayed names in from/to. The transfer appears in every involved Storybook character\'s Banking app and changes their balance. Several transfers can share one bankTransfers array.',
].join('\n');

const createNoteInstruction = [
  'Command create_note — create and save a new entry in a Storybook character\'s phone Notes app.',
  '',
  'Output exactly one JSON object in this format:',
  '{',
  '  "phoneNote": {',
  '    "character": "full Storybook character name",',
  '    "title": "short note title",',
  '    "text": "the complete note content"',
  '  }',
  '}',
  '',
  'The finished reply shown above already established that this character creates or saves a note now. Write the actual note that fits the story context and that finished reply. Do not repeat the surrounding RP narration inside the note.',
  '',
  'character must be the full displayed name of the Storybook character whose phone receives the note. title must be a short, useful title. text must contain the complete note in that character\'s natural wording and perspective.',
  '',
  'The entry may be a normal note, reminder, to-do item, checklist, plan, private thought, or short diary entry. Match the appropriate form to the scene. For a diary entry or personal thought, write naturally in the character\'s voice. For a reminder or plan, keep it practical and concise.',
  '',
  'Use plain text with line breaks. When a list fits, format every item on its own line starting with "- ". Do not use markdown headings, tables, code fences, or JSON inside text.',
  '',
  'Use this command only when the story or finished reply shows that the character actually creates or saves the note now. Merely remembering something, thinking about writing it later, or mentioning the Notes app is not enough. The completed entry appears in that character\'s phone Notes app.',
].join('\n');

const simulateAiChatInstruction = [
  'Command simulate_ai_chat — simulate and record a Storybook character\'s conversation with the phone AI assistant app.',
  '',
  'Output exactly one JSON object in this format:',
  '{',
  '  "aiAssistantChat": {',
  '    "character": "full Storybook character name",',
  '    "messages": [',
  '      {',
  '        "role": "user",',
  '        "text": "the character\'s question or message"',
  '      },',
  '      {',
  '        "role": "assistant",',
  '        "text": "the AI assistant\'s response"',
  '      }',
  '    ]',
  '  }',
  '}',
  '',
  'Simulate the complete AI conversation described or initiated in the context and finished reply. Write both the character messages and the assistant responses yourself; do not request another real AI call.',
  '',
  'character must be the full displayed name of the Storybook character using the app. messages must contain one to four complete exchanges: 2, 4, 6, or 8 messages. Begin with role "user", alternate strictly between "user" and "assistant", and end with role "assistant".',
  '',
  'Continue the discussion naturally when more than one exchange is useful. Follow-up messages may question, clarify, challenge, or refine the previous answer. Keep every message focused on the topic established in the context or finished reply.',
  '',
  'ChatGPD is the story world\'s fictional AI assistant app. It works similarly to the real-world ChatGPT service but is a separate product with its own name. If someone loosely calls it ChatGPT, characters may naturally clarify that the app they have is ChatGPD. The assistant responses come from ChatGPD and must not identify the service as ChatGPT.',
  '',
  'The assistant is a competent general-purpose AI. Its answers must be useful, natural, and written in the same language as the character. Do not turn every answer into a joke.',
  '',
  'Use this command only when a Storybook character actually uses the AI assistant app now. Merely mentioning AI, suggesting that someone could ask it later, or discussing AI is not enough. The completed conversation is saved as a new chat in that character\'s phone AI Assistant app.',
].join('\n');

const messengerMessageInstruction = [
  'Command messenger_message — send one private message through a supported messenger app.',
  '',
  'Choose the app required by the context: whatsUpApp for WhatsUp, fotogramApp for Fotogram, or onlyFriendsApp for OnlyFriends. The example uses whatsUpApp; replace only that top-level key when another app is required. Never output a generic messengerApp key.',
  '',
  'Output exactly one JSON object in this format:',
  '{',
  '  "whatsUpApp": [',
  '    {',
  '      "from": "sender name",',
  '      "to": "recipient name",',
  '      "message": "message text",',
  '      "isVoiceMessage": false,',
  '      "sendImageId": "stored_image_id"',
  '    }',
  '  ]',
  '}',
  '',
  'from, to, and message are required. isVoiceMessage and sendImageId are optional. They currently work only with whatsUpApp and are safely ignored by Fotogram and OnlyFriends. For WhatsUp, set isVoiceMessage to true only for a spoken TTS voice message and use sendImageId only with an exact known imageId. Use full displayed names for known contacts; invent a new outside contact name only when no known contact fits.',
].join('\n');

const messengerConversationInstruction = [
  'Command messenger_conversation — simulate a short private conversation through a supported messenger app.',
  '',
  'Choose the app required by the context: whatsUpApp for WhatsUp, fotogramApp for Fotogram, or onlyFriendsApp for OnlyFriends. The example uses whatsUpApp; replace only that top-level key when another app is required. Never output a generic messengerApp key.',
  '',
  'Output exactly one JSON object in this format:',
  '{',
  '  "whatsUpApp": [',
  '    {',
  '      "from": "first person name",',
  '      "to": "second person name",',
  '      "message": "opening message"',
  '    },',
  '    {',
  '      "from": "second person name",',
  '      "to": "first person name",',
  '      "message": "reply"',
  '    },',
  '    {',
  '      "from": "first person name",',
  '      "to": "second person name",',
  '      "message": "follow-up message"',
  '    },',
  '    {',
  '      "from": "second person name",',
  '      "to": "first person name",',
  '      "message": "final reply"',
  '    }',
  '  ]',
  '}',
  '',
  'Simulate one complete exchange with exactly two, three, or four messages. Start with the newly occurring message that initiates it; do not skip that opening message even when it is described in the plan or finished reply. Keep the messages in chronological order, alternate strictly between the same two people, and do not start a second conversation with another person.',
  '',
  'Choose the shortest pattern that completely represents the conversation described in the context or finished reply:',
  '- Two messages: one person writes, and the other person replies.',
  '- Three messages: one person writes, the other person replies, and the first person adds a final comment.',
  '- Four messages: one person writes, the other person replies, the first person writes a follow-up, and the other person sends the final reply.',
  '',
  'Write both sides of the conversation yourself. Do not invent extra messages only to reach a longer pattern. Use messenger_message instead when only one message is sent.',
  '',
  'Each entry requires from, to, and message. isVoiceMessage and sendImageId currently work only with whatsUpApp and are safely ignored by Fotogram and OnlyFriends. For WhatsUp, omit isVoiceMessage for typed messages and use sendImageId only with an exact known imageId. Use full displayed names for known contacts; invent a new outside contact name only when no known contact fits.',
].join('\n');

const displayImageInstruction = [
  'Command display_image — display exactly one stored image in the Chat tab, without sending a phone message.',
  '',
  'Output exactly one JSON object in this format:',
  '{',
  '  "displayImageId": "stored_image_id"',
  '}',
  '',
  'Use only an exact imageId from an action result or recent phone/photo history. Do not invent image IDs. Do not display more than one image per reply.',
].join('\n');

const fotogramPostCommentInstruction = [
  'Command fotogram_post_comment — write a comment under an existing Fotogram post.',
  '',
  'Output exactly one JSON object in this format:',
  '{',
  '  "fotogramPostComment": {',
  '    "postId": "fotogram-post-01",',
  '    "from": "commenter name",',
  '    "text": "comment text"',
  '  }',
  '}',
  '',
  'Copy postId exactly from the chat history. The comment appears under that post in the social app.',
].join('\n');

const onlyFriendsPostCommentInstruction = [
  'Command onlyfriends_post_comment — write a comment under an existing OnlyFriends post.',
  '',
  'Output exactly one JSON object in this format:',
  '{',
  '  "onlyFriendsPostComment": {',
  '    "postId": "onlyfriends-post-01",',
  '    "from": "commenter name",',
  '    "text": "comment text"',
  '  }',
  '}',
  '',
  'Copy postId exactly from the chat history. The comment appears under that post in the social app.',
].join('\n');

export function defaultPromptCommandInstructionTemplate(commandId: PromptCommandId) {
  switch (commandId) {
    case 'bank_transfer':
      return bankTransferInstruction;
    case 'create_note':
      return createNoteInstruction;
    case 'simulate_ai_chat':
      return simulateAiChatInstruction;
    case 'messenger_message':
      return messengerMessageInstruction;
    case 'messenger_conversation':
      return messengerConversationInstruction;
    case 'display_image':
      return displayImageInstruction;
    case 'fotogram_post_comment':
      return fotogramPostCommentInstruction;
    default:
      return onlyFriendsPostCommentInstruction;
  }
}

export function defaultPromptCommandConfig(commandId: PromptCommandId): PromptCommandConfig {
  return {
    commandId,
    instructionTemplate: defaultPromptCommandInstructionTemplate(commandId),
  };
}

export function isDefaultPromptCommandConfig(config: PromptCommandConfig) {
  return config.instructionTemplate.trim() ===
    defaultPromptCommandInstructionTemplate(config.commandId).trim();
}

export function knownPromptCommandId(name: string): PromptCommandId | undefined {
  const normalized = name.trim().toLocaleLowerCase();
  if (normalized === 'simulate_chatgpd') {
    return 'simulate_ai_chat';
  }
  return promptCommandIds.find((commandId) => commandId === normalized);
}

export function promptCommandTokenText(commandId: PromptCommandId) {
  return `@command: ${promptCommandDisplayNames[commandId]}`;
}

function formattedUnknownCommandName(name: string) {
  const trimmed = name.trim();
  return trimmed ? `${trimmed[0].toLocaleUpperCase()}${trimmed.slice(1)}` : trimmed;
}

function normalizePromptCommandConfig(value: unknown): PromptCommandConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const commandId = typeof record.commandId === 'string'
    ? knownPromptCommandId(record.commandId)
    : undefined;
  if (!commandId) {
    return undefined;
  }
  return {
    commandId,
    instructionTemplate:
      typeof record.instructionTemplate === 'string' && record.instructionTemplate.trim()
        ? record.instructionTemplate
        : defaultPromptCommandInstructionTemplate(commandId),
  };
}

export function isPromptCommandConfig(value: unknown): value is PromptCommandConfig {
  return !!normalizePromptCommandConfig(value);
}

export function promptCommandConfigs(value: unknown): PromptCommandConfig[] {
  const configs = Array.isArray(value)
    ? value.flatMap((entry) => {
      const normalized = normalizePromptCommandConfig(entry);
      return normalized ? [normalized] : [];
    })
    : [];
  return Array.from(
    configs
      .reduce((byId, config) => byId.set(config.commandId, config), new Map<PromptCommandId, PromptCommandConfig>())
      .values(),
  );
}

export function promptCommandSaveConfigs(value: unknown): PromptCommandStoredConfig[] {
  return promptCommandConfigs(value).map((config) =>
    isDefaultPromptCommandConfig(config)
      ? { commandId: config.commandId, preset: 'default' }
      : { commandId: config.commandId, instructionTemplate: config.instructionTemplate },
  );
}

export function configForPromptCommandToken(
  configs: PromptCommandConfig[],
  commandId: PromptCommandId,
) {
  return configs.find((config) => config.commandId === commandId)
    ?? defaultPromptCommandConfig(commandId);
}

export const promptCommandTokenPattern = /@command:[ \t]*([A-Za-z0-9_]+)/gi;

export function formatPromptCommandTokens(text: string) {
  return text.replace(promptCommandTokenPattern, (_raw, name: string) => {
    const commandId = knownPromptCommandId(name);
    return commandId
      ? promptCommandTokenText(commandId)
      : `@command: ${formattedUnknownCommandName(name)}`;
  });
}

export function parsePromptCommandTokens(text: string): PromptCommandToken[] {
  const tokens: PromptCommandToken[] = [];
  text.replace(promptCommandTokenPattern, (raw, name: string, index: number) => {
    tokens.push({ raw, name: name.toLocaleLowerCase(), index });
    return raw;
  });
  return tokens;
}

export function countPromptCommandUses(values: string[], name: string) {
  const commandId = knownPromptCommandId(name);
  const normalizedName = name.trim().toLocaleLowerCase();
  return values.reduce(
    (count, value) => count + parsePromptCommandTokens(value).filter(
      (token) => commandId
        ? knownPromptCommandId(token.name) === commandId
        : token.name === normalizedName,
    ).length,
    0,
  );
}

// The general request protocol (finish the reply, then end the output with one
// final [commands: ...] line) is written once per prompt by the prompt author;
// the token itself only expands to the literal request line for this command.
export function promptCommandHintText(commandId: PromptCommandId) {
  return `[commands: ${commandId}]`;
}

export function replacePromptCommandTokensWithHints(
  text: string,
  onUnknownName?: (name: string) => void,
) {
  return text.replace(promptCommandTokenPattern, (_raw, name: string) => {
    const commandId = knownPromptCommandId(name);
    if (!commandId) {
      onUnknownName?.(name);
      return '';
    }
    return promptCommandHintText(commandId);
  });
}

const promptCommandRequestPattern = /\[\s*commands?\s*:\s*([^\]\n\r]+)\]/gi;

export type PromptCommandRequest = {
  reply: string;
  names: string[];
};

export function parsePromptCommandRequest(reply: string): PromptCommandRequest | undefined {
  const names: string[] = [];
  const stripped = reply.replace(promptCommandRequestPattern, (_raw, list: string) => {
    list.split(',').forEach((entry) => {
      const name = entry.trim().toLocaleLowerCase();
      if (name && !names.includes(name)) {
        names.push(name);
      }
    });
    return '';
  });
  if (!names.length) {
    return undefined;
  }
  return {
    reply: stripped.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim(),
    names,
  };
}

export function promptCommandPassInstruction(
  reply: string,
  configs: PromptCommandConfig[],
  actionResultTexts: string[] = [],
) {
  return [
    'You finished the reply below and requested the commands listed after it. The reply is final and already delivered: do not rewrite, repeat, or continue it.',
    '',
    'Your finished reply:',
    reply,
    '',
    ...actionResultTexts.length
      ? ['Action results from earlier passes:', '', ...actionResultTexts, '']
      : [],
    'Requested commands:',
    '',
    ...configs.map((config) => config.instructionTemplate.trim()),
    '',
    'Now output only the JSON objects for the requested commands, each a complete standalone object directly after the previous one. Fill in the actual values from the context and your finished reply. Use valid JSON with double quotes. Do not wrap anything in markdown and do not output any other text.',
  ].join('\n');
}
