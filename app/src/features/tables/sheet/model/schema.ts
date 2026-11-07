// The grammar of `data.sheet` (format spec 6.3, R-SHT-3 to R-SHT-22), as checks that list problems. It follows the
// reference reader's schema in docs/format/tools/schema_sheet.py. So each problem reads the same: a path, a colon,
// and what the value should be. A reader keeps a sheet with problems and reads the invalid values as missing.

import { ACCOUNTING_UNDERLINES, ELEMENT_ID, UNDERLINE_STYLES, isColor, isFontName, isInteger, onStep } from './grammar';
import { BORDER_SIDES, BORDER_STYLES, ICON_SETS, LOOK_ELEMENTS, OPS, PATTERNS, PERIODS } from './enums';
import { isObject, type Json, type JsonObject } from './json';

export type Check = (value: Json, path: string) => string[];

const length = (text: string) => [...text].length;

function ok(test: (value: Json) => boolean, what: string): Check {
  return (value, path) => (test(value) ? [] : [`${path}: ${what}`]);
}

function oneOf(...values: string[]): Check {
  return ok((v) => typeof v === 'string' && values.includes(v), `one of ${values.join(', ')}`);
}

const BOOL = ok((v) => typeof v === 'boolean', 'a boolean');
const ANY_COLOR = ok(isColor, 'a color (Appendix D.7)');
const COLOR_OR_NONE = ok((v) => v === 'none' || isColor(v), 'a color or none');
const FONT = ok(isFontName, 'a font name or token (Appendix D.2)');
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const WHEN = ok((v) => typeof v === 'string' && TIMESTAMP.test(v), 'a timestamp');
const SHORT_ID = /^[a-z0-9]{1,16}$/;
export const STYLE_ID = /^[0-9a-z]{1,16}$/;
const LOOK = /^[a-z0-9-]{1,32}$/;
const ELEMENT = ok((v) => typeof v === 'string' && ELEMENT_ID.test(v), 'an ID');
const STYLE_REF = ok((v) => typeof v === 'string' && STYLE_ID.test(v), 'a style ID');

function integer(lo: number, hi: number): Check {
  return ok((v) => isInteger(v, lo, hi), `an integer from ${lo} to ${hi}`);
}

function points(lo: number, hi: number, step: string): Check {
  return ok((v) => onStep(v, lo, hi, step), `a number from ${lo} to ${hi}, step ${step}`);
}

function text(lo: number, hi: number): Check {
  return ok(
    (v) => typeof v === 'string' && length(v) >= lo && length(v) <= hi,
    `a string of ${lo} to ${hi} characters`,
  );
}

function utf8(limit: number): Check {
  return ok(
    (v) => typeof v === 'string' && new TextEncoder().encode(v).length <= limit,
    `text of at most ${limit} bytes`,
  );
}

/** Passes when one of the checks passes, else gives the shortest list of problems (the first of equal length). */
function either(...checks: Check[]): Check {
  return (value, path) => {
    let best: string[] | null = null;
    for (const check of checks) {
      const found = check(value, path);
      if (found.length === 0) return [];
      if (best === null || found.length < best.length) best = found;
    }
    return best ?? [];
  };
}

function obj(fields: Record<string, Check>, required: readonly string[] = []): Check {
  return (value, path) => {
    if (!isObject(value)) return [`${path}: an object`];
    const found = required.filter((key) => !Object.hasOwn(value, key)).map((key) => `${path}.${key}: required`);
    for (const key of Object.keys(value)) {
      const check = Object.hasOwn(fields, key) ? fields[key] : undefined;
      if (!check) found.push(`${path}.${key}: not a key of this object`);
      else found.push(...check(value[key], `${path}.${key}`));
    }
    return found;
  };
}

function array(item: Check, lo: number, hi: number): Check {
  return (value, path) => {
    if (!Array.isArray(value) || value.length < lo || value.length > hi)
      return [`${path}: an array of ${lo} to ${hi} items`];
    return value.flatMap((x, i) => item(x, `${path}[${i}]`));
  };
}

