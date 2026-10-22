// Significant figures and scientific notation, for lab work. A number's significant figures are counted the way a
// chemistry or physics class does: leading zeros never count, zeros between digits always do, and trailing zeros
// count only when the number has a decimal point (so 1200 has two, and 1200. and 1.200e3 have four). An answer can be
// rounded to the fewest significant figures typed, as multiplying and dividing measured values asks.
import { formatNumber } from './format';
import type { Notation } from './format';

const NUMBER = /^[-+]?(\d*)(?:\.(\d*))?(?:[eE][-+]?\d+)?$/;

/** The significant figures of a number as written, or null when the text is not a plain number. */
export function countSigFigs(text: string): number | null {
  const trimmed = text.trim().replace(/[,_\s]/g, '');
  const match = NUMBER.exec(trimmed);
  if (!match || (match[1] === '' && (match[2] ?? '') === '')) return null;
  const whole = match[1];
  const fraction = match[2];
  const hasPoint = fraction !== undefined;
  const digits = (whole + (fraction ?? '')).replace(/^0+/, '');
  if (digits === '') return hasPoint ? Math.max(1, (fraction ?? '').length) : 1;
  if (hasPoint) return digits.length;
  // A whole number without a point: its trailing zeros are placeholders.
  return digits.replace(/0+$/, '').length || 1;
}

/** The number literals in an expression, as typed. Letters and function names are skipped. */
export function numbersIn(expression: string): string[] {
  return expression.match(/(?<![A-Za-z_\d.])(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
}

/** The fewest significant figures among the numbers typed in an expression, or null when it has none. */
export function leastSigFigs(expression: string): number | null {
  const counts = numbersIn(expression)
    .map(countSigFigs)
    .filter((count): count is number => count !== null);
  return counts.length === 0 ? null : Math.min(...counts);
}

/** A value rounded to `figures` significant figures. */
export function roundSigFigs(value: number, figures: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const n = Math.min(15, Math.max(1, Math.round(figures)));
  return Number(value.toPrecision(n));
}

export type SigFigChoice = 'auto' | 'match' | number;

export interface AnswerFormat {
  notation: Exclude<Notation, 'fixed'>;
  figures: SigFigChoice;
}

export const DEFAULT_ANSWER_FORMAT: AnswerFormat = { notation: 'auto', figures: 'auto' };

/**
 * An answer written with the chosen notation and significant figures. "match" uses the fewest figures typed in the
 * expression; the significant figures are kept even where they are zeros, so 2.0 stays 2.0 in scientific notation.
 */
export function formatAnswer(value: number, expression: string, format: AnswerFormat): string {
  const figures =
    format.figures === 'match' ? leastSigFigs(expression) : format.figures === 'auto' ? null : format.figures;
  if (figures === null) return formatNumber(value, { notation: format.notation });
  const notation = format.notation === 'auto' ? 'auto' : format.notation;
  if (notation === 'auto') {
    // Plain notation keeps trailing zeros that are significant, such as 2.50.
    const rounded = roundSigFigs(value, figures);
    const text = rounded.toPrecision(Math.min(15, Math.max(1, figures)));
    if (!/e/.test(text)) return text;
    // A large whole number, such as 7750 to three figures, is written out; a tiny one goes to scientific notation.
    const exponent = Math.floor(Math.log10(Math.abs(rounded)));
    return exponent >= 0 && exponent < 15
      ? String(rounded)
      : formatNumber(value, { notation: 'scientific', digits: figures });
  }
  return formatNumber(value, { notation, digits: figures });
}

/** Reads a saved choice back, falling back to the default for anything it does not know. */
export function restoreAnswerFormat(raw: unknown): AnswerFormat {
  const saved = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<AnswerFormat>;
  const notation = saved.notation === 'scientific' || saved.notation === 'engineering' ? saved.notation : 'auto';
  const figures =
    saved.figures === 'match' || (typeof saved.figures === 'number' && saved.figures >= 1 && saved.figures <= 15)
      ? saved.figures
      : 'auto';
  return { notation, figures };
}
