// The app lifecycle: the first paint, ready, and the exit handshake (app://before-exit, then app_exit_ready).

import type { LifecycleClient } from '../types';
import { fire, listen } from './invoke';

export function createTauriLifecycle(): LifecycleClient {
  return {
    firstPaint: () => fire('app_first_paint'),
    ready: (timings) => fire('app_ready', { timings }),
    // Rust asks each window on its own, when the app exits and when that window closes, so a window hears only
    // what is sent to it: the main window mustn't answer a page window's close.
    onBeforeExit: (listener) => listen('app://before-exit', listener, true),
    exitReady: (result) => fire('app_exit_ready', { result }),
  };
}
