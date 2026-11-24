// The accessible name of the 2D plot: it names the functions and the visible range, not only how many there are
// (T3-D08-3), so a screen reader says what is drawn and where.
import { t } from '../../../strings/t';
import type { Viewport } from '../grapher';

/** At most this many functions are named; the rest are counted. */
const NAMED = 3;

/** A bound as short text: up to 3 decimals, no trailing zeros. */
const bound = (value: number): string => String(Math.round(value * 1000) / 1000);

export function plotLabel(functions: readonly string[], view: Viewport): string {
  const lines = functions.map((line) => line.trim()).filter((line) => line !== '');
  if (lines.length === 0) return t('smart.grapher.labelEmpty', range(view));
  const named = lines.slice(0, NAMED).join('; ');
  const shown =
    lines.length > NAMED ? t('smart.grapher.labelMore', { names: named, count: lines.length - NAMED }) : named;
  return t('smart.grapher.labelNamed', { functions: shown, ...range(view) });
}

function range(view: Viewport) {
  return { xLo: bound(view.xMin), xHi: bound(view.xMax), yLo: bound(view.yMin), yHi: bound(view.yMax) };
}
