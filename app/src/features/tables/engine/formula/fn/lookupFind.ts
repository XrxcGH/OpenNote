// The searching lookup functions: VLOOKUP, HLOOKUP, LOOKUP, MATCH, XLOOKUP, and XMATCH. Written from Microsoft's
// documented behavior. Approximate matches use Excel's binary search (lookupKit.ts), so data that is not sorted
// gives the answer that rule gives.

import { err, toBool, toScalar, type ArrayValue, type Scalar, type Value } from '../../values';
import { asArray, collapse } from '../../arrays';
import type { FnSpec2 } from './types';
import {
  approximate,
  binarySearch,
  columnOf,
  exactTest,
  firstWhere,
  order,
  rankOf,
  rowOf,
  transpose,
  vectorOf,
  wholeArg,
} from './lookupKit';

/** Longest pattern match mode 3 accepts. */
const REGEX_MAX = 1000;
/** A quantified group that holds a quantifier, as in (a+)+: the shape that can take exponential time. */
const NESTED = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

/** A regular expression test for XLOOKUP and XMATCH match mode 3, or null when the pattern is refused. */
function regexTest(pattern: Scalar): ((item: Scalar) => boolean) | null {
  if (typeof pattern !== 'string' || pattern.length > REGEX_MAX || NESTED.test(pattern) || /\\\d/.test(pattern)) {
    return null;
  }
  try {
    const re = new RegExp(pattern, 'u');
    return (item) => typeof item === 'string' && re.test(item);
  } catch {
    return null;
  }
}

/** VLOOKUP's core, on a table whose first column is searched. */
function tableLookup(x: Value, table: Value, index: Value, approx: Value | undefined): Value {
  const a = asArray(table);
  const n = wholeArg(index, 0);
  if (typeof n !== 'number') return n;
  if (n < 1) return err('VALUE');
  if (n > a.cols) return err('REF');
  const near = approx === undefined ? false : toBool(approx);
  if (typeof near !== 'boolean') return near;
  const keys = columnOf(a, 0).data;
  const v = toScalar(x);
  const at = near ? approximate(keys, v) : firstWhere(keys, exactTest(v, true));
  return at < 0 ? err('NA') : a.data[at * a.cols + n - 1];
}

/** MATCH's position, zero-based, or -1. */
function matchIndex(x: Scalar, items: readonly Scalar[], type: number): number {
  if (type === 0) return firstWhere(items, exactTest(x, true));
  return approximate(items, x, type < 0);
}

/** The best index by XLOOKUP's match mode -1 or 1 on a scan: exact first, then the nearest smaller or larger. */
function nearestScan(items: readonly Scalar[], x: Scalar, mode: number, backward: boolean): number {
  const exact = firstWhere(items, exactTest(x, false), backward);
  if (exact >= 0) return exact;
  const rank = rankOf(x);
  let best = -1;
  const n = items.length;
  for (let k = 0; k < n; k++) {
    const i = backward ? n - 1 - k : k;
    const item = items[i];
    if (rankOf(item) !== rank) continue;
    const c = order(item, x);
    if (mode < 0 ? c >= 0 : c <= 0) continue;
    if (best < 0 || (mode < 0 ? order(item, items[best]) > 0 : order(item, items[best]) < 0)) best = i;
  }
  return best;
}

/** XLOOKUP and XMATCH's position, zero-based, -1 when nothing matches, or an error for a refused mode. */
function xIndex(x: Scalar, items: readonly Scalar[], mode: number, search: number): number | 'bad' {
  if (![0, -1, 1, 2, 3].includes(mode) || ![1, -1, 2, -2].includes(search)) return 'bad';
  if (search === 2 || search === -2) {
    if (mode === 2 || mode === 3) return 'bad';
    const desc = search === -2;
    if (mode === 1) return binarySearch(items, x, (c) => c >= 0, desc);
    const at = binarySearch(items, x, (c) => c <= 0, !desc);
    if (mode === 0 && (at < 0 || order(items[at], x) !== 0)) return -1;
    return at;
  }
  const backward = search === -1;
  if (mode === 0) return firstWhere(items, exactTest(x, false, true), backward);
  if (mode === 2) return firstWhere(items, exactTest(x, true, true), backward);
  if (mode === 3) {
    const test = regexTest(x);
    return test === null ? 'bad' : firstWhere(items, test, backward);
  }
  return nearestScan(items, x, mode, backward);
}

function modes(mode: Value | undefined, search: Value | undefined): [number, number] | Value {
  const m = wholeArg(mode, 0);
  if (typeof m !== 'number') return m;
  const s = wholeArg(search, 1);
  if (typeof s !== 'number') return s;
  return [m, s];
}

