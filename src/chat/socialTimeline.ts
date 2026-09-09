import type { EmbeddedSocialMessageLink, MessageRecord, SocialDirectMessageRecord } from '../types';

/** Empty workflow outputs are invisible and do not interrupt a conversation. */
function isEmptySocialTimelineBridge(message: MessageRecord, englishProcessingEnabled: boolean) {
  const text = englishProcessingEnabled
    ? message.translatedText ?? message.originalText
    : message.originalText;
  return message.role === 'output' && !text.trim() &&
    ![message.embeddedPhoneTextBefore, message.embeddedPhoneTextAfter,
      message.embeddedPhoneTranslatedTextBefore, message.embeddedPhoneTranslatedTextAfter].some((part) => part?.trim()) &&
    !message.embeddedPhoneMessages?.length && !message.embeddedSocialMessages?.length &&
    !message.imageAttachments?.length && !message.outputActionChoices?.length &&
    !message.outputActionInfoBoxes?.length && !message.outputActionProgressBars?.length &&
    !message.outputActionContextCapacityBars?.length && !message.phoneMessage &&
    !message.bankTransfer && !message.socialPost && !message.socialThreadAction &&
    !message.socialReactions && !message.createdPhoneNote && !message.deletedPhoneNote &&
    !message.simulatedAiChat && !message.matchMeMatch;
}

/** Group consecutive standalone DMs; other timeline content starts a new stack. */
export function socialTimelineGroups(messages: MessageRecord[], englishProcessingEnabled = false) {
  const groups = new Map<number, EmbeddedSocialMessageLink[]>();
  const skippedIds = new Set<number>();
  let current: EmbeddedSocialMessageLink[] | undefined;
  let currentDay: string | undefined;
  for (const message of messages) {
    const direct = message.socialDirectMessage;
    const day = message.rpDateTime?.slice(0, 10);
    if (!direct) {
      if (!isEmptySocialTimelineBridge(message, englishProcessingEnabled) ||
        (day && currentDay && day !== currentDay)) {
        current = undefined;
      }
      continue;
    }
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
