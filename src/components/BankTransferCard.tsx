import { formatBankingAmount } from '../chat/bankTransfers';
import type { BankTransferRecord, RpDateTimeFormat, RpWeekdayLanguage } from '../types';
import { formatRpDateTimeParts } from '../workflow';

type BankTransferCardProps = {
  transfer: BankTransferRecord;
  rpDateTime?: string;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
  fontSize?: number;
};

export function BankTransferCard({
  transfer,
  rpDateTime,
  rpDateTimeFormat,
  rpWeekdayLanguage,
  fontSize,
}: BankTransferCardProps) {
  const timeParts = rpDateTime
    ? formatRpDateTimeParts(rpDateTime, rpDateTimeFormat, rpWeekdayLanguage)
    : undefined;
  const note = transfer.note?.trim();
  const longNote = (note?.length ?? 0) > 42;

  return (
    <article
      className="bank-transfer-card"
      style={fontSize ? { fontSize } : undefined}
      aria-label={`${transfer.from} sent ${formatBankingAmount(transfer.amount)} to ${transfer.to}`}
    >
      <header className="bank-transfer-card-header">
        <span className="bank-transfer-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9 12 4l9 5" />
            <path d="M4 9h16M6 9v7M10 9v7M14 9v7M18 9v7M3 19h18" />
          </svg>
        </span>
        <span className="bank-transfer-card-heading">
          <strong>Banking</strong>
          <small>Transaction completed</small>
        </span>
        <span className="bank-transfer-card-status">
          <span>Completed</span>
          {timeParts && <time>{timeParts.date} {timeParts.time}</time>}
        </span>
      </header>
      <div className="bank-transfer-card-amount-row">
        <strong className="bank-transfer-card-amount">{formatBankingAmount(transfer.amount)}</strong>
        {note && (
          <span className={`bank-transfer-card-note${longNote ? ' long' : ''}`} title={note}>
            {note}
          </span>
        )}
      </div>
      <div className="bank-transfer-card-route">
        <span>
          <small>From:</small>
          <strong>{transfer.from}</strong>
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M14 7l5 5-5 5" />
        </svg>
        <span>
          <small>To:</small>
          <strong>{transfer.to}</strong>
        </span>
      </div>
    </article>
  );
}
