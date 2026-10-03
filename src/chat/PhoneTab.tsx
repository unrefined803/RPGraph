import type { ReactNode } from 'react';

type PhoneTabProps = {
  active: boolean;
  className?: string;
  title?: string;
  children?: ReactNode;
  notificationCount: number;
  viewedPhoneHasNotifications: boolean;
  settingsLoadComplete: boolean;
  switchHintSeen: boolean;
  onSelect: () => void;
  onCycleNotificationOwner: () => boolean;
  onSwitchHintSeen: () => void;
};

const phoneNotificationSwitchHintId = 'phone-notification-switch-hint';

export function PhoneTab({
  active,
  className,
  title,
  children = 'Phone',
  notificationCount,
  viewedPhoneHasNotifications,
  settingsLoadComplete,
  switchHintSeen,
  onSelect,
  onCycleNotificationOwner,
  onSwitchHintSeen,
}: PhoneTabProps) {
  const showSwitchHint =
    settingsLoadComplete &&
    !switchHintSeen &&
    active &&
    notificationCount > 0 &&
    !viewedPhoneHasNotifications;

  function handleDoubleClick() {
    const switchedOwner = onCycleNotificationOwner();
    if (showSwitchHint && switchedOwner) {
      onSwitchHintSeen();
    }
  }

  return (
    <button
      className={[className, active ? 'active' : ''].filter(Boolean).join(' ')}
      type="button"
      role="tab"
      aria-selected={active}
      aria-label="Phone"
      title={title}
      aria-describedby={showSwitchHint ? phoneNotificationSwitchHintId : undefined}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
    >
      {children}
      {notificationCount > 0 && (
        <span className={`tab-badge${viewedPhoneHasNotifications ? '' : ' muted'}`}>
          {notificationCount}
        </span>
      )}
      {showSwitchHint && (
        <span
          className="feature-discovery-hint phone-notification-switch-hint"
          id={phoneNotificationSwitchHintId}
          role="status"
        >
          This gray badge means another character has new phone notifications. Double-click Phone
          to switch. Double-click again to cycle through characters with notifications.
        </span>
      )}
    </button>
  );
}
