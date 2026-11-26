// The keys of a tab list: the arrow keys, Home, and End move to another tab and open it, and only the open tab is in
// the Tab order, as in the kit windows' tab bars.
import type { KeyboardEvent } from 'react';

/** Where a key takes the tab at `index` among `count` tabs, or -1 for a key that is not a tab key. */
export function tabTarget(key: string, index: number, count: number): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  return key === 'End' ? count - 1 : -1;
}

/** The tab list's key handler: focuses the tab the key names and clicks it, so the panel follows the focus. */
export function moveBetweenTabs(event: KeyboardEvent<HTMLElement>): void {
  const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const at = tabs.findIndex((tab) => tab === (event.target as HTMLElement).closest('[role="tab"]'));
  if (at < 0) return;
  const to = tabTarget(event.key, at, tabs.length);
  if (to < 0) return;
  event.preventDefault();
  tabs[to]?.focus();
  tabs[to]?.click();
}
