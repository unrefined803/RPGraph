import { DATA_MANAGEMENT_BUDGETS } from './budgets';
import { appointmentsFromEventEntities } from './eventStore';
import { recentTimelineEntries, timelineMessages } from './timelineStore';
import {
  compactPhonePreview,
  normalizePhoneName,
  phoneNamesMatch,
} from '../chat/phoneMessages';
import type { MessageRecord, EmbeddedPhoneMessageLink } from '../types';
import type {
  EventEntity,
  RpgraphSessionV2,
  TimelineMessageEntry,
} from './types';

export function selectTimelineWindow(
  session: RpgraphSessionV2,
  maxEntries: number = DATA_MANAGEMENT_BUDGETS.maxAssistantTimelineEntries,
) {
  return recentTimelineEntries(session.timeline, maxEntries);
}

function selectMessageTimeline(session: RpgraphSessionV2): TimelineMessageEntry[] {
  return timelineMessages(session.timeline);
}

export function selectPhoneMessages(session: RpgraphSessionV2) {
  return selectMessageTimeline(session).filter((entry) => entry.channel === 'phone');
}

export function selectEvents(
  session: RpgraphSessionV2,
  maxEntries: number = DATA_MANAGEMENT_BUDGETS.maxAssistantEventEntries,
): EventEntity[] {
  return appointmentsFromEventEntities(session.entities.events)
    .map((appointment) => session.entities.events[appointment.id]!)
    .slice(0, maxEntries);
}

export type PhoneConversationInfo = {
  key: string;
  names: [string, string];
  latestId: number;
  latestIncomingTo?: string;
  latestFrom?: string;
  unreadCount: number;
  unreadByRecipient: Record<
    string,
    {
      viewerName: string;
      contactName: string;
      latestId: number;
      unreadCount: number;
    }
  >;
};

type PhoneCharacterLike = {
  id: string;
  name: string;
  temporaryPhone?: boolean;
};

export type PhoneContactView<TCharacter extends PhoneCharacterLike> = {
  character: TCharacter;
  color: string;
  conversationKey: string;
  latestPhoneId: number;
  preview: string;
  time: string;
  unreadCount: number;
};

export type UnreadPhoneConversationView = {
  key: string;
  conversationKey: string;
  viewerName: string;
  contactName: string;
  latestId: number;
  unreadCount: number;
  unread: boolean;
};

export function phoneConversationKey(left: string, right: string) {
  return [normalizePhoneName(left), normalizePhoneName(right)].sort().join('::');
}

export function phoneConversationIsOpen(
  panelView: 'chat' | 'phone' | 'events',
  conversationKey: string,
  openedConversationKey: string,
  selectedConversationKey?: string,
) {
  return panelView === 'phone' && (
    openedConversationKey === conversationKey ||
    selectedConversationKey === conversationKey
  );
}

export function phoneMessageShouldBeMarkedSeen(
  role: Extract<MessageRecord['role'], 'user' | 'output'>,
  panelView: 'chat' | 'phone' | 'events',
  conversationKey: string,
  openedConversationKey: string,
  selectedConversationKey?: string,
) {
  return role === 'user' || phoneConversationIsOpen(
    panelView,
    conversationKey,
    openedConversationKey,
    selectedConversationKey,
  );
}

function phoneMessageParticipants(message: MessageRecord) {
  if (message.channel !== 'phone') {
    return undefined;
  }
  const from = message.phoneFrom ?? message.speakerName ?? '';
  const to = message.phoneTo ?? '';
  return from && to ? { from, to } : undefined;
}

export function phoneConversationInfoFromMessages(
  messages: MessageRecord[],
  phoneSeenByConversation: Record<string, number>,
) {
  const conversations = new Map<string, PhoneConversationInfo>();
  messages.forEach((message) => {
    const participants = phoneMessageParticipants(message);
    if (!participants) {
      return;
    }
    const { from, to } = participants;
    const key = phoneConversationKey(from, to);
    const existing = conversations.get(key);
    const names: [string, string] = existing?.names ?? [from, to];
    const latestId = Math.max(existing?.latestId ?? 0, message.id);
    const seenId = phoneSeenByConversation[key] ?? 0;
    const unreadByRecipient = { ...(existing?.unreadByRecipient ?? {}) };
    if (message.id > seenId) {
      const recipientKey = normalizePhoneName(to);
      const existingRecipient = unreadByRecipient[recipientKey];
      unreadByRecipient[recipientKey] = {
        viewerName: to,
        contactName: from,
        latestId: Math.max(existingRecipient?.latestId ?? 0, message.id),
        unreadCount: (existingRecipient?.unreadCount ?? 0) + 1,
      };
    }
    conversations.set(key, {
      key,
      names,
      latestId,
      latestIncomingTo: latestId === message.id ? to : existing?.latestIncomingTo,
      latestFrom: latestId === message.id ? from : existing?.latestFrom,
      unreadCount: Object.values(unreadByRecipient).reduce(
        (count, recipient) => count + recipient.unreadCount,
        0,
      ),
      unreadByRecipient,
    });
  });
  return conversations;
}

