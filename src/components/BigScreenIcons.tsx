import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="big-screen-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ChatIcon() {
  return <Icon><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" /></Icon>;
}

export function PhoneIcon() {
  return <Icon><rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4" /><path d="M10.5 18h3" /></Icon>;
}

export function EventsIcon() {
  return <Icon><path d="M12 3.5 13.9 9l5.6.3-4.4 3.5 1.5 5.5L12 15.2l-4.6 3.1 1.5-5.5L4.5 9.3l5.6-.3L12 3.5Z" /></Icon>;
}

export function AutoTurnIcon() {
  return <Icon><path d="M5 6.5v11l7-5.5-7-5.5Z" /><path d="M12.5 6.5v11l7-5.5-7-5.5Z" /></Icon>;
}

export function RunEventIcon() {
  return <Icon><path d="M13.5 3 5.5 13.5h6l-1 7.5 8-10.5h-6l1-7.5Z" /></Icon>;
}

export function UndoTurnIcon() {
  return <Icon><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></Icon>;
}

export function CancelRunIcon() {
  return <Icon><path d="m6.5 6.5 11 11" /><path d="m17.5 6.5-11 11" /></Icon>;
}

export function RegenerateIcon() {
  return <Icon><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4v4.5H9" /></Icon>;
}

export function SwitchPlayerIcon() {
  return <Icon><path d="M4.5 8h13" /><path d="m14 4.5 3.5 3.5-3.5 3.5" /><path d="M19.5 16h-13" /><path d="m10 12.5-3.5 3.5 3.5 3.5" /></Icon>;
}

export function EnterBigScreenIcon() {
  return <Icon><path d="M9 4.5H4.5V9" /><path d="M15 4.5h4.5V9" /><path d="M9 19.5H4.5V15" /><path d="M15 19.5h4.5V15" /></Icon>;
}

export function ExitBigScreenIcon() {
  return <Icon><path d="M4.5 9H9V4.5" /><path d="M19.5 9H15V4.5" /><path d="M4.5 15H9v4.5" /><path d="M19.5 15H15v4.5" /></Icon>;
}
