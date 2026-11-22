// Token-level translation of formulas between OpenNote's stored form and Excel's file form (ADR 0067). It is the
// TypeScript twin of crates/interop/src/sheet/formula.rs, and both run the golden cases of fixtures/translate.json.
// OpenNote's A1 rows count from the first data row, so rows move by one under a header row. A bare [Col] is the cell
// in the formula's row, except as an argument of a function that takes a range, where it is the whole column.
// E becomes EXP(1), and functions newer than Excel 2007 take the _xlfn. prefix of the file form.

/** A table as formulas see it, in the workbook being written or read. */
export interface TableRef {
  /** The name OpenNote formulas use, such as Table1. */
  name: string;
  /** The name of its Excel ListObject, or null when it has none. */
  excel: string | null;
  /** The name of its worksheet. */
  sheet: string;
  header: boolean;
  /** The names [Col] matches, in column order. */
  columns: readonly string[];
  /** Its rows, the header row included. */
  rows: number;
}

/** Where a formula sits: the workbook, its own table, and its Excel row (null for a defined name). */
export interface TranslateContext {
  book: readonly TableRef[];
  own: number;
  row: number | null;
}

const RANGE_FUNCTIONS = new Set(
  (
    'AGGREGATE AND AVERAGE AVERAGEA AVERAGEIF AVERAGEIFS CHOOSECOLS CHOOSEROWS COLUMNS CONCAT CORREL COUNT COUNTA ' +
    'COUNTBLANK COUNTIF COUNTIFS COVARIANCE.P COVARIANCE.S DROP FILTER HLOOKUP INDEX LARGE LOOKUP MATCH MAX MAXA ' +
    'MAXIFS MEDIAN MIN MINA MINIFS MODE MODE.MULT MODE.SNGL OR PERCENTILE PERCENTILE.EXC PERCENTILE.INC PRODUCT ' +
    'QUARTILE QUARTILE.EXC QUARTILE.INC RANK RANK.AVG RANK.EQ ROWS SMALL SORT SORTBY STDEV STDEV.P STDEV.S STDEVA ' +
    'STDEVP SUBTOTAL SUM SUMIF SUMIFS SUMPRODUCT TAKE TEXTJOIN TOCOL TOROW UNIQUE VAR VAR.P VAR.S VARA VARP VLOOKUP ' +
    'XLOOKUP XMATCH XOR'
  ).split(' '),
);

const FUTURE_FUNCTIONS = new Set(
  (
    'ACOT ACOTH AGGREGATE ARABIC BASE BETA.DIST BETA.INV BINOM.DIST BINOM.INV BITAND BITLSHIFT BITOR BITRSHIFT ' +
    'BITXOR BYCOL BYROW CEILING.MATH CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST ' +
    'CHOOSECOLS CHOOSEROWS COMBINA CONCAT CONFIDENCE.NORM CONFIDENCE.T COT COTH COVARIANCE.P COVARIANCE.S CSC CSCH ' +
    'DAYS DECIMAL DROP ERF.PRECISE ERFC.PRECISE EXPAND EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FILTER ' +
    'FLOOR.MATH FLOOR.PRECISE FORECAST.LINEAR FORMULATEXT GAMMA GAMMA.DIST GAMMA.INV GAMMALN.PRECISE GAUSS HSTACK ' +
    'HYPGEOM.DIST IFNA IFS IMCOSH IMCOT IMCSC IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA ISOMITTED ISOWEEKNUM LAMBDA ' +
    'LET LOGNORM.DIST LOGNORM.INV MAKEARRAY MAP MAXIFS MINIFS MODE.MULT MODE.SNGL NEGBINOM.DIST NORM.DIST NORM.INV ' +
    'NORM.S.DIST NORM.S.INV NUMBERVALUE PDURATION PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC PERCENTRANK.INC ' +
    'PERMUTATIONA PHI POISSON.DIST QUARTILE.EXC QUARTILE.INC RANDARRAY RANK.AVG RANK.EQ REDUCE RRI SCAN SEC SECH ' +
    'SEQUENCE SHEET SHEETS SKEW.P SORT SORTBY STDEV.P STDEV.S SWITCH T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T ' +
    'T.TEST TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW UNICHAR UNICODE UNIQUE VALUETOTEXT ARRAYTOTEXT ' +
    'VAR.P VAR.S VSTACK WEIBULL.DIST WRAPCOLS WRAPROWS XLOOKUP XMATCH XOR'
  ).split(' '),
);

