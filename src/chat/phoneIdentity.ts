import type { StorybookCharacter } from '../storybook/runtime';
import type { ChatImageAttachment, MessageRecord } from '../types';
import { whatsUpAccountId, whatsUpAliasAccountId } from '../characters/messageIdentity';
import { normalizePhoneName } from './phoneMessages';

/** Current public name per WhatsUp account ID; an ID shared by several characters names nobody. */
function currentWhatsUpNames(characters: StorybookCharacter[]) {
  const names = new Map<string, string | undefined>();
  const add = (id: string, name: string) => names.set(id, names.has(id) ? undefined : name);
  for (const character of characters) {
    add(whatsUpAccountId(character), character.name);
    const alias = character.apps?.whatsup?.alias?.name.trim();
    if (alias) add(whatsUpAliasAccountId(character), alias);
  }
  return names;
}

/** Gallery labels follow a renamed sender account, like its chat thread; a removed account keeps its recorded name. */
export function phoneImagesWithCurrentSenders(images: ChatImageAttachment[], characters: StorybookCharacter[]): ChatImageAttachment[] {
  const names = currentWhatsUpNames(characters);
  return images.map((image) => {
    const name = image.receivedFrom && names.get(image.receivedFromAccountId ?? '');
    return name && name !== image.receivedFrom ? { ...image, receivedFrom: name } : image;
  });
}

/** Resolve stored participants by stable identity without rewriting dialogue or shared link tokens. */
export function phoneMessagesWithCurrentNames(messages: MessageRecord[], characters: StorybookCharacter[]): MessageRecord[] {
  const names = currentWhatsUpNames(characters);
  const phones = new Map<number, MessageRecord>();
  let changed = false;
  const current = messages.map((message) => {
    if (message.channel !== 'phone') return message;
    const from = names.get(message.phoneFromAccountId ?? '') ?? message.phoneFrom;
    const to = names.get(message.phoneToAccountId ?? '') ?? message.phoneTo;
    const next = from === message.phoneFrom && to === message.phoneTo ? message : {
      ...message, phoneFrom: from, phoneTo: to,
      ...(from !== message.phoneFrom ? { speakerName: from, speakerNames: from ? [from] : [] } : {}),
    };
    phones.set(message.id, next);
    changed ||= next !== message;
    return next;
  }).map((message) => {
    if (!message.embeddedPhoneMessages?.some((link) => {
      const phone = phones.get(link.phoneMessageId);
      return phone && (phone.phoneFrom !== link.from || phone.phoneTo !== link.to);
    })) return message;
    changed = true;
    return { ...message, embeddedPhoneMessages: message.embeddedPhoneMessages.map((link) => {
      const phone = phones.get(link.phoneMessageId);
      return phone ? { ...link, from: phone.phoneFrom ?? link.from, to: phone.phoneTo ?? link.to } : link;
    }) };
  });
  return changed ? current : messages;
}

/** Move name-based UI markers alongside account-backed messages after a rename. */
export function phoneMarkersWithCurrentNames(
  markers: Record<string, number>, previous: MessageRecord[], current: MessageRecord[],
) {
  const key = (message: MessageRecord) => [message.phoneFrom ?? '', message.phoneTo ?? '']
    .map(normalizePhoneName).sort().join('::');
  const currentById = new Map(current.map((message) => [message.id, message]));
  let result = markers;
  for (const message of previous) {
    const next = currentById.get(message.id);
    if (message.channel !== 'phone' || !next || message === next) continue;
    if (message.phoneFromAccountId !== next.phoneFromAccountId || message.phoneToAccountId !== next.phoneToAccountId) continue;
    const oldKey = key(message);
    const newKey = key(next);
    if (oldKey === newKey || markers[oldKey] === undefined) continue;
    if (result[newKey] !== undefined && result[newKey] >= markers[oldKey]) continue;
    if (result === markers) result = { ...markers };
    result[newKey] = Math.max(result[newKey] ?? 0, markers[oldKey]);
  }
  return result;
}