/** Python's repr of a string key, as the reference reader writes it in a problem. */
function repr(key: string): string {
  if (key.includes("'") && !key.includes('"')) return `"${key}"`;
  return `'${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function mapping(keyTest: (key: string) => boolean, item: Check, limit: number, what: string): Check {
  return (value, path) => {
    if (!isObject(value) || Object.keys(value).length > limit) return [`${path}: a map of at most ${limit} entries`];
    const found: string[] = [];
    for (const key of Object.keys(value)) {
      if (!keyTest(key)) found.push(`${path}: key ${repr(key)} is not ${what}`);
      found.push(...item(value[key], `${path}.${key}`));
    }
    return found;
  };
}

const isId = (key: string) => ELEMENT_ID.test(key);
const isShort = (key: string) => SHORT_ID.test(key);

const NAME = /^(?:[\p{L}\p{Nl}\p{No}_][\p{L}\p{N}_.]{0,254}|\\[\p{L}\p{N}_.]{0,254})$/u;
const CELL_REF = /^(?:[A-Za-z]{1,3}[0-9]{1,7}|[RrCc]|[Rr][0-9]+|[Cc][0-9]+|[Rr][0-9]+[Cc][0-9]+)$/;

/** A name of R-SHT-13: starts with a letter, `_`, or `\`, goes on with letters, digits, `_`, `.`, and is no reference. */
export function isName(key: unknown): key is string {
  return typeof key === 'string' && NAME.test(key) && !CELL_REF.test(key);
}

// Cell styles (R-SHT-7).

const FONT_OBJ = obj({
  family: FONT,
  size: points(1, 1638, '0.5'),
  weight: points(100, 900, '100'),
  bold: BOOL,
  italic: BOOL,
  underline: oneOf(...UNDERLINE_STYLES, ...ACCOUNTING_UNDERLINES, 'none'),
  strike: oneOf('single', 'double', 'none'),
  color: ANY_COLOR,
  script: oneOf('super', 'sub', 'none'),
});
const STOP = obj({ at: points(0, 1, '0.0001'), color: ANY_COLOR }, ['at', 'color']);
const STOPS: Check = (value, path) => {
  const found = array(STOP, 2, 8)(value, path);
  if (found.length === 0 && Array.isArray(value)) {
    const at = value.map((s) => (s as JsonObject).at as number);
    if (at.some((x, i) => i > 0 && x < at[i - 1])) found.push(`${path}: stops in increasing order`);
  }
  return found;
};
const FILL = either(
  COLOR_OR_NONE,
  obj({ pattern: oneOf(...PATTERNS), color: ANY_COLOR, back: ANY_COLOR }, ['pattern']),
  obj({ gradient: obj({ angle: integer(0, 359), stops: STOPS }, ['stops']) }, ['gradient']),
);
const SIDE = obj({ style: oneOf(...BORDER_STYLES, 'none'), color: ANY_COLOR, width: points(0.25, 6, '0.125') }, [
  'style',
]);
const PT_POS = points(0, 1584, '0.05');
const PAD = obj({ t: PT_POS, r: PT_POS, b: PT_POS, l: PT_POS });
const ALIGN = obj({
  h: oneOf('general', 'left', 'center', 'right', 'fill', 'justify', 'centerAcross', 'distributed'),
  v: oneOf('top', 'middle', 'bottom', 'justify', 'distributed'),
  wrap: oneOf('wrap', 'overflow', 'clip'),
  shrink: BOOL,
  rotate: either(integer(-90, 90), oneOf('stacked')),
  indent: integer(0, 15),
  dir: oneOf('context', 'ltr', 'rtl'),
});
export const CELL_STYLE = obj({
  fmt: text(1, 255),
  font: FONT_OBJ,
  fill: FILL,
  border: obj(Object.fromEntries(BORDER_SIDES.map((side) => [side, SIDE]))),
  align: ALIGN,
  pad: PAD,
  protect: obj({ locked: BOOL, hideFormula: BOOL }),
});

// Table, rows, and columns (R-SHT-10, R-SHT-11).
const TABLE = obj({
  style: STYLE_REF,
  look: either(
    ok((v) => typeof v === 'string' && LOOK.test(v), 'a look name'),
    obj(Object.fromEntries(LOOK_ELEMENTS.map((e) => [e, STYLE_REF]))),
  ),
  band: obj({ rows: BOOL, cols: BOOL }),
  emphasis: obj({ firstCol: BOOL, lastCol: BOOL, totalRow: BOOL }),
  freeze: obj({ rows: integer(0, 1_000_000), cols: integer(0, 1_000_000) }),
  pad: PAD,
  grid: BOOL,
  name: ok(isName, 'a name (R-SHT-13)'),
});
const COL = obj({ style: STYLE_REF, hidden: BOOL, level: integer(0, 7), collapsed: BOOL });
const ROW = obj({
  style: STYLE_REF,
  height: points(1, 10000, '0.01'),
  exact: BOOL,
  hidden: BOOL,
  level: integer(0, 7),
  collapsed: BOOL,
});

// Merges, names, and rules (R-SHT-12 to R-SHT-15, R-SHT-22).
const CORNER = ok(
  (v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && isId(x)),
  '[row ID, column ID]',
);
const MERGE = obj({ from: CORNER, to: CORNER }, ['from', 'to']);
const NAMED = obj({ ref: text(1, 8192), scope: oneOf('table', 'page'), comment: text(0, 255) }, ['ref']);
const RANGE = either(
  obj({ col: ELEMENT }, ['col']),
  obj({ row: ELEMENT }, ['row']),
  obj({ from: CORNER, to: CORNER }, ['from', 'to']),
);
const RANGES = array(RANGE, 1, 64);
const MESSAGE = obj({ title: text(0, 32), text: text(0, 255) });
const VALIDATION = obj(
  {
    ranges: RANGES,
    kind: oneOf('any', 'whole', 'decimal', 'list', 'date', 'time', 'textLength', 'custom', 'checkbox'),
    op: oneOf(...OPS),
    a: text(0, 8192),
    b: text(0, 8192),
    items: array(text(1, 255), 1, 1000),
    source: text(1, 8192),
    dropDown: BOOL,
    checked: text(0, 255),
    unchecked: text(0, 255),
    ignoreBlank: BOOL,
    alert: oneOf('stop', 'warning', 'information'),
    input: MESSAGE,
    error: MESSAGE,
  },
  ['ranges'],
);
const AT = ['min', 'max', 'num', 'percent', 'percentile', 'formula'];
const SCALE_STOP = obj({ at: oneOf(...AT), value: text(0, 8192), color: ANY_COLOR }, ['at', 'color']);
const BAR_END = obj({ at: oneOf('auto', ...AT), value: text(0, 8192) }, ['at']);
const THRESHOLD = obj({ at: oneOf('num', 'percent', 'percentile', 'formula'), value: text(0, 8192), gte: BOOL }, [
  'at',
  'value',
]);
const COMMON: Record<string, Check> = {
  ranges: RANGES,
  order: integer(1, 256),
  stop: BOOL,
  style: STYLE_REF,
};
const TYPES: Record<string, Record<string, Check>> = {
  cell: { op: oneOf(...OPS), a: text(0, 8192), b: text(0, 8192) },
  text: { op: oneOf('contains', 'notContains', 'begins', 'ends'), text: text(1, 255) },
  date: { period: oneOf(...PERIODS) },
  blank: {},
  noBlank: {},
  error: {},
  noError: {},
  duplicate: {},
  unique: {},
  top: { rank: integer(1, 1000), percent: BOOL, bottom: BOOL },
  average: { below: BOOL, equal: BOOL, stdDev: integer(0, 3) },
  formula: { a: text(1, 8192) },
  scale: { stops: array(SCALE_STOP, 2, 3) },
  bar: {
    color: ANY_COLOR,
    gradient: BOOL,
    border: ANY_COLOR,
    min: BAR_END,
    max: BAR_END,
    negative: ANY_COLOR,
    axis: oneOf('auto', 'middle', 'none'),
    barOnly: BOOL,
  },
  icons: { set: oneOf(...ICON_SETS), reverse: BOOL, iconOnly: BOOL, thresholds: array(THRESHOLD, 2, 4) },
};
export const CONDITIONAL_TYPES = Object.keys(TYPES);
/** The types whose look is drawn, not a style (R-SHT-15). */
export const DRAWN_TYPES = ['scale', 'bar', 'icons'];

const CONDITIONAL: Check = (value, path) => {
  const type = isObject(value) ? value.type : undefined;
  if (typeof type !== 'string' || !Object.hasOwn(TYPES, type))
    return [`${path}.type: one of ${CONDITIONAL_TYPES.join(', ')}`];
  const fields: Record<string, Check> = { ...COMMON, ...TYPES[type], type: oneOf(type) };
  if (DRAWN_TYPES.includes(type)) delete fields.style;
  return obj(fields, ['ranges', 'order', 'type'])(value, path);
};
const NOTE = obj({ markdown: utf8(65536), at: WHEN }, ['markdown', 'at']);

const CACHED: Check = (value, path) => {
  if (value === null || typeof value === 'boolean') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path}: a finite number`];
  if (typeof value === 'string') return length(value) <= 32767 ? [] : [`${path}: at most 32,767 characters`];
  if (isObject(value) && Object.keys(value).length === 1 && typeof value.e === 'string') return [];
  return [`${path}: a number, string, boolean, null, or {"e": token}`];
};