function xlookup(args: Value[]): Value {
  const [x, lookIn, back, notFound, mode, search] = args;
  const look = asArray(lookIn);
  const ret = asArray(back);
  const byRow = look.cols === 1;
  if (!byRow && look.rows !== 1) return err('VALUE');
  const items = look.data;
  if (byRow ? ret.rows !== look.rows : ret.cols !== look.cols) return err('VALUE');
  const ms = modes(mode, search);
  if (!Array.isArray(ms)) return ms;
  const at = xIndex(toScalar(x), items, ms[0], ms[1]);
  if (at === 'bad') return err('VALUE');
  if (at < 0) return notFound === undefined || toScalar(notFound) === null ? err('NA') : collapse(asArray(notFound));
  return collapse(byRow ? rowOf(ret, at) : columnOf(ret, at));
}

function lookup(args: Value[]): Value {
  const [x, first, result] = args;
  const a = asArray(first);
  let keys: readonly Scalar[];
  let values: readonly Scalar[];
  if (result === undefined) {
    // The array form: the first row or column is searched, and the last one gives the result.
    const wide = a.cols > a.rows;
    const block: ArrayValue = wide ? transpose(a) : a;
    keys = columnOf(block, 0).data;
    values = columnOf(block, block.cols - 1).data;
  } else {
    const k = vectorOf(a);
    const r = vectorOf(result);
    if (k === null || r === null) return err('NA');
    keys = k;
    values = r;
  }
  const at = approximate(keys, toScalar(x));
  return at < 0 || at >= values.length ? err('NA') : values[at];
}

const lookupValue = { name: 'lookup_value', kind: 'value' } as const;

export const findFunctions: readonly FnSpec2[] = [
  {
    name: 'VLOOKUP',
    family: 'lookup',
    params: [
      lookupValue,
      { name: 'table_array', kind: 'range' },
      { name: 'col_index_num', kind: 'number' },
      { name: 'range_lookup', kind: 'bool', optional: true },
    ],
    run: ([x, table, index, approx]) => tableLookup(x, table, index, approx ?? true),
    meta: {
      signature: 'VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])',
      example: '=VLOOKUP(2,{1,"one";2,"two"},2,FALSE) gives two',
    },
  },
  {
    name: 'HLOOKUP',
    family: 'lookup',
    params: [
      lookupValue,
      { name: 'table_array', kind: 'range' },
      { name: 'row_index_num', kind: 'number' },
      { name: 'range_lookup', kind: 'bool', optional: true },
    ],
    run: ([x, table, index, approx]) => tableLookup(x, transpose(asArray(table)), index, approx ?? true),
    meta: {
      signature: 'HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])',
      example: '=HLOOKUP("b",{"a","b";1,2},2,FALSE) gives 2',
    },
  },
  {
    name: 'LOOKUP',
    family: 'lookup',
    params: [
      lookupValue,
      { name: 'lookup_vector', kind: 'range' },
      { name: 'result_vector', kind: 'range', optional: true },
    ],
    run: lookup,
    meta: {
      signature: 'LOOKUP(lookup_value, lookup_vector, [result_vector])',
      example: '=LOOKUP(25,{10,20,30},{"low","mid","high"}) gives mid',
    },
  },
  {
    name: 'MATCH',
    family: 'lookup',
    params: [
      lookupValue,
      { name: 'lookup_array', kind: 'range' },
      { name: 'match_type', kind: 'number', optional: true },
    ],
    run: ([x, items, type]) => {
      const list = vectorOf(items);
      if (list === null) return err('NA');
      const t = wholeArg(type, 1);
      if (typeof t !== 'number') return t;
      const at = matchIndex(toScalar(x), list, Math.sign(t));
      return at < 0 ? err('NA') : at + 1;
    },
    meta: {
      signature: 'MATCH(lookup_value, lookup_array, [match_type])',
      example: '=MATCH("b",{"a","b","c"},0) gives 2',
    },
  },
  {
    name: 'XLOOKUP',
    family: 'lookup',
    params: [
      lookupValue,
      { name: 'lookup_array', kind: 'range' },
      { name: 'return_array', kind: 'range' },
      { name: 'if_not_found', kind: 'array', optional: true },
      { name: 'match_mode', kind: 'number', optional: true },
      { name: 'search_mode', kind: 'number', optional: true },
    ],
    run: xlookup,
    meta: {
      signature: 'XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])',
      example: '=XLOOKUP(3,{1,3,5},{"a","b","c"}) gives b',
    },
  },
  {
    name: 'XMATCH',
    family: 'lookup',
    params: [
      lookupValue,
      { name: 'lookup_array', kind: 'range' },
      { name: 'match_mode', kind: 'number', optional: true },
      { name: 'search_mode', kind: 'number', optional: true },
    ],
    run: ([x, items, mode, search]) => {
      const list = vectorOf(items);
      if (list === null) return err('VALUE');
      const ms = modes(mode, search);
      if (!Array.isArray(ms)) return ms;
      const at = xIndex(toScalar(x), list, ms[0], ms[1]);
      return at === 'bad' ? err('VALUE') : at < 0 ? err('NA') : at + 1;
    },
    meta: {
      signature: 'XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])',
      example: '=XMATCH(5,{1,3,5}) gives 3',
    },
  },
];
