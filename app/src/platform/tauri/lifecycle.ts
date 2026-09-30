// The app lifecycle: the first paint, ready, and the exit handshake (app://before-exit, then app_exit_ready).

import type { LifecycleClient } from '../types';
import { fire, listen } from './invoke';

export function createTauriLifecycle(): LifecycleClient {
  return {
    firstPaint: () => fire('app_first_paint'),
    ready: (timings) => fire('app_ready', { timings }),
    onBeforeExit: (listener) => listen('app://before-exit', listener),
    exitReady: (result) => fire('app_exit_ready', { result }),
  };
}
