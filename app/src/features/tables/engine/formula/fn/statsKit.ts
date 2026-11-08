// Shared parts of the statistical families. Owner: tables:fn-stats. It builds specs from a short parameter list,
// reads numbers out of arguments, and loads the lazy chunk that holds the distributions, the regression functions,
// and the compatibility names of distributions (DESIGN.md section 7 and the bundle note).

import { asArray } from '../../arrays';
import { err, isError, isNumber, toNumber, type FormulaError, type Value } from '../../values';
import { numbersIn, type Env, type Family, type FnSpec2, type Param, type ParamKind } from './types';

export type Run = (args: Value[], env: Env) => Value;

/** True when a helper gave an error instead of its result object. */
export const failed = <T extends object>(x: T | FormulaError): x is FormulaError => 'error' in x;

const KINDS: Readonly<Record<string, ParamKind>> = {
  n: 'number',
  a: 'array',
  r: 'range',
  b: 'bool',
  v: 'value',
};

/**
 * Parameters from a short list such as "x mean sd cumulative:b [significance]". A name alone is a number. A suffix
 * picks the kind: ":a" an array, ":r" a range, ":b" a boolean, ":v" any value. Brackets mark an optional one.
 */
export function paramsFrom(list: string): Param[] {
  if (list === '') return [];
  return list.split(' ').map((token) => {
    const optional = token.startsWith('[');
    const [name, kind = 'n'] = token.replace(/[[\]]/g, '').split(':');
    return { name, kind: KINDS[kind], ...(optional ? { optional: true } : {}) };
  });
}

/** The call as autocomplete shows it, with optional arguments in brackets. */
export function signatureOf(name: string, params: readonly Param[], repeats = false): string {
  const parts = params.map((p) => (p.optional === true ? `[${p.name}]` : p.name));
  return `${name}(${[...parts, ...(repeats ? ['...'] : [])].join(', ')})`;
}

/** A spec with fixed parameters. */
export function fixed(family: Family, name: string, list: string, run: Run, example: string): FnSpec2 {
  const params = paramsFrom(list);
  return { name, family, params, run, meta: { signature: signatureOf(name, params), example } };
}

/** A spec that takes any number of values, which reach it as one flat list. `raw` keeps typed text as it is. */
export function listOf(family: Family, name: string, run: Run, example: string, raw = false): FnSpec2 {
  const param: Param = { name: 'value', kind: 'range', ...(raw ? { direct: 'raw' as const } : {}) };
  return {
    name,
    family,
    params: [{ repeat: [param], min: 1 }],
    run,
    meta: { signature: `${name}(value, ...)`, example },
  };
}

/** A list function over the numbers of its values. Text, booleans, and empty cells are skipped. */
export function overNumbers(family: Family, name: string, f: (nums: number[]) => Value, example: string): FnSpec2 {
  return listOf(
    family,
    name,
    (args) => {
      const nums = numbersIn(args);
      return Array.isArray(nums) ? f(nums) : nums;
    },
    example,
  );
}

/** The numbers in an array argument, or its first error. Text, booleans, and empty items are skipped. */
export function numbersOf(value: Value): number[] | FormulaError {
  if (isError(value)) return value;
  return numbersIn(asArray(value).data);
}

/** Reads arguments as numbers, or gives the first error. Empty optional arguments take their defaults. */
export function readNumbers(
  args: readonly Value[],
  defaults: readonly (number | undefined)[] = [],
): number[] | FormulaError {
  const out: number[] = [];
  for (let i = 0; i < Math.max(args.length, defaults.length); i++) {
    const v = args[i];
    if (v === undefined) {
      const d = defaults[i];
      if (d === undefined) return err('VALUE');
      out.push(d);
      continue;
    }
    const n = toNumber(v);
    if (typeof n !== 'number') return n;
    out.push(n);
  }
  return out;
}

/** Wraps a numeric function: arguments become numbers (with defaults), and NaN or infinity becomes #NUM!. */
export function numeric(
  f: (n: number[]) => number | FormulaError,
  defaults: readonly (number | undefined)[] = [],
): Run {
  return (args) => {
    const nums = readNumbers(args, defaults);
    if (!Array.isArray(nums)) return nums;
    try {
      const v = f(nums);
      return typeof v === 'number' && !Number.isFinite(v) ? err('NUM') : v;
    } catch {
      // The special functions throw on a domain error; that is an invalid number to a spreadsheet.
      return err('NUM');
    }
  };
}

/** Paired numbers of two arrays of the same size. Pairs where either item is not a number are skipped. */
export function pairsOf(a: Value, b: Value): { xs: number[]; ys: number[] } | FormulaError {
  if (isError(a)) return a;
  if (isError(b)) return b;
  const x = asArray(a).data;
  const y = asArray(b).data;
  if (x.length !== y.length) return err('NA');
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const p = x[i];
    const q = y[i];
    if (isError(p)) return p;
    if (isError(q)) return q;
    if (isNumber(p) && isNumber(q)) {
      xs.push(p);
      ys.push(q);
    }
  }
  return { xs, ys };
}

export const sum = (nums: readonly number[]): number => {
  // Neumaier's compensated sum keeps the digits that plain addition drops over long lists.
  let s = 0;
  let c = 0;
  for (const x of nums) {
    const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
  }
  return s + c;
};

export const mean = (nums: readonly number[]): number => sum(nums) / nums.length;

/** The sum of squared deviations from the mean, in two passes for accuracy. */
export function devsq(nums: readonly number[]): number {
  const m = mean(nums);
  return sum(nums.map((x) => (x - m) * (x - m)));
}

export const sorted = (nums: readonly number[]): number[] => [...nums].sort((a, b) => a - b);

// The lazy chunk. Its functions are declared in the core chunk with their parameters, so formulas compile and
// autocomplete knows them; only the code that computes them waits. A formula that runs before the chunk arrives shows
// #BUSY! ("Still calculating"), the load starts, and listeners recalculate when it lands.

let runs: Readonly<Record<string, Run>> | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Loads the statistical chunk once. Later calls give the same promise. A failed load may be tried again. */
export function loadStatistics(): Promise<void> {
  pending ??= import('./lazy/statistics').then(
    (chunk) => {
      runs = chunk.runs;
      for (const listener of [...listeners]) listener();
    },
    (cause: unknown) => {
      pending = null;
      throw cause;
    },
  );
  return pending;
}

/** True once the statistical chunk has loaded. */
export const statisticsLoaded = (): boolean => runs !== null;

/** Calls `listener` when the chunk lands, so a page can recalculate. Returns a function that stops listening. */
export function onStatisticsLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A run that waits for the chunk: #BUSY! until it has loaded, then the chunk's function by this name. */
export function lazyRun(name: string): Run {
  return (args, env) => {
    if (runs === null) {
      loadStatistics().catch(() => undefined);
      return err('BUSY');
    }
    const run = runs[name];
    return run === undefined ? err('NAME') : run(args, env);
  };
}

/** A spec whose code lives in the lazy chunk. */
export function lazy(family: Family, name: string, list: string, example: string): FnSpec2 {
  return fixed(family, name, list, lazyRun(name), example);
}
