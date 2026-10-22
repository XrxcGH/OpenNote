// The pane solver (ARCHITECTURE.md section 11.2): a pure function from the window width, the size class, and the
// person's pane preferences to the widths the workspace uses. Stored widths are the person's choice; the solver
// clamps them for the current window and never writes them back, so a narrow window never loses a preference.

import type { PanePref } from '../../platform/types';
import type { SizeClass } from '../../state/layout';
import { AUTO_PANE_WIDTH } from '../../state/session';
import { tokens } from '../../theme/tokens';

export type PaneId = 'notebooks' | 'pages';

export interface PanePrefs {
  notebooks: PanePref;
  pages: PanePref;
}

/**
 * - pane: a column of `width`.
 * - rail: a 48 px column with the pane's buttons; the pane is collapsed.
 * - drawer (medium notebooks) and overlay (expanded pages): the pane opens over the page, `width` wide, from a
 *   48 px rail.
 * - screen (compact): one pane at a time, the whole width.
 */
export interface PaneLayout {
  notebooks: { mode: 'pane' | 'rail' | 'drawer' | 'screen'; width: number };
  pages: { mode: 'pane' | 'rail' | 'overlay' | 'screen'; width: number };
  page: { width: number };
}

const SIZE = tokens.size;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The limits of each resizable pane, from the design tokens. `default` is the widest the automatic width gets;
 * `share` is the part of the window it takes until then, never below `min`.
 */
export const PANE_LIMITS: Readonly<Record<PaneId, { min: number; max: number; default: number; share: number }>> = {
  notebooks: { min: SIZE.sidebarMin, max: SIZE.sidebarMax, default: SIZE.sidebar, share: 0.14 },
  pages: { min: SIZE.pageListMin, max: SIZE.pageListMax, default: SIZE.pageList, share: 0.16 },
};

/** The fixed defaults earlier versions stored for every pane, before the default followed the window. */
const LEGACY_DEFAULTS: Readonly<Record<PaneId, number>> = { notebooks: 272, pages: 300 };

/** Whether a stored width is the automatic one rather than a width the person chose by resizing. */
export function isAutoWidth(pane: PaneId, width: number): boolean {
  return !Number.isFinite(width) || width <= AUTO_PANE_WIDTH || width === LEGACY_DEFAULTS[pane];
}

/**
 * How to store a width the person chose. A chosen width that happens to equal a legacy default is kept a quarter
 * pixel off it, so it still reads as chosen and still rounds to the same pixel.
 */
export function chosenWidth(pane: PaneId, width: number): number {
  return width === LEGACY_DEFAULTS[pane] ? width - 0.25 : width;
}

/** The automatic width: a share of the window, between the pane's minimum and its default. */
export function defaultPaneWidth(pane: PaneId, windowWidth: number): number {
  const { min, default: widest, share } = PANE_LIMITS[pane];
  return Math.round(clamp(windowWidth * share, min, widest));
}

/** The medium drawer's widest size and its share of the window. */
const DRAWER_MAX = 320;
const DRAWER_SHARE = 0.85;
/** The medium pages pane's share of the window. */
const MEDIUM_PAGES_SHARE = 0.4;


/** A stored width, clamped to the pane's limits. The automatic width, or anything not a number, follows the window. */
export function clampPaneWidth(pane: PaneId, width: number, windowWidth: number): number {
  const { min, max } = PANE_LIMITS[pane];
  return isAutoWidth(pane, width) ? defaultPaneWidth(pane, windowWidth) : Math.round(clamp(width, min, max));
}

/** How wide a pane's grid column is: its width as a pane, else the rail. Screens take the whole row. */
export function columnWidth(pane: PaneLayout['notebooks'] | PaneLayout['pages']): number {
  return pane.mode === 'pane' ? pane.width : SIZE.rail;
}

function compact(width: number): PaneLayout {
  return {
    notebooks: { mode: 'screen', width },
    pages: { mode: 'screen', width },
    page: { width },
  };
}

function medium(width: number, prefs: PanePrefs): PaneLayout {
  const drawer = Math.min(DRAWER_MAX, Math.floor(width * DRAWER_SHARE));
  const pages = clamp(Math.round(width * MEDIUM_PAGES_SHARE), SIZE.pageListMin, SIZE.pageList);
  const pagesColumn = prefs.pages.collapsed ? SIZE.rail : pages;
  return {
    notebooks: { mode: 'drawer', width: drawer },
    pages: prefs.pages.collapsed ? { mode: 'rail', width: SIZE.rail } : { mode: 'pane', width: pages },
    page: { width: Math.max(0, width - SIZE.rail - pagesColumn) },
  };
}

