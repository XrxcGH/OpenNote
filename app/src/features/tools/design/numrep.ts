// Number representations: integers in several signed schemes, IEEE 754 binary16, binary32 and binary64 decoded
// exactly and encoded with round-half-to-even, and characters as code points, UTF-8 and UTF-16.
import { bad } from './types';
import type { Outcome, Step } from './types';

// ---------- exact rationals ----------

/** A rational with a positive denominator, in lowest terms. */
export interface Rational {
  n: bigint;
  d: bigint;
}

const abs = (x: bigint): bigint => (x < 0n ? -x : x);

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function rat(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new RangeError('zero denominator');
  const s = d < 0n ? -1n : 1n;
  const g = gcd(n, d) || 1n;
  return { n: (s * n) / g, d: (s * d) / g };
}

const bitLength = (x: bigint): number => (x === 0n ? 0 : x.toString(2).length);

/** Decimal digits of a rational after rounding to `sig` significant digits, as a scientific string. */
export function ratToSci(r: Rational, sig = 17): string {
  if (r.n === 0n) return '0';
  const neg = r.n < 0n;
  const n = abs(r.n);
  // Find k with 10^k <= n/d < 10^(k+1).
  let k = n.toString().length - r.d.toString().length;
  const pow10 = (e: number): bigint => 10n ** BigInt(Math.abs(e));
  const ge = (e: number): boolean => (e >= 0 ? n >= r.d * pow10(e) : n * pow10(e) >= r.d);
  while (!ge(k)) k--;
  while (ge(k + 1)) k++;
  // digits = round(n/d * 10^(sig-1-k))
  const e = sig - 1 - k;
  const num = e >= 0 ? n * pow10(e) : n;
  const den = e >= 0 ? r.d : r.d * pow10(e);
  let q = num / den;
  const rem = num % den;
  if (2n * rem >= den) q += 1n;
  let s = q.toString();
  if (s.length > sig) {
    s = s.slice(0, sig);
    k++;
  }
  const frac = s.slice(1).replace(/0+$/, '');
  return `${neg ? '-' : ''}${s[0]}${frac ? `.${frac}` : ''}e${k}`;
}

