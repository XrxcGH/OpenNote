// The layer order loads before any other style sheet, so every later @layer rule falls into place.
import './styles/layers.css';
import './theme/fonts';
import './theme/tokens.css';
import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startApp } from './app/start';
import { NotesProvider } from './services/notes';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const { notes } = await startApp();

createRoot(root).render(
  <StrictMode>
    <NotesProvider service={notes}>
      <App />
    </NotesProvider>
  </StrictMode>,
);
