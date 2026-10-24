// Opens a dialog from code: a React root of its own that removes itself when the dialog closes. Several parts of
// on-device intelligence open from a command or a button and have nothing to mount into, so they share this.
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Renders what `render` returns in a new root and returns the function that closes it. `render` gets the same
 * function, so the dialog can close itself. Closing twice does nothing. Unmounting waits a tick, so focus goes back
 * to the opener before the caller moves it again.
 */
export function openModal(render: (close: () => void) => ReactElement): () => void {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  };
  root.render(render(close));
  return close;
}