const WORKSHEET_PREFIXED = new Set(['FILTER', 'SORT']);
const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;

type Tok =
  | { k: 'text'; t: string }
  | { k: 'num'; t: string }
  | { k: 'name'; t: string }
  | { k: 'bracket'; t: string }
  | { k: 'quoted'; t: string };

const isNameStart = (c: string): boolean => /[\p{L}_\\$]/u.test(c);
const isNamePart = (c: string): boolean => /[\p{L}\p{N}_.$\\]/u.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

function tokenize(src: string, excel: boolean): Tok[] {
  const chars = [...src];
  const out: Tok[] = [];
  let i = 0;
  const take = (from: number, to: number): string => chars.slice(from, to).join('');
  while (i < chars.length) {
    const c = chars[i];
    const start = i;
    if (c === '"' || c === "'") {
      i += 1;
      while (i < chars.length) {
        if (chars[i] === c && chars[i + 1] === c) i += 2;
        else if (chars[i] === c) {
          i += 1;
          break;
        } else i += 1;
      }
      out.push({ k: c === '"' ? 'text' : 'quoted', t: take(start, i) });
    } else if (c === '[') {
      i += 1;
      let depth = 1;
      while (i < chars.length && depth > 0) {
        const ch = chars[i];
        if (!excel && ch === ']' && chars[i + 1] === ']') i += 1;
        else if (ch === ']') depth -= 1;
        else if (excel && ch === '[') depth += 1;
        else if (excel && ch === "'") i += 1;
        i += 1;
      }
      out.push({ k: 'bracket', t: take(start, Math.min(i, chars.length)) });
    } else if (c === '#' && /[A-Za-z]/.test(chars[i + 1] ?? '')) {
      i += 1;
      while (i < chars.length && /[A-Za-z0-9/_]/.test(chars[i])) i += 1;
      if (i < chars.length && (chars[i] === '!' || chars[i] === '?')) i += 1;
      out.push({ k: 'text', t: take(start, i) });
    } else if (isDigit(c) || (c === '.' && isDigit(chars[i + 1]))) {
      while (i < chars.length && (isDigit(chars[i]) || chars[i] === '.')) i += 1;
      if (chars[i] === 'e' || chars[i] === 'E') {
        let j = i + 1;
        if (chars[j] === '+' || chars[j] === '-') j += 1;
        if (isDigit(chars[j])) {
          i = j;
          while (isDigit(chars[i])) i += 1;
        }
      }
      out.push({ k: 'num', t: take(start, i) });
    } else if (isNameStart(c)) {
      while (i < chars.length && isNamePart(chars[i])) i += 1;
      out.push({ k: 'name', t: take(start, i) });
    } else {
      i += 1;
      out.push({ k: 'text', t: c });
    }
  }
  return out;
}

interface Cell {
  colAbs: boolean;
  letters: string;
  rowAbs: boolean;
  row: number;
}

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function cellOf(name: string): Cell | null {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9]\d{0,6})$/.exec(name);
  if (!m) return null;
  const row = Number(m[4]);
  if (columnNumber(m[2]) > MAX_COLUMN || row > MAX_ROW) return null;
  return { colAbs: m[1] === '$', letters: m[2], rowAbs: m[3] === '$', row };
}

/** The letters of a column, counting from 0. */
export function columnLetters(index: number): string {
  let out = '';
  let n = index;
  for (;;) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    if (n < 26) return out;
    n = Math.floor(n / 26) - 1;
  }
}

/** A sheet name as a reference writes it, quoted when it is not a plain name. */
export function sheetPrefix(sheet: string): string {
  const plain = /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(sheet) && cellOf(sheet) === null;
  return plain ? `${sheet}!` : `'${sheet.replaceAll("'", "''")}'!`;
}

function moved(row: number, by: number): number | null {
  const r = row + by;
  return r >= 1 && r <= MAX_ROW ? r : null;
}

