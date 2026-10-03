// The screenshot matrix (ARCHITECTURE.md section 21.4): every screen state, at every size class, in both themes.
// This file plans the matrix and has no Playwright code, so a plain Node test can check it. The spec that takes
// the pictures is visual/matrix.spec.ts. A package adds screens in tests/ui/screens/<area>.ts and they join the
// matrix by themselves; nothing here lists them.
//
// Environment variables narrow a run while a screen is being built:
//   OPENNOTE_MATRIX_SCREENS  ids or id prefixes ending in a dot, such as "settings." or "palette.commands"
//   OPENNOTE_MATRIX_SIZES    size classes, such as "compact,wide"
//   OPENNOTE_MATRIX_THEMES   themes, such as "dark"

import type { ScreenState, SizeClass, Theme } from './screens.ts';

export const SIZES: readonly SizeClass[] = ['compact', 'medium', 'expanded', 'wide'];
export const THEMES: readonly Theme[] = ['light', 'dark'];

/** What to keep. A missing list keeps everything. */
export interface MatrixFilter {
  screens?: readonly string[];
  sizes?: readonly SizeClass[];
  themes?: readonly Theme[];
}

/** One picture: a screen state at a size and in a theme. */
export interface Cell {
  screen: ScreenState;
  size: SizeClass;
  theme: Theme;
  /** The picture's name, such as "settings.general.compact.dark". It is also the baseline's file name. */
  name: string;
}

export function cellName(id: string, size: SizeClass, theme: Theme): string {
  return `${id}.${size}.${theme}`;
}

function list(value: string | undefined): string[] | undefined {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** Reads the filter from the environment. A size or theme that does not exist is an error, so a typo never hides a screen. */
export function parseFilter(env: Record<string, string | undefined>): MatrixFilter {
  const sizes = list(env.OPENNOTE_MATRIX_SIZES);
  const themes = list(env.OPENNOTE_MATRIX_THEMES);
  const unknownSize = sizes?.find((size) => !(SIZES as readonly string[]).includes(size));
  const unknownTheme = themes?.find((theme) => !(THEMES as readonly string[]).includes(theme));
  if (unknownSize) throw new Error(`OPENNOTE_MATRIX_SIZES: "${unknownSize}" is not one of ${SIZES.join(', ')}.`);
  if (unknownTheme) throw new Error(`OPENNOTE_MATRIX_THEMES: "${unknownTheme}" is not one of ${THEMES.join(', ')}.`);
  return {
    screens: list(env.OPENNOTE_MATRIX_SCREENS),
    sizes: sizes as SizeClass[] | undefined,
    themes: themes as Theme[] | undefined,
  };
}

/** Whether a screen id is named by a filter entry: the whole id, or a prefix that ends in a dot. */
export function matchesScreen(id: string, entry: string): boolean {
  return entry.endsWith('.') ? id.startsWith(entry) : id === entry;
}

/** Every cell of the matrix, in screen order, then size, then theme. */
export function matrixCells(screens: readonly ScreenState[], filter: MatrixFilter = {}): Cell[] {
  const cells: Cell[] = [];
  for (const screen of screens) {
    if (filter.screens && !filter.screens.some((entry) => matchesScreen(screen.id, entry))) continue;
    for (const size of screen.sizes ?? SIZES) {
      if (filter.sizes && !filter.sizes.includes(size)) continue;
      for (const theme of screen.themes ?? THEMES) {
        if (filter.themes && !filter.themes.includes(theme)) continue;
        cells.push({ screen, size, theme, name: cellName(screen.id, size, theme) });
      }
    }
  }
  const names = cells.map((cell) => cell.name);
  const repeated = names.filter((name, i) => names.indexOf(name) !== i);
  if (repeated.length > 0) throw new Error(`Two pictures have the same name: ${[...new Set(repeated)].join(', ')}.`);
  return cells;
}

/** A line for the report: how many pictures, from how many screens. */
export function describeMatrix(cells: readonly Cell[]): string {
  const screens = new Set(cells.map((cell) => cell.screen.id)).size;
  return `${cells.length} pictures from ${screens} screen ${screens === 1 ? 'state' : 'states'}`;
}

/**
 * Whether a picture with no baseline should be skipped. A missing baseline fails a normal run, but baselines come
 * only from the update-screenshots workflow, so until it has run, the run skips the picture and says why. Updating
 * never skips.
 */
export function skipWithoutBaseline(updateSnapshots: string, baselineExists: boolean): boolean {
  return !baselineExists && (updateSnapshots === 'missing' || updateSnapshots === 'none');
}