/** Exact decimal expansion of a rational whose denominator is a power of two. */
export function dyadicToDecimal(r: Rational): string {
  if (r.n === 0n) return '0';
  let k = 0;
  let d = r.d;
  while (d > 1n) {
    if (d % 2n !== 0n) throw new RangeError('not a dyadic rational');
    d /= 2n;
    k++;
  }
  const neg = r.n < 0n;
  const digitsText = (abs(r.n) * 5n ** BigInt(k)).toString().padStart(k + 1, '0');
  const int = digitsText.slice(0, digitsText.length - k);
  const frac = digitsText.slice(digitsText.length - k).replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** Parses a decimal such as -12.5e-3 into an exact rational. Returns null when the text is not a number. */
export function parseDecimal(text: string): Rational | null {
  const m = /^([+-]?)(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!m) return null;
  const [, sign, ip = '', fp = '', ex] = m;
  if (ip === '' && fp === '') return null;
  const digits = BigInt(`${ip}${fp}` || '0');
  const exp = (ex ? Number(ex) : 0) - fp.length;
  if (Math.abs(exp) > 5000) return null;
  const n = sign === '-' ? -digits : digits;
  return exp >= 0 ? rat(n * 10n ** BigInt(exp)) : rat(n, 10n ** BigInt(-exp));
}

// ---------- integers ----------

export type IntScheme = 'unsigned' | 'twos' | 'ones' | 'signmag' | 'excess';

export function parseInteger(text: string): bigint | null {
  const s = text.trim().replace(/_/g, '');
  const m = /^([+-]?)(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+)$/.exec(s);
  if (!m) return null;
  const v = BigInt(m[2]!);
  return m[1] === '-' ? -v : v;
}

/** The range of values a width and scheme can hold. */
export function intRange(width: number, scheme: IntScheme, excess = 0n): { min: bigint; max: bigint } {
  const w = BigInt(width);
  const top = (1n << w) - 1n;
  switch (scheme) {
    case 'unsigned':
      return { min: 0n, max: top };
    case 'twos':
      return { min: -(1n << (w - 1n)), max: (1n << (w - 1n)) - 1n };
    case 'ones':
    case 'signmag':
      return { min: -((1n << (w - 1n)) - 1n), max: (1n << (w - 1n)) - 1n };
    case 'excess':
      return { min: -excess, max: top - excess };
  }
}

export interface IntEncoding {
  bits: string;
  value: bigint;
  steps: Step[];
}

/** Bit pattern of a value. An out-of-range value is an error; `wrapInt` shows what overflow does. */
export function encodeInt(value: bigint, width: number, scheme: IntScheme, excess = 0n): Outcome<IntEncoding> {
  if (!Number.isInteger(width) || width < 1 || width > 128) return bad('widthRange');
  if (scheme === 'excess' && (excess < 0n || excess > (1n << BigInt(width)))) return bad('excessRange');
  if (scheme !== 'unsigned' && width < 2 && scheme !== 'excess') return bad('widthRange');
  const { min, max } = intRange(width, scheme, excess);
  if (value < min || value > max) return bad('outOfRange');
  const w = BigInt(width);
  const mask = (1n << w) - 1n;
  let pattern: bigint;
  const steps: Step[] = [];
  switch (scheme) {
    case 'unsigned':
      pattern = value;
      break;
    case 'twos':
      pattern = value < 0n ? (value + (1n << w)) & mask : value;
      if (value < 0n) steps.push({ key: 'twos', latex: `2^{${width}}-${abs(value)}=${(1n << w) + value}` });
      break;
    case 'ones':
      pattern = value < 0n ? ~(-value) & mask : value;
      if (value < 0n) steps.push({ key: 'ones', latex: `\\overline{${abs(value).toString(2).padStart(width, '0')}}` });
      break;
    case 'signmag':
      pattern = value < 0n ? (1n << (w - 1n)) | -value : value;
      break;
    case 'excess':
      pattern = value + excess;
      steps.push({ key: 'excess', latex: `${value}+${excess}=${pattern}` });
      break;
  }
  return { ok: true, bits: pattern.toString(2).padStart(width, '0'), value, steps };
}

/** The value a bit pattern means in a scheme. */
export function decodeInt(bits: string, scheme: IntScheme, excess = 0n): Outcome<{ value: bigint }> {
  if (!/^[01]+$/.test(bits)) return bad('notBits');
  const width = bits.length;
  if (width > 128) return bad('widthRange');
  const p = BigInt(`0b${bits}`);
  const w = BigInt(width);
  switch (scheme) {
    case 'unsigned':
      return { ok: true, value: p };
    case 'twos':
      return { ok: true, value: bits[0] === '1' ? p - (1n << w) : p };
    case 'ones':
      return { ok: true, value: bits[0] === '1' ? -(~p & ((1n << w) - 1n)) : p };
    case 'signmag': {
      const mag = p & ((1n << (w - 1n)) - 1n);
      return { ok: true, value: bits[0] === '1' ? -mag : mag };
    }
    case 'excess':
      return { ok: true, value: p - excess };
  }
}

/** What happens to a value that does not fit: it wraps modulo 2^width (two's complement or unsigned). */
export function wrapInt(value: bigint, width: number, signed: boolean): bigint {
  const w = BigInt(width);
  const m = ((value % (1n << w)) + (1n << w)) % (1n << w);
  return signed && m >= 1n << (w - 1n) ? m - (1n << w) : m;
}

/** Division-remainder conversion of a non-negative integer to a base from 2 to 36, with every step. */
export function toBase(value: bigint, base: number): Outcome<{ text: string; steps: Step[] }> {
  if (!Number.isInteger(base) || base < 2 || base > 36) return bad('baseRange');
  const neg = value < 0n;
  let n = abs(value);
  const b = BigInt(base);
  if (n === 0n) return { ok: true, text: '0', steps: [{ key: 'divide', latex: `0\\div ${base}=0\\ r\\ 0` }] };
  const digits: string[] = [];
  const steps: Step[] = [];
  while (n > 0n) {
    const q = n / b;
    const r = n % b;
    steps.push({ key: 'divide', latex: `${n}\\div ${base}=${q}\\ \\text{r}\\ ${r}` });
    digits.push(r.toString(36).toUpperCase());
    n = q;
  }
  return { ok: true, text: `${neg ? '-' : ''}${digits.reverse().join('')}`, steps };
}

/** Parses digits in a base (2 to 36), optionally negative. */
export function fromBase(text: string, base: number): Outcome<{ value: bigint }> {
  if (!Number.isInteger(base) || base < 2 || base > 36) return bad('baseRange');
  const s = text.trim().replace(/_/g, '');
  const m = /^([+-]?)([0-9a-zA-Z]+)$/.exec(s);
  if (!m) return bad('notDigits');
  let v = 0n;
  for (const ch of m[2]!) {
    const dgt = parseInt(ch, 36);
    if (dgt >= base) return bad('digitTooBig');
    v = v * BigInt(base) + BigInt(dgt);
  }
  return { ok: true, value: m[1] === '-' ? -v : v };
}

export interface CppType {
  name: string;
  bits: number;
  signed: boolean;
  min: bigint;
  max: bigint;
}

/** C++ fixed-width and common types. `long` is 32 bits on Windows and 64 on Linux and macOS; both are shown. */
export const CPP_TYPES: readonly CppType[] = [
  ['bool', 8, false, 0n, 1n],
  ['char', 8, true, -128n, 127n],
  ['signed char / int8_t', 8, true, -128n, 127n],
  ['unsigned char / uint8_t', 8, false, 0n, 255n],
  ['short / int16_t', 16, true, -32768n, 32767n],
  ['unsigned short / uint16_t', 16, false, 0n, 65535n],
  ['int / int32_t', 32, true, -(2n ** 31n), 2n ** 31n - 1n],
  ['unsigned int / uint32_t', 32, false, 0n, 2n ** 32n - 1n],
  ['long (Windows)', 32, true, -(2n ** 31n), 2n ** 31n - 1n],
  ['long (Linux, macOS)', 64, true, -(2n ** 63n), 2n ** 63n - 1n],
  ['long long / int64_t', 64, true, -(2n ** 63n), 2n ** 63n - 1n],
  ['unsigned long long / uint64_t', 64, false, 0n, 2n ** 64n - 1n],
].map(([name, bits, signed, min, max]) => ({ name, bits, signed, min, max }) as CppType);

// ---------- floating point ----------

export interface FloatFormat {
  name: 'half' | 'single' | 'double';
  exp: number;
  frac: number;
  bias: number;
}

export const FLOAT_FORMATS: Record<FloatFormat['name'], FloatFormat> = {
  half: { name: 'half', exp: 5, frac: 10, bias: 15 },
  single: { name: 'single', exp: 8, frac: 23, bias: 127 },
  double: { name: 'double', exp: 11, frac: 52, bias: 1023 },
};

export type FloatClass = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan';

export interface FloatFields {
  sign: number;
  exponent: bigint;
  fraction: bigint;
}

export interface FloatDecoded extends FloatFields {
  cls: FloatClass;
  /** The exact value, or null for infinity and NaN. */
  exact: Rational | null;
  /** The exact decimal expansion, or the words infinity, -infinity or NaN. */
  decimal: string;
  /** The shortest decimal that encodes back to the same bits. */
  shortest: string;
  steps: Step[];
}

export const floatBits = (f: FloatFormat): number => 1 + f.exp + f.frac;

export function splitFloat(bits: bigint, f: FloatFormat): FloatFields {
  const fracMask = (1n << BigInt(f.frac)) - 1n;
  const expMask = (1n << BigInt(f.exp)) - 1n;
  return {
    sign: Number(bits >> BigInt(f.exp + f.frac)),
    exponent: (bits >> BigInt(f.frac)) & expMask,
    fraction: bits & fracMask,
  };
}

export function joinFloat(p: FloatFields, f: FloatFormat): bigint {
  return (BigInt(p.sign) << BigInt(f.exp + f.frac)) | (p.exponent << BigInt(f.frac)) | p.fraction;
}

/** m x 2^k as an exact rational. */
function scaled(m: bigint, k: number): Rational {
  return k >= 0 ? rat(m << BigInt(k)) : rat(m, 1n << BigInt(-k));
}

/** The exact value of finite fields (null for infinity and NaN). */
function exactOf(p: FloatFields, f: FloatFormat): Rational | null {
  const maxExp = (1n << BigInt(f.exp)) - 1n;
  if (p.exponent === maxExp) return null;
  const sgn = p.sign === 1 ? -1n : 1n;
  if (p.exponent === 0n) return scaled(sgn * p.fraction, 1 - f.bias - f.frac);
  return scaled(sgn * ((1n << BigInt(f.frac)) + p.fraction), Number(p.exponent) - f.bias - f.frac);
}

/** Decodes a bit pattern exactly. */
export function decodeFloat(bits: bigint, f: FloatFormat): Outcome<{ decoded: FloatDecoded }> {
  if (bits < 0n || bits >= 1n << BigInt(floatBits(f))) return bad('bitsRange');
  const p = splitFloat(bits, f);
  const maxExp = (1n << BigInt(f.exp)) - 1n;
  const sgn = p.sign === 1 ? -1n : 1n;
  const steps: Step[] = [
    { key: 'fields', latex: `s=${p.sign},\\ e=${p.exponent},\\ f=${p.fraction}` },
  ];
  let cls: FloatClass;
  let exact: Rational | null = null;
  if (p.exponent === maxExp) {
    cls = p.fraction === 0n ? 'infinity' : 'nan';
  } else if (p.exponent === 0n) {
    cls = p.fraction === 0n ? 'zero' : 'subnormal';
    const e = 1 - f.bias;
    exact = scaled(sgn * p.fraction, e - f.frac);
    if (cls === 'subnormal') {
      steps.push({ key: 'subnormal', latex: `(-1)^{${p.sign}}\\cdot 0.f\\cdot 2^{${e}}` });
    }
  } else {
    cls = 'normal';
    const e = Number(p.exponent) - f.bias;
    const sig = (1n << BigInt(f.frac)) + p.fraction;
    const shift = e - f.frac;
    exact = scaled(sgn * sig, shift);
    steps.push({ key: 'bias', latex: `E=e-\\text{bias}=${p.exponent}-${f.bias}=${e}` });
    steps.push({ key: 'significand', latex: `1.f=1+\\dfrac{${p.fraction}}{2^{${f.frac}}}=${dyadicToDecimal(rat(sig, 1n << BigInt(f.frac)))}` });
    steps.push({ key: 'value', latex: `(-1)^{${p.sign}}\\times 1.f\\times 2^{${e}}` });
  }
  let decimal: string;
  if (cls === 'infinity') decimal = p.sign ? '-infinity' : 'infinity';
  else if (cls === 'nan') decimal = 'NaN';
  else if (cls === 'zero') decimal = p.sign ? '-0' : '0';
  else decimal = dyadicToDecimal(exact!);
  const shortest = cls === 'zero' || cls === 'infinity' || cls === 'nan' ? decimal : shortestDecimal(exact!, bits, f);
  return { ok: true, decoded: { ...p, cls, exact, decimal, shortest, steps } };
}

/** Round-half-to-even division of two non-negative integers. */
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = 2n * r;
  if (twice > den || (twice === den && q % 2n === 1n)) return q + 1n;
  return q;
}

