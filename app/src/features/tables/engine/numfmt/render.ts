// Renders a value through a compiled format code. Numbers pick a section by sign or condition, then the section
// fills its digit placeholders (number.ts) or its date and time tokens (date.ts). Text uses the text section.

import type { Locale } from '../locale';
import { renderDate } from './date';
import { generalText } from './general';
import { renderNumber } from './number';
import { Out } from './out';
import { compile } from './parse';
import { planOf } from './plan';
import type { Compiled, Rendered, Section, Token } from './types';

export interface RenderOptions {
  /** The characters that fit in the cell. A number that is longer shows as a row of `#`. */
  maxChars?: number;
}

const TEXT_SYMBOLS: Partial<Record<Token['t'], string>> = { point: '.', comma: ',', percent: '%', slash: '/' };

/** Text tokens: `@` is the text; number and date tokens show as written. */
function renderText(text: string, section: Section): Out {
  const out = new Out();
  for (const t of section.tokens) {
    if (t.t === 'at' || t.t === 'general') out.push(text);
    else if (t.t === 'digit') out.push(t.c);
    else if (t.t === 'num') out.push(t.s);
    else if (t.t === 'date') out.push(t.text);
    else if (t.t === 'exp') out.push(`${t.upper ? 'E' : 'e'}${t.plus ? '+' : '-'}`);
    else if (!out.token(t)) out.push(TEXT_SYMBOLS[t.t] ?? '');
  }
  return out;
}

function matches(section: Section, value: number): boolean {
  const c = section.condition;
  if (!c) return false;
  switch (c.op) {
    case '<':
      return value < c.value;
    case '<=':
      return value <= c.value;
    case '>':
      return value > c.value;
    case '>=':
      return value >= c.value;
    case '=':
      return value === c.value;
    case '<>':
      return value !== c.value;
  }
}

/** A section meant for negative numbers shows them without a minus sign. */
function negativeByCondition(section: Section): boolean {
  const c = section.condition;
  return c !== null && (c.op === '<' || c.op === '<=') && c.value <= 0;
}

interface Picked {
  section: Section;
  /** True when the minus sign is added to the section's text. */
  signed: boolean;
}

/** The section of a code with conditions (ADR 0057). */
function pickConditional(sections: readonly Section[], value: number): Picked | null {
  const [s0, s1, s2] = sections;
  const chosen = (section: Section): Picked => ({ section, signed: value < 0 && !negativeByCondition(section) });
  if (s0.condition ? matches(s0, value) : value >= 0) return chosen(s0);
  if (!s1) return null;
  if (s1.condition) {
    if (matches(s1, value)) return chosen(s1);
    return s2 ? chosen(s2) : null;
  }
  if (s2 && value >= 0) return chosen(s2);
  return s2 ? { section: s1, signed: false } : chosen(s1);
}

/** The section a number uses: by sign (positive; negative; zero) unless the first two have conditions. */
function pick(sections: readonly Section[], value: number): Picked | null {
  const [s0, s1, s2] = sections;
  if (!s0) return null;
  if (s0.condition || s1?.condition) return pickConditional(sections, value);
  if (sections.length === 1) return { section: s0, signed: value < 0 };
  if (value < 0) return { section: s1, signed: false };
  if (value === 0 && s2) return { section: s2, signed: false };
  return { section: s0, signed: false };
}

function hashes(options: RenderOptions): Rendered {
  return { text: '#'.repeat(Math.max(1, options.maxChars ?? 8)), color: null, fill: null, overflow: true };
}

function finish(out: Out, color: string | null, options: RenderOptions, number: boolean): Rendered {
  if (number && options.maxChars !== undefined && out.text.length > options.maxChars) return hashes(options);
  return { text: out.text, color, fill: out.fill, overflow: false };
}

function renderPicked(v: number, picked: Picked, compiled: Compiled, locale: Locale, options: RenderOptions): Rendered {
  const { section, signed } = picked;
  if (section.empty) return { text: '', color: section.color, fill: null, overflow: false };
  if (section.kind === 'date') {
    const out = renderDate(signed || section === compiled.sections[0] ? v : Math.abs(v), section, locale);
    return out ? finish(out, section.color, options, true) : hashes(options);
  }
  if (section.kind === 'text') {
    const out = new Out();
    out.push(generalText(signed ? v : Math.abs(v), locale.decimal));
    return finish(out, section.color, options, true);
  }
  const out = renderNumber(Math.abs(v), section, locale, signed);
  if (signed && !planOf(section).general) {
    out.text = `-${out.text}`;
    if (out.fill) out.fill.at++;
  }
  return finish(out, section.color, options, true);
}

/** Renders a number or text through a compiled code. */
export function renderCompiled(
  value: number | string,
  compiled: Compiled,
  locale: Locale,
  options: RenderOptions = {},
): Rendered {
  if (typeof value === 'string') {
    const section = compiled.text;
    if (!section) return { text: value, color: null, fill: null, overflow: false };
    return finish(renderText(value, section), section.color, options, false);
  }
  const v = Object.is(value, -0) ? 0 : value;
  if (!Number.isFinite(v)) return hashes(options);
  const picked = pick(compiled.sections, v);
  return picked ? renderPicked(v, picked, compiled, locale, options) : hashes(options);
}

/** Renders a value through a code, which falls back to General when it can't be read. */
export function render(value: number | string, code: string, locale: Locale, options: RenderOptions = {}): Rendered {
  const result = compile(code === '' ? 'General' : code);
  const compiled = result.ok ? result.compiled : (compile('General') as { ok: true; compiled: Compiled }).compiled;
  return renderCompiled(value, compiled, locale, options);
}
