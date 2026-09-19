import { useEffect, useState } from 'react';
import type { MessageRecord, RpDateTimeFormat, RpWeekdayLanguage } from '../types';
import type { StorybookCharacter } from '../storybook/runtime';
import {
  bankTransactionsForCharacter,
  bankingBalanceForCharacter,
  bankingRecipientNamesForCharacter,
  formatBankingAmount,
} from '../chat/bankTransfers';
import { bankingRecipientByName, bankingRecipientCandidates } from '../chat/bankingRecipients';
import { dummyBankTransactions } from '../chat/bankingDummyTransactions';
import { normalizePhoneName } from '../chat/phoneMessages';
import { formatRpDateTimeParts } from '../workflow';
import { CharacterAvatar } from './CharacterAvatar';

type PhoneBankingScreenProps = {
  owner?: StorybookCharacter;
  storyCharacters: StorybookCharacter[];
  appCharacters?: StorybookCharacter[];
  characterColors: Map<string, string>;
  bankTransferMessages: MessageRecord[];
  bankingContactNames: string[];
  clockDateTime: string;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  sendLocked: boolean;
  isRunning: boolean;
  initialRecipientName?: string;
  recipientRequestId?: number;
  onBack: () => void;
  onAddBankingContact: (characterId: string, contactName: string) => void;
  onSendBankTransfer: (request: {
    from: StorybookCharacter;
    to: string;
    amount: number;
    note: string;
  }) => void;
};

