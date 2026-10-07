// The paper generator: a page's background becomes SVG path data for one sheet, or for one tile of the infinite
// canvas. Patterns fill the content box and ruled lines span the sheet's width, so the margins stay visibly blank.
// Infinite view draws the same patterns without breaks, in step with sheet 0, so no line jumps when the view changes.

import { below, intersect, linesArea, UNBOUNDED, type PaperLattice } from '../../../core/paperLattice';
import { own } from '../layout/json';
import { contentBox, EPS, sheetAt, type Rect, type SheetGeometry } from '../pagination/geometry';
import { dots, grid, isometric, ruled, staves } from './basic';
import { Canvas, wholeCells } from './canvas';
import { cornell, cornellAreas } from './cornell';
import { drawTemplate } from './template';
import type { PageBackground, PaperPaths } from './types';

/** The spacing a page has when it doesn't say: 7 mm college ruling. */
export const DEFAULT_SPACING = 26.46;

const SPACING_LIMITS: Readonly<Record<string, readonly [number, number]>> = {
  ruled: [12, 96],
  grid: [8, 96],
  dots: [8, 96],
  isometric: [8, 96],
  cornell: [12, 96],
  staff: [4, 48],
};

/** The spacing to draw with: the page's own, kept within the range for its pattern, or the default. */
export function spacingOf(background: PageBackground): number {
  const [lo, hi] = own(SPACING_LIMITS, background.pattern) ?? [4, 200];
  const value = background.spacing;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, lo), hi) : DEFAULT_SPACING;
}

/** Paper that text sits on (see rules.ts). */
const TEXT_PAPER = new Set(['ruled', 'grid', 'dots']);

/**
 * The spacing to draw with and lay text out in. Paper that text sits on keeps its rules a whole number of page units
 * apart: a browser paints each line of text with its baseline on a whole unit, so rules a fraction of a unit apart
 * would drift up to half a unit off the letters (7 mm college ruling is drawn 26 units apart instead of 26.46).
 */
export function drawnSpacingOf(background: PageBackground): number {
  const spacing = spacingOf(background);
  return TEXT_PAPER.has(background.pattern) ? Math.round(spacing) : spacing;
}

/** A notes area smaller than this, in page units, isn't usable, and the page keeps its plain margins. */
const MIN_NOTES = 96;

/** Patterns that repeat once per sheet rather than along a lattice. */
const SHEET_PATTERNS = new Set(['cornell', 'staff', 'template']);

function drawSheetPattern(c: Canvas, bg: PageBackground, g: SheetGeometry): void {
  if (bg.pattern === 'cornell') cornell(c, g, spacingOf(bg));
  else if (bg.pattern === 'staff') staves(c, contentBox(g, 0), spacingOf(bg));
  else if (bg.pattern === 'template' && bg.template) drawTemplate(c, bg.template, g);
}

/** Paper whose lines run across the page at one spacing: what `paperLattice` describes and the drawing tools snap to. */
const LATTICE_PAPER = new Set(['ruled', 'grid', 'dots']);

/**
 * The lines of ruled, grid, and dot paper, or null for any other paper. It is the one description of where those lines
 * are: `paperPaths` and `infinitePaths` draw it, and the drawing tools snap to it, so a snapped point is on a drawn
 * line. A paginated page's sheet draws ruled lines across its whole width from one step below the top margin to the
 * bottom margin, and squares and dots in whole cells of the content box. A page with no sheets draws them everywhere.
 * `from` is the y of the first rule of the first sheet, below the page's header (see `below` in core/paperLattice.ts).
 */
