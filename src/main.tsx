import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './browserRpgraphStub';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { AppEntry } from './AppEntry';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppEntry />
  </StrictMode>,
);