function byCell(item: Check, limit: number): Check {
  return mapping(isId, mapping(isId, item, 100_000, 'a column ID'), limit, 'a row ID');
}

const FINGERPRINT = /^fnv1a:[0-9a-f]{16}$/;
const SHEET = obj({
  v: integer(1, 2 ** 31),
  styles: mapping((k) => STYLE_ID.test(k), CELL_STYLE, 4096, 'a style ID'),
  table: TABLE,
  cols: mapping(isId, COL, 100_000, 'a column ID'),
  rows: mapping(isId, ROW, 1_000_000, 'a row ID'),
  cells: byCell(STYLE_REF, 1_000_000),
  merges: mapping(isShort, MERGE, 10_000, 'a merge ID'),
  names: mapping(isName, NAMED, 1024, 'a name (R-SHT-13)'),
  validation: mapping(isShort, VALIDATION, 256, 'a rule ID'),
  conditional: mapping(isShort, CONDITIONAL, 256, 'a rule ID'),
  notes: byCell(NOTE, 10_000),
  values: byCell(CACHED, 1_000_000),
  valuesOf: ok((v) => typeof v === 'string' && FINGERPRINT.test(v), 'fnv1a: and 16 hex digits'),
  links: mapping((k) => length(k) >= 1 && length(k) <= 1000, ELEMENT, 1024, 'a page title'),
});

