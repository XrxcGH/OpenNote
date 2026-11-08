// Text functions. Owner: tables:fn-text. Every function is written from its documented behavior. Positions count UTF-16
// units, as Excel's do. The byte variants (LENB, LEFTB, and the rest) count every character as one byte, because
// OpenNote has no double-byte region yet (see fixtures/fn/DIFFERENCES.md).

import { makeArray } from '../../arrays';
import { compile, renderCompiled } from '../../numfmt';
import { EN_US } from '../../locale';
import {
  err,
  isArray,
  isError,
  textToNumber,
  toNumber,
  toScalar,
  toText,
  type FormulaError,
  type Scalar,
  type Value,
} from '../../values';
import { hasWildcard, wildcardMatcher } from './criteria';
import type { FnSpec2, Param } from './types';

/** The most characters a cell holds. A function that would build more gives #VALUE!. */
export const MAX_TEXT = 32767;

// ---------------------------------------------------------------------------------------------------------------
// Small helpers.

const text = (name: string, optional = false): Param => ({ name, kind: 'text', ...(optional ? { optional } : {}) });
const num = (name: string, optional = false): Param => ({ name, kind: 'number', ...(optional ? { optional } : {}) });
const bool = (name: string, optional = false): Param => ({ name, kind: 'bool', ...(optional ? { optional } : {}) });
const value = (name: string, optional = false): Param => ({ name, kind: 'value', ...(optional ? { optional } : {}) });
const array = (name: string, optional = false): Param => ({ name, kind: 'array', ...(optional ? { optional } : {}) });

function signatureOf(name: string, params: readonly (Param | { repeat: readonly Param[] })[]): string {
  const parts = params.map((p) =>
    'repeat' in p ? `${p.repeat.map((r) => r.name).join(', ')}, ...` : p.optional === true ? `[${p.name}]` : p.name,
  );
  return `${name}(${parts.join(', ')})`;
}

function define(
  name: string,
  params: readonly (Param | { repeat: readonly Param[]; min?: number })[],
  run: FnSpec2['run'],
  example: string,
  extra: Partial<FnSpec2> = {},
): FnSpec2 {
  return { name, family: 'text', params, run, meta: { signature: signatureOf(name, params), example }, ...extra };
}

/** A whole number from an argument, or its error. An omitted argument is the default. */
function int(v: Value | undefined, dflt: number): number | FormulaError {
  if (v === undefined) return dflt;
  const n = toNumber(v);
  return typeof n === 'number' ? Math.trunc(n) : n;
}

/** An argument as a list of texts: an array gives every item, a single value gives itself. */
function listOf(v: Value | undefined): string[] | FormulaError {
  if (v === undefined || v === null) return [];
  const items = isArray(v) ? v.data : [toScalar(v)];
  const out: string[] = [];
  for (const item of items) {
    const s = toText(item);
    if (typeof s !== 'string') return s;
    out.push(s);
  }
  return out;
}

const tooLong = (s: string): FormulaError | string => (s.length > MAX_TEXT ? err('VALUE') : s);

/** Rounds half away from zero at a number of decimal digits, by shifting the exponent so 1.005 rounds as written. */
function roundAt(n: number, digits: number): number {
  const shift = (x: number, d: number): number => {
    const [mantissa, exponent] = x.toExponential().split('e');
    return Number(`${mantissa}e${Number(exponent) + d}`);
  };
  return Math.sign(n) * shift(Math.round(shift(Math.abs(n), digits)), -digits);
}

// ---------------------------------------------------------------------------------------------------------------
// Character codes. CHAR and CODE use the Windows Latin-1 set (code page 1252), the set Excel for Windows uses.

const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d,
  0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d,
  0x017e, 0x0178,
];

function charOf(code: number): string | null {
  if (code < 1 || code > 255) return null;
  return String.fromCharCode(code >= 128 && code <= 159 ? CP1252_HIGH[code - 128] : code);
}

function codeOf(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 128 || (cp >= 160 && cp <= 255)) return cp;
  const at = CP1252_HIGH.indexOf(cp);
  return at >= 0 ? 128 + at : 63;
}

// ---------------------------------------------------------------------------------------------------------------
// Searching.

/** The index of the first match of a wildcard pattern (? and *, ~ escapes) at or after `from`, or -1. */
function searchFrom(find: string, within: string, from: number): number {
  if (!hasWildcard(find)) return within.toLowerCase().indexOf(find.replace(/~([*?~])/g, '$1').toLowerCase(), from);
  // The pattern may match any amount of text after its end, so a trailing star makes it a prefix test.
  const tildes = /~*$/.exec(find)?.[0].length ?? 0;
  const matcher = wildcardMatcher(`${find}${tildes % 2 === 1 ? '~' : ''}*`);
  for (let i = from; i <= within.length; i++) if (matcher(within.slice(i))) return i;
  return -1;
}

