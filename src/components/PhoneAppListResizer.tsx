import { useContext, type PointerEvent as ReactPointerEvent } from 'react';
import { clampPhoneAppListScale } from '../settings';
import type { PhoneAppListId } from '../types';
import { PhoneAppListScaleContext } from './phoneAppListScale';

/** Drag handle on the right edge of an app's list; place it inside the positioned list element. */
export function PhoneAppListResizer({ app }: { app: PhoneAppListId }) {
  const { scales, defaultScales, onScaleChange } = useContext(PhoneAppListScaleContext);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    const list = event.currentTarget.parentElement;
    if (!list) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = list.getBoundingClientRect().width;
    const startScale = scales[app] ?? 1;
    let scale = startScale;
    const surface = list.parentElement;

    function move(moveEvent: PointerEvent) {
      if (startWidth <= 0) {
        return;
      }
      scale = clampPhoneAppListScale(startScale * (startWidth + moveEvent.clientX - startX) / startWidth);
      surface?.style.setProperty('--phone-app-list-scale', String(scale));
    }

    function stop() {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      document.body.classList.remove('resizing-panels');
      onScaleChange(app, scale);
    }

    document.body.classList.add('resizing-panels');
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  return (
    <div
      className="phone-app-list-resizer"
      role="separator"
      aria-label="Resize list"
      aria-orientation="vertical"
      title="Drag to resize the list"
      onPointerDown={startResize}
      onDoubleClick={() => onScaleChange(app, defaultScales[app] ?? 1)}
    />
  );
}