const TOTALS: [string, number, string][] = [
  ['cells', 1_000_000, 'cells'],
  ['notes', 10_000, 'notes'],
  ['values', 1_000_000, 'values'],
];

/** Every problem of a sheet: the grammar, the limits of section 16, unique names, and icon thresholds. */
export function sheetProblems(sheet: Json, path = 'sheet'): string[] {
  const found = SHEET(sheet, path);
  if (!isObject(sheet)) return found;
  for (const [key, limit, what] of TOTALS) {
    const rows = sheet[key];
    if (isObject(rows) && Object.values(rows).every(isObject)) {
      const count = Object.values(rows).reduce<number>((n, byCol) => n + Object.keys(byCol as JsonObject).length, 0);
      if (count > limit) found.push(`${path}.${key}: at most ${limit.toLocaleString('en-US')} ${what} per table`);
    }
  }
  if (isObject(sheet.names)) {
    const names = Object.keys(sheet.names).map((n) => n.toLowerCase());
    if (new Set(names).size !== names.length) found.push(`${path}.names: unique without regard to case (R-SHT-13)`);
  }
  if (isObject(sheet.conditional)) {
    for (const [id, rule] of Object.entries(sheet.conditional)) {
      if (!isObject(rule) || rule.type !== 'icons' || !Object.hasOwn(rule, 'thresholds')) continue;
      const set = typeof rule.set === 'string' ? rule.set : '3';
      const icons = Number(set[0]);
      const thresholds = rule.thresholds;
      if (Number.isInteger(icons) && Array.isArray(thresholds) && thresholds.length !== icons - 1) {
        found.push(`${path}.conditional.${id}.thresholds: one fewer than the icons (R-SHT-15)`);
      }
    }
  }
  return found;
}

/** The problems of one style (R-SHT-7), with paths below `path`. */
export function styleProblems(style: Json, path = 'style'): string[] {
  return CELL_STYLE(style, path);
}
