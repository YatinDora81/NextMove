import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/app.css';
import { App } from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('onboarding: #root is missing from index.html');
}

document.body.classList.add('jf-options');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
