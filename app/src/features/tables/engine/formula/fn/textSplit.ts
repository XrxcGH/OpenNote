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

/** The longest delimiter that matches at `at`, or null. */
function matchAt(source: string, lowered: string, at: number, delims: readonly string[], ci: boolean): number {
  let best = -1;
  for (const d of delims) {
    if (d === '') continue;
    const piece = ci ? lowered.slice(at, at + d.length) : source.slice(at, at + d.length);
    if (piece === (ci ? d.toLowerCase() : d) && d.length > best) best = d.length;
  }
  return best;
}

/** Splits at every delimiter, scanning left to right without overlap. */
function splitAt(source: string, delims: readonly string[], ci: boolean): string[] {
  const lowered = ci ? source.toLowerCase() : source;
  const out: string[] = [];
  let from = 0;
  let i = 0;
  while (i < source.length) {
    const len = matchAt(source, lowered, i, delims, ci);
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
function hitsOf(source: string, delims: readonly string[], ci: boolean, fromEnd: boolean): Hit[] {
  const lowered = ci ? source.toLowerCase() : source;
  const hits: Hit[] = [];
  if (!fromEnd) {
    for (let i = 0; i < source.length;) {
      const len = matchAt(source, lowered, i, delims, ci);
      if (len > 0) {
        hits.push({ start: i, end: i + len });
        i += len;
      } else i++;
    }
    return hits;
  }
  for (let e = source.length; e > 0;) {
    let len = -1;
    for (const d of delims) {
      if (d === '' || d.length > e) continue;
      const piece = ci ? lowered.slice(e - d.length, e) : source.slice(e - d.length, e);
      if (piece === (ci ? d.toLowerCase() : d) && d.length > len) len = d.length;
    }
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
        const hits = hitsOf(source, delims, mode === 1, fromEnd);
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
      let grid = (rowDelims.length > 0 ? splitAt(source, rowDelims, ci) : [source]).map((row) =>
        colDelims.length > 0 ? splitAt(row, colDelims, ci) : [row],
      );
      if (skip) grid = grid.map((row) => row.filter((x) => x !== '')).filter((row) => row.length > 0);
      if (grid.length === 0) return err('CALC');
      const width = Math.max(...grid.map((row) => row.length));
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
      let pieces = splitAt(source, delims, false);
      if (drop) pieces = pieces.filter((x) => x !== '');
      if (pieces.length === 0) return '';
      return pieces.length === 1 ? pieces[0] : makeArray(1, pieces.length, pieces);
    },
    '=SPLIT("a b,c", " ,") gives a row of a, b, and c',
  ),
];
