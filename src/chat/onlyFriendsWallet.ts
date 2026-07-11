import type { MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { bankTransferMessages, bankTransferPartyMatches } from './bankTransfers';
import { normalizePhoneName } from './phoneMessages';
import { socialHandleForCharacter, socialIdentityMatches } from './socialMedia';

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

/** DM tips received by the character; tips are wallet credits, not bank transfers. */
function onlyFriendsTipTotal(character: StorybookCharacter, messages: MessageRecord[]) {
  const characterHandle = socialHandleForCharacter(character, 'onlyfriends');
  return roundedMoney(
    messages.reduce((total, message) => {
      const directMessage = message.socialDirectMessage;
      if (
        directMessage?.app === 'onlyfriends' &&
        typeof directMessage.tip === 'number' &&
        directMessage.tip > 0 &&
        (
          socialIdentityMatches(directMessage.toHandle, characterHandle) ||
          normalizePhoneName(directMessage.to) === normalizePhoneName(character.name)
        )
      ) {
        return total + directMessage.tip;
      }
      return total;
    }, 0),
  );
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
    onlyFriendsWalletFundingBalance(character, messages) +
      onlyFriendsTipTotal(character, messages) -
      onlyFriendsPurchaseTotal(purchases),
  );
}
