// The announcer (ARCHITECTURE.md section 15.6) owns two live regions: one polite and one assertive. They carry
// changes a screen reader should hear. Assertive is for failures that stop the current action; everything else
// is polite. The same text within 500 ms is announced once. Tests read the log.
//
// Each announcement is a new element in its region, so text that repeats after the 500 ms window is read again,
// which changing the text of one element would not do.

import { useSyncExternalStore } from 'react';
import { visuallyHiddenClass } from './VisuallyHidden';

const DUPLICATE_MS = 500;

type Regions = Record<'polite' | 'assertive', { text: string; count: number }>;
const empty = (): Regions => ({ polite: { text: '', count: 0 }, assertive: { text: '', count: 0 } });

let regions = empty();
let log: string[] = [];
let last = { text: '', at: 0 };
const listeners = new Set<() => void>();

/** Adds to the log unless the same text was announced within the last 500 ms. False when it was a duplicate. */
function record(text: string): boolean {
  const now = Date.now();
  if (text === last.text && now - last.at < DUPLICATE_MS) return false;
  last = { text, at: now };
  log = [...log, text];
  return true;
}

export function announce(text: string, politeness: 'polite' | 'assertive' = 'polite'): void {
  if (!text || !record(text)) return;
  regions = { ...regions, [politeness]: { text, count: regions[politeness].count + 1 } };
  listeners.forEach((listener) => listener());
}

/**
 * Logs what a status region already says, such as a toast in the Notifications region. Tests then see it with
 * everything else announced, and no second live region repeats it.
 */
export function recordAnnouncement(text: string): void {
  if (text) record(text);
}

/** Everything announced since the last clear, oldest first. */
export function announcements(): readonly string[] {
  return log;
}

export function clearAnnouncements(): void {
  log = [];
  last = { text: '', at: 0 };
  regions = empty();
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The two live regions. The app renders it once. */
export function Announcer() {
  const current = useSyncExternalStore(subscribe, () => regions);
  return (
    <div className={visuallyHiddenClass} data-modal-exempt="">
      {(['polite', 'assertive'] as const).map((politeness) => (
        <div key={politeness} aria-live={politeness} aria-atomic="true">
          {current[politeness].text && <span key={current[politeness].count}>{current[politeness].text}</span>}
        </div>
      ))}
    </div>
  );
}
