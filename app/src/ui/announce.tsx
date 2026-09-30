// The announcer (ARCHITECTURE.md section 15.6) owns two live regions: one polite and one assertive. They carry
// changes a screen reader should hear. The same text within 500 ms is announced once. Tests read the log.

import { useSyncExternalStore } from 'react';
import styles from './controls.module.css';

const DUPLICATE_MS = 500;

let regions = { polite: '', assertive: '' };
let log: string[] = [];
let last = { text: '', at: 0 };
const listeners = new Set<() => void>();

export function announce(text: string, politeness: 'polite' | 'assertive' = 'polite'): void {
  const now = Date.now();
  if (text === last.text && now - last.at < DUPLICATE_MS) return;
  last = { text, at: now };
  log = [...log, text];
  regions = { ...regions, [politeness]: text };
  listeners.forEach((listener) => listener());
}

/** Everything announced since the last clear, oldest first. */
export function announcements(): readonly string[] {
  return log;
}

export function clearAnnouncements(): void {
  log = [];
  last = { text: '', at: 0 };
  regions = { polite: '', assertive: '' };
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
    <div className={styles.visuallyHidden} data-modal-exempt="">
      <div aria-live="polite" aria-atomic="true">
        {current.polite}
      </div>
      <div aria-live="assertive" aria-atomic="true">
        {current.assertive}
      </div>
    </div>
  );
}
