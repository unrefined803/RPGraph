import type {
  MessageRecord,
  RpDateTimeFormat,
  RpWeekdayLanguage,
} from '../types';
import { lastTurnMessages } from '../data-management/historyStore';
import { formatChatHistory } from '../workflow/textHelpers';

const inputTransformRecentTurnCount = 5;

export function recentInputHistoryContext(
  historyMessages: MessageRecord[],
  rpDateTimeFormat: RpDateTimeFormat,
  rpWeekdayLanguage: RpWeekdayLanguage,
) {
  const recentMessages = lastTurnMessages(historyMessages, inputTransformRecentTurnCount);
  if (recentMessages.length === 0) {
    return '';
  }
  const internalHistory = formatChatHistory(
    recentMessages,
    false,
    rpDateTimeFormat,
    rpWeekdayLanguage,
    historyMessages,
  ).trim();
  const visibleHistory = formatChatHistory(
    recentMessages,
    true,
    rpDateTimeFormat,
    rpWeekdayLanguage,
    historyMessages,
  ).trim();
  if (visibleHistory && visibleHistory !== internalHistory) {
    return [
      'Recent internal history:',
      internalHistory || '(empty)',
      '',
      'Recent visible history:',
      visibleHistory,
    ].join('\n');
  }
  return internalHistory;
}

export function translationPrompt({
  text,
  direction,
  displayLanguage,
  recentHistoryContext,
}: {
  text: string;
  direction: 'to-english' | 'to-display';
  displayLanguage: string;
  recentHistoryContext?: string;
}) {
  const language = displayLanguage.trim() || 'German';
  const instruction =
    direction === 'to-english'
      ? [
          'Convert the user message to English for internal roleplay processing.',
          `The display language is ${language}, but the message may already be English or mixed-language.`,
          'If it is already English, return the same English text with meaning, names, formatting, and tone preserved.',
          'If there is no user-written text to translate, such as an image-only message or only attachment/image markers, return an empty response with no notes.',
          'Do not ask the user to provide text when the input is empty or image-only.',
          'Never translate this direction into the display language.',
        ].join('\n')
      : `Translate the English roleplay text to ${language} for display.`;
  return [
    instruction,
    'Preserve tone, meaning, names, formatting, and roleplay style.',
    'Preserve quotation boundaries exactly: keep every quoted passage quoted and every unquoted passage unquoted.',
    'Never add quotation marks around text that was not quoted in the source, and never remove quotation marks that were present in the source.',
    'Tokens such as [[RPGRAPH_EMOJI_0]] are immutable placeholders. Copy every one exactly once, unchanged and in its original position.',
    recentHistoryContext?.trim()
      ? [
          'Use this recent roleplay context only to resolve names, pronouns, tone, references, and wording:',
          recentHistoryContext.trim(),
        ].join('\n')
      : '',
    'Return only the translated text. Do not add notes, and do not wrap the whole output in quotation marks that are not part of the text. When instructed to return an empty response, output no characters.',
    '',
    text,
  ].filter(Boolean).join('\n');
}

export function directInputPrompt({
  text,
  displayLanguage,
  channel,
  recentHistoryContext,
}: {
  text: string;
  displayLanguage: string;
  channel: 'rp' | 'phone';
  recentHistoryContext?: string;
}) {
  const language = displayLanguage.trim() || 'German';
  const channelInstruction = channel === 'phone'
    ? [
        'Turn the user direction into a short English phone message that the user-controlled character sends.',
        'Write exactly one sendable phone message. Output only the message text itself.',
        'Do not include sender labels, recipient labels, stage directions, narration, action text, emoji explanations, or quotation marks.',
        'Keep it concise and natural for texting. Preserve the intent, emotion, names, and relationship implied by the direction.',
        'If the direction describes tone or intent, express it through the message wording rather than explaining it.',
      ].join('\n')
    : [
        'Play out the user direction as a richer English roleplay input for internal processing.',
        'Write as the user-controlled character acting, speaking, thinking, or describing normal scene behavior according to the direction.',
        'This is normal RP chat input, not a phone UI. Do not send text messages, phone messages, notifications, calls, app messages, or chat logs.',
        'If recent context includes phone messages, use it only as background continuity; do not turn this RP input into a phone message.',
        'Do not answer for other characters, do not continue the scene as the assistant, and do not add outcomes the user did not ask for.',
        'Preserve the user-controlled character intent, tone, names, and message format.',
      ].join('\n');
  return [
    channelInstruction,
    `The user's display language is ${language}; the direction may be ${language}, English, or mixed-language.`,
    'Use recent roleplay context to infer references, relationships, mood, and continuity.',
    'Wrap spoken dialogue in quotation marks; leave narration and actions unquoted.',
    'Return only the resulting English input. Do not add notes, and do not wrap the whole output in quotation marks.',
    recentHistoryContext?.trim()
      ? [
          '',
          'Recent roleplay context:',
          recentHistoryContext.trim(),
        ].join('\n')
      : '',
    '',
    channel === 'phone' ? 'Phone direction:' : 'Roleplay direction:',
    text,
  ].filter(Boolean).join('\n');
}
