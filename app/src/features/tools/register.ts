// The tools' start-up registrations: the timer chip in the title bar, and the watcher that tells a person a timer
// has finished. A timer that was running when the app last closed is picked up here, so the chip and the watcher
// are there before the Timers window is ever opened. Nothing loads when no timer was left running.
import { titleBarItems } from '../../registries';
import { TimerChip } from './TimerChip';

titleBarItems.register({
  id: 'tools.timerChip',
  side: 'end',
  order: 80,
  priority: 70,
  compact: 'appBar',
  Component: TimerChip,
});

// Due dates from every notebook: a few seconds after start-up the index is asked for the open checkboxes and tagged
// lines, and Upcoming lists the ones with dates. Tool windows of their own leave this to the main window.
if (typeof window !== 'undefined' && !(window as { __OPENNOTE_TOOL__?: string }).__OPENNOTE_TOOL__) {
  void Promise.all([import('./ui/pageScan'), import('../search'), import('../page')]).then(([scan, search, page]) => {
    scan.startPageScan(search.maybeSearchClient, () => page.shownMounted.get()?.page.id ?? null);
  });
}

function hasRunningTimer(): boolean {
  try {
    const saved = JSON.parse(window.localStorage.getItem('opennote.tools.timers') ?? 'null') as {
      timers?: { status?: string }[];
    } | null;
    return Array.isArray(saved?.timers) && saved.timers.some((timer) => timer?.status === 'running');
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined' && hasRunningTimer()) {
  void import('./ui/timerSet').then((module) => module.timersForWindow());
}
