// Shows a dialog from a command and resolves with what it chose. The dialog mounts in its own root and unmounts
// once it is done, as the Move to dialog does.

import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export function showDialog<T>(render: (done: (value: T) => void) => ReactNode): Promise<T> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise<T>((resolve) => {
    const finish = (value: T) => {
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
      resolve(value);
    };
    root.render(render(finish));
  });
}
