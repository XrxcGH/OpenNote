// Information functions. Owner: tables:fn-logic-info. Functions that ask about a cell (CELL, ISFORMULA, ISREF,
// SHEET, SHEETS) set `refArgs`: they get the reference itself and a probe of the page (fn/types.ts). INFO gives only
// answers that are safe offline: it never reveals a folder, the system's memory, or its version. ISOMITTED is an
// engine form (formula/special.ts); its spec here gives it a name and an example.

import { lettersFromColumn } from '../../../../../core/expr';
import { parseDate } from '../../dates';
import {
  arrayOf,
  err,
  isArray,
  isError,
  isRef,
  toNumber,
  type ErrorCode,
  type FormulaError,
  type RefValue,
  type Scalar,
  type Value,
} from '../../values';
import type { Env, FnSpec2, Probe } from './types';

type Test = (v: Scalar) => boolean;

function is(name: string, test: Test, example: string): FnSpec2 {
  return {
    name,
    family: 'info',
    params: [{ name: 'value', kind: 'value' }],
    handlesErrors: true,
    run: ([v]) => test(v as Scalar),
    meta: { signature: `${name}(value)`, example },
  };
}

/** The codes ERROR.TYPE gives. #CYCLE! has no code of its own, so it reads as #N/A's 7, the documented fallback. */
const ERROR_TYPES: Record<ErrorCode, number> = {
  NULL: 1,
  DIV0: 2,
  VALUE: 3,
  REF: 4,
  NAME: 5,
  NUM: 6,
  NA: 7,
  BUSY: 8,
  SPILL: 9,
  CALC: 14,
  FIELD: 13,
  CYCLE: 7,
};

function parity(name: string, odd: boolean, example: string): FnSpec2 {
  return {
    name,
    family: 'info',
    params: [{ name: 'number', kind: 'value' }],
    run: ([v]) => {
      if (typeof v === 'boolean') return err('VALUE');
      const n = toNumber(v);
      if (typeof n !== 'number' || !Number.isFinite(n)) return err('VALUE');
      return (Math.trunc(n) % 2 !== 0) === odd;
    },
    meta: { signature: `${name}(number)`, example },
  };
}

const isText: Test = (v) => typeof v === 'string';

