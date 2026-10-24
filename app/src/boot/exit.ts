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

/**
 * Says in a toast why the window stays open. Closing anyway starts the refused close again, and the hook lets it
 * through. Rust knows what this window refused: the app's exit, which may have begun in another window, or this
 * window's own close. Closing just this window would leave the app open after a refused exit.
 */
function explainRefusal(platform: Platform, refusal: Refusal): void {
  const { closeAnyway } = refusal;
  const action = closeAnyway && {
    label: t('common.closeAnyway'),
    run() {
      closeAnyway();
      platform.lifecycle.closeAnyway();
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

/** What a window shows: the app, a page or quick capture beside it, or a tool popped out of it. */
export type WindowKind = 'main' | 'page' | 'capture' | 'tool';

/**
 * Joins this window to the exit handshake. Every window that edits pages answers it: Rust asks all of them when
 * the app exits, and a page or quick capture window alone when it closes, so the typing it hasn't sent yet is
 * saved first. The main window tells Rust it listens with its first paint (reportFirstPaint); the others say so at
 * once. A tool window keeps its state in browser storage and has nothing to save.
 */
export function joinExitHandshake(platform: Platform, kind: WindowKind): Unsubscribe | null {
  if (kind === 'tool') return null;
  const stop = installExitHandshake(platform);
  if (kind !== 'main') platform.lifecycle.firstPaint();
  return stop;
}
