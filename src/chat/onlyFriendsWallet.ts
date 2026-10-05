import type { MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import {
  characterMoneyLedger,
  type MoneyLedgerEntry,
  type OnlyFriendsPurchasesByCharacter,
} from './moneyLedger';

export { onlyFriendsWalletName, type OnlyFriendsPurchasesByCharacter } from './moneyLedger';

/** Wallet balance from the shared money ledger; it never drops below zero. */
export function onlyFriendsWalletBalance(
  character: StorybookCharacter,
  messages: MessageRecord[],
  purchasesByCharacter?: OnlyFriendsPurchasesByCharacter,
  characters?: StorybookCharacter[],
) {
  return characterMoneyLedger(character, messages, { purchasesByCharacter, characters }).walletBalance;
}

/** Wallet movements of one character, newest first. */
export function onlyFriendsWalletActivity(
  character: StorybookCharacter,
  messages: MessageRecord[],
  purchasesByCharacter?: OnlyFriendsPurchasesByCharacter,
  characters?: StorybookCharacter[],
): MoneyLedgerEntry[] {
  return characterMoneyLedger(character, messages, { purchasesByCharacter, characters }).entries
    .filter((entry) => entry.walletDelta !== 0 || entry.kind === 'tip')
    .reverse();
}

export function formatOnlyFriendsTip(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount);
}
