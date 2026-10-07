import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  pendingPhoneBanners,
  phoneBannerAppLabels,
  type PhoneBanner,
  type PhoneBannerApp,
} from '../chat/phoneBanners';

/** A banner that nobody touches closes itself and stays unread. */
const phoneBannerDurationMs = 10000;
/** Simultaneous events drop in one after another so each can be read on its own. */
const phoneBannerStaggerMs = 3000;
const maxVisiblePhoneBanners = 3;

type PhoneNotificationBannersProps = {
  /** Unread events of the viewed phone owner. */
  banners: PhoneBanner[];
  /** Viewed phone owner; switching to another owner announces their latest round. */
  ownerId: string;
  latestMessageId: number;
  /** Id of the last message before the latest turn. */
  latestRoundBaselineMessageId: number;
  onOpen: (banner: PhoneBanner) => void;
};

const iconStroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const appIcons: Record<PhoneBannerApp, ReactNode> = {
  whatsup: (
    <svg {...iconStroke} strokeWidth="2">
      <path d="M18.8 5.2A8.9 8.9 0 0 0 4.7 15.9L3.4 20.4l4.7-1.2A8.9 8.9 0 1 0 18.8 5.2Z" />
    </svg>
  ),
  banking: (
    <svg {...iconStroke} strokeWidth="1.8">
      <path d="M3 9 12 4l9 5" />
      <path d="M4 9h16" />
      <path d="M6 11v7M10 11v7M14 11v7M18 11v7" />
      <path d="M3 20h18" />
    </svg>
  ),
  fotogram: (
    <svg {...iconStroke} strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" />
    </svg>
  ),
  onlyfriends: <span className="phone-onlyfriends-monogram">OF</span>,
  matchme: (
    <svg {...iconStroke} strokeWidth="1.8">
      <path d="M19 13.5c1.2-1.3 1.8-2.7 1.8-3.9A4.1 4.1 0 0 0 12 6.9a4.1 4.1 0 0 0-8.8 2.7c0 1.2.6 2.6 1.8 3.9l7 6.8Z" />
    </svg>
  ),
  notes: (
    <svg {...iconStroke} strokeWidth="1.8">
      <path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M15 3v4h4" />
      <path d="M8 11h8M8 15h8M8 19h5" />
    </svg>
  ),
  ai: 'AI',
};

const appIconClassNames: Record<PhoneBannerApp, string> = {
  whatsup: 'phone-whatsup-icon',
  banking: 'phone-banking-icon',
  fotogram: 'phone-fotogram-icon',
  onlyfriends: 'phone-onlyfriends-icon',
  matchme: 'phone-matchme-icon',
  notes: 'phone-notes-icon',
  ai: 'phone-chatgpd-icon',
};

function PhoneBannerItem({ banner, onOpen, onDismiss }: {
  banner: PhoneBanner;
  onOpen: (banner: PhoneBanner) => void;
  onDismiss: (key: string, messageId: number) => void;
}) {
  // Hovering or focusing the banner holds it open; the countdown restarts afterwards.
  const [held, setHeld] = useState(false);
  const { key, messageId } = banner;
  const dismiss = useCallback(() => onDismiss(key, messageId), [key, messageId, onDismiss]);
  useEffect(() => {
    if (held) {
      return;
    }
    const timer = window.setTimeout(dismiss, phoneBannerDurationMs);
    return () => window.clearTimeout(timer);
  }, [dismiss, held]);

  const appLabel = phoneBannerAppLabels[banner.app];
  const open = () => {
    dismiss();
    onOpen(banner);
  };
  return (
    <div
      className={`phone-banner${held ? ' held' : ''}`}
      role="status"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <button
        className="phone-banner-body"
        type="button"
        onClick={open}
        title={`Open in ${appLabel}`}
      >
        <span className={appIconClassNames[banner.app]} aria-hidden="true">{appIcons[banner.app]}</span>
        <span className="phone-banner-copy">
          <span className="phone-banner-heading">
            <strong>{banner.title}</strong>
            <span>{appLabel}</span>
          </span>
          <span className="phone-banner-text">{banner.text}</span>
        </span>
      </button>
      <button
        type="button"
        className="phone-banner-close"
        onClick={dismiss}
        aria-label="Close, keep unread"
        title="Close, keep unread"
      >
        <svg {...iconStroke} strokeWidth="2.2" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      <span className="phone-banner-countdown" aria-hidden="true" />
    </div>
  );
}

/**
 * Drop-down banners for phone events that arrive while the Phone view is open.
 * Mounted per session, so events from before it opened stay quiet. Switching to
 * another phone owner also announces that owner's unread events of the latest
 * round, so they can be opened without a detour through the app.
 */
export function PhoneNotificationBanners({
  banners,
  ownerId,
  latestMessageId,
  latestRoundBaselineMessageId,
  onOpen,
}: PhoneNotificationBannersProps) {
  const [baselineMessageId, setBaselineMessageId] = useState(latestMessageId);
  const [handled, setHandled] = useState<ReadonlyMap<string, number>>(new Map());
  const [announcedOwnerId, setAnnouncedOwnerId] = useState(ownerId);
  // Keys are scoped by owner so a banner closed on one phone stays closed there
  // and never hides an event on another phone.
  const ownerBanners = useMemo(
    () => banners.map((banner) => ({ ...banner, key: `${ownerId}:${banner.key}` })),
    [banners, ownerId],
  );
  // Undo and regeneration remove messages and reuse their ids; replacement
  // events must be announced again.
  if (ownerId !== announcedOwnerId) {
    setAnnouncedOwnerId(ownerId);
    setBaselineMessageId(Math.min(baselineMessageId, latestRoundBaselineMessageId, latestMessageId));
  } else if (latestMessageId < baselineMessageId) {
    setBaselineMessageId(latestMessageId);
  }
  if ([...handled.values()].some((messageId) => messageId > latestMessageId)) {
    setHandled(new Map([...handled].filter(([, messageId]) => messageId <= latestMessageId)));
  }
  const dismiss = useCallback((key: string, messageId: number) => {
    setHandled((current) => new Map(current).set(key, messageId));
  }, []);

  const pending = pendingPhoneBanners(ownerBanners, baselineMessageId, new Set(handled.keys()));
  const [revealedKeys, setRevealedKeys] = useState<string[]>([]);
  const visible = pending.filter((banner) => revealedKeys.includes(banner.key));
  const nextKey = visible.length < maxVisiblePhoneBanners
    ? pending.find((banner) => !revealedKeys.includes(banner.key))?.key
    : undefined;
  const pendingKeys = pending.map((banner) => banner.key).join('\n');
  const someVisible = visible.length > 0;
  useEffect(() => {
    if (nextKey === undefined) {
      return;
    }
    const timer = window.setTimeout(() => {
      const stillPending = new Set(pendingKeys.split('\n'));
      setRevealedKeys((current) => [...current.filter((key) => stillPending.has(key)), nextKey]);
    }, someVisible ? phoneBannerStaggerMs : 0);
    return () => window.clearTimeout(timer);
  }, [nextKey, pendingKeys, someVisible]);
  if (visible.length === 0) {
    return null;
  }
  return (
    <div className="phone-banner-anchor">
      <div className="phone-banner-stack" aria-label="Phone notifications">
        {visible.map((banner) => (
          <PhoneBannerItem
            key={banner.key}
            banner={banner}
            onOpen={onOpen}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </div>
  );
}
