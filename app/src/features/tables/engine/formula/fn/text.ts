// Text functions. Owner: tables:fn-text. Every function is written from its documented behavior. Positions count UTF-16
// units, as Excel's do. The byte variants (LENB, LEFTB, and the rest) count every character as one byte, because
// OpenNote has no double-byte region yet (see fixtures/fn/DIFFERENCES.md).

import { err, toScalar, toText, type Value } from '../../values';
import { hasWildcard } from './criteria';
import { MAX_TEXT, define, int, num, text, tooLong, value } from './textKit';
import { wildcardSearch } from './textSearch';
import type { FnSpec2, Param } from './types';
import { formatFunctions } from './textFormat';
import { splitFunctions } from './textSplit';

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
  return wildcardSearch(find, within, from);
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
  ...formatFunctions,
  ...splitFunctions,
];
