// Recently used symbols, newest first, kept on this device. Storage that cannot be read or written leaves the list
// for this session only.
const KEY = 'opennote.tools.symbols.recent';
export const RECENT_LIMIT = 16;

let memory: string[] = [];

export function readRecent(): string[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as unknown;
    if (Array.isArray(saved))
      memory = saved.filter((one): one is string => typeof one === 'string').slice(0, RECENT_LIMIT);
  } catch {
    // Unreadable storage keeps what this session has.
  }
  return [...memory];
}

/** Puts `char` first, dropping an older copy and anything past the limit. */
export function pushRecent(char: string): string[] {
  memory = [char, ...readRecent().filter((one) => one !== char)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // The list stays in memory.
  }
  return [...memory];
}

export function resetRecent(): void {
  memory = [];
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
