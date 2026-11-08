// Text functions that split and join: TEXTBEFORE, TEXTAFTER, TEXTSPLIT, TEXTJOIN, and Sheets' SPLIT and JOIN.
// Owner: tables:fn-text.
import { err, isArray, isError, toScalar, toText, type Scalar, type Value } from '../../values';
import { makeArray } from '../../arrays';
import { MAX_TEXT, array, bool, define, int, listOf, num, text, tooLong, value } from './textKit';
import type { FnSpec2 } from './types';

// ---------------------------------------------------------------------------------------------------------------
// Splitting. TEXTBEFORE, TEXTAFTER, and TEXTSPLIT take one delimiter or an array of them.

interface Hit {
  start: number;
  end: number;
}

/** The most distinct delimiters one call accepts. More give #VALUE!, so a huge range cannot make a scan crawl. */
export const MAX_DELIMITERS = 1000;
/** The most cells TEXTSPLIT builds. More give #VALUE!. */
export const MAX_SPLIT_CELLS = 1_000_000;

/** Delimiters made ready once per call: lowercased when case is ignored, without repeats, grouped by edge character. */
interface Delimiters {
  ci: boolean;
  /** By first character, longest first. */
  first: Map<string, string[]>;
  /** By last character, longest first. */
  last: Map<string, string[]>;
}

function prepareDelimiters(list: readonly string[], ci: boolean): Delimiters | null {
  const set = new Set<string>();
  for (const d of list) if (d !== '') set.add(ci ? d.toLowerCase() : d);
  if (set.size > MAX_DELIMITERS) return null;
  const first = new Map<string, string[]>();
  const last = new Map<string, string[]>();
  for (const d of [...set].sort((x, y) => y.length - x.length)) {
    for (const [map, ch] of [
      [first, d[0]],
      [last, d[d.length - 1]],
    ] as const) {
      const bucket = map.get(ch);
      if (bucket) bucket.push(d);
      else map.set(ch, [d]);
    }
  }
  return { ci, first, last };
}

/** The length of the longest delimiter that starts at `at` in the (already lowered, if ci) text, or -1. */
function matchAt(hay: string, at: number, ds: Delimiters): number {
  for (const d of ds.first.get(hay[at]) ?? []) if (hay.startsWith(d, at)) return d.length;
  return -1;
}

/** The length of the longest delimiter that ends at `end`, or -1. */
function matchEndingAt(hay: string, end: number, ds: Delimiters): number {
  for (const d of ds.last.get(hay[end - 1]) ?? [])
    if (d.length <= end && hay.startsWith(d, end - d.length)) return d.length;
  return -1;
}

/** Splits at every delimiter, scanning left to right without overlap. */
function splitAt(source: string, ds: Delimiters): string[] {
  const hay = ds.ci ? source.toLowerCase() : source;
  const out: string[] = [];
  let from = 0;
  let i = 0;
  while (i < source.length) {
    const len = matchAt(hay, i, ds);
    if (len > 0) {
      out.push(source.slice(from, i));
      i += len;
      from = i;
    } else i++;
  }
  out.push(source.slice(from));
  return out;
}

/** Every delimiter hit, left to right, or right to left when `fromEnd` is set. Hits never overlap. */
function hitsOf(source: string, ds: Delimiters, fromEnd: boolean): Hit[] {
  const hay = ds.ci ? source.toLowerCase() : source;
  const hits: Hit[] = [];
  if (!fromEnd) {
    for (let i = 0; i < source.length;) {
      const len = matchAt(hay, i, ds);
      if (len > 0) {
        hits.push({ start: i, end: i + len });
        i += len;
      } else i++;
    }
    return hits;
  }
  for (let e = source.length; e > 0;) {
    const len = matchEndingAt(hay, e, ds);
    if (len > 0) {
      hits.push({ start: e - len, end: e });
      e -= len;
    } else e--;
  }
  return hits;
}

function edgeText(name: string, before: boolean, example: string): FnSpec2 {
  return define(
    name,
    [
      text('text'),
      array('delimiter'),
      num('instance_num', true),
      num('match_mode', true),
      num('match_end', true),
      value('if_not_found', true),
    ],
    ([t, d, i, m, e, notFound]) => {
      const source = toText(t);
      if (typeof source !== 'string') return source;
      const delims = listOf(d);
      if (!Array.isArray(delims)) return delims;
      const instance = int(i, 1);
      const mode = int(m, 0);
      const matchEnd = int(e, 0);
      for (const x of [instance, mode, matchEnd]) if (typeof x !== 'number') return x;
      if ((mode !== 0 && mode !== 1) || (matchEnd !== 0 && matchEnd !== 1)) return err('VALUE');
      if (instance === 0 || Math.abs(instance as number) > Math.max(source.length, 1)) return err('VALUE');
      const missing = (): Value => (notFound === undefined ? err('NA') : notFound);
      const fromEnd = (instance as number) < 0;
      const n = Math.abs(instance as number);
      let hit: Hit | undefined;
      if (delims.length === 0 || delims.every((x) => x === '')) {
        // An empty delimiter matches at the start, or at the end when counting from the end.
        if (n !== 1) return missing();
        hit = fromEnd ? { start: source.length, end: source.length } : { start: 0, end: 0 };
      } else {
        const ds = prepareDelimiters(delims, mode === 1);
        if (ds === null) return err('VALUE');
        const hits = hitsOf(source, ds, fromEnd);
        // With match_end, the edge of the text counts as one more delimiter.
        if (matchEnd === 1) hits.push(fromEnd ? { start: 0, end: 0 } : { start: source.length, end: source.length });
        hit = hits[n - 1];
      }
      if (hit === undefined) return missing();
      return before ? source.slice(0, hit.start) : source.slice(hit.end);
    },
    example,
    { handlesErrors: true },
  );
}

