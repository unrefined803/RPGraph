import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './browserRpgraphStub';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { AppEntry } from './AppEntry';
import { panelViewSwitchEvent } from './app/panelViewSwitchEvent';

// Navigation uses the mouse. Capture Tab before native focus traversal and
// component focus traps, while preserving typing and other keyboard shortcuts.
// A plain Tab press is handed to the app as the Chat/Phone view switch.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.repeat || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  window.dispatchEvent(new Event(panelViewSwitchEvent));
}, { capture: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppEntry />
  </StrictMode>,
);
