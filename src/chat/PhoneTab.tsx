type PhoneTabProps = {
  active: boolean;
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
      className={active ? 'active' : ''}
      type="button"
      role="tab"
      aria-selected={active}
      aria-describedby={showSwitchHint ? phoneNotificationSwitchHintId : undefined}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
    >
      Phone
      {notificationCount > 0 && (
        <span className={`tab-badge${viewedPhoneHasNotifications ? '' : ' muted'}`}>
          {notificationCount}
        </span>
      )}
      {showSwitchHint && (
        <span
          className="phone-notification-switch-hint"
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
