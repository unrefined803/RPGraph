import type {
  BankTransferRecord,
  SocialAppKind,
  SocialDirectMessageRecord,
  SocialMessengerAppKind,
  SocialReactionsRecord,
} from '../types';
import { formatBankingAmount } from './bankTransfers';
import type { StorybookCharacter } from '../storybook/runtime';
import { accountHandleMatches } from '../characters/character';
import { socialAccountPresentation, socialDirectMessageParty } from './socialMedia';

export type PhoneBannerApp = 'whatsup' | 'banking' | SocialMessengerAppKind | 'notes' | 'ai';

/** Where the open action of a banner leads. */
type PhoneBannerTarget =
  | { kind: 'whatsup'; conversationKey: string; contactId: string }
  | { kind: 'directMessage'; app: SocialMessengerAppKind; participantName: string; participantHandle: string; messageId: string }
  | { kind: 'post'; app: SocialAppKind; postId: string }
  | { kind: 'app'; app: 'banking' | 'notes' | 'ai' };

/** One unread phone event of the viewed phone owner, announced as a drop-down banner. */
export type PhoneBanner = {
  /** Identity of the announced event; a newer event in the same thread gets a new key. */
  key: string;
  app: PhoneBannerApp;
  /** Timeline message id of the announced event. */
  messageId: number;
  title: string;
  text: string;
  target: PhoneBannerTarget;
};

export const phoneBannerAppLabels: Record<PhoneBannerApp, string> = {
  whatsup: 'WhatsUp',
  banking: 'Banking',
  fotogram: 'Fotogram',
  onlyfriends: 'OnlyFriends',
  matchme: 'MatchMe',
  notes: 'Notes',
  ai: 'ChatGPD',
};

const maxBannerTextLength = 240;

function bannerText(text: string, fallback: string) {
  const compact = text.trim().replace(/\s+/g, ' ');
  if (!compact) return fallback;
  return compact.length > maxBannerTextLength ? `${compact.slice(0, maxBannerTextLength - 1).trimEnd()}…` : compact;
}

export function whatsUpPhoneBanner(contact: {
  character: { id: string; name: string };
  conversationKey: string;
  latestPhoneId: number;
  preview: string;
}, latestText?: string): PhoneBanner {
  return {
    key: `whatsup:${contact.conversationKey}:${contact.latestPhoneId}`,
    app: 'whatsup',
    messageId: contact.latestPhoneId,
    title: contact.character.name,
    // The contact-list preview is cut for one narrow row; the banner has room for more.
    text: bannerText(latestText ?? contact.preview, 'New message'),
    target: { kind: 'whatsup', conversationKey: contact.conversationKey, contactId: contact.character.id },
  };
}

export function bankTransferPhoneBanner(messageId: number, transfer: BankTransferRecord): PhoneBanner {
  const amount = `${formatBankingAmount(transfer.amount)} from ${transfer.from} to ${transfer.to}`;
  return {
    key: `banking:${messageId}`,
    app: 'banking',
    messageId,
    title: 'Transfer received',
    text: bannerText(transfer.note?.trim() ? `${amount} · ${transfer.note}` : amount, amount),
    target: { kind: 'app', app: 'banking' },
  };
}

/** Announces the latest unread message of one direct-message thread. */
export function directMessagePhoneBanner(
  messageId: number,
  directMessage: SocialDirectMessageRecord,
  unreadCount: number,
  characters: StorybookCharacter[] = [],
): PhoneBanner {
  const text = bannerText(
    directMessage.displayText ?? directMessage.text,
    directMessage.imageIds?.length ? 'Sent a photo' : 'New message',
  );
  const details = [
    text,
    ...(directMessage.tip ? [`Tip ${formatBankingAmount(directMessage.tip)}`] : []),
    ...(unreadCount > 1 ? [`${unreadCount} new messages`] : []),
  ];
  return {
    key: `${directMessage.app}:dm:${directMessage.fromHandle.toLowerCase()}:${messageId}`,
    app: directMessage.app,
    messageId,
    title: socialDirectMessageParty(directMessage, 'from', characters, false),
    text: details.join(' · '),
    target: {
      kind: 'directMessage',
      app: directMessage.app,
      participantName: directMessage.from,
      participantHandle: directMessage.fromHandle,
      messageId: directMessage.messageId,
    },
  };
}

export function matchMeMatchPhoneBanner(messageId: number, partnerId: string, partnerName: string): PhoneBanner {
  return {
    key: `matchme:match:${partnerId}:${messageId}`,
    app: 'matchme',
    messageId,
    title: partnerName,
    text: "It's a match!",
    target: { kind: 'directMessage', app: 'matchme', participantName: partnerName, participantHandle: partnerId, messageId: '' },
  };
}

export function socialReactionsPhoneBanner(messageId: number, reactions: SocialReactionsRecord, characters: StorybookCharacter[] = []): PhoneBanner {
  const comment = reactions.comments[0];
  const authors = comment ? characters.filter((character) => accountHandleMatches(character.apps?.[reactions.app], comment.handle)) : [];
  const commentName = comment && socialAccountPresentation(reactions.app, authors.length === 1 ? authors[0] : undefined, comment.from, comment.handle).name;
  const counts = [
    ...(reactions.comments.length > 0
      ? [`${reactions.comments.length} new comment${reactions.comments.length === 1 ? '' : 's'}`] : []),
    ...(reactions.likes > 0 ? [`${reactions.likes} new like${reactions.likes === 1 ? '' : 's'}`] : []),
  ].join(', ');
  return {
    key: `${reactions.app}:post:${reactions.postId}:${messageId}`,
    app: reactions.app,
    messageId,
    title: counts ? `Your post: ${counts}` : 'New reactions on your post',
    text: comment ? bannerText(`${commentName}: ${comment.text}`, 'New reactions') : 'Open the post to see who reacted',
    target: { kind: 'post', app: reactions.app, postId: reactions.postId },
  };
}

export function phoneAppEntryPhoneBanner(app: 'notes' | 'ai', messageId: number, entryTitle: string): PhoneBanner {
  return {
    key: `${app}:${messageId}`,
    app,
    messageId,
    title: app === 'notes' ? 'New note' : 'New AI chat',
    text: bannerText(entryTitle, app === 'notes' ? 'Untitled note' : 'Untitled chat'),
    target: { kind: 'app', app },
  };
}

/**
 * Id of the last message before the latest turn. Events after it belong to the
 * round that is still fresh; without any turn there is no such round.
 */
export function latestRoundBaselineMessageId(messages: readonly { id: number; turnId?: string }[]) {
  const latestMessageId = messages.reduce((latestId, message) => Math.max(latestId, message.id), 0);
  const latestTurnMessage = messages.reduce<{ id: number; turnId?: string } | undefined>(
    (latest, message) => message.turnId && (!latest || message.id > latest.id) ? message : latest,
    undefined,
  );
  if (!latestTurnMessage) {
    return latestMessageId;
  }
  return messages.reduce(
    (firstId, message) => message.turnId === latestTurnMessage.turnId ? Math.min(firstId, message.id) : firstId,
    latestTurnMessage.id,
  ) - 1;
}

/**
 * Banners still waiting for a reaction: events newer than the baseline taken
 * when the phone was opened, minus those already closed, read, opened or expired.
 */
export function pendingPhoneBanners(
  banners: PhoneBanner[],
  baselineMessageId: number,
  handledKeys: ReadonlySet<string>,
) {
  return banners
    .filter((banner) => banner.messageId > baselineMessageId && !handledKeys.has(banner.key))
    .sort((left, right) => left.messageId - right.messageId);
}
