import type { BankTransferRecord, MessageRecord } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import { normalizePhoneName } from './phoneMessages';

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatBankingAmount(amount: number) {
  return usdFormatter.format(amount);
}

export function bankTransferHistoryText(transfer: BankTransferRecord) {
  const base = `[Bank Transfer] ${transfer.from} sent ${formatBankingAmount(transfer.amount)} to ${transfer.to}.`;
  return transfer.note?.trim() ? `${base} Note: "${transfer.note.trim()}"` : base;
}

export function bankTransferMessages(messages: MessageRecord[]) {
  return messages.filter((message): message is MessageRecord & { bankTransfer: BankTransferRecord } =>
    !!message.bankTransfer,
  );
}

export type BankTransactionView = {
  message: MessageRecord;
  transfer: BankTransferRecord;
  direction: 'sent' | 'received';
  counterpartyName: string;
};

export function bankTransferPartyMatches(character: StorybookCharacter, partyName: string) {
  return normalizePhoneName(character.name) === normalizePhoneName(partyName);
}

export function bankTransactionsForCharacter(
  character: StorybookCharacter,
  messages: MessageRecord[],
): BankTransactionView[] {
  return bankTransferMessages(messages).flatMap((message): BankTransactionView[] => {
    const { bankTransfer } = message;
    const senderMatches = bankTransferPartyMatches(character, bankTransfer.from);
    const recipientMatches = bankTransferPartyMatches(character, bankTransfer.to);
    if (senderMatches === recipientMatches) {
      return [];
    }
    if (senderMatches) {
      return [{
        message,
        transfer: bankTransfer,
        direction: 'sent' as const,
        counterpartyName: bankTransfer.to,
      }];
    }
    if (recipientMatches) {
      return [{
        message,
        transfer: bankTransfer,
        direction: 'received' as const,
        counterpartyName: bankTransfer.from,
      }];
    }
    return [];
  });
}

export function bankingRecipientNamesForCharacter(
  character: StorybookCharacter,
  storyCharacters: StorybookCharacter[],
  messages: MessageRecord[],
  savedContactNames: string[],
) {
  const namesByKey = new Map<string, string>();
  const ownerKey = normalizePhoneName(character.name);
  const includeName = (name: string) => {
    const trimmedName = name.trim().replace(/\s+/g, ' ');
    const key = normalizePhoneName(trimmedName);
    if (trimmedName && key && key !== ownerKey && !namesByKey.has(key)) {
      namesByKey.set(key, trimmedName);
    }
  };
  storyCharacters.forEach((candidate) => includeName(candidate.name));
  bankTransactionsForCharacter(character, messages).forEach((transaction) =>
    includeName(transaction.counterpartyName)
  );
  savedContactNames.forEach(includeName);
  return [...namesByKey.values()];
}

export function bankingBalanceForCharacter(
  character: StorybookCharacter,
  messages: MessageRecord[],
) {
  const balance = bankTransactionsForCharacter(character, messages).reduce(
    (current, transaction) =>
      transaction.direction === 'sent'
        ? current - transaction.transfer.amount
        : current + transaction.transfer.amount,
    character.banking.startBalance,
  );
  return Math.round(balance * 100) / 100;
}

export function latestBankTransferMessageIdForCharacter(
  character: StorybookCharacter,
  messages: MessageRecord[],
) {
  return bankTransactionsForCharacter(character, messages).reduce(
    (latestId, transaction) => Math.max(latestId, transaction.message.id),
    0,
  );
}

export function unreadBankTransferCountForCharacter(
  character: StorybookCharacter,
  messages: MessageRecord[],
  lastSeenMessageId: number,
) {
  return unreadBankTransfersForCharacter(character, messages, lastSeenMessageId).length;
}

export function unreadBankTransfersForCharacter(
  character: StorybookCharacter,
  messages: MessageRecord[],
  lastSeenMessageId: number,
) {
  return bankTransactionsForCharacter(character, messages).filter(
    (transaction) =>
      transaction.direction === 'received' &&
      transaction.message.id > lastSeenMessageId,
  );
}

export function bankingSeenStateFromMessages(
  characters: StorybookCharacter[],
  messages: MessageRecord[],
) {
  return Object.fromEntries(
    characters.map((character) => [
      character.id,
      latestBankTransferMessageIdForCharacter(character, messages),
    ]),
  );
}
