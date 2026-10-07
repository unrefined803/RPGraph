import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './browserRpgraphStub';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { AppEntry } from './AppEntry';
import { panelViewSwitchPressEvent, panelViewSwitchReleaseEvent } from './app/panelViewSwitchEvent';

// Navigation uses the mouse. Capture Tab before native focus traversal and
// component focus traps, while preserving typing and other keyboard shortcuts.
// A plain Tab press and its release are handed to the app, which switches the
// Chat/Phone view on a short press and the phone notification owner on a hold.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  window.dispatchEvent(new Event(panelViewSwitchPressEvent));
}, { capture: true });
window.addEventListener('keyup', (event) => {
  if (event.key !== 'Tab') return;
  window.dispatchEvent(new Event(panelViewSwitchReleaseEvent));
}, { capture: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppEntry />
  </StrictMode>,
);
