// The plain-words cause of an error, for the formula bar's error popover. The engine records where an error came from
// (engine/formula/explain.ts); this file turns that into sentences from the strings file. A lookup that found
// nothing names the value it looked for and the range it looked in, read from the formula as typed.
import { t } from '../../../../strings/t';
import { originSentence } from '../../engine/formula/explain';
import type { ErrorOrigin, OriginCell } from '../../engine/formula/explain';
import type { Scalar } from '../../engine/values';
import { formulaSeparator, scanFormula } from './scan';

/** t() for a key made at run time, from the sentence keys the engine names (OriginSentence). */
const say = t as unknown as (key: string, values: Record<string, unknown>) => string;

const LOOKUPS = new Set(['VLOOKUP', 'HLOOKUP', 'LOOKUP', 'MATCH', 'XLOOKUP', 'XMATCH']);

/** The text of each argument of the call that spans `start` to `end` in `formula` (without "="). */
export function callArgs(formula: string, start: number, end: number, separator = formulaSeparator()): string[] {
  const call = formula.slice(start, end);
  const tokens = scanFormula(call, { separator });
  const args: string[] = [];
  let depth = 0;
  let from = -1;
  for (const token of tokens) {
    if (token.kind === 'open' || (token.kind === 'brace' && token.text === '{')) {
      depth += 1;
      if (depth === 1 && token.kind === 'open') from = token.end;
    } else if (token.kind === 'close' || (token.kind === 'brace' && token.text === '}')) {
      if (depth === 1 && token.kind === 'close' && from >= 0) args.push(call.slice(from, token.start).trim());
      depth -= 1;
    } else if (token.kind === 'sep' && depth === 1) {
      args.push(call.slice(from, token.start).trim());
      from = token.end;
    }
  }
  return args;
}

/** A value as a sentence names it. Text goes in quotes. Numbers, TRUE, and FALSE stay as they are. */
function valueText(value: Scalar | { rows: number; cols: number } | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return null;
}

export interface Explanation {
  /** The sentence that says why. */
  readonly cause: string;
  /** A second sentence the function gave as its reason, when it gave one. */
  readonly detail?: string;
}

/**
 * Why a cell shows an error. `formula` is the formula of the cell the origin belongs to, without "=", so the
 * sentence can quote the arguments as typed. `cellName` names a cell on the page, such as "B2" or "Table2!B2".
 */
export function explainError(
  origin: ErrorOrigin,
  formula: string,
  cellName: (cell: OriginCell) => string,
): Explanation {
  if (origin.kind === 'function' && origin.code === 'NA' && origin.name && LOOKUPS.has(origin.name)) {
    const args =
      origin.start !== undefined && origin.end !== undefined ? callArgs(formula, origin.start, origin.end) : [];
    const value = valueText(origin.args?.[0] as Scalar | undefined) ?? args[0] ?? '';
    const range = args[1];
    return {
      cause: range
        ? t('sheetFormula.explain.lookupMissing', { name: origin.name, value, range })
        : t('sheetFormula.explain.lookupMissingValue', { name: origin.name, value }),
    };
  }
  if (origin.kind === 'operator' && origin.code === 'DIV0') return { cause: t('sheetFormula.explain.divide') };
  const { key, values } = originSentence(origin, cellName);
  const cause = say(`sheetFormula.explain.${key}`, { ...values });
  const reason = values.reason ? `sheetFormula.explain.reasons.${values.reason}` : null;
  const known = reason !== null && reason in REASON_KEYS;
  return known ? { cause, detail: say(reason, {}) } : { cause };
}

const REASON_KEYS: Record<string, true> = {
  'sheetFormula.explain.reasons.tooMany': true,
  'sheetFormula.explain.reasons.regexTooComplex': true,
  'sheetFormula.explain.reasons.regexNestedRepeat': true,
};
