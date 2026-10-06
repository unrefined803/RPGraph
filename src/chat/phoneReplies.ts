import type { MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { recipientCharacterContext } from '../characters/appRuntime';
import { whatsUpAlias } from '../characters/messageIdentity';
import { messageAliasKey } from '../characters/messageAliases';

/** Workflow input for the bound WhatsUp recipient; history is supplied separately. */
export function whatsUpMessageInputText(
  from: string,
  to: string,
  message: string,
  recipient?: StorybookCharacter,
  context?: string,
  characters: StorybookCharacter[] = [],
) {
  return [
    '[WHATSUP MESSAGE]', 'App: WhatsUp', `Sender: ${from}`, `Recipient: ${to}`,
    `Reply as: ${to} to ${from}`,
    // The reply names both sides by account link, which keeps a second name apart from its owner's real one.
    `Reply from: @whatsup:${to}`, `Reply to: @whatsup:${from}`, '',
    ...(recipient ? [recipientCharacterContext(recipient, {
      app: 'whatsup',
      whatsUpAlias: messageAliasKey(whatsUpAlias(recipient)?.name ?? '') === messageAliasKey(to),
      sender: characters.filter((character) => character.name === from).length === 1
        ? characters.find((character) => character.name === from)
        : undefined,
      messageText: message,
      characters,
    }), ''] : []),
    ...senderIdentityNote(from, to, characters),
    ...(context ? [context, ''] : []),
    'New message:', `${from}: ${message.trim()}`,
  ].join('\n');
}

/**
 * The model reads the whole history, so it knows both names of a sender with a
 * second WhatsUp name. The recipient does not: each name is its own contact.
 */
function senderIdentityNote(from: string, to: string, characters: StorybookCharacter[]) {
  const fromKey = messageAliasKey(from);
  const owners = characters.filter((character) => {
    const alias = whatsUpAlias(character)?.name;
    return !!alias && (messageAliasKey(character.name) === fromKey || messageAliasKey(alias) === fromKey);
  });
  if (owners.length !== 1) return [];
  const alias = whatsUpAlias(owners[0])!.name.trim();
  const other = messageAliasKey(alias) === fromKey ? owners[0].name.trim() : alias;
  return [
    'Sender identity',
    `${to} sees this message from the WhatsUp contact "${from}".`,
    `Treat "${from}" and "${other}" as separate contacts unless the history establishes that ${to} learned their connection ` +
      `through their own observations, a disclosure, or another event they could know about. Private author context and access to the full history do not establish that knowledge. ` +
      `Without such evidence, do not connect the names or carry information from the other contact into this chat. ` +
      `If the connection was already discovered, preserve that knowledge; using a different account does not undo it. A suspicion remains uncertain until supported.`,
    '',
  ];
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
