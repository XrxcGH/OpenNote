// Where generated writing sits on the page. On ruled, grid, and dot paper the baselines are the paper's own lines,
// from its lattice (core/paperLattice.ts), so the writing sits on the rules the page draws, sheet after sheet; the
// letters are sized to the spacing. On plain paper the size follows the typed text it replaces, and the lines are as
// far apart as the person's own letters need.
import { linesArea, nearestLine, sheetIndex, sheetOriginY } from '../../../core/paperLattice';
import type { PaperLattice } from '../../../core/paperLattice';
import { DEFAULT_METRICS } from './style';
import type { HandMetrics } from './style';
import type { Placement } from './write';

export interface PlaceRequest {
  /** Where the writing starts: the top left of the text it replaces, or where the person tapped. */
  readonly at: { readonly x: number; readonly y: number };
  /** The right edge the lines wrap at, in page units. */
  readonly right: number;
  /** The typed text's size, in page units, for plain paper. */
  readonly fontSize?: number;
  /** Where the first line starts, when the writing goes on from writing already there. */
  readonly startX?: number;
}

/** The x-height that fits the person's tallest letters and deepest descenders into one line spacing. */
export function xHeightFor(lineStep: number, metrics: HandMetrics = DEFAULT_METRICS): number {
  const tall = Math.max(metrics.capHeight, metrics.ascender, 1);
  return Math.min(lineStep * 0.42, (lineStep * 0.78) / tall, (lineStep * 0.95) / (tall + metrics.descender));
}

/** The first line of `lattice` at or below `y`, and the lines after it, through every sheet. */
export function latticeLines(lattice: PaperLattice, perLine: number) {
  const step = lattice.step * perLine;
  const lineAt = (y: number): number => {
    for (let k = sheetIndex(lattice, y), tries = 0; tries < 3; k += 1, tries += 1) {
      const area = linesArea(lattice, k);
      const lo = Math.max(area.y, y);
      const line = nearestLine(lo, sheetOriginY(lattice, k), lattice.step, lo, area.y + area.h);
      if (line !== null) return line >= y - 0.01 ? line : line + lattice.step;
      if (lattice.sheet === null) break;
    }
    return y;
  };
  const next = (y: number): number => {
    const k = sheetIndex(lattice, y);
    const area = linesArea(lattice, k);
    const below = y + step;
    if (lattice.sheet === null || below <= area.y + area.h + 0.01) return below;
    // The next sheet: its first line far enough below the header for the letters.
    const nextArea = linesArea(lattice, k + 1);
    return lineAt(nextArea.y + step * 0.6);
  };
  return { step, lineAt, next };
}

/** Where writing goes for a request, on this paper. */
export function placement(
  lattice: PaperLattice | null,
  request: PlaceRequest,
  metrics: HandMetrics = DEFAULT_METRICS,
): Placement {
  if (lattice) {
    // Small squares or close rules take two spacings a line, so the letters are not tiny.
    const perLine = lattice.step < 14 ? 2 : 1;
    const lines = latticeLines(lattice, perLine);
    const xHeight = xHeightFor(lines.step, metrics);
    const tall = Math.max(metrics.capHeight, metrics.ascender) * xHeight;
    const baseline = lines.lineAt(request.at.y + tall * 0.9);
    let left = request.at.x;
    if (lattice.kind === 'ruled' && lattice.margin !== null && left < lattice.margin + xHeight)
      left = lattice.margin + xHeight * 0.5;
    if (lattice.kind !== 'ruled') {
      // On grid and dot paper the writing starts on a line of the grid.
      const k = Math.floor((left - lattice.origin.x) / lattice.step + 1e-6);
      left = lattice.origin.x + Math.max(0, k) * lattice.step;
    }
    const area = linesArea(lattice, sheetIndex(lattice, baseline));
    const right = Math.min(request.right, area.x + area.w);
    return {
      left,
      width: Math.max(xHeight * 4, right - left),
      baseline,
      xHeight,
      next: lines.next,
      startX: request.startX,
    };
  }
  const fontSize = request.fontSize ?? 16;
  const xHeight = Math.max(6, fontSize * 0.55);
  const lineStep = xHeight * (Math.max(metrics.capHeight, metrics.ascender) + metrics.descender + 1.0);
  const baseline = request.at.y + xHeight * Math.max(metrics.capHeight, metrics.ascender) * 1.1;
  return {
    left: request.at.x,
    width: Math.max(xHeight * 4, request.right - request.at.x),
    baseline,
    xHeight,
    next: (y) => y + lineStep,
    startX: request.startX,
  };
}