export function phoneSeenStateFromMessages(messages: MessageRecord[]) {
  return messages.reduce<Record<string, number>>((seen, message) => {
    const participants = phoneMessageParticipants(message);
    if (!participants) {
      return seen;
    }
    const key = phoneConversationKey(participants.from, participants.to);
    seen[key] = Math.max(seen[key] ?? 0, message.id);
    return seen;
  }, {});
}

const rpDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export function latestHistoryRpDateTime(messages: MessageRecord[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.includeInHistory !== false &&
      (message.role === 'user' || message.role === 'output') &&
      !!message.rpDateTime &&
      rpDateTimePattern.test(message.rpDateTime)
    ) {
      return message.rpDateTime;
    }
  }
  return undefined;
}

export function viewerHasUnreadPhoneMessages(
  conversations: Map<string, PhoneConversationInfo>,
  viewerName: string,
) {
  const viewerKey = normalizePhoneName(viewerName);
  return Array.from(conversations.values()).some(
    (conversation) => (conversation.unreadByRecipient[viewerKey]?.unreadCount ?? 0) > 0,
  );
}

export function phoneMessagesBetween(
  messages: MessageRecord[],
  leftName: string,
  rightName: string,
) {
  return messages.filter((message) => {
    const participants = phoneMessageParticipants(message);
    if (!participants) {
      return false;
    }
    const { from, to } = participants;
    return (
      (phoneNamesMatch(from, leftName) && phoneNamesMatch(to, rightName)) ||
      (phoneNamesMatch(from, rightName) && phoneNamesMatch(to, leftName))
    );
  });
}

export function phoneContactsForViewer<TCharacter extends PhoneCharacterLike>(
  characters: TCharacter[],
  options: {
    viewedCharacter?: TCharacter;
    messages: MessageRecord[];
    conversations: Map<string, PhoneConversationInfo>;
    characterColors: Map<string, string>;
    fallbackColor: string;
    englishProcessingEnabled: boolean;
  },
): Array<PhoneContactView<TCharacter>> {
  return characters
    .filter((character) => character.id !== options.viewedCharacter?.id)
    .map((character) => {
      const conversationKey = options.viewedCharacter
        ? phoneConversationKey(options.viewedCharacter.name, character.name)
        : character.id;
      const conversation = options.conversations.get(conversationKey);
      const latestPhoneMessage = options.viewedCharacter
        ? [...phoneMessagesBetween(options.messages, options.viewedCharacter.name, character.name)].reverse()[0]
        : undefined;
      const latestText = latestPhoneMessage
        ? phoneMessageVisibleText(latestPhoneMessage, options.englishProcessingEnabled)
        : 'New';
      return {
        character,
        color: options.characterColors.get(character.name) ?? options.fallbackColor,
        conversationKey,
        latestPhoneId: conversation?.latestId ?? latestPhoneMessage?.id ?? 0,
        preview: compactPhonePreview(latestText),
        time: latestPhoneMessage ? 'Phone' : 'New',
        unreadCount: options.viewedCharacter
          ? conversation?.unreadByRecipient[normalizePhoneName(options.viewedCharacter.name)]?.unreadCount ?? 0
          : 0,
      };
    });
}

export function selectedPhoneConversationMessages<TCharacter extends PhoneCharacterLike>(
  messages: MessageRecord[],
  viewedCharacter: TCharacter | undefined,
  selectedContact: PhoneContactView<TCharacter> | undefined,
) {
  if (!viewedCharacter || !selectedContact) {
    return [];
  }
  return phoneMessagesBetween(messages, viewedCharacter.name, selectedContact.character.name);
}

