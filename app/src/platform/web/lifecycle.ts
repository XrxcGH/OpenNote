// The lifecycle client in a browser. A test can ask to close the app with the requestExit hook, which runs the
// exit handshake as Rust would and resolves with the front end's answer.

import type { ExitReason, ExitResult, LifecycleClient, ReadyTimings } from '../types';
import { emitter } from './emitter';
import { registerTestHook } from './testHooks';

export interface WebLifecycle extends LifecycleClient {
  requestExit(reason: ExitReason): Promise<ExitResult>;
  readonly timings: { firstPaint: boolean; ready: ReadyTimings | null };
}

export function createWebLifecycle(): WebLifecycle {
  const beforeExit = emitter<[ExitReason]>();
  const timings: WebLifecycle['timings'] = { firstPaint: false, ready: null };
  let answer: ((result: ExitResult) => void) | null = null;
  const lifecycle: WebLifecycle = {
    timings,
    firstPaint: () => void (timings.firstPaint = true),
    ready: (next) => void (timings.ready = next),
    onBeforeExit: beforeExit.on,
    exitReady(result) {
      answer?.(result);
      answer = null;
    },
    // A browser tab is the only window, so what it refused is the app's exit.
    closeAnyway: () => void lifecycle.requestExit('close'),
    requestExit(reason) {
      return new Promise((resolve) => {
        answer = resolve;
        beforeExit.emit(reason);
      });
    },
  };
  registerTestHook('requestExit', lifecycle.requestExit);
  registerTestHook('readyTimings', () => timings);
  return lifecycle;
}