const excelEscape = (name: string): string => name.replace(/['[\]#]/g, "'$&");
const excelUnescape = (name: string): string => name.replace(/'(.)/gu, '$1');

function stripPrefixes(name: string): string {
  let bare = name;
  for (const prefix of ['_xlfn.', '_xlws.', '_xlpm.']) {
    if (bare.length > prefix.length && bare.slice(0, prefix.length).toLowerCase() === prefix) {
      bare = bare.slice(prefix.length);
    }
  }
  return bare;
}

function rowNumber(text: string): { abs: boolean; row: number } | null {
  const m = /^(\$?)(\d+)$/.exec(text);
  return m ? { abs: m[1] === '$', row: Number(m[2]) } : null;
}

const cellText = (c: Cell, row: number): string => `${c.colAbs ? '$' : ''}${c.letters}${c.rowAbs ? '$' : ''}${row}`;

function rowText(abs: boolean, row: number, by: number): string {
  const r = moved(row, by);
  return r === null ? '#REF!' : `${abs ? '$' : ''}${r}`;
}

class Walker {
  readonly calls: string[] = [];
  constructor(
    readonly toks: Tok[],
    readonly cx: TranslateContext,
  ) {}

  nextIs(at: number, text: string): boolean {
    const t = this.toks[at + 1];
    return t?.k === 'text' && t.t === text;
  }

  prevIs(at: number, text: string): boolean {
    const t = this.toks[at - 1];
    return t?.k === 'text' && t.t === text;
  }

  inRangeFunction(): boolean {
    const f = this.calls.at(-1);
    return f !== undefined && RANGE_FUNCTIONS.has(stripPrefixes(f).toUpperCase());
  }

  track(at: number): void {
    const t = this.toks[at];
    if (t.k === 'text' && t.t === '(') {
      const prev = this.toks[at - 1];
      this.calls.push(prev?.k === 'name' ? prev.t : '');
    } else if (t.k === 'text' && t.t === ')') this.calls.pop();
  }

  tableNamed(name: string, excel: boolean): number {
    const lower = name.toLowerCase();
    return this.cx.book.findIndex((t) => (excel ? t.excel : t.name)?.toLowerCase() === lower);
  }

  tableOnSheet(sheet: string): number {
    return this.cx.book.findIndex((t) => t.sheet.toLowerCase() === sheet.toLowerCase());
  }

  shift(t: number, toExcel: boolean): number {
    if (!this.cx.book[t]?.header) return 0;
    return toExcel ? 1 : -1;
  }

  rowRef(at: number): boolean {
    return this.prevIs(at, ':') || this.nextIs(at, ':');
  }
}

function structToExcel(w: Walker, raw: string, t: number, explicit: boolean): string {
  const { cx } = w;
  const table = cx.book[t];
  const inner = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  if (inner.startsWith('[') || inner.startsWith('#')) return table.excel === null ? '#REF!' : table.excel + raw;
  const atSign = inner.startsWith('@');
  const name = (atSign ? inner.slice(1) : inner).replaceAll(']]', ']');
  const thisRow = atSign || (!explicit && !w.inRangeFunction() && cx.row !== null);
  const col = table.columns.findIndex((c) => c.trim().toLowerCase() === name.trim().toLowerCase());
  if (col < 0) return '#REF!';
  if (table.excel !== null) {
    const escaped = excelEscape(table.columns[col]);
    return thisRow ? `${table.excel}[[#This Row],[${escaped}]]` : `${table.excel}[${escaped}]`;
  }
  const letters = columnLetters(col);
  const sheet = t === cx.own && cx.row !== null ? '' : sheetPrefix(table.sheet);
  if (cx.row !== null && thisRow) return `${sheet}${letters}${cx.row}`;
  const first = table.header ? 2 : 1;
  const last = Math.max(table.rows, first);
  return `${sheet}$${letters}$${first}:$${letters}$${last}`;
}

/** Translates an OpenNote formula, without its =, into Excel's file form. */
export function toExcel(formula: string, cx: TranslateContext): string {
  const w = new Walker(tokenize(formula, false), cx);
  let out = '';
  let qualified: number | null = null;
  const ownPrefix = (at: number, target: number | null): string =>
    cx.row === null && target === null && !w.prevIs(at, ':') ? sheetPrefix(cx.book[cx.own].sheet) : '';
  w.toks.forEach((tok, at) => {
    const target = qualified;
    qualified = null;
    const table = target ?? cx.own;
    const next = w.toks[at + 1];
    const prev = w.toks[at - 1];
    if (tok.k === 'name' && w.nextIs(at, '(')) {
      const upper = tok.t.toUpperCase();
      if (FUTURE_FUNCTIONS.has(upper)) out += WORKSHEET_PREFIXED.has(upper) ? '_xlfn._xlws.' : '_xlfn.';
      out += tok.t;
    } else if (tok.k === 'name' && w.nextIs(at, '!')) {
      const t = w.tableNamed(tok.t, false);
      if (t >= 0) {
        out += sheetPrefix(cx.book[t].sheet);
        qualified = t;
      } else out += `${tok.t}!`;
    } else if (tok.k === 'text' && tok.t === '!' && prev?.k === 'name') {
      qualified = target;
    } else if (tok.k === 'name' && next?.k === 'bracket') {
      const t = w.tableNamed(tok.t, false);
      if (t >= 0) qualified = t;
      else out += tok.t;
    } else if (tok.k === 'bracket') {
      const afterName = prev?.k === 'name';
      out += afterName && target === null ? tok.t : structToExcel(w, tok.t, table, afterName);
    } else if (tok.k === 'name') {
      const cell = cellOf(tok.t);
      const row = rowNumber(tok.t);
      if (cell) {
        const r = moved(cell.row, w.shift(table, true));
        out += ownPrefix(at, target) + (r === null ? '#REF!' : cellText(cell, r));
      } else if (row && w.rowRef(at)) {
        out += ownPrefix(at, target) + rowText(row.abs, row.row, w.shift(table, true));
      } else if (tok.t === 'E' || tok.t === 'e') {
        out += 'EXP(1)';
      } else {
        if (w.rowRef(at) && /^\$?[A-Za-z]+$/.test(tok.t)) out += ownPrefix(at, target);
        out += tok.t;
      }
    } else if (tok.k === 'num' && w.rowRef(at) && rowNumber(tok.t)) {
      const row = rowNumber(tok.t)!;
      out += ownPrefix(at, target) + rowText(row.abs, row.row, w.shift(table, true));
    } else out += tok.t;
    w.track(at);
  });
  return out;
}

function structFromExcel(w: Walker, raw: string, t: number): string {
  const table = w.cx.book[t];
  const inner = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  const unwrap = (s: string): string => (s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s);
  const prefix = '[#This Row],';
  let thisRow: boolean;
  let column: string;
  if (inner.startsWith('@')) {
    thisRow = true;
    column = unwrap(inner.slice(1));
  } else if (inner.length > prefix.length && inner.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
    thisRow = true;
    column = unwrap(inner.slice(prefix.length));
  } else if (inner.startsWith('[') || inner.startsWith('#')) {
    return table.name + raw;
  } else {
    thisRow = false;
    column = inner;
  }
  const name = excelUnescape(column).replaceAll(']', ']]');
  const own = t === w.cx.own;
  const range = w.inRangeFunction();
  if (own && thisRow) return range ? `[@${name}]` : `[${name}]`;
  if (own && range) return `[${name}]`;
  return thisRow ? `${table.name}[@${name}]` : `${table.name}[${name}]`;
}

/** Translates an Excel formula in file form, without its =, into OpenNote's stored form. */
export function fromExcel(formula: string, cx: TranslateContext): string {
  const w = new Walker(tokenize(formula, true), cx);
  let out = '';
  let qualified: number | null = null;
  w.toks.forEach((tok, at) => {
    const target = qualified;
    qualified = null;
    const table = target ?? cx.own;
    if (tok.k === 'name' && w.nextIs(at, '(')) {
      out += stripPrefixes(tok.t);
    } else if ((tok.k === 'name' || tok.k === 'quoted') && w.nextIs(at, '!')) {
      const sheet = tok.k === 'quoted' ? tok.t.slice(1, -1).replaceAll("''", "'") : tok.t;
      const t = w.tableOnSheet(sheet);
      if (t >= 0) {
        out += cx.book[t].name;
        qualified = t;
      } else out += tok.t;
    } else if (tok.k === 'text' && tok.t === '!') {
      out += '!';
      qualified = target;
    } else if (tok.k === 'name' && w.toks[at + 1]?.k === 'bracket') {
      const t = w.tableNamed(tok.t, true);
      if (t >= 0) qualified = t;
      else out += tok.t;
    } else if (tok.k === 'bracket') {
      out += structFromExcel(w, tok.t, table);
    } else if (tok.k === 'name') {
      const cell = cellOf(tok.t);
      const row = rowNumber(tok.t);
      if (cell) {
        const r = moved(cell.row, w.shift(table, false));
        out += r === null ? '#REF!' : cellText(cell, r);
      } else if (row && w.rowRef(at)) out += rowText(row.abs, row.row, w.shift(table, false));
      else out += stripPrefixes(tok.t);
    } else if (tok.k === 'num' && w.rowRef(at) && rowNumber(tok.t)) {
      const row = rowNumber(tok.t)!;
      out += rowText(row.abs, row.row, w.shift(table, false));
    } else out += tok.t;
    w.track(at);
  });
  return out;
}
