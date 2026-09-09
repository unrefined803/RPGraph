import type { MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { recipientCharacterContext } from '../characters/appRuntime';

/** Workflow input for the bound WhatsUp recipient; history is supplied separately. */
export function whatsUpMessageInputText(
  from: string,
  to: string,
  message: string,
  recipient?: StorybookCharacter,
  context?: string,
) {
  return [
    '[WHATSUP MESSAGE]', 'App: WhatsUp', `Sender: ${from}`, `Recipient: ${to}`,
    `Reply as: ${to} to ${from}`, '',
    ...(recipient ? [recipientCharacterContext(recipient), ''] : []),
    ...(context ? [context, ''] : []),
    'New message:', `${from}: ${message.trim()}`,
  ].join('\n');
}

function replyImageIds(message: MessageRecord) {
  const ids = message.phoneImageIds?.length
    ? message.phoneImageIds
    : message.imageAttachments?.map((image) => image.id);
  return ids?.map((id) => id.trim()).filter(Boolean) ?? [];
}

function replyImageDescription(message: MessageRecord) {
  return (
    message.phoneImageDescription?.trim() ||
    message.imageAttachments
      ?.map((image) => image.description?.trim())
      .find(Boolean) ||
    ''
  );
}

export function phoneReplyVisibleText(message: MessageRecord, translated = false) {
  const text = (
    translated
      ? message.translatedText ?? message.originalText
      : message.originalText
  ).trim();
  return message.imageAttachments?.length && text === 'Attached image.' ? '' : text;
}

export function formatPhoneReplyQuote(message: MessageRecord, translated = false) {
  const sender = message.phoneFrom || message.speakerName || 'Unknown';
  const imageIds = replyImageIds(message);
  const description = replyImageDescription(message);
  const imageContext = imageIds.length
    ? `[${description ? `${imageIds.join(', ')}: ${description}` : imageIds.join(', ')}]`
    : description
      ? `[Image: ${description}]`
      : '';
  const text = phoneReplyVisibleText(message, translated);
  const content = [imageContext, text].filter(Boolean).join(' ');
  return `[Replied to ${sender}: ${content || 'Message'}]`;
}

export function formatPhoneReplyInput(
  from: string,
  replyTo: MessageRecord,
  message: string,
  translated = false,
) {
  const replySender = replyTo.phoneFrom || replyTo.speakerName || 'Unknown';
  return [
    `${from} replies to ${replySender}:`,
    formatPhoneReplyQuote(replyTo, translated),
    `${from}'s message: ${message}`,
  ].join('\n');
}

export function formatPhoneInput(
  from: string,
  to: string,
  message: string,
  image?: { id?: string; description?: string },
) {
  const prefix = image ? `${from} sends an image to ${to}:` : `${from} texts ${to}:`;
  const imageId = image?.id?.trim();
  const description = image?.description?.trim();
  const imageContext = imageId
    ? `[${description ? `${imageId}: ${description}` : imageId}]`
    : '';
  const content = [imageContext, message.trim()]
    .filter(Boolean)
    .join(' ');
  return content ? `${prefix} ${content}` : prefix;
}