function expanded(width: number, prefs: PanePrefs): PaneLayout {
  const room = width - SIZE.rail - SIZE.editorMin;
  const notebooks = prefs.notebooks.collapsed
    ? SIZE.rail
    : Math.max(SIZE.sidebarMin, Math.min(clampPaneWidth('notebooks', prefs.notebooks.width, width), room));
  const overlay = Math.max(0, Math.min(clampPaneWidth('pages', prefs.pages.width, width), width - notebooks));
  return {
    notebooks: prefs.notebooks.collapsed ? { mode: 'rail', width: SIZE.rail } : { mode: 'pane', width: notebooks },
    pages: { mode: 'overlay', width: overlay },
    page: { width: Math.max(0, width - notebooks - SIZE.rail) },
  };
}

/** Shrinks the pages pane toward its minimum first, then the notebooks pane, until the page has 480. */
function fitWide(width: number, notebooks: number | null, pages: number | null) {
  const columns = () => (notebooks ?? SIZE.rail) + (pages ?? SIZE.rail);
  let short = SIZE.editorMin - (width - columns());
  if (short > 0 && pages !== null) {
    const give = Math.min(short, pages - SIZE.pageListMin);
    pages -= give;
    short -= give;
  }
  if (short > 0 && notebooks !== null) {
    notebooks -= Math.min(short, notebooks - SIZE.sidebarMin);
  }
  // Both at their minimum always fit at 1,200 (220 + 240 + 480); if a token change breaks that, the pages pane
  // becomes a rail for now, without touching the saved preference.
  if (width - columns() < SIZE.editorMin && pages !== null) pages = null;
  return { notebooks, pages };
}

function wide(width: number, prefs: PanePrefs): PaneLayout {
  const fitted = fitWide(
    width,
    prefs.notebooks.collapsed ? null : clampPaneWidth('notebooks', prefs.notebooks.width, width),
    prefs.pages.collapsed ? null : clampPaneWidth('pages', prefs.pages.width, width),
  );
  const notebooks = fitted.notebooks ?? SIZE.rail;
  const pages = fitted.pages ?? SIZE.rail;
  return {
    notebooks: fitted.notebooks === null ? { mode: 'rail', width: SIZE.rail } : { mode: 'pane', width: notebooks },
    pages: fitted.pages === null ? { mode: 'rail', width: SIZE.rail } : { mode: 'pane', width: pages },
    page: { width: Math.max(0, width - notebooks - pages) },
  };
}

export function solvePanes(windowWidth: number, sizeClass: SizeClass, prefs: PanePrefs): PaneLayout {
  const width = Math.max(0, Math.round(windowWidth));
  if (sizeClass === 'compact') return compact(width);
  if (sizeClass === 'medium') return medium(width, prefs);
  if (sizeClass === 'expanded') return expanded(width, prefs);
  return wide(width, prefs);
}

/** How much room the other column takes while this pane grows, as the solver would give it. */
function otherColumn(pane: PaneId, sizeClass: SizeClass, prefs: PanePrefs, width: number): number {
  if (sizeClass === 'expanded') {
    return pane === 'notebooks' || prefs.notebooks.collapsed
      ? SIZE.rail
      : clampPaneWidth('notebooks', prefs.notebooks.width, width);
  }
  // In the wide layout the pages pane gives way first, down to its minimum.
  if (pane === 'notebooks') return prefs.pages.collapsed ? SIZE.rail : SIZE.pageListMin;
  return prefs.notebooks.collapsed ? SIZE.rail : clampPaneWidth('notebooks', prefs.notebooks.width, width);
}

/**
 * The widths a pane can take now: its token limits, and in the wide and expanded layouts no wider than leaves the
 * page 480 (the expanded pages overlay covers the page, so it only has to fit the window). Splitters and the
 * resize commands use these bounds.
 */
export function paneBounds(
  pane: PaneId,
  windowWidth: number,
  sizeClass: SizeClass,
  prefs: PanePrefs,
): { min: number; max: number } {
  const { min, max } = PANE_LIMITS[pane];
  if (sizeClass !== 'wide' && sizeClass !== 'expanded') return { min, max };
  const other = otherColumn(pane, sizeClass, prefs, windowWidth);
  const overlay = sizeClass === 'expanded' && pane === 'pages';
  const room = overlay ? windowWidth - other : windowWidth - other - SIZE.editorMin;
  return { min, max: Math.max(min, Math.min(max, room)) };
}
