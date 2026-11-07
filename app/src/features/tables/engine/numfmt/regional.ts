// Codes are stored in the invariant form and shown with the region's decimal mark, digit group separator, and
// percent spacing. A code typed in the region's form converts back, the way typed formulas do (convertFormula).

import { percentSpace, type Locale } from '../locale';
import { compile, readSection, splitSections } from './parse';
import type { CompileError } from './types';

const SPACE = /^[\s\u00a0\u202f\u2009]$/;
const PLACEHOLDER = /^[0#?]$/;

/** Calls `plain` on each character outside quotes, brackets, and escapes; the rest is copied. */
function mapPlain(text: string, plain: (c: string, i: number) => string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      const stop = end < 0 ? text.length : end + 1;
      out += text.slice(i, stop);
      i = stop - 1;
    } else if (c === '[') {
      const end = text.indexOf(']', i + 1);
      const stop = end < 0 ? text.length : end + 1;
      out += text.slice(i, stop);
      i = stop - 1;
    } else if (c === '\\' || c === '_' || c === '*') {
      out += text.slice(i, i + 2);
      i++;
    } else out += plain(c, i);
  }
  return out;
}

function isNumberSection(text: string): boolean {
  const section = readSection(text);
  return typeof section !== 'string' && section.kind === 'number';
}

/** Splits at section semicolons, keeping text that can't be split whole. */
function sections(code: string): string[] {
  const parts = splitSections(code);
  return typeof parts === 'string' ? [code] : parts;
}

/** The code as the region shows it: "#,##0.00" is "#.##0,00" in de-DE and "0.00%" is "0,00 %". */
export function localizeCode(code: string, locale: Locale): string {
  if (locale.decimal === '.' && locale.group === ',' && percentSpace(locale) === '') return code;
  const space = percentSpace(locale);
  return sections(code)
    .map((text) => {
      if (!isNumberSection(text)) return text;
      return mapPlain(text, (c, i) => {
        if (c === '.') return locale.decimal;
        if (c === ',') return locale.group;
        if (c === '%' && space && /[0#?.]/.test(text[i - 1] ?? '')) return `${space}%`;
        return c;
      });
    })
    .join(';');
}

/** The invariant code of a code typed in the region's form. */
export function delocalizeCode(typed: string, locale: Locale): string {
  if (locale.decimal === '.' && locale.group === ',' && percentSpace(locale) === '') return typed;
  const spaceGroup = SPACE.test(locale.group);
  const space = percentSpace(locale);
  return sections(typed)
    .map((text) => {
      if (!isNumberSection(text)) return text;
      // The space in a fraction such as "# ?/?" is a literal, never a group separator.
      const fraction = text.includes('/');
      return mapPlain(text, (c, i) => {
        const prev = text[i - 1] ?? '';
        const next = text[i + 1] ?? '';
        if (space && SPACE.test(c) && next === '%' && /[0#?.,]/.test(prev)) return '';
        if (c === locale.decimal) return '.';
        if (c === locale.group) return ',';
        if (spaceGroup && !fraction && SPACE.test(c) && PLACEHOLDER.test(prev) && PLACEHOLDER.test(next)) return ',';
        return c;
      });
    })
    .join(';');
}

/** Reads a code typed in the region's form: the invariant code, or why it can't be used. */
export function readTypedCode(
  typed: string,
  locale: Locale,
): { ok: true; code: string } | { ok: false; error: CompileError } {
  const code = delocalizeCode(typed.trim(), locale);
  const result = compile(code);
  return result.ok ? { ok: true, code } : { ok: false, error: result.error };
}
