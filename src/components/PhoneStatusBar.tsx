import { useEffect, useState } from 'react';
import type { RpDateTimeFormat, RpWeekdayLanguage } from '../types';
import { formatRpDateTimeParts } from '../workflow';

type PhoneStatusBarProps = {
  /** Latest RP date-time; the local clock is shown when it is missing. */
  rpDateTime?: string;
  rpDateTimeFormat: RpDateTimeFormat;
  rpWeekdayLanguage: RpWeekdayLanguage;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

/** Thin device status bar above the Phone view; everything but the time is decorative. */
export function PhoneStatusBar({ rpDateTime, rpDateTimeFormat, rpWeekdayLanguage }: PhoneStatusBarProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (rpDateTime) {
      return;
    }
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [rpDateTime]);

  const localDateTime = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}` +
    `T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const time = formatRpDateTimeParts(rpDateTime ?? localDateTime, rpDateTimeFormat, rpWeekdayLanguage)?.time;

  return (
    <div className="phone-status-bar" aria-hidden="true">
      <time>{time ?? '--:--'}</time>
      <span className="phone-status-bar-icons">
        <svg viewBox="0 0 20 14" fill="currentColor">
          <rect x="0" y="10" width="3.5" height="4" rx="1" />
          <rect x="5.5" y="7" width="3.5" height="7" rx="1" />
          <rect x="11" y="3.5" width="3.5" height="10.5" rx="1" />
          <rect x="16.5" y="0" width="3.5" height="14" rx="1" opacity="0.35" />
        </svg>
        <span className="phone-status-bar-network">5G</span>
        <svg viewBox="0 0 20 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M1.5 5a12.5 12.5 0 0 1 17 0" />
          <path d="M4.8 8.2a7.8 7.8 0 0 1 10.4 0" />
          <circle cx="10" cy="11.8" r="1.2" fill="currentColor" stroke="none" />
        </svg>
        <span className="phone-status-bar-battery">
          <svg viewBox="0 0 27 14" fill="none">
            <rect x="0.75" y="0.75" width="22.5" height="12.5" rx="3.5" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
            <rect x="2.75" y="2.75" width="14.5" height="8.5" rx="1.75" fill="currentColor" />
            <rect x="24.75" y="4.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.55" />
          </svg>
          78%
        </span>
      </span>
    </div>
  );
}
