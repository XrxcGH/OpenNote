// Running an engine on what was typed: the result, or the code of what was wrong, which the tool turns into a
// sentence. Engines throw errors whose message is a code under the tool's errors strings.
import { ht } from './parts';

export type Attempt<T> = { ok: true; value: T } | { ok: false; code: string };

export function attempt<T>(run: () => T): Attempt<T> {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, code: error instanceof Error ? error.message : 'unknown' };
  }
}

/** The sentence for an error code of a tool, or the tool's general sentence for a code it does not know. */
export function errorText(tool: string, code: string): string {
  try {
    return ht(`${tool}.errors.${code}`);
  } catch {
    return ht(`${tool}.errors.unknown`);
  }
}

/** A typed number. A minus sign or a comma for the decimal point is read too; anything else is an error. */
export function num(text: string): number {
  const cleaned = text
    .trim()
    .replace(/−/g, '-')
    .replace(/^([+-]?\d*),(\d+)$/, '$1.$2');
  const value = cleaned === '' ? NaN : Number(cleaned);
  if (!Number.isFinite(value)) throw new Error('number');
  return value;
}

/** A number with this many decimals, never shown as -0. */
export function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

/** A number with up to this many significant digits, without trailing zeros. */
export function sig(value: number, digits = 6): string {
  if (value === 0) return '0';
  return Number(value.toPrecision(digits)).toString();
}
