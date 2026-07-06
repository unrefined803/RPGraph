import type { MessageRecord } from '../types';
import { stripRecognizedSpeakerLabels } from '../workflow/textHelpers';
import { coloredDialogueParts, quotedSpeechParts } from './textRendering';

// A message split into the pieces the voice playback reads in order:
// character quotes carry the speaker name, narration segments use null.
export type DialogueVoiceSegment = {
  messageId: number;
  speakerName: string | null;
  text: string;
};

// Strips surrounding quote characters and thought asterisks so the TTS
// model only receives the spoken words.
export function dialogueSpeechText(text: string) {
  return text
    .trim()
    .replace(/^["„“”«»‹›''']+/, '')
    .replace(/["„“”«»‹›''']+$/, '')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSpeakableContent(text: string) {
  return /[\p{L}\p{N}]/u.test(text);
}

function messageSpeakerNames(message: MessageRecord) {
  if (message.role === 'error') {
    return ['Error'];
  }
  if (message.speakerNames?.length) {
    return message.speakerNames;
  }
  return message.role === 'user' ? [message.speakerName ?? 'Character'] : [];
}

// Mirrors the composite-text split in ChatConversationPanel: messages with
// embedded phone messages render a text part before and after the phone rows.
function messageBodyTexts(message: MessageRecord, englishProcessingEnabled: boolean): string[] {
  const displayText = message.eventInput && message.eventDisplayText
    ? message.eventDisplayText
    : englishProcessingEnabled
      ? message.translatedText ?? message.originalText
      : message.originalText;
  const hasCompositeText =
    message.embeddedPhoneTextBefore !== undefined ||
    message.embeddedPhoneTextAfter !== undefined ||
    message.embeddedPhoneTranslatedTextBefore !== undefined ||
    message.embeddedPhoneTranslatedTextAfter !== undefined;
  if (!hasCompositeText) {
    return [displayText];
  }
  if (!englishProcessingEnabled) {
    return [message.embeddedPhoneTextBefore ?? '', message.embeddedPhoneTextAfter ?? ''];
  }
  return [
    message.embeddedPhoneTranslatedTextBefore ?? message.embeddedPhoneTextBefore ?? '',
    message.embeddedPhoneTranslatedTextAfter ?? message.embeddedPhoneTextAfter ?? '',
  ];
}

export function dialogueVoiceMessageSegments(
  message: MessageRecord,
  englishProcessingEnabled: boolean,
): DialogueVoiceSegment[] {
  if (message.role === 'error') {
    return [];
  }
  const speakerNames = messageSpeakerNames(message);
  const dialogue = englishProcessingEnabled
    ? message.translatedDialogue ?? []
    : message.originalDialogue ?? [];
  const segments: DialogueVoiceSegment[] = [];
  for (const bodyText of messageBodyTexts(message, englishProcessingEnabled)) {
    const visibleText = stripRecognizedSpeakerLabels(bodyText, speakerNames);
    const parts = dialogue.length > 0
      ? coloredDialogueParts(visibleText, dialogue)
      : quotedSpeechParts(visibleText);
    for (const part of parts) {
      const speakerName = 'speakerName' in part ? part.speakerName ?? null : null;
      const text = dialogueSpeechText(part.text);
      if (!hasSpeakableContent(text)) {
        continue;
      }
      const previous = segments[segments.length - 1];
      if (speakerName === null && previous && previous.speakerName === null) {
        previous.text = `${previous.text} ${text}`;
        continue;
      }
      segments.push({ messageId: message.id, speakerName, text });
    }
  }
  return segments;
}

export function dialogueVoiceWholeMessageText(
  message: MessageRecord,
  englishProcessingEnabled: boolean,
) {
  const speakerNames = messageSpeakerNames(message);
  return messageBodyTexts(message, englishProcessingEnabled)
    .map((text) => stripRecognizedSpeakerLabels(text, speakerNames))
    .map(dialogueSpeechText)
    .filter(hasSpeakableContent)
    .join('\n\n');
}

// The output messages of the most recent turn, in chat order. Used to decide
// which text the preload and read-aloud voice modes process after a run.
export function latestOutputTurnMessages(messages: MessageRecord[]): MessageRecord[] {
  const lastOutput = [...messages].reverse().find((message) => message.role === 'output');
  if (!lastOutput) {
    return [];
  }
  if (!lastOutput.turnId) {
    return [lastOutput];
  }
  return messages.filter(
    (message) => message.role === 'output' && message.turnId === lastOutput.turnId,
  );
}
