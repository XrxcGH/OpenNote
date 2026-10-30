// What the kit remembers on this device: each tool's typed texts and the unit system. Reading and writing can fail
// (a private window, blocked storage); the tools then work as they do on a first visit.
const PREFIX = 'opennote.tools.kitDesign.';

export function load<T>(name: string, fallback: T): T {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
}

export function save(name: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // The tool keeps working; it just will not remember.
  }
}