export interface FloatEncoding {
  bits: bigint;
  /** What the format stores, exactly, and the signed error (stored minus wanted) as a scientific string. */
  stored: Rational | null;
  error: string;
  rounded: boolean;
  overflow: boolean;
  steps: Step[];
}

/** Encodes a rational with round-half-to-even. Values too large become infinity. */
export function encodeRational(r: Rational, f: FloatFormat, negativeZero = false): FloatEncoding {
  const total = floatBits(f);
  const sign = r.n < 0n || (r.n === 0n && negativeZero) ? 1 : 0;
  const signBit = BigInt(sign) << BigInt(total - 1);
  const maxExp = (1n << BigInt(f.exp)) - 1n;
  if (r.n === 0n) return { bits: signBit, stored: rat(0n), error: '0', rounded: false, overflow: false, steps: [] };
  const n = abs(r.n);
  const eMin = 1 - f.bias;
  // floor(log2(n/d))
  let e = bitLength(n) - bitLength(r.d);
  const geTwoPow = (k: number): boolean => (k >= 0 ? n >= r.d << BigInt(k) : n << BigInt(-k) >= r.d);
  while (!geTwoPow(e)) e--;
  while (geTwoPow(e + 1)) e++;
  const steps: Step[] = [];
  let expField: bigint;
  let frac: bigint;
  let overflow = false;
  if (e < eMin) {
    // subnormal: value = frac * 2^(eMin - fracBits)
    const sh = eMin - f.frac;
    frac = divRound(sh >= 0 ? n : n << BigInt(-sh), sh >= 0 ? r.d << BigInt(sh) : r.d);
    expField = 0n;
    if (frac === 1n << BigInt(f.frac)) {
      expField = 1n;
      frac = 0n;
    }
    steps.push({ key: 'subnormal', latex: `E=${eMin}\\ (\\text{subnormal})` });
  } else {
    const sh = e - f.frac;
    let sig = divRound(sh >= 0 ? n : n << BigInt(-sh), sh >= 0 ? r.d << BigInt(sh) : r.d);
    if (sig === 1n << BigInt(f.frac + 1)) {
      sig >>= 1n;
      e++;
    }
    expField = BigInt(e + f.bias);
    frac = sig - (1n << BigInt(f.frac));
    steps.push({ key: 'exponent', latex: `E=${e},\\ e=E+\\text{bias}=${e}+${f.bias}=${e + f.bias}` });
    if (expField >= maxExp) overflow = true;
  }
  if (overflow) {
    return { bits: signBit | (maxExp << BigInt(f.frac)), stored: null, error: 'infinity', rounded: true, overflow, steps };
  }
  const bits = signBit | (expField << BigInt(f.frac)) | frac;
  const stored = exactOf(splitFloat(bits, f), f);
  let error = '0';
  let rounded = false;
  if (stored) {
    const diff = rat(stored.n * r.d - r.n * stored.d, stored.d * r.d);
    rounded = diff.n !== 0n;
    error = ratToSci(diff, 6);
  }
  return { bits, stored, error, rounded, overflow, steps };
}

