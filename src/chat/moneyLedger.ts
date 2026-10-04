import { postsWithInitialContent } from '../characters/publications';
import type { StorybookCharacter } from '../storybook/runtime';
import type { MessageRecord } from '../types';
import { normalizePhoneName } from './phoneMessages';
import { socialHandleForCharacter, socialIdentityMatches } from './socialMedia';

/** Unlocked OnlyFriends post prices per buyer character id and post id. */
export type OnlyFriendsPurchasesByCharacter = Record<string, Record<string, number>>;

export const onlyFriendsWalletName = 'OnlyFriends Wallet';

export type MoneyLedgerEntryKind =
  | 'bankTransfer'
  | 'walletTopUp'
  | 'walletWithdrawal'
  | 'tip'
  | 'purchase'
  | 'sale';

/** One money movement seen from a single character's accounts. */
export type MoneyLedgerEntry = {
  kind: MoneyLedgerEntryKind;
  /** Nominal amount of the movement in USD. */
  amount: number;
  /** Signed change booked on the character's bank account. */
  bankDelta: number;
  /** Signed change booked on the character's OnlyFriends wallet. */
  walletDelta: number;
  counterparty: string;
  note?: string;
  /** Source timeline message; purchases and sales are session state without one. */
  messageId?: number;
  rpDateTime?: string;
  postId?: string;
};

export type CharacterMoneyLedger = {
  bankBalance: number;
  walletBalance: number;
  entries: MoneyLedgerEntry[];
};

export type MoneyLedgerOptions = {
  purchasesByCharacter?: OnlyFriendsPurchasesByCharacter;
  /** Needed to credit purchases of initial posts to their creator. */
  characters?: StorybookCharacter[];
};

function roundedMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function isOnlyFriendsWallet(name: string) {
  return normalizePhoneName(name) === normalizePhoneName(onlyFriendsWalletName);
}

function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The single source of truth for money. Balances are never stored: they are
 * replayed from the timeline (bank transfers, OnlyFriends DM tips) plus the
 * saved OnlyFriends purchases, so RP saves, Opening History, undo and
 * regeneration all stay consistent without a separate balance record.
 *
 * Rules:
 * - Bank accounts always book both sides of a transfer and may go negative.
 * - OnlyFriends wallets never go negative. An outgoing tip or withdrawal only
 *   debits what the wallet holds; the uncovered rest is assumed to come from
 *   funds outside the tracked ledger. The recipient is always credited in full.
 * - A post purchase debits the buyer's wallet and credits the creator's.
 *
 * `messages` must be in timeline order because wallet debits depend on the
 * balance at that point.
 */
export function characterMoneyLedger(
  character: StorybookCharacter,
  messages: MessageRecord[],
  options: MoneyLedgerOptions = {},
): CharacterMoneyLedger {
  const nameKey = normalizePhoneName(character.name);
  const handle = socialHandleForCharacter(character, 'onlyfriends');
  const ownsName = (name: string) => normalizePhoneName(name) === nameKey;
  const entries: MoneyLedgerEntry[] = [];
  let bank = character.banking.startBalance;
  let wallet = 0;
  const book = (entry: MoneyLedgerEntry) => {
    bank = roundedMoney(bank + entry.bankDelta);
    wallet = roundedMoney(wallet + entry.walletDelta);
    entries.push(entry);
  };

  const purchasesByCharacter = options.purchasesByCharacter ?? {};
  const ownPurchases = Object.entries(purchasesByCharacter[character.id] ?? {})
    .filter(([, price]) => validAmount(price));
  const othersPurchases = Object.entries(purchasesByCharacter)
    .filter(([buyerId]) => buyerId !== character.id)
    .flatMap(([, purchases]) => Object.entries(purchases).filter(([, price]) => validAmount(price)));
  const postAuthors = new Map<string, { name: string; own: boolean }>();
  if (ownPurchases.length || othersPurchases.length) {
    for (const message of postsWithInitialContent(options.characters ?? [character], messages)) {
      const post = message.socialPost;
      if (post?.app !== 'onlyfriends') continue;
      postAuthors.set(post.postId, {
        name: post.author,
        own: post.authorCharacterId
          ? post.authorCharacterId === character.id || post.authorCharacterId === character.sourceId
          : socialIdentityMatches(post.authorHandle, handle) || ownsName(post.author),
      });
    }
  }

  // Sales are booked first so earnings are available to later tips.
  for (const [postId, price] of othersPurchases) {
    if (!postAuthors.get(postId)?.own) continue;
    book({ kind: 'sale', amount: price, bankDelta: 0, walletDelta: price, counterparty: 'Post unlock', postId });
  }

  for (const message of messages) {
    const transfer = message.bankTransfer;
    if (transfer && validAmount(transfer.amount)) {
      const sent = ownsName(transfer.from);
      const received = ownsName(transfer.to);
      if (sent === received) continue;
      const base = {
        amount: transfer.amount,
        note: transfer.note?.trim() || undefined,
        messageId: message.id,
        rpDateTime: message.rpDateTime,
      };
      if (sent && isOnlyFriendsWallet(transfer.to)) {
        book({ ...base, kind: 'walletTopUp', bankDelta: -transfer.amount, walletDelta: transfer.amount,
          counterparty: onlyFriendsWalletName });
      } else if (received && isOnlyFriendsWallet(transfer.from)) {
        const moved = Math.min(transfer.amount, Math.max(0, wallet));
        book({ ...base, kind: 'walletWithdrawal', bankDelta: moved, walletDelta: -moved,
          counterparty: onlyFriendsWalletName });
      } else {
        book({ ...base, kind: 'bankTransfer', bankDelta: sent ? -transfer.amount : transfer.amount,
          walletDelta: 0, counterparty: sent ? transfer.to : transfer.from });
      }
      continue;
    }

    const directMessage = message.socialDirectMessage;
    if (directMessage?.app !== 'onlyfriends' || !validAmount(directMessage.tip)) continue;
    const received = socialIdentityMatches(directMessage.toHandle, handle) || ownsName(directMessage.to);
    const sent = socialIdentityMatches(directMessage.fromHandle, handle) || ownsName(directMessage.from);
    if (sent === received) continue;
    book({
      kind: 'tip',
      amount: directMessage.tip,
      bankDelta: 0,
      walletDelta: received ? directMessage.tip : -Math.min(directMessage.tip, Math.max(0, wallet)),
      counterparty: received ? directMessage.from : directMessage.to,
      messageId: message.id,
      rpDateTime: message.rpDateTime,
    });
  }

  // Purchases carry no timeline position; the player can only buy with funds on hand.
  for (const [postId, price] of ownPurchases) {
    book({ kind: 'purchase', amount: price, bankDelta: 0, walletDelta: -Math.min(price, Math.max(0, wallet)),
      counterparty: postAuthors.get(postId)?.name ?? 'Post unlock', postId });
  }

  return { bankBalance: bank, walletBalance: wallet, entries };
}
