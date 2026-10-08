// Function lookup for a dialect: which names are functions, what they are called when typed in another way, and
// how many arguments they take. A host lists the canonical names it offers and its aliases, and gets back the
// function the parser asks with.

import type { FunctionInfo } from './dialect';
import type { FunctionTable } from './functions';

export interface FunctionNames {
  /** The canonical names on offer. They must be in the function table. */
  names: readonly string[];
  /** Other spellings, mapped to canonical names: arcsin to asin. */
  aliases?: Readonly<Record<string, string>>;
  /** When false (the default), SIN and Sin are sin. */
  caseSensitive?: boolean;
}

/** The usual alternative spellings: arcsin for asin, fact for factorial, and so on. */
export const COMMON_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  arcsin: 'asin',
  arccos: 'acos',
  arctan: 'atan',
  arsinh: 'asinh',
  arcosh: 'acosh',
  artanh: 'atanh',
  arcsinh: 'asinh',
  arccosh: 'acosh',
  arctanh: 'atanh',
  sgn: 'sign',
  nthroot: 'root',
});

/** Builds the lookup the parser uses. Typed names that are not on offer give undefined. */
export function functionLookup(table: FunctionTable, spec: FunctionNames): (typed: string) => FunctionInfo | undefined {
  const offered = new Set(spec.names);
  const infos = new Map<string, FunctionInfo>();
  const fold = (text: string): string => (spec.caseSensitive === true ? text : text.toLowerCase());
  const infoFor = (canonical: string): FunctionInfo | undefined => {
    if (!offered.has(canonical) || !Object.hasOwn(table, canonical)) return undefined;
    const def = table[canonical];
    const inverse = def.inverse !== undefined && offered.has(def.inverse) ? def.inverse : undefined;
    return inverse === undefined
      ? { name: canonical, min: def.min, max: def.max }
      : { name: canonical, min: def.min, max: def.max, inverse };
  };
  for (const canonical of spec.names) {
    const info = infoFor(canonical);
    if (info !== undefined) infos.set(fold(canonical), info);
  }
  for (const [alias, canonical] of Object.entries(spec.aliases ?? {})) {
    const info = infoFor(canonical);
    if (info !== undefined) infos.set(fold(alias), info);
  }
  const exactOnly = spec.caseSensitive === true;
  return (typed) => infos.get(typed) ?? (exactOnly ? undefined : infos.get(typed.toLowerCase()));
}