function unreadPhoneSwitchesByCharacter(
  conversations: Map<string, PhoneConversationInfo>,
): UnreadPhoneConversationView[] {
  return Array.from(
    Array.from(conversations.values()).reduce((phones, conversation) => {
      Object.values(conversation.unreadByRecipient).forEach((recipient) => {
        if (recipient.unreadCount <= 0) {
          return;
        }
        const key = normalizePhoneName(recipient.viewerName);
        const existing = phones.get(key);
        if (!existing || recipient.latestId > existing.latestId) {
          phones.set(key, {
            key,
            conversationKey: conversation.key,
            viewerName: recipient.viewerName,
            contactName: recipient.contactName,
            latestId: recipient.latestId,
            unreadCount: (existing?.unreadCount ?? 0) + recipient.unreadCount,
            unread: true,
          });
          return;
        }
        phones.set(key, {
          ...existing,
          unreadCount: existing.unreadCount + recipient.unreadCount,
          unread: true,
        });
      });
      return phones;
    }, new Map<string, UnreadPhoneConversationView>())
      .values(),
  ).sort((left, right) => right.latestId - left.latestId);
}

export function unreadPhoneConversationsForCharacters<TCharacter extends PhoneCharacterLike>(
  characters: TCharacter[],
  options: {
    narratorSelected: boolean;
    selectedContact?: PhoneContactView<TCharacter>;
    conversations: Map<string, PhoneConversationInfo>;
  },
) {
  const switchByViewer = new Map<string, UnreadPhoneConversationView>();
  unreadPhoneSwitchesByCharacter(options.conversations).forEach((unreadSwitch) => {
    const viewer = matchingPhoneName(characters, unreadSwitch.viewerName);
    const sourceConversation = options.conversations.get(unreadSwitch.conversationKey);
    const fallbackViewer = sourceConversation?.names
      .map((name) => matchingPhoneName(characters, name))
      .find((character) => character && !character.temporaryPhone);
    const normalizedSwitch =
      viewer && !viewer.temporaryPhone
        ? unreadSwitch
        : fallbackViewer
          ? {
              ...unreadSwitch,
              key: normalizePhoneName(fallbackViewer.name),
              viewerName: fallbackViewer.name,
              contactName: unreadSwitch.viewerName,
            }
          : undefined;
    if (!normalizedSwitch) {
      return;
    }
    const existing = switchByViewer.get(normalizedSwitch.key);
    switchByViewer.set(normalizedSwitch.key, existing
      ? {
          ...normalizedSwitch,
          latestId: Math.max(existing.latestId, normalizedSwitch.latestId),
          unreadCount: existing.unreadCount + normalizedSwitch.unreadCount,
          unread: existing.unread || normalizedSwitch.unread,
        }
      : normalizedSwitch);
  });
  const unreadSwitches = Array.from(switchByViewer.values()).sort((left, right) => right.latestId - left.latestId);
  if (!options.narratorSelected) {
    return unreadSwitches;
  }
  const playablePhoneOwners = characters.filter((character) => !character.temporaryPhone);
  return playablePhoneOwners.map((character) => {
    const key = normalizePhoneName(character.name);
    const unreadSwitch = unreadSwitches.find((entry) => entry.key === key);
    if (unreadSwitch) {
      return unreadSwitch;
    }
    const fallbackContact =
      (
        options.selectedContact &&
        options.selectedContact.character.id !== character.id &&
        !options.selectedContact.character.temporaryPhone &&
        options.selectedContact.character
      ) ||
      playablePhoneOwners.find((candidate) => candidate.id !== character.id);
    const conversationKey = fallbackContact
      ? phoneConversationKey(character.name, fallbackContact.name)
      : character.id;
    return {
      key,
      conversationKey,
      viewerName: character.name,
      contactName: fallbackContact?.name ?? character.name,
      latestId: options.conversations.get(conversationKey)?.latestId ?? 0,
      unreadCount: 0,
      unread: false,
    };
  }).sort((left, right) =>
    Number(right.unread) - Number(left.unread) ||
    right.latestId - left.latestId ||
    left.viewerName.localeCompare(right.viewerName)
  );
}

export function matchingPhoneName<T extends { name: string }>(
  values: T[],
  name: string,
) {
  return values.find((value) => phoneNamesMatch(value.name, name));
}

export function phoneSwitchCharacters<TCharacter extends PhoneCharacterLike>(
  characters: TCharacter[],
  conversation: UnreadPhoneConversationView,
  conversations: Map<string, PhoneConversationInfo>,
) {
  const viewer = matchingPhoneName(characters, conversation.viewerName);
  const sourceConversation = conversations.get(conversation.conversationKey);
  const fallbackContactName = sourceConversation?.names.find((name) =>
    !phoneNamesMatch(name, conversation.viewerName)
  );
  const contact =
    matchingPhoneName(characters, conversation.contactName) ??
    (
      fallbackContactName
        ? matchingPhoneName(characters, fallbackContactName)
        : undefined
    ) ??
    characters.find((character) => !phoneNamesMatch(character.name, conversation.viewerName));
  return { viewer, contact };
}

