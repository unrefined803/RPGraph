import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './browserRpgraphStub';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { AppEntry } from './AppEntry';

// Navigation uses the mouse. Capture Tab before native focus traversal and
// component focus traps, while preserving typing and other keyboard shortcuts.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, { capture: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppEntry />
  </StrictMode>,
);
