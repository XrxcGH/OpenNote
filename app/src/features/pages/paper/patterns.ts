// The paper generator: a page's background becomes SVG path data for one sheet, or for one tile of the infinite
// canvas. Patterns fill the content box and ruled lines span the sheet's width, so the margins stay visibly blank.
// Infinite view draws the same patterns without breaks, in step with sheet 0, so no line jumps when the view changes.

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
  const [lo, hi] = SPACING_LIMITS[background.pattern] ?? [4, 200];
  const value = background.spacing;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, lo), hi) : DEFAULT_SPACING;
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

/** Everything one sheet draws, from the sheet's top-left corner. Plain and unknown patterns draw nothing. */
export function paperPaths(bg: PageBackground, g: SheetGeometry): PaperPaths {
  const c = new Canvas();
  const step = spacingOf(bg);
  const [top, , bottom, left] = g.margins;
  const content = contentBox(g, 0);
  const origin = { x: content.x, y: content.y };
  if (SHEET_PATTERNS.has(bg.pattern)) drawSheetPattern(c, bg, g);
  else if (bg.pattern === 'ruled') {
    ruled(c, { x: 0, y: top + step, w: g.width, h: g.height - bottom - top - step }, top, step);
    if (bg.marginLine === true) c.line(left, 0, left, g.height, 'margin');
  } else if (bg.pattern === 'grid') grid(c, wholeCells(content, step), origin, step);
  else if (bg.pattern === 'dots') dots(c, wholeCells(content, step), origin, step);
  else if (bg.pattern === 'isometric') isometric(c, content, origin, step);
  return c.paths();
}

/**
 * The paper for a tile of the infinite canvas, in page coordinates. Lattices and rules run through the tile, anchored
 * at sheet 0's content box. Patterns that repeat once per sheet are drawn for each sheet the tile touches.
 */
export function infinitePaths(bg: PageBackground, tile: Rect, g: SheetGeometry): PaperPaths {
  if (SHEET_PATTERNS.has(bg.pattern)) return sheetsPaths(bg, tile, g);
  const c = new Canvas();
  const step = spacingOf(bg);
  const origin = { x: g.margins[3], y: g.margins[0] };
  if (bg.pattern === 'ruled') {
    ruled(c, tile, origin.y, step);
    if (bg.marginLine === true && origin.x >= tile.x - EPS && origin.x <= tile.x + tile.w + EPS) {
      c.line(origin.x, tile.y, origin.x, tile.y + tile.h, 'margin');
    }
  } else if (bg.pattern === 'grid') grid(c, tile, origin, step);
  else if (bg.pattern === 'dots') dots(c, tile, origin, step);
  else if (bg.pattern === 'isometric') isometric(c, tile, origin, step);
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
