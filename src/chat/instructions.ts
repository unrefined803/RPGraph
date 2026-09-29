import type {
  AutoTurnInstructionKey,
  AutoTurnInstructionSettings,
  RpAppointment,
  RpDateTimeFormat,
  RpWeekdayLanguage,
} from '../types';

type AutoTurnInstructionDefinition = {
  key: AutoTurnInstructionKey;
  title: string;
  defaultText: string;
  variables: string[];
};

export const autoTurnInstructionDefinitions: AutoTurnInstructionDefinition[] = [
  {
    key: 'character-rp',
    title: 'Character RP AutoTurn',
    defaultText: '<Name> moves the story forward with an action, dialogue, or decision.',
    variables: ['<Name>'],
  },
  {
    key: 'character-phone',
    title: 'Character Phone AutoTurn',
    defaultText: [
      'This is a character phone AutoTurn.',
      'The player-selected character is <Sender>; the conversation partner is <Recipient>.',
      'Generate the next message in this conversation, normally from <Sender> to <Recipient>.',
      'This instruction is not a message that <Sender> has already sent.',
      'Choose <Recipient> as the sender only when the established conversation clearly calls for their reply and another message from <Sender> would be redundant or disrupt the exchange—for example, when <Sender> has already asked an unanswered question or sent consecutive messages awaiting a response.',
      'Consider the relevant conversation across apps, not unrelated recent messages. Message count alone does not require switching speakers.',
      'Write exactly one in-character message.',
    ].join('\n'),
    variables: ['<Sender>', '<Recipient>'],
  },
  {
    key: 'narrator-rp',
    title: 'Narrator RP AutoTurn',
    defaultText: [
      'This is a Narrator AutoTurn.',
      'Continue the story by choosing the most appropriate active character or characters to act, speak, react, or decide now.',
      'Use the recent scene, relationships, current location, phone history, and pending story momentum to decide who should carry the next beat.',
      'If it makes sense for the story, a character may text or message another character as part of this continuation.',
    ].join('\n'),
    variables: [],
  },
  {
    key: 'narrator-phone',
    title: 'Narrator Phone AutoTurn',
    defaultText: [
      'This is a Narrator Phone AutoTurn.',
      'Choose the most appropriate character to send one phone message now, and choose the most appropriate recipient.',
      'Use the recent phone history, chat history, relationships, current scene, and pending story momentum to decide who should text whom.',
      'If a phone message makes sense for the story, write exactly one in-character text message from the chosen sender to the chosen recipient.',
    ].join('\n'),
    variables: [],
  },
];

export function defaultAutoTurnInstructionSettings(): AutoTurnInstructionSettings {
  return Object.fromEntries(
    autoTurnInstructionDefinitions.map((definition) => [
      definition.key,
      { mode: 'default', customText: '' },
    ]),
  ) as AutoTurnInstructionSettings;
}

export function autoTurnInstructionSettings(
  value: AutoTurnInstructionSettings | undefined,
): AutoTurnInstructionSettings {
  const defaults = defaultAutoTurnInstructionSettings();
  autoTurnInstructionDefinitions.forEach((definition) => {
    const entry = value?.[definition.key];
    if (entry?.mode === 'custom') {
      defaults[definition.key] = {
        mode: 'custom',
        customText: entry.customText ?? '',
      };
    }
  });
  return defaults;
}

export function autoTurnInstructionSaveSettings(
  value: AutoTurnInstructionSettings | undefined,
): AutoTurnInstructionSettings {
  const settings = autoTurnInstructionSettings(value);
  autoTurnInstructionDefinitions.forEach((definition) => {
    const entry = settings[definition.key];
    if (entry?.mode === 'custom' && entry.customText === definition.defaultText) {
      settings[definition.key] = { mode: 'default', customText: '' };
    }
  });
  return settings;
}

function instructionTemplate(
  settings: AutoTurnInstructionSettings | undefined,
  key: AutoTurnInstructionKey,
) {
  const definition = autoTurnInstructionDefinitions.find((entry) => entry.key === key);
  const defaultText = definition?.defaultText ?? '';
  const entry = settings?.[key];
  return entry?.mode === 'custom' ? entry.customText ?? '' : defaultText;
}

function fillInstructionVariables(template: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (text, [key, value]) => text.split(`<${key}>`).join(value),
    template,
  );
}

export function withSpeakerPrefix(name: string, text: string) {
  return `${name}: ${text.trim()}`;
}

export function autoTurnRpInstruction(characterName: string, settings?: AutoTurnInstructionSettings) {
  return fillInstructionVariables(
    instructionTemplate(settings, 'character-rp'),
    { Name: characterName },
  );
}

export function autoTurnNarratorInstruction(settings?: AutoTurnInstructionSettings) {
  return instructionTemplate(settings, 'narrator-rp');
}

export function autoTurnNarratorPhoneInstruction(settings?: AutoTurnInstructionSettings) {
  return instructionTemplate(settings, 'narrator-phone');
}

export function autoTurnPhoneInstruction(
  senderName: string,
  recipientName: string,
  settings?: AutoTurnInstructionSettings,
) {
  return fillInstructionVariables(
    instructionTemplate(settings, 'character-phone'),
    { Sender: senderName, Recipient: recipientName },
  );
}

export function eventGraphInputText(event: RpAppointment) {
  const source = event.sourceNote
    ? event.sourceNote
    : event.sourceTurnNumber !== undefined
      ? `Turn ${event.sourceTurnNumber}`
      : '';
  return [
    `Event: ${event.title}`,
    event.channel === 'phone'
      ? `Phone: ${event.phoneFrom ?? event.assignedTo ?? 'sender'} -> ${event.phoneTo ?? event.requestedBy ?? 'recipient'}`
      : '',
    source ? `Source: ${source}` : '',
  ].filter(Boolean).join('\n');
}

export function eventChatDisplayText(
  event: RpAppointment,
  _rpDateTimeFormat?: RpDateTimeFormat,
  _rpWeekdayLanguage?: RpWeekdayLanguage,
  _eventContext?: string,
) {
  return `Event: ${event.title}`;
}
