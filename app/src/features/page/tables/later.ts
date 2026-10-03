// Loads a module in idle time after start-up (owner: WP6). Registrations load at start-up, so commands that only
// apply inside a table or a code block register from their own chunk, which this loads once the app is idle. The
// chunk that needs them first, such as the table block's, imports them too.
export function later(load: () => Promise<unknown>): void {
  if (typeof window === 'undefined') return;
  const run = () => void load();
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2000 });
  else window.setTimeout(run, 1);
}
