// Known-answer cases for number format codes (ADR 0057). The fixtures in features/tables/fixtures/numfmt were worked
// by hand from ECMA-376 Part 1, 18.8.30 and 18.8.31; none was copied from this code's output.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DE_DE, EN_US, FR_FR, type Locale } from '../locale';
import {
  builtinCode,
  builtinId,
  colorRgb,
  compile,
  delocalizeCode,
  localizeCode,
  readTypedCode,
  regionDateCode,
  render,
} from '.';

const EN_IN: Locale = { tag: 'en-IN', decimal: '.', group: ',', list: ',', dateOrder: 'dmy', currency: 'INR' };
const REGIONS: Record<string, Locale> = { 'en-US': EN_US, 'de-DE': DE_DE, 'fr-FR': FR_FR, 'en-IN': EN_IN };

type Case = [number | string, string, string, (string | null)?, string?];
interface Fixture {
  columns: string[];
  cases: Case[];
}

const DIR = join(import.meta.dirname, '../../fixtures/numfmt');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const fixtures = Object.fromEntries(
  files.map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture]),
);

describe('number format fixtures', () => {
  it('has at least 400 cases', () => {
    const total = Object.values(fixtures).reduce((n, f) => n + f.cases.length, 0);
    expect(total).toBeGreaterThanOrEqual(400);
  });

  for (const [name, fixture] of Object.entries(fixtures)) {
    if (name === 'builtin') continue;
    it.each(fixture.cases.map((c) => [JSON.stringify(c[0]), c[1], c] as const))(`${name}: %s with %s`, (...args) => {
      const [value, code, text, color, region] = args[2];
      const result = render(value, code, REGIONS[region ?? 'en-US']);
      expect(result.text).toBe(text);
      if (color !== undefined) expect(result.color).toBe(color);
    });
  }

  it.each(fixtures.builtin.cases.map((c) => [c[0], JSON.stringify(c[1]), c] as const))(
    'built-in ID %s with %s',
    (...args) => {
      const [id, value, text, color, region] = args[2] as unknown as [
        number,
        number | string,
        string,
        string?,
        string?,
      ];
      const locale = REGIONS[region ?? 'en-US'];
      const code = builtinCode(id, locale);
      expect(code).not.toBeNull();
      const result = render(value, code ?? '', locale);
      expect(result.text).toBe(text);
      if (color !== undefined) expect(result.color).toBe(color);
    },
  );
});

describe('the lane examples', () => {
  const cases: [number, string, string, string | null][] = [
    [1234.567, '#,##0.00', '1,234.57', null],
    [-1234.5, '#,##0.00;[Red](#,##0.00)', '(1,234.50)', 'red'],
    [0, '0;-0;"zero"', 'zero', null],
    [1234567, '#,##0,', '1,235', null],
    [0.000123, '0.00E+00', '1.23E-04', null],
    [12, '000', '012', null],
    [0.75, '# ?/?', ' 3/4', null],
    [3.14159, '# ?/?', '3 1/7', null],
    [3.14159, '# ??/??', '3 14/99', null],
    [1.5, '[h]:mm', '36:00', null],
    [45292, 'dddd, mmmm d, yyyy', 'Monday, January 1, 2024', null],
    [0.25, 'h:mm AM/PM', '6:00 AM', null],
    [123456789012, 'General', '1.23457E+11', null],
    [0.1 + 0.2, 'General', '0.3', null],
  ];
  it.each(cases)('%s with %s is %s', (value, code, text, color) => {
    const result = render(value, code, EN_US);
    expect(result.text).toBe(text);
    expect(result.color).toBe(color);
  });

  it('shows #,##0.00 in de-DE with its separators', () => {
    expect(render(1234.5, '#,##0.00', DE_DE).text).toBe('1.234,50');
  });

  it('stores 0,00 % typed in de-DE as 0.00%', () => {
    expect(readTypedCode('0,00 %', DE_DE)).toEqual({ ok: true, code: '0.00%' });
  });
});

describe('compile', () => {
  it('caches compiled codes', () => {
    expect(compile('#,##0.00')).toBe(compile('#,##0.00'));
  });

  it.each([
    ['0;0;0;@;0', 'sections'],
    ['"abc', 'quote'],
    ['[Red0', 'bracket'],
    ['0\\', 'escape'],
    ['0_', 'escape'],
    ['[>]0', 'condition'],
    ['[>abc]0', 'condition'],
  ])('refuses %s (%s)', (code, error) => {
    expect(compile(code)).toEqual({ ok: false, error });
  });

  it('falls back to General for a code it cannot read', () => {
    expect(render(1.5, '"abc', EN_US).text).toBe('1.5');
  });

  it('reads m as minutes after hours and before seconds, and as months elsewhere', () => {
    const kinds = (code: string) => {
      const r = compile(code);
      if (!r.ok) throw new Error(code);
      return r.compiled.sections[0].tokens.flatMap((t) => (t.t === 'date' ? [t.k] : []));
    };
    expect(kinds('h:mm')).toEqual(['h', 'min']);
    expect(kinds('mm:ss')).toEqual(['min', 's']);
    expect(kinds('m/d/yy')).toEqual(['m', 'd', 'y']);
    expect(kinds('[h]:mm')).toEqual(['eh', 'min']);
    expect(kinds('hh:mm:ss.00')).toEqual(['h', 'min', 's', 'frac']);
    expect(kinds('mmm h')).toEqual(['m', 'h']);
  });

  it('keeps the section kind', () => {
    const r = compile('0.00;[Red]-0.00;"zero";@');
    expect(r.ok && r.compiled.sections.map((s) => s.kind)).toEqual(['number', 'number', 'number']);
    expect(r.ok && r.compiled.text?.kind).toBe('text');
  });
});

