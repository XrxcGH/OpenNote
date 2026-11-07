// Logical functions and the metadata of LET and LAMBDA. Owner: tables:fn-logic-info. IF and IFERROR take lazy
// arguments, so the compiler evaluates them itself and only the branch it needs runs. LET, LAMBDA, and ISOMITTED
// (info.ts) are engine forms too (formula/special.ts): the specs here only give them a name, a signature, and an
// example. The other functions are written against the documented rules.

import { err, isArray, isError, toBool, type FormulaError, type Scalar, type Value } from '../../values';
import type { FnSpec2 } from './types';

/**
 * The logical values behind AND, OR, and XOR. Arrays and references give their numbers and booleans; text and
 * empty cells inside them are skipped. A value typed alone is a one-by-one array, so a lone text is read as a
 * boolean ("TRUE" works, other text is #VALUE!). The first error wins. No logical value at all is #VALUE!.
 */
function logicals(args: readonly Value[]): boolean[] | FormulaError {
  const out: boolean[] = [];
  for (const arg of args) {
    if (isError(arg)) return arg;
    const items: readonly Scalar[] = isArray(arg) ? arg.data : [arg as Scalar];
    const single = items.length === 1;
    for (const v of items) {
      if (isError(v)) return v;
      if (v === null) continue;
      if (typeof v === 'string') {
        if (!single) continue;
        const b = toBool(v);
        if (typeof b !== 'boolean') return b;
        out.push(b);
        continue;
      }
      out.push(typeof v === 'boolean' ? v : v !== 0);
    }
  }
  return out.length === 0 ? err('VALUE') : out;
}

function logic(name: string, combine: (bools: boolean[]) => boolean, example: string): FnSpec2 {
  return {
    name,
    family: 'logical',
    params: [{ repeat: [{ name: 'logical', kind: 'array', skipRefText: true }], min: 1 }],
    run: (args) => {
      const bools = logicals(args);
      return Array.isArray(bools) ? combine(bools) : bools;
    },
    meta: { signature: `${name}(logical, ...)`, example },
  };
}

/** The compiler evaluates functions with lazy arguments itself. */
const special = (): Value => err('VALUE');

/** Equality as SWITCH reads it: text without regard to case, an empty cell equal to 0 and to "". */
function same(a: Scalar, b: Scalar): boolean {
  if (a === null) return b === null || b === 0 || b === '';
  if (b === null) return same(b, a);
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (isError(a) || isError(b)) return isError(a) && isError(b) && a.error === b.error;
  return a === b;
}

const scalar = (v: Value): Scalar => (isArray(v) ? (v.data[0] ?? null) : (v as Scalar));

export const functions: readonly FnSpec2[] = [
  logic('AND', (b) => b.every(Boolean), '=AND(TRUE, 1>2) gives FALSE'),
  logic('OR', (b) => b.some(Boolean), '=OR(TRUE, 1>2) gives TRUE'),
  logic('XOR', (b) => b.filter(Boolean).length % 2 === 1, '=XOR(TRUE, TRUE, TRUE) gives TRUE'),
  {
    name: 'NOT',
    family: 'logical',
    params: [{ name: 'logical', kind: 'value' }],
    run: ([v]) => {
      const b = toBool(v);
      return typeof b === 'boolean' ? !b : b;
    },
    meta: { signature: 'NOT(logical)', example: '=NOT(1>2) gives TRUE' },
  },
  {
    name: 'TRUE',
    family: 'logical',
    params: [],
    run: () => true,
    meta: { signature: 'TRUE()', example: '=TRUE() gives TRUE' },
  },
  {
    name: 'FALSE',
    family: 'logical',
    params: [],
    run: () => false,
    meta: { signature: 'FALSE()', example: '=FALSE() gives FALSE' },
  },
  {
    name: 'IF',
    family: 'logical',
    params: [
      { name: 'test', kind: 'bool' },
      { name: 'then', kind: 'lazy' },
      { name: 'otherwise', kind: 'lazy', optional: true, default: false },
    ],
    run: special,
    meta: { signature: 'IF(test, then, [otherwise])', example: '=IF(3>2, "yes", "no") gives yes' },
  },
  {
    name: 'IFERROR',
    family: 'logical',
    params: [
      { name: 'value', kind: 'lazy' },
      { name: 'on_error', kind: 'lazy' },
    ],
    run: special,
    meta: { signature: 'IFERROR(value, on_error)', example: '=IFERROR(1/0, 0) gives 0' },
  },
  {
    name: 'IFNA',
    family: 'logical',
    params: [
      { name: 'value', kind: 'value' },
      { name: 'on_na', kind: 'value' },
    ],
    handlesErrors: true,
    run: ([v, fallback]) => (isError(v) && v.error === 'NA' ? fallback : v),
    meta: { signature: 'IFNA(value, on_na)', example: '=IFNA(NA(), "x") gives x' },
  },
  {
    name: 'IFS',
    family: 'logical',
    params: [
      {
        repeat: [
          { name: 'test', kind: 'value' },
          { name: 'result', kind: 'value' },
        ],
        min: 1,
      },
    ],
    // A test that is never reached cannot spoil the answer, so errors come in and are read in order.
    handlesErrors: true,
    run: (args) => {
      if (args.length % 2 !== 0) return err('VALUE');
      for (let i = 0; i < args.length; i += 2) {
        const test = toBool(args[i]);
        if (typeof test !== 'boolean') return test;
        if (test) return args[i + 1];
      }
      return err('NA');
    },
    meta: { signature: 'IFS(test, result, ...)', example: '=IFS(FALSE, 1, TRUE, 2) gives 2' },
  },
  {
    name: 'SWITCH',
    family: 'logical',
    params: [
      { name: 'value', kind: 'value' },
      {
        repeat: [
          { name: 'match', kind: 'value' },
          { name: 'result', kind: 'value' },
        ],
        min: 1,
      },
      { name: 'default', kind: 'value', optional: true },
    ],
    handlesErrors: true,
    run: (args) => {
      const [value, ...rest] = args.map(scalar);
      if (isError(value)) return value;
      const raw = args.slice(1);
      const pairs = Math.floor(rest.length / 2);
      // The chosen result is returned as it is, so an array result is not cut down to its first element.
      for (let i = 0; i < pairs; i++) if (same(value, rest[2 * i])) return raw[2 * i + 1];
      return rest.length % 2 === 1 ? raw[raw.length - 1] : err('NA');
    },
    meta: {
      signature: 'SWITCH(value, match, result, ..., [default])',
      example: '=SWITCH(2, 1, "a", 2, "b", "z") gives b',
    },
  },
  {
    name: 'LET',
    family: 'logical',
    params: [
      {
        repeat: [
          { name: 'name', kind: 'lazy' },
          { name: 'value', kind: 'lazy' },
        ],
        min: 1,
      },
      { name: 'calculation', kind: 'lazy' },
    ],
    run: special,
    meta: { signature: 'LET(name, value, ..., calculation)', example: '=LET(x, 3, x*x) gives 9' },
  },
  {
    name: 'LAMBDA',
    family: 'logical',
    params: [{ repeat: [{ name: 'parameter', kind: 'lazy' }] }, { name: 'calculation', kind: 'lazy' }],
    run: special,
    meta: { signature: 'LAMBDA(parameter, ..., calculation)', example: '=LAMBDA(x, x+1)(2) gives 3' },
  },
];
