// Reads a format code into sections of tokens (ECMA-376 Part 1, 18.8.31). Compiled codes are cached, because a grid
// renders the same few codes for every cell.

import { colorToken } from './colors';
import { tagOfLcid } from './lcid';
import type { CompileError, CompileResult, Compiled, Comparison, DateKind, Section, Token } from './types';

const DATE_LETTERS = new Set(['y', 'm', 'd', 'h', 's']);

/** Splits a code at the semicolons that are not inside quotes, brackets, or after a backslash. */
export function splitSections(code: string): string[] | CompileError {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') {
      const end = code.indexOf('"', i + 1);
      if (end < 0) return 'quote';
      i = end;
    } else if (c === '\\' || c === '_' || c === '*') {
      if (i + 1 >= code.length) return 'escape';
      i++;
    } else if (c === '[') {
      const end = code.indexOf(']', i + 1);
      if (end < 0) return 'bracket';
      i = end;
    } else if (c === ';') {
      parts.push(code.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(code.slice(start));
  return parts.length > 4 ? 'sections' : parts;
}

interface Bracket {
  color?: string;
  condition?: { op: Comparison; value: number } | 'bad';
  currency?: string;
  locale?: string | null;
  system?: 'longDate' | 'time';
  elapsed?: Token;
}

function readBracket(inner: string): Bracket {
  const color = colorToken(inner);
  if (color) return { color };
  const cond = /^(<=|>=|<>|<|>|=)\s*(.*)$/.exec(inner);
  if (cond) {
    const value = Number(cond[2].trim());
    return {
      condition: cond[2].trim() === '' || !Number.isFinite(value) ? 'bad' : { op: cond[1] as Comparison, value },
    };
  }
  if (inner.startsWith('$')) {
    const dash = inner.indexOf('-');
    const currency = dash > 0 ? inner.slice(1, dash) : inner.slice(1);
    const id = dash > 0 ? inner.slice(dash + 1) : '';
    const out: Bracket = { currency };
    if (/^[0-9a-f]{1,8}$/i.test(id)) {
      const n = parseInt(id, 16);
      const low = n & 0xffff;
      if (low === 0xf800) out.system = 'longDate';
      else if (low === 0xf400) out.system = 'time';
      else out.locale = tagOfLcid(n);
    } else if (/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(id)) {
      out.locale = id;
    }
    return out;
  }
  const elapsed = /^(h+|m+|s+)$/i.exec(inner);
  if (elapsed) {
    const letter = elapsed[1][0].toLowerCase();
    const k: DateKind = letter === 'h' ? 'eh' : letter === 'm' ? 'em' : 'es';
    return { elapsed: { t: 'date', k, n: elapsed[1].length, text: `[${elapsed[1]}]` } };
  }
  return {};
}

function lit(tokens: Token[], s: string): void {
  const last = tokens[tokens.length - 1];
  if (last && last.t === 'lit') last.s += s;
  else tokens.push({ t: 'lit', s });
}

/** Reads one section's text into a section. */
export function readSection(text: string): Section | CompileError {
  const tokens: Token[] = [];
  const section: Section = {
    kind: 'number',
    tokens,
    color: null,
    condition: null,
    locale: null,
    system: null,
    empty: text === '',
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const lower = c.toLowerCase();
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) return 'quote';
      if (end > i + 1) lit(tokens, text.slice(i + 1, end));
      i = end;
    } else if (c === '\\') {
      if (i + 1 >= text.length) return 'escape';
      lit(tokens, text[++i]);
    } else if (c === '_' || c === '*') {
      if (i + 1 >= text.length) return 'escape';
      tokens.push(c === '_' ? { t: 'skip', c: text[++i] } : { t: 'fill', c: text[++i] });
    } else if (c === '[') {
      const end = text.indexOf(']', i + 1);
      if (end < 0) return 'bracket';
      const b = readBracket(text.slice(i + 1, end));
      i = end;
      if (b.color) section.color = b.color;
      if (b.condition === 'bad') return 'condition';
      if (b.condition) section.condition = b.condition;
      if (b.currency) lit(tokens, b.currency);
      if (b.locale) section.locale = b.locale;
      if (b.system) section.system = b.system;
      if (b.elapsed) tokens.push(b.elapsed);
    } else if (c === '0' || c === '#' || c === '?') {
      tokens.push({ t: 'digit', c });
    } else if (c >= '1' && c <= '9') {
      let j = i;
      while (j + 1 < text.length && text[j + 1] >= '0' && text[j + 1] <= '9') j++;
      tokens.push({ t: 'num', s: text.slice(i, j + 1) });
      i = j;
    } else if (c === '.') tokens.push({ t: 'point' });
    else if (c === ',') tokens.push({ t: 'comma' });
    else if (c === '%') tokens.push({ t: 'percent' });
    else if (c === '/') tokens.push({ t: 'slash' });
    else if (c === '@') tokens.push({ t: 'at' });
    else if ((c === 'E' || c === 'e') && (text[i + 1] === '+' || text[i + 1] === '-')) {
      tokens.push({ t: 'exp', upper: c === 'E', plus: text[i + 1] === '+' });
      i++;
    } else if (text.slice(i, i + 7).toLowerCase() === 'general') {
      tokens.push({ t: 'general' });
      i += 6;
    } else if (text.slice(i, i + 5).toLowerCase() === 'am/pm') {
      tokens.push({ t: 'date', k: 'ampm', n: 5, text: text.slice(i, i + 5) });
      i += 4;
    } else if (text.slice(i, i + 3).toLowerCase() === 'a/p') {
      tokens.push({ t: 'date', k: 'ap', n: 3, text: text.slice(i, i + 3) });
      i += 2;
    } else if (DATE_LETTERS.has(lower)) {
      let j = i;
      while (j + 1 < text.length && text[j + 1].toLowerCase() === lower) j++;
      tokens.push({ t: 'date', k: lower as DateKind, n: j - i + 1, text: text.slice(i, j + 1) });
      i = j;
    } else lit(tokens, c);
  }
  classify(section);
  return section;
}

