// The switch behind Show formatting marks, kept apart from the extension (invisibles.ts) so the command in
// features/page can read and flip it at start-up without pulling the editor kit into the first load.

let marksOn = false;
const listeners = new Set<() => void>();

/**
 * Whether formatting marks show. One switch for every editor, like Word's button. The editor layer keeps its own tiny
 * store, because it may not import the app's state; the command in features/page reads and flips it.
 */
export const formattingMarks = {
  get: (): boolean => marksOn,
  set(next: boolean | ((before: boolean) => boolean)): void {
    const value = typeof next === 'function' ? next(marksOn) : next;
    if (value === marksOn) return;
    marksOn = value;
    for (const listener of [...listeners]) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
