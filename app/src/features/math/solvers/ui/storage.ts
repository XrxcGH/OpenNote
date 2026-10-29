// What the solvers window remembers on this device: the open tab and each solver's inputs. It shares the tool
// windows' prefix in the browser's storage, so a solvers window of its own reads what the floating one saved. Reading
// and writing never throw: private windows and blocked storage just mean the solvers start fresh.
const PREFIX = 'opennote.tools.solvers.';

export function loadSaved<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

export function saveSaved(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // The solver keeps working; it just will not remember.
  }
}
