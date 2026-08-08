/**
 * entrypoints/popup/main.tsx — mounts the popup.
 *
 * The sheet's shell — `class="jf-popup"` (360px, `--jf-popup-max-height`), `role="dialog"` and its
 * accessible name — lives on `<body>` in index.html, not here: Chrome sizes the popup window from
 * the document as it loads, so anything that has to be true about the sheet's box must be true
 * before this file runs.
 *
 * The popup is a short-lived surface: it mounts, the user clicks once, and the whole document is
 * torn down. Nothing here may register long-lived listeners or timers beyond the component tree.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/app.css';
import { App } from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('popup: #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
