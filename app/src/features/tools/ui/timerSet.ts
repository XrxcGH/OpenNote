// The one set of timers for this window, restored from the device and saved after every change. A window that opens
// later, or another window of the app, follows the saved set, so a timer started in a tool window shows in the title
// bar chip and the other way round. The watcher that notices a finished timer starts with the set.
import { createTimers, restoreTimerSet, systemClock } from '../timers';
import type { TimerView, Timers } from '../timers';
import { timerChip } from './chipStore';
import type { ChipReading } from './chipStore';
import { loadStored, saveStored, storedKey } from './storage';
import { watchTimers } from './timerWatch';

const STORE = 'timers';
let shared: Timers | null = null;

/** Hours, minutes, and seconds: 1:05:09, or 5:09 under an hour. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

export const stopwatchText = (ms: number): string => clockText(Math.floor(ms / 1000) * 1000);

/** What the chip shows for the views: the timer that ends first, or the stopwatch when only stopwatches run. */
export function chipReading(views: readonly TimerView[]): ChipReading | null {
  const running = views.filter((view) => view.status === 'running');
  if (running.length === 0) return null;
  const counting = running.filter((view) => view.leftMs !== null);
  const first = [...counting].sort((a, b) => (a.leftMs ?? 0) - (b.leftMs ?? 0))[0] ?? running[0];
  return {
    label: first.label,
    text: first.leftMs === null ? stopwatchText(first.elapsedMs) : clockText(first.leftMs),
    count: running.length,
  };
}

/** The set of timers for this window. The first call restores it and starts the watcher. */
export function timersForWindow(): Timers {
  if (shared) return shared;
  const timers = createTimers(systemClock(), restoreTimerSet(loadStored(STORE, null)));
  shared = timers;
  timers.subscribe(() => {
    const snapshot = timers.snapshot();
    if (JSON.stringify(snapshot) !== JSON.stringify(loadStored(STORE, null))) saveStored(STORE, snapshot);
    timerChip.set({ read: () => chipReading(timers.views()) });
  });
  timerChip.set({ read: () => chipReading(timers.views()) });
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== storedKey(STORE) || event.newValue === null) return;
      try {
        timers.load(restoreTimerSet(JSON.parse(event.newValue)));
      } catch {
        // A damaged value from another window is left alone.
      }
    });
  }
  watchTimers(timers);
  return timers;
}
