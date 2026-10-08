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
import { installExitHandshake } from './boot/exit';
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

const { platform, notes } = await startApp();

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
// A tool's own window is not the app's window: it neither answers the exit handshake nor reports first paint.
// The page and quick capture windows are the same.
if (!tool && !extra) {
  installExitHandshake(platform);
  reportFirstPaint(platform);
}
