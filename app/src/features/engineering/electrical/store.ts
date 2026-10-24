// What the kit remembers on this device. It shares the tool windows' storage prefix, but is written here so the kit
// loads without the whole tools bundle. Reading and writing never throw: blocked storage just starts fresh.
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
    // The choice just isn't remembered.
  }
}

/** The event a tool raises to ask the open page to take what it made; the page's insert handler answers it. */
const INSERT_EVENT = 'opennote:insert-into-page';

/** Asks the page to take something the kit made, and says whether it did. */
export function insertIntoPage(detail: Omit<import('../../tools').InsertDetail, 'handled'>): boolean {
  const request: import('../../tools').InsertDetail = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: request }));
  return request.handled;
}