/** Encodes decimal text, including the words inf, -inf and nan. */
export function encodeDecimal(text: string, f: FloatFormat): Outcome<{ encoding: FloatEncoding }> {
  const t = text.trim().toLowerCase();
  const total = floatBits(f);
  const maxExp = (1n << BigInt(f.exp)) - 1n;
  if (/^[+-]?(inf|infinity)$/.test(t)) {
    const sign = t.startsWith('-') ? 1n : 0n;
    const bits = (sign << BigInt(total - 1)) | (maxExp << BigInt(f.frac));
    return { ok: true, encoding: { bits, stored: null, error: '0', rounded: false, overflow: false, steps: [] } };
  }
  if (t === 'nan') {
    const bits = (maxExp << BigInt(f.frac)) | (1n << BigInt(f.frac - 1));
    return { ok: true, encoding: { bits, stored: null, error: '0', rounded: false, overflow: false, steps: [] } };
  }
  const r = parseDecimal(text);
  if (!r) return bad('notNumber');
  return { ok: true, encoding: encodeRational(r, f, t.startsWith('-')) };
}

function shortestDecimal(exact: Rational, bits: bigint, f: FloatFormat): string {
  for (let sig = 1; sig <= 20; sig++) {
    const s = ratToSci(exact, sig);
    const r = parseDecimal(s);
    if (r && encodeRational(r, f).bits === bits) return plainSci(s);
  }
  return plainSci(ratToSci(exact, 20));
}

