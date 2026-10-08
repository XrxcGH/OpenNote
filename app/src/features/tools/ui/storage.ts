// What the tools remember on this device: timers, calculator history, upcoming items, and where each window sits.
// It lives in the browser's storage for the app, which belongs to this device and this person. Reading and writing
// never throw: private windows and blocked storage just mean the tools start fresh.
const PREFIX = 'opennote.tools.';

/** The key a name is saved under, which a window's storage event names. */
export const storedKey = (name: string): string => PREFIX + name;

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

export function forgetStored(name: string): void {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    // Same as above.
  }
}
