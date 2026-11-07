// The ruler's units (text DESIGN.md 5.4): inches, centimeters, millimeters, points, or picas. Every value in the
// document is in points; these functions only convert for display and for the snap grid.

export type RulerUnit = 'in' | 'cm' | 'mm' | 'pt' | 'pc';
export const RULER_UNITS: readonly RulerUnit[] = ['in', 'cm', 'mm', 'pt', 'pc'];

/** CSS pixels per point: a CSS inch is 96 px and a point is 1/72 inch. */
export const PX_PER_PT = 96 / 72;

const POINTS_PER: Readonly<Record<RulerUnit, number>> = { in: 72, cm: 72 / 2.54, mm: 72 / 25.4, pt: 1, pc: 12 };

/** The snap grid in points: 1/16 inch, or 0.25 cm with metric units (DESIGN.md 5.4). */
const SNAP: Readonly<Record<RulerUnit, number>> = {
  in: 72 / 16,
  cm: 0.25 * (72 / 2.54),
  mm: 0.25 * (72 / 2.54),
  pt: 1,
  pc: 3,
};

/** The space between numbered ticks, in the unit, and how many parts each divides into. */
export const TICKS: Readonly<Record<RulerUnit, { major: number; parts: number }>> = {
  in: { major: 1, parts: 8 },
  cm: { major: 1, parts: 4 },
  mm: { major: 10, parts: 5 },
  pt: { major: 72, parts: 6 },
  pc: { major: 6, parts: 6 },
};

export function toPoints(value: number, unit: RulerUnit): number {
  return value * POINTS_PER[unit];
}

export function fromPoints(points: number, unit: RulerUnit): number {
  return points / POINTS_PER[unit];
}

export function snapPoints(unit: RulerUnit): number {
  return SNAP[unit];
}

/** Document values are kept to a twentieth of a point, as the paragraph attributes are. */
export function roundPoints(points: number): number {
  return Math.round(points * 20) / 20;
}

/** The number a person reads: at most two decimals, no trailing zeros ("0.5", "1.27", "36"). */
export function shownNumber(points: number, unit: RulerUnit): string {
  const text = fromPoints(points, unit).toFixed(2);
  return String(Number(text));
}

/** A value read from the page's text for a unit, as in the spin boxes of the Format pane: "1.5", "1,5". */
export function parseNumber(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** The unit a new ruler starts in: inches for the United States, Liberia, and Myanmar; centimeters elsewhere. */
export function defaultUnit(locale: string): RulerUnit {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase();
  return region === 'US' || region === 'LR' || region === 'MM' || (!region && /^en\b/i.test(locale)) ? 'in' : 'cm';
}
