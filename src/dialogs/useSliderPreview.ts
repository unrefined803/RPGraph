import { useEffect, useState } from 'react';

/** Capture the gesture before focus moves between sliders; blur must not cancel it. */
export function useSliderPreview(enabled: boolean) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const isSlider = (target: EventTarget | null) =>
      target instanceof HTMLInputElement && target.type === 'range' &&
      !target.disabled &&
      target.matches('.options-dialog [data-slider-preview] input:not([data-no-slider-preview])');
    const startPointer = (event: PointerEvent) => {
      setActive(event.button === 0 && isSlider(event.target));
    };
    const adjustmentKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
    const startKeyboard = (event: KeyboardEvent) => {
      if (isSlider(event.target) && adjustmentKeys.has(event.key)) setActive(true);
    };
    const stop = () => setActive(false);
    window.addEventListener('pointerdown', startPointer, { capture: true });
    window.addEventListener('pointerup', stop, { capture: true });
    window.addEventListener('pointercancel', stop, { capture: true });
    window.addEventListener('keydown', startKeyboard, { capture: true });
    window.addEventListener('keyup', stop, { capture: true });
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerdown', startPointer, { capture: true });
      window.removeEventListener('pointerup', stop, { capture: true });
      window.removeEventListener('pointercancel', stop, { capture: true });
      window.removeEventListener('keydown', startKeyboard, { capture: true });
      window.removeEventListener('keyup', stop, { capture: true });
      window.removeEventListener('blur', stop);
      stop();
    };
  }, [enabled]);
  return enabled && active;
}
