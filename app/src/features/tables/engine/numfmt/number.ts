// Renders a number section: digit placeholders, grouping, scaling, percent, scientific notation, and fractions.
// The value arrives without its sign; the caller adds the minus.

import { groupSizes, percentSpace, type Locale } from '../locale';
import { bestFraction, fixedDigits, groupDigits, intText, roundHalfAway, toDigits } from './digits';
import { generalText } from './general';
import { Out } from './out';
import { planOf, type Digit, type Plan } from './plan';
import type { Section, Token } from './types';

/** The text for each kind of placeholder, in order. */
interface Filled {
  ints: string[];
  decs: string[];
  exps: string;
  /** Integer digits for a code with no integer placeholders, such as `.00`. */
  intExtra: string;
  num: string[];
  den: string[];
  /** A whole number in a fraction code: the fraction shows as spaces. */
  blank: boolean;
}

const empty = (): Filled => ({ ints: [], decs: [], exps: '', intExtra: '', num: [], den: [], blank: false });

function filler(slot: Digit): string {
  return slot.c === '0' ? '0' : slot.c === '?' ? ' ' : '';
}

/** Puts digits into separators: "1234567" in groups of [3] or [3, 2]. */
function groupSlots(out: string[], group: string, sizes: readonly number[]): string[] {
  const [first, rest = first] = sizes;
  let seen = 0;
  let next = first;
  return out
    .slice()
    .reverse()
    .map((piece) => {
      let s = '';
      for (let c = piece.length - 1; c >= 0; c--) {
        const ch = piece[c];
        if (ch >= '0' && ch <= '9') {
          if (seen === next) {
            s = group + s;
            next += rest;
          }
          seen++;
        }
        s = ch + s;
      }
      return s;
    })
    .reverse();
}

/** Fills integer placeholders from the right. Extra digits go to the first placeholder. */
function fillInt(digits: string, slots: readonly Digit[], group: string | null, sizes: readonly number[]): string[] {
  const k = slots.length;
  const out = slots.map((slot, j) => {
    const r = k - 1 - j;
    return r < digits.length ? digits[digits.length - 1 - r] : filler(slot);
  });
  if (k > 0 && digits.length > k) out[0] = digits.slice(0, digits.length - k) + out[0];
  return group === null ? out : groupSlots(out, group, sizes);
}

/** Fills decimal placeholders from the left; trailing zeros under `#` vanish and under `?` become spaces. */
function fillDec(frac: string, slots: readonly Digit[]): string[] {
  const out = slots.map((_, i) => frac[i] ?? '0');
  for (let i = slots.length - 1; i >= 0; i--) {
    if (out[i] !== '0' || slots[i].c === '0') break;
    out[i] = slots[i].c === '?' ? ' ' : '';
  }
  return out;
}

function fillFraction(value: number, plan: Plan, sizes: readonly number[]): Filled {
  const hasWhole = plan.whole.length > 0;
  let whole = hasWhole ? Math.floor(value) : 0;
  const f = hasWhole ? value - whole : value;
  let n: number;
  let d: number;
  if (plan.fixedDen !== null) {
    d = plan.fixedDen;
    n = roundHalfAway(f * d);
  } else {
    const base = Math.floor(f);
    const [pn, pd] = bestFraction(f - base, 10 ** plan.den.length - 1);
    n = base * pd + pn;
    d = pd;
  }
  if (hasWhole && d > 0 && n >= d) {
    whole += Math.floor(n / d);
    n %= d;
  }
  const blank = hasWhole && n === 0;
  const wholeText = whole === 0 ? (n === 0 ? '0' : '') : intText(whole);
  const dText = String(d);
  return {
    ...empty(),
    blank,
    ints: fillInt(wholeText, plan.whole, null, sizes),
    num: blank ? plan.num.map(() => ' ') : fillInt(intText(n), plan.num, null, sizes),
    den: plan.den.map((slot, i) => {
      if (blank) return ' ';
      const pad = slot.c === '?' ? ' ' : '';
      return i === plan.den.length - 1 ? dText.slice(i) || pad : (dText[i] ?? pad);
    }),
  };
}

