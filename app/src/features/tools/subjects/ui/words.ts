// The subject kits' words: a message from the kitSubjects namespace, and any engine error as a sentence a student
// can act on. Kit-core's own errors (a singular matrix, an unbracketed root) keep kit-core's words.
import { problemWords, say } from '../../kits/ui/words';
import { SubjectError } from '../errors';

export const sayS = (key: string, vars?: Readonly<Record<string, string | number>>): string =>
  say(`kitSubjects.${key}`, vars);

/** Any error a subject engine throws, in words. */
export function subjectProblem(error: unknown): string {
  if (error instanceof SubjectError) return sayS(`error.${error.code}`, { detail: error.detail || '—' });
  return problemWords(error);
}

/** A number for a results table: up to `digits` significant digits, plain notation in the usual range. */
export function formatNumber(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '—' : value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  const text =
    magnitude >= 1e-4 && magnitude < 1e9 ? String(Number(value.toPrecision(digits))) : value.toExponential(digits - 1);
  return text.replace('-', '−');
}