/** Writes 1.5e-1 as 0.15 and 2e2 as 200 when that stays short; larger and smaller exponents stay scientific. */
function plainSci(s: string): string {
  const m = /^(-?)(\d)(?:\.(\d+))?e(-?\d+)$/.exec(s);
  if (!m) return s;
  const [, sign = '', first = '', rest = '', ex = '0'] = m;
  const e = Number(ex);
  const digits = `${first}${rest}`;
  if (e >= 0 && e < 7) return `${sign}${digits.padEnd(e + 1, '0').slice(0, e + 1)}${digits.length > e + 1 ? `.${digits.slice(e + 1)}` : ''}`;
  if (e < 0 && e >= -5) return `${sign}0.${'0'.repeat(-e - 1)}${digits}`;
  return `${sign}${first}${rest ? `.${rest}` : ''}e${e}`;
}

/** The next representable value above (up = true) or below. Infinity and NaN stay put at the end of their ranges. */
export function neighbour(bits: bigint, f: FloatFormat, up: boolean): bigint | null {
  const total = floatBits(f);
  const signBit = 1n << BigInt(total - 1);
  const maxExp = (1n << BigInt(f.exp)) - 1n;
  const exponent = (bits >> BigInt(f.frac)) & maxExp;
  const frac = bits & ((1n << BigInt(f.frac)) - 1n);
  if (exponent === maxExp && frac !== 0n) return null;
  const neg = (bits & signBit) !== 0n;
  const mag = bits & (signBit - 1n);
  const infinity = maxExp << BigInt(f.frac);
  if (mag === 0n) return up ? 1n : signBit | 1n;
  const towardsLarger = up !== neg;
  if (towardsLarger) return mag === infinity ? null : (bits & signBit) | (mag + 1n);
  return (bits & signBit) | (mag - 1n);
}

// ---------- characters ----------

export interface CharInfo {
  char: string;
  codePoint: number;
  utf8: number[];
  utf16: number[];
  name: string | null;
}

const CONTROL: Record<number, string> = {
  0: 'NUL', 7: 'BEL', 8: 'BS', 9: 'TAB', 10: 'LF', 11: 'VT', 12: 'FF', 13: 'CR', 27: 'ESC', 32: 'space', 127: 'DEL',
};

/** Code points, UTF-8 bytes and UTF-16 units of each character of the text. */
export function characters(text: string): CharInfo[] {
  const enc = new TextEncoder();
  return Array.from(text).map((char) => {
    const cp = char.codePointAt(0)!;
    const utf16: number[] = [];
    for (let i = 0; i < char.length; i++) utf16.push(char.charCodeAt(i));
    return { char, codePoint: cp, utf8: Array.from(enc.encode(char)), utf16, name: CONTROL[cp] ?? null };
  });
}
