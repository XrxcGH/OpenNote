// The layer order loads before any other style sheet, so every later @layer rule falls into place.
import './styles/layers.css';
import './theme/fonts';
import './theme/tokens.css';
import './styles/base.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RootBoundary } from './app/RootBoundary';
import { startApp } from './app/start';
import { joinExitHandshake } from './boot/exit';
import { reportFirstPaint } from './boot/marks';
import { PageWindow } from './features/qol';
import { QuickCapture } from './features/quickCapture';
import { NotesProvider } from './services/notes';

// A tool popped out into a window of its own (?tool=timers) shows that tool and nothing else.
const tool =
  new URLSearchParams(location.search).get('tool') ??
  (window as { __OPENNOTE_TOOL__?: string }).__OPENNOTE_TOOL__ ??
  null;
const PoppedTool = lazy(() => import('./features/tools').then((loaded) => ({ default: loaded.PoppedTool })));

// A page in a window of its own, or the quick capture window, names itself in the script the shell adds.
const extra = (window as { __OPENNOTE_WINDOW__?: { kind?: string } }).__OPENNOTE_WINDOW__?.kind ?? null;

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const kind = tool ? 'tool' : extra === 'page' || extra === 'capture' ? extra : 'main';
// Only the main window asks the start-up questions (safe start, consent); a window beside it never repeats them.
const { platform, notes } = await startApp({ main: kind === 'main' });

createRoot(root).render(
  <StrictMode>
    {tool ? (
      <Suspense fallback={null}>
        <PoppedTool tool={tool} />
      </Suspense>
    ) : extra === 'page' || extra === 'capture' ? (
      <RootBoundary platform={platform}>
        <NotesProvider service={notes}>
          <Suspense fallback={null}>{extra === 'page' ? <PageWindow /> : <QuickCapture />}</Suspense>
        </NotesProvider>
      </RootBoundary>
    ) : (
      <RootBoundary platform={platform}>
        <NotesProvider service={notes}>
          <App />
        </NotesProvider>
      </RootBoundary>
    )}
  </StrictMode>,
);
// Every window that edits pages answers the exit handshake, so closing it or the app saves its typing first. Only
// the main window reports its first paint; a tool's own window has nothing to save.
joinExitHandshake(platform, kind);
if (kind === 'main') reportFirstPaint(platform);
