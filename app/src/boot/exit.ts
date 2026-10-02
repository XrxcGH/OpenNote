// The interface's half of the exit handshake (ARCHITECTURE.md section 8.7). Rust holds every close and sends
// app://before-exit with the reason. This runs the registered beforeExit hooks in order, which flush the notes,
// flush device state, and later refuse while recording, and answers Rust. The first refusal keeps the window open
// and says why in a toast, with a "Close anyway" action when the hook offers one. A hook that throws is logged and
// doesn't keep the window open, because a bug must never trap someone in the app.

import { beforeExit } from '../registries';
import type { BeforeExitAnswer } from '../registries/types';
import { enqueueToast } from '../state/toasts';
import { t } from '../strings/t';
import type { ExitReason, Platform, Unsubscribe } from '../platform/types';

type Refusal = Extract<BeforeExitAnswer, { ok: false }>;

/** Says in a toast why the window stays open. Closing anyway starts a new close, and the hook lets it through. */
function explainRefusal(platform: Platform, refusal: Refusal): void {
  const { closeAnyway } = refusal;
  const action = closeAnyway && {
    label: t('common.closeAnyway'),
    run() {
      closeAnyway();
      platform.window.close();
    },
  };
  enqueueToast({ id: 'exit.refused', message: refusal.message ?? t(refusal.reason), tone: 'danger', action });
}

/** Runs the hooks for a reason and answers Rust. */
export async function answerBeforeExit(platform: Platform, reason: ExitReason): Promise<void> {
  const hooks = [...beforeExit.list()].sort((a, b) => a.order - b.order);
  for (const hook of hooks) {
    try {
      const result = await hook.run(reason);
      if (!result.ok) {
        explainRefusal(platform, result);
        platform.lifecycle.exitReady({ ok: false, reason: result.reason });
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
