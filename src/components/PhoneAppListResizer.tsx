import { useContext, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { clampPhoneAppListScale } from '../settings';
import type { PhoneAppListId } from '../types';
import { PhoneAppListScaleContext } from './phoneAppListScale';

/** Drag handle on the right edge of an app's list; place it inside the positioned list element. */
export function PhoneAppListResizer({ app }: { app: PhoneAppListId }) {
  const { scales, defaultScales, onScaleChange } = useContext(PhoneAppListScaleContext);
  const resizeCleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => resizeCleanup.current?.(), []);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const list = event.currentTarget.parentElement;
    if (!list) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    resizeCleanup.current?.();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = list.getBoundingClientRect().width;
    const startScale = scales[app] ?? 1;
    let scale = startScale;
    const surface = list.parentElement;
    const previousScale = surface?.style.getPropertyValue('--phone-app-list-scale');

    function move(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== event.pointerId || startWidth <= 0) {
        return;
      }
      scale = clampPhoneAppListScale(startScale * (startWidth + moveEvent.clientX - startX) / startWidth);
      surface?.style.setProperty('--phone-app-list-scale', String(scale));
    }

    function cleanup() {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      handle.removeEventListener('lostpointercapture', stop);
      window.removeEventListener('blur', stop);
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      document.body.classList.remove('resizing-panels');
      if (previousScale) surface?.style.setProperty('--phone-app-list-scale', previousScale);
      else surface?.style.removeProperty('--phone-app-list-scale');
      resizeCleanup.current = null;
    }

    function stop() {
      cleanup();
      onScaleChange(app, scale);
    }

    resizeCleanup.current = cleanup;
    document.body.classList.add('resizing-panels');
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
    window.addEventListener('blur', stop);
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
