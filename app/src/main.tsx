import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The layer order loads before any other style sheet, so every later @layer rule falls into place.
import './styles/layers.css';
import './theme/fonts';
import './theme/tokens.css';
import './styles.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