function finder(name: string, caseSensitive: boolean, example: string): FnSpec2 {
  return define(
    name,
    [text('find_text'), text('within_text'), num('start_num', true)],
    ([f, w, s]) => {
      const find = toText(f);
      if (typeof find !== 'string') return find;
      const within = toText(w);
      if (typeof within !== 'string') return within;
      const start = int(s, 1);
      if (typeof start !== 'number') return start;
      if (start < 1 || start > within.length) return err('VALUE');
      const at = caseSensitive ? within.indexOf(find, start - 1) : searchFrom(find, within, start - 1);
      return at < 0 ? err('VALUE') : at + 1;
    },
    example,
  );
}

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

// ---------------------------------------------------------------------------------------------------------------
// Number to text.

const FORMAT_CACHE = new Map<string, ReturnType<typeof compile>>();

function compiled(code: string): ReturnType<typeof compile> {
  let result = FORMAT_CACHE.get(code);
  if (result === undefined) {
    result = compile(code);
    if (FORMAT_CACHE.size > 500) FORMAT_CACHE.clear();
    FORMAT_CACHE.set(code, result);
  }
  return result;
}

function formatted(v: Scalar, code: string): Value {
  if (code === '') return '';
  const result = compiled(code);
  if (!result.ok) return err('VALUE');
  let input: number | string;
  if (typeof v === 'string') {
    // Text that reads as a number is formatted as that number, as Excel does.
    const n = textToNumber(v);
    input = n ?? v;
  } else if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  else if (v === null) input = 0;
  else if (typeof v === 'number') input = v;
  else return v;
  return renderCompiled(input, result.compiled, EN_US).text;
}

/** NUMBERVALUE: text to a number with chosen separators. */
function numberValue(source: string, decimal: string, group: string): Value {
  if (decimal === group) return err('VALUE');
  let s = source.replace(/\s/g, '');
  if (s === '') return 0;
  let percents = 0;
  while (s.endsWith('%')) {
    percents++;
    s = s.slice(0, -1);
  }
  const dot = s.indexOf(decimal);
  if (dot >= 0 && s.indexOf(decimal, dot + 1) >= 0) return err('VALUE');
  const whole = dot >= 0 ? s.slice(0, dot) : s;
  const rest = dot >= 0 ? s.slice(dot + decimal.length) : '';
  if (rest.includes(group)) return err('VALUE');
  const cleaned = `${whole.split(group).join('')}${dot >= 0 ? '.' : ''}${rest}`;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return err('VALUE');
  const n = Number(cleaned) / 100 ** percents;
  return Number.isFinite(n) ? n : err('NUM');
}

function firstChar(v: Value | undefined, dflt: string): string | FormulaError {
  if (v === undefined) return dflt;
  const s = toText(v);
  if (typeof s !== 'string') return s;
  return s === '' ? dflt : s.slice(0, 1);
}

function zeros(digits: number): string {
  return digits > 0 ? `.${'0'.repeat(Math.min(digits, 127))}` : '';
}

// ---------------------------------------------------------------------------------------------------------------
// BAHTTEXT: a number in Thai words, by the rules of the Royal Institute: yi sip for 20, et for a final 1.

const THAI_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** 1 to 999,999. `more` is true when digits of a higher group came before, so a final 1 is "et". */
function thaiGroup(n: number, more: boolean): string {
  const digits = String(n);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[i]);
    const place = digits.length - 1 - i;
    if (d === 0) continue;
    if (place === 1) out += d === 1 ? 'สิบ' : d === 2 ? 'ยี่สิบ' : `${THAI_DIGITS[d]}สิบ`;
    else if (place === 0 && d === 1 && (digits.length > 1 || more)) out += 'เอ็ด';
    else out += `${THAI_DIGITS[d]}${THAI_PLACES[place]}`;
  }
  return out;
}

function thaiInteger(n: number, more = false): string {
  if (n >= 1_000_000) {
    const high = Math.floor(n / 1_000_000);
    const low = n % 1_000_000;
    return `${thaiInteger(high, more)}ล้าน${low > 0 ? thaiGroup(low, true) : ''}`;
  }
  return thaiGroup(n, more);
}

