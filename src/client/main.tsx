/**
 * ============================================================================
 * React Client Entrypoint & Global `window.api` Version Registration
 * ============================================================================
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { APP_VERSION } from '../shared/version';
import { App } from './App';
import './styles/retro-tech.css';

// Synchronize global `window.api.appVersion` with package.json & shared version.ts
window.api = {
  ...(window.api || {}),
  appVersion: APP_VERSION,
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