export function embeddedPhoneMessageCharacters<TCharacter extends PhoneCharacterLike>(
  characters: TCharacter[],
  message: EmbeddedPhoneMessageLink,
) {
  const viewer =
    matchingPhoneName(characters, message.to) ??
    matchingPhoneName(characters, message.from);
  const contact =
    viewer && phoneNamesMatch(viewer.name, message.to)
      ? matchingPhoneName(characters, message.from)
      : matchingPhoneName(characters, message.to);
  return { viewer, contact };
}

export type PhoneTimelineEntry = {
  messageId: number;
  phoneMessage: EmbeddedPhoneMessageLink;
};

export function linkedPhoneMessageIds(messages: MessageRecord[]) {
  return new Set(
    messages.flatMap((message) =>
      message.embeddedPhoneMessages?.map((phoneMessage) => phoneMessage.phoneMessageId) ?? [],
    ),
  );
}

export function phoneMessagesById(messages: MessageRecord[]) {
  return new Map(
    messages
      .filter((message) => message.channel === 'phone')
      .map((message) => [message.id, message]),
  );
}

export function messageEffectiveRpDateTime(
  message: MessageRecord,
  phoneMessages: Map<number, MessageRecord> = phoneMessagesById([message]),
) {
  return message.rpDateTime ??
    message.embeddedPhoneMessages
      ?.map((phoneMessage) => phoneMessages.get(phoneMessage.phoneMessageId)?.rpDateTime)
      .find((rpDateTime): rpDateTime is string => !!rpDateTime);
}

export function phoneMessageRpDateTime(
  phoneMessageId: number,
  phoneMessages: Map<number, MessageRecord>,
) {
  return phoneMessages.get(phoneMessageId)?.rpDateTime;
}

export function directPhoneTimelineEntries(messages: MessageRecord[]): PhoneTimelineEntry[] {
  return messages.flatMap((message) => {
    const participants = phoneMessageParticipants(message);
    if (!participants) {
      return [];
    }
    return [{
      messageId: message.id,
      phoneMessage: {
        phoneMessageId: message.id,
        from: participants.from,
        to: participants.to,
        message: message.originalText,
      },
    }];
  });
}

export type PhoneConversationMessageView = {
  id: number;
  message: MessageRecord;
  senderName: string;
  outgoing: boolean;
  visibleText: string;
  showNewDivider: boolean;
  dayRpDateTime?: string;
};

export function phoneMessageVisibleText(
  message: MessageRecord,
  englishProcessingEnabled: boolean,
) {
  const text = englishProcessingEnabled
    ? message.translatedText ?? message.originalText
    : message.originalText;
  return message.imageAttachments?.length && text === 'Attached image.' ? '' : text;
}

export function phoneConversationMessageViews(
  messages: MessageRecord[],
  options: {
    viewerName?: string;
    selectedPhoneDividerAfterId?: number;
    englishProcessingEnabled: boolean;
    rpTimeTrackingEnabled: boolean;
  },
): PhoneConversationMessageView[] {
  const dividerAfterId = options.selectedPhoneDividerAfterId;
  const firstNewMessageId =
    dividerAfterId === undefined
      ? undefined
      : messages.find((message) => message.id > dividerAfterId)?.id;

  return messages.map((message, index) => {
    const participants = phoneMessageParticipants(message);
    const senderName = participants?.from ?? message.speakerName ?? 'Unknown';
    const previousMessage = messages[index - 1];
    const messageDay = message.rpDateTime?.slice(0, 10);
    const previousDay = previousMessage?.rpDateTime?.slice(0, 10);
    return {
      id: message.id,
      message,
      senderName,
      outgoing: Boolean(options.viewerName && phoneNamesMatch(senderName, options.viewerName)),
      visibleText: phoneMessageVisibleText(message, options.englishProcessingEnabled),
      showNewDivider: firstNewMessageId === message.id,
      dayRpDateTime:
        options.rpTimeTrackingEnabled && message.rpDateTime && messageDay !== previousDay
          ? message.rpDateTime
          : undefined,
    };
  });
}

export function visibleMessageRecords(
  messages: MessageRecord[],
  options: {
    hideMessage?: (message: MessageRecord) => boolean;
  } = {},
) {
  const linkedIds = linkedPhoneMessageIds(messages);
  return messages.filter((message) =>
    message.role !== 'error' &&
    !(
      options.hideMessage?.(message) &&
      !message.embeddedPhoneMessages?.length &&
      !message.embeddedSocialMessages?.length
    ) &&
    (message.channel !== 'phone' || !linkedIds.has(message.id))
  );
}