export const splitFunctions: readonly FnSpec2[] = [
  edgeText('TEXTBEFORE', true, '=TEXTBEFORE("x-y-z", "-", 2) gives x-y'),
  edgeText('TEXTAFTER', false, '=TEXTAFTER("x-y-z", "-") gives y-z'),
  define(
    'TEXTSPLIT',
    [
      text('text'),
      array('col_delimiter', true),
      array('row_delimiter', true),
      bool('ignore_empty', true),
      num('match_mode', true),
      value('pad_with', true),
    ],
    ([t, c, r, ignore, m, pad]) => {
      const source = toText(t);
      if (typeof source !== 'string') return source;
      const cols = listOf(c);
      const rows = listOf(r);
      if (!Array.isArray(cols)) return cols;
      if (!Array.isArray(rows)) return rows;
      const colDelims = cols.filter((x) => x !== '');
      const rowDelims = rows.filter((x) => x !== '');
      if (colDelims.length === 0 && rowDelims.length === 0) return err('VALUE');
      const skip =
        ignore === undefined
          ? false
          : toScalar(ignore) === true || (typeof toScalar(ignore) === 'number' && ignore !== 0);
      const mode = int(m, 0);
      if (typeof mode !== 'number') return mode;
      if (mode !== 0 && mode !== 1) return err('VALUE');
      const ci = mode === 1;
      const rowSet = prepareDelimiters(rowDelims, ci);
      const colSet = prepareDelimiters(colDelims, ci);
      if (rowSet === null || colSet === null) return err('VALUE');
      let grid = (rowDelims.length > 0 ? splitAt(source, rowSet) : [source]).map((row) =>
        colDelims.length > 0 ? splitAt(row, colSet) : [row],
      );
      if (skip) grid = grid.map((row) => row.filter((x) => x !== '')).filter((row) => row.length > 0);
      if (grid.length === 0) return err('CALC');
      const width = grid.reduce((most, row) => Math.max(most, row.length), 0);
      if (grid.length * width > MAX_SPLIT_CELLS) return err('VALUE');
      const fill: Scalar = pad === undefined ? err('NA') : toScalar(pad);
      const data: Scalar[] = [];
      for (const row of grid) for (let i = 0; i < width; i++) data.push(i < row.length ? row[i] : fill);
      return data.length === 1 ? data[0] : makeArray(grid.length, width, data);
    },
    '=TEXTSPLIT("a,b;c,d", ",", ";") gives a 2 by 2 block',
  ),
  define(
    'TEXTJOIN',
    [array('delimiter'), bool('ignore_empty'), { repeat: [array('text')], min: 1 }],
    ([d, ignore, ...rest]) => {
      const delims = listOf(d);
      const skip = toScalar(ignore);
      if (!Array.isArray(delims)) return delims;
      if (isError(skip)) return skip;
      const flag = toScalar(ignore) === true || (typeof skip === 'number' && skip !== 0);
      const parts: string[] = [];
      for (const arg of rest) {
        const items = isArray(arg) ? arg.data : [toScalar(arg)];
        for (const item of items) {
          const s = toText(item);
          if (typeof s !== 'string') return s;
          if (flag && s === '') continue;
          parts.push(s);
        }
      }
      let out = '';
      for (let i = 0; i < parts.length; i++) {
        out += parts[i];
        if (i < parts.length - 1 && delims.length > 0) out += delims[i % delims.length];
        if (out.length > MAX_TEXT) return err('VALUE');
      }
      return out;
    },
    '=TEXTJOIN(", ", TRUE, "a", "", "b") gives a, b',
  ),
  define(
    'JOIN',
    [array('delimiter'), { repeat: [array('value')], min: 1 }],
    ([d, ...rest]) => {
      const delims = listOf(d);
      if (!Array.isArray(delims)) return delims;
      const parts: string[] = [];
      for (const arg of rest) {
        for (const item of isArray(arg) ? arg.data : [toScalar(arg)]) {
          const s = toText(item);
          if (typeof s !== 'string') return s;
          parts.push(s);
        }
      }
      const sep = delims[0] ?? '';
      return tooLong(parts.join(sep));
    },
    '=JOIN("-", "a", "b", "c") gives a-b-c',
  ),
  define(
    'SPLIT',
    [text('text'), text('delimiter'), bool('split_by_each', true), bool('remove_empty', true)],
    ([t, d, each, remove]) => {
      const source = toText(t);
      const delim = toText(d);
      if (typeof source !== 'string') return source;
      if (typeof delim !== 'string') return delim;
      const byEach = each === undefined ? true : toScalar(each) !== false && toScalar(each) !== 0;
      const drop = remove === undefined ? true : toScalar(remove) !== false && toScalar(remove) !== 0;
      if (delim === '') return source;
      const delims = byEach ? Array.from(delim) : [delim];
      const ds = prepareDelimiters(delims, false);
      if (ds === null) return err('VALUE');
      let pieces = splitAt(source, ds);
      if (drop) pieces = pieces.filter((x) => x !== '');
      if (pieces.length === 0) return '';
      return pieces.length === 1 ? pieces[0] : makeArray(1, pieces.length, pieces);
    },
    '=SPLIT("a b,c", " ,") gives a row of a, b, and c',
  ),
];
