import type { CSSProperties, ReactNode } from 'react';

type PhoneTabletFrameProps = {
  /** False when an outer element (the Big Screen drawer) already draws the bezel. */
  framed: boolean;
  /** Screen width in pixels, excluding the bezel. */
  width: number;
  resizing: boolean;
  onResizeStart: () => void;
  children: ReactNode;
};

/** Frames the Phone view as a tablet inside the side chat drawer; its side bezels resize it. */
export function PhoneTabletFrame({ framed, width, resizing, onResizeStart, children }: PhoneTabletFrameProps) {
  if (!framed) {
    return children;
  }
  const handle = (side: 'start' | 'end') => (
    <div
      className={`phone-tablet-bezel ${side}`}
      role="separator"
      aria-label="Resize phone tablet"
      aria-orientation="vertical"
      onPointerDown={(event) => {
        event.preventDefault();
        onResizeStart();
      }}
    />
  );
  return (
    <div className={`phone-tablet-stage${resizing ? ' resizing' : ''}`}>
      <div
        className="phone-tablet-frame"
        style={{ '--phone-tablet-screen-width': `${width}px` } as CSSProperties}
      >
        {handle('start')}
        <div className="phone-tablet-screen">{children}</div>
        {handle('end')}
      </div>
    </div>
  );
}
