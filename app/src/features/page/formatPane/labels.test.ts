// Every value the pane offers has its own string, so no option shows a made-up name (American English, no hard-coded
// user-visible text).
import { describe, expect, it } from 'vitest';
import { BORDER_STYLES, SHADE_PATTERNS } from '../../../editor/paragraph/attributes';
import { NUMBER_FORMATS } from '../../../editor/paragraph/numberFormats';
import { textPane } from '../../../strings/en/textPane';
import { FIELDS } from './fields';

const opt = textPane.opt as Readonly<Record<string, Readonly<Record<string, string>>>>;
const has = (field: string, value: string) => opt[field]?.[value === '' ? 'none' : value] !== undefined;

describe('option strings', () => {
  it('has a string for every border style, shading pattern, and number format', () => {
    expect(BORDER_STYLES.filter((v) => !has('borderStyle', v))).toEqual([]);
    expect(SHADE_PATTERNS.filter((v) => !has('pattern', v))).toEqual([]);
    expect(NUMBER_FORMATS.filter((v) => !has('format', v))).toEqual([]);
  });

  it('has a string for every option of every choice field', () => {
    const missing: string[] = [];
    for (const field of FIELDS) {
      if (field.kind !== 'choice') continue;
      for (const value of field.options ?? []) {
        // Stylistic sets share one message, and outline levels are digits.
        if (/^(ss\d\d|\d)$/.test(value)) continue;
        if (!has(field.id, String(value))) missing.push(`${field.id}.${String(value)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
