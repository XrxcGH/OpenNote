// Notices when a timer finishes, whether or not the Timers window is open. It says so politely to a screen reader,
// and shows a Windows notification only for a timer the person asked one for. Each finish is told once: the key of a
// finish is kept on this device, so a second window of the app does not tell it again, and a timer that ended before
// the app started is not told about at all.
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import type { TimerView, Timers } from '../timers';
import { showNotice } from './notify';
import { loadStored, saveStored } from './storage';

const TOLD = 'timers.told';
/** The longest a wake-up is put off, so a timer set far ahead still checks in now and then. */
const LONGEST_WAIT = 30_000;

const keyOf = (view: TimerView): string => `${view.id}@${view.finishedAt ?? 0}`;

function told(): string[] {
  const list = loadStored<unknown>(TOLD, []);
  return Array.isArray(list) ? list.filter((one): one is string => typeof one === 'string') : [];
}

/** Marks a finish as told. Returns false when it already was, here or in another window. */
function claim(key: string): boolean {
  const list = told();
  if (list.includes(key)) return false;
  saveStored(TOLD, [...list, key].slice(-100));
  return true;
}

/** Watches a set of timers. Returns a function that stops. */
export function watchTimers(timers: Timers, now: () => number = Date.now): () => void {
  const seen = new Set<string>(
    timers
      .views()
      .filter((view) => view.status === 'done')
      .map(keyOf),
  );
  let wake: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    for (const view of timers.views()) {
      if (view.status !== 'done') continue;
      const key = keyOf(view);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!claim(key)) continue;
      announce(t('smart.tools.timers.finished', { name: view.label }));
      if (view.notify) showNotice(t('study.reminders.timer'), view.label);
    }
  };

  const schedule = () => {
    clearTimeout(wake);
    const next = timers.nextWake();
    if (next === null) return;
    wake = setTimeout(
      () => {
        check();
        schedule();
      },
      Math.min(LONGEST_WAIT, Math.max(50, next - now() + 50)),
    );
  };

  const stopListening = timers.subscribe(() => {
    check();
    schedule();
  });
  const onVisible = () => {
    check();
    schedule();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  schedule();
  return () => {
    clearTimeout(wake);
    stopListening();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}