export function PhoneBankingScreen({
  owner,
  storyCharacters,
  appCharacters,
  characterColors,
  bankTransferMessages,
  bankingContactNames,
  clockDateTime,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  sendLocked,
  isRunning,
  initialRecipientName,
  recipientRequestId,
  onBack,
  onAddBankingContact,
  onSendBankTransfer,
}: PhoneBankingScreenProps) {
  const allCharacters = appCharacters ?? storyCharacters;
  const [recipientKey, setRecipientKey] = useState<string | undefined>(() =>
    initialRecipientName ? normalizePhoneName(initialRecipientName) : undefined
  );
  const [seenRecipientRequest, setSeenRecipientRequest] = useState({ name: initialRecipientName, id: recipientRequestId });
  if (seenRecipientRequest.name !== initialRecipientName || seenRecipientRequest.id !== recipientRequestId) {
    setSeenRecipientRequest({ name: initialRecipientName, id: recipientRequestId });
    if (initialRecipientName) setRecipientKey(normalizePhoneName(initialRecipientName));
  }

  const [showBalance, setShowBalance] = useState(true);
  const [copiedCard, setCopiedCard] = useState(false);
  useEffect(() => {
    if (!copiedCard) return;
    const timeout = window.setTimeout(() => setCopiedCard(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copiedCard]);
  const [transactionFilter, setTransactionFilter] = useState<'all' | 'sent' | 'received'>('all');

  const [searchQuery, setSearchQuery] = useState('');
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');

  const balance = owner ? bankingBalanceForCharacter(owner, bankTransferMessages) : 0;
  const transactions = owner
    ? bankTransactionsForCharacter(owner, bankTransferMessages)
    : [];

  const recipient = recipientKey
    ? (() => {
        const match = bankingRecipientByName(recipientKey, allCharacters, owner);
        if (match) {
          return {
            key: recipientKey,
            name: match.name,
            character: match,
          };
        }
        return undefined;
      })()
    : undefined;

  const dummyTransactions = owner ? dummyBankTransactions(owner, clockDateTime) : [];

  // Merge real transfers and the generated opening history into one list, newest first.
  const transactionRows = [
    ...transactions.map((transaction) => ({
      kind: 'transfer' as const,
      rpDateTime: transaction.message.rpDateTime ?? '9999-12-31T23:59',
      transaction,
    })),
    ...dummyTransactions.map((transaction) => ({
      kind: 'dummy' as const,
      rpDateTime: transaction.rpDateTime,
      transaction,
    })),
  ].sort((left, right) => right.rpDateTime.localeCompare(left.rpDateTime));

  const filteredTransactionRows = transactionRows.filter((row) => {
    if (transactionFilter === 'all') return true;
    if (row.kind === 'transfer') {
      return row.transaction.direction === transactionFilter;
    }
    return transactionFilter === 'sent';
  });

  const amount = Math.round(Number(amountText) * 100) / 100;
  const amountValid = Number.isFinite(amount) && amount > 0;
  const insufficientBalance = amountValid && amount > balance;
  const canSend =
    !!owner && !!recipient && amountValid && !insufficientBalance && !sendLocked && !isRunning;
  const sendHint = sendLocked
    ? 'Sending is locked for the Narrator. Select a character to send money.'
    : insufficientBalance
      ? 'Not enough balance for this amount.'
      : undefined;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onBack();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  function sendTransfer() {
    if (!canSend || !owner || !recipient) {
      return;
    }
    onSendBankTransfer({ from: owner, to: recipient.name, amount, note });
    setRecipientKey(undefined);
    setAmountText('');
    setNote('');
  }

  // Characters currently in the user's banking / story list (excluding owner)
  const currentRecipientNames = owner
    ? bankingRecipientNamesForCharacter(
        owner,
        storyCharacters,
        bankTransferMessages,
        bankingContactNames ?? [],
      )
    : storyCharacters.map((c) => c.name);

  const candidatesToShow = bankingRecipientCandidates(searchQuery, currentRecipientNames, allCharacters, owner);

  const cardNumber = owner
    ? Math.abs(
        owner.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 9000 + 1000,
      )
    : '0000';

  async function copyCardNumber() {
    if (!owner) return;
    const ibanText = `RPB-${cardNumber}-${owner.name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)}`;
    try {
      await navigator.clipboard.writeText(ibanText);
      setCopiedCard(true);
    } catch {
      setCopiedCard(false);
    }
  }

  return (
    <div className="phone-banking-screen" aria-label="Banking">
      <header className="phone-gallery-header phone-banking-header">
        <button type="button" onClick={onBack} aria-label="Back" title="Back" className="phone-banking-back-button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="phone-banking-header-title">
          <span>RPB Digital Banking</span>
          <strong>{owner ? `${owner.name}` : 'No Account'}</strong>
        </div>
        <div className="phone-banking-header-badge">
          <span className="phone-banking-status-dot" aria-hidden="true" />
          <span>Live</span>
        </div>
      </header>

      <div className="phone-banking-scroll">
        {/* Luxury Neo-Bank Card: Top row + Single clean horizontal row for Cardholder, Balance, Card ID */}
        <section className="phone-banking-balance-card" aria-label="Account Card">
          <div className="phone-banking-card-shine" aria-hidden="true" />
          <div className="phone-banking-card-top">
            <div className="phone-banking-card-brand">
              <span className="phone-banking-card-chip" aria-hidden="true" />
              <span className="phone-banking-card-type">Premium Checking</span>
            </div>
            <div className="phone-banking-card-actions">
              <button
                type="button"
                className="phone-banking-privacy-toggle"
                onClick={() => setShowBalance((curr) => !curr)}
                aria-label={showBalance ? 'Hide balance' : 'Show balance'}
                title={showBalance ? 'Hide balance' : 'Show balance'}
              >
                {showBalance ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                )}
              </button>
              <div className="phone-banking-card-network" aria-hidden="true">
                <svg width="28" height="18" viewBox="0 0 28 18" fill="none">
                  <circle cx="9" cy="9" r="8" fill="rgba(239, 68, 68, 0.75)" />
                  <circle cx="19" cy="9" r="8" fill="rgba(234, 179, 8, 0.75)" />
                </svg>
              </div>
            </div>
          </div>

          <div className="phone-banking-card-row">
            <div className="phone-banking-card-col cardholder">
              <small>Cardholder</small>
              <strong className="phone-banking-balance-owner">
                {owner ? owner.name : 'No Account'}
              </strong>
            </div>

            <div className="phone-banking-card-col balance">
              <small>Available Balance</small>
              <strong className="phone-banking-balance-amount">
                {showBalance ? formatBankingAmount(balance) : '••••••••'}
              </strong>
            </div>

            <div className="phone-banking-card-col digits">
              <small>Card ID</small>
              <button
                type="button"
                className="phone-banking-card-digits-btn"
                onClick={copyCardNumber}
                title="Click to copy ID"
                aria-label="Copy card ID"
              >
                <span>{copiedCard ? '✓ Copied' : `•••• ${cardNumber}`}</span>
              </button>
            </div>
          </div>
        </section>

        {/* Send Money Section */}
        <section className="phone-banking-section" aria-label="Send money">
          <div className="phone-banking-section-heading">
            <div className="phone-banking-section-title-group">
              <span className="phone-banking-section-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </span>
              <h4>Send Money</h4>
            </div>
          </div>

          {/* Recipient Selection: Hero banner if selected, otherwise 3-column character grid */}
          {recipient ? (
            <div className="phone-banking-selected-banner">
              <div className="phone-banking-selected-avatar-group">
                <CharacterAvatar
                  className="phone-avatar selected"
                  name={recipient.name}
                  fallback={recipient.name.slice(0, 1).toUpperCase()}
                  profileImageDataUrl={recipient.character?.profileImage?.dataUrl}
                  style={(() => {
                    const color = characterColors.get(recipient.name);
                    return color ? { borderColor: color, boxShadow: `0 0 10px ${color}55` } : undefined;
                  })()}
                />
                <strong className="phone-banking-selected-name">{recipient.name}</strong>
              </div>
              <button
                type="button"
                className="phone-banking-change-recipient-btn"
                onClick={() => setRecipientKey(undefined)}
                title="Select different recipient"
              >
                ✕ Change
              </button>
            </div>
          ) : (
            <div className="phone-banking-recipient-picker">
              <div className="phone-banking-field">
                <span>Add Recipient</span>
                <div className="phone-banking-input-wrapper">
                  <svg className="phone-banking-input-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search characters..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="phone-banking-input-clear-btn"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              <div className="phone-banking-grid-candidates" role="listbox" aria-label="Available recipients">
                {candidatesToShow.map((candidate) => {
                  const color = characterColors.get(candidate.name);
                  return (
                    <button
                      type="button"
                      key={candidate.id}
                      className="phone-banking-grid-candidate"
                      onClick={() => {
                        if (owner) {
                          onAddBankingContact(owner.id, candidate.name);
                        }
                        setRecipientKey(normalizePhoneName(candidate.name));
                        setSearchQuery('');
                      }}
                      title={candidate.name}
                    >
                      <CharacterAvatar
                        className="phone-avatar compact"
                        name={candidate.name}
                        fallback={candidate.name.slice(0, 1).toUpperCase()}
                        profileImageDataUrl={candidate.profileImage?.dataUrl}
                        style={color ? { borderColor: color, color } : undefined}
                      />
                      <span className="phone-banking-grid-candidate-name">{candidate.name}</span>
                    </button>
                  );
                })}

                {candidatesToShow.length === 0 && (
                  <div className="phone-banking-empty-candidates">
                    No characters found.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Amount and Quick Increment Chips in One Row */}
          <div className="phone-banking-field">
            <span>Amount ($)</span>
            <div className="phone-banking-amount-row">
              <div className="phone-banking-amount-input-box">
                <span className="phone-banking-amount-prefix">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  className="phone-banking-amount-input"
                />
              </div>

              <div className="phone-banking-quick-chips">
                {[10, 25, 50, 100].map((preset) => (
                  <button
                    type="button"
                    key={preset}
                    className="phone-banking-quick-chip"
                    onClick={() => {
                      const current = Number(amountText) || 0;
                      const next = Math.round((current + preset) * 100) / 100;
                      setAmountText(String(next));
                    }}
                    title={`Add $${preset}`}
                  >
                    +{preset}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="phone-banking-field">
            <span>Note (optional)</span>
            <div className="phone-banking-input-wrapper">
              <svg className="phone-banking-input-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <input
                type="text"
                placeholder="What is it for?"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </label>

          <button
            type="button"
            className="phone-banking-send-button"
            disabled={!canSend}
            onClick={sendTransfer}
          >
            {isRunning ? (
              'Sending...'
            ) : (
              <>
                <span>
                  {recipient && amountValid
                    ? `Send ${formatBankingAmount(amount)} to ${recipient.name}`
                    : amountValid
                      ? `Send ${formatBankingAmount(amount)}`
                      : 'Send Transfer'}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </>
            )}
          </button>
          {sendHint && <span className="phone-banking-hint send-hint">{sendHint}</span>}
          {!recipient && (
            <span className="phone-banking-subtle-hint">Select a recipient above to transfer funds.</span>
          )}
        </section>

        {/* Transactions Section */}
        <section className="phone-banking-section" aria-label="Transactions">
          <div className="phone-banking-section-heading">
            <div className="phone-banking-section-title-group">
              <span className="phone-banking-section-icon" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <h4>Recent Transactions</h4>
            </div>

            {/* Filter Tabs */}
            <div className="phone-banking-tx-filters">
              <button
                type="button"
                className={`phone-banking-tx-filter-btn${transactionFilter === 'all' ? ' active' : ''}`}
                onClick={() => setTransactionFilter('all')}
              >
                All ({transactionRows.length})
              </button>
              <button
                type="button"
                className={`phone-banking-tx-filter-btn${transactionFilter === 'received' ? ' active' : ''}`}
                onClick={() => setTransactionFilter('received')}
              >
                Received
              </button>
              <button
                type="button"
                className={`phone-banking-tx-filter-btn${transactionFilter === 'sent' ? ' active' : ''}`}
                onClick={() => setTransactionFilter('sent')}
              >
                Sent
              </button>
            </div>
          </div>

          {filteredTransactionRows.length > 0 ? (
            <ul className="phone-banking-transactions">
              {filteredTransactionRows.map((row) => {
                if (row.kind === 'transfer') {
                  const { transaction } = row;
                  const timeParts = transaction.message.rpDateTime
                    ? formatRpDateTimeParts(transaction.message.rpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
                    : undefined;
                  const timeStr = timeParts ? `${timeParts.date} • ${timeParts.time}` : undefined;
                  const isSent = transaction.direction === 'sent';

                  return (
                    <li className="phone-banking-transaction" key={`transfer-${transaction.message.id}`}>
                      <div className={`phone-banking-tx-icon ${transaction.direction}`}>
                        {isSent ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="7" y1="17" x2="17" y2="7" />
                            <polyline points="7 7 17 7 17 17" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="17" y1="7" x2="7" y2="17" />
                            <polyline points="17 17 7 17 7 7" />
                          </svg>
                        )}
                      </div>
                      <div className="phone-banking-transaction-info">
                        <strong className="phone-banking-transaction-title">
                          {isSent ? 'To' : 'From'} {transaction.counterpartyName}
                        </strong>
                        {transaction.transfer.note && (
                          <span className="phone-banking-transaction-note">
                            {transaction.transfer.note}
                          </span>
                        )}
                        {timeStr && (
                          <small className="phone-banking-transaction-time">
                            {timeStr}
                          </small>
                        )}
                      </div>
                      <div className="phone-banking-transaction-values">
                        <span className={`phone-banking-transaction-amount ${transaction.direction}`}>
                          {isSent ? '-' : '+'}
                          {formatBankingAmount(transaction.transfer.amount)}
                        </span>
                      </div>
                    </li>
                  );
                }

                const { transaction } = row;
                const timeParts = formatRpDateTimeParts(
                  transaction.rpDateTime,
                  rpDateTimeFormat,
                  rpWeekdayLanguage,
                );
                const timeStr = timeParts ? `${timeParts.date} • ${timeParts.time}` : undefined;

                return (
                  <li className="phone-banking-transaction" key={transaction.id}>
                    <div className="phone-banking-tx-icon sent dummy">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="7" y1="17" x2="17" y2="7" />
                        <polyline points="7 7 17 7 17 17" />
                      </svg>
                    </div>
                    <div className="phone-banking-transaction-info">
                      <strong className="phone-banking-transaction-title">{transaction.label}</strong>
                      {timeStr && (
                        <small className="phone-banking-transaction-time">
                          {timeStr}
                        </small>
                      )}
                    </div>
                    <div className="phone-banking-transaction-values">
                      <span className="phone-banking-transaction-amount sent">
                        -{formatBankingAmount(transaction.amount)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="phone-banking-empty">
              {transactionFilter === 'all'
                ? 'No transactions yet.'
                : `No ${transactionFilter} transactions found.`}
            </span>
          )}
        </section>
      </div>
    </div>
  );
}