describe('render results', () => {
  it('returns the fill of an accounting code with the symbol on the left and digits on the right', () => {
    const result = render(1234.5, '_("$"* #,##0.00_)', EN_US);
    expect(result.text).toBe(' $1,234.50 ');
    expect(result.fill).toEqual({ char: ' ', at: 2 });
  });

  it('moves the fill after an added minus sign', () => {
    expect(render(-5, '"$"* 0', EN_US)).toMatchObject({ text: '-$5', fill: { char: ' ', at: 2 } });
  });

  it('shows a row of # when a number does not fit', () => {
    expect(render(123456789, '#,##0', EN_US, { maxChars: 8 })).toEqual({
      text: '########',
      color: null,
      fill: null,
      overflow: true,
    });
    expect(render(1234, '#,##0', EN_US, { maxChars: 8 }).overflow).toBe(false);
    expect(render('a long piece of text', '@', EN_US, { maxChars: 4 }).text).toBe('a long piece of text');
  });

  it('shows # for a date it cannot show', () => {
    expect(render(1e9, 'yyyy', EN_US).overflow).toBe(true);
  });

  it('gives the RGB of every color token', () => {
    expect(colorRgb('red')).toBe('FF0000');
    expect(colorRgb('black')).toBe('000000');
    expect(colorRgb('color1')).toBe('000000');
    expect(colorRgb('color10')).toBe('008000');
    expect(colorRgb('color56')).toBe('333333');
    expect(colorRgb('color57')).toBeNull();
    for (let n = 1; n <= 56; n++) expect(colorRgb(`color${n}`)).toMatch(/^[0-9A-F]{6}$/);
  });
});

describe('built-in IDs', () => {
  it('has a code for 0 to 22 and 37 to 49, and none for 23 to 26', () => {
    for (const id of [...Array(23).keys(), ...Array.from({ length: 13 }, (_, i) => 37 + i)])
      expect(builtinCode(id, EN_US), String(id)).not.toBeNull();
    for (const id of [23, 24, 25, 26]) expect(builtinCode(id, EN_US)).toBeNull();
  });

  it('names a fixed code by its ID', () => {
    expect(builtinId('#,##0.00')).toBe(4);
    expect(builtinId('[h]:mm:ss')).toBe(46);
    expect(builtinId('0.000')).toBeNull();
  });

  it('reads the region short date for 14', () => {
    expect(builtinCode(14, EN_US)).toBe('m/d/yyyy');
    expect(builtinCode(14, DE_DE)).toBe('d.m.yyyy');
  });
});

describe('regional display', () => {
  it('shows invariant codes with the region separators', () => {
    expect(localizeCode('#,##0.00', DE_DE)).toBe('#.##0,00');
    expect(localizeCode('0.00%', DE_DE)).toBe('0,00\u00a0%');
    expect(localizeCode('#,##0.00;[Red]-#,##0.00', DE_DE)).toBe('#.##0,00;[Red]-#.##0,00');
    expect(localizeCode('#,##0.00 "a.b"', DE_DE)).toBe('#.##0,00 "a.b"');
    expect(localizeCode('dd.mm.yyyy', DE_DE)).toBe('dd.mm.yyyy');
    expect(localizeCode('#,##0.00', FR_FR)).toBe('#\u202f##0,00');
    expect(localizeCode('#,##0.00', EN_US)).toBe('#,##0.00');
  });

  it('converts typed codes back to the invariant form', () => {
    expect(delocalizeCode('#.##0,00', DE_DE)).toBe('#,##0.00');
    expect(delocalizeCode('0,00 %', DE_DE)).toBe('0.00%');
    expect(delocalizeCode('0,00%', DE_DE)).toBe('0.00%');
    expect(delocalizeCode('# ##0,00', FR_FR)).toBe('#,##0.00');
    expect(delocalizeCode('0 "kg"', FR_FR)).toBe('0 "kg"');
    expect(delocalizeCode('dd.mm.yyyy', DE_DE)).toBe('dd.mm.yyyy');
    expect(delocalizeCode('#,##0.00', EN_US)).toBe('#,##0.00');
  });

  it('round-trips codes through the region form', () => {
    for (const code of ['#,##0.00', '0.00%', '0.0,,"M"', '# ?/?', '[h]:mm:ss', '"$"#,##0.00_);("$"#,##0.00)'])
      for (const region of [DE_DE, FR_FR, EN_US]) expect(delocalizeCode(localizeCode(code, region), region)).toBe(code);
  });

  it('reports why a typed code cannot be used', () => {
    expect(readTypedCode('0,00"', DE_DE)).toEqual({ ok: false, error: 'quote' });
  });

  it('builds the region date codes', () => {
    expect(regionDateCode(EN_US, 'short')).toBe('m/d/yyyy');
    expect(regionDateCode(EN_US, 'medium')).toBe('mmm d, yyyy');
    expect(regionDateCode(EN_US, 'long')).toBe('dddd, mmmm d, yyyy');
    expect(regionDateCode(EN_US, 'time')).toBe('h:mm:ss AM/PM');
    expect(regionDateCode(DE_DE, 'short')).toBe('d.m.yyyy');
  });
});