function fillScientific(value: number, plan: Plan, tokens: readonly Token[], sizes: readonly number[]): Filled {
  const k = plan.int.length;
  const step = plan.int.some((s) => s.c === '#') && k > 1 ? k : 0;
  let e = 0;
  let parts = { int: '', frac: '0'.repeat(plan.dec.length) };
  if (value !== 0) {
    const digits = toDigits(value);
    const b = digits.p - 1;
    e = step ? Math.floor(b / step) * step : b - (Math.max(k, 1) - 1);
    parts = fixedDigits({ d: digits.d, p: digits.p - e }, plan.dec.length);
    if (parts.int.length > (step || Math.max(k, 1))) {
      e += step || 1;
      parts = fixedDigits({ d: digits.d, p: digits.p - e }, plan.dec.length);
    }
  }
  const expToken = tokens.find((t) => t.t === 'exp') as Extract<Token, { t: 'exp' }>;
  const width = plan.exp.filter((s) => s.c === '0').length;
  const sign = e < 0 ? '-' : expToken.plus ? '+' : '';
  return {
    ...empty(),
    ints: fillInt(parts.int, plan.int, null, sizes),
    intExtra: k === 0 ? parts.int : '',
    decs: fillDec(parts.frac, plan.dec),
    exps: `${expToken.upper ? 'E' : 'e'}${sign}${String(Math.abs(e)).padStart(width, '0')}`,
  };
}

function fillDecimal(value: number, plan: Plan, tokens: readonly Token[], locale: Locale): Filled {
  if (plan.general && plan.int.length + plan.dec.length === 0) return empty();
  const sizes = groupSizes(locale);
  const parts = fixedDigits(toDigits(value), plan.dec.length);
  const group = plan.grouping ? locale.group : null;
  const hasPoint = tokens.some((t) => t.t === 'point');
  const loose = plan.int.length === 0 && (hasPoint || plan.dec.length > 0);
  return {
    ...empty(),
    ints: fillInt(parts.int, plan.int, group, sizes),
    intExtra: loose ? (group ? groupDigits(parts.int, group, sizes) : parts.int) : '',
    decs: fillDec(parts.frac, plan.dec),
  };
}

/** Writes the tokens with the filled placeholders. */
function write(section: Section, plan: Plan, filled: Filled, locale: Locale, general: number): Out {
  const tokens = section.tokens;
  const out = new Out();
  const pct = percentSpace(locale);
  const at = { int: 0, whole: 0, dec: 0, num: 0, den: 0 };
  let expDone = false;
  let extraDone = !filled.intExtra;
  tokens.forEach((t, i) => {
    const role = plan.roles[i];
    // A code with no integer placeholders writes the integer digits before the point, or before E+ in `E+00`.
    if (!extraDone && (t.t === 'point' || role === 'dec' || t.t === 'exp')) {
      out.push(filled.intExtra);
      extraDone = true;
    }
    if (role === 'int') out.push(filled.ints[at.int++]);
    else if (role === 'whole') out.push(filled.ints[at.whole++]);
    else if (role === 'dec') out.push(filled.decs[at.dec++]);
    else if (role === 'num') out.push(filled.num[at.num++]);
    else if (role === 'den')
      out.push(t.t === 'num' ? (filled.blank ? ' '.repeat(t.s.length) : t.s) : filled.den[at.den++]);
    else if (role === 'group' || role === 'scale' || role === 'exp' || t.t === 'digit' || t.t === 'date') return;
    else if (t.t === 'exp') {
      if (!expDone) out.push(filled.exps);
      expDone = true;
    } else {
      const s = symbol(t, tokens, i, { pct, locale, blank: filled.blank, general });
      if (s === null) out.token(t);
      else out.push(s);
    }
  });
  if (!extraDone) out.push(filled.intExtra);
  return out;
}

interface SymbolContext {
  pct: string;
  locale: Locale;
  blank: boolean;
  general: number;
}

/** The text of a point, comma, percent, slash, General, or literal digit token; null for literals and spaces. */
function symbol(t: Token, tokens: readonly Token[], i: number, c: SymbolContext): string | null {
  switch (t.t) {
    case 'point':
      return c.locale.decimal;
    case 'comma':
      return ',';
    case 'percent': {
      const prev = tokens[i - 1];
      return c.pct && (prev?.t === 'digit' || prev?.t === 'point') ? `${c.pct}%` : '%';
    }
    case 'slash':
      return c.blank ? ' ' : '/';
    case 'general':
      return generalText(c.general, c.locale.decimal);
    case 'at':
      return generalText(Math.abs(c.general), c.locale.decimal);
    case 'num':
      return t.s;
    default:
      return null;
  }
}

/** Renders the magnitude of a number. `signed` tells General to write the minus itself. */
export function renderNumber(abs: number, section: Section, locale: Locale, signed: boolean): Out {
  const plan = planOf(section);
  const value = (abs * 100 ** plan.percent) / 1000 ** plan.scale;
  const sizes = groupSizes(locale);
  const filled = plan.fraction
    ? fillFraction(value, plan, sizes)
    : plan.scientific
      ? fillScientific(value, plan, section.tokens, sizes)
      : fillDecimal(value, plan, section.tokens, locale);
  return write(section, plan, filled, locale, signed ? -abs : abs);
}