/** An email address has one at sign, a dotted domain, and no spaces. */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const URL_PATTERN =
  /^(?:(?:https?|ftps?|sftp):\/\/)?(?:[^\s/?#@]+@)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;

function address(ref: RefValue): string {
  const cell = `$${lettersFromColumn(ref.c1)}$${ref.r1 + 1}`;
  if (ref.table === undefined) return cell;
  const name = ref.table;
  return `${/^\w+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`}!${cell}`;
}

/** The format code CELL("format") gives for a column type: G general, F fixed, C currency, P percent, D date. */
function formatCode(type: string, decimals: number | undefined): string {
  const digits = Math.min(decimals ?? 2, 9);
  if (type === 'currency') return `C${digits}`;
  if (type === 'percent') return `P${digits}`;
  // The column shows the region's short date, which CELL reports as D4.
  if (type === 'date') return 'D4';
  return type === 'number' && decimals !== undefined ? `F${digits}` : 'G';
}

/** The default column width in characters, rounded as CELL("width") rounds it. */
const COLUMN_WIDTH = 8;

const first = (v: Value): Value => (isArray(v) ? (v.data[0] ?? null) : v);

function cellInfo(args: Value[], env: Env): Value {
  const probe = env.probe;
  const kind = first(args[0]);
  if (isError(kind)) return kind;
  const given = args[1];
  if (given !== undefined && isError(given)) return given;
  if (probe === undefined) return err('VALUE');
  const ref = given === undefined ? probe.self : isRef(given) ? given : undefined;
  if (ref === undefined) return err('VALUE');
  const cell = probe.cell(ref);
  if (cell === undefined) return err('REF');
  switch (typeof kind === 'string' ? kind.trim().toLowerCase() : '') {
    case 'address':
      return address(ref);
    case 'col':
      return ref.c1 + 1;
    case 'row':
      return ref.r1 + 1;
    case 'contents':
      return cell.value;
    case 'type':
      return cell.value === null ? 'b' : typeof cell.value === 'string' ? 'l' : 'v';
    case 'format':
      return formatCode(cell.type, cell.decimals);
    case 'width':
      return COLUMN_WIDTH;
    case 'filename':
      return env.title ?? '';
    case 'prefix':
      return typeof cell.value === 'string' ? "'" : '';
    case 'color':
    case 'parentheses':
    case 'protect':
      return 0;
    default:
      return err('VALUE');
  }
}

function infoText(args: Value[], env: Env): Value {
  const key = first(args[0]);
  if (isError(key)) return key;
  const probe = env.probe;
  switch (typeof key === 'string' ? key.trim().toLowerCase() : '') {
    case 'numfile':
      return probe?.sheets.length ?? 1;
    case 'origin':
      return '$A:$A$1';
    case 'recalc':
      return probe?.calc === 'manual' ? 'Manual' : 'Automatic';
    case 'system':
      return 'pcdos';
    case 'directory':
    case 'memavail':
    case 'memused':
    case 'totmem':
    case 'osversion':
    case 'release':
      return err('NA');
    default:
      return err('VALUE');
  }
}

/** The table that the argument of SHEET names: a reference, or the text of a table's name. */
function sheetIndex(arg: Value, probe: Probe): number | FormulaError {
  if (isError(arg)) return arg;
  if (isRef(arg)) {
    const s = probe.sheetOf(arg);
    return s < 0 ? err('REF') : s;
  }
  const text = first(arg);
  if (typeof text !== 'string') return err('NA');
  const want = text.trim().toLowerCase();
  const found = probe.sheets.findIndex((name) => name.toLowerCase() === want);
  return found < 0 ? err('NA') : found;
}

export const functions: readonly FnSpec2[] = [
  {
    name: 'ISBLANK',
    family: 'info',
    params: [{ name: 'value', kind: 'value' }],
    handlesErrors: true,
    run: ([v]) => v === null,
    meta: { signature: 'ISBLANK(value)', example: '=ISBLANK("") gives FALSE' },
  },
  is('ISNUMBER', (v) => typeof v === 'number', '=ISNUMBER("1") gives FALSE'),
  is('ISTEXT', isText, '=ISTEXT("a") gives TRUE'),
  is('ISNONTEXT', (v) => !isText(v), '=ISNONTEXT(1) gives TRUE'),
  is('ISLOGICAL', (v) => typeof v === 'boolean', '=ISLOGICAL(1>2) gives TRUE'),
  is('ISERROR', (v) => isError(v), '=ISERROR(1/0) gives TRUE'),
  is('ISERR', (v) => isError(v) && v.error !== 'NA', '=ISERR(NA()) gives FALSE'),
  is('ISNA', (v) => isError(v) && v.error === 'NA', '=ISNA(NA()) gives TRUE'),
  parity('ISEVEN', false, '=ISEVEN(-2) gives TRUE'),
  parity('ISODD', true, '=ISODD(2.9) gives FALSE'),
  {
    name: 'N',
    family: 'info',
    params: [{ name: 'value', kind: 'value' }],
    run: ([v]) => (typeof v === 'number' ? v : v === true ? 1 : 0),
    meta: { signature: 'N(value)', example: '=N(TRUE) gives 1' },
  },
  {
    name: 'NA',
    family: 'info',
    params: [],
    run: () => err('NA'),
    meta: { signature: 'NA()', example: '=NA() gives #N/A' },
  },
  {
    name: 'TYPE',
    family: 'info',
    params: [{ name: 'value', kind: 'array' }],
    handlesErrors: true,
    run: ([v]) => {
      if (isError(v)) return 16;
      const items = isArray(v) ? v.data : [v as Scalar];
      if (items.length !== 1) return 64;
      const one = items[0];
      if (isError(one)) return 16;
      return typeof one === 'string' ? 2 : typeof one === 'boolean' ? 4 : 1;
    },
    meta: { signature: 'TYPE(value)', example: '=TYPE("a") gives 2' },
  },
  {
    name: 'ERROR.TYPE',
    family: 'info',
    params: [{ name: 'error', kind: 'value' }],
    handlesErrors: true,
    run: ([v]) => (isError(v) ? ERROR_TYPES[v.error] : err('NA')),
    meta: { signature: 'ERROR.TYPE(error)', example: '=ERROR.TYPE(1/0) gives 2' },
  },
  {
    name: 'ISREF',
    family: 'info',
    params: [{ name: 'value', kind: 'array' }],
    refArgs: true,
    handlesErrors: true,
    run: ([v]) => isRef(v),
    meta: { signature: 'ISREF(value)', example: '=ISREF(B2) gives TRUE' },
  },
  {
    name: 'ISFORMULA',
    family: 'info',
    params: [{ name: 'reference', kind: 'array' }],
    refArgs: true,
    run: ([v], env) => {
      if (!isRef(v)) return err('VALUE');
      const probe = env.probe;
      if (v.r1 === v.r2 && v.c1 === v.c2) {
        const cell = probe?.cell(v);
        return cell === undefined ? err('REF') : cell.formula;
      }
      // A block spills one answer per cell.
      const rows: Scalar[][] = [];
      for (let r = v.r1; r <= v.r2; r++) {
        const row: Scalar[] = [];
        for (let c = v.c1; c <= v.c2; c++) {
          const cell = probe?.cell({ ...v, r1: r, r2: r, c1: c, c2: c });
          row.push(cell === undefined ? err('REF') : cell.formula);
        }
        rows.push(row);
      }
      return arrayOf(rows);
    },
    meta: { signature: 'ISFORMULA(reference)', example: '=ISFORMULA(B2) gives TRUE when B2 has a formula' },
  },
  {
    name: 'ISOMITTED',
    family: 'info',
    params: [{ name: 'argument', kind: 'lazy' }],
    run: () => err('VALUE'),
    meta: { signature: 'ISOMITTED(argument)', example: '=LAMBDA(x, [y], ISOMITTED(y))(1) gives TRUE' },
  },
  {
    name: 'SHEET',
    family: 'info',
    params: [{ name: 'value', kind: 'array', optional: true }],
    refArgs: true,
    handlesErrors: true,
    run: (args, env) => {
      const probe = env.probe;
      if (probe === undefined) return err('VALUE');
      if (args.length === 0) return probe.sheet + 1;
      const s = sheetIndex(args[0], probe);
      return typeof s === 'number' ? s + 1 : s;
    },
    meta: { signature: 'SHEET([value])', example: '=SHEET() gives 1 on the first table' },
  },
  {
    name: 'SHEETS',
    family: 'info',
    params: [{ name: 'reference', kind: 'array', optional: true }],
    refArgs: true,
    run: (args, env) => {
      const probe = env.probe;
      if (probe === undefined) return err('VALUE');
      if (args.length === 0) return probe.sheets.length;
      const ref = args[0];
      if (!isRef(ref)) return err('VALUE');
      return probe.sheetOf(ref) < 0 ? err('REF') : 1;
    },
    meta: { signature: 'SHEETS([reference])', example: '=SHEETS() gives the number of tables on the page' },
  },
  {
    name: 'CELL',
    family: 'info',
    params: [
      { name: 'info_type', kind: 'value' },
      { name: 'reference', kind: 'array', optional: true },
    ],
    refArgs: true,
    volatile: true,
    run: cellInfo,
    meta: { signature: 'CELL(info_type, [reference])', example: '=CELL("address", B2) gives $B$2' },
  },
  {
    name: 'INFO',
    family: 'info',
    params: [{ name: 'type_text', kind: 'value' }],
    refArgs: true,
    volatile: true,
    run: infoText,
    meta: { signature: 'INFO(type_text)', example: '=INFO("recalc") gives Automatic' },
  },
  {
    name: 'ISEMAIL',
    family: 'info',
    params: [{ name: 'value', kind: 'value' }],
    handlesErrors: true,
    run: ([v]) => typeof v === 'string' && EMAIL.test(v.trim()),
    meta: { signature: 'ISEMAIL(value)', example: '=ISEMAIL("a@b.org") gives TRUE' },
  },
  {
    name: 'ISURL',
    family: 'info',
    params: [{ name: 'value', kind: 'value' }],
    handlesErrors: true,
    run: ([v]) => typeof v === 'string' && URL_PATTERN.test(v.trim()),
    meta: { signature: 'ISURL(value)', example: '=ISURL("https://example.org") gives TRUE' },
  },
  {
    name: 'ISDATE',
    family: 'info',
    params: [{ name: 'value', kind: 'array' }],
    refArgs: true,
    handlesErrors: true,
    run: ([v], env) => {
      const isDate = (x: unknown): boolean => typeof x === 'string' && parseDate(x, 'mdy') !== null;
      if (isRef(v)) {
        // A cell in a date column holds a date value, so it counts. Other cells count when their text reads as a date.
        const one = (r: number, c: number): boolean => {
          const cell = env.probe?.cell({ ...v, r1: r, r2: r, c1: c, c2: c });
          if (cell === undefined || cell.value === null) return false;
          return (cell.type === 'date' && typeof cell.value === 'number') || isDate(cell.value);
        };
        if (v.r1 === v.r2 && v.c1 === v.c2) return one(v.r1, v.c1);
        const rows: Scalar[][] = [];
        for (let r = v.r1; r <= v.r2; r++) {
          const row: Scalar[] = [];
          for (let c = v.c1; c <= v.c2; c++) row.push(one(r, c));
          rows.push(row);
        }
        return arrayOf(rows);
      }
      if (isArray(v)) return v.data.length === 1 ? isDate(v.data[0]) : { ...v, data: v.data.map((x) => isDate(x)) };
      return isDate(v as Scalar);
    },
    meta: { signature: 'ISDATE(value)', example: '=ISDATE("2026-01-31") gives TRUE' },
  },
];
