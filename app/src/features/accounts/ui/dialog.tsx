// Mounts a React tree for a dialog that a command opens, and unmounts it when it closes. The commands live in the
// start-up bundle, and the dialogs load on first use.
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/** Renders `render(close)` into the page. Resolves when `close` runs. */
export function openDialog(render: (close: () => void) => ReactNode): Promise<void> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      // Unmounting first returns focus before the caller's code after `await openDialog(...)` runs.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve();
    };
    root.render(render(close));
  });
}
