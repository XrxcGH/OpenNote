// The text functions as they worked before the text family was rebuilt. A table without data.sheet.v was written
// then, so its TRIM and CONCAT keep the old results (ADR 0058). Owner: tables:fn-text.

import { toText } from '../../values';
import { define, text } from './textKit';
import type { FnSpec2 } from './types';

/** TRIM as it was: leading and trailing white space goes, and every run of white space becomes one space. */
const TRIM = define(
  'TRIM',
  [text('text')],
  ([v]) => {
    const s = toText(v);
    return typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : s;
  },
  '=TRIM("  a   b ") gives a b',
);

/** CONCAT as it was: each argument is one text, so a range reads like any scalar argument. */
const CONCAT = define(
  'CONCAT',
  [{ repeat: [text('text')], min: 1 }],
  (args) => {
    let out = '';
    for (const v of args) {
      const s = toText(v);
      if (typeof s !== 'string') return s;
      out += s;
    }
    return out;
  },
  '=CONCAT("pen", "cil") gives pencil',
);

const OLD: readonly FnSpec2[] = [TRIM, CONCAT];
const MERGED = new WeakMap<object, ReadonlyMap<string, FnSpec2>>();
const ALONE: ReadonlyMap<string, FnSpec2> = new Map(OLD.map((f) => [f.name, f]));

/** The functions a legacy table's formulas use before the library's: the old TRIM and CONCAT, then `base`. */
export function legacyFunctions(base?: ReadonlyMap<string, FnSpec2>): ReadonlyMap<string, FnSpec2> {
  if (base === undefined) return ALONE;
  let merged = MERGED.get(base);
  if (merged === undefined) {
    merged = new Map([...ALONE, ...base]);
    MERGED.set(base, merged);
  }
  return merged;
}
