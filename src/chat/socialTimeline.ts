import type { EmbeddedSocialMessageLink, MessageRecord, SocialDirectMessageRecord } from '../types';

/** Group consecutive standalone DMs; other timeline content starts a new stack. */
export function socialTimelineGroups(messages: MessageRecord[]) {
  const groups = new Map<number, EmbeddedSocialMessageLink[]>();
  const skippedIds = new Set<number>();
  let current: EmbeddedSocialMessageLink[] | undefined;
  let currentDay: string | undefined;
  for (const message of messages) {
    const direct = message.socialDirectMessage;
    if (!direct) {
      current = undefined;
      continue;
    }
    const day = message.rpDateTime?.slice(0, 10);
    if (!current || (day && currentDay && day !== currentDay)) {
      current = [];
      groups.set(message.id, current);
      currentDay = day;
    } else {
      skippedIds.add(message.id);
      currentDay ??= day;
    }
    current.push({
      socialMessageId: message.id,
      app: direct.app,
      from: direct.from,
      to: direct.to,
      message: direct.text,
      translatedMessage: direct.displayText,
    });
  }
  return { groups, skippedIds };
}

/** Persisted app display text also applies when only the input is translated. */
export function socialTimelineMessageText(
  link: EmbeddedSocialMessageLink,
  record: SocialDirectMessageRecord | undefined,
  englishProcessingEnabled: boolean,
) {
  return record?.displayText ?? (englishProcessingEnabled
    ? link.translatedMessage ?? link.message
    : link.message);
}
