// Opens the diagnostics dialogs from anywhere: a command, a Settings button, or start-up. Each dialog gets its own
// React root, as confirm() does, so the opener needs no host component in the app tree. This module loads on
// first use, so none of it costs start-up time.

import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ConsentFlow } from './consent';
import { ConsentDialog } from './ConsentDialog';
import { FeedbackDialog } from './FeedbackDialog';
import { ReviewDialog } from './ReviewDialog';
import { SafeStartDialog } from './SafeStartDialog';
import type { SafeStartFlow } from './safeStart';

function mount(render: (close: () => void) => ReactElement): void {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    // Unmounting first returns focus before the caller's code runs.
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  };
  root.render(render(close));
}

export function mountConsent(reason: ConsentFlow['reason']): void {
  mount((close) => <ConsentDialog reason={reason} onClose={close} />);
}

export function mountReview(id: string): void {
  mount((close) => <ReviewDialog id={id} onClose={close} />);
}

export function mountFeedback(): void {
  mount((close) => <FeedbackDialog onClose={close} />);
}

/** Resolves with the person's choice. */
export function mountSafeStart(flow: SafeStartFlow): Promise<'safe' | 'normal'> {
  return new Promise((resolve) => {
    mount((close) => (
      <SafeStartDialog
        flow={flow}
        onChoose={(result) => {
          close();
          resolve(result);
        }}
      />
    ));
  });
}
