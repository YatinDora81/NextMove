/**
 * entrypoints/options/main.tsx — mounts the Options app.
 *
 * `jf-options` on <body> selects the full-document shell in app.css (the popup uses `jf-popup`,
 * which is a fixed-width sheet). StrictMode is on: this is a plain extension page with no
 * DOM-mutating side effects to be double-invoked, and it catches lifecycle mistakes early.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/app.css';
import { App } from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('options: #root is missing from index.html');
}

document.body.classList.add('jf-options');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
