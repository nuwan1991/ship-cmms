import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerLabels } from './platform/i18n';
import { platformLabelsEn } from './platform/labels.en';
import './styles.css';

registerLabels(platformLabelsEn);

// Shared labels (common.*, freshness.*, error.*) ship with the org module; auth/shell labels are registered here; modules register their own on import.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
