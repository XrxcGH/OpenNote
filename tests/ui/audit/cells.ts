// The matrix the layout audit runs: three window sizes, both themes, and both densities, with a device scale
// factor of 2. A "cell" is one combination; a test opens the app once in a cell and visits many surfaces in it.

export const SIZES = [
  { id: 'w1280', width: 1280, height: 800 },
  { id: 'w820', width: 820, height: 620 },
  { id: 'w2560', width: 2560, height: 1600 },
] as const;
export const THEMES = ['light', 'dark'] as const;
export const DENSITIES = ['mouse', 'touch'] as const;

export interface Cell {
  size: (typeof SIZES)[number];
  theme: (typeof THEMES)[number];
  density: (typeof DENSITIES)[number];
}

export const CELLS: Cell[] = SIZES.flatMap((size) =>
  THEMES.flatMap((theme) => DENSITIES.map((density) => ({ size, theme, density }))),
);

export const cellName = (cell: Cell): string => `${cell.size.id} ${cell.theme} ${cell.density}`;

/** The cells that also sweep every command, because a sweep is the slow part: one of each size, theme, and density. */
export const SWEEP_CELLS = new Set(['w1280 light mouse', 'w820 dark touch', 'w2560 dark mouse']);

/**
 * The cells a run covers: all 12 by default, and the three sweep cells (which between them hold every size, theme, and
 * density) in CI, where the run has to be short. OPENNOTE_AUDIT_CELLS=all or =sweep overrides either way.
 */
export function activeCells(): Cell[] {
  const choice = process.env.OPENNOTE_AUDIT_CELLS ?? (process.env.CI ? 'sweep' : 'all');
  return choice === 'sweep' ? CELLS.filter((cell) => SWEEP_CELLS.has(cellName(cell))) : CELLS;
}

/** A surface name safe for a file name and stable across runs. */
export const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
