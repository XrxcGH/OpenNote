// Draw border and Erase border are modes of the pointer, not of one table: the command turns one on, and the
// next stroke in any table with spreadsheet keys draws or erases. Escape, or the same command again, turns it off.
export type BorderMode = 'off' | 'draw' | 'erase';

let mode: BorderMode = 'off';
const listeners = new Set<(mode: BorderMode) => void>();

export const borderMode = (): BorderMode => mode;

export function setBorderMode(next: BorderMode): void {
  if (next === mode) return;
  mode = next;
  listeners.forEach((listen) => listen(next));
}

/** Runs `listen` whenever the mode changes. Returns the function that stops. */
export function onBorderMode(listen: (mode: BorderMode) => void): () => void {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

/** The command's way: the same mode again turns it off. */
export const toggleBorderMode = (next: Exclude<BorderMode, 'off'>): void => setBorderMode(mode === next ? 'off' : next);
