// The table whose fill the Fill series commands run: the pointer layer that had focus last. A light module, so the
// commands can ask it at start-up without loading the layer's code.
export interface PointerRunner {
  /** Fills the selection as a series, down from its first row or right from its first column. */
  fillSeries(direction: 'down' | 'right'): void;
}

let current: PointerRunner | null = null;

export const activePointer = (): PointerRunner | null => current;
export const setActivePointer = (runner: PointerRunner): void => {
  current = runner;
};
export const clearActivePointer = (runner: PointerRunner): void => {
  if (current === runner) current = null;
};
