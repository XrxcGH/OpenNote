// Shows a dialog in its own React root on the page, and resolves when it closes. The dialogs of this lane (Format
// Cells, Cell styles, Format as table) load on first use, as the rule manager does.
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export function showDialog(render: (close: () => void) => ReactNode): Promise<void> {
  const mount = document.body.appendChild(document.createElement('div'));
  const root = createRoot(mount);
  return new Promise((resolve) => {
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        mount.remove();
      });
      resolve();
    };
    root.render(render(close));
  });
}
