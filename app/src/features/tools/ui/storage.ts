// What the tools remember on this device: timers, calculator history, upcoming items, and where each window sits.
// It lives in the browser's storage for the app, which belongs to this device and this person. Reading and writing
// never throw: private windows and blocked storage just mean the tools start fresh.
const PREFIX = 'opennote.tools.';

export function loadStored<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

export function saveStored(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // Nothing to do: the tool keeps working, it just will not remember.
  }
}

/**
 * Calls `changed` when another window of the app writes `name`. The tool windows and the main window share this
 * storage, so each re-reads what the other saved rather than writing its older copy over it.
 */
export function watchStored(name: string, changed: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listen = (event: StorageEvent) => {
    if (event.key === PREFIX + name || event.key === null) changed();
  };
  window.addEventListener('storage', listen);
  return () => window.removeEventListener('storage', listen);
}

export function forgetStored(name: string): void {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    // Same as above.
  }
}