function bahtText(x: number): string {
  const satangTotal = Math.round(Math.abs(x) * 100);
  const baht = Math.floor(satangTotal / 100);
  const satang = satangTotal % 100;
  let out = x < 0 && satangTotal > 0 ? 'ลบ' : '';
  if (baht > 0 || satang === 0) out += `${baht === 0 ? THAI_DIGITS[0] : thaiInteger(baht)}บาท`;
  out += satang === 0 ? 'ถ้วน' : `${thaiInteger(satang)}สตางค์`;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Arrays to text.

function itemText(v: Scalar, strict: boolean): string {
  if (typeof v === 'string') return strict ? `"${v.replace(/"/g, '""')}"` : v;
  const s = toText(v);
  return typeof s === 'string' ? s : '';
}

function errorText(v: Scalar): string | null {
  return typeof v === 'object' && v !== null ? ERROR_TEXT(v) : null;
}

function ERROR_TEXT(e: FormulaError): string {
  const tokens: Record<string, string> = {
    DIV0: '#DIV/0!',
    VALUE: '#VALUE!',
    REF: '#REF!',
    NAME: '#NAME?',
    NUM: '#NUM!',
    NA: '#N/A',
    NULL: '#NULL!',
    SPILL: '#SPILL!',
    CALC: '#CALC!',
    FIELD: '#FIELD!',
    BUSY: '#BUSY!',
    CYCLE: '#REF!',
  };
  return tokens[e.error] ?? '#VALUE!';
}

function shown(v: Scalar, strict: boolean): string {
  return errorText(v) ?? itemText(v, strict);
}

// ---------------------------------------------------------------------------------------------------------------

function text1(name: string, f: (s: string) => Value, example: string): FnSpec2 {
  return define(
    name,
    [text('text')],
    ([v]) => {
      const s = toText(v);
      return typeof s === 'string' ? f(s) : s;
    },
    example,
  );
}

function edge(name: string, pick: (s: string, n: number) => string, example: string): FnSpec2 {
  return define(
    name,
    [text('text'), num('num_chars', true)],
    ([v, count]) => {
      const s = toText(v);
      const n = int(count, 1);
      if (typeof s !== 'string') return s;
      if (typeof n !== 'number') return n;
      return n < 0 ? err('VALUE') : pick(s, n);
    },
    example,
  );
}

const left = (s: string, n: number): string => s.slice(0, n);
const right = (s: string, n: number): string => (n === 0 ? '' : s.slice(-n));

function midOf(name: string, example: string): FnSpec2 {
  return define(
    name,
    [text('text'), num('start_num'), num('num_chars')],
    ([v, a, b]) => {
      const s = toText(v);
      const start = int(a, 1);
      const count = int(b, 0);
      if (typeof s !== 'string') return s;
      for (const x of [start, count]) if (typeof x !== 'number') return x;
      if ((start as number) < 1 || (count as number) < 0) return err('VALUE');
      return s.slice((start as number) - 1, (start as number) - 1 + (count as number));
    },
    example,
  );
}

function replaceOf(name: string, example: string): FnSpec2 {
  return define(
    name,
    [text('old_text'), num('start_num'), num('num_chars'), text('new_text')],
    ([o, a, b, n]) => {
      const old = toText(o);
      const added = toText(n);
      const start = int(a, 1);
      const count = int(b, 0);
      if (typeof old !== 'string') return old;
      if (typeof added !== 'string') return added;
      for (const x of [start, count]) if (typeof x !== 'number') return x;
      if ((start as number) < 1 || (count as number) < 0) return err('VALUE');
      const at = (start as number) - 1;
      return tooLong(old.slice(0, at) + added + old.slice(at + (count as number)));
    },
    example,
  );
}

function bytes(name: string, base: FnSpec2): FnSpec2 {
  const example = base.meta.example.replace(base.name, name);
  return { ...base, name, meta: { signature: base.meta.signature.replace(base.name, name), example } };
}

const concat = (name: string, kind: 'range' | 'text'): FnSpec2 => {
  const param: Param = kind === 'range' ? { name: 'text', kind, direct: 'raw' } : { name: 'text', kind };
  return define(
    name,
    [{ repeat: [param], min: 1 }],
    (args) => {
      let out = '';
      for (const v of args) {
        const s = toText(v);
        if (typeof s !== 'string') return s;
        out += s;
      }
      return tooLong(out);
    },
    name === 'CONCAT' ? '=CONCAT("pen", "cil") gives pencil' : '=CONCATENATE("note", "book") gives notebook',
  );
};

const LEN = text1('LEN', (s) => s.length, '=LEN("paper") gives 5');
const LEFT = edge('LEFT', left, '=LEFT("notebook", 4) gives note');
const RIGHT = edge('RIGHT', right, '=RIGHT("notebook", 4) gives book');
const MID = midOf('MID', '=MID("notebook", 5, 4) gives book');
const REPLACE = replaceOf('REPLACE', '=REPLACE("notebook", 1, 4, "face") gives facebook');
const FIND = finder('FIND', true, '=FIND("b", "abcabc", 3) gives 5');
const SEARCH = finder('SEARCH', false, '=SEARCH("e*t", "Statements") gives 5');

export const functions: readonly FnSpec2[] = [
  concat('CONCAT', 'range'),
  concat('CONCATENATE', 'text'),
  LEN,
  bytes('LENB', LEN),
  text1('LOWER', (s) => s.toLowerCase(), '=LOWER("Ink") gives ink'),
  text1('UPPER', (s) => s.toUpperCase(), '=UPPER("Ink") gives INK'),
  text1('TRIM', (s) => s.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' '), '=TRIM("  a   b ") gives a b'),
  LEFT,
  bytes('LEFTB', LEFT),
  RIGHT,
  bytes('RIGHTB', RIGHT),
  MID,
  bytes('MIDB', MID),
  REPLACE,
  bytes('REPLACEB', REPLACE),
  FIND,
  bytes('FINDB', FIND),
  SEARCH,
  bytes('SEARCHB', SEARCH),
  text1(
    'PROPER',
    (s) => {
      let out = '';
      let inWord = false;
      for (const ch of s) {
        const letter = /\p{L}/u.test(ch);
        out += letter ? (inWord ? ch.toLowerCase() : ch.toUpperCase()) : ch;
        inWord = letter;
      }
      return out;
    },
    '=PROPER("this is a TITLE") gives This Is A Title',
  ),
  text1(
    'CLEAN',
    (s) =>
      Array.from(s)
        .filter((ch) => (ch.codePointAt(0) as number) > 31)
        .join(''),
    '=CLEAN("a" & CHAR(7) & "b") gives ab',
  ),
  define(
    'EXACT',
    [text('text1'), text('text2')],
    ([a, b]) => {
      const x = toText(a);
      const y = toText(b);
      if (typeof x !== 'string') return x;
      return typeof y !== 'string' ? y : x === y;
    },
    '=EXACT("Ink", "ink") gives FALSE',
  ),
  define(
    'REPT',
    [text('text'), num('number_times')],
    ([v, n]) => {
      const s = toText(v);
      const times = int(n, 0);
      if (typeof s !== 'string') return s;
      if (typeof times !== 'number') return times;
      if (times < 0 || s.length * times > MAX_TEXT) return err('VALUE');
      return s.repeat(times);
    },
    '=REPT("ab", 3) gives ababab',
  ),
  define(
    'SUBSTITUTE',
    [text('text'), text('old_text'), text('new_text'), num('instance_num', true)],
    ([v, o, n, k]) => {
      const s = toText(v);
      const old = toText(o);
      const added = toText(n);
      const instance = int(k, 0);
      if (typeof s !== 'string') return s;
      if (typeof old !== 'string') return old;
      if (typeof added !== 'string') return added;
      if (typeof instance !== 'number') return instance;
      if (k !== undefined && instance < 1) return err('VALUE');
      if (old === '') return s;
      if (k === undefined) return tooLong(s.split(old).join(added));
      let at = -1;
      for (let i = 0; i < instance; i++) {
        at = s.indexOf(old, at < 0 ? 0 : at + old.length);
        if (at < 0) return s;
      }
      return tooLong(s.slice(0, at) + added + s.slice(at + old.length));
    },
    '=SUBSTITUTE("a-b-c", "-", "+", 2) gives a-b+c',
  ),
  define(
    'T',
    [value('value')],
    ([v]) => {
      const s = toScalar(v);
      return typeof s === 'string' || (typeof s === 'object' && s !== null) ? s : '';
    },
    '=T("ink") gives ink, and =T(5) gives empty text',
  ),
  define(
    'CHAR',
    [num('number')],
    ([v]) => {
      const n = int(v, 0);
      if (typeof n !== 'number') return n;
      return charOf(n) ?? err('VALUE');
    },
    '=CHAR(65) gives A',
  ),
  text1('CODE', (s) => (s === '' ? err('VALUE') : codeOf(s)), '=CODE("A") gives 65'),
  define(
    'UNICHAR',
    [num('number')],
    ([v]) => {
      const n = int(v, 0);
      if (typeof n !== 'number') return n;
      if (n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return err('VALUE');
      return String.fromCodePoint(n);
    },
    '=UNICHAR(8364) gives the euro sign',
  ),
  text1('UNICODE', (s) => (s === '' ? err('VALUE') : (s.codePointAt(0) as number)), '=UNICODE("€") gives 8364'),
  text1(
    'ENCODEURL',
    (s) => {
      try {
        return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      } catch {
        return err('VALUE');
      }
    },
    '=ENCODEURL("a b&c") gives a%20b%26c',
  ),
  text1('ASC', (s) => s, '=ASC("ink") gives ink'),
  text1('DBCS', (s) => s, '=DBCS("ink") gives ink'),
  define('PHONETIC', [value('reference')], ([v]) => toText(v), '=PHONETIC("ink") gives ink'),
  define(
    'TEXT',
    [value('value'), text('format_text')],
    ([v, f]) => {
      const code = toText(f);
      return typeof code === 'string' ? formatted(toScalar(v), code) : code;
    },
    '=TEXT(1234.567, "#,##0.00") gives 1,234.57',
  ),
  define(
    'VALUE',
    [value('text')],
    ([v]) => {
      const s = toScalar(v);
      if (typeof s === 'number') return s;
      if (s === null) return 0;
      if (typeof s === 'string') return textToNumber(s) ?? err('VALUE');
      return typeof s === 'boolean' ? err('VALUE') : s;
    },
    '=VALUE("$1,000") gives 1000',
  ),
  define(
    'NUMBERVALUE',
    [text('text'), text('decimal_separator', true), text('group_separator', true)],
    ([v, d, g]) => {
      const s = toText(v);
      const dec = firstChar(d, EN_US.decimal);
      const grp = firstChar(g, EN_US.group);
      if (typeof s !== 'string') return s;
      if (typeof dec !== 'string') return dec;
      if (typeof grp !== 'string') return grp;
      return numberValue(s, dec, grp);
    },
    '=NUMBERVALUE("2.500,27", ",", ".") gives 2500.27',
  ),
  define(
    'DOLLAR',
    [num('number'), num('decimals', true)],
    ([v, d]) => {
      const n = toNumber(v);
      const digits = int(d, 2);
      if (typeof n !== 'number') return n;
      if (typeof digits !== 'number') return digits;
      const places = Math.max(digits, 0);
      const code = `$#,##0${zeros(places)};($#,##0${zeros(places)})`;
      return formatted(roundAt(n, digits), code);
    },
    '=DOLLAR(1234.567, 2) gives $1,234.57',
  ),
  define(
    'FIXED',
    [num('number'), num('decimals', true), bool('no_commas', true)],
    ([v, d, c]) => {
      const n = toNumber(v);
      const digits = int(d, 2);
      const plain = c === undefined ? false : toScalar(c) === true || (typeof toScalar(c) === 'number' && c !== 0);
      if (typeof n !== 'number') return n;
      if (typeof digits !== 'number') return digits;
      const code = `${plain ? '0' : '#,##0'}${zeros(Math.max(digits, 0))}`;
      return formatted(roundAt(n, digits), code);
    },
    '=FIXED(1234.567, 1) gives 1,234.6',
  ),
  define(
    'BAHTTEXT',
    [num('number')],
    ([v]) => {
      const n = toNumber(v);
      return typeof n === 'number' ? bahtText(n) : n;
    },
    '=BAHTTEXT(21.5) gives the Thai words for twenty-one baht and fifty satang',
  ),
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
  define(
    'ARRAYTOTEXT',
    [array('array'), num('format', true)],
    ([v, f]) => {
      const format = int(f, 0);
      if (typeof format !== 'number') return format;
      if (format !== 0 && format !== 1) return err('VALUE');
      const a = isArray(v) ? v : makeArray(1, 1, [toScalar(v)]);
      const strict = format === 1;
      if (!strict) return tooLong(a.data.map((x) => shown(x, false)).join(', '));
      if (a.data.length === 1) return shown(a.data[0], true);
      const rows: string[] = [];
      for (let r = 0; r < a.rows; r++) {
        rows.push(
          a.data
            .slice(r * a.cols, (r + 1) * a.cols)
            .map((x) => shown(x, true))
            .join(','),
        );
      }
      return tooLong(`{${rows.join(';')}}`);
    },
    '=ARRAYTOTEXT({1,2;3,4}) gives 1, 2, 3, 4',
    { handlesErrors: true },
  ),
  define(
    'VALUETOTEXT',
    [value('value'), num('format', true)],
    ([v, f]) => {
      const format = int(f, 0);
      if (typeof format !== 'number') return format;
      if (format !== 0 && format !== 1) return err('VALUE');
      return shown(toScalar(v), format === 1);
    },
    '=VALUETOTEXT("ink", 1) gives "ink" with its quotes',
    { handlesErrors: true },
  ),
];
