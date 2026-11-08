// Text functions that turn values into text and back: TEXT, VALUE, NUMBERVALUE, DOLLAR, FIXED, BAHTTEXT,
// ARRAYTOTEXT, and VALUETOTEXT. Owner: tables:fn-text.
import {
  ERROR_TOKENS,
  err,
  isArray,
  textToNumber,
  toNumber,
  toScalar,
  toText,
  type FormulaError,
  type Scalar,
  type Value,
} from '../../values';
import { makeArray } from '../../arrays';
import { compile, renderCompiled } from '../../numfmt';
import { EN_US } from '../../locale';
import { array, bool, define, int, num, roundAt, text, tooLong, value } from './textKit';
import type { FnSpec2 } from './types';

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
  return typeof v === 'object' && v !== null ? ERROR_TOKENS[v.error] : null;
}

function shown(v: Scalar, strict: boolean): string {
  return errorText(v) ?? itemText(v, strict);
}

export const formatFunctions: readonly FnSpec2[] = [
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