export function paperLattice(
  bg: PageBackground,
  g: SheetGeometry,
  paginated: boolean,
  from?: number,
): PaperLattice | null {
  if (!LATTICE_PAPER.has(bg.pattern)) return null;
  const kind = bg.pattern as PaperLattice['kind'];
  const step = drawnSpacingOf(bg);
  const [top, , bottom, left] = g.margins;
  const margin = kind === 'ruled' && bg.marginLine === true ? left : null;
  const origin = { x: left, y: top };
  const base = { kind, step, origin, margin, ...(from === undefined ? {} : { from }) };
  if (!paginated) return { ...base, area: UNBOUNDED, sheet: null };
  const area =
    kind === 'ruled'
      ? { x: 0, y: top + step, w: g.width, h: g.height - bottom - top - step }
      : wholeCells(contentBox(g, 0), step);
  return { ...base, area, sheet: g.height };
}

/** Draws a lattice's lines inside a box. */
function drawLattice(c: Canvas, lattice: PaperLattice, box: Rect): void {
  if (lattice.kind === 'ruled') ruled(c, box, lattice.origin.y, lattice.step);
  else if (lattice.kind === 'grid') grid(c, box, lattice.origin, lattice.step);
  else dots(c, box, lattice.origin, lattice.step);
}

/**
 * Everything one sheet draws, from the sheet's top-left corner. Plain and unknown patterns draw nothing. `from` is
 * the y of the first rule of paper that text sits on, below the page's header (sheet 0 only; see `below`).
 */
export function paperPaths(bg: PageBackground, g: SheetGeometry, from?: number): PaperPaths {
  const c = new Canvas();
  const step = drawnSpacingOf(bg);
  const content = contentBox(g, 0);
  const origin = { x: content.x, y: content.y };
  const lattice = paperLattice(bg, g, true, from);
  if (SHEET_PATTERNS.has(bg.pattern)) drawSheetPattern(c, bg, g);
  else if (lattice) {
    drawLattice(c, lattice, linesArea(lattice, 0));
    if (lattice.margin !== null) c.line(lattice.margin, 0, lattice.margin, g.height, 'margin');
  } else if (bg.pattern === 'isometric') isometric(c, content, origin, step);
  return c.paths();
}

/**
 * The paper for a tile of the infinite canvas, in page coordinates. Lattices and rules run through the tile, anchored
 * at sheet 0's content box. Patterns that repeat once per sheet are drawn for each sheet the tile touches. `from` is
 * the y of the first rule, below the page's header: the canvas has no rules above it.
 */
export function infinitePaths(bg: PageBackground, tile: Rect, g: SheetGeometry, from?: number): PaperPaths {
  if (SHEET_PATTERNS.has(bg.pattern)) return sheetsPaths(bg, tile, g);
  const c = new Canvas();
  const step = drawnSpacingOf(bg);
  const origin = { x: g.margins[3], y: g.margins[0] };
  const lattice = paperLattice(bg, g, false, from);
  if (lattice) {
    drawLattice(c, lattice, below(intersect(tile, lattice.area), lattice.from));
    const x = lattice.margin;
    if (x !== null && x >= tile.x - EPS && x <= tile.x + tile.w + EPS) c.line(x, tile.y, x, tile.y + tile.h, 'margin');
  } else if (bg.pattern === 'isometric') isometric(c, tile, origin, step);
  return c.paths();
}

function sheetsPaths(bg: PageBackground, tile: Rect, g: SheetGeometry): PaperPaths {
  const c = new Canvas();
  const first = sheetAt(g, tile.y);
  const last = Math.max(first, sheetAt(g, tile.y + tile.h - 2 * EPS));
  for (let k = first; k <= last; k += 1) c.shifted(k * g.height, () => drawSheetPattern(c, bg, g));
  return c.paths();
}

/**
 * The geometry the flow of text lays out in. Only Cornell paper changes it: the flow fills the notes area, so the
 * margins grow to the notes area's edges. A sheet too small for that area keeps its margins.
 */
export function flowGeometry(g: SheetGeometry, bg: PageBackground): SheetGeometry {
  if (bg.pattern !== 'cornell') return g;
  const { notes } = cornellAreas(g);
  if (notes.h < MIN_NOTES || notes.w < MIN_NOTES) return g;
  return { ...g, margins: [notes.y, g.margins[1], g.height - notes.y - notes.h, notes.x] };
}