const DIGIT_TEXT: Record<string, string> = { point: '.', comma: ',', percent: '%', slash: '/', at: '@' };

/** Decides the section's kind and, in a date section, reads `m` as minutes or month and `.00` as fractions. */
function classify(section: Section): void {
  const tokens = section.tokens;
  const hasDate = tokens.some((t) => t.t === 'date') || section.system !== null;
  if (!hasDate) {
    const numeric = tokens.some((t) => t.t === 'digit' || t.t === 'general');
    section.kind = numeric ? 'number' : tokens.some((t) => t.t === 'at') ? 'text' : 'number';
    return;
  }
  section.kind = 'date';
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === 'point' && tokens[i + 1]?.t === 'digit' && (tokens[i + 1] as { c: string }).c === '0') {
      let n = 0;
      while (tokens[i + 1 + n]?.t === 'digit' && (tokens[i + 1 + n] as { c: string }).c === '0') n++;
      out.push({ t: 'date', k: 'frac', n: Math.min(n, 3), text: `.${'0'.repeat(n)}` });
      i += n;
    } else if (t.t === 'date' || t.t === 'lit' || t.t === 'skip' || t.t === 'fill' || t.t === 'general') {
      out.push(t);
    } else if (t.t === 'digit') {
      out.push({ t: 'lit', s: t.c });
    } else if (t.t === 'num') {
      out.push({ t: 'lit', s: t.s });
    } else if (t.t === 'exp') {
      out.push({ t: 'lit', s: `${t.upper ? 'E' : 'e'}${t.plus ? '+' : '-'}` });
    } else {
      out.push({ t: 'lit', s: DIGIT_TEXT[t.t] ?? '' });
    }
  }
  // m or mm right after hours, or right before seconds, is minutes.
  const dates = out.filter((t): t is Extract<Token, { t: 'date' }> => t.t === 'date' && t.k !== 'frac');
  dates.forEach((t, i) => {
    if (t.k !== 'm' || t.n > 2) return;
    const before = dates[i - 1];
    const after = dates[i + 1];
    if ((before && (before.k === 'h' || before.k === 'eh')) || (after && (after.k === 's' || after.k === 'es')))
      t.k = 'min';
  });
  section.tokens = out;
}

const cache = new Map<string, CompileResult>();
const CACHE_LIMIT = 1024;

/** Compiles a code, or tells why it can't be read. Results are cached by code. */
export function compile(code: string): CompileResult {
  const hit = cache.get(code);
  if (hit) return hit;
  const result = compileUncached(code);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(code, result);
  return result;
}

function compileUncached(code: string): CompileResult {
  const parts = splitSections(code);
  if (typeof parts === 'string') return { ok: false, error: parts };
  const sections: Section[] = [];
  for (const part of parts) {
    const section = readSection(part);
    if (typeof section === 'string') return { ok: false, error: section };
    sections.push(section);
  }
  let text: Section | null = null;
  if (sections.length === 4) text = sections.pop() ?? null;
  else if (sections.length > 1 && sections[sections.length - 1].kind === 'text') text = sections.pop() ?? null;
  else if (sections.length === 1 && sections[0].kind === 'text') text = sections[0];
  if (text) text.kind = 'text';
  const compiled: Compiled = { code, sections, text };
  return { ok: true, compiled };
}
