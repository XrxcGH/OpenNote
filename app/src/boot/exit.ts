// The interface's half of the exit handshake (ARCHITECTURE.md section 8.7). Rust holds every close and sends
// app://before-exit with the reason. This runs the registered beforeExit hooks in order, which flush the notes,
// flush device state, and later refuse while recording, and answers Rust. The first refusal keeps the window open
// and says why in a toast. A hook that throws is logged and doesn't keep the window open, because a bug must
// never trap someone in the app.

import { beforeExit } from '../registries';
import { enqueueToast } from '../state/toasts';
import { t } from '../strings/t';
import type { ExitReason, Platform, Unsubscribe } from '../platform/types';

/** Runs the hooks for a reason and answers Rust. */
export async function answerBeforeExit(platform: Platform, reason: ExitReason): Promise<void> {
  const hooks = [...beforeExit.list()].sort((a, b) => a.order - b.order);
  for (const hook of hooks) {
    try {
      const result = await hook.run(reason);
      if (!result.ok) {
        enqueueToast({ message: t(result.reason), tone: 'danger' });
        platform.lifecycle.exitReady(result);
        return;
      }
    } catch (error) {
      platform.log('error', `The before-exit hook ${hook.id} failed: ${String(error)}`);
    }
  }
  platform.lifecycle.exitReady({ ok: true });
}

/** Listens for Rust's exit request. Returns a function that stops listening. */
export function installExitHandshake(platform: Platform): Unsubscribe {
  return platform.lifecycle.onBeforeExit((reason) => void answerBeforeExit(platform, reason));
}
