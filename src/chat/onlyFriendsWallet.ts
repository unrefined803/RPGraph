import type { MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { bankTransferMessages, bankTransferPartyMatches } from './bankTransfers';
import { normalizePhoneName } from './phoneMessages';

export type OnlyFriendsPurchasesByCharacter = Record<string, Record<string, number>>;

export const onlyFriendsWalletName = 'OnlyFriends Wallet';

function isOnlyFriendsWallet(name: string) {
  return normalizePhoneName(name) === normalizePhoneName(onlyFriendsWalletName);
}

function roundedMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function onlyFriendsWalletFundingBalance(
  character: StorybookCharacter,
  messages: MessageRecord[],
) {
  const balance = bankTransferMessages(messages).reduce((current, message) => {
    const transfer = message.bankTransfer;
    if (bankTransferPartyMatches(character, transfer.from) && isOnlyFriendsWallet(transfer.to)) {
      return current + transfer.amount;
    }
    if (isOnlyFriendsWallet(transfer.from) && bankTransferPartyMatches(character, transfer.to)) {
      return current - transfer.amount;
    }
    return current;
  }, 0);
  return roundedMoney(balance);
}

function onlyFriendsPurchaseTotal(purchases: Record<string, number> | undefined) {
  return roundedMoney(
    Object.values(purchases ?? {}).reduce((total, price) => total + price, 0),
  );
}

export function onlyFriendsWalletBalance(
  character: StorybookCharacter,
  messages: MessageRecord[],
  purchases: Record<string, number> | undefined,
) {
  return roundedMoney(
    onlyFriendsWalletFundingBalance(character, messages) - onlyFriendsPurchaseTotal(purchases),
  );
}
